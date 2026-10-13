-- Administrative MFA enforcement. Every fixture and temporary switch change
-- is contained in this transaction and rolled back.
begin;
do $$
declare
  admin_id uuid:=gen_random_uuid();
  customer_id uuid:=gen_random_uuid();
  status jsonb;
begin
  insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data) values
    (admin_id,'authenticated','authenticated',admin_id::text||'@example.invalid',now(),'{}'),
    (customer_id,'authenticated','authenticated',customer_id::text||'@example.invalid',now(),'{}');
  update public.profiles set role='admin' where id=admin_id;

  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated','aal','aal1')::text,true);
  perform set_config('role','authenticated',true);
  status:=public.get_admin_mfa_status();
  if status->>'is_admin'<>'true' or status->>'enforcement_enabled'<>'true'
    or status->>'access_allowed'<>'false' or (status->>'verified_factor_count')::integer<>0 then
    raise exception 'Enforced AAL1 administrator status is incorrect: %',status;
  end if;
  if private.is_admin() then raise exception 'AAL1 retained administrative authorization'; end if;
  begin
    perform public.get_admin_orders();
    raise exception 'AAL1 called a protected administrative RPC';
  exception when insufficient_privilege then null; end;
  begin perform public.get_order_management(gen_random_uuid()); raise exception 'AAL1 read order management';
  exception when insufficient_privilege then null; end;
  begin perform public.change_order_status(gen_random_uuid(),'Confirmado',0,false,null,'{}'); raise exception 'AAL1 changed an order';
  exception when insufficient_privilege then null; end;
  begin perform public.save_admin_inventory_row('supplies','{}',0,false); raise exception 'AAL1 changed inventory';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_delivery_settings(); raise exception 'AAL1 read delivery settings';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_order_delivery(gen_random_uuid()); raise exception 'AAL1 read private delivery data';
  exception when insufficient_privilege then null; end;
  begin perform public.admin_update_order_delivery(gen_random_uuid(),'{}'); raise exception 'AAL1 changed delivery data';
  exception when insufficient_privilege then null; end;
  begin perform public.get_product_performance(7); raise exception 'AAL1 read administrative analytics';
  exception when insufficient_privilege then null; end;
  begin perform public.get_community_moderation(); raise exception 'AAL1 read moderation data';
  exception when insufficient_privilege then null; end;
  begin perform public.moderate_community_comment(-1,'hidden'); raise exception 'AAL1 moderated Community';
  exception when insufficient_privilege then null; end;
  if exists(select 1 from public.inventory_movements limit 1) then
    raise exception 'AAL1 read protected inventory movements';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname='public'
      and policyname like '%admin%'
      and coalesce(qual,'')||coalesce(with_check,'') not like '%private.is_admin()%'
  ) then raise exception 'An administrative RLS policy bypasses private.is_admin()'; end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated','aal','aal2','amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',extract(epoch from now())::bigint)))::text,true);
  status:=public.get_admin_mfa_status();
  if status->>'access_allowed'<>'true' or status->>'current_level'<>'aal2' or not private.is_admin() then
    raise exception 'AAL2 administrator was not authorized: %',status;
  end if;
  perform public.get_admin_orders();

  perform set_config('request.jwt.claim.sub',customer_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',customer_id,'role','authenticated','aal','aal2')::text,true);
  status:=public.get_admin_mfa_status();
  if status<>jsonb_build_object('is_admin',false) or private.is_admin() then
    raise exception 'Customer gained access with AAL2: %',status;
  end if;
  begin
    perform public.get_admin_orders();
    raise exception 'Customer called protected RPC with AAL2';
  exception when insufficient_privilege then null; end;
  perform set_config('role','none',true);

  create or replace function private.admin_mfa_enforcement_enabled()
  returns boolean language sql stable set search_path='' as $f$ select false; $f$;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated','aal','aal1')::text,true);
  perform set_config('role','authenticated',true);
  if not private.is_admin() then raise exception 'Emergency rollback did not restore role-only admin access'; end if;
  perform set_config('role','none',true);

  if has_function_privilege('anon','public.get_admin_mfa_status()','EXECUTE')
    or not has_function_privilege('authenticated','public.get_admin_mfa_status()','EXECUTE') then
    raise exception 'MFA status RPC grants are incorrect';
  end if;
  if not has_function_privilege('service_role','public.claim_order_email_deliveries(integer)','EXECUTE')
    or has_function_privilege('authenticated','public.claim_order_email_deliveries(integer)','EXECUTE') then
    raise exception 'Worker grants changed';
  end if;
end $$;
select 'Administrative MFA enforcement checks passed' as result;
rollback;

