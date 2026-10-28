# Cúbica 3D — Etapa C, despliegue de producción 4C v2

Fecha: 2026-10-22 (America/Argentina/Buenos_Aires)

Resultado: `PRODUCTION_RESULT=APPLIED_ONCE_4C_V2`

## Migración aplicada

- Archivo: `20261018171255_stage_c_phrase_admin_private_function_v2.sql`
- SHA-256: `9A2A9FE644416662B0788ACF6F8EF3E1FAD00B09D44D1EAF19851B29F73D2E43`
- Versión remota: `20261018171255`
- Nombre remoto: `stage_c_phrase_admin_private_function_v2`
- Centinela: `cubica_stage_c:20261018171255`
- Función: `private.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean)`
- Retorno: `jsonb`

Se aplicó una sola migración y una sola vez. No se ejecutaron reintentos, SQL Editor, `migration repair`, rollbacks de esquema ni migraciones posteriores.

## Resultado literal sanitizado de Supabase CLI

```text
===== db push --dry-run --include-all =====
DRY RUN: migrations will *not* be pushed to the database.
Connecting to remote database...
Would push these migrations:
 • 20261018171255_stage_c_phrase_admin_private_function_v2.sql
{"upToDate":false,"dryRun":true,"migrations":["20261018171255_stage_c_phrase_admin_private_function_v2.sql"],"seeds":[],"roles":[],"message":"Finished supabase db push."}
EXIT_CODE=0

CLI_VERSION=2.121.0
TLS_MODE=verify-full
REMOTE_HISTORY_BEFORE=36_MATCHED
AUTHORIZED_FILE=20261018171255_stage_c_phrase_admin_private_function_v2.sql
SHA256=9A2A9FE644416662B0788ACF6F8EF3E1FAD00B09D44D1EAF19851B29F73D2E43
PREWRITE_CHECK=PASS_ONLY_4C_V2

===== db push real - ejecucion unica autorizada =====
Connecting to remote database...
Applying migration 20261018171255_stage_c_phrase_admin_private_function_v2.sql...
{"upToDate":false,"dryRun":false,"migrations":["20261018171255_stage_c_phrase_admin_private_function_v2.sql"],"seeds":[],"roles":[],"message":"Finished supabase db push."}
EXIT_CODE=0

PUSH_EXIT_CODE=0
PRODUCTION_RESULT=APPLIED_ONCE_4C_V2
REMOTE_HISTORY=37
```

## Verificación del objeto instalado

- Historial remoto: 37 migraciones.
- Instancias de la versión `20261018171255`: exactamente una.
- Firma y retorno: correctos.
- `SECURITY DEFINER`: activo.
- `search_path=''`: confirmado.
- Cuerpo: llama al guard central `private.stage_c_assert_admin()`.
- El guard central usa `private.is_admin()`, que exige rol administrativo y AAL2 mientras la política MFA esté activa.
- `EXECUTE`: revocado para `PUBLIC`, `anon`, `authenticated` y `service_role`.
- Wrapper `public.admin_upsert_welcome_phrase(...)`: ausente.
- 4A v2 y 4B v2 conservan sus centinelas `20261018171249` y `20261018171254`.

## Pruebas funcionales en producción

Las pruebas utilizaron datos QA dentro de una transacción y finalizaron en `ROLLBACK`.

Aprobaron:

1. rechazo de administrador AAL1;
2. aceptación de administrador AAL2;
3. creación de frase general;
4. creación de frase vinculada a campaña válida;
5. rechazo de campaña inexistente;
6. integración con la eliminación lógica de campaña de 4B v2;
7. rechazo de restauración sobre campaña retirada;
8. recuperación histórica como frase general;
9. reasignación a una campaña vigente;
10. soft-delete y restauración;
11. rechazo de revisión obsoleta;
12. no-op sin incrementar versión ni fecha;
13. rechazo de duplicados;
14. compatibilidad con `private.get_site_experience(timestamptz)`;
15. ausencia de publicación accidental.

Resultado final:

```text
qa_transaction=ROLLED_BACK
qa_phrase_residue=0
qa_campaign_residue=0
production_phrases=0
production_campaigns=0
```

El primer fixture QA intentó crear una campaña `none` sin fechas y fue rechazado por el constraint preexistente `site_campaign_dates` con SQLSTATE `23514`. Toda esa transacción se revirtió. Se corrigió solamente el fixture para usar fechas válidas y la prueba completa aprobó. No se reintentó la migración.

La prueba multisesión real permanece **NO EJECUTADA**: no se realizaron escrituras concurrentes en producción.

## Seguridad e integridad

- Tablas de Etapa C: 12/12 con RLS.
- Privilegios directos para `PUBLIC`, `anon`, `authenticated` y `service_role`: ninguno en las 12 tablas.
- Bucket `site-assets`: privado.
- Políticas públicas de `site-assets`: 0.
- Frases reales: 0.
- Campañas reales: 0.
- Residuos QA: 0.

Conteos comerciales antes y después:

| Entidad | Antes | Después |
| --- | ---: | ---: |
| Productos | 16 | 16 |
| Insumos | 36 | 36 |
| Pedidos | 17 | 17 |
| Movimientos de inventario | 11 | 11 |

## Security Advisor y logs

Security Advisor no añadió hallazgos atribuibles a 4C v2. Permanecen los avisos previos:

- 8 avisos informativos de tablas privadas con RLS y sin políticas;
- 1 advertencia de función `SECURITY DEFINER` anónima;
- 17 advertencias de funciones `SECURITY DEFINER` ejecutables por autenticados;
- protección contra contraseñas filtradas desactivada.

En la ventana del despliegue no hubo errores del CLI, del Session Pooler ni de autenticación PostgreSQL. El único error PostgreSQL fue el SQLSTATE `23514` del primer fixture QA descrito arriba; no corresponde a la migración y no dejó datos.

## Pendientes y límites

- La función permanece cerrada a la Data API; no hay wrapper público activo.
- La concurrencia real con dos sesiones independientes debe validarse en un PostgreSQL aislado antes de activar wrappers.
- Las migraciones futuras `20261018171400` y `20261018171511` todavía verifican el centinela antiguo `20261018171253`. Deben corregirse antes de sus propios preflights.
- No se desplegaron frontend, Edge Functions, secretos, campañas, frases reales ni otros bloques.

Estado final: **4C v2 instalada, verificada y funcionalmente cerrada; solamente esta migración fue aplicada**.
