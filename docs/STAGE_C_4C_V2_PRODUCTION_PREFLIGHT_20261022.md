# Cúbica 3D — Etapa C, preflight de producción 4C v2

Fecha: 2026-10-22 (America/Argentina/Buenos_Aires)

Resultado: `PREFLIGHT_RESULT=PASS_ONLY_4C_V2`

Este preflight no aplicó migraciones ni modificó objetos o datos de producción.

## Candidato verificado

- Archivo: `20261018171255_stage_c_phrase_admin_private_function_v2.sql`
- SHA-256: `9A2A9FE644416662B0788ACF6F8EF3E1FAD00B09D44D1EAF19851B29F73D2E43`
- Centinela previsto: `cubica_stage_c:20261018171255`
- Función: `private.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean)`
- La versión reemplazada `20261018171253` permanece en `supabase/archive/` y fuera de las migraciones aplicables.
- La verificación y el rollback específicos de `20261018171255` están presentes. El rollback elimina únicamente la función, conserva las frases y vuelve a asegurar RLS y permisos de la tabla.

El directorio de trabajo no es un checkout Git, por lo que no existe un `git status` que certifique su limpieza. La superficie aplicable se controló con nombre, SHA-256, manifiesto remoto fresco y un directorio CLI aislado.

## Estado de producción antes y después del dry-run

- Proyecto: saludable.
- PostgreSQL: 17.11.
- Historial remoto: 36 migraciones antes y después.
- Historial recuperado: 36/36 versiones conciliadas.
- Instaladas y verificadas: 4A v2 (`20261018171249`) y 4B v2 (`20261018171254`).
- 4C v2: ausente del historial y la función privada todavía no existe.
- Tablas de Etapa C: 12/12 con RLS.
- Roles `PUBLIC`, `anon` y `authenticated`: sin privilegios directos sobre esas tablas.
- Políticas: denegación explícita para `anon` y `authenticated` en las 12 tablas.
- Bucket `site-assets`: privado y sin políticas públicas.
- Campañas y frases reales de Etapa C: 0 y 0.

Conteos comerciales conciliados antes y después:

| Entidad | Conteo |
| --- | ---: |
| Productos | 16 |
| Insumos | 36 |
| Pedidos | 17 |
| Movimientos de inventario | 11 |

## Auditoría de consistencia y seguridad

4C v2:

- ejecuta primero `private.stage_c_assert_admin()`, que centraliza el requisito administrativo y MFA AAL2;
- usa `SECURITY DEFINER` con `search_path=''`;
- revoca `EXECUTE` a `PUBLIC`, `anon`, `authenticated` y `service_role`;
- no crea wrappers públicos, grants, políticas ni publicaciones;
- valida campaña inexistente y campaña retirada antes de asociar o restaurar una frase;
- permite recuperar una frase como general o reasignarla a una campaña vigente;
- conserva el historial mediante `deleted_at` y evita borrado físico;
- exige versión esperada para editar, reasignar, restaurar o eliminar;
- transforma una edición idéntica en no-op y traduce duplicados a SQLSTATE `23505`;
- mantiene separados borradores, publicaciones y resolución pública.

El orden de locks coincide con 4B v2: campaña por UUID y luego frase. La eliminación lógica de campaña toma un lock exclusivo de campaña antes de retirar sus frases; 4C toma un lock compartido de campaña antes de insertar o bloquear la frase. Esto impide que una asociación confirme sobre una campaña retirada sin esperar y volver a validar.

La firma consumida por el futuro wrapper y el frontend no cambia. Las funciones de calendario y `private.get_site_experience(timestamptz)` solo leen las filas visibles y no requieren cambios por 4C v2.

Pendiente coordinado: `20261018171400_stage_c_safe_defaults.sql` y `20261018171511_stage_c_public_appearance_wrappers_closed.sql` todavía comprueban el centinela reemplazado `20261018171253`. No están instalados ni formaron parte del dry-run; deben actualizarse antes de sus propios preflights. No se modificaron en esta autorización.

