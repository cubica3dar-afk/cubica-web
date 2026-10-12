-- Comparar antes con el catálogo REAL. No sustituye el esquema consolidado ni Auth.
-- Cola transaccional: ninguna llamada HTTP se realiza dentro de create_public_order.
begin;

do $$
declare v_missing text;
begin
  select string_agg(required.table_name || '.' || required.column_name, ', ')
  into v_missing
  from (values
    ('orders','id'), ('orders','order_number'), ('orders','client_order_id'),
    ('orders','user_id'), ('orders','created_at'), ('orders','customer_name'),
    ('orders','customer_email'), ('orders','phone'), ('orders','payment'),
    ('orders','notes'), ('orders','total'), ('orders','status'), ('orders','username'),
    ('orders','internal_email_sent'), ('orders','customer_email_sent'), ('orders','email_errors'),
    ('order_items','id'), ('order_items','order_id'), ('order_items','product_id'),
    ('order_items','name'), ('order_items','color'), ('order_items','qty'), ('order_items','unit_price'),
    ('product_recipes','product_id'), ('product_recipes','supply_id'), ('product_recipes','qty_per_unit'),
    ('supplies','id'), ('supplies','name'), ('supplies','qty'), ('supplies','unit'), ('supplies','active')
  ) as required(table_name,column_name)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema='public' and c.table_name=required.table_name and c.column_name=required.column_name
  );
  if v_missing is not null then raise exception 'Revisar esquema antes de continuar. Faltan: %', v_missing; end if;
  if to_regprocedure('public.create_public_order(text,text,text,text,text,text,jsonb)') is null then
    raise exception 'create_public_order no existe con la firma esperada';
  end if;
end;
$$;

create table public.order_email_outbox (
  order_id uuid not null references public.orders(id) on delete cascade,
  kind text not null check (kind in ('customer','internal')),
  status text not null default 'pending' check (status in ('pending','processing','sent','failed','review')),
  created_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  attempts integer not null default 0,
  lock_token uuid,
  locked_until timestamptz,
  first_send_at timestamptz,
  payload jsonb,
  provider_id text,
  last_error text,
  primary key (order_id,kind)
);
create index order_email_outbox_due_idx on public.order_email_outbox(next_attempt_at)
where status in ('pending','processing');
alter table public.order_email_outbox enable row level security;
revoke all on public.order_email_outbox from public, anon, authenticated;
grant select,insert,update,delete on public.order_email_outbox to service_role;

create function private.enqueue_order_emails()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  -- El trigger diferido ve los ítems al final del RPC. Las importaciones históricas
  -- (orden y detalle en transacciones separadas) no disparan correos retroactivos.
  if new.created_at < transaction_timestamp() - interval '5 minutes'
     or not exists (select 1 from public.order_items where order_id=new.id) then
    return new;
  end if;
  begin
    insert into public.order_email_outbox(order_id,kind)
    values(new.id,'customer'),(new.id,'internal') on conflict do nothing;
  exception when others then
    -- Aislar fallos de la cola de la venta. No guardar mensajes SQL con datos privados.
    begin
      update public.orders set email_errors =
        (case when jsonb_typeof(email_errors)='array' then email_errors else '[]'::jsonb end)
        || jsonb_build_array(jsonb_build_object('kind','queue','code','enqueue_failed','at',now()))
      where id=new.id;
    exception when others then null;
    end;
    raise warning 'No se pudo encolar email de pedido';
  end;
  return new;
end;
$$;
revoke all on function private.enqueue_order_emails() from public,anon,authenticated;
create constraint trigger cubica_enqueue_order_emails
after insert on public.orders deferrable initially deferred
for each row execute function private.enqueue_order_emails();

-- El secreto del worker se crea dentro de Vault y no sale de la base.
do $$
begin
  if not exists(select 1 from vault.secrets where name='cubica_order_email_worker_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),
      'cubica_order_email_worker_secret','Autenticación privada del worker de pedidos');
  end if;
end;
$$;

create function public.validate_order_email_worker_secret(p_secret text)
returns boolean language sql stable security definer set search_path=''
as $$
  select coalesce(length(p_secret) between 32 and 256 and exists(
    select 1 from vault.decrypted_secrets
    where name='cubica_order_email_worker_secret'
      and extensions.digest(decrypted_secret,'sha256')=extensions.digest(p_secret,'sha256')
  ),false);
$$;
revoke all on function public.validate_order_email_worker_secret(text) from public,anon,authenticated;
grant execute on function public.validate_order_email_worker_secret(text) to service_role;

create function public.get_order_email_snapshot(p_order_id uuid)
returns jsonb language sql stable security definer set search_path=''
as $$
  select jsonb_build_object(
    'order',to_jsonb(o),
    'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from public.order_items i where i.order_id=o.id),'[]'::jsonb),
    'recipes',coalesce((select jsonb_agg(to_jsonb(r) order by r.product_id,r.supply_id) from public.product_recipes r
      where r.product_id in (select i.product_id from public.order_items i where i.order_id=o.id)),'[]'::jsonb),
    'supplies',coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from public.supplies s
      where s.id in (select r.supply_id from public.product_recipes r
        where r.product_id in (select i.product_id from public.order_items i where i.order_id=o.id))),'[]'::jsonb)
  ) from public.orders o where o.id=p_order_id;
