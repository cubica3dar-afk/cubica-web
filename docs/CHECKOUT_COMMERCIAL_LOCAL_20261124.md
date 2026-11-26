# Checkout comercial — implementación exclusivamente local

Base: `992557ca6f613b5c9fae1f764a5730abe580ee98`.
Rama: `fix/checkout-commercial-launch`. Fecha: 24 de noviembre de 2026.

No se hicieron push, PR, despliegues, pedidos reales ni escrituras en Supabase. No se cambiaron secretos, cron, correos, Etapa C, inventario productivo o información comercial existente. `github-config.js` conserva `stageCMode: "admin"` y no forma parte del diff.

## Contrato y consecuencias de arquitectura

El esquema anterior separaba pedidos y logística, pero no representaba la aprobación manual de Uber, las acreditaciones parciales ni la aceptación de una cotización independiente. Los presupuestos ya tienen condiciones comerciales en su snapshot y conversión a pedido `origin=budget`, inicialmente `accepted_unpaid`; no tenían un registro de acreditaciones parciales reutilizable.

La ampliación inicialmente preparada como propuesta fue formalizada posteriormente en `supabase/migrations/20261124145228_checkout_commercial_launch.sql`. **No fue ejecutada en producción.** La preparación, pruebas de actualización y estrategia de publicación se documentan en [la continuación del 26/11](CHECKOUT_MIGRATION_AND_QA_20261126.md). Los resultados que siguen describen la implementación inicial.

Agrega cuatro tablas privadas con RLS y sin acceso directo de clientes:

- `checkout_settings`: banco/contacto aprobados explícitamente y habilitación de solicitudes Uber. Inicia sin datos, sin aprobación y con Uber deshabilitado.
- `pickup_points`: identidad y versión estables; nombre, descripción e instrucciones públicas separados de instrucciones privadas. Puntos nuevos deshabilitados por defecto.
- `order_commercial`: acreditación de productos, acuerdo opcional de seña para presupuestos, punto de retiro elegido, autorización de ubicación privada y revisión/cotización/conformidad/acreditación Uber. El estado general del pedido conserva su significado.
- `checkout_audit`: actor, operación y datos de las acciones comerciales. No está expuesto al comprador ni a consultas anónimas.

No se rellenan registros históricos. Los pedidos de presupuesto incorporan un acuerdo financiero únicamente por una acción administrativa explícita; no se cambia su conversión, snapshot o política automáticamente. Al completar su acreditación se reutiliza `commercial_status=paid`; un pago parcial conserva `accepted_unpaid` y muestra el saldo en el nuevo panel.

Se reemplaza el contrato interno de creación conservando la RPC de servicio verificada, los bloqueos, precios de servidor, reserva de stock e idempotencia. La implementación previa queda privada, sin uso del nuevo checkout. La repetición exacta de un pedido histórico se resuelve antes de las restricciones nuevas. No se aceptan pedidos nuevos en efectivo, con transportistas, sin configuración aprobada ni con retiros arbitrarios.

`mode=uber` requiere precio de productos de servidor <= $20.000, datos completos y declaración CABA. **Esto no valida geografía**: siempre inicia `pending_review`. `charged_ars=NULL` significa costo desconocido, no envío gratis. Hay protecciones de backend para impedir que los controles logísticos anteriores o el estado general del pedido marquen una entrega Uber sin completar sus condiciones.

## Flujo implementado

