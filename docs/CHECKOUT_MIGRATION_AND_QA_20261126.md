# Checkout: migración formal, compatibilidad y QA aislada

Fecha de informe: 26 de noviembre de 2026. Rama `fix/checkout-commercial-launch`.
Implementación de partida: `f5933d658864544cee9b9b929c57be5643280e25`, sobre `main` conocido `992557ca6f613b5c9fae1f764a5730abe580ee98`.
Este trabajo es local. No se consultó ni modificó Supabase productivo; no hubo push, PR, despliegues ni pedidos reales.

## Migración formalizada

`supabase/migrations/20261124145228_checkout_commercial_launch.sql` reemplaza el archivo candidato de `supabase/proposals/`. No deben aplicarse ambos. El identificador fue generado por `supabase migration new checkout_commercial_launch`, CLI portable oficial 3.3.0; se conserva su timestamp generado, aunque este informe se entrega el 26/11.

El contrato SQL del candidato permanece igual. Las diferencias son el encabezado, una comprobación previa de las firmas del esquema anterior y de MFA habilitado, y `NOTIFY pgrst, 'reload schema'`, entregado después del commit. No se rellenan ni reinterpretan pedidos, pagos o estados históricos. La migración entera está dentro de una transacción.

Las cuatro tablas nuevas (`private.checkout_settings`, `private.pickup_points`, `private.order_commercial`, `private.checkout_audit`) tienen RLS y carecen de permisos directos para `anon`/`authenticated`. Las escrituras administrativas pasan por funciones con `search_path` fijo, autorización real administrativa AAL2 y versión esperada. La lectura pública de puntos usa una lista de campos permitidos; la ubicación privada requiere comprador autorizado, pedido confirmado y liberación administrativa expresa. Avisar una transferencia no acredita dinero.

La configuración inicial tiene `approved=false`, `uber_enabled=false`, banco vacío y ningún punto. No cambia la bienvenida, Estética, Campañas, correos ni `stageCMode: "admin"`. Las reglas Uber conservan aprobación, cotización, aceptación y acreditaciones separadas; el límite de $20.000 usa productos y cantidades validados por servidor. Las modalidades deshabilitadas se rechazan en backend.

La migración se aplica una sola vez mediante su historial. Una segunda ejecución directa se rechaza y revierte; no se silencia el error con `IF NOT EXISTS`, porque podría ocultar un estado parcial. Si ya aparece registrada, no repetirla ni alterar su historia.

## Pruebas ejecutadas

| Prueba | Resultado y alcance |
| --- | --- |
| `pnpm test:checkout-upgrade` | 11 comprobaciones aprobadas en PostgreSQL 17.12 real y temporal. Esquema consolidado anterior más 21 migraciones históricas de dependencias. |
| `pnpm test:checkout-postgres` | 19 comprobaciones aprobadas; incluyen dos escenarios de concurrencia real con conexiones independientes, bloqueo observado y una sola reserva/rechazo de versión obsoleta. |
| `pnpm test:checkout` | 107 pruebas aprobadas más el script de permisos MFA pendientes. Incluye regresión nueva de frontend contra RPC ausente del backend anterior. |
| `pnpm test:checkout-browser` | 9 comprobaciones aprobadas en Chrome headless existente, perfil nuevo, solo loopback. No es una prueba de Supabase real. |
| Sintaxis y diff | Comprobación de los scripts modificados y `git diff --check`. |

La actualización aislada conserva una comparación exacta de pedidos históricos sintéticos, ítems, logística, movimientos, stock, cola de correo y registros cron. Comprueba el rollback completo antes de aplicar, el rechazo atómico sin MFA y el rechazo de reejecución. Después usa roles SQL `anon`, `authenticated` y `service_role`, la función histórica real `private.is_admin()` y la RPC real `public.create_verified_delivery_order()`. Se valida idempotencia de una solicitud histórica en efectivo sin crear un contrato financiero retroactivo. Las escrituras sintéticas posteriores ejercitan el nuevo flujo.

Los dos escenarios multisesión se ejecutaron nuevamente con el archivo formal: creación simultánea de la misma identidad y acreditación simultánea con la misma versión. No equivalen a una prueba completa de concurrencia a través de PostgREST.

