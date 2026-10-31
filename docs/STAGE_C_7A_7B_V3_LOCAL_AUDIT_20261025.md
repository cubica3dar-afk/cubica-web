# Cúbica 3D — Auditoría local conjunta de 7A y 7B

Fecha: 2026-10-25  
Alcance: preparación y validación exclusivamente local  
Resultado: **APROBADO LOCALMENTE; NO AUTORIZADO PARA PRODUCCIÓN**

## 1. Resumen ejecutivo

La cadena 7A/7B no debía desplegarse en su versión v2. La revisión encontró y
corrigió tres incompatibilidades:

1. 7A-1 v2 exigía el centinela reemplazado de 6 v2
   (`cubica_stage_c:20261018171401`).
2. 7A-1 verificaba el centinela de 5A sobre `admin_upsert_faq`, aunque 5A v2 lo
   coloca correctamente en `admin_restore_faq`.
3. La política pública de Storage de 7B v2 consultaba directamente
   `private.site_assets` desde `anon`/`authenticated`, pero esa tabla está
   deliberadamente cerrada. Esto podía convertir una lectura autorizada en un
   error de permisos.

Se prepararon cuatro migraciones v3 coordinadas. 7A crea los wrappers sin
permisos de ejecución; 7B activa una matriz explícita y se autoaudita antes de
confirmar. La política pública de Storage usa ahora un helper booleano privado
que no expone registros ni metadatos.

La validación en PostgreSQL 17.5 y la regresión completa aprobaron. No hubo
conexiones a producción, escrituras remotas, despliegues, secretos ni cambios
en datos comerciales.

## 2. Migraciones candidatas y hashes

| Orden | Bloque | Archivo | SHA-256 |
|---:|---|---|---|
| 1 | 7A-1 v3 | `20261025120000_stage_c_public_appearance_wrappers_closed_v3.sql` | `0234A0D9CDFE82DBFE9EE13BF457A6143DFF3B8EC3B7319AB0C43162F1B3BA39` |
| 2 | 7A-2 v3 | `20261025120100_stage_c_campaign_content_wrappers_closed_v3.sql` | `9862DF29ED22BF85C25ACE52E69A727BDD8FD2C0E056A626466B5928AC0A1659` |
| 3 | 7A-3 v3 | `20261025120200_stage_c_suggestion_wrappers_closed_v3.sql` | `C9499874A7F84F8D2111CC9B05D8951D9387C0F3DD9B4CBB4BE329CC03001B1D` |
| 4 | 7B v3 | `20261025120300_stage_c_api_storage_activation_v3.sql` | `AD3FE8FDE86F4C3E5B28F9CD3C1220DC2FBB1295811E3D80584F6EE4F57C1AD8` |

Las versiones v2 permanecen archivadas e intactas con sus hashes históricos:

- 7A-1 v2: `65202B55CA0CBF2B0C0C9E0DD38965D628C10ABD26BBCD1B3ACD2ED40F65BC49`.
- 7A-2 v2: `885C94030C32D7C1FB12406A0BE2CF3573C85830898408AE69ABC82856B2E1F5`.
- 7A-3 v2: `58B157B66C6878329A839BE1941E1C46616CF83F163D88DB7403F6280D621EE6`.
- 7B v2: `3BCBDBB6488C9230B8969AED93497F7523411CC9C37B5EC5673E6CA1077FD47B`.

## 3. Inventario completo de wrappers

El total correcto es **27 RPC públicas**: tres lectores públicos y 24 rutas
administrativas/internas. Los 24 pedidos en la auditoría corresponden a 22
wrappers administrativos más dos rutas exclusivas de `service_role`.

### Lectores públicos — 3

