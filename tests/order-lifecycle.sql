-- Run against the actual migrated database. No fixture or email becomes committed.
begin;
do $$
begin
 if has_function_privilege('anon','public.create_delivery_order(text,text,text,text,text,text,jsonb,jsonb)','execute')
   or has_function_privilege('authenticated','public.create_delivery_order(text,text,text,text,text,text,jsonb,jsonb)','execute')
   or has_function_privilege('anon','private.create_delivery_order(text,text,text,text,text,text,jsonb,jsonb)','execute')
   or has_function_privilege('authenticated','private.create_delivery_order(text,text,text,text,text,text,jsonb,jsonb)','execute') then
  raise exception 'Legacy delivery checkout is still browser-callable';
 end if;
end
$$;

-- The guest-order fixture below exercises lifecycle compatibility through the
-- legacy wrapper. Its temporary grants are contained by this transaction.
grant execute on function private.create_delivery_order(text,text,text,text,text,text,jsonb,jsonb) to anon, authenticated;
grant execute on function public.create_delivery_order(text,text,text,text,text,text,jsonb,jsonb) to anon, authenticated;

do $$
declare admin_id uuid; customer_id uuid; prefix text:='lifecycle-test-'||gen_random_uuid()::text;
 p1 text; p2 text; p3 text; s1 text; s2 text; oid uuid; short_id uuid; missing_id uuid; cancelled_id uuid;
 result jsonb; snapshot jsonb; initial_customer_count integer; item1 bigint; item2 bigint; v integer;