Limitaciones del esquema aislado: Auth usa usuarios/claims sintéticos; Storage, Vault y Cron son sustitutos mínimos. HTTP de base de datos siempre lanza error. No se cargan las migraciones que instalan extensiones de correo ni activan cron. El esquema consolidado omite `orders_status_check`, que una migración posterior espera eliminar; la prueba reconstruye explícitamente ese prerrequisito sobre tablas vacías. No se repite Etapa C ni se presenta este ensayo como reconstrucción completa de producción.

Los asesores CLI se intentaron exclusivamente con destino local: `127.0.0.1:54322` respondió `ECONNREFUSED` porque no hay stack Supabase local activo. No están aprobados ni sustituidos por un supuesto check remoto. Las verificaciones de catálogos, privilegios, RLS y autorización aquí descritas sí se ejecutaron en PostgreSQL portable.

Evidencias locales excluidas de Git:

- `outputs/pg17-qa/upgrade-5hGxO7/result.json`: dependencias, SHA-256 de migración y 11 resultados.
- `outputs/pg17-qa/checkout-98HZJ9/result.json`: 19 comprobaciones, incluidas multisesión.
- `outputs/checkout-formalization-focused.log`: 107 pruebas y MFA.
- `outputs/checkout-browser-rXXnHD/result.json` y PNG: 9 comprobaciones, hashes de fuentes, solicitudes limitadas a loopback y ausencia de excepciones JavaScript.

La suite general de 23 scripts corresponde al trabajo anterior y no se repitió aquí: no cambiaron sus módulos. Estas pruebas son locales, no checks automáticos de GitHub.

## Compatibilidad y orden seguro de despliegue — NO ejecutado

| Combinación | Efecto esperado / evidencia |
| --- | --- |
| Frontend nuevo + SQL anterior | Falta `get_checkout_options`; el frontend bloquea la compra y conserva carrito. Prueba DOM focalizada con error `PGRST202`. No publicar así. |
| Frontend anterior + SQL nuevo | Pedidos nuevos sin punto válido, en efectivo o con transportista se rechazan; repetición exacta de pedidos anteriores sigue disponible. SQL real verificado. Clientes con pestañas viejas necesitarán recargar. |
| Edge anterior + frontend/SQL nuevos | El normalizador anterior elimina `pickup_id` y no acepta Uber. Rechazo seguro, pero bloqueo de compras. Conclusión de revisar ambos normalizadores y las pruebas SQL. |
| Edge nuevo + frontend/SQL anteriores | Conserva el formato histórico de retiro/transporte, identidad y protección antispam. Normalización histórica cubierta; la combinación desplegada completa no se probó. Permite actualizar Edge primero. |
| Conjunto nuevo, sin banco aprobado | Checkout cerrado deliberadamente. Uber sigue deshabilitado. Aprobación y puntos reales necesitan autorización/configuración posterior. |

No existe un cambio de frontend que vuelva compatibles mágicamente las combinaciones parciales. Tampoco se garantiza una actualización sin intervalo de cierre: debe acordarse una ventana breve y una comunicación comercial antes de intervenir.

### Antes de la ventana

1. Obtener autorización independiente para publicación de rama/PR y, posteriormente, para migración, Edge y frontend. Registrar los SHA exactos y revisar nuevamente base, diff y artefactos; no aplicar otros cambios pendientes por accidente.
2. Verificar en lectura el historial instalado contra el repositorio y la ausencia de esta nueva versión, las firmas de `private.create_delivery_order` y `private.existing_delivery_order`, MFA AAL2 habilitado y roles/grants esperados. Comprobar que `private` no está expuesto por Data API. Si hay divergencia, detenerse; no reparar historia automáticamente.
3. Revisar disponibilidad de una copia de recuperación válida y un procedimiento de recuperación. No importar backups ni restaurar conteos antiguos. Registrar los cambios legítimos en curso, usando evidencia que no divulgue información privada.
4. Validar el conjunto en un entorno Supabase de ensayo con Auth, PostgREST y Turnstile reales. Confirmar origen, hostname/action, secretos presentes y gateway invitado antes de ventas; las simulaciones no prueban Siteverify.
5. `create-order` necesita `verify_jwt=false` en el gateway, con verificación del usuario dentro del handler, para compras invitadas. Esto ya está documentado en su `index.ts`; `supabase/config.toml` no declara esa función. Al desplegar específicamente `create-order`, conservar/verificar esa opción explícitamente (`--no-verify-jwt` o configuración revisada equivalente). No tocar las otras funciones ni usar un despliegue global que cambie correos. No se modificó config.toml en este trabajo.

