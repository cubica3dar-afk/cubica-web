-- Prove the future activation closes every direct order RPC without changing
-- production: all grants are rolled back at the end of this transaction.
begin;
revoke execute on function public.create_delivery_order(text,text,text,text,text,text,jsonb,jsonb)
  from public, anon, authenticated;
revoke execute on function private.create_delivery_order(text,text,text,text,text,text,jsonb,jsonb)
  from public, anon, authenticated;
revoke execute on function public.create_public_order(text,text,text,text,text,text,jsonb)
  from public, anon, authenticated;

do $$
begin
  if has_function_privilege('anon','public.create_delivery_order(text,text,text,text,text,text,jsonb,jsonb)','execute')
    or has_function_privilege('authenticated','public.create_delivery_order(text,text,text,text,text,text,jsonb,jsonb)','execute')
    or has_function_privilege('anon','private.create_delivery_order(text,text,text,text,text,text,jsonb,jsonb)','execute')
    or has_function_privilege('authenticated','private.create_delivery_order(text,text,text,text,text,text,jsonb,jsonb)','execute')
    or has_function_privilege('anon','public.create_public_order(text,text,text,text,text,text,jsonb)','execute') then
    raise exception 'A direct checkout route remained executable';
  end if;
  if has_function_privilege('anon','public.create_verified_delivery_order(text,text,text,text,text,text,jsonb,jsonb,uuid,jsonb)','execute')
    or has_function_privilege('authenticated','public.create_verified_delivery_order(text,text,text,text,text,text,jsonb,jsonb,uuid,jsonb)','execute')
    or not has_function_privilege('service_role','public.create_verified_delivery_order(text,text,text,text,text,text,jsonb,jsonb,uuid,jsonb)','execute') then
    raise exception 'Protected checkout grants changed during activation';
  end if;
end $$;
select 'Order protection activation closes direct API bypasses' as result;
rollback;