begin
 admin_id:=gen_random_uuid();
 insert into auth.users(id,aud,role,email,raw_user_meta_data)
 values(admin_id,'authenticated','authenticated',admin_id::text||'@example.invalid','{}');
 update public.profiles set role='admin' where id=admin_id;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated','aal','aal2')::text,true);
 p1:=prefix||'-p1';p2:=prefix||'-p2';p3:=prefix||'-p3';s1:=prefix||'-s1';s2:=prefix||'-s2';
 insert into public.products(id,name,price,stock,published) values(p1,'Fixture estándar',100,100,true),(p2,'Fixture personalizada',200,100,true),(p3,'Fixture sin receta',100,10,true);
 insert into public.supplies(id,name,qty,unit) values(s1,'Fixture PLA',100,'gramos'),(s2,'Fixture LED',5,'unidades');
 insert into public.product_recipes(product_id,supply_id,qty_per_unit) values(p1,s1,10),(p2,s1,5);
 result:=public.create_public_order(prefix,'Fixture','fixture@example.invalid','','Efectivo','',jsonb_build_array(jsonb_build_object('product_id',p1,'qty',2),jsonb_build_object('product_id',p2,'qty',3)));
 oid:=(result->>'order_id')::uuid;
 if (select qty from public.supplies where id=s1)<>100 then raise exception 'New order consumed materials'; end if;
 -- Flush the deferred initial-email trigger after items exist; outbox is still rolled back.
 set constraints all immediate;
 set constraints all deferred;
 if (select count(*) from public.order_email_outbox where order_id=oid and kind in ('customer','internal'))<>2 then raise exception 'Initial outbox regression'; end if;
 perform public.change_order_status(oid,'Confirmado',0);
 begin
  perform public.change_order_status(oid,'En producción',0);
  raise exception 'Stale version accepted';
 exception when others then if sqlerrm='Stale version accepted' then raise; end if; end;
 begin
  update public.orders set status='Preparado' where id=oid;
  raise exception 'Direct status bypass';
 exception when others then if sqlerrm='Direct status bypass' then raise; end if; end;
 if (select qty from public.supplies where id=s1)<>100 then raise exception 'Confirmed consumed'; end if;
 if exists(select 1 from public.order_email_outbox where order_id=oid and kind='ready') then raise exception 'Confirmed queued ready'; end if;
 snapshot:=public.get_order_management(oid);
 if (snapshot->'plan'->'supplies'->0->>'required')::numeric<>35 then raise exception 'Shared BOM aggregation'; end if;
 perform public.change_order_status(oid,'En producción',1);
 if (select qty from public.supplies where id=s1)<>65 then raise exception 'Incorrect consumption'; end if;
 if exists(select 1 from public.order_email_outbox where order_id=oid and kind='ready') then raise exception 'Production queued ready'; end if;
 perform public.change_order_status(oid,'En producción',1); -- Retries, even old version, are a no-op.
 perform public.change_order_status(oid,'Pendiente',2);
 perform public.change_order_status(oid,'Confirmado',3);
 perform public.change_order_status(oid,'En producción',4);
 if (select qty from public.supplies where id=s1)<>65 or (select count(*) from public.inventory_movements where order_id=oid and reason='production')<>1 then raise exception 'Double consumption'; end if;
 perform public.change_order_status(oid,'Preparado',5);
 perform public.change_order_status(oid,'En producción',6);
 perform public.change_order_status(oid,'Preparado',7);
 if (select count(*) from public.order_email_outbox where order_id=oid and kind='ready')<>1 then raise exception 'Duplicate ready email'; end if;
 -- A ready delivery must not overwrite the initial customer's delivery flag.
 update public.order_email_outbox set status='processing',lock_token=gen_random_uuid(),attempts=1,locked_until=now()+interval '5 minutes' where order_id=oid and kind='ready';
 perform public.finish_order_email_delivery(oid,'ready',(select lock_token from public.order_email_outbox where order_id=oid and kind='ready'),true,'fixture-provider-id',null,false);
 if not (select ready_email_sent from public.orders where id=oid) or (select customer_email_sent from public.orders where id=oid) then raise exception 'Ready flag contaminated initial delivery'; end if;
 select id into item1 from public.order_items where order_id=oid and product_id=p1;
 select id into item2 from public.order_items where order_id=oid and product_id=p2;
 perform public.change_order_status(oid,'Cancelado',8,false,null,jsonb_build_array(
  jsonb_build_object('item_id',item1,'disposition','finished_standard','qty',2),
  jsonb_build_object('item_id',item2,'disposition','finished_personalized','qty',3)));
 perform public.change_order_status(oid,'Cancelado',8,false,null,'[]');
 if (select qty from public.supplies where id=s1)<>65 then raise exception 'Cancellation returned materials'; end if;
 if (select stock from public.products where id=p1)<>100 or (select stock from public.products where id=p2)<>97 then raise exception 'Cancellation stock classification'; end if;
 if (select count(*) from public.inventory_movements where order_id=oid and reason='cancelled_finished')<>1 then raise exception 'Duplicate cancellation stock'; end if;
 if (select count(*) from public.order_status_history where order_id=oid)<>9 then raise exception 'History mismatch'; end if;

 insert into public.product_recipes(product_id,supply_id,qty_per_unit) values(p1,s2,10);
 result:=public.create_public_order(prefix||'-short','Fixture','fixture@example.invalid','','Efectivo','',jsonb_build_array(jsonb_build_object('product_id',p1,'qty',2)));
 short_id:=(result->>'order_id')::uuid;
 perform public.change_order_status(short_id,'Confirmado',0);
 result:=public.change_order_status(short_id,'En producción',1);
 if result->>'confirmation_required'<>'true' or exists(select 1 from public.order_material_consumptions where order_id=short_id) or (select qty from public.supplies where id=s2)<>5 then raise exception 'Warning mutated stock'; end if;
 result:=public.change_order_status(short_id,'En producción',1,true,'forged');
 if result->>'confirmation_required'<>'true' then raise exception 'Changed/forged plan accepted'; end if;
 perform public.change_order_status(short_id,'En producción',1,true,result->>'fingerprint');
 if (select qty from public.supplies where id=s2)<>0 or (select deficit from public.inventory_movements where order_id=short_id and supply_id=s2)<>15 then raise exception 'Shortage not traced'; end if;
 if (select required from public.inventory_movements where order_id=short_id and supply_id=s2)<>20 then raise exception 'Full requirements lost'; end if;
 select id into item1 from public.order_items where order_id=short_id;
 perform public.change_order_status(short_id,'Cancelado',2,false,null,jsonb_build_array(jsonb_build_object('item_id',item1,'disposition','unfinished','qty',0)));
 if exists(select 1 from public.inventory_movements where order_id=short_id and reason='cancelled_finished') then raise exception 'Unfinished piece stocked'; end if;

 result:=public.create_public_order(prefix||'-missing','Fixture','fixture@example.invalid','','Transferencia','',jsonb_build_array(jsonb_build_object('product_id',p3,'qty',1)));
 missing_id:=(result->>'order_id')::uuid;
 perform public.change_order_status(missing_id,'Confirmado',0);
 result:=public.change_order_status(missing_id,'En producción',1);
 if result->>'confirmation_required'<>'true' or (result->'plan'->'products'->0->>'recipe_missing')::boolean is not true then raise exception 'Absent recipe treated as shortage'; end if;
 perform public.change_order_status(missing_id,'En producción',1,true,result->>'fingerprint');
 if exists(select 1 from public.inventory_movements where order_id=missing_id and reason='production') then raise exception 'Invented recipe usage'; end if;
 perform public.change_order_status(missing_id,'Preparado',2);
 if not exists(select 1 from jsonb_array_elements(public.get_customer_orders()) o where o->>'id'=missing_id::text and o->>'status'='Listo para entregar') then raise exception 'Prepared customer mapping'; end if;
 perform public.change_order_status(missing_id,'Entregado',3);
 if not exists(select 1 from jsonb_array_elements(public.get_customer_orders()) o where o->>'id'=missing_id::text and o->>'status'='Entregado') then raise exception 'Delivered customer mapping'; end if;
 result:=public.create_public_order(prefix||'-cancel','Fixture','fixture@example.invalid','','Efectivo','',jsonb_build_array(jsonb_build_object('product_id',p3,'qty',1)));
 cancelled_id:=(result->>'order_id')::uuid;
 select id into item1 from public.order_items where order_id=cancelled_id;
 begin
  perform public.change_order_status(cancelled_id,'Cancelado',0,false,null,jsonb_build_array(jsonb_build_object('item_id',item1,'disposition','finished_standard','qty',1)));
  raise exception 'Premature finished stock accepted';
 exception when others then if sqlerrm='Premature finished stock accepted' then raise; end if; end;
 perform public.change_order_status(cancelled_id,'Cancelado',0,false,null,jsonb_build_array(jsonb_build_object('item_id',item1,'disposition','unfinished','qty',0)));
 if exists(select 1 from public.order_material_consumptions where order_id=cancelled_id) then raise exception 'Early cancellation consumed'; end if;

 -- Customer projection and actual authenticated-role permissions.
 perform set_config('role','authenticated',true);
 snapshot:=public.get_customer_orders();
 if exists(select 1 from jsonb_array_elements(snapshot) o where o ? 'supply_plan' or o ? 'production_started_at'
  or o->>'status' not in ('Pedido recibido','Listo para entregar','Entregado','Cancelado')) then raise exception 'Internal customer data exposed'; end if;
 if has_column_privilege('authenticated','public.orders','status','SELECT') or has_column_privilege('authenticated','public.orders','supply_plan','SELECT') then raise exception 'Sensitive REST projection exposed'; end if;
 if not has_column_privilege('authenticated','public.orders','id','SELECT') then raise exception 'Safe order access broken'; end if;
 -- Admin reads via RPC still work after restricted column grants.
 perform public.get_admin_orders();
 perform set_config('role','none',true);

 customer_id:=gen_random_uuid();
 insert into auth.users(id,aud,role,email,raw_user_meta_data)
 values(customer_id,'authenticated','authenticated',customer_id::text||'@example.invalid','{}');
 if customer_id is not null then
  perform set_config('request.jwt.claim.sub',customer_id::text,true);
  begin
   perform public.change_order_status(missing_id,'Preparado',2);
   raise exception 'Customer changed status';
  exception when insufficient_privilege then null; end;
 end if;
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims','{}',true);
 begin
  perform public.get_order_management(oid);
  raise exception 'Anonymous admin read';
 exception when insufficient_privilege then null; end;
 if public.get_customer_orders()<>'[]'::jsonb then raise exception 'Anonymous order exposure'; end if;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated','aal','aal2')::text,true);
 -- Explicit stale writes cannot restore consumed stock; metadata edits preserve it.
 snapshot:=(select to_jsonb(s) from public.supplies s where id=s1);
 perform public.save_admin_inventory_row('supplies',snapshot||jsonb_build_object('qty',999,'name','Fixture renamed'),100,false);
 if (select qty from public.supplies where id=s1)<>45 then raise exception 'Metadata edit restored stock'; end if;
 begin
  perform public.save_admin_inventory_row('supplies',snapshot||jsonb_build_object('qty',101),100,true);
  raise exception 'Stale stock accepted';
 exception when others then if sqlerrm='Stale stock accepted' then raise; end if; end;
 -- Guest checkout is still executable with the real anonymous database role.
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims','{}',true);
 perform set_config('role','anon',true);
 result:=public.create_delivery_order(prefix||'-guest','Fixture guest','guest@example.invalid','1122334455','Efectivo','',jsonb_build_array(jsonb_build_object('product_id',p3,'qty',1)),jsonb_build_object('mode','pickup','request_id',gen_random_uuid(),'quote_token',repeat('a',64)));
 perform set_config('role','none',true);
 if (select user_id from public.orders where id=(result->>'order_id')::uuid) is not null then raise exception 'Guest checkout identity'; end if;
 if (select qty from public.supplies where id=s1)<>45 then raise exception 'Guest checkout consumed supplies'; end if;
 raise notice 'Lifecycle rollback scenarios passed';
end;
$$;
rollback;

