-- Activar después de desplegar order-emails. Si faltan secretos del proveedor,
-- el runtime no reclama entregas y las conserva pendientes sin consumir reintentos.
-- El secreto existe en Vault con nombre cubica_order_email_worker_secret.
-- Lo crea la migración de la cola y el worker lo valida en backend.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if not exists(select 1 from vault.decrypted_secrets where name='cubica_order_email_worker_secret'
    and length(decrypted_secret)>=32) then
    raise exception 'Falta configurar el secreto del worker en Vault';
  end if;
end;
$$;

create or replace function private.invoke_order_email_worker()
returns bigint language plpgsql security definer set search_path=''
as $$
declare v_secret text; v_request bigint;
begin
  if not exists(select 1 from public.order_email_outbox
    where status in ('pending','processing') and next_attempt_at<=now()
      and coalesce(locked_until,'-infinity'::timestamptz)<now()) then return null; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets
  where name='cubica_order_email_worker_secret' limit 1;
  if coalesce(length(v_secret),0)<32 then raise exception 'Worker secret no configurado'; end if;
  select net.http_post(
    url:='https://mymrbpwvghxmqqpzzdqk.supabase.co/functions/v1/order-emails',
    headers:=jsonb_build_object('Content-Type','application/json','x-cubica-email-worker-secret',v_secret),
    body:='{}'::jsonb,timeout_milliseconds:=90000
  ) into v_request;
  return v_request;
end;
$$;
revoke all on function private.invoke_order_email_worker() from public,anon,authenticated;

select cron.schedule('cubica-order-emails','* * * * *','select private.invoke_order_email_worker();');
commit;
