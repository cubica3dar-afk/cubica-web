-- Production QA for the final Stage A category correction.
-- Every fixture and mutation is contained in this transaction and is rolled back.
begin;

do $$
declare
  admin_id uuid := gen_random_uuid();
  customer_id uuid := gen_random_uuid();
  suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  cat_active text;
  cat_inactive text;
  cat_inactive_renamed text;
  cat_delete text;
  cat_destination text;
  cat_empty text;
  cat_conversion text;
  product_active text;
  product_historical text;
  product_delete_a text;
  product_delete_b text;
  v_quote_id text;
  quote_version_id uuid := gen_random_uuid();
  converted jsonb;
  converted_product text;
  before_movements bigint;
  before_orders bigint;
  before_recipes bigint;
  denied boolean;
begin
  cat_active := 'QA Activa ' || suffix;
  cat_inactive := 'QA Hist ' || suffix;
  cat_inactive_renamed := 'QA Hist R ' || suffix;
  cat_delete := 'QA Borrar ' || suffix;
  cat_destination := 'QA Destino ' || suffix;
  cat_empty := 'QA Vacia ' || suffix;
  cat_conversion := 'QA Conversion ' || suffix;
  product_active := 'qa-active-' || suffix;
  product_historical := 'qa-history-' || suffix;
  product_delete_a := 'qa-delete-a-' || suffix;
  product_delete_b := 'qa-delete-b-' || suffix;
  v_quote_id := 'qa-quote-' || suffix;

  insert into auth.users(id, aud, role, email, email_confirmed_at, raw_user_meta_data)
  values
    (admin_id, 'authenticated', 'authenticated', admin_id::text || '@example.invalid', now(), '{}'::jsonb),
    (customer_id, 'authenticated', 'authenticated', customer_id::text || '@example.invalid', now(), '{}'::jsonb);
  update public.profiles set role = 'admin' where id = admin_id;

  -- AAL1 and non-admin identities must be denied by the backend.
  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', admin_id, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  denied := false;
  begin
    perform public.manage_admin_product_category('create', cat_active, null, null);
  exception when insufficient_privilege then
    denied := true;
  end;
  if not denied then raise exception 'QA: AAL1 admin was not rejected'; end if;

  perform set_config('request.jwt.claim.sub', customer_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', customer_id, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  denied := false;
  begin
    perform public.manage_admin_product_category('create', cat_active, null, null);
  exception when insufficient_privilege then
    denied := true;
  end;
  if not denied then raise exception 'QA: AAL2 customer was not rejected'; end if;

  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', admin_id,
    'role', 'authenticated',
    'aal', 'aal2',
    'amr', jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint))
  )::text, true);

  perform public.manage_admin_product_category('create', cat_active, null, null);
  perform public.manage_admin_product_category('create', cat_inactive, null, null);
  perform public.manage_admin_product_category('create', cat_delete, null, null);
  perform public.manage_admin_product_category('create', cat_destination, null, null);
  perform public.manage_admin_product_category('create', cat_empty, null, null);
  perform public.manage_admin_product_category('create', cat_conversion, null, null);

  -- A new product may use an active category.
  insert into public.products(id, name, category, description, price, stock, color_mode, active, published, sort_order)
  values(product_active, 'QA producto activo', cat_active, 'QA rollback', 100, 0, 'single', true, false, 99990);
  if (select category from public.products where id = product_active) <> cat_active then
    raise exception 'QA: active-category creation failed';
  end if;

  -- An inactive category cannot be used by a new product.
  perform public.manage_admin_product_category('set_active', cat_inactive, null, false);
  denied := false;
  begin
    insert into public.products(id, name, category, description, price, stock, color_mode, active, published, sort_order)
    values('qa-rejected-' || suffix, 'QA debe rechazarse', cat_inactive, 'QA rollback', 100, 0, 'single', true, false, 99991);
  exception when check_violation then
    denied := true;
  end;
  if not denied then raise exception 'QA: inactive category accepted for new product'; end if;

  -- A product can preserve its historical category after that category becomes inactive.
  perform public.manage_admin_product_category('set_active', cat_inactive, null, true);
  insert into public.products(id, name, category, description, price, stock, color_mode, active, published, sort_order)
  values(product_historical, 'QA histórico', cat_inactive, 'QA rollback', 200, 0, 'single', true, false, 99992);
  perform public.manage_admin_product_category('set_active', cat_inactive, null, false);
  update public.products
  set name = 'QA histórico editado', published = false, active = false, category = category
  where id = product_historical;
  if (select category from public.products where id = product_historical) <> cat_inactive then
    raise exception 'QA: historical inactive category was not preserved';
  end if;

  -- Reassigning an existing product to an inactive category remains forbidden.
  denied := false;
  begin
    update public.products set category = cat_inactive where id = product_active;
  exception when check_violation then
    denied := true;
  end;
  if not denied then raise exception 'QA: reassignment to inactive category was accepted'; end if;

  -- A legitimate admin rename cascades even when the historical category is inactive.
  perform public.manage_admin_product_category('rename', cat_inactive, cat_inactive_renamed, null);
  if not exists(select 1 from public.product_categories where name = cat_inactive_renamed and not active)
    or (select category from public.products where id = product_historical) <> cat_inactive_renamed then
    raise exception 'QA: inactive-category rename cascade failed';
  end if;

  -- Product publication, visibility and stock writes remain functional for QA rows.
  before_movements := (select count(*) from public.inventory_movements);
  update public.products set published = true, active = true, stock = 2 where id = product_active;
  update public.products set published = false, active = false, stock = 0 where id = product_active;
  if (select count(*) from public.inventory_movements) <> before_movements + 2 then
    raise exception 'QA: stock audit flow did not record both QA changes';
  end if;

  -- Empty category deletion.
  perform public.manage_admin_product_category('delete', cat_empty, null, null);
  if exists(select 1 from public.product_categories where name = cat_empty) then
    raise exception 'QA: empty category was not deleted';
  end if;

  -- Reassignment is all-or-nothing and includes hidden/inactive products.
  insert into public.products(id, name, category, description, price, stock, color_mode, active, published, sort_order)
  values
    (product_delete_a, 'QA visible', cat_delete, 'QA rollback', 300, 0, 'single', true, true, 99993),
    (product_delete_b, 'QA oculto', cat_delete, 'QA rollback', 400, 0, 'single', false, false, 99994);
  denied := false;
  begin
    perform public.manage_admin_product_category('delete', cat_delete, null, null);
  exception when foreign_key_violation then
    denied := true;
  end;
  if not denied
    or not exists(select 1 from public.product_categories where name = cat_delete)
    or (select count(*) from public.products where category = cat_delete) <> 2 then
    raise exception 'QA: failed deletion was not atomic';
  end if;
  before_movements := (select count(*) from public.inventory_movements);
  perform public.manage_admin_product_category('delete', cat_delete, cat_destination, null);
  if exists(select 1 from public.product_categories where name = cat_delete)
    or (select count(*) from public.products where id in (product_delete_a, product_delete_b) and category = cat_destination) <> 2
    or (select count(*) from public.inventory_movements) <> before_movements then
    raise exception 'QA: atomic reassignment/delete failed or touched stock';
  end if;

  -- Quote conversion rejects inactive categories, then succeeds with an explicit active category.
  insert into public.quotes(
    id, title, data, summary, created_by, quote_number, status, current_version,
    customer_name, customer_email, customer_phone, customer_reference, draft_data,
    total, accepted_at, updated_by
  ) values(
    v_quote_id, 'QA conversión', '{}'::jsonb, 'QA rollback', admin_id,
    'QA-' || suffix, 'accepted', 1, 'QA', '', '', '', '{}'::jsonb, 123.45, now(), admin_id
  );
  insert into public.quote_versions(
    id, quote_id, version, quote_number, snapshot, commercial_snapshot, total, created_by
  ) values(
    quote_version_id, v_quote_id, 1, 'QA-' || suffix, '{}'::jsonb, '{}'::jsonb, 123.45, admin_id
  );
  denied := false;
  begin
    perform public.convert_admin_quote_to_product(
      v_quote_id, 'QA conversión rechazada', 'QA rollback', cat_inactive_renamed, '[]'::jsonb, gen_random_uuid()
    );
  exception when check_violation then
    denied := true;
  end;
  if not denied or (select status from public.quotes where id = v_quote_id) <> 'accepted' then
    raise exception 'QA: inactive quote-conversion category was accepted or changed the quote';
  end if;

  before_orders := (select count(*) from public.orders);
  before_recipes := (select count(*) from public.product_recipes);
  before_movements := (select count(*) from public.inventory_movements);
  converted := public.convert_admin_quote_to_product(
    v_quote_id, 'QA producto desde presupuesto', 'QA rollback', cat_conversion, '[]'::jsonb, gen_random_uuid()
  );
  converted_product := converted ->> 'product_id';
  if converted ->> 'category' <> cat_conversion
    or (select category from public.products where id = converted_product) <> cat_conversion
    or (select published from public.products where id = converted_product)
    or (select stock from public.products where id = converted_product) <> 0
    or (select count(*) from public.quote_conversions qc where qc.quote_id = v_quote_id and qc.kind = 'product') <> 1
    or (select count(*) from public.orders) <> before_orders
    or (select count(*) from public.product_recipes) <> before_recipes
    or (select count(*) from public.inventory_movements) <> before_movements then
    raise exception 'QA: quote-to-product conversion integrity failed';
  end if;

  raise notice 'Stage A production rollback QA passed: %', suffix;
end
$$;

rollback;
