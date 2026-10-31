# Cúbica 3D — preparación comercial para inauguración 1.0

Fecha: 27 de octubre de 2026  
Alcance: auditoría local y documental, sin conexión ni escrituras en producción.

## Veredicto ejecutivo

**Cúbica puede inaugurar sin instalar 7B.** El comercio actual —catálogo, producto,
carrito, checkout protegido, pedidos, emails, administración, inventario y retiro— no
depende de los 27 wrappers de Etapa C.

No recomiendo abrir ventas todavía sin cerrar tres condiciones P0:

1. Definir y registrar el cobro real. Hoy el pedido conserva `Efectivo` o
   `Transferencia`, pero no existe para pedidos normales un estado auditable de pago,
   fecha de acreditación ni referencia. El propio checkout y el email aclaran que el
   pedido no acredita el pago.
2. Congelar una versión de lanzamiento que no muestre funciones de Etapa C cerradas.
   El candidato local actual carga `site-experience.js` y muestra enlaces a contenidos,
   FAQ y sugerencias. El fallback visual evita romper la tienda, pero esos accesos quedan
   degradados mientras 7B siga cerrado.
3. Completar la aceptación final de producción: datos comerciales, recuperación con un
   enlace válido, móvil real y dos recorridos controlados (invitado y autenticado).

No se ejecutó ninguna compra, migración, despliegue, secreto ni modificación de datos.

## Matriz de preparación

| Área | Estado | Evidencia y pendiente |
|---|---|---|
| Catálogo y ficha de producto | **IMPLEMENTADO Y VERIFICADO** | URLs compartibles, variantes, cantidades, disponibilidad y compra directa cubiertas por pruebas. El catálogo público usa datos de Supabase. |
| Carrito y checkout | **IMPLEMENTADO Y VERIFICADO** | Página completa, resumen, protección Turnstile, doble clic, reintentos y errores de red cubiertos. Un pedido QA real previo atravesó `create-order`. |
| Compra invitada | **IMPLEMENTADO Y VERIFICADO** | Pedido QA real con retiro, persistencia, dos emails, cancelación y restitución trazable. El invitado debe luego crear una cuenta con el mismo email para consultar el pedido. |
| Compra autenticada | **IMPLEMENTADO PERO SIN PRUEBA REAL RECIENTE** | Automatización y SQL reversible aprobados; falta un recorrido productivo controlado sobre la versión final. |
| Persistencia y consulta de pedidos | **IMPLEMENTADO Y VERIFICADO** | Pedido persistido, reclamo seguro por email confirmado, RLS y vista del cliente. Los estados internos no se entregan por el RPC de cliente. |
| Emails de pedido | **IMPLEMENTADO Y VERIFICADO** | Envíos reales previos a cliente y administración; outbox, reintentos e idempotencia probados. El correo confirma recepción, no pago. |
| Gestión administrativa | **IMPLEMENTADO Y VERIFICADO** | MFA AAL2, ciclo de pedido, BOM, faltantes, movimientos y cancelación probados. |
| Retiro coordinado | **IMPLEMENTADO Y VERIFICADO** | Requiere teléfono, no domicilio y cobra $0. Es la modalidad apta para el lanzamiento. |
| Envío domiciliario | **INCOMPLETO / OPCIONAL POSTLANZAMIENTO** | Los transportistas reales no están integrados y el sistema bloquea correctamente tarifas inventadas. Debe permanecer desactivado. |
| Forma de pago | **IMPLEMENTADO PARCIALMENTE** | Se guarda la opción elegida y se muestra en pedido/email. No procesa dinero ni entrega instrucciones de transferencia. |
| Confirmación real del cobro | **BLOQUEANTE PARA INAUGURAR** | No hay `payment_status`, `paid_at`, referencia ni acción administrativa equivalente para pedidos de tienda. `commercial_status` no resuelve esto: en pedidos normales queda en `store_checkout`. |
| Precios y stock | **IMPLEMENTADO Y VERIFICADO TÉCNICAMENTE** | El backend relee precios, variantes y stock; no confía en importes del navegador y evita doble reserva. Falta la aprobación comercial final de los 16 productos publicados, sus precios, variantes y existencias reales. |
| Móvil | **IMPLEMENTADO Y VERIFICADO EN QA PREVIA** | Revisado antes en 360/414/768/1280 px; falta smoke test manual sobre la versión exacta de lanzamiento y un teléfono real. |
| Recuperación de contraseña | **IMPLEMENTADO PERO SIN PRUEBA REAL RECIENTE** | La prioridad de navegación y el formulario aprobaron pruebas locales; falta validar un enlace real, cambio de clave y acceso con la nueva clave sobre la versión final. |
| Privacidad y seguridad de compradores | **IMPLEMENTADO Y VERIFICADO** | Precios server-side, ruta antigua cerrada, Turnstile obligatorio, idempotencia, direcciones privadas, aislamiento por cuenta y MFA administrativo fueron auditados previamente. |
| Textos comerciales y legales | **INCOMPLETO / P0** | Con 7B cerrado, los enlaces locales de Contacto, Términos, Normas y FAQ no deben publicarse como si funcionaran. Antes de abrir ventas deben existir, al menos, contacto, condiciones de pago/retiro, cambios/cancelaciones y privacidad en una forma pública estable. |

