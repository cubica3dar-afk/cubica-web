-- Ejecutar después de migrar y antes de activar Cron. No envía correos.
-- Todos los datos de prueba y cambios de stock se revierten al terminar.
begin;
do $$
declare
  v_a text := 'email-test-a-'||gen_random_uuid()::text;
  v_b text := 'email-test-b-'||gen_random_uuid()::text;
  v_supply text := 'email-test-s-'||gen_random_uuid()::text;
  v_result jsonb; v_order uuid; v_snapshot jsonb; v_jobs jsonb;
  v_customer public.order_email_outbox; v_internal public.order_email_outbox;
  v_lease uuid; v_payload jsonb; v_order_user uuid; v_user uuid; v_count integer;
begin
  if has_table_privilege('anon','public.order_email_outbox','select')
    or has_table_privilege('authenticated','public.order_email_outbox','select') then
    raise exception 'La cola no debe ser legible por clientes';
  end if;
  if has_function_privilege('anon','public.get_order_email_snapshot(uuid)','execute')
    or has_function_privilege('authenticated','public.claim_order_email_deliveries(integer)','execute') then
    raise exception 'RPC de email accesible desde frontend';
  end if;
  if not has_function_privilege('anon','public.create_public_order(text,text,text,text,text,text,jsonb)','execute') then
    raise exception 'Se rompió el checkout de invitados';
  end if;
  if public.validate_order_email_worker_secret(repeat('x',64)) then
    raise exception 'Se aceptó un secreto inválido';
  end if;

  -- Aislar los claims de esta transacción. Se revierte y no toca pedidos reales.
  update public.order_email_outbox set status='review' where status in ('pending','processing');
  insert into public.products(id,name,price,stock,active)
  values(v_a,'Producto prueba A',1000,1,true),(v_b,'Producto prueba B',2000,0,true);
  insert into public.supplies(id,name,qty,unit,active)
  values(v_supply,'Insumo compartido de prueba',500,'gramos',true);
  insert into public.product_recipes(product_id,supply_id,qty_per_unit)
  values(v_a,v_supply,100),(v_b,v_supply,150);

  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{}',true);
  v_result := public.create_public_order('email-test-'||gen_random_uuid()::text,'Cliente prueba','test@example.test',
    '', 'Transferencia','Prueba transaccional: no enviar',
    jsonb_build_array(jsonb_build_object('product_id',v_a,'qty',1,'color','Rojo','price',1),
      jsonb_build_object('product_id',v_a,'qty',1,'color','Azul','price',1),
      jsonb_build_object('product_id',v_b,'qty',3,'price',1)));
  v_order := (v_result->>'order_id')::uuid;
  if (v_result->>'total')::numeric <> 8000 then raise exception 'Total no calculado por servidor'; end if;
  set constraints cubica_enqueue_order_emails immediate;
  if (select count(*) from public.order_email_outbox where order_id=v_order) <> 2 then
    raise exception 'Faltan las dos entregas del pedido';
  end if;
  if (select user_id from public.orders where id=v_order) is not null then raise exception 'Invitado asociado incorrectamente'; end if;
  if (select stock from public.products where id=v_a) <> 0 then raise exception 'Cambió el descuento de terminado'; end if;
  if (select qty from public.supplies where id=v_supply) <> 500 then raise exception 'No se deben descontar insumos'; end if;

  v_snapshot := public.get_order_email_snapshot(v_order);
  if jsonb_array_length(v_snapshot->'items')<>3 or jsonb_array_length(v_snapshot->'recipes')<>2
    or jsonb_array_length(v_snapshot->'supplies')<>1 then raise exception 'Snapshot incompleto'; end if;
  select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) into v_jobs from public.claim_order_email_deliveries(3) q;
  if jsonb_array_length(v_jobs)<>2 then raise exception 'Claim no obtuvo las dos entregas'; end if;
  if exists(select 1 from public.claim_order_email_deliveries(3)) then raise exception 'Claim concurrente repitió leases'; end if;
  select * into v_customer from public.order_email_outbox where order_id=v_order and kind='customer';
  select * into v_internal from public.order_email_outbox where order_id=v_order and kind='internal';
  v_payload := public.prepare_order_email_delivery(v_order,'customer',v_customer.lock_token,'{"test":1}'::jsonb);
  if v_payload <> '{"test":1}'::jsonb then raise exception 'Payload no persistido'; end if;
  v_payload := public.prepare_order_email_delivery(v_order,'customer',v_customer.lock_token,'{"test":999}'::jsonb);
  if v_payload <> '{"test":1}'::jsonb then raise exception 'Payload cambió en reintento'; end if;
  perform public.finish_order_email_delivery(v_order,'customer',v_customer.lock_token,true,'test-provider-id',null,false);
  perform public.prepare_order_email_delivery(v_order,'internal',v_internal.lock_token,'{"test":"internal"}'::jsonb);
  perform public.finish_order_email_delivery(v_order,'internal',v_internal.lock_token,false,null,'resend_http_503',true);
  if not (select customer_email_sent and not internal_email_sent from public.orders where id=v_order) then
    raise exception 'Flags de destinatarios no independientes';
  end if;
  if (select status from public.order_email_outbox where order_id=v_order and kind='internal') <> 'pending' then
    raise exception 'Fallo transitorio no reencolado';
  end if;
  if not (select email_errors @> '[{"kind":"internal","code":"resend_http_503"}]'::jsonb from public.orders where id=v_order) then
    raise exception 'Fallo no registrado en pedido';
  end if;
  update public.order_email_outbox set next_attempt_at=now()-interval '1 minute' where order_id=v_order and kind='internal';
  select lock_token into v_lease from public.claim_order_email_deliveries(3);
  if v_lease is null or v_lease=v_internal.lock_token then raise exception 'Lease de reintento inválido'; end if;
  perform public.finish_order_email_delivery(v_order,'internal',v_lease,true,'test-internal-id',null,false);
  if not (select internal_email_sent and customer_email_sent and email_errors='[]'::jsonb from public.orders where id=v_order) then
    raise exception 'Éxito final no limpia flags/errores';
  end if;

  -- Validar también la asociación actual de create_public_order para autenticados.
  select id into v_user from auth.users limit 1;
  if v_user is not null then
    set constraints cubica_enqueue_order_emails deferred;
    perform set_config('request.jwt.claim.sub',v_user::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',v_user,'role','authenticated')::text,true);
    v_result := public.create_public_order('email-test-auth-'||gen_random_uuid()::text,'Cliente prueba','test@example.test','',
      'Efectivo','Prueba transaccional: no enviar',jsonb_build_array(jsonb_build_object('product_id',v_a,'qty',1)));
    v_order_user := (v_result->>'order_id')::uuid;
    set constraints cubica_enqueue_order_emails immediate;
    if (select user_id from public.orders where id=v_order_user) <> v_user then raise exception 'Autenticado no asociado'; end if;
    if (select count(*) from public.order_email_outbox where order_id=v_order_user) <> 2 then raise exception 'Autenticado no encolado'; end if;
  end if;
end;
$$;
rollback;
select 'PASS: checkout, cola, leases, snapshot, payload estable, flags, reintentos, permisos, invitados y autenticados; datos revertidos' as validation;
