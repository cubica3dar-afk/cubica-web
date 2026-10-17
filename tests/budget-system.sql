-- Transactional, disposable QA for the integral budget system.
begin;
do $$
declare admin_id uuid:=gen_random_uuid(); customer_id uuid:=gen_random_uuid(); filament text; extra text;
  request_id uuid:=gen_random_uuid(); q jsonb; q2 jsonb; emitted jsonb; accepted jsonb; converted jsonb;
  v_quote_id text; v_quote2_id text; v_order_id uuid; v_product_id text; plan jsonb; lifecycle jsonb; email_count integer; movement_count integer;
  input jsonb;
begin
 insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data) values
  (admin_id,'authenticated','authenticated',admin_id::text||'@example.invalid',now(),'{}'),
  (customer_id,'authenticated','authenticated',customer_id::text||'@example.invalid',now(),'{}');
 update public.profiles set role='admin' where id=admin_id;
 insert into public.supplies(name,category,cost,qty,unit,active) values
  ('PLA QA presupuesto','Filamentos',20000,10000,'gramos',true),('LED QA presupuesto','Electrónica',100,100,'unidades',true);
 select id into filament from public.supplies where name='PLA QA presupuesto';
 select id into extra from public.supplies where name='LED QA presupuesto';
 input:=jsonb_build_object('title','Lámpara QA','customer',jsonb_build_object('name','Cliente QA','email','cliente@example.invalid','phone','1111','reference','QA'),
  'items',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'title','Lámpara personalizada','description','Descripción comercial','quantity',2,'color','Blanco','material_id',filament,'weight_g',50,'print_hours',2,'printer_watts',150,'electricity_ars_kwh',130,'machine_ars_hour',1500,'failure_pct',10,'production_margin_pct',50,'supplies_margin_pct',50,'supplies',jsonb_build_array(jsonb_build_object('supply_id',extra,'quantity',2)),'customer_notes','Sin información privada','internal_notes','Solo administración')),
  'manufacturing_time','10 días','valid_until',(current_date+15)::text,'payment_terms','50% anticipo','delivery_terms','Retiro coordinado','commercial_notes','Presupuesto comercial','internal_notes','Costo privado');

 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated','aal','aal1')::text,true);
 begin perform public.save_admin_quote_draft(input,null,null,request_id,null); raise exception 'AAL1 saved a quote'; exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated','aal','aal2')::text,true);
 q:=public.save_admin_quote_draft(input,null,null,request_id,null); v_quote_id:=q->>'id';
 if q->>'status'<>'draft' or (q->>'total')::numeric<=0 then raise exception 'Draft calculation failed'; end if;
 q2:=public.save_admin_quote_draft(input,v_quote_id,(q->>'updated_at')::timestamptz,request_id,null);
 if q2->>'id'<>v_quote_id or (select count(*) from public.quotes where id=v_quote_id)<>1 then raise exception 'Draft idempotency failed'; end if;
 email_count:=(select count(*) from public.quote_email_outbox);
 emitted:=public.emit_admin_quote(v_quote_id,(q->>'updated_at')::timestamptz,gen_random_uuid());
 if emitted->>'status'<>'issued' or (emitted->>'current_version')::integer<>1 then raise exception 'Emission failed'; end if;
 if (select count(*) from public.quote_email_outbox)<>email_count+1 then raise exception 'Emission did not enqueue exactly one internal email'; end if;
 if (select commercial_snapshot::text from public.quote_versions where quote_id=v_quote_id) ~* 'material_cost|machine_cost|margin|internal|electricity' then raise exception 'Commercial snapshot leaks private calculation'; end if;
 begin perform public.save_admin_quote_draft(input,v_quote_id,(emitted->>'updated_at')::timestamptz,gen_random_uuid(),null); raise exception 'Issued quote edited in place'; exception when others then if sqlerrm='Issued quote edited in place' then raise; end if; end;
 accepted:=public.set_admin_quote_status(v_quote_id,'accepted',(emitted->>'updated_at')::timestamptz,gen_random_uuid());
 movement_count:=(select count(*) from public.inventory_movements);
 converted:=public.convert_admin_quote_to_order(v_quote_id,gen_random_uuid());v_order_id:=(converted->>'order_id')::uuid;
 if (select origin from public.orders where id=v_order_id)<>'budget' or (select commercial_status from public.orders where id=v_order_id)<>'accepted_unpaid' then raise exception 'Internal order classification failed'; end if;
 set constraints all immediate; set constraints all deferred;
 if exists(select 1 from public.order_email_outbox where order_id=v_order_id) then raise exception 'Budget order enqueued an order email'; end if;
 if (select count(*) from public.inventory_movements)<>movement_count or exists(select 1 from public.order_material_consumptions where order_id=v_order_id) then raise exception 'Conversion moved inventory or consumed BOM'; end if;
 plan:=private.order_material_plan(v_order_id);
 if jsonb_array_length(plan->'supplies')<>2 then raise exception 'Frozen recipe was not available to production'; end if;
 lifecycle:=public.change_order_status(v_order_id,'Confirmado',0,false,null,'[]'::jsonb);
 lifecycle:=public.change_order_status(v_order_id,'En producción',1,false,null,'[]'::jsonb);
 if lifecycle ? 'confirmation_required' then raise exception 'Funded frozen recipe unexpectedly required a warning'; end if;
 lifecycle:=public.change_order_status(v_order_id,'Preparado',2,false,null,'[]'::jsonb);
 set constraints all immediate; set constraints all deferred;
 if exists(select 1 from public.order_email_outbox where order_id=v_order_id) then raise exception 'Prepared budget order enqueued a ready email'; end if;
 if (select count(*) from public.order_material_consumptions where order_id=v_order_id)<>1 then raise exception 'Budget order did not consume its frozen recipe exactly once'; end if;
 perform set_config('request.jwt.claim.sub',customer_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',customer_id,'role','authenticated','aal','aal2','email','cliente@example.invalid')::text,true);
 if public.claim_my_guest_orders()<>0 or public.get_customer_orders()<>'[]'::jsonb then raise exception 'Internal order leaked or was claimed'; end if;

 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated','aal','aal2')::text,true);
 movement_count:=(select count(*) from public.inventory_movements);
 q:=public.save_admin_quote_draft(input||jsonb_build_object('title','Producto QA'),null,null,gen_random_uuid(),null);v_quote2_id:=q->>'id';
 emitted:=public.emit_admin_quote(v_quote2_id,(q->>'updated_at')::timestamptz,gen_random_uuid());
 accepted:=public.set_admin_quote_status(v_quote2_id,'accepted',(emitted->>'updated_at')::timestamptz,gen_random_uuid());
 converted:=public.convert_admin_quote_to_product(v_quote2_id,'Producto oculto QA','Descripción',null,jsonb_build_array(jsonb_build_object('supply_id',filament,'qty_per_unit',50)),gen_random_uuid());v_product_id:=converted->>'product_id';
 if (select published from public.products where id=v_product_id) or (select stock from public.products where id=v_product_id)<>0 then raise exception 'Converted product was published or invented stock'; end if;
 if (select count(*) from public.inventory_movements)<>movement_count then raise exception 'Product conversion moved inventory'; end if;
 if has_function_privilege('anon','public.get_admin_quotes(integer,integer,text,text,date,date,text)','EXECUTE') or has_function_privilege('authenticated','public.claim_quote_email_deliveries(integer)','EXECUTE') or not has_function_privilege('service_role','public.claim_quote_email_deliveries(integer)','EXECUTE') then raise exception 'Budget RPC grants are unsafe'; end if;
 if exists(select 1 from pg_tables t where t.schemaname='public' and t.tablename like 'quote_%' and not t.rowsecurity) then raise exception 'A quote table lacks RLS'; end if;
 raise notice 'Integral budget rollback QA passed';
end $$;
rollback;

