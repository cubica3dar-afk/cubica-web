# Cúbica 3D — Etapa C, despliegue de producción 4A v2

Fecha: 2026-10-21 (America/Argentina/Buenos_Aires)

Resultado: **APLICADA UNA SOLA VEZ Y VERIFICADA**.

## Migración aplicada

- Versión: `20261018171249`
- Nombre remoto: `stage_c_appearance_asset_admin_private_functions_v2`
- Archivo: `20261018171249_stage_c_appearance_asset_admin_private_functions_v2.sql`
- SHA-256: `5B212BC9F45B3A0BEFF5E9D0B14AD413CB4EF85A2472DAE33829639253F454E3`
- Historial: 34 → 35 migraciones.
- Apariciones de la versión/nombre autorizados: exactamente una.
- La versión reemplazada `20261018171251` continúa archivada y no fue aplicada.

## Resultado literal sanitizado de Supabase CLI

```text
===== db push --dry-run --include-all =====
DRY RUN: migrations will *not* be pushed to the database.
Connecting to remote database...
Would push these migrations:
 • 20261018171249_stage_c_appearance_asset_admin_private_functions_v2.sql
{"upToDate":false,"dryRun":true,"migrations":["20261018171249_stage_c_appearance_asset_admin_private_functions_v2.sql"],"seeds":[],"roles":[],"message":"Finished supabase db push."}
EXIT_CODE=0

CLI_VERSION=2.121.0
TLS_MODE=verify-full
CA_FILE=prod-ca-2021.crt
REMOTE_HISTORY_BEFORE=34_MATCHED
AUTHORIZED_FILE=20261018171249_stage_c_appearance_asset_admin_private_functions_v2.sql
SHA256=5B212BC9F45B3A0BEFF5E9D0B14AD413CB4EF85A2472DAE33829639253F454E3
PREWRITE_CHECK=PASS_ONLY_4A_V2

===== db push real - ejecucion unica autorizada =====
Connecting to remote database...
Applying migration 20261018171249_stage_c_appearance_asset_admin_private_functions_v2.sql...
{"upToDate":false,"dryRun":false,"migrations":["20261018171249_stage_c_appearance_asset_admin_private_functions_v2.sql"],"seeds":[],"roles":[],"message":"Finished supabase db push."}
EXIT_CODE=0

PUSH_EXIT_CODE=0
PRODUCTION_RESULT=APPLIED_ONCE_4A_V2
REMOTE_HISTORY=35
```

La ejecución usó Supabase CLI 2.121.0, Session Pooler IPv4, TLS `verify-full`, CA oficial y entrada oculta. La contraseña no se registró y fue eliminada de las variables del proceso.

## Funciones y centinela

Centinela confirmado en `private.admin_register_site_asset(...)`:

`cubica_stage_c:20261018171249`

Las seis funciones administrativas existen:

| Función | Retorno | Seguridad | search_path | Guard AAL2 | API EXECUTE |
|---|---|---|---|---|---|
| `private.admin_save_site_appearance_draft(jsonb,integer)` | `jsonb` | `SECURITY DEFINER` | vacío | sí | ninguno |
| `private.admin_publish_site_appearance(integer)` | `jsonb` | `SECURITY DEFINER` | vacío | sí | ninguno |
| `private.admin_reset_site_appearance_draft(integer)` | `jsonb` | `SECURITY DEFINER` | vacío | sí | ninguno |
| `private.admin_restore_original_appearance_draft(integer)` | `jsonb` | `SECURITY DEFINER` | vacío | sí | ninguno |
| `private.admin_register_site_asset(text,text,text,text,bigint,integer,integer)` | `jsonb` | `SECURITY DEFINER` | vacío | sí | ninguno |
| `private.admin_retire_site_asset(uuid)` | `void` | `SECURITY DEFINER` | vacío | sí | ninguno |

`PUBLIC`, `anon`, `authenticated` y `service_role` no tienen `EXECUTE` sobre ninguna de las seis funciones. No existen wrappers homónimos en `public`.