1. Catálogo: transferencia del 100% de productos, inicialmente sin acreditación. Informar una transferencia no acredita fondos. Solo administrador AAL2 puede registrar dinero acreditado.
2. Presupuesto: el administrador registra el acuerdo real; seña del 50% solo al seleccionarla expresamente. El panel distingue seña acordada, acreditación real y saldo pendiente.
3. Retiro: elección obligatoria de un punto habilitado. Información pública mediante lista permitida. La ubicación privada se incorpora al pedido y solo se revela a su comprador después de confirmar el pedido y autorizar expresamente su comunicación.
4. Uber: aprobación manual de CABA y compatibilidad; cotización solo con pedido preparado; conformidad del cliente para la versión vigente; productos y traslado acreditados por separado; registro manual del despacho. El sitio no consulta tarifas ni contrata Uber.
5. Si cambia la cotización se invalida la conformidad anterior. Si la nueva tarifa es inferior a lo ya acreditado, se bloquea la operación: los reintegros requieren un procedimiento independiente, todavía no implementado. Nunca se inventa un saldo a favor ni se borra una acreditación.
6. Si Uber no resulta apto, el administrador puede cambiar **el mismo pedido** a un punto habilitado, con acuerdo del cliente y sin dinero de traslado pendiente de resolver.
7. Comprobante con número copiable, productos/variantes, cantidades, precio de servidor, acreditaciones, saldo, modalidad y datos bancarios aprobados. Invitados conservan una capacidad aleatoria privada en almacenamiento de sesión; clientes registrados deben ser propietarios reales. No se consulta un pedido por número secuencial o email.
8. Respuesta ambigua: conserva el cuerpo original, identidad y carrito; consulta una RPC de lectura. Un reintento explícito usa el mismo cuerpo e identidad. Doble clic bloqueado. El carrito solo se limpia tras leer el pedido confirmado y si no cambió mientras tanto.
9. Historial registrado: distingue Uber de retiro y permite abrir el comprobante nuevo. Pedidos anteriores conservan su seguimiento histórico.
10. La carga de ventas ya no importa automáticamente órdenes locales. Antes de reemplazar su cache, los registros sin confirmación de servidor se conservan en `.legacy-unreviewed` para revisión explícita. Si no puede guardarse ese archivo, no se sobreescriben con la carga remota. No se ofrece una importación automática alternativa.

## Componentes

- `js/checkout-commercial.js`, `js/checkout-commercial-admin.js`, `css/checkout-commercial.css`: comprador, comprobante y controles administrativos.
- `index.html`, `js/checkout-ui.js`, `js/orders-ui.js`, `supabase-sales.js`: integración, transferencia por defecto, historial y retiro del importador automático. Se actualizan identificadores de recursos para evitar reutilizar el importador anterior desde cache.
- `supabase/functions/create-order/worker.js`: normaliza `pickup_id` y dirección/barrio Uber; mantiene el formato histórico de correo para sus reintentos. No se relajan Auth, Turnstile ni límites antispam.
- Migración formal descrita arriba.
- Pruebas nuevas de handlers, privacidad y PostgreSQL; adaptación de la prueba de delegación del submit y de referencias de publicación de productos.

## Pruebas y evidencia

- `pnpm test`: los **23 scripts de regresión existentes**. La suite contiene comprobaciones aisladas y reporta expresamente sus escenarios multisesión no ejecutados; no se reinterpretan como concurrencia real.
- `pnpm test:checkout`: **106 pruebas aprobadas**, más el script de acceso MFA pendiente. Pruebas focalizadas del checkout nuevo, privacidad, seguridad Edge, perfil, navegación, catálogo y compatibilidad logística. DOM/RPC/Edge simulados; no son una prueba de navegador ni de PostgREST productivo.
- `pnpm test:checkout-postgres`: **19 comprobaciones aprobadas**. PostgreSQL portable **17.12**, nuevo directorio temporal y escucha solo en `127.0.0.1`; datos ficticios, roles y claims simulados. Usa las funciones reales existentes de validación, precio/reserva y repetición de pedidos y aplica el SQL nuevo completo sobre un esquema mínimo compatible. No es una restauración de Supabase ni una aplicación de todas sus migraciones.
- Las pruebas PostgreSQL incluyen **dos escenarios reales con conexiones independientes**: creación simultánea con la misma identidad (bloqueo y una sola reserva), y acreditaciones simultáneas con la misma versión (bloqueo y rechazo `40001`, sin sobrescritura). Se observa el bloqueo mediante `pg_blocking_pids`; no son dos llamadas secuenciales disfrazadas de concurrencia.
- Sintaxis JavaScript y `git diff --check`.
- Resultados locales detallados en `outputs/checkout-focused.log`, `outputs/checkout-regression-final.log` y `outputs/pg17-qa/checkout-*/result.json`, excluidos de Git. El servidor de cada prueba se detiene al finalizar.

