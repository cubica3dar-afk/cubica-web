-- Apply only after the production Turnstile site key and secret have been
-- verified end-to-end through create-order. This closes every browser-callable
-- order creation route; the Edge Function keeps its service-only entrypoint.

revoke execute on function public.create_delivery_order(text,text,text,text,text,text,jsonb,jsonb)
  from public, anon, authenticated;
revoke execute on function private.create_delivery_order(text,text,text,text,text,text,jsonb,jsonb)
  from public, anon, authenticated;
revoke execute on function public.create_public_order(text,text,text,text,text,text,jsonb)
  from public, anon, authenticated;

do $$
begin
  if exists(
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private')
      and p.proname in ('create_delivery_order','create_public_order')
      and (
        has_function_privilege('anon',p.oid,'execute')
        or has_function_privilege('authenticated',p.oid,'execute')
      )
  ) then
    raise exception 'A browser-callable order creation overload remained executable';
  end if;

  if has_function_privilege('anon','public.create_verified_delivery_order(text,text,text,text,text,text,jsonb,jsonb,uuid,jsonb)','execute')
    or has_function_privilege('authenticated','public.create_verified_delivery_order(text,text,text,text,text,jsonb,jsonb,uuid,jsonb)','execute')
    or not has_function_privilege('service_role','public.create_verified_delivery_order(text,text,text,text,text,text,jsonb,jsonb,uuid,jsonb)','execute')
    or has_function_privilege('anon','public.lookup_verified_delivery_order(text,text,text,text,text,text,jsonb,jsonb,uuid)','execute')
    or has_function_privilege('authenticated','public.lookup_verified_delivery_order(text,text,text,text,text,text,jsonb,jsonb,uuid)','execute')
    or not has_function_privilege('service_role','public.lookup_verified_delivery_order(text,text,text,text,text,text,jsonb,jsonb,uuid)','execute')
    or has_function_privilege('anon','public.consume_turnstile_token(text,uuid,text)','execute')
    or has_function_privilege('authenticated','public.consume_turnstile_token(text,uuid,text)','execute')
    or not has_function_privilege('service_role','public.consume_turnstile_token(text,uuid,text)','execute') then
    raise exception 'Service-only order protection grants are incorrect';
  end if;
end
$$;