### Aplicación coordinada

1. Publicar únicamente la nueva Edge `create-order`, manteniendo secretos y protección de origen/Auth/Turnstile/rate limit. Verificar versión y compatibilidad del normalizador. Esta operación no autoriza crear pedidos reales de prueba.
2. Aplicar exclusivamente `20261124145228_checkout_commercial_launch.sql` mediante el historial de migraciones, después de inspeccionar el plan pendiente. Detenerse si hay otras migraciones inesperadas o bloqueos de transacciones; no forzar sesiones comerciales. El archivo aborta si falta el predecesor o MFA. Su configuración inicialmente cerrada inicia el intervalo de indisponibilidad de nuevas compras.
3. Confirmar en lectura que la versión se registró una sola vez, MFA y RLS siguen activos, no hay contratos retroactivos y `get_checkout_options()` devuelve `ready=false`, `uber_enabled=false`, sin banco ni ubicaciones privadas. Esperar a que PostgREST refresque su esquema; el `NOTIFY` no prueba por sí mismo que el cache ya esté actualizado.
4. Integrar/desplegar el frontend exacto autorizado en Pages. Verificar SHA desplegado, carga de los recursos `checkout-commercial1` (integración) y `launch1` (módulos comerciales), ausencia de errores de RPC, `stageCMode: "admin"` y que ventas no reimporta órdenes locales. No habilitar Etapa C pública.
5. Solo con autorización específica y valores reales revisados, registrar banco/contacto y puntos públicos/privados desde el panel AAL2. Mantener `uber_enabled=false`. Aprobar el banco al estar validado todo el conjunto y al existir al menos un punto habilitado: esta acción abre las compras. No usar los datos sintéticos del simulador.
6. Revisar catálogo, carrito, checkout, visibilidad de puntos y privacidad sin compras. Una prueba integral con pedido real y validación Turnstile requiere autorización separada. Uber conserva otra autorización de habilitación después de su QA.

### Ante un fallo

Si falla la transacción SQL, no reintentar a ciegas: leer estado e historial primero. Si ya se confirmó, conservar los registros y detener el avance. No eliminar tablas ni restaurar snapshots de pedidos. Si falla Pages o Edge, mantener cerrado el checkout y proponer reparación con autorización; revertir únicamente el frontend no restaura el contrato anterior. Después de activar ventas, cualquier cierre o recuperación requiere coordinación: no borrar acreditaciones, stock ni trazabilidad para simular un rollback. No hay rollback automático.

## QA visual local disponible

URL: **http://127.0.0.1:4177/**. Abrir en Chrome; no requiere login real ni cambiar dominios de autenticación. El rótulo amarillo debe decir «QA LOCAL — datos sintéticos».

Para iniciarlo si se cerró: desde este checkout ejecutar `pnpm qa:checkout`. El servidor escucha solo `127.0.0.1`, exige el Host exacto y sirve una lista limitada de archivos. `/health` entrega hashes del snapshot de frontend. Reiniciar el servidor si cambia algún archivo; la prueba de navegador rechaza snapshots desactualizados. No está previsto publicarlo ni servir la carpeta completa del repositorio.

Se utiliza la sección real de checkout de `index.html` y sus estilos/handlers de comprador y administrador sin cambios. El contenedor de QA y su barra de controles son independientes. CSP bloquea conexiones; fetch/XHR/WebSocket se bloquean además en el simulador. No se carga `github-config.js`, SDK Supabase, claves reales, productos ni datos comerciales. Turnstile y sesiones son simulados. Los botones de carrito son marcadores sin navegación a la tienda: esta QA cubre el checkout aislado, no el shell completo.

Datos: un producto ficticio con totales seleccionables $19.999/$20.000/$20.001; un punto habilitado y otro deshabilitado; banco explícitamente ficticio con CBU de ceros; ubicación privada marcada `UBICACION_PRIVADA_QA_789`; sesiones invitado/cliente/admin AAL2/admin AAL1. **Uber está habilitado solo en este simulador**, para ejercitar el flujo. No implica habilitarlo en SQL ni producción.

### Recorrido manual