| Firma | Resultado | Modo | Roles tras 7B | Efecto observable |
|---|---|---|---|---|
| `get_site_experience()` | `jsonb` | `SECURITY INVOKER` | `anon`, `authenticated` | Apariencia publicada/predeterminada, campaña activa, frases activas y rutas de recursos autorizadas. No devuelve borradores. |
| `get_public_content_page(text)` | `jsonb` | `SECURITY INVOKER` | `anon`, `authenticated` | Solo la versión publicada de la página solicitada; ausencia devuelve `null`. |
| `get_public_faq()` | `jsonb` | `SECURITY INVOKER` | `anon`, `authenticated` | Solo FAQ activas y no eliminadas. |

Sus tres destinos en `private` son `SECURITY DEFINER`, tienen
`search_path=''`, filtran exclusivamente contenido público y reciben los mismos
grants mínimos. `service_role` no los necesita y no recibe `EXECUTE`.

### Administración visual — 7

- `admin_get_site_configuration() → jsonb`
- `admin_save_site_appearance_draft(jsonb,integer) → jsonb`
- `admin_publish_site_appearance(integer) → jsonb`
- `admin_reset_site_appearance_draft(integer) → jsonb`
- `admin_restore_original_appearance_draft(integer) → jsonb`
- `admin_register_site_asset(text,text,text,text,bigint,integer,integer) → jsonb`
- `admin_retire_site_asset(uuid) → void`

### Campañas, frases, contenidos y FAQ — 11

- `admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer,uuid) → jsonb`
- `admin_set_site_campaign_state(uuid,text,integer,uuid) → jsonb`
- `admin_duplicate_site_campaign(uuid,integer,uuid) → jsonb`
- `admin_delete_site_campaign(uuid,integer) → void`
- `admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean) → jsonb`
- `admin_save_content_draft(text,text,jsonb,integer) → jsonb`
- `admin_publish_content_page(text,integer) → jsonb`
- `admin_restore_content_version(text,integer,integer) → jsonb`
- `admin_upsert_faq(bigint,text,text,boolean,integer,integer,boolean) → jsonb`
- `admin_list_faq(boolean) → jsonb`
- `admin_restore_faq(bigint,integer) → jsonb`

### Administración de sugerencias — 4

- `admin_list_suggestions(integer,integer,text,text,text,text,text) → jsonb`
- `admin_get_suggestion(uuid) → jsonb`
- `admin_update_suggestion(uuid,text,text,integer,text) → jsonb`
- `admin_set_suggestion_lifecycle(uuid,text,integer,text) → jsonb`

Los 22 wrappers administrativos son `SECURITY INVOKER`, tienen
`search_path=''` y solo reciben `EXECUTE` para `authenticated`. Sus 22 destinos
privados son `SECURITY DEFINER`, `search_path=''` y ejecutan
`private.stage_c_assert_admin()`. Por eso el grant al rol autenticado no basta:
el backend vuelve a exigir perfil administrador y JWT AAL2. `anon`,
`service_role` y `PUBLIC` quedan revocados.

### Rutas internas — 2

| Firma | Resultado | Modo | Rol tras 7B | Protección |
|---|---|---|---|---|
| `submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)` | `jsonb` | `SECURITY DEFINER` | solo `service_role` | Entrada ya validada por Edge; validación SQL, replay, idempotencia, deduplicación y rate limit atómicos. |
| `cleanup_suggestion_protection()` | `void` | `SECURITY DEFINER` | solo `service_role` | Comprueba además `auth.role()='service_role'`. |

## 4. Matriz de acceso validada

| Superficie | Visitante | Cliente autenticado | Admin AAL1 | Admin AAL2 | `service_role` |
|---|---:|---:|---:|---:|---:|
| Experiencia/contenido/FAQ públicos | Sí | Sí | Sí | Sí | No requerido |
| Administración | No | No | No | Sí | No |
| Envío protegido de sugerencia | No | No | No | No | Sí |
| Limpieza de protección | No | No | No | No | Sí |
| Lectura directa de tablas privadas | No | No | No | No | No por grant directo |
| Storage: recurso publicado | Sí | Sí | Sí | Sí | No concedido por esta etapa |
| Storage: recurso privado | No | No | No | Sí | No concedido por esta etapa |