La comprobación local focalizada de este informe ejecutó **133 pruebas, 133 aprobadas y
0 fallos** sobre producto, checkout, perfiles, entrega, pedidos, emails, protección y
recuperación. Las validaciones productivas citadas son evidencia histórica ya aprobada;
no se realizó una lectura remota nueva en esta tarea.

## Funcionamiento sin 7B

Los componentes comerciales activos usan `create-order`, las funciones de pedidos,
Auth, catálogo, inventario y el outbox de emails. No necesitan los wrappers de Etapa C.

El mecanismo mínimo recomendado es:

1. Mantener 7B sin instalar y los 27 wrappers cerrados.
2. Mantener en producción la última versión comercial comprobada mientras se prepara el
   corte 1.0.
3. En la versión 1.0, usar una única bandera de compilación/configuración
   `stageCEnabled=false` para no cargar `js/site-experience.js`, no mostrar
   Configuración, páginas dinámicas, FAQ ni Sugerencias, y no emitir llamadas a RPC de
   Etapa C.
4. Conservar una apariencia y textos estáticos seguros. El checkout, pedidos y Auth no
   deben quedar detrás de esa bandera.

No alcanza con dejar que las RPC fallen silenciosamente: el módulo local conserva la
apariencia por defecto, pero sus enlaces públicos mostrarían contenidos no disponibles.
Si no se prepara esa bandera, la alternativa segura es **no desplegar el frontend local
de Etapa C** antes del lanzamiento.

## Cobro: decisión mínima de lanzamiento

El gateway de pago online no es indispensable para una primera versión, pero sí lo es
saber si un pedido fue cobrado.

Propuesta mínima P0:

- estados de cobro `pending`, `confirmed`, `refunded` y `cancelled` separados del ciclo
  de producción;
- `paid_at`, método confirmado, referencia opcional y administrador que confirmó;
- operación backend idempotente, administrativa y AAL2;
- no permitir interpretar `Confirmado`, `En producción` o `Entregado` como “pagado”;
- mostrar instrucciones reales de transferencia solo si están definidas y mantenerlas
  fuera de datos manipulables por el navegador;
- métricas “pedidos recibidos” y “ventas cobradas” separadas.

Atajo comercial posible, si Diego lo acepta expresamente: lanzar inicialmente **solo con
efectivo al retirar**, ocultar Transferencia y aplicar un protocolo manual de cobro antes
de marcar Entregado. Es más rápido, pero deja una auditoría de caja más débil; no es la
recomendación final para operar de forma sostenida.

## Inicio oficial y datos históricos

No se deben borrar pedidos, movimientos, usuarios, auditorías ni migraciones.

1. Crear una configuración privada de una sola fila con `official_launch_at` en
   `timestamptz`, sin grants directos para `anon` ni `authenticated`.
2. Fijar el instante una sola vez al abrir ventas y guardar actor, motivo y auditoría.
3. Aplicar `max(inicio_del_filtro, official_launch_at)` a pedidos, eventos y embudo de
   Analytics. Los conteos de catálogo, inventario y Comunidad siguen siendo su estado
   actual, no “cero”.
4. Para finanzas, contar como facturación oficial solo cobros confirmados. El Analytics
   actual suma todo pedido no cancelado y, sin estado de pago, no representa caja real.
