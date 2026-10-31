# Cúbica 3D — Preparación final de 7B v3 y lanzamiento 1.0

Fecha: 2026-10-27  
Alcance: auditoría y validación exclusivamente local  
Resultado: **7B v3 aprobado localmente; activación de Etapa C todavía bloqueada por integraciones externas y decisiones operativas**

## 1. Límites y estado de partida

No se abrió una conexión a producción, no se ejecutó `migration fetch`,
`migration list`, `db push`, SQL Editor, `migration repair`, Edge Functions ni
GitHub Pages. Tampoco se consultaron o modificaron secretos, campañas, contenido
o datos comerciales.

El estado remoto usado como punto de partida es el confirmado por Diego:

- 44 migraciones instaladas;
- 7A-1, 7A-2 y 7A-3 v3 aplicadas una sola vez;
- 27 wrappers presentes y cerrados;
- 13 tablas privadas con RLS;
- ningún contenido publicado accidentalmente.

Esta auditoría no presenta ese estado como una lectura remota nueva.

## 2. Identidad de 7B v3

| Campo | Valor |
|---|---|
| Archivo | `20261025120300_stage_c_api_storage_activation_v3.sql` |
| Versión | `20261025120300` |
| SHA-256 comprobado | `AD3FE8FDE86F4C3E5B28F9CD3C1220DC2FBB1295811E3D80584F6EE4F57C1AD8` |
| Estado remoto | No comprobado por restricción expresa; según el punto de partida, ausente |
| SQL modificado | No |
| Nuevo candidato generado | No |

El archivo coincide exactamente con el hash de referencia. Sus dependencias
son los tres bloques 7A v3 y los centinelas definitivos de 3A, 3B, 3C, 4A–4C,
5A–5C y 6 v3 que ya cubre la auditoría conjunta.

## 3. Matriz de permisos validada

| Superficie | Cantidad | Roles con `EXECUTE` tras 7B | Control adicional | Estado local |
|---|---:|---|---|---|
| Lectores públicos | 3 | `anon`, `authenticated` | Destinos privados filtran solo contenido publicado | APROBADO |
| Operaciones administrativas | 22 | `authenticated` | `private.stage_c_assert_admin()` exige perfil admin y AAL2 | APROBADO |
| Rutas internas | 2 | `service_role` | Validación SQL, idempotencia, rate limit y ACL explícita | APROBADO |

Los 27 wrappers revocan `PUBLIC` y no dependen de privilegios implícitos. Los
wrappers administrativos son `SECURITY INVOKER`; sus destinos privados son
`SECURITY DEFINER`, usan `search_path=''` y vuelven a validar administrador y
MFA AAL2. Visitante, cliente, administrador AAL1 y `service_role` no pueden
usar operaciones administrativas.

Las dos rutas internas son:

- `submit_protected_suggestion(...)`;
- `cleanup_suggestion_protection()`.

Ambas quedan cerradas para `PUBLIC`, `anon` y `authenticated`. 7B concede
`EXECUTE` únicamente a `service_role`.

## 4. RLS, Storage y privacidad

- Las 13 tablas de Etapa C conservan RLS y no reciben grants directos de
  lectura o escritura para roles API.
- El bucket `site-assets` permanece `public=false`.
- `site_assets_public_read` permite solamente objetos cuya ruta está publicada
  y vigente en `private.site_assets`.
- `site_assets_admin_read` exige `private.is_admin()`, por lo que requiere AAL2.
- El helper público de Storage devuelve un booleano y no revela filas,
  etiquetas, rutas alternativas ni metadatos privados.
- Borradores, frases inactivas, contacto de sugerencias, notas privadas,
  tokens, hashes e historial de moderación no aparecen en lectores públicos.
- 7B no inserta ni publica páginas, FAQ, frases, campañas o apariencias.

## 5. Revisión de `auth.role()`

Se localizaron dos usos relevantes en la cadena de sugerencias:

1. `private.submit_protected_suggestion(...)` en 5B v3;
2. `public.cleanup_suggestion_protection()` en 7A-3 v3.