La prueba real en el PostgreSQL aislado confirmó los rechazos de visitante,
cliente y administrador AAL1, y el acceso administrativo de AAL2.

## 5. Storage y exposición pública

El bucket `site-assets` continúa con `public=false`. Se crean exactamente dos
políticas de lectura:

- `site_assets_public_read`: solo permite el objeto cuyo `name` coincide con
  una fila vigente y publicada. Usa
  `private.stage_c_public_asset_allowed(text)`.
- `site_assets_admin_read`: permite lectura privada solo cuando
  `private.is_admin()` confirma administración AAL2.

El helper nuevo devuelve únicamente booleano, es `SECURITY DEFINER`, usa
`search_path=''`, tiene `EXECUTE` solo para `anon` y `authenticated`, y no
devuelve identificadores, etiquetas, rutas alternativas ni metadatos. Esto
mantiene cerrada `private.site_assets` y evita el error de permisos de v2.

## 6. Publicado, inactivo, borradores y datos privados

- Apariencia: el público recibe la publicada o la configuración segura
  predeterminada; nunca el borrador administrativo.
- Campañas: solo una campaña publicada, vigente y no eliminada puede afectar la
  experiencia; prioridades, recurrencia anual, cruces de año y 29 de febrero
  conservan la lógica ya validada.
- Frases: solo activas, no eliminadas y vinculadas a la campaña efectiva; si no
  existen, aplica el fallback general activo.
- Contenidos: solo versiones `published`.
- FAQ: solo filas activas y no eliminadas.
- Sugerencias: listado administrativo omite contacto y notas privadas; el
  detalle autorizado AAL2 puede recuperarlos. No existe lectura pública.
- Tablas: las 13 tablas de Etapa C mantienen RLS y no reciben grants directos de
  lectura o escritura para roles de API.

## 7. Compatibilidad con Edge Functions y antispam

El worker `submit-suggestion` llama exactamente a
`submit_protected_suggestion` con diez parámetros. Antes del RPC valida
Turnstile, `hostname`, acción, antigüedad, origen de red y sesión; transforma
token, red y actor a hashes con un salt privado. La clave de servicio queda en
la Edge Function.

Persistencia y retención observadas:

- `suggestion_token_uses`: token/actor/red/payload hasheados, con vencimiento de
  24 horas; la limpieza elimina filas cuando `expires_at < now()`.
- `suggestion_rate_limits`: identidades hasheadas; la limpieza elimina ventanas
  antiguas después de dos días cuando el bloqueo también venció.
- `site_suggestions`: asunto, descripción, contacto opcional, estado y notas
  privadas. No existe eliminación temporal automática del contacto o de las
  notas; requiere una decisión explícita de retención.
- No se encontró cron/job de producción que invoque la limpieza. La RPC está
  preparada, pero programarla es una tarea separada.

No se configuraron secretos ni se ejecutó Siteverify real en esta auditoría.

## 8. Pruebas ejecutadas

### Auditoría específica 7A/7B en PostgreSQL 17.5

Resultado: `PASS_STAGE_C_7A_7B_V3_LOCAL`.

- Aplicación secuencial de los 14 bloques instalados de Etapa C y los cuatro
  candidatos v3.
- Estado cerrado tras cada 7A.
- 27 wrappers presentes; 3 lectores y 24 administrativos/internos.
- Firmas, resultados, modos, `search_path` y ACL.
- Guardia AAL2 en los 22 destinos administrativos privados.
- Rechazo de visitante, cliente, admin AAL1 y `service_role` administrativo.
- Acceso de admin AAL2.
- Exclusión pública de borradores, frases inactivas, FAQ y páginas no publicadas.
- Storage: publicado visible, privado invisible salvo admin AAL2.
- Sugerencia interna válida y limpieza invocable solo por `service_role`.
- 13 tablas con RLS y cero grants directos.
- Valores seguros de 6 v3 sin cambios al instalar 7A/7B.

