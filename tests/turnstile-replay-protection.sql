begin;

do $$
declare
  v_hash text:='turnstile:'||repeat('a',64);
  v_other uuid:='11111111-1111-4111-8111-111111111111';
begin
  if not (select relrowsecurity from pg_class where oid='private.turnstile_token_uses'::regclass) then
    raise exception 'RLS is not enabled';
  end if;
  if exists(
    select 1 from information_schema.role_table_grants
    where table_schema='private' and table_name='turnstile_token_uses'
      and grantee in ('PUBLIC','anon','authenticated','service_role')
  ) then raise exception 'Replay ledger has direct grants'; end if;
  if has_function_privilege('anon','public.consume_turnstile_token(text,uuid,text)','execute')
    or has_function_privilege('authenticated','public.consume_turnstile_token(text,uuid,text)','execute')
    or not has_function_privilege('service_role','public.consume_turnstile_token(text,uuid,text)','execute') then
    raise exception 'Replay RPC grants are incorrect';
  end if;

  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform public.consume_turnstile_token(v_hash,'00000000-0000-4000-8000-000000000001','order');
  begin
    perform public.consume_turnstile_token(v_hash,v_other,'order');
    raise exception 'Replay was accepted';
  exception when others then
    if sqlerrm<>'order_turnstile_replayed' then raise; end if;
  end;
  if (select count(*) from private.turnstile_token_uses where token_hash=v_hash)<>1 then
    raise exception 'Replay ledger lost uniqueness';
  end if;
  if exists(select 1 from private.turnstile_token_uses where token_hash=v_hash and token_hash not like 'turnstile:%') then
    raise exception 'Unexpected token representation';
  end if;
end;
$$;

rollback;