El estado de entrega no se reutiliza como pago: un pedido entregado con contrato nuevo puede recibir una acreditación pendiente de productos. No se reabre su logística. Un pedido cancelado no admite avisos ni nuevas acreditaciones; su comprobante indica que no se transfiera y oculta las instrucciones bancarias.

## Límites y pendientes antes del lanzamiento

- En la entrega inicial faltaba QA de navegador. La continuación del 26/11 incorpora Chrome aislado a 1280 y 390 px; la revisión comercial manual y la integración con servicios reales siguen pendientes.
- Falta validación integral con Auth/PostgREST/Turnstile reales en un entorno de ensayo adecuado. No se enviaron pedidos ni peticiones diagnósticas a producción en esta implementación.
- El comprobante invitado sobrevive a recargas de la misma pestaña. Cerrar esa sesión del navegador puede perder su acceso privado: se pide guardar el número y coordinar con Cúbica. No hay acceso anónimo por número/email ni recuperación automática por correo.
- No se implementaron reintegros, contracargos, conciliación bancaria automática ni pasarela. Los importes acreditados se registran con verificación humana y versión esperada. Un error administrativo de acreditación requiere revisión separada; no hay botón para borrar evidencia.
- La validación de CBU es de formato; titularidad, banco y exactitud deben verificarse manualmente antes de aprobar su publicación. No hay datos bancarios reales en esta rama.
- La compatibilidad Uber se verifica contra las condiciones vigentes del servicio al coordinar cada traslado. No se codifican restricciones externas supuestamente permanentes ni se presenta una selección CABA como geolocalización.
- El carrito usa el almacenamiento local existente; la prevención de duplicados protege reintentos de una misma solicitud. Dos compras expresamente distintas, con identidades nuevas, no se consideran automáticamente duplicadas.

## QA aislada sugerida

Usar el frontend de este commit con RPC/Edge y Auth simulados, bloqueando conexiones externas. Configuración y puntos completamente ficticios. No abrir este frontend contra Supabase productivo para probar escrituras.

1. Configuración inicialmente cerrada: sin compras habilitadas, sin Uber. Crear punto deshabilitado; comprobar que no se lista. Aprobar banco ficticio y habilitar un punto solo en el simulador.
2. Invitado y cliente: retiro, transferencia, comprobante, recarga, copiar número, historial y cambio de cuenta.
3. Respuesta perdida antes y después de confirmar: carrito conservado, consulta de resultado, reintento con identidad original, doble clic sin segunda creación.
4. Uber: importes inferior/igual/superior a $20.000, dirección incompleta y fuera de CABA, aprobación/rechazo manual y cambio al mismo pedido con retiro.
5. Cotización solo preparado; consentimiento cancelado/aceptado; pago de productos y traslado separados; cambio de tarifa; bloqueo de despacho incompleto.
6. Seña de presupuesto únicamente por acuerdo expreso; saldo y versión; conflicto por otra sesión.
7. Ubicación privada ausente antes de autorización y visible únicamente en el comprobante autorizado después de confirmar el pedido.
8. Escritorio y 390 px: formularios, selecciones, mensajes, texto largo, botones y número de pedido sin desbordamiento.

## Publicación futura: requiere otra autorización

No publicar solo el frontend: depende del contrato SQL nuevo y de la actualización Edge. La migración cierra inicialmente el checkout por falta de configuración aprobada; requiere coordinar una ventana de activación, no ejecutar un cambio inadvertido durante ventas.

Antes de un Draft PR: revisar este diff y completar QA manual aislada. El archivo oficial ya fue generado y probado localmente; ver la continuación del 26/11. Después, solicitar autorización específica para push/PR. Una autorización posterior de despliegue debe cubrir por separado la migración, Edge y frontend, con comprobación de compatibilidad de reintentos históricos y configuraciones reales revisadas.

La habilitación productiva debe quedar pendiente hasta validar el conjunto: CBU/titular/banco/contacto proporcionados por Cúbica, puntos reales proporcionados por el administrador, Turnstile operativo para pedidos válidos y revisión del flujo. **Uber debe permanecer deshabilitado hasta terminar esa validación y autorizar su habilitación.** No activar Etapa C pública ni ejecutar rollback automático.