$$;

create function public.claim_order_email_deliveries(p_limit integer default 3)
returns setof public.order_email_outbox
language plpgsql security definer set search_path=''
as $$
begin
  -- Resend conserva las claves por 24h. No repetir automáticamente un envío ambiguo
  -- después de esa ventana; queda para revisión con 1h de margen.
  with expired as (
    update public.order_email_outbox set status='review',last_error=
      case when attempts>=10 then 'retry_limit_exceeded' else 'idempotency_window_expired' end
    where status in ('pending','processing') and (first_send_at < now()-interval '23 hours' or attempts>=10)
      and coalesce(locked_until,'-infinity'::timestamptz) < now()
    returning order_id,kind,last_error
  ), errors as (
    select order_id,jsonb_agg(jsonb_build_object('kind',kind,'code',last_error,'at',now())) as data
    from expired group by order_id
  )
  update public.orders o set email_errors=
    (case when jsonb_typeof(o.email_errors)='array' then o.email_errors else '[]'::jsonb end)||errors.data
  from errors where o.id=errors.order_id;

  return query
  with candidates as (
    select q.order_id,q.kind from public.order_email_outbox q
    where q.status in ('pending','processing') and q.next_attempt_at <= now()
      and coalesce(q.locked_until,'-infinity'::timestamptz) < now()
    order by q.next_attempt_at,q.order_id,q.kind
    limit greatest(1,least(coalesce(p_limit,3),3)) for update skip locked
  )
  update public.order_email_outbox q set status='processing',attempts=q.attempts+1,
    lock_token=gen_random_uuid(),locked_until=now()+interval '5 minutes'
  from candidates c where q.order_id=c.order_id and q.kind=c.kind returning q.*;
end;
$$;

create function public.prepare_order_email_delivery(p_order_id uuid,p_kind text,p_lock_token uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_payload jsonb;
begin
  if jsonb_typeof(p_payload) <> 'object' or octet_length(p_payload::text)>250000 then
    raise exception 'Payload de email inválido';
  end if;
  update public.order_email_outbox set payload=coalesce(payload,p_payload),
    first_send_at=coalesce(first_send_at,now()),locked_until=now()+interval '5 minutes'
  where order_id=p_order_id and kind=p_kind and lock_token=p_lock_token
    and status='processing' and locked_until>now()
  returning payload into v_payload;
  return v_payload;
end;
$$;

create function public.finish_order_email_delivery(
  p_order_id uuid,p_kind text,p_lock_token uuid,p_sent boolean,
  p_provider_id text default null,p_error text default null,p_retryable boolean default true
)
returns void language plpgsql security definer set search_path=''
as $$
declare v_attempt integer; v_status text;
begin
  select attempts into v_attempt from public.order_email_outbox
  where order_id=p_order_id and kind=p_kind and lock_token=p_lock_token and status='processing'
  for update;
  if not found then raise exception 'Lease de email vencido'; end if;
  v_status := case when p_sent then 'sent' when not p_retryable then 'failed'
    when v_attempt>=10 then 'review' else 'pending' end;
  update public.order_email_outbox set status=v_status,provider_id=coalesce(p_provider_id,provider_id),
    last_error=case when p_sent then null else left(coalesce(p_error,'delivery_failed'),120) end,
    next_attempt_at=now()+make_interval(mins=>least(60,power(2,least(v_attempt-1,6))::integer)),
    lock_token=null,locked_until=null
  where order_id=p_order_id and kind=p_kind;

  -- El UPDATE del pedido serializa ambos destinatarios, sin pisar sus resultados.
  update public.orders o set
    customer_email_sent=o.customer_email_sent or (p_sent and p_kind='customer'),
    internal_email_sent=o.internal_email_sent or (p_sent and p_kind='internal'),
    email_errors=coalesce((select jsonb_agg(entry) from jsonb_array_elements(
      case when jsonb_typeof(o.email_errors)='array' then o.email_errors else '[]'::jsonb end
    ) entry where entry->>'kind' is distinct from p_kind),'[]'::jsonb)
    || case when p_sent then '[]'::jsonb else jsonb_build_array(jsonb_build_object(
      'kind',p_kind,'code',left(coalesce(p_error,'delivery_failed'),120),
      'attempt',v_attempt,'status',v_status,'at',now())) end
  where o.id=p_order_id;
end;
$$;

revoke all on function public.get_order_email_snapshot(uuid),public.claim_order_email_deliveries(integer),
  public.prepare_order_email_delivery(uuid,text,uuid,jsonb),
  public.finish_order_email_delivery(uuid,text,uuid,boolean,text,text,boolean)
from public,anon,authenticated;
grant execute on function public.get_order_email_snapshot(uuid),public.claim_order_email_deliveries(integer),
  public.prepare_order_email_delivery(uuid,text,uuid,jsonb),
  public.finish_order_email_delivery(uuid,text,uuid,boolean,text,text,boolean)
to service_role;

commit;
