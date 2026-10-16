-- Defense in depth for an observed production Siteverify replay anomaly.
-- Only salted SHA-256 token hashes are retained, never raw Turnstile tokens.

create table private.turnstile_token_uses (
  token_hash text primary key check (token_hash ~ '^turnstile:[0-9a-f]{64}$'),
  request_id uuid not null,
  purpose text not null check (purpose in ('order','verification')),
  consumed_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp()+interval '15 minutes'),
  check (expires_at>consumed_at and expires_at<=consumed_at+interval '1 hour')
);

alter table private.turnstile_token_uses enable row level security;
revoke all on table private.turnstile_token_uses from public,anon,authenticated,service_role;

create function public.consume_turnstile_token(
  p_token_hash text,
  p_request_id uuid,
  p_purpose text
) returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'order_service_only' using errcode='42501';
  end if;
  if p_token_hash !~ '^turnstile:[0-9a-f]{64}$'
    or p_request_id is null
    or p_purpose not in ('order','verification') then
    raise exception 'order_invalid_turnstile_reservation';
  end if;

  insert into private.turnstile_token_uses(token_hash,request_id,purpose)
  values(p_token_hash,p_request_id,p_purpose)
  on conflict(token_hash) do nothing;
  if not found then
    raise exception 'order_turnstile_replayed';
  end if;
end;
$$;

revoke all on function public.consume_turnstile_token(text,uuid,text)
  from public,anon,authenticated;
grant execute on function public.consume_turnstile_token(text,uuid,text)
  to service_role;

comment on table private.turnstile_token_uses is
  'Short-lived salted hashes of consumed Turnstile tokens. No raw token or Cloudflare credential is stored.';
comment on function public.consume_turnstile_token(text,uuid,text) is
  'Service-only atomic replay barrier used after successful Cloudflare Siteverify validation.';

do $$
declare v_job bigint;
begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    select jobid into v_job from cron.job where jobname='cubica-turnstile-token-cleanup';
    if v_job is not null then perform cron.unschedule(v_job); end if;
    perform cron.schedule(
      'cubica-turnstile-token-cleanup','*/15 * * * *',
      $job$delete from private.turnstile_token_uses where expires_at<now()$job$
    );
  end if;
end;
$$;
