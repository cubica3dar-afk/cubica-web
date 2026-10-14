-- Apply only after the production Turnstile site key and secret have been
-- verified end-to-end through create-order. This closes every browser-callable
-- order creation route; the Edge Function keeps its service-only entrypoint.

revoke execute on function public.create_delivery_order(text,text,text,text,text,text,jsonb,jsonb)
  from public, anon, authenticated;
revoke execute on function private.create_delivery_order(text,text,text,text,text,text,jsonb,jsonb)
  from public, anon, authenticated;
revoke execute on function public.create_public_order(text,text,text,text,text,text,jsonb)
  from public, anon, authenticated;