### Regresión completa

`pnpm test`: **exit code 0**.

- Presupuestos y privacidad del PDF.
- UX y navegación.
- Etapa A y categorías.
- Etapa B y Comunidad.
- Calendario/29 de febrero.
- 4A, 4B, 4C, 5B, 5C y 6.
- Contrato Edge 5B: 14 escenarios sin llamadas a producción.
- Etapa C estática/dinámica: 31 comprobaciones.

Las pruebas previas de concurrencia real pertenecen a 4A/4B/4C/5B/5C y se
mantienen documentadas. 7A/7B no necesita una nueva carrera multisesión: crea
funciones y modifica ACL/políticas dentro de transacciones de migración, sin
actualizar filas comerciales ni ejecutar operaciones funcionales concurrentes.

## 9. Recuperación y estados parciales

- Cada migración se ejecuta transaccionalmente; un error en sus auto-chequeos
  revierte ese bloque.
- 7A deja una superficie segura aun instalado parcialmente porque todos sus
  wrappers nacen revocados.
- No debe instalarse 7B hasta confirmar 7A-1, 7A-2 y 7A-3 por historial,
  centinela, verificación individual y sonda.
- La contención no destructiva está en
  `supabase/rollback/20261018171500_stage_c_partial_safe_state.sql`: vuelve a
  cerrar wrappers, revoca el helper, elimina las políticas de Etapa C, mantiene
  el bucket privado y reafirma RLS/ACL sin borrar datos.
- Si una conexión termina durante el despliegue, no se reintenta: primero se
  cruzan historial, centinela, objetos, ACL y políticas.

## 10. Riesgos y bloqueos antes de producción

1. Hacer un preflight independiente para cada bloque y exigir un único archivo
   pendiente en el dry-run.
2. Reconciliar el historial remoto, que según el último estado autorizado tiene
   41 migraciones; esta auditoría no lo volvió a consultar.
3. Confirmar los hashes inmediatamente antes de copiar al directorio aislado.
4. Configurar `SUGGESTION_RATE_LIMIT_SALT` y confirmar
   `TURNSTILE_SECRET_KEY` antes de desplegar la Edge Function.
5. Ejecutar Siteverify real y prueba de integración mediante autorización
   separada.
6. Definir el job de limpieza y la política de retención de contacto/notas.
7. Desplegar Edge Functions y frontend solo después de backend, con una
   autorización independiente.
8. Ejecutar Security Advisor y verificaciones remotas después de cada eventual
   instalación. No se ejecutó en esta fase porque se prohibieron conexiones a
   producción.

## 11. Estado de producción

Producción permanece intacta según el alcance de esta tarea: cero conexiones,
cero migraciones, cero dry-runs remotos, cero RPC activadas, cero cambios de
Storage, cero secretos y cero despliegues. No se afirma un estado remoto nuevo;
el último punto de partida documentado sigue siendo 6 v3 aplicado, 41
migraciones y 7A/7B ausentes.

## Conclusión formal

Los cuatro candidatos **7A-1 v3, 7A-2 v3, 7A-3 v3 y 7B v3 son coherentes y
aptos para iniciar un futuro preflight controlado**, en ese orden. Esta
conclusión no autoriza su instalación. La activación funcional completa de la
Etapa C continúa bloqueada hasta resolver secretos, limpieza/retención,
Siteverify real, Edge Functions, frontend y validación remota posterior.

Referencias de seguridad consultadas:

- Supabase, Database Functions: https://supabase.com/docs/guides/database/functions
- Supabase, Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase, Storage access control: https://supabase.com/docs/guides/storage/security/access-control
- Supabase, Auth MFA: https://supabase.com/docs/guides/auth/auth-mfa
- Supabase, breaking changes: https://supabase.com/changelog?types=breaking-change
