-- Transactional QA for checkout reservations and pre-production cancellation.
begin;
do $$
declare
  admin_id uuid:=gen_random_uuid();
  prefix text:='checkout-stock-test-'||gen_random_uuid()::text;
  p_full text; p_partial text; p_zero text; p_other text;
  result jsonb; oid uuid; cancellation jsonb; initial_emails integer; initial_orders integer;
begin
  initial_emails:=(select count(*) from public.order_email_outbox);
  initial_orders:=(select count(*) from public.orders);
  insert into auth.users(id,aud,role,email,raw_user_meta_data)
    values(admin_id,'authenticated','authenticated',admin_id::text||'@example.invalid','{}');
  update public.profiles set role='admin' where id=admin_id;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated','aal','aal2')::text,true);

  p_full:=prefix||'-full'; p_partial:=prefix||'-partial';
  p_zero:=prefix||'-zero'; p_other:=prefix||'-other';
  insert into public.products(id,name,price,stock,published) values
    (p_full,'Stock completo',100,10,true),(p_partial,'Stock parcial',200,2,true),
    (p_zero,'Sin stock',300,0,true),(p_other,'Segundo artículo',400,5,true);

  result:=public.create_public_order(prefix,'Fixture','fixture@example.invalid','1122334455','Efectivo','',jsonb_build_array(
    jsonb_build_object('product_id',p_full,'qty',3),jsonb_build_object('product_id',p_partial,'qty',5),
    jsonb_build_object('product_id',p_zero,'qty',4),jsonb_build_object('product_id',p_other,'qty',2)
  ));
  oid:=(result->>'order_id')::uuid;
  if (select stock from public.products where id=p_full)<>7
    or (select stock from public.products where id=p_partial)<>0
    or (select stock from public.products where id=p_zero)<>0
    or (select stock from public.products where id=p_other)<>3 then
    raise exception 'Checkout reserved incorrect finished stock';
  end if;
  if (select count(*) from public.inventory_movements where order_id=oid and reason='checkout_reserved')<>4 then
    raise exception 'Checkout reservation trace missing';
  end if;
  if exists(select 1 from public.inventory_movements where product_id in(p_full,p_partial,p_zero,p_other) and reason='manual_finished') then
    raise exception 'Checkout was misclassified as manual stock';
  end if;
  if not exists(select 1 from public.inventory_movements where order_id=oid and product_id=p_full and required=3 and deficit=0 and delta=-3)
    or not exists(select 1 from public.inventory_movements where order_id=oid and product_id=p_partial and required=5 and deficit=3 and delta=-2)
    or not exists(select 1 from public.inventory_movements where order_id=oid and product_id=p_zero and required=4 and deficit=4 and delta=0)
    or not exists(select 1 from public.inventory_movements where order_id=oid and product_id=p_other and required=2 and deficit=0 and delta=-2) then
    raise exception 'Checkout reservation quantities are incorrect';
  end if;

  cancellation:=(select jsonb_agg(jsonb_build_object('item_id',id,'disposition','unfinished','qty',0) order by id)
    from public.order_items where order_id=oid);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated','aal','aal1')::text,true);
  begin
    perform public.change_order_status(oid,'Cancelado',0,false,null,cancellation);
    raise exception 'AAL1 cancellation accepted';
  exception when insufficient_privilege then null; end;
  if (select status from public.orders where id=oid)<>'Pendiente' or (select stock from public.products where id=p_full)<>7 then
    raise exception 'Rejected AAL1 cancellation changed data';
  end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated','aal','aal2')::text,true);
  perform public.change_order_status(oid,'Cancelado',0,false,null,cancellation);
  if (select stock from public.products where id=p_full)<>10
    or (select stock from public.products where id=p_partial)<>2
    or (select stock from public.products where id=p_zero)<>0
    or (select stock from public.products where id=p_other)<>5 then
    raise exception 'Pre-production cancellation restored incorrect stock';
  end if;
  if (select count(*) from public.inventory_movements where order_id=oid and reason='checkout_restocked')<>3 then
    raise exception 'Restock trace mismatch';
  end if;
  if exists(select 1 from public.inventory_movements where order_id=oid and product_id=p_zero and reason='checkout_restocked') then
    raise exception 'Cancellation invented finished stock';
  end if;

  -- Same-state and stale retries are no-ops. The order lock plus unique movement
  -- key provides the same protection to concurrent cancellation requests.
  perform public.change_order_status(oid,'Cancelado',0,false,null,cancellation);
  if (select count(*) from public.inventory_movements where order_id=oid and reason='checkout_restocked')<>3
    or (select stock from public.products where id=p_full)<>10 then
    raise exception 'Cancellation replay restored stock twice';
  end if;
  if exists(select 1 from public.order_material_consumptions where order_id=oid)
    or exists(select 1 from public.inventory_movements where order_id=oid and reason='production') then
    raise exception 'Pre-production cancellation consumed BOM';
  end if;
  set constraints all immediate;
  set constraints all deferred;
  if (select count(*) from public.order_email_outbox)<>initial_emails+2
    or (select count(*) from public.orders)<>initial_orders+1 then
    raise exception 'Fixture order/outbox mismatch';
  end if;
  raise notice 'Checkout inventory traceability rollback scenarios passed';
end;
$$;
rollback;

