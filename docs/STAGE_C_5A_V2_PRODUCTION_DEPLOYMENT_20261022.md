# Cúbica 3D — Etapa C — Instalación de producción 5A v2

Fecha: 2026-10-22 (America/Argentina/Buenos_Aires)

Resultado: **INSTALADA UNA SOLA VEZ Y VERIFICADA**.

Se aplicó exclusivamente
`20261018171256_stage_c_content_faq_private_functions_v2.sql`. No se aplicaron
5B, 5C, 6, 7A, 7B ni otras migraciones; no se activaron wrappers, Edge
Functions ni frontend.

## Aplicación mediante Supabase CLI

- CLI: 2.121.0.
- Conexión: Session Pooler IPv4 con TLS `verify-full` y CA oficial.
- Contraseña: ingresada de forma oculta; no se imprimió ni se persistió.
- SHA-256:
  `17BEF84D211B74F54A9354E0EB7F4887F065F751A3E7E0FE494905BC3772CB66`.
- Historial remoto previo: 37 migraciones.
- Historial remoto posterior: 38 migraciones.
- Registro nuevo: versión `20261018171256`, nombre
  `stage_c_content_faq_private_functions_v2`, exactamente una vez.

Salida literal sanitizada relevante:

```text
===== db push --dry-run --include-all =====
DRY RUN: migrations will *not* be pushed to the database.
Connecting to remote database...
Would push these migrations:
 • 20261018171256_stage_c_content_faq_private_functions_v2.sql
{"upToDate":false,"dryRun":true,"migrations":["20261018171256_stage_c_content_faq_private_functions_v2.sql"],"seeds":[],"roles":[],"message":"Finished supabase db push."}
EXIT_CODE=0

CLI_VERSION=2.121.0
TLS_MODE=verify-full
CA_FILE=prod-ca-2021.crt
REMOTE_HISTORY_BEFORE=37_MATCHED
AUTHORIZED_FILE=20261018171256_stage_c_content_faq_private_functions_v2.sql
SHA256=17BEF84D211B74F54A9354E0EB7F4887F065F751A3E7E0FE494905BC3772CB66
PREWRITE_CHECK=PASS_ONLY_5A_V2

===== db push real - ejecucion unica autorizada =====
Connecting to remote database...
Applying migration 20261018171256_stage_c_content_faq_private_functions_v2.sql...
{"upToDate":false,"dryRun":false,"migrations":["20261018171256_stage_c_content_faq_private_functions_v2.sql"],"seeds":[],"roles":[],"message":"Finished supabase db push."}
EXIT_CODE=0

PUSH_EXIT_CODE=0
PRODUCTION_RESULT=APPLIED_ONCE_5A_V2
REMOTE_HISTORY=38
```

## Objetos instalados

- Columna `private.site_content_versions.source_draft_version`.
- Constraint `site_content_source_draft_version_positive`.
- Índice parcial único `site_content_one_publish_per_draft`.
- Índice parcial único `site_faq_unique_current_question`.
- Centinela:
  `private.admin_restore_faq(bigint,integer)` =
  `cubica_stage_c:20261018171256`.

Funciones verificadas:

| Función | Retorno | Seguridad |
|---|---|---|
| `private.stage_c_normalize_faq_question(text)` | `text` | invoker |
| `private.get_public_content_page(text)` | `jsonb` | definer |
| `private.get_public_faq()` | `jsonb` | definer |
| `private.stage_c_validate_content(jsonb)` | `jsonb` | invoker |
| `private.admin_save_content_draft(text,text,jsonb,integer)` | `jsonb` | definer |
| `private.admin_publish_content_page(text,integer)` | `jsonb` | definer |
| `private.admin_restore_content_version(text,integer,integer)` | `jsonb` | definer |
| `private.admin_list_faq(boolean)` | `jsonb` | definer |
| `private.admin_upsert_faq(bigint,text,text,boolean,integer,integer,boolean)` | `jsonb` | definer |
| `private.admin_restore_faq(bigint,integer)` | `jsonb` | definer |

