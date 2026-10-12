# Checkout de página completa

La compra usa `?view=checkout`, compatible con GitHub Pages. Comprar ahora y Finalizar pedido desde el carrito abren la misma página. El resumen usa los productos del catálogo actual; el servidor sigue validando productos, variantes, cantidades y precios con `create_delivery_order`, que conserva la operación `create_public_order` y sus reglas de inventario y emails.

## Datos personales

`private.buyer_details` guarda únicamente nombre, apellido y teléfono privados del comprador. No modifica el nombre público de Community ni copia el email. El email se obtiene de Supabase Auth y se muestra de solo lectura al iniciar sesión. Un perfil incompleto puede guardarse; el checkout solicita los datos faltantes.

Migración: `supabase/migrations/20261012160126_private_buyer_details_for_checkout.sql`.

RPCs públicas: `get_my_buyer_details()` y `save_my_buyer_details(p_first_name, p_last_name, p_phone)`. Son wrappers invoker de funciones privadas definer con `search_path=''`, autorización mediante `auth.uid()` y parámetros sin `user_id` ni email. La tabla tiene RLS activada y acceso directo revocado. No necesita políticas de lectura directa: el comportamiento de RLS sin políticas es denegar el acceso.

Se reutilizan las direcciones y RPCs privadas existentes. La predeterminada se aplica solamente si el usuario no ingresó/restauró una dirección específica. Una dirección de otra persona conserva su destinatario y teléfono. Editar campos del checkout no modifica datos guardados. Guardar una nueva dirección requiere marcar expresamente la casilla de consentimiento.

## Borrador y navegación

El borrador usa `sessionStorage`, con vencimiento de 24 horas y propietario comprobado después de verificar Auth. Mantiene los campos editados, la entrega, el destinatario, la cotización vigente y las claves de idempotencia. No añade datos personales a `localStorage`. Una recarga conserva el borrador de la misma cuenta; logout, cambio de cuenta y compra exitosa lo limpian. Respuestas asíncronas de una cuenta anterior se descartan. El retorno desde Google/email recuerda únicamente el destino de checkout, sin datos personales; navegar explícitamente a Tienda cancela ese retorno.

La recuperación de contraseña conserva prioridad sobre checkout, productos, pedidos y retorno de login. Un carrito vacío, producto no disponible, cantidades inválidas o catálogo sin comprobar bloquean la confirmación. Durante un envío de pedido el botón permanece deshabilitado; un error conserva el carrito y las claves para reintentar.

## Entrega

Retiro coordinado exige teléfono, no dirección postal, y cobra $0 de entrega. Envío a domicilio exige una cotización real vigente ligada al carrito y dirección. Las APIs comerciales de transportistas siguen pendientes de habilitación; no se inventan tarifas. La falta de configuración y el vencimiento de una cotización tienen mensajes distintos.

Calle y altura se solicitan por separado. Una altura repetida exactamente al final de la calle se normaliza sin duplicarla; una altura conflictiva pide corrección. Nombres numéricos como Calle 9 y Ruta 40 se conservan.

## Validación

La suite JavaScript cubre navegación, drafts, privacidad por cuenta, perfiles completos/incompletos, direcciones, destinatarios, cotización, retiro, doble envío, reintentos, producto, Community, Analytics, pedidos y recuperación de contraseña. Ejecutar con `node --test --test-isolation=none tests/*.test.cjs`. Resultado del bloque: 98 tests aprobados, 0 fallos. Sintaxis correcta en 22 archivos JavaScript.

SQL contra el esquema desplegado: `tests/checkout-profile.sql`, `tests/delivery-backend.sql`, `tests/order-lifecycle.sql` y `tests/community-rollback.sql`. Los cuatro pasaron con transacciones y rollback; se confirmó que no quedaron fixtures ni emails de prueba. Se comprobaron acceso anónimo rechazado, separación de cuentas, email derivado de Auth, RLS y permisos directos revocados.

Revisión visual en 360, 414, 768 y 1280 px: una columna en móvil/tablet, dos columnas con resumen sticky en escritorio, campos de al menos 16 px y desplazamiento de página sin scroll interno de modal.

Los flujos reales de Google, email y cambio de contraseña no se completan con credenciales del usuario durante QA; se verifican sus regresiones automatizadas y la prioridad de navegación. No se crean compras ni correos reales para probar la interfaz.

No hay cambios en las Edge Functions de pedidos o cotizaciones, las métricas existentes, BOM, lifecycle ni RLS anteriores.

