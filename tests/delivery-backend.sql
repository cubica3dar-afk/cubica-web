-- Against the deployed schema. All fixtures, settings, orders and outbox entries
-- remain uncommitted and disappear at ROLLBACK; no real customer emails are sent.
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

-- The rest of this transaction exercises the legacy wrapper's delivery rules as
-- a fixture only. These temporary grants disappear with the final ROLLBACK.
grant execute on function private.create_delivery_order(text,text,text,text,text,text,jsonb,jsonb) to anon, authenticated;
grant execute on function public.create_delivery_order(text,text,text,text,text,text,jsonb,jsonb) to anon, authenticated;

do $$
declare
 prefix text:='delivery-qa-'||gen_random_uuid()::text;
 a uuid; b uuid; adm uuid; p1 text; p2 text; p3 text; p4 text; sid text;
 addr jsonb:='{"recipient":"Fixture destinatario","phone":"1122334455","street":"Fixture","number":"123","city":"Caballito","province":"Ciudad Autónoma de Buenos Aires","postal_code":"c1405abc"}';
 items jsonb; logistics_settings jsonb; rates jsonb; prepared jsonb; quoted jsonb; replay jsonb; result jsonb; delivery jsonb; detail jsonb;
 rid uuid:=gen_random_uuid(); rid2 uuid; qid uuid; oid uuid; pickup_id uuid; aid uuid; aid2 uuid; old_quote uuid; recent_quote uuid; referenced_quote uuid;
 token text:=repeat('a',64); v int; wanted_total numeric:=3501.75; old_total numeric;