Las diez funciones existen con las firmas y modos previstos. Todas usan
`search_path=''`. `EXECUTE` está revocado para `PUBLIC`, `anon`,
`authenticated` y `service_role`. No se creó ninguna RPC pública.

El guard administrativo llama a `private.is_admin()`, que exige un perfil
administrador y AAL2 mientras la política MFA esté habilitada. Las pruebas
confirmaron rechazo de un cliente común y de un administrador AAL1 con
SQLSTATE `42501`.

## Pruebas transaccionales de producción

Se utilizaron fixtures temporales dentro de una sola transacción. La transacción
terminó expresamente con `ROLLBACK`.

Resultado: **17 aprobadas, 0 fallidas**.

1. Cliente sin rol administrador rechazado.
2. Administrador AAL1 rechazado.
3. Creación de borrador.
4. Edición de borrador.
5. Repetición idéntica sin incremento de versión.
6. Publicación inicial y repetición idempotente con la misma identidad, versión
   y fecha.
7. Revisión obsoleta rechazada con SQLSTATE `40001`.
8. Separación entre borrador nuevo y contenido publicado.
9. Creación de FAQ válida.
10. Duplicado normalizado por espacios y mayúsculas rechazado con SQLSTATE
    `23505`.
11. FAQ legítimamente distinta aceptada.
12. Soft-delete invisible públicamente y visible en administración.
13. Restauración que conserva identidad y vuelve con `active=false`.
14. Restauración conflictiva rechazada con SQLSTATE `23505`.
15. Payload ejecutable rechazado.
16. Texto, HTTPS, caracteres especiales y campos opcionales aceptados.
17. Lectores públicos limitados a contenido publicado y FAQ activas.

Después del `ROLLBACK`:

- `private.site_content_pages`: 0 registros.
- `private.site_content_versions`: 0 registros.
- `private.site_faq_items`: 0 registros.
- No quedaron fixtures ni datos QA.
- No se creó ni publicó ninguna página o FAQ real.

No se ejecutaron las cuatro pruebas multisesión con escrituras. Permanecen
pendientes para un PostgreSQL aislado con conexiones independientes:

1. Dos publicaciones simultáneas.
2. Creación simultánea de FAQ duplicadas.
3. Restauración concurrente con creación o edición.
4. Eliminación concurrente con restauración.

## RLS, Storage e integridad comercial

- Tablas privadas de Etapa C: 12.
- Tablas con RLS: 12.
- Grants directos inesperados para roles API: 0.
- Bucket `site-assets`: privado.
- Políticas públicas nuevas sobre `site-assets`: 0.
- RPC públicas nuevas de 5A: 0.

Conciliación:

| Entidad | Antes | Después |
|---|---:|---:|
| Productos | 16 | 16 |
| Insumos | 36 | 36 |
| Pedidos | 17 | 17 |
| Movimientos de inventario | 11 | 11 |

La migración no modificó datos comerciales.

## Security Advisor y logs

No aparecieron vulnerabilidades nuevas atribuibles a 5A v2. Permanecen los
hallazgos anteriores:

- 8 avisos informativos de tablas privadas con RLS y sin políticas.
- 1 advertencia sobre `public.track_public_event` ejecutable por `anon`.
- 17 advertencias de funciones `SECURITY DEFINER` ejecutables por usuarios
  autenticados, correspondientes a superficies existentes.
- Protección de contraseñas filtradas deshabilitada.

La revisión de logs de PostgreSQL entre 16:50 y 17:10 UTC no devolvió errores ni
SQLSTATE nuevos relacionados con la instalación.

## Estado y riesgos residuales

5A v2 está instalada pero permanece funcionalmente cerrada. Sus funciones no
son invocables desde la Data API y el frontend no expone páginas ni FAQ.

Antes de activar wrappers siguen siendo obligatorios:

- completar las cuatro pruebas multisesión;
- actualizar las dependencias y centinelas antiguos de los bloques 6 y 7;
- agregar los wrappers faltantes de listado y restauración de FAQ;
- definir grants explícitos mínimos en la activación final;
- actualizar el frontend administrativo;
- verificar el renderizado seguro frente a XSS.

No se continuó con ningún bloque posterior.