## Supabase CLI

- CLI: 2.121.0.
- Conexión: Session Pooler IPv4, TLS `verify-full`, CA oficial Supabase Root 2021.
- Credencial: entrada oculta en PowerShell, usada solo en memoria y eliminada al finalizar.
- Directorio: `stage-c-4c-v2-preflight-20261022`, aislado del repositorio canónico.

Salida literal sanitizada del dry-run:

```text
DRY RUN: migrations will *not* be pushed to the database.
Connecting to remote database...
Would push these migrations:
 • 20261018171255_stage_c_phrase_admin_private_function_v2.sql
{"upToDate":false,"dryRun":true,"migrations":["20261018171255_stage_c_phrase_admin_private_function_v2.sql"],"seeds":[],"roles":[],"message":"Finished supabase db push."}
EXIT_CODE=0
```

Controles del script:

```text
CLI_VERSION=2.121.0
TLS_MODE=verify-full
REMOTE_HISTORY=36_MATCHED
AUTHORIZED_FILE=20261018171255_stage_c_phrase_admin_private_function_v2.sql
SHA256=9A2A9FE644416662B0788ACF6F8EF3E1FAD00B09D44D1EAF19851B29F73D2E43
PREFLIGHT_RESULT=PASS_ONLY_4C_V2
DATABASE_WRITE=NONE
```

## Pruebas

- Validación aislada de 4C v2 en PGlite PostgreSQL 17.5: 19 aprobadas, 0 fallidas.
- Concurrencia real eliminación de campaña / asociación de frase: **NO EJECUTADA**. PGlite ofrece una sola sesión; la inspección del orden de locks no se presenta como una prueba multisesión.
- Suite local completa: 10/10 archivos aprobados, incluyendo presupuestos, experiencia visual, Etapas A y B, calendario, 4A v2, 4B v2, 4C v2 y configuración de Etapa C.
- Residuos QA locales: 0.
- Pruebas posteriores preparadas: firma y centinela, ACL, AAL2/AAL1, frases generales, campañas vigentes/retiradas, reasignación, restauración, revisión obsoleta, soft-delete, integración con 4B, resolución pública, no publicación automática, RLS, Storage, integridad comercial y residuos QA.

## Security Advisor y logs

No apareció ningún hallazgo nuevo de Etapa C. Permanecen los hallazgos previos:

- 8 avisos informativos de tablas privadas con RLS sin políticas, usados como denegación total fuera de Etapa C;
- 1 advertencia sobre `track_public_event` anónimo;
- 17 advertencias sobre RPC `SECURITY DEFINER` para usuarios autenticados;
- protección contra contraseñas filtradas desactivada.

En las últimas 24 horas hubo 8 errores PostgreSQL de `mgmt-api`: 4 con SQLSTATE `42P01`, 2 con `42703`, 1 con `42702` y 1 con `42704`. Son errores de consultas de diagnóstico/esquema; no hubo SQLSTATE `28P01`, ni errores graves registrados en PgBouncer o Supavisor, ni evidencia de una falla de autenticación o conexión del preflight.

## Riesgos y recomendación

La migración privada cerrada está lista para una autorización de instalación independiente: el archivo, historial, dependencias, seguridad y dry-run coinciden. No se debe activar su wrapper ni la administración funcional hasta completar una prueba real de concurrencia con dos sesiones PostgreSQL aisladas.

La futura cadena de migraciones debe corregir los dos centinelas antiguos mencionados antes de ejecutar 6/7A. Es un pendiente posterior y no afecta la instalación aislada de 4C v2.

Recomendación: **autorizar la aplicación exclusiva de 4C v2 si Diego decide continuar; mantener bloqueada la activación de wrappers hasta resolver la prueba multisesión pendiente**.
