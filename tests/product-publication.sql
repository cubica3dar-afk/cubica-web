-- Product publication, RLS, AAL2 and historical integrity checks.
-- Every fixture and data change is rolled back.
begin;
do $$
declare
  admin_id uuid:=gen_random_uuid();
  customer_id uuid:=gen_random_uuid();
  hidden_id text:='publication-hidden-'||gen_random_uuid();
  managed_id text:='publication-managed-'||gen_random_uuid();
  v_order_id uuid;
begin
  insert into auth.users(id,aud,role,email,email_confirmed_at,raw_user_meta_data) values
    (admin_id,'authenticated','authenticated',admin_id::text||'@example.invalid',now(),'{}'),
    (customer_id,'authenticated','authenticated',customer_id::text||'@example.invalid',now(),'{}');
  update public.profiles set role='admin' where id=admin_id;

  insert into public.products(id,name,price,stock,active) values(hidden_id,'Hidden fixture',100,3,true);
  if (select published from public.products where id=hidden_id) then raise exception 'New product was public by default'; end if;
  insert into public.product_colors(product_id,name,hex,sort_order) values(hidden_id,'Negro','#000000',0);

  perform set_config('role','anon',true);
  if exists(select 1 from public.products where id=hidden_id) then raise exception 'Anonymous user read a hidden product'; end if;
  if exists(select 1 from public.product_colors where product_id=hidden_id) then raise exception 'Anonymous user read hidden product variants'; end if;
  perform set_config('role','none',true);

  begin perform private.delivery_items(jsonb_build_array(jsonb_build_object('product_id',hidden_id,'qty',1,'color','Negro'))); raise exception 'Hidden product entered checkout';
  exception when others then if sqlerrm='Hidden product entered checkout' then raise; end if; end;
  begin perform private.get_product_community(hidden_id); raise exception 'Hidden product exposed Community';
  exception when others then if sqlerrm='Hidden product exposed Community' then raise; end if; end;

  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated','aal','aal1')::text,true);
  perform set_config('role','authenticated',true);
  begin
    perform public.save_admin_inventory_row('products',jsonb_build_object('id',managed_id,'name','Managed fixture','description','','price',200,'stock',2,'color_mode','single','sort_order',10,'active',true,'published',true),null,true);
    raise exception 'AAL1 published a product';
  exception when insufficient_privilege then null; end;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated','aal','aal2','amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',extract(epoch from now())::bigint)))::text,true);
  perform public.save_admin_inventory_row('products',jsonb_build_object('id',managed_id,'name','Managed fixture','description','','price',200,'stock',2,'color_mode','single','sort_order',10,'active',true,'published',true),null,true);
  perform set_config('role','none',true);
  if not (select published and active from public.products where id=managed_id) then raise exception 'AAL2 did not publish the product'; end if;

  perform set_config('role','anon',true);
  if not exists(select 1 from public.products where id=managed_id) then raise exception 'Published product is not public'; end if;
  perform set_config('role','none',true);

  insert into public.orders(customer_name,customer_email,payment,total,status,username) values('QA rollback','qa@example.invalid','Efectivo',200,'Entregado','guest') returning id into v_order_id;
  insert into public.order_items(order_id,product_id,name,color,qty,unit_price) values(v_order_id,managed_id,'Managed fixture','',1,200);
  update public.products set published=false where id=managed_id;
  if not exists(select 1 from public.order_items where order_id=v_order_id and product_id=managed_id) then raise exception 'Hiding product damaged historical order'; end if;
end $$;
select 'Product publication checks passed' as result;
rollback;