El validador privado `private.stage_c_validate_theme(jsonb)` quedó como `SECURITY INVOKER`, con `search_path=''` y sin `EXECUTE` para roles API. Esta fue la única función preexistente reemplazada, de manera intencional y conforme al SQL aprobado; no se detectaron cambios inesperados en otras funciones.

También se confirmaron:

- columna `source_draft_version`;
- constraint de versión positiva;
- índice único parcial `site_appearance_source_draft_once`.

## Pruebas ejecutadas en producción con ROLLBACK

Todas las pruebas usaron una identidad administrativa existente únicamente para generar claims temporales dentro de la transacción. No se modificaron usuarios, factores MFA ni datos persistentes.

Resultado `PASS_ROLLED_BACK`:

- AAL1 rechazado con SQLSTATE `42501`;
- AAL2 aceptado por el guard privado;
- creación de borrador QA;
- publicación del borrador;
- segunda publicación de la misma revisión idempotente;
- una sola publicación para `source_draft_version`;
- revisión obsoleta rechazada con SQLSTATE `40001`;
- separación correcta entre borrador y publicación;
- recurso referenciado no puede retirarse;
- objeto de `storage.objects` registrado correctamente cuando ruta, MIME, tamaño y extensión coinciden;
- objeto inexistente rechazado;
- extensión/MIME incompatibles rechazados;
- tamaño distinto al registrado en Storage rechazado.

Después de `ROLLBACK`:

- `site_appearance_versions`: 0 filas;
- `site_assets`: 0 filas;
- `site_campaigns`: 0 filas;
- objetos QA en `site-assets`: 0.

No se ejecutaron pruebas multisesión con escritura sobre producción. Continúan pendientes:

1. dos publicaciones simultáneas del mismo borrador;
2. retiro simultáneo de un recurso y creación/publicación de una referencia.

## Seguridad e integridad

- Las 11 tablas de Etapa C conservan RLS.
- Grants directos inesperados para roles API sobre esas tablas: 0.
- Bucket `site-assets`: privado.
- Políticas públicas nuevas de Storage: 0.
- Wrappers públicos nuevos: 0.
- Apariencias publicadas: 0.
- Campañas: 0.
- Recursos visuales registrados: 0.
- Errores PostgreSQL críticos durante la ventana de instalación: 0.

Security Advisor no agregó hallazgos atribuibles a 4A v2. Permanecen los avisos preexistentes: ocho tablas privadas con RLS sin políticas (cerradas deliberadamente), `track_public_event` ejecutable por anónimos, diecisiete RPC `SECURITY DEFINER` ejecutables por usuarios autenticados y protección contra contraseñas filtradas deshabilitada.

## Conciliación comercial

| Entidad | Antes | Después |
|---|---:|---:|
| Productos | 17 | 17 |
| Categorías | 4 | 4 |
| Insumos | 35 | 35 |
| Recetas | 2 | 2 |
| Pedidos | 17 | 17 |
| Ítems de pedido | 18 | 18 |
| Movimientos de inventario | 11 | 11 |
| Presupuestos | 4 | 4 |
| Versiones de presupuesto | 3 | 3 |
| Comentarios | 5 | 5 |
| Reacciones | 5 | 5 |
| Likes de comentarios | 4 | 4 |

## Estado funcional y pasos pendientes

4A v2 está instalada pero deliberadamente cerrada. El frontend y la Data API no pueden invocar sus operaciones.

Antes de habilitarla funcionalmente deben completarse, mediante una autorización nueva:

1. actualizar 7A-1 para las firmas con revisión esperada de restablecer/recuperar;
2. actualizar 7B y sus grants explícitos mínimos;
3. actualizar `js/site-experience.js` para enviar `p_expected_version`;
4. actualizar centinelas, verificación y rollback;
5. ejecutar las dos pruebas multisesión en un PostgreSQL servidor aislado;
6. repetir preflight y controles de permisos antes de activar wrappers.

El cambio de grants de Supabase del 30 de octubre permanece contemplado: ningún objeto debe depender de privilegios automáticos.

## Alcance final

No se aplicaron 4B, 4C ni bloques posteriores. No se activaron wrappers, Edge Functions, frontend, secretos, campañas, apariencias ni Etapa D.
