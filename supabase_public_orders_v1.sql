-- CÚBICA 3D — pedidos públicos en Supabase
-- Ejecutar una sola vez en Supabase > SQL Editor.
-- Permite que un cliente SIN cuenta cree un pedido validado.
-- El cliente no obtiene permiso para leer pedidos ni modificar tablas directamente.

begin;

create or replace function public.create_public_order(
  p_client_order_id text,
  p_customer_name text,
  p_customer_email text,
  p_phone text default '',
  p_payment text default '',
  p_notes text default '',
  p_items jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_order_number text;
  v_total numeric(14,2) := 0;
  v_item jsonb;
  v_product_id text;
  v_name text;
  v_price numeric(14,2);
  v_stock integer;
  v_qty integer;
  v_color text;
begin
  if length(btrim(coalesce(p_customer_name,''))) < 2
     or length(btrim(coalesce(p_customer_name,''))) > 120 then
    raise exception 'Nombre inválido';
  end if;

  if length(btrim(coalesce(p_customer_email,''))) < 5
     or length(btrim(coalesce(p_customer_email,''))) > 180
     or btrim(p_customer_email) !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    raise exception 'Email inválido';
  end if;

  if length(coalesce(p_phone,'')) > 80 then
    raise exception 'Teléfono inválido';
  end if;

  if length(coalesce(p_notes,'')) > 1500 then
    raise exception 'Observaciones demasiado largas';
  end if;

  if coalesce(p_payment,'') not in ('Efectivo','Transferencia') then
    raise exception 'Forma de pago inválida';
  end if;

  if jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) < 1
     or jsonb_array_length(p_items) > 50 then
    raise exception 'Pedido inválido';
  end if;

  -- Validar todos los ítems y calcular el total con precios del servidor.
  for v_item in
    select value from jsonb_array_elements(p_items)
  loop
    v_product_id := nullif(btrim(v_item->>'product_id'),'');
    v_color := left(coalesce(v_item->>'color',''),120);

    if v_product_id is null then
      raise exception 'Producto inválido';
    end if;

    if coalesce(v_item->>'qty','') !~ '^[0-9]+$' then
      raise exception 'Cantidad inválida';
    end if;

    v_qty := (v_item->>'qty')::integer;
    if v_qty < 1 or v_qty > 100 then
      raise exception 'Cantidad inválida';
    end if;

    select p.name, p.price, p.stock
      into v_name, v_price, v_stock
    from public.products as p
    where p.id = v_product_id
      and p.active = true
    for update;

    if not found then
      raise exception 'Producto no disponible';
    end if;

    v_total := v_total + (v_price * v_qty);
  end loop;

  if v_total <= 0 or v_total > 100000000 then
    raise exception 'Total inválido';
  end if;

  insert into public.orders (
    client_order_id,
    user_id,
    customer_name,
    customer_email,
    phone,
    payment,
    notes,
    total,
    status,
    username
  )
  values (
    nullif(left(coalesce(p_client_order_id,''),160),''),
    (select auth.uid()),
    btrim(p_customer_name),
    lower(btrim(p_customer_email)),
    left(coalesce(p_phone,''),80),
    p_payment,
    coalesce(p_notes,''),
    v_total,
    'Pendiente',
    'guest'
  )
  returning id, order_number into v_order_id, v_order_number;

  -- Insertar detalle y descontar solamente stock terminado.
  -- Si el pedido supera el stock, queda en 0: el excedente se fabrica a pedido.
  for v_item in
    select value from jsonb_array_elements(p_items)
  loop
    v_product_id := btrim(v_item->>'product_id');
    v_qty := (v_item->>'qty')::integer;
    v_color := left(coalesce(v_item->>'color',''),120);

    select p.name, p.price, p.stock
      into v_name, v_price, v_stock
    from public.products as p
    where p.id = v_product_id
      and p.active = true
    for update;

    insert into public.order_items (
      order_id,
      product_id,
      name,
      color,
      qty,
      unit_price
    )
    values (
      v_order_id,
      v_product_id,
      v_name,
      v_color,
      v_qty,
      v_price
    );

    update public.products
    set stock = greatest(stock - v_qty, 0)
    where id = v_product_id;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order_id,
    'order_number', v_order_number,
    'total', v_total
  );
end;
$$;

revoke all on function public.create_public_order(text,text,text,text,text,text,jsonb) from public;
grant execute on function public.create_public_order(text,text,text,text,text,text,jsonb) to anon, authenticated;

commit;