5. Mantener una clasificación privada y aditiva de registros preexistentes:
   `real`, `qa`, `demo` o `unknown`, con entidad, ID, motivo, evidencia, actor y fecha.
   No alterar la fila original.
6. Antes de cualquier depuración futura: exportación cifrada, hash, conteos por tabla,
   grafo de dependencias, simulación, revisión manual y rollback. Preservar el pedido QA
   cancelado y sus movimientos como trazabilidad; no borrarlo para “poner los números en
   cero”.

Así, los tableros oficiales comienzan en cero en el instante de apertura sin perder la
historia técnica que protege a Cúbica.

## Modalidad comercial inicial

- Publicar únicamente **Retiro personal coordinado — $0**.
- Mantener envío domiciliario deshabilitado hasta disponer de tarifas reales.
- Indicar antes de confirmar: zona o punto de coordinación, horarios/canal de contacto,
  plazo estimado, método de pago disponible y que el pedido no equivale a pago.
- No prometer seguimiento, despacho, pago online ni acreditación automática.

## Secuencia mínima de aceptación antes de abrir

1. Congelar commit/configuración de lanzamiento; verificar que Etapa C no sea visible ni
   genere llamadas fallidas.
2. Revisar manualmente los 16 productos: publicación, imágenes, precio, stock, variante,
   plazo y posibilidad real de fabricación.
3. En móvil real, como invitado: producto → variante → carrito → checkout → retiro $0 →
   pedido controlado → email de cliente y administración → aparición en admin.
4. Repetir una sola vez autenticado: autofill, pedido, Mis pedidos y aislamiento respecto
   de otra cuenta.
5. Verificar cobro según el modelo P0 elegido, registro administrativo y que producción
   no se inicie antes de la regla comercial definida.
6. Avanzar el pedido controlado por preparación y retiro sin duplicar stock, BOM, emails
   ni movimientos; cancelar o cerrar según el protocolo QA aprobado.
7. Probar cambio de contraseña con enlace real y confirmar que la clave anterior deja de
   funcionar.
8. Probar un corte de red después de pulsar Confirmar, doble clic, reintento con la misma
   identidad, teléfono/email inválidos y Turnstile vencido. Debe haber como máximo un
   pedido y el carrito debe conservarse ante fallo.
9. Conciliar pedido, stock, movimientos, outbox y correos; clasificar el pedido como QA y
   confirmar que los tableros oficiales lo excluyen por fecha/clasificación.

Estas pruebas requieren una autorización productiva separada. No se ejecutaron aquí.

## Prioridades

### P0 — indispensables

- Resolver el registro real del cobro o aceptar explícitamente el lanzamiento temporal
  solo con efectivo al retirar.
- Preparar el frontend 1.0 sin superficies de Etapa C cerradas.
- Publicar información comercial mínima y veraz: contacto, retiro, pago, cancelaciones y
  privacidad.
- Validar precios/stock/variantes y completar los recorridos productivos controlados.
- Revalidar recuperación real y móvil sobre el artefacto final.
- Fijar `official_launch_at` antes del primer pedido oficial.

### P1 — mejora importante

- Pago online o conciliación automatizada de transferencias.
- Consulta de pedido para invitado sin obligarlo a crear una cuenta, mediante enlace de
  capacidad seguro y revocable.
- Envíos domiciliarios cuando existan contratos y cotización real.
- Alertas operativas de outbox, pedidos pendientes y cobros pendientes.

### P2 — poslanzamiento

- Instalar/activar 7B y desplegar Etapa C.
- Campañas, apariencia dinámica, FAQ administrable y sugerencias.
- Automatizar retención/anonimización de sugerencias y limpieza programada.

## Pendientes de Etapa C, separados del lanzamiento

7B v3 permanece sin instalar. Continúan pendientes, sin ser bloqueadores del comercio
base: `SUGGESTION_RATE_LIMIT_SALT`, Siteverify de sugerencias, las Edge Functions de
sugerencias y recursos visuales, limpieza programada, política de retención y
anonimización, grants finales y frontend de Etapa C.

## Recomendación final

**GO condicionado.** La arquitectura de venta base está suficientemente probada para
inaugurar sin 7B. El único vacío funcional comercial de fondo es el cobro: el sistema
registra pedidos, no pagos. Cerrado ese punto, aislada la interfaz de Etapa C y superada
la aceptación final, Cúbica puede abrir con retiro coordinado y sin envíos domiciliarios.