1. Pulsar «Restablecer datos sintéticos». Elegir retiro y comprobar transferencia única, un solo punto habilitado, total y ausencia de ubicación privada.
2. Confirmar el pedido sintético. Revisar comprobante, número, pago pendiente y carrito vacío. Recargar: el mismo comprobante debe recuperarse. «Restablecer» borra el estado de QA; una recarga normal lo conserva para esta prueba de persistencia.
3. Abrir el registro de RPC/Edge simuladas. Con «Demora 2,5 segundos», hacer doble clic en confirmar: una sola creación. Con «Guardar y perder respuesta», consultar el resultado desde la recuperación, sin iniciar otra compra; debe aparecer un único pedido.
4. Con «Fallo de red antes de guardar», recuperar/reintentar conservando identidad. No confundir mensajes de simulación con fallos reales de Supabase. «Conflicto de versión» permite ejercitar el rechazo del panel administrativo sin una segunda sesión real.
5. Restablecer, elegir Uber y completar solo datos sintéticos. Probar $19.999, $20.000 y $20.001, campos incompletos y declaración CABA. El comprobante válido debe decir pendiente de aprobación y costo por cotizar, sin envío confirmado ni gratuito.
6. Elegir «Administrador AAL2 simulado» y «Administrar último pedido simulado». Revisar destino, aprobación/rechazo, aviso de pago y acreditaciones separadas. El botón «Marcar último pedido preparado» es un atajo exclusivo de QA. Antes de cotizar se requiere aprobación y preparación; para despacho se requiere conformidad y acreditaciones. Cambiar a retiro usa el mismo pedido con acuerdo expreso. La simulación es simplificada; PostgreSQL verifica las garantías definitivas.
7. En retiro, observar la ubicación oculta. Como admin simulado, marcar preparado y autorizar su comunicación; volver a invitado y actualizar su comprobante. El número no concede acceso por sí solo.
8. Repetir en escritorio y 390 px; revisar textos, controles, comprobante y avisos. Los PNG automatizados se inspeccionaron y no mostraron recortes o desbordamientos en esas vistas, pero no reemplazan la revisión comercial manual.

## Pendientes antes del lanzamiento

- QA manual del checkout aprobada por el usuario el 26/11/2026 sobre `63bd43c0fa5394d81e804b69f3b80f81a96fab08`: retiro coordinado, transferencia bancaria, comprobante persistente, solicitud Uber hasta $20.000, rechazo por superar el límite y cotización posterior. Esta aprobación corresponde al entorno aislado; no amplía la evidencia a servicios productivos ni a otros escenarios administrativos no informados.
- Ensayo integral Auth/PostgREST/Turnstile y verificación del gateway invitado; validación del esquema productivo real previa a migrar. El ensayo de dependencias no es una copia exacta de Supabase.
- Datos bancarios, titularidad, contacto y puntos reales revisados por Cúbica. Nunca copiar fixtures QA a configuración productiva.
- Autorizaciones independientes de push/PR, migración/despliegue, configuración comercial, pedido de prueba y eventual habilitación Uber.
- Sin recuperación automática del comprobante invitado fuera de la sesión de su pestaña, ni reintegros o conciliación bancaria automática. Estas limitaciones del commit inicial siguen vigentes.

Referencias consultadas para la formalización: [CLI migration new](https://supabase.com/docs/reference/cli/supabase-migration-new), [cambios de CLI v3](https://supabase.com/changelog/supabase-cli-v3), [release oficial 3.3.0](https://github.com/supabase/cli/releases/tag/v3.3.0). Se verificó el SHA-256 del ZIP portable contra el digest del release; no se añadieron dependencias al proyecto.

## Preparación del Draft PR — 26/11/2026

Base remota verificada: `992557ca6f613b5c9fae1f764a5730abe580ee98`. La actualización posterior a la QA es exclusivamente documental; no cambia código ni SQL y no requiere repetir las regresiones aprobadas. Migración única y ordenada, sin editar migraciones anteriores. Diff de 22 archivos limitado al checkout, eliminación de importación automática, integración e historial, pruebas y documentación; sin configuraciones de Etapa C ni correos.

No hay workflows versionados en main ni en esta rama. Se conserva como referencia la configuración de Pages confirmada por el usuario: main, raíz, sin webhooks ni integraciones externas de despliegue. La API del conector no expone esa configuración actual; no se afirma haberla releído. Push exclusivamente de la rama; Draft, sin auto-merge. No ejecutar la migración ni publicar Edge/frontend al abrir el PR.
