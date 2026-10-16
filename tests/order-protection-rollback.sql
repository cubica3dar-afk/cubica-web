-- Exercise the emergency rollback grants without changing production.
begin;
revoke execute on function public.create_delivery_order(text,text,text,text,text,text,jsonb,jsonb)
  from public, anon, authenticated;
revoke execute on function private.create_delivery_order(text,text,text,text,text,text,jsonb,jsonb)
  from public, anon, authenticated;

grant execute on function private.create_delivery_order(text,text,text,text,text,text,jsonb,jsonb)
  to anon, authenticated;
grant execute on function public.create_delivery_order(text,text,text,text,text,text,jsonb,jsonb)
  to anon, authenticated;
revoke execute on function public.create_public_order(text,text,text,text,text,text,jsonb)
  from public, anon, authenticated;

do $$
begin
  if not has_function_privilege('anon','public.create_delivery_order(text,text,text,text,text,text,jsonb,jsonb)','execute')
    or not has_function_privilege('authenticated','private.create_delivery_order(text,text,text,text,text,text,jsonb,jsonb)','execute')
    or has_function_privilege('anon','public.create_public_order(text,text,text,text,text,text,jsonb)','execute') then
    raise exception 'Emergency rollback simulation failed';
  end if;
  if has_function_privilege('anon','public.create_verified_delivery_order(text,text,text,text,text,text,jsonb,jsonb,uuid,jsonb)','execute')
    or not has_function_privilege('service_role','public.create_verified_delivery_order(text,text,text,text,text,text,jsonb,jsonb,uuid,jsonb)','execute') then
    raise exception 'Emergency rollback changed the protected service route';
  end if;
end
$$;
select 'Emergency order rollback simulation passed' as result;
rollback;
