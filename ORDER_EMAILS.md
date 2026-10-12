# Correos de pedidos de Cúbica

## Diseño

`create_public_order` conserva su firma, validaciones y guardado transaccional. Un trigger diferido en `orders` agrega dos entregas a una cola privada cuando ya existen los ítems. No hay llamadas a Resend ni dependencia de disponibilidad del proveedor durante el checkout. El navegador no invoca el worker y no recibe ninguna clave privada. Invitados y clientes autenticados usan el mismo circuito.

La Edge Function usa REST nativo y módulos locales, sin dependencias de terceros.

Cada minuto, Cron llama a la Edge Function `order-emails`. El worker reclama hasta tres entregas con bloqueo temporal, lee un snapshot de las tablas reales, prepara el correo, persiste su contenido y lo envía por Resend. Las entregas al cliente y al negocio tienen estados y claves de idempotencia independientes. `customer_email_sent` e `internal_email_sent` indican que Resend aceptó el envío; no prueban la entrega en la bandeja de entrada. `email_errors` registra códigos seguros, sin secretos ni respuestas con información privada.

El plan interno calcula las recetas para **todas las unidades compradas**, agrega insumos compartidos entre productos y variantes, y compara ese consumo contra el inventario al preparar el correo. No descuenta productos terminados, no reserva materiales y no modifica el stock de insumos. Una receta ausente y un inventario incompleto se informan por separado. Un insumo inactivo no se considera disponible y se muestra su stock físico. Los faltantes nunca bloquean el pedido.

El correo del cliente contiene únicamente nombre, número de pedido, productos, variantes, cantidades, precios, total, método de pago e instrucciones para entrar a Mis pedidos. El correo interno incluye datos de contacto, observaciones y el plan de producción. Todo texto variable se escapa en HTML.

## Activación

1. Confirmar acceso al proyecto `mymrbpwvghxmqqpzzdqk`. Ejecutar `supabase/schema-preflight.sql` (solo lectura) y comparar tipos, permisos, triggers y definición real de `create_public_order`. El esquema consolidado del repo NO es una introspección de producción.
2. Verificar en Resend que `cubica3d.ar` está habilitado como dominio emisor y que la clave utilizada tiene permiso de envío. Cloudflare Email Routing recibe correo; la autorización para enviarlo corresponde a Resend.
3. Configurar secretos en el runtime de Edge Functions, sin guardarlos en Git ni pegarlos en el chat:
   - `RESEND_API_KEY`: clave de envío de Resend.
   - `ORDER_EMAIL_FROM`: emisor verificado, por ejemplo `Cúbica <contacto@cubica3d.ar>`.
   - `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`: variables del runtime hospedado de Supabase. Nunca publicarlas en el frontend.
4. La migración de la cola genera un secreto aleatorio de 64 caracteres dentro de Vault, con el nombre `cubica_order_email_worker_secret`. No hay que copiarlo: Cron lo lee y el worker verifica su hash mediante un RPC solo disponible para backend. El valor no sale de la base ni se guarda en el repositorio.
5. Desplegar la función desde `supabase/functions/order-emails/index.ts` y sus tres módulos `.js`. `verify_jwt=false` se aplica solo a esta función porque usa autenticación propia por el header secreto. La función rechaza solicitudes sin ese secreto, incluso si traen la clave pública de Supabase. No alterar la configuración de otras funciones ni de Auth.
6. Aplicar las cuatro migraciones de `supabase/migrations/` en orden después de verificar el esquema real. Agregan la cola, sus funciones/trigger, el acceso explícito y las extensiones del programador; reutilizan los campos de email existentes. No reprocesan compras históricas.
7. Ejecutar las pruebas transaccionales de base antes de activar Cron y comprobar los permisos de acceso de la cola. No enviar correos de prueba a clientes reales.
8. La cuarta migración activa Cron; `supabase/activate-order-email-cron.sql` conserva el SQL de activación como referencia operativa. El emisor de invocaciones usa únicamente Vault y envía un cuerpo vacío. No acepta precios, inventario ni destinatarios del navegador.
9. Verificar una compra real acordada: persistencia del pedido y sus ítems, las dos entregas, estado de la cola, flags de envío y entrega en las bandejas. Una falla de Resend debe dejar el pedido guardado y solo la entrega pendiente/fallida.

