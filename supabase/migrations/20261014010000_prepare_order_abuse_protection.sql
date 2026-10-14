-- Stage 1: prepare a service-only order path and atomic, short-lived counters.
-- The public checkout RPC remains available until Turnstile production keys are
-- verified and the separate activation migration is applied.

create table private.order_rate_limits (
  scope_hash text not null check (scope_hash ~ '^[a-z]+:[0-9a-f]{64}$'),
  window_seconds integer not null check (window_seconds between 60 and 86400),
  window_start timestamptz not null,
  request_count integer not null check (request_count > 0),
  expires_at timestamptz not null,
  primary key (scope_hash, window_seconds, window_start)
);

alter table private.order_rate_limits enable row level security;
revoke all on table private.order_rate_limits from public, anon, authenticated, service_role;

create function private.consume_order_rate_limit(
  p_scope_hash text,
  p_limit integer,
  p_window_seconds integer
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_start timestamptz;
  v_count integer;
  v_retry integer;
begin
  if p_scope_hash !~ '^[a-z]+:[0-9a-f]{64}$'
    or p_limit not between 1 and 1000
    or p_window_seconds not between 60 and 86400 then
    raise exception 'order_invalid_rate_limit';
  end if;

  v_start := to_timestamp(floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds);
  insert into private.order_rate_limits(scope_hash,window_seconds,window_start,request_count,expires_at)
  values(p_scope_hash,p_window_seconds,v_start,1,v_start+make_interval(secs=>p_window_seconds)+interval '2 days')
  on conflict(scope_hash,window_seconds,window_start) do update
    set request_count=private.order_rate_limits.request_count+1,
        expires_at=excluded.expires_at
  returning request_count into v_count;

  if v_count>p_limit then
    v_retry:=greatest(1,ceil(extract(epoch from (v_start+make_interval(secs=>p_window_seconds)-v_now)))::integer);
    raise exception 'order_rate_limit:%',v_retry;
  end if;
end;
$$;

create function private.existing_delivery_order(
  p_client_order_id text,
  p_customer_name text,
  p_customer_email text,
  p_phone text,
  p_payment text,
  p_notes text,
  p_items jsonb,
  p_delivery jsonb,
  p_user_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_old private.order_deliveries;
  v_request_id uuid;
  v_token text;
  v_hash text;
begin
  v_request_id:=(p_delivery->>'request_id')::uuid;
  v_token:=p_delivery->>'quote_token';
  if v_request_id is null or v_token is null or v_token !~ '^[0-9a-f]{64}$' then
    raise exception 'order_invalid_request';
  end if;
  v_hash:=md5(jsonb_build_object(
    'customer',btrim(p_customer_name),'email',lower(btrim(p_customer_email)),
    'phone',p_phone,'payment',p_payment,'notes',p_notes,
    'items',p_items,'delivery',p_delivery
  )::text);
  select * into v_old from private.order_deliveries where request_id=v_request_id;
  if not found then return null; end if;
  if v_old.token_hash<>extensions.digest(v_token,'sha256')
    or v_old.request_hash<>v_hash
    or (select user_id from public.orders where id=v_old.order_id) is distinct from p_user_id then
    raise exception 'order_not_available' using errcode='42501';
  end if;
  return (select jsonb_build_object(
    'ok',true,'order_id',id,'order_number',order_number,'total',total,
    'delivery_total',v_old.charged_ars,'idempotent_replay',true
  ) from public.orders where id=v_old.order_id);
end;
$$;

create function public.lookup_verified_delivery_order(
  p_client_order_id text,
  p_customer_name text,
  p_customer_email text,
  p_phone text,
  p_payment text,
  p_notes text,
  p_items jsonb,
  p_delivery jsonb,
  p_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'order_service_only' using errcode='42501';
  end if;
  return private.existing_delivery_order(
    p_client_order_id,p_customer_name,p_customer_email,p_phone,p_payment,
    p_notes,p_items,p_delivery,p_user_id
  );
end;
$$;

create function public.create_verified_delivery_order(
  p_client_order_id text,
  p_customer_name text,
  p_customer_email text,
  p_phone text,
  p_payment text,
  p_notes text,
  p_items jsonb,
  p_delivery jsonb,
  p_user_id uuid,
  p_rate_limits jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id uuid;
  v_existing jsonb;
  v_limit jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'order_service_only' using errcode='42501';
  end if;
  v_request_id:=(p_delivery->>'request_id')::uuid;
  if v_request_id is null then raise exception 'order_invalid_request'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_request_id::text,2));
  v_existing:=private.existing_delivery_order(
    p_client_order_id,p_customer_name,p_customer_email,p_phone,p_payment,
    p_notes,p_items,p_delivery,p_user_id
  );
  if v_existing is not null then return v_existing; end if;

  if jsonb_typeof(p_rate_limits) is distinct from 'array'
    or jsonb_array_length(p_rate_limits) not between 2 and 6 then
    raise exception 'order_invalid_rate_limit';
  end if;
  for v_limit in select value from jsonb_array_elements(p_rate_limits) loop
    perform private.consume_order_rate_limit(
      v_limit->>'key',(v_limit->>'limit')::integer,(v_limit->>'window_seconds')::integer
    );
  end loop;

  -- The verified user identity comes only from the Edge Function after Auth API
  -- validation. The existing transactional checkout keeps using auth.uid().
  perform set_config('request.jwt.claim.sub',coalesce(p_user_id::text,''),true);
  perform set_config('request.jwt.claims',case when p_user_id is null
    then jsonb_build_object('role','anon')::text
    else jsonb_build_object('sub',p_user_id,'role','authenticated')::text end,true);

  return private.create_delivery_order(
    p_client_order_id,p_customer_name,p_customer_email,p_phone,p_payment,
    p_notes,p_items,p_delivery
  );
end;
$$;

revoke all on function private.consume_order_rate_limit(text,integer,integer),
  private.existing_delivery_order(text,text,text,text,text,text,jsonb,jsonb,uuid),
  public.lookup_verified_delivery_order(text,text,text,text,text,text,jsonb,jsonb,uuid),
  public.create_verified_delivery_order(text,text,text,text,text,text,jsonb,jsonb,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.lookup_verified_delivery_order(text,text,text,text,text,text,jsonb,jsonb,uuid),
  public.create_verified_delivery_order(text,text,text,text,text,text,jsonb,jsonb,uuid,jsonb)
  to service_role;

comment on table private.order_rate_limits is
  'Short-lived hashed counters for verified order attempts. No raw IP addresses, emails or guest tokens.';
comment on function public.create_verified_delivery_order(text,text,text,text,text,text,jsonb,jsonb,uuid,jsonb) is
  'Service-only transactional checkout entrypoint used after Turnstile and Auth verification.';

do $$
declare v_job bigint;
begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    select jobid into v_job from cron.job where jobname='cubica-order-rate-limit-cleanup';
    if v_job is not null then perform cron.unschedule(v_job); end if;
    perform cron.schedule(
      'cubica-order-rate-limit-cleanup','31 4 * * *',
      $job$delete from private.order_rate_limits where expires_at<now()$job$
    );
  end if;
end;
$$;