Supabase marca `auth.role()` como obsoleto principalmente para seleccionar
roles dentro de políticas RLS y recomienda el campo `TO`. En este diseño no se
usa dentro de una política y tampoco constituye la autorización primaria: la
autorización primaria es la ACL PostgreSQL que 7B revoca y concede de forma
explícita. El chequeo del cuerpo es defensa adicional.

La alternativa `auth.jwt()->>'role'` leería la misma identidad verificada y no
demostró ser más fuerte que la ACL ya aplicada. Reescribir dos funciones ya
instaladas solo para cambiar un helper equivalente ampliaría el cambio justo
antes de la activación. Por eso:

- no se generó 7B v4;
- el hash de 7B v3 continúa válido;
- queda pendiente una prueba real del contrato con la credencial backend que
  vaya a utilizarse;
- al migrar de la clave JWT legacy `service_role` a una clave opaca
  `sb_secret_...`, se debe probar primero en un entorno aislado que PostgREST
  conserva el rol efectivo `service_role`. Si no lo hace, la corrección debe
  reemplazar ambos guards en una migración nueva, nunca editar 5B/7A ya
  instaladas.

Los workers actuales leen `SUPABASE_SERVICE_ROLE_KEY`. Supabase recomienda las
nuevas claves secretas para backend, pero su adopción es una migración de
credenciales separada y no forma parte de 7B.

## 6. Cambio de Data API del 30/10/2026

El cambio anunciado por Supabase afecta los privilegios predeterminados de
objetos nuevos. Para tablas nuevas en `public`, la exposición pasa a requerir
grants explícitos; las tablas existentes conservan sus grants. RLS sigue siendo
una capa separada.

Las funciones también requieren revisar su ACL: PostgreSQL concede `EXECUTE` a
`PUBLIC` por defecto y los proyectos Supabase pueden tener grants automáticos a
roles API. 7A/7B no dependen de estos valores predeterminados:

- 7A revoca `PUBLIC`, `anon`, `authenticated` y `service_role` al crear cada
  wrapper;
- 7B vuelve a revocar y luego concede cada permiso necesario;
- 7B inspecciona privilegios efectivos, incluida la herencia desde `PUBLIC`;
- las tablas privadas no reciben grants directos.

Conclusión: el cambio del 30/10 no obliga a agregar grants preventivos a Cúbica
y no modifica la matriz aprobada de 7B. Para objetos futuros, cada migración
debe continuar declarando los grants exactos en el mismo archivo.

Referencias oficiales:

- https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically
- https://supabase.com/docs/guides/api/securing-your-api
- https://supabase.com/docs/guides/database/functions
- https://supabase.com/docs/guides/getting-started/api-keys

## 7. Pruebas locales ejecutadas

### PostgreSQL aislado

Runner: `tests/stage-c-7ab-v3-postgres17.test.mjs`  
Motor: PostgreSQL 17.5 mediante PGlite  
Resultado: `PASS_STAGE_C_7A_7B_V3_LOCAL`

Comprobó:

- aplicación secuencial de los bloques de Etapa C y 7B v3;
- 27 wrappers, divididos en 3 lectores y 24 rutas administrativas/internas;
- permisos efectivos sin herencia de `PUBLIC`;
- rechazo de visitante, cliente, admin AAL1 y `service_role` administrativo;
- acceso administrativo exclusivamente con AAL2;
- ausencia de borradores o contenido inactivo en respuestas públicas;
- Storage publicado/privado;
- rutas internas exclusivas de `service_role`;
- 13 tablas con RLS y cero grants directos;
- ausencia de publicación automática.

### Contrato Edge de sugerencias

Runner: `tests/stage-c-5b-v3-edge-contract.test.mjs`  
Resultado: **14 escenarios aprobados, cero llamadas a producción**.

Incluye hostname, acción, antigüedad, replay, idempotencia, sesión opcional,
rate limit, error de red, indisponibilidad de Siteverify y ausencia de pedidos.

### Regresión estática/dinámica de Etapa C

Runner: `tests/site-configuration-stage-c.test.mjs`  
Resultado: **31 comprobaciones aprobadas**.

No se repitieron suites de concurrencia de 4A–5C porque 7B cambia ACL y
políticas dentro de una sola transacción y no modifica filas comerciales.

Limitaciones:

- PGlite valida PostgreSQL 17.5; producción informó PostgreSQL 17.11.
- La API Gateway, Siteverify, Storage real, secretos y Edge Runtime no pueden
  acreditarse con una simulación local.
- No se ejecutó Security Advisor ni se revisaron logs de producción por la
  prohibición de conexión remota.

## 8. Integraciones pendientes

| Requisito | Estado | Motivo |
|---|---|---|
| SQL y ACL de 7B v3 | APROBADO | Hash, sintaxis y matriz 3/22/2 validados localmente. |
| AAL2 administrativo | APROBADO local | Guard central validado; falta smoke real después de activar. |
| Turnstile en frontend | APROBADO local | Widget y acción `suggestion_submit` están integrados en código. |
| `TURNSTILE_SECRET_KEY` | PENDIENTE | Debe confirmarse su presencia sin leer el valor. |
| `SUGGESTION_RATE_LIMIT_SALT` | BLOQUEANTE | Aún no fue configurado; el worker responde 503 sin él. |
| Siteverify real | BLOQUEANTE | Solo existe validación simulada. Requiere token real y autorización para una sugerencia QA controlada. |
| Edge Function `submit-suggestion` | BLOQUEANTE | Preparada, no desplegada. Debe admitir invitados y validar JWT opcional internamente. |
| Edge Function `site-assets` | BLOQUEANTE para administración visual | Preparada, no desplegada; debe conservar verificación JWT y AAL2. |
| Job de limpieza | BLOQUEANTE para abrir sugerencias | La RPC existe, pero no hay cron productivo que la invoque. |
| Política de retención/anonimización | BLOQUEANTE para recopilar contacto | Falta decidir cuánto conservar contacto y notas; tokens duran 24 h y rate limits se limpian tras 2 días cuando vencen. |
| Frontend público/administrativo | BLOQUEANTE | Preparado localmente, no publicado. |
| Smoke real MFA AAL2 | PENDIENTE | Debe realizarse tras backend y frontend. |

No se encontraron secretos con forma de JWT o `sb_secret_...` dentro de los
archivos auditados.

## 9. Orden mínimo de activación propuesto

1. **Cerrar decisiones operativas.** Definir retención de contacto/notas,
   frecuencia de limpieza, si 1.0 será retiro solamente y la fecha/hora oficial
   de inicio comercial.
2. **Preparar dependencias sin exposición pública.** Crear
   `SUGGESTION_RATE_LIMIT_SALT`, confirmar `TURNSTILE_SECRET_KEY`, preparar los
   dos despliegues Edge y el job de limpieza sin publicar todavía el frontend.
3. **Preflight remoto separado de 7B.** Confirmar salud, 44 migraciones, 7B
   ausente, hash, 27 wrappers cerrados, 13 RLS, bucket privado, línea de base y
   dry-run exclusivo.
4. **Aplicar 7B una sola vez.** Verificar inmediatamente historial, centinelas,
   matriz 3/22/2, `PUBLIC`, RLS, Storage, contenido no publicado, integridad y
   Security Advisor.
5. **Desplegar backend coordinado.** Publicar `site-assets` con verificación JWT
   y `submit-suggestion` con la modalidad de gateway documentada para invitados;
   activar el job de limpieza.
6. **Probar sin frontend público.** Verificar AAL2, subida privada, lectura de
   recurso publicado, Turnstile/Siteverify y una única sugerencia QA autorizada.
   Confirmar que no crea pedidos, emails o inventario.
7. **Publicar frontend.** Hacer smoke de escritorio y móvil, Auth, recuperación,
   checkout, pedidos, presupuestos, Comunidad, Analytics, MFA y Etapa C.
8. **Monitorear.** Revisar logs y Security Advisor durante la ventana inicial.

Para evitar una activación parcial, los pasos 2 a 7 deben tener responsable y
ventana definida antes de instalar 7B. Si 7B falla, no reintentar sin sonda. Si
7B se aplica pero una integración crítica falla, mantener el frontend anterior
y cerrar rutas con
`supabase/rollback/20261018171500_stage_c_partial_safe_state.sql` solamente con
autorización. Ese procedimiento revoca rutas y políticas sin borrar datos.

