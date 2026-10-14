-- Staged order protection. Fixtures, orders, counters and emails roll back.
begin;
do $$
declare
  prefix text:='qa-protection-'||substr(gen_random_uuid()::text,1,8);
  product_id text;
  request_one uuid:=gen_random_uuid();
  request_two uuid:=gen_random_uuid();
  auth_request uuid:=gen_random_uuid();
  auth_user uuid:=gen_random_uuid();
  guest_token text:=repeat('a',64);
  auth_token text:=repeat('b',64);
  limits jsonb;
  payload jsonb;
  result jsonb;
  replay jsonb;
  v_order_id uuid;
  before_count integer;
begin
  if has_function_privilege('anon','public.lookup_verified_delivery_order(text,text,text,text,text,text,jsonb,jsonb,uuid)','execute')
    or has_function_privilege('authenticated','public.create_verified_delivery_order(text,text,text,text,text,text,jsonb,jsonb,uuid,jsonb)','execute')
    or not has_function_privilege('service_role','public.create_verified_delivery_order(text,text,text,text,text,text,jsonb,jsonb,uuid,jsonb)','execute') then
    raise exception 'Protected order RPC grants are incorrect';
  end if;
  if not has_function_privilege('anon','public.create_delivery_order(text,text,text,text,text,text,jsonb,jsonb)','execute') then
    raise exception 'Staged migration activated the gate before production credentials';
  end if;
  if exists(select 1 from pg_policies where schemaname='private' and tablename='order_rate_limits') then
    raise exception 'Rate counters unexpectedly expose an RLS policy';
  end if;

  product_id:=prefix||'-product';
  insert into public.products(id,name,price,stock,active) values(product_id,'Fixture protección',1000,20,true);
  insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data)
    values(auth_user,'authenticated','authenticated',auth_user::text||'@example.invalid',now(),'{}');

  limits:=jsonb_build_array(
    jsonb_build_object('key','guest:'||repeat('1',64),'limit',1,'window_seconds',600),
    jsonb_build_object('key','guest:'||repeat('1',64),'limit',2,'window_seconds',3600),
    jsonb_build_object('key','ip:'||repeat('2',64),'limit',10,'window_seconds',600),
    jsonb_build_object('key','ip:'||repeat('2',64),'limit',20,'window_seconds',3600)
  );
  payload:=jsonb_build_object('mode','pickup','request_id',request_one,'quote_token',guest_token);

  perform set_config('request.jwt.claims',jsonb_build_object('role','service_role')::text,true);
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('role','service_role',true);
  result:=public.create_verified_delivery_order(
    request_one::text,'Fixture','fixture@example.invalid','1122334455','Efectivo','',
    jsonb_build_array(jsonb_build_object('product_id',product_id,'qty',1)),payload,null,limits
  );
  perform set_config('role','none',true);
  v_order_id:=(result->>'order_id')::uuid;
  set constraints all immediate;
  set constraints all deferred;
  if v_order_id is null or (select user_id from public.orders where id=v_order_id) is not null then raise exception 'Guest order identity regression'; end if;
  if (select count(*) from public.order_email_outbox where order_id=v_order_id)<>2 then raise exception 'Valid protected order did not enqueue two emails'; end if;
  if exists(select 1 from public.order_material_consumptions where order_id=v_order_id) then raise exception 'Checkout consumed BOM materials'; end if;
  select count(*) into before_count from private.order_rate_limits;

  perform set_config('request.jwt.claims',jsonb_build_object('role','service_role')::text,true);
  perform set_config('role','service_role',true);
  replay:=public.create_verified_delivery_order(
    request_one::text,'Fixture','fixture@example.invalid','1122334455','Efectivo','',
    jsonb_build_array(jsonb_build_object('product_id',product_id,'qty',1)),payload,null,limits
  );
  perform set_config('role','none',true);
  if replay->>'order_id'<>v_order_id::text or replay->>'idempotent_replay'<>'true' then raise exception 'Protected replay duplicated order'; end if;
  if (select count(*) from private.order_rate_limits)<>before_count then raise exception 'Replay consumed rate limit'; end if;
  if (select count(*) from public.order_email_outbox where order_id=v_order_id)<>2 then raise exception 'Replay duplicated email outbox'; end if;

  payload:=jsonb_build_object('mode','pickup','request_id',request_two,'quote_token',repeat('c',64));
  perform set_config('request.jwt.claims',jsonb_build_object('role','service_role')::text,true);
  perform set_config('role','service_role',true);
  begin
    perform public.create_verified_delivery_order(
      request_two::text,'Fixture','fixture@example.invalid','1122334455','Efectivo','',
      jsonb_build_array(jsonb_build_object('product_id',product_id,'qty',1)),payload,null,limits
    );
    raise exception 'Rate limit accepted a second order';
  exception when others then
    if sqlerrm not like 'order_rate_limit:%' then raise; end if;
  end;
  perform set_config('role','none',true);
  if exists(select 1 from private.order_deliveries where request_id=request_two) then raise exception 'Rejected order persisted'; end if;

  payload:=jsonb_build_object('mode','pickup','request_id',auth_request,'quote_token',auth_token);
  limits:=jsonb_build_array(
    jsonb_build_object('key','auth:'||repeat('3',64),'limit',5,'window_seconds',600),
    jsonb_build_object('key','auth:'||repeat('3',64),'limit',12,'window_seconds',3600),
    jsonb_build_object('key','ip:'||repeat('4',64),'limit',12,'window_seconds',600),
    jsonb_build_object('key','ip:'||repeat('4',64),'limit',40,'window_seconds',3600)
  );
  perform set_config('request.jwt.claims',jsonb_build_object('role','service_role')::text,true);
  perform set_config('role','service_role',true);
  result:=public.create_verified_delivery_order(
    auth_request::text,'Fixture Auth',auth_user::text||'@example.invalid','1122334455','Transferencia','',
    jsonb_build_array(jsonb_build_object('product_id',product_id,'qty',1)),payload,auth_user,limits
  );
  perform set_config('role','none',true);
  if (select user_id from public.orders where id=(result->>'order_id')::uuid)<>auth_user then raise exception 'Verified Auth identity not persisted'; end if;

  perform set_config('role','none',true);
end $$;
select 'Staged order protection checks passed' as result;
rollback;

