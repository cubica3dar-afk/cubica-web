# Ciclo de vida de pedidos e inventario

## Operación del panel

Ventas / Pedidos → Gestionar pedido muestra cliente, artículos, estado, receta agregada, consumo registrado, transiciones y movimientos. La secuencia es Pendiente → Confirmado → En producción → Preparado → Entregado; Cancelado cierra el pedido. Se pueden seleccionar estados anteriores antes del cierre, sin repetir consumo ni aviso. No se pueden saltar etapas hacia adelante.

Mi perfil → Mis pedidos recibe una proyección comercial del backend: Pedido recibido, Listo para entregar, Entregado o Cancelado. Las columnas internas de orders tampoco son legibles por REST para authenticated. Se mantienen las políticas RLS existentes; los administradores acceden a los pedidos completos mediante RPC con validación de auth.uid() y private.is_admin().

## Consumo y faltantes

create_public_order no fue modificado. Conserva su descuento de productos terminados en checkout; no descuenta materiales. El primer inicio de producción calcula recetas reales para TODAS las cantidades compradas, agrega materiales compartidos y guarda una fotografía inmutable del plan. order_material_consumptions tiene una clave primaria por pedido; los movimientos de producción también tienen unicidad por pedido/insumo.

Se conservó supplies_qty_check (qty >= 0). Cuando el administrador acepta un faltante, se descuenta solo el stock disponible hasta cero y se registran por separado required y deficit en inventory_movements. El déficit no se presenta como stock físico consumido. Reponer inventario o resolver un déficit es una tarea manual; volver a seleccionar En producción no vuelve a consumir ni resuelve automáticamente ese faltante. Los insumos inactivos cuentan como no disponibles. Las recetas ausentes generan una advertencia explícita, sin movimientos inventados.

El RPC bloquea el pedido y los productos/insumos y estabiliza la receta durante la transacción. Una confirmación de faltantes usa la huella del plan generado por Supabase; si cambió el inventario o la receta, debe revisarse nuevamente. lifecycle_version evita que una pantalla desactualizada sobrescriba otra transición. Una repetición del estado actual es un no-op.

## Cancelación

Nunca se devuelven materiales automáticamente. Cada artículo requiere una decisión explícita:

- Sin pieza terminada: no aumenta el stock.
- Terminada y estándar reutilizable: el administrador indica la cantidad terminada y se incorpora una vez a products.stock.
- Terminada y personalizada: se registra la decisión sin aumentar el stock comercial.

Antes de producción no se permite declarar piezas fabricadas. Los pedidos antiguos que ya estaban Preparado permiten la decisión explícita, sin inventar consumos históricos. El esquema actual no clasifica automáticamente personalizaciones. La incorporación de piezas fabricadas no es un reembolso del descuento comercial que ya hace el checkout.

Movimientos, en Insumos y Productos terminados, muestra los últimos 200 cambios; el detalle del pedido conserva todos sus movimientos. Se registran ajustes de stock posteriores a la activación. Las referencias y nombres de los movimientos permanecen aunque se retire un insumo o producto del catálogo. Las ediciones del inventario y catálogo conservan los cambios concurrentes de stock; los cambios explícitos de cantidad comparan el valor previamente leído.

## Backend desplegado

- Migración 20261012032310_order_lifecycle_and_inventory.sql.
- Tablas: order_status_history, order_material_consumptions e inventory_movements, con RLS y lectura exclusiva para administradores.
- orders: lifecycle_version, production_started_at, ready_recorded y ready_email_sent.
- RPC: change_order_status, get_order_management, get_admin_orders, get_customer_orders y save_admin_inventory_row.
- Funciones privadas para el plan, guardia de estados y auditoría de stock.
- Edge Function order-emails versión 14: agrega readyEmail y kind=ready, preservando el worker, leases, reintentos, Vault, Cron, payload persistido e idempotencia de Resend.

El primer Preparado inserta una sola entrada ready en order_email_outbox. No hay entradas ready por Confirmado ni En producción. El email inicial customer/internal no cambia. Los pedidos que ya estaban Preparado/Entregado al instalar el bloque reciben una marca de base y no generan avisos retroactivos. El nuevo email es comercial, con botón Ver mi pedido → https://cubica3d.ar/?view=orders.

## Validación

- tests/order-lifecycle.sql, ejecutado en la base real dentro de BEGIN/ROLLBACK: checkout autenticado/invitado, cero consumo inicial y en Confirmado, consumo exacto y compartido, estados atrás/reintentos, versión desactualizada, bloqueo de UPDATE directo, faltantes con autorización y huella, receta ausente, cancelación antes/después, piezas estándar/personalizadas/no terminadas, email ready único y bandera separada, proyección comercial, permisos de columnas, rechazo de acceso cliente/anónimo y protección ante stock desactualizado. No quedan fixtures ni emails de prueba comprometidos.
- 20 pruebas de correos/worker, incluida plantilla lista sin datos internos y la clave independiente ready/v1; retries, errores y autenticación del worker.
- Pruebas de navegación: invitados, sesión iniciada, retorno Google, prioridad de recuperación y login normal.
- Pruebas de recuperación: evento temprano, PASSWORD_RECOVERY, recarga, otra cuenta, logout y formulario asíncrono.
- Revisión visual con fixtures en 390×844 y 1280×900: materiales/faltantes, confirmación, cancelación explícita y seis estados proyectados para el cliente, sin controles internos ni desbordamiento horizontal.
- Se comprobó que la definición de create_public_order es idéntica a la anterior y que las políticas RLS existentes no cambiaron.
- tests/order-analytics.test.cjs verifica el renderizado de KPI: las cuatro etapas abiertas cuentan como pendientes, Entregado conserva su facturación y Cancelado continúa excluido como antes.
- Se verificó el worker desplegado con autenticación interna y cola vacía: HTTP 200, cero reintentos y cero fallos; sin envíos a clientes.

Las verificaciones de Auth y correos se hicieron con pruebas y la infraestructura existente; no se generaron cuentas ni se enviaron avisos reales a clientes durante QA. El envío a un inbox real se producirá cuando un pedido real llegue por primera vez a Preparado.

La revisión de Supabase no detectó tablas nuevas sin RLS. Los RPC SECURITY DEFINER accesibles para authenticated son intencionales y validan identidad/rol o propiedad. Permanecen avisos preexistentes para RPC públicos y protección de contraseñas filtradas; ver https://supabase.com/docs/guides/database/database-linter y https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection.