Los archivos SQL no deben ejecutarse una segunda vez a ciegas: aplicar la migración mediante el historial de Supabase. Activar Cron con el nombre existente actualiza su programación y no debería crear trabajos duplicados.

## Validación local

```sh
node --test --test-isolation=none tests/order-emails.test.mjs
```

Las pruebas cubren agregado entre productos y variantes, precisión de cantidades, receta ausente, productos eliminados, inventario ausente/inactivo, privacidad del correo comercial, escape HTML, guardado de payload antes del envío, estabilidad de reintentos, destinatarios independientes, respuestas 429/409/5xx/422 de Resend, errores de red, autenticación y rechazo de datos de pedido enviados por el solicitante. Ninguna prueba local envía correo.

## Reintentos y operación

- Un fallo transitorio vuelve a la cola con esperas de 1, 2, 4, 8, 16, 32 y hasta 60 minutos. Diez intentos requieren revisión. Errores permanentes quedan como `failed`.
- Resend conserva la idempotencia durante 24 horas. La cola detiene reintentos después de 23 horas desde la preparación del primer envío para evitar duplicados si una respuesta fue ambigua. Revisar los registros de Resend antes de forzar otra entrega. No borrar el payload para cambiar el contenido de un envío ambiguo.
- El payload queda congelado en el primer intento. Si luego cambian precio, receta o stock, los reintentos envían exactamente el mismo mensaje con la misma clave. La disponibilidad en el correo es una fotografía al prepararlo; no garantiza reservas para otros pedidos.
- `sent` significa aceptado por Resend. Rebotes, quejas y entrega final se inspeccionan en Resend; no se implementó un webhook de eventos en este cambio.
- Revisar `order_email_outbox` desde una sesión administrativa o backend. Su RLS no concede acceso a invitados ni a clientes autenticados.
- Para pausar envíos sin afectar ventas, desprogramar únicamente `cubica-order-emails` con `cron.unschedule`. Los nuevos pedidos seguirán guardándose y sus entregas quedarán pendientes.

Fuentes: [programación de Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions), [autenticación de Edge Functions](https://supabase.com/docs/guides/functions/auth-headers), [idempotencia de Resend](https://resend.com/changelog/idempotency-keys).

## Estado de implementación (11 de octubre de 2026, Buenos Aires)

Se inspeccionó directamente el catálogo del proyecto: columnas/tipos de las tablas utilizadas, definición de `create_public_order`, triggers, RLS y permisos. Las cuatro migraciones se aplicaron con el historial de Supabase. La prueba transaccional `tests/database-rollback.sql` pasó para invitados y autenticados, guardado con precios del servidor, snapshot, bloqueo de entregas, payload estable, flags independientes y reintentos. Los datos de prueba se revirtieron; siguen existiendo los siete pedidos originales y ninguna entrega histórica se encoló.

Las herramientas administrativas de Supabase no permiten configurar secretos de Edge Functions en esta conexión; `RESEND_API_KEY` y `ORDER_EMAIL_FROM` deben guardarse en su pantalla de Secrets. Cron está activado con el trabajo `cubica-order-emails` cada minuto, y la Edge Function está desplegada. La llamada sin secreto respondió 401 y la llamada autenticada respondió 503 (`missing_server_configuration`) antes de configurar Resend. El worker no reclama entregas ni consume reintentos mientras falte configuración. Después de guardar ambos secretos, los pedidos nuevos podrán enviarse automáticamente. Falta comprobar una compra acordada y la entrega real en las bandejas.
