-- Emergency checkout rollback. This reopens only the previously used delivery
-- wrapper. It does not expose create_public_order. Use after an access incident
-- and restore Turnstile enforcement as soon as the Edge path is healthy.

grant execute on function private.create_delivery_order(text,text,text,text,text,text,jsonb,jsonb)
  to anon, authenticated;
grant execute on function public.create_delivery_order(text,text,text,text,text,text,jsonb,jsonb)
  to anon, authenticated;
revoke execute on function public.create_public_order(text,text,text,text,text,text,jsonb)
  from public, anon, authenticated;


