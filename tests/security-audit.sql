-- No committed accounts, orders, comments or email deliveries.
begin;
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); adm uuid:=gen_random_uuid();
 old_email text:='old-'||gen_random_uuid()::text||'@example.invalid';
 email_a text:=a::text||'@example.invalid'; email_b text:=b::text||'@example.invalid';
 pid text:='audit-security-'||gen_random_uuid(); oid uuid; old_oid uuid; pending_oid uuid;
 payload jsonb; result jsonb; affected integer; entry record; principal text; privilege text;
begin
 insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data) values
 (a,'authenticated','authenticated',email_a,now(),'{"role":"admin"}'),
 (b,'authenticated','authenticated',email_b,null,'{}'),
 (adm,'authenticated','authenticated',adm::text||'@example.invalid',now(),'{}');
 if (select role from public.profiles where id=a)<>'customer' then raise exception 'User metadata escalates profile role'; end if;
 update public.profiles set role='admin' where id=adm;
 insert into public.products(id,name,price,stock,color_mode) values(pid,'Discardable security fixture',100,10,'single');
 insert into public.product_colors(product_id,name) values(pid,'Blanco');
 insert into public.orders(customer_name,customer_email,total,status) values('Fixture',old_email,100,'Pendiente') returning id into old_oid;
 insert into public.orders(customer_name,customer_email,total,status) values('Fixture',email_b,100,'Pendiente') returning id into pending_oid;
 for entry in select c.oid,n.nspname,c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname in ('private','public') and c.relkind='r' loop
  if not entry.relrowsecurity then raise exception 'Application table without RLS: %.%',entry.nspname,entry.relname; end if;
  foreach principal in array array['anon','authenticated','service_role'] loop
   foreach privilege in array array['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
    if has_table_privilege(principal,entry.oid,privilege) then raise exception 'Excess privilege % on %.% for %',privilege,entry.nspname,entry.relname,principal; end if;
   end loop;
  end loop;
 end loop;
 foreach principal in array array['anon','authenticated','service_role'] loop
  if has_function_privilege(principal,'public.create_public_order(text,text,text,text,text,text,jsonb)','EXECUTE')
   or has_function_privilege(principal,'public.handle_cubica_auth_user()','EXECUTE')
   or has_function_privilege(principal,'public.rls_auto_enable()','EXECUTE') then raise exception 'Legacy/trigger function exposed'; end if;
 end loop;
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims','{"role":"anon"}',true);
 perform set_config('role','anon',true);
 begin
  perform public.create_public_order(pid,'Fixture',email_a,'','Efectivo','',jsonb_build_array(jsonb_build_object('product_id',pid,'qty',1)));
  raise exception 'Legacy endpoint accessible';
 exception when insufficient_privilege then null; end;
 payload:=jsonb_build_object('mode','pickup','request_id',gen_random_uuid(),'quote_token',repeat('c',64));
 begin
  perform public.create_delivery_order(pid,'Fixture',email_a,'1122334455','Efectivo','',jsonb_build_array(jsonb_build_object('product_id',pid,'qty',1,'color','Inventado')),payload);
  raise exception 'Invalid variant accepted';
 exception when others then if sqlerrm='Invalid variant accepted' then raise; end if; end;
 result:=public.create_delivery_order(pid,'Fixture',email_a,'1122334455','Efectivo','',jsonb_build_array(jsonb_build_object('product_id',pid,'qty',2,'color','Blanco','price',1)),payload);
 oid:=(result->>'order_id')::uuid;
 if (result->>'total')::numeric<>200 or (result->>'delivery_total')::numeric<>0 then raise exception 'Server price or pickup amount'; end if;
 if public.create_delivery_order(pid,'Fixture',email_a,'1122334455','Efectivo','',jsonb_build_array(jsonb_build_object('product_id',pid,'qty',2,'color','Blanco','price',1)),payload)->>'order_id'<>oid::text then raise exception 'Duplicate retry'; end if;
 begin perform count(*) from public.orders; raise exception 'Anonymous orders read'; exception when insufficient_privilege then null; end;
 begin perform public.claim_my_guest_orders(); raise exception 'Anonymous claim'; exception when insufficient_privilege then null; end;
 perform set_config('role','none',true);
 perform set_config('request.jwt.claim.sub',a::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated','email',old_email)::text,true);
 perform set_config('role','authenticated',true);
 if public.claim_my_guest_orders()<>0 then raise exception 'Stale email claimed orders'; end if;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated','email',email_a)::text,true);
 if public.claim_my_guest_orders()<>1 or public.claim_my_guest_orders()<>0 then raise exception 'Verified claim or idempotency'; end if;
 if not exists(select 1 from jsonb_array_elements(public.get_customer_orders()) x where x->>'id'=oid::text and x->>'status'='Pedido recibido') then raise exception 'Own orders projection'; end if;
 begin perform status from public.orders where id=oid; raise exception 'Internal status exposed'; exception when insufficient_privilege then null; end;
 update public.profiles set role='admin' where id=a;
 get diagnostics affected=row_count;
 if affected<>0 or private.is_admin() then raise exception 'Customer escalated role'; end if;
 begin perform public.get_admin_orders(); raise exception 'Customer read admin orders'; exception when insufficient_privilege then null; end;
 begin perform public.get_product_performance(7); raise exception 'Customer read admin analytics'; exception when insufficient_privilege then null; end;
 begin perform public.get_order_management(oid); raise exception 'Customer read BOM'; exception when insufficient_privilege then null; end;
 begin insert into public.orders(customer_name,customer_email,total) values('Forbidden',email_a,1); raise exception 'Customer direct order insert'; exception when insufficient_privilege then null; end;
 begin update public.products set price=1 where id=pid; get diagnostics affected=row_count; if affected<>0 then raise exception 'Customer altered product price'; end if; exception when insufficient_privilege then null; end;
 perform public.save_my_buyer_details('Private','Fixture','1122334455');
 perform public.save_my_delivery_address('{"recipient":"Fixture","phone":"1122334455","street":"Fixture","number":"1","city":"Caballito","province":"Ciudad Autónoma de Buenos Aires","postal_code":"1405"}',null,true);
 perform set_config('request.jwt.claim.sub',b::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated','email',email_b)::text,true);
 if public.claim_my_guest_orders()<>0 then raise exception 'Unverified email claimed orders'; end if;
 if public.get_customer_orders()<>'[]'::jsonb or public.list_my_delivery_addresses()<>'[]'::jsonb then raise exception 'Other buyer orders/address leaked'; end if;
 if public.get_my_buyer_details()->>'first_name'<>''
  or exists(select 1 from public.profiles where id=a)
  or exists(select 1 from public.order_items where order_id=oid) then raise exception 'Other buyer details leaked'; end if;
 begin perform count(*) from private.buyer_details; raise exception 'Direct buyer table exposed'; exception when insufficient_privilege then null; end;
 begin perform count(*) from private.product_reactions; raise exception 'Private dislikes exposed'; exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub',adm::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',adm,'role','authenticated','aal','aal2')::text,true);
 if not exists(select 1 from jsonb_array_elements(public.get_admin_orders()) x where x->>'id'=oid::text) then raise exception 'Admin orders broken'; end if;
 perform public.get_order_management(oid);
 perform public.admin_delivery_settings();
 perform set_config('role','none',true);
 if (select user_id from public.orders where id=old_oid) is not null or (select user_id from public.orders where id=pending_oid) is not null then raise exception 'Rejected claims modified ownership'; end if;
 set constraints all immediate;
 if (select count(*) from public.order_email_outbox where order_id=oid)<>2 then raise exception 'Email enqueue broken'; end if;
end $$;
select 'Security rollback checks passed' as result;
rollback;