begin
 a:=gen_random_uuid(); b:=gen_random_uuid(); adm:=gen_random_uuid();
 insert into auth.users(id,aud,role,email,raw_user_meta_data) values
 (a,'authenticated','authenticated',a::text||'@example.invalid','{}'),
 (b,'authenticated','authenticated',b::text||'@example.invalid','{}'),
 (adm,'authenticated','authenticated',adm::text||'@example.invalid','{}');
 update public.profiles set role='admin' where id=adm;
 p1:=prefix||'-p1'; p2:=prefix||'-p2'; p3:=prefix||'-missing'; p4:=prefix||'-variants'; sid:=prefix||'-material';
 insert into public.products(id,name,price,stock,published) values(p1,'Fixture producto A',1000.25,100,true),(p2,'Fixture producto B',250.50,100,true),(p3,'Fixture sin dimensiones',500,100,true);
 insert into public.supplies(id,name,qty,unit) values(sid,'Fixture insumo no consumido',200,'unidades');
 insert into public.product_recipes(product_id,supply_id,qty_per_unit) values(p1,sid,4),(p2,sid,3);
 insert into public.products(id,name,price,stock,color_mode,published) values(p4,'Fixture colores múltiples',100,100,'multiple',true);
 insert into public.product_colors(product_id,name) values(p4,'Blanco'),(p4,'Negro');
 items:=jsonb_build_array(jsonb_build_object('product_id',p1,'qty',2,'price',0,'weight_g',1),jsonb_build_object('product_id',p1,'qty',1),jsonb_build_object('product_id',p2,'qty',2));
 logistics_settings:=jsonb_build_object('origin',jsonb_build_object('street','Origen privado fixture','number','100','city','Caballito','province','Ciudad Autónoma de Buenos Aires','postal_code','1405'),
 'providers','[{"code":"correo_argentino","enabled":true,"margin_percent":10},{"code":"andreani","enabled":true,"margin_percent":8},{"code":"oca","enabled":false,"margin_percent":12}]'::jsonb,
 'products',jsonb_build_array(jsonb_build_object('product_id',p1,'weight_g',100,'length_cm',10,'width_cm',8,'height_cm',5),jsonb_build_object('product_id',p2,'weight_g',50,'length_cm',8,'width_cm',5,'height_cm',2)),
 'boxes','[{"id":"too-small","name":"No cabe","length_cm":20,"width_cm":15,"height_cm":10,"weight_g":100,"max_weight_g":1000,"cost_ars":1,"protection_cost_ars":1,"outer_length_cm":22,"outer_width_cm":17,"outer_height_cm":12},{"id":"fitting","name":"Caja válida","length_cm":20,"width_cm":15,"height_cm":25,"weight_g":100,"max_weight_g":1000,"cost_ars":600,"protection_cost_ars":400,"outer_length_cm":22,"outer_width_cm":17,"outer_height_cm":27},{"id":"expensive","name":"Caja cara","length_cm":30,"width_cm":20,"height_cm":40,"weight_g":200,"max_weight_g":1000,"cost_ars":1600,"protection_cost_ars":400,"outer_length_cm":32,"outer_width_cm":22,"outer_height_cm":42}]'::jsonb);
 update private.delivery_settings ds set settings=logistics_settings;
 if private.delivery_items(jsonb_build_array(jsonb_build_object('product_id',p4,'qty',1,'color','Blanco + Negro')))->0->>'color'<>'Blanco + Negro' then raise exception 'Valid multiple variant rejected'; end if;
 begin perform private.delivery_items(jsonb_build_array(jsonb_build_object('product_id',p4,'qty',1,'color','Blanco + Inventado'))); raise exception 'Invalid multiple variant accepted'; exception when others then if sqlerrm='Invalid multiple variant accepted' then raise; end if; end;
 begin perform private.delivery_items(jsonb_build_array(jsonb_build_object('product_id',p4,'qty',1,'color',''))); raise exception 'Missing multiple variant accepted'; exception when others then if sqlerrm='Missing multiple variant accepted' then raise; end if; end;
 update public.products set color_mode='single' where id=p4;
 begin perform private.delivery_items(jsonb_build_array(jsonb_build_object('product_id',p4,'qty',1,'color','Blanco + Negro'))); raise exception 'Combination accepted for single-color product'; exception when others then if sqlerrm='Combination accepted for single-color product' then raise; end if; end;
 if private.delivery_items(jsonb_build_array(jsonb_build_object('product_id',p4,'qty',1,'color','Negro')))->0->>'color'<>'Negro' then raise exception 'Valid single variant rejected'; end if;

 -- Tables have RLS and no personal/commercial data is directly readable through REST roles.
 for v in select c.oid::int from pg_class c where c.relnamespace='private'::regnamespace and c.relname in ('delivery_addresses','delivery_settings','delivery_quotes','order_deliveries','delivery_history') loop
  if not (select c.relrowsecurity from pg_class c where c.oid=v::oid) then raise exception 'Missing logistics RLS'; end if;
 end loop;
 if exists(select 1 from information_schema.role_table_grants where grantee in ('anon','authenticated','PUBLIC') and table_schema='private' and table_name in ('delivery_addresses','delivery_settings','delivery_quotes','order_deliveries','delivery_history')) then raise exception 'Private table access grant'; end if;
 if has_function_privilege('anon','public.prepare_delivery_quote(jsonb,jsonb,uuid,uuid,text,text)','execute') or has_function_privilege('authenticated','public.finalize_delivery_quote(uuid,uuid,text,jsonb,jsonb)','execute') then raise exception 'Service quote RPC exposed'; end if;

 -- Two addresses, unique default, editing a copy, ownership isolation and deletion.
 perform set_config('request.jwt.claim.sub',a::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
 perform set_config('role','authenticated',true);
 result:=public.save_my_delivery_address(addr,null,false); aid:=(result->>'id')::uuid;
 if not (result->>'is_default')::boolean or result ? 'user_id' then raise exception 'First address default/private payload'; end if;
 result:=public.save_my_delivery_address(addr||'{"label":"Otra dirección","number":"456"}'::jsonb,null,true); aid2:=(result->>'id')::uuid;
 if jsonb_array_length(public.list_my_delivery_addresses())<>2 then raise exception 'Address listing'; end if;
 if (select count(*) from jsonb_array_elements(public.list_my_delivery_addresses()) x where (x->>'is_default')::boolean)<>1 then raise exception 'Duplicate default'; end if;
 perform set_config('request.jwt.claim.sub',b::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated')::text,true);
 if jsonb_array_length(public.list_my_delivery_addresses())<>0 then raise exception 'Other user address leaked'; end if;
 begin perform public.save_my_delivery_address(addr,aid,true); raise exception 'Other user edited address'; exception when insufficient_privilege then null; end;
 perform public.delete_my_delivery_address(aid); -- no-op for somebody else's address
 begin perform public.admin_delivery_settings(); raise exception 'Customer obtained logistics settings'; exception when insufficient_privilege then null; end;
 begin perform public.prepare_delivery_quote(items,addr,rid,a,token,repeat('1',64)); raise exception 'Customer invoked service quote'; exception when insufficient_privilege then null; end;
 begin perform count(*) from private.delivery_addresses; raise exception 'Customer read private addresses directly'; exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub',a::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
 if jsonb_array_length(public.list_my_delivery_addresses())<>2 then raise exception 'Foreign delete removed address'; end if;
 perform public.delete_my_delivery_address(aid2);
 result:=public.list_my_delivery_addresses();
 if jsonb_array_length(result)<>1 or not (result->0->>'is_default')::boolean then raise exception 'Deleting default did not promote remaining'; end if;

 -- Service RPCs snapshot real data, aggregate duplicates and select an actual fitting box.
 perform set_config('role','none',true);
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 prepared:=public.prepare_delivery_quote(items,addr,rid,null,token,repeat('1',64)); qid:=(prepared->>'quote_id')::uuid;
 if (prepared->'package'->>'length_cm')::numeric<>22 or (prepared->'package'->>'width_cm')::numeric<>17 or (prepared->'package'->>'height_cm')::numeric<>27 then raise exception 'Carrier must receive exterior dimensions'; end if;
 if prepared->>'status'<>'preparing' or prepared->'package'->>'box_id'<>'fitting' or (prepared->'package'->>'weight_g')::numeric<>500 then raise exception 'Packaging calculation'; end if;
 if (select dq.items->0->>'qty' from private.delivery_quotes dq where dq.id=qid)<>'3' or (select dq.items->0->>'unit_price' from private.delivery_quotes dq where dq.id=qid)<>'1000.25' then raise exception 'Item aggregation/server price'; end if;
 if (select stock from public.products where id=p1)<>100 or (select qty from public.supplies where id=sid)<>200 then raise exception 'Quote consumed inventory'; end if;
 replay:=public.prepare_delivery_quote(items,addr,rid,null,token,repeat('1',64));
 if replay->>'quote_id'<>prepared->>'quote_id' then raise exception 'Repeated quote duplicated'; end if;
 begin perform public.prepare_delivery_quote(items,addr,rid,null,repeat('b',64),repeat('1',64)); raise exception 'Wrong quote token accepted'; exception when insufficient_privilege then null; end;
 begin perform public.prepare_delivery_quote(items,addr,rid,a,token,repeat('1',64)); raise exception 'Wrong quote owner accepted'; exception when insufficient_privilege then null; end;
 begin perform public.prepare_delivery_quote(items,addr||'{"number":"999"}'::jsonb,rid,null,token,repeat('1',64)); raise exception 'Changed quote address accepted'; exception when insufficient_privilege then null; end;
 rates:=jsonb_build_array(jsonb_build_object('code','correo_argentino','service_code','domicilio','label','Correo domicilio','base_price_ars',7500.50,'valid_until',now()+interval '1 hour','margin_percent',-100,'final_price_ars',0),jsonb_build_object('code','andreani','service_code','domicilio','label','Andreani domicilio','base_price_ars',7900.20),jsonb_build_object('code','oca','service_code','disabled','label','No usar','base_price_ars',1));
 quoted:=public.finalize_delivery_quote(qid,null,token,rates,'[]');
 if quoted->>'status'<>'quoted' or (quoted->>'price')::numeric<>9250.55 or quoted->>'service_label'<>'Correo domicilio' then raise exception 'Decimal tariff/margin/final cheapest selection: %',quoted; end if;
 if (quoted->>'expires_at')::timestamptz>now()+interval '15 minutes' then raise exception 'Provider expiry extended quote lifetime'; end if;
 replay:=public.finalize_delivery_quote(qid,null,token,'[{"code":"correo_argentino","service_code":"cheaper","label":"Manipulado","base_price_ars":1}]','[]');
 if replay->>'price'<>quoted->>'price' then raise exception 'Finalized quote changed on retry'; end if;
 begin perform public.finalize_delivery_quote(qid,null,repeat('b',64),rates,'[]'); raise exception 'Finalized with foreign token'; exception when insufficient_privilege then null; end;
 update private.delivery_settings ds set settings=jsonb_set(ds.settings,'{providers,0,margin_percent}','99');
 replay:=public.prepare_delivery_quote(items,addr,rid,null,token,repeat('1',64));
 if replay->>'price'<>quoted->>'price' then raise exception 'Admin settings changed accepted quote price'; end if;

 -- Guest checkout validates capability, current cart/address/price and expiration.
 perform set_config('request.jwt.claims','{"role":"anon"}',true);
 perform set_config('role','anon',true);
 delivery:=jsonb_build_object('mode','shipping','address',addr,'request_id',rid,'quote_token',token,'price',0);
 begin perform public.create_delivery_order(prefix||'-bad-token','Fixture','fixture@example.invalid','1122334455','Transferencia','',items,jsonb_set(delivery,'{quote_token}',to_jsonb(repeat('b',64)))); raise exception 'Wrong token checked out'; exception when others then if sqlerrm='Wrong token checked out' then raise; end if; end;
 begin perform public.create_delivery_order(prefix||'-bad-address','Fixture','fixture@example.invalid','1122334455','Transferencia','',items,jsonb_set(delivery,'{address,number}','"999"')); raise exception 'Changed address checked out'; exception when others then if sqlerrm='Changed address checked out' then raise; end if; end;
 begin perform public.create_delivery_order(prefix||'-bad-cart','Fixture','fixture@example.invalid','1122334455','Transferencia','',jsonb_build_array(jsonb_build_object('product_id',p1,'qty',1)),delivery); raise exception 'Changed cart checked out'; exception when others then if sqlerrm='Changed cart checked out' then raise; end if; end;
 perform set_config('role','none',true);
 update public.products set price=price+1 where id=p1;
 perform set_config('role','anon',true);
 begin perform public.create_delivery_order(prefix||'-bad-price','Fixture','fixture@example.invalid','1122334455','Transferencia','',items,delivery); raise exception 'Changed server price checked out'; exception when others then if sqlerrm='Changed server price checked out' then raise; end if; end;
 perform set_config('role','none',true);
 update public.products set price=price-1 where id=p1;
 update private.delivery_quotes set expires_at=now()-interval '1 second' where id=qid;
 perform set_config('role','anon',true);
 begin perform public.create_delivery_order(prefix||'-expired','Fixture','fixture@example.invalid','1122334455','Transferencia','',items,delivery); raise exception 'Expired quote checked out'; exception when others then if sqlerrm='Expired quote checked out' then raise; end if; end;
 perform set_config('role','none',true);
 update private.delivery_quotes set expires_at=now()+interval '15 minutes' where id=qid;
 perform set_config('role','anon',true);
 result:=public.create_delivery_order(prefix||'-guest','Fixture','fixture@example.invalid','1122334455','Transferencia','',items,delivery); oid:=(result->>'order_id')::uuid;
 if (result->>'total')::numeric<>wanted_total+9250.55 or (result->>'delivery_total')::numeric<>9250.55 then raise exception 'Server checkout total ignored shipping'; end if;
 replay:=public.create_delivery_order(prefix||'-guest','Fixture','fixture@example.invalid','1122334455','Transferencia','',items,delivery);
 if replay->>'order_id'<>result->>'order_id' or replay->>'total'<>result->>'total' then raise exception 'Checkout retry duplicated order/fee'; end if;
 begin perform public.create_delivery_order(prefix||'-guest','Fixture','fixture@example.invalid','1122334455','Transferencia','changed',items,delivery); raise exception 'Changed retry payload accepted'; exception when insufficient_privilege then null; end;
 begin perform public.finalize_delivery_quote(qid,null,token,rates,'[]'); raise exception 'Guest obtained raw rates'; exception when insufficient_privilege then null; end;
 perform set_config('role','none',true);
 if (select qty from public.supplies where id=sid)<>200 or (select stock from public.products where id=p1)<>97 or (select status from public.orders where id=oid)<>'Pendiente' then raise exception 'Checkout inventory/lifecycle regression'; end if;
 if (select status from private.delivery_quotes where id=qid)<>'used' or (select charged_ars from private.order_deliveries where order_id=oid)<>9250.55 then raise exception 'Quote not consumed exactly once'; end if;
 set constraints all immediate; set constraints all deferred;
 if (select count(*) from public.order_email_outbox where order_id=oid)<>2 then raise exception 'Initial email outbox regression'; end if;
 if (public.get_order_email_snapshot(oid)->'order'->'delivery'->>'charged_ars')::numeric<>9250.55 then raise exception 'Email missing logistics snapshot'; end if;

 -- Missing dimensions and no valid carrier rates are explicit unavailable states.
 rid2:=gen_random_uuid();
 prepared:=public.prepare_delivery_quote(jsonb_build_array(jsonb_build_object('product_id',p3,'qty',1)),addr,rid2,null,token,repeat('2',64));
 if prepared->>'status'<>'needs_configuration' then raise exception 'Missing product dimensions invented a quote'; end if;
 prepared:=public.prepare_delivery_quote(items,addr,gen_random_uuid(),null,token,repeat('2',64));
 replay:=public.finalize_delivery_quote((prepared->>'quote_id')::uuid,null,token,'[]','[]');
 if replay->>'status'<>'unavailable' or replay->>'price' is not null then raise exception 'Unavailable providers produced a price'; end if;
 -- Global quote abuse controls are persistent per rate bucket.
 for v in 1..10 loop
  perform public.prepare_delivery_quote(items,addr,gen_random_uuid(),null,token,repeat('3',64));
 end loop;
 begin
  perform public.prepare_delivery_quote(items,addr,gen_random_uuid(),null,token,repeat('3',64));
  raise exception 'Rate limit did not reject request 11';
 exception when others then
  if sqlerrm<>'Demasiadas cotizaciones. Esperá unos minutos.' then raise; end if;
 end;

 -- A quote issued to an authenticated customer cannot be consumed as guest or by another account.
 update private.delivery_settings ds set settings=logistics_settings;
 rid2:=gen_random_uuid();
 prepared:=public.prepare_delivery_quote(items,addr,rid2,a,repeat('c',64),repeat('4',64));
 quoted:=public.finalize_delivery_quote((prepared->>'quote_id')::uuid,a,repeat('c',64),rates,'[]');
 delivery:=jsonb_build_object('mode','shipping','address',addr,'request_id',rid2,'quote_token',repeat('c',64));
 perform set_config('request.jwt.claim.sub',b::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated')::text,true);
 perform set_config('role','authenticated',true);
 begin perform public.create_delivery_order(prefix||'-foreign-auth','Fixture','fixture@example.invalid','1122334455','Transferencia','',items,delivery); raise exception 'Other account consumed authenticated quote'; exception when others then if sqlerrm='Other account consumed authenticated quote' then raise; end if; end;
 perform set_config('role','none',true);
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims','{"role":"anon"}',true);
 perform set_config('role','anon',true);
 begin perform public.create_delivery_order(prefix||'-foreign-guest','Fixture','fixture@example.invalid','1122334455','Transferencia','',items,delivery); raise exception 'Guest consumed authenticated quote'; exception when others then if sqlerrm='Guest consumed authenticated quote' then raise; end if; end;
 perform set_config('role','none',true);
 perform set_config('request.jwt.claim.sub',a::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
 perform set_config('role','authenticated',true);
 result:=public.create_delivery_order(prefix||'-auth-shipping','Fixture','fixture@example.invalid','1122334455','Transferencia','',items,delivery);
 if (result->>'total')::numeric<>wanted_total+9250.55 then raise exception 'Authenticated shipping checkout'; end if;

 -- Authenticated pickup costs zero, needs no address, and returns only own logistics.
 perform set_config('request.jwt.claim.sub',a::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
 perform set_config('role','authenticated',true);
 delivery:=jsonb_build_object('mode','pickup','request_id',gen_random_uuid(),'quote_token',token,'price',99999,'packaging_cost_ars',99999);
 begin perform public.create_delivery_order(prefix||'-bad-pickup-phone','Fixture','fixture@example.invalid','abcdefgh','Efectivo','',jsonb_build_array(jsonb_build_object('product_id',p1,'qty',1)),delivery); raise exception 'Pickup accepted a nondigit phone'; exception when others then if sqlerrm='Pickup accepted a nondigit phone' then raise; end if; end;
 begin perform public.create_delivery_order(prefix||'-long-pickup-phone','Fixture','fixture@example.invalid','1234567890123456','Efectivo','',jsonb_build_array(jsonb_build_object('product_id',p1,'qty',1)),delivery); raise exception 'Pickup accepted >15 digits'; exception when others then if sqlerrm='Pickup accepted >15 digits' then raise; end if; end;
 result:=public.create_delivery_order(prefix||'-pickup','Fixture','fixture@example.invalid','1122334455','Efectivo','',jsonb_build_array(jsonb_build_object('product_id',p1,'qty',1)),delivery); pickup_id:=(result->>'order_id')::uuid;
 if (result->>'total')::numeric<>1000.25 or (result->>'delivery_total')::numeric<>0 then raise exception 'Pickup charged shipping or packaging'; end if;
 detail:=public.get_customer_orders();
 if not exists(select 1 from jsonb_array_elements(detail) x where x->>'id'=pickup_id::text and x->'delivery'->>'mode'='pickup' and x->>'status'='Pedido recibido') then raise exception 'Customer logistics/status missing'; end if;
 if detail::text like '%base_price_ars%' or detail::text like '%margin_percent%' or detail::text like '%Origen privado fixture%' then raise exception 'Customer received internal costs or origin'; end if;
 perform set_config('request.jwt.claim.sub',b::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated')::text,true);
 if exists(select 1 from jsonb_array_elements(public.get_customer_orders()) x where x->>'id'=pickup_id::text) then raise exception 'Other customer saw delivery'; end if;
 begin perform public.create_delivery_order(prefix||'-pickup','Fixture','fixture@example.invalid','1122334455','Efectivo','',jsonb_build_array(jsonb_build_object('product_id',p1,'qty',1)),delivery); raise exception 'Other customer replayed order'; exception when insufficient_privilege then null; end;

 -- Admin tracking and actual cost do not mutate agreed total or production status.
 perform set_config('request.jwt.claim.sub',adm::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',adm,'role','authenticated','aal','aal2')::text,true);
 detail:=public.admin_update_order_delivery(oid,'{"logistics_status":"dispatched","actual_cost_ars":9500.55,"tracking_code":"QA-ROLLBACK","tracking_url":"https://example.invalid/track"}');
 if (detail->>'difference_ars')::numeric<>-250 then raise exception 'Cost difference calculation'; end if;
 if jsonb_array_length(detail->'history')<>1 then raise exception 'Tracking history missing'; end if;
 perform public.admin_update_order_delivery(oid,'{"logistics_status":"dispatched","actual_cost_ars":9500.55,"tracking_code":"QA-ROLLBACK","tracking_url":"https://example.invalid/track"}');
 if jsonb_array_length(public.admin_order_delivery(oid)->'history')<>1 then raise exception 'Tracking retry duplicated history'; end if;
 begin perform public.admin_update_order_delivery(pickup_id,'{"logistics_status":"dispatched","actual_cost_ars":500}'); raise exception 'Pickup accepted transport events/cost'; exception when others then if sqlerrm='Pickup accepted transport events/cost' then raise; end if; end;
 begin perform public.admin_update_order_delivery(oid,'{"tracking_url":"javascript:alert(1)"}'); raise exception 'Unsafe tracking accepted'; exception when others then if sqlerrm='Unsafe tracking accepted' then raise; end if; end;
 perform set_config('role','none',true);
 if (select total from public.orders where id=oid)<>wanted_total+9250.55 or (select status from public.orders where id=oid)<>'Pendiente' then raise exception 'Logistics modified agreed price/production'; end if;
 if (select count(*) from public.orders where client_order_id=prefix||'-guest')<>1 or (select count(*) from private.order_deliveries where order_id=oid)<>1 then raise exception 'Order duplication'; end if;
 -- Retention was explicitly authorized: discard only long-expired unattached quotes.
 prepared:=public.prepare_delivery_quote(items,addr,gen_random_uuid(),null,token,repeat('5',64)); old_quote:=(prepared->>'quote_id')::uuid;
 prepared:=public.prepare_delivery_quote(items,addr,gen_random_uuid(),null,token,repeat('5',64)); recent_quote:=(prepared->>'quote_id')::uuid;
 prepared:=public.prepare_delivery_quote(items,addr,gen_random_uuid(),null,token,repeat('5',64)); referenced_quote:=(prepared->>'quote_id')::uuid;
 update private.delivery_quotes set expires_at=now()-interval '3 days' where id in (old_quote,referenced_quote,qid);
 update private.delivery_quotes set expires_at=now()-interval '1 day' where id=recent_quote;
 -- Structural guard: even if quote.order_id/status are inconsistent, a delivery reference protects it.
 update private.order_deliveries set quote_id=referenced_quote where order_id=pickup_id;
 if has_function_privilege('anon','private.cleanup_delivery_quotes()','execute') or has_function_privilege('authenticated','private.cleanup_delivery_quotes()','execute') then raise exception 'Retention cleanup exposed'; end if;
 perform private.cleanup_delivery_quotes();
 if exists(select 1 from private.delivery_quotes where id=old_quote) then raise exception 'Old abandoned quote not cleaned'; end if;
 if not exists(select 1 from private.delivery_quotes where id=recent_quote) then raise exception 'Recent expired quote prematurely deleted'; end if;
 if not exists(select 1 from private.delivery_quotes where id=qid and status='used' and order_id=oid) then raise exception 'Used quote/order snapshot deleted'; end if;
 if not exists(select 1 from private.delivery_quotes where id=referenced_quote) then raise exception 'Quote referenced by delivery deleted'; end if;
 if (select total from public.orders where id=oid)<>wanted_total+9250.55 then raise exception 'Retention touched order total'; end if;
end $$;
select 'delivery backend rollback QA passed' as result;
rollback;