## 10. Preparación comercial de Cúbica 1.0

| Área imprescindible | Estado | Criterio mínimo de lanzamiento |
|---|---|---|
| Compra completa | APROBADO con evidencia previa | Repetir un smoke sin compra real después del despliegue final. |
| Pedidos y notificaciones | APROBADO con evidencia previa | Confirmar workers saludables; no repetir emails reales sin autorización. |
| Entrega o retiro | APROBADO para retiro | Envío domiciliario sigue bloqueado sin APIs de transportistas; no bloquea un lanzamiento explícitamente “solo retiro”. |
| Productos, precios y stock | APROBADO con evidencia previa | Revisión manual final de catálogo, precios visibles y stock antes de abrir. |
| Experiencia móvil | PENDIENTE | Smoke real alrededor de 390 px después de publicar el frontend final. |
| Seguridad de clientes | APROBADO con pendientes conocidos | Auth, recuperación, Turnstile, RLS y MFA existen; revisar de nuevo Security Advisor. Protección de contraseñas filtradas continúa como aviso conocido si el plan no la incluye. |
| Textos comerciales y privacidad | BLOQUEANTE de negocio | Aprobar condiciones de venta, retiro, privacidad y tratamiento de sugerencias; no publicar textos ficticios. |
| Estadísticas oficiales separadas | BLOQUEANTE si se prometen contadores desde cero | Definir e implementar un corte temporal de lanzamiento antes de abrir ventas oficiales. |

## 11. Inicio de estadísticas desde cero sin borrar historial

No se recomienda borrar pedidos, eventos, usuarios, inventario, auditorías ni
migraciones. La opción segura es un **corte temporal inmutable**:

1. elegir `official_launch_at` en UTC;
2. guardarlo en una configuración privada y auditable;
3. hacer que los RPC administrativos de Analytics usen
   `max(inicio_del_filtro, official_launch_at)` para pedidos y eventos;
4. mantener una vista histórica separada, accesible solo a administración, que
   incluya la etapa pre-lanzamiento;
5. conservar cancelados y pedidos QA en el historial, pero excluirlos de
   métricas comerciales mediante las reglas ya existentes y el corte temporal.

Esto inicia los tableros oficiales en cero sin destruir trazabilidad. Requiere
una migración y pruebas separadas; no forma parte de 7B y no fue implementado en
esta auditoría.

## 12. Matriz consolidada y decisión

| Requisito | Clasificación |
|---|---|
| 7B v3: SQL, hash, dependencias y ACL | APROBADO |
| 3 lectores / 22 admin AAL2 / 2 internas | APROBADO |
| RLS, Storage privado y no filtración | APROBADO local |
| No publicación automática | APROBADO |
| Compatibilidad con cambio Data API 30/10 | APROBADO |
| Sustitución de `auth.role()` | OPCIONAL POSTLANZAMIENTO; probar al migrar a clave secreta nueva |
| Preflight remoto, instalación y Security Advisor | PENDIENTE, requiere autorización |
| Salt, Siteverify real, Edge Functions y limpieza | BLOQUEANTE para activar sugerencias |
| Retención/anonimización de contacto y notas | BLOQUEANTE para activar sugerencias |
| Publicación y smoke del frontend | BLOQUEANTE para completar Etapa C |
| Envíos domiciliarios | OPCIONAL POSTLANZAMIENTO si 1.0 se inaugura solo con retiro |
| Corte de estadísticas oficiales | BLOQUEANTE para mostrar métricas 1.0 desde cero |

### Conclusión

7B v3 está listo para un futuro preflight remoto, pero todavía no conviene
instalarlo de forma aislada. El orden mínimo es resolver retención y limpieza,
preparar secretos y Edge Functions, autorizar el preflight/instalación de 7B,
validar la integración real y recién después publicar el frontend.

La tienda puede aspirar a una 1.0 comercial con retiro coordinado, sin esperar
las APIs de transportistas, siempre que se completen el smoke móvil, los textos
comerciales/privacidad y el corte de estadísticas oficiales.

`DATABASE_WRITE=NONE`  
`PRODUCTION_CONNECTIONS=0`  
`DEPLOYMENTS=0`
