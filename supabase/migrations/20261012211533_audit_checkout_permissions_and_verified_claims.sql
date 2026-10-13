-- Targeted security audit: preserve all rows, existing RLS, RPC signatures and checkout.
-- The browser exclusively calls create_delivery_order. Its private DEFINER owner
-- can still invoke the legacy implementation after these client grants are removed.
revoke execute on function public.create_public_order(text,text,text,text,text,text,jsonb)
 from public, anon, authenticated, service_role;

-- Trigger execution does not require API callers to invoke these functions.
revoke execute on function public.handle_cubica_auth_user() from public, anon, authenticated, service_role;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated, service_role;

-- These administration/DDL privileges are never needed by PostgREST or the workers.
-- Keep SELECT/INSERT/UPDATE/DELETE and column grants unchanged, including admin RLS.
revoke truncate, references, trigger, maintain on table
 public.analytics_events, public.inventory_movements, public.order_email_outbox,
 public.order_items, public.order_material_consumptions, public.order_status_history,
 public.orders, public.product_categories, public.product_colors, public.product_media,
 public.product_recipes, public.products, public.profiles, public.quotes,
 public.supplies, public.supply_categories
 from public, anon, authenticated, service_role;

create or replace function public.claim_my_guest_orders()
returns integer language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); verified_email text; claimed integer;
begin
 if uid is null then raise exception 'Sesión requerida' using errcode='42501'; end if;
 -- JWTs can retain a previous email until refreshed. Read canonical Auth data;
 -- require a verified current email and a current matching JWT before ownership changes.
 select lower(u.email) into verified_email from auth.users u
 where u.id=uid and u.email_confirmed_at is not null
   and not coalesce(u.is_anonymous,false) and u.deleted_at is null
   and (u.banned_until is null or u.banned_until<=now())
   and lower(u.email)=lower(coalesce(auth.jwt()->>'email',''));
 if nullif(verified_email,'') is null then return 0; end if;
 update public.orders set user_id=uid
 where user_id is null and lower(customer_email)=verified_email;
 get diagnostics claimed=row_count;
 return claimed;
end $$;
revoke execute on function public.claim_my_guest_orders() from public, anon, service_role;
grant execute on function public.claim_my_guest_orders() to authenticated;

notify pgrst, 'reload schema';
