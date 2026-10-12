# Cúbica — producto, compra directa y entregas

Implementación sobre `894de3d4ed18a4ea23ed0830c5b676bc95a78897`, conservando Auth y recuperación.

## Operativo

- Página de producto mediante `?product=ID`, links anteriores, recarga e historial del navegador. Galería, variantes, cantidades 1–100 y Community conservados. Loading/error/not found distintos. Comprar ahora conserva el carrito y abre checkout; Agregar al carrito permanece en el producto. Una ráfaga de clics genera una sola incorporación/evento.
- Checkout con modalidad explícita: retiro coordinado sin domicilio ni cargo adicional; envío exige dirección y cotización vigente. Total visible antes de confirmar. El teléfono se requiere para coordinar el retiro.
- Direcciones privadas con consentimiento, edición, borrado y predeterminada. Editar los campos de checkout no sobrescribe una dirección guardada. Cambios de cuenta limpian datos en memoria.
- Administración Entregas: origen exacto privado en Caballito/CABA, márgenes iniciales provisionales 10/8/12%, activación de transportistas, medidas/pesos, cajas y costo de protección. Cotizaciones/historial privados. Gestión del pedido: transporte/retiro independiente de producción, costo real total de despacho, diferencia, tracking HTTPS e historial.
- Emails iniciales y ready incluyen entrega y datos públicos apropiados; email interno incluye tarifa/margen/embalaje. La cola, los leases, payloads ya persistidos e idempotencia de Resend permanecen.

## Pendiente de terceros

Los tres adaptadores de producción están desactivados y no consultan APIs ni inventan tarifas. Marcar un transportista activo en Administración no instala su integración. `shipping-quotes` devuelve `needs_configuration` si faltan origen, medidas o caja; con configuración completa y ningún adaptador comercial habilitado devuelve `unavailable`. Se puede reintentar o elegir retiro. Ver [contratos y pasos de habilitación](docs/carrier-setup.md).

No hay etiquetas, compras de transporte, pagos online ni sincronización automática de tracking. El administrador registra los movimientos logísticos. Registrar una cotización o marcar logística entregada no modifica el estado interno del pedido.

## Base y permisos

Tablas nuevas únicamente en `private`, todas con RLS y sin acceso directo para anon/authenticated: `delivery_addresses`, `delivery_settings`, `delivery_quotes`, `order_deliveries`, `delivery_history`. Direcciones tienen política de dueño; el resto está cerrado por defecto y se consulta por funciones controladas. No se amplían políticas de Community, inventario o pedidos.

API con wrappers invoker: `list_my_delivery_addresses`, `save_my_delivery_address`, `delete_my_delivery_address`, `admin_delivery_settings`, `admin_save_delivery_settings`, `admin_order_delivery`, `admin_update_order_delivery`, `create_delivery_order`. Implementaciones privadas validan propietario/administrador. `prepare_delivery_quote` y `finalize_delivery_quote` son exclusivos de service_role. Edge valida JWT de usuario con Auth; invitados usan capacidad aleatoria de 256 bits.

`create_public_order` permanece sin cambios. `create_delivery_order` lo reutiliza en una misma transacción, valida snapshot, vuelve a leer precios/variantes, suma entrega y guarda condiciones. Request ID/capacidad y locks impiden doble venta/stock ante reintentos. Una cotización pertenece a la misma identidad, dirección y carrito; vence a los 15 minutos o antes si el proveedor indica vencimiento anterior. Cambios de precio requieren volver a cotizar.

`get_customer_orders` agrega solo entrega pública del dueño; `get_order_email_snapshot` agrega logística privada exclusivamente para el worker existente. Pedidos históricos no se recalculan ni reciben modalidad supuesta: administración indica ausencia de registro.

## Cálculos

Precio final = tarifa válida del proveedor + margen porcentual redondeado a centavos + caja + protección. SQL selecciona el menor precio final, no la menor tarifa base. Nunca acepta importes/márgenes/pesos/dimensiones enviados por el navegador.

Embalaje: ordenar las tres dimensiones de cada producto; usar el máximo de las dos mayores y apilar únicamente la menor según cantidad. Elegir una caja configurada que contenga toda la columna y soporte peso de todos los productos + caja. No sumar las tres dimensiones ni usar volumen como prueba de cabida. Las dimensiones configuradas deben representar la envolvente protegida que realmente se embala; verificar capacidad útil y medidas exteriores de las cajas antes de habilitar tarifas reales. La capacidad interna decide si cabe el pedido; la API del transportista recibe únicamente dimensiones exteriores, validadas como iguales o mayores que las internas. La estimación conservadora puede exigir una caja más grande que un acomodo manual optimizado; si no cabe una caja conocida, no cotiza.

Las cajas/protección son configuración de costos, no una copia de stock comercial. Cotizar no consume ningún insumo. El consumo BOM sigue ocurriendo exclusivamente al iniciar producción, una sola vez. Si un insumo de embalaje ya forma parte de una receta, conserva su movimiento existente y no se descuenta otra vez por cotizar.

Los importes aceptados nunca aumentan por cambios normales del transporte. Diferencia del negocio = entrega cobrada − costo real total de despacho (incluyendo embalaje). El total del pedido incluye entrega; facturación por producto continúa tomando líneas de productos y excluye cancelados como antes. Ningún pedido se interpreta como pagado por estar confirmado.

## Retención autorizada

Diego autorizó explícitamente limpiar cotizaciones abandonadas. A las 03:15 de Buenos Aires se borran únicamente cotizaciones vencidas hace más de 2 días, sin pedido asociado y no usadas. Se conservan condiciones/logística/historial de los pedidos. `private.cleanup_delivery_quotes()` está cerrada a clientes; no puede invocarse públicamente.

## Migraciones / funciones

- `20261012065637_delivery_addresses_quotes_and_logistics.sql`
- `20261012070346_delivery_variant_and_contact_validation.sql`
- `20261012070621_delivery_abandoned_quote_retention.sql`
- `20261012085223_delivery_package_exterior_dimensions.sql`
- Edge `shipping-quotes` v1; `order-emails` v15. Ambas validan su autorización dentro del handler; verify_jwt=false para admitir invitados/worker con secreto existente.

## Validación

Tests JS de producto, checkout real con dobles submits/reintentos, direcciones, cotizaciones y fallos de providers, Auth recovery, links a pedidos/productos, Analytics y emails. SQL descartable contra la base real: direcciones entre usuarios y roles, cotizaciones/packaging/márgenes, precio/expiración/token/identidad, checkout guest/auth, idempotencia, logística independiente y retención; regresiones lifecycle/BOM/Community. Todas las transacciones SQL se revierten, sin usuarios/pedidos/emails de prueba persistidos.

El advisor no agrega funciones definer públicas para clientes. Reporta RLS sin políticas para las cuatro tablas privadas cerradas por diseño. Advertencias anteriores de funciones legacy/Auth se mantienen, sin cambiar sus permisos fuera de alcance.

Frontend principal modificado: `index.html`, `supabase-bridge.js`, `supabase-sales.js`, `js/app-init.js`, `js/ui-shell.js`, `js/store-ui.js`, `js/products-ui.js`, `js/community-ui.js`, `js/orders-ui.js`, `js/order-management.js`. Nuevos `js/delivery-ui.js`, `styles-product-page.css`, `styles-delivery.css`. Email modificado `supabase/functions/order-emails/templates.js`.

