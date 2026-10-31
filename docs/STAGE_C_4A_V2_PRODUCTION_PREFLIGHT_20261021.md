# Cúbica 3D — Etapa C, preflight de producción 4A v2

Fecha: 2026-10-21 (America/Argentina/Buenos_Aires)

Resultado: **PREFLIGHT APROBADO, SIN ESCRITURAS EN PRODUCCIÓN**.

## 1. Artefacto autorizado

- Archivo: `20261018171249_stage_c_appearance_asset_admin_private_functions_v2.sql`
- SHA-256 verificado: `5B212BC9F45B3A0BEFF5E9D0B14AD413CB4EF85A2472DAE33829639253F454E3`
- La versión reemplazada `20261018171251` no está en `supabase/migrations`.
- La versión reemplazada está conservada en `supabase/archive/20261018171251_stage_c_appearance_asset_admin_private_functions.pre_consistency.sql`.
- 4A v2 no fue modificada durante este preflight.

## 2. Estado de producción

- Proyecto Supabase: `ACTIVE_HEALTHY`.
- PostgreSQL: `17.11.0.002` (motor 17).
- Supabase CLI: `2.121.0`.
- Historial remoto: 34 migraciones.
- `migration fetch` recuperó exactamente las mismas 34 migraciones del manifiesto fresco.
- `migration list` mostró coincidencia local/remota completa antes de incorporar 4A v2.
- Confirmados: bloques 1, 2, 3A, 3B-1 v3, 3B-2 v2, 3C-1 y 3C-2.
- 4A v2 (`20261018171249`) y la versión anterior (`20261018171251`) continúan ausentes.
- Las once tablas de Etapa C mantienen RLS habilitado.
- No existen grants directos a `anon`, `authenticated`, `service_role` o `PUBLIC` sobre esas once tablas privadas.
- El bucket `site-assets` permanece privado, con límite de 8 MiB y MIME permitidos `image/jpeg`, `image/png` e `image/webp`.
- No hay políticas públicas de Storage para `site-assets`.

## 3. Resultado literal sanitizado del dry-run

```text
DRY RUN: migrations will *not* be pushed to the database.
Connecting to remote database...
Would push these migrations:
 • 20261018171249_stage_c_appearance_asset_admin_private_functions_v2.sql
{"upToDate":false,"dryRun":true,"migrations":["20261018171249_stage_c_appearance_asset_admin_private_functions_v2.sql"],"seeds":[],"roles":[],"message":"Finished supabase db push."}
EXIT_CODE=0

CLI_VERSION=2.121.0
TLS_MODE=verify-full
CA_FILE=prod-ca-2021.crt
REMOTE_HISTORY=34_MATCHED
AUTHORIZED_FILE=20261018171249_stage_c_appearance_asset_admin_private_functions_v2.sql
SHA256=5B212BC9F45B3A0BEFF5E9D0B14AD413CB4EF85A2472DAE33829639253F454E3
PREFLIGHT_RESULT=PASS_ONLY_4A_V2
DATABASE_WRITE=NONE
```

La conexión usó Session Pooler IPv4, TLS `verify-full` y la CA oficial. La contraseña se recibió por entrada oculta y se eliminó de las variables del proceso al finalizar.

## 4. Validación funcional y de seguridad

La prueba aislada se repitió en PGlite/PostgreSQL 17.5. Resultado: 16 escenarios aprobados, ninguno fallido y dos escenarios de concurrencia real no ejecutados.

Aprobado:

- publicación inicial e idempotente;
- vínculo único entre publicación y revisión del borrador mediante `source_draft_version` e índice único parcial;
- revisión esperada en guardar, publicar, restablecer y recuperar apariencia;
- rechazo SQLSTATE `40001` ante revisiones obsoletas;
- validación estructurada de referencias JSONB;
- existencia del objeto en `storage.objects`;
- bucket, ruta, MIME, extensión, tamaño y dimensiones;
- prevención de retiro cuando existe una referencia activa;
- rechazo AAL1 y de clientes sin administración;
- rollback sin residuos QA.

Las seis funciones administrativas son `SECURITY DEFINER`, tienen `search_path=''`, llaman a `private.stage_c_assert_admin()` y quedan sin `EXECUTE` para `PUBLIC`, `anon`, `authenticated` y `service_role`. El validador `private.stage_c_validate_theme(jsonb)` es `SECURITY INVOKER` y también queda cerrado a roles de API.

Las carreras están contenidas estructuralmente por:

- `pg_advisory_xact_lock(1817124901)` para serializar cambios de apariencia;
- `FOR UPDATE` sobre el borrador y el recurso retirado;
- `FOR SHARE` sobre recursos usados por la apariencia/campaña y sobre el objeto de Storage durante su registro;
- índice único de publicación por revisión de borrador;
- control de versión esperado y errores explícitos de serialización.

## 5. Pruebas reales de concurrencia

**NO EJECUTADAS**:

1. Dos publicaciones simultáneas del mismo borrador.
2. Retiro de un recurso simultáneo con la creación/publicación de una referencia.

Se buscó un entorno local servidor con dos sesiones independientes. No hay PostgreSQL servidor, `psql` ni Docker disponibles. PGlite 17.5 proporciona una sola sesión y no representa concurrencia real; por eso las llamadas secuenciales no se presentan como prueba multisesión.

Riesgo residual: bajo pero no eliminado empíricamente. La coordinación por locks e índice único es correcta por inspección, pero falta observar bloqueos y resultado final con dos conexiones reales a un PostgreSQL servidor aislado.

## 6. Compatibilidad con bloques y consumidores posteriores

| Función | Firma anterior | Firma 4A v2 | Consumidor | Cambio requerido | Estado | Momento límite |
|---|---|---|---|---|---|---|
| Guardar borrador | `(jsonb, integer)` | igual | 7A-1 / frontend | Ninguno en firma | compatible | antes de 7B |
| Publicar apariencia | `(integer)` | igual | 7A-1 / frontend | Ninguno en firma | compatible | antes de 7B |
| Restablecer borrador | `()` | `(integer)` | 7A-1, 7B, frontend, verificación y rollback | Pasar la revisión actual y actualizar firmas | pendiente | antes de publicar frontend o activar 7B |
| Recuperar apariencia original | `()` | `(integer)` | 7A-1, 7B, frontend, verificación y rollback | Pasar la revisión actual y actualizar firmas | pendiente | antes de publicar frontend o activar 7B |
| Registrar recurso | `(text,text,text,text,bigint,integer,integer)` | igual | Edge Function `site-assets` / 7A-1 | Actualizar centinela 4A; la llamada permanece compatible | parcialmente pendiente | antes de 7A-1/7B |
| Retirar recurso | `(uuid)` | igual | 7A-1 / frontend | Ninguno en firma; actualizar centinela/verificación | parcialmente pendiente | antes de 7A-1/7B |

Compatibilidad por bloque:

- 4B, 4C, 5A, 5B, 5C y 6 no llaman las dos firmas cambiadas: compatibles.
- `20261018171400_stage_c_safe_defaults.sql` todavía exige el centinela anterior `171251`: debe actualizarse antes de ejecutarlo.
- 7A-1 (`20261018171511...`) todavía genera wrappers sin el parámetro de revisión para restablecer/recuperar: debe actualizarse.
- 7A-2 y 7A-3 no dependen de estas firmas.
- 7B (`20261018171514...`) y su activación de permisos deben usar las firmas nuevas.
- `js/site-experience.js` aún llama a restablecer y recuperar sin `p_expected_version`: debe enviar `state.admin.appearance.version`.
- La Edge Function `site-assets` conserva una llamada compatible a `admin_register_site_asset`.
- La verificación final y el rollback parcial contienen firmas antiguas y deben actualizarse antes de activación.

No se modificó ninguno de estos consumidores durante el preflight.

## 7. Cambio de permisos de Supabase del 30 de octubre de 2026

Supabase confirmó que los objetos nuevos de `public` dejarán de recibir exposición automática al Data API en proyectos existentes. Los objetos que deban ser accesibles necesitarán grants explícitos; RLS sigue siendo una capa separada.

Impacto en Etapa C:

- Las once tablas están en `private`, con RLS y sin grants directos: el cambio no las expone ni las rompe.
- 4A v2 crea funciones privadas y revoca expresamente `EXECUTE`: compatible.
- Los wrappers futuros de `public` deben recibir exclusivamente los grants definidos en 7B. No deben depender de privilegios automáticos.
- Las migraciones pendientes de Etapa C no crean nuevas tablas en `public`.
- No se recomienda ningún grant global. Los grants deben seguir siendo por función/objeto y rol.

Referencias oficiales:

- https://github.com/orgs/supabase/discussions/45329
- https://supabase.com/docs/guides/api/securing-your-api

## 8. Security Advisor

No apareció ningún hallazgo atribuible a 4A v2 porque la migración no fue aplicada.

Hallazgos preexistentes:

- ocho avisos informativos de tablas privadas con RLS y sin políticas; en este diseño representan tablas cerradas deliberadamente;
- un aviso por `track_public_event` ejecutable por `anon`;
- diecisiete avisos por RPC `SECURITY DEFINER` ejecutables por usuarios autenticados; requieren revisión por función, aunque varias son wrappers legítimos con autorización interna;
- protección contra contraseñas filtradas deshabilitada.

El preflight no alteró estos hallazgos.

## 9. Conciliación comercial

Los conteos antes y después del dry-run coinciden:

| Entidad | Conteo |
|---|---:|
| Productos | 17 |
| Categorías | 4 |
| Insumos | 35 |
| Recetas | 2 |
| Pedidos | 17 |
| Ítems de pedido | 18 |
| Movimientos de inventario | 11 |
| Presupuestos | 4 |
| Versiones de presupuesto | 3 |
| Comentarios | 5 |
| Reacciones | 5 |
| Likes de comentarios | 4 |

No se crearon migraciones remotas, funciones 4A, columnas, índices, políticas, objetos de Storage ni registros QA.

## 10. Recomendación

**Recomiendo autorizar por separado la instalación única de 4A v2**, porque el archivo y el historial coinciden, el dry-run contiene únicamente esa migración, las validaciones funcionales pasaron y las garantías de concurrencia están implementadas en PostgreSQL.

La autorización debería exigir las verificaciones posteriores habituales y mantener 4A cerrada sin wrappers públicos. Antes de ejecutar 7A-1, 7B o publicar el frontend, deben actualizarse coordinadamente las firmas, centinelas, verificación, rollback y las dos llamadas del frontend identificadas en la matriz.

La limitación pendiente es la prueba multisesión real en un PostgreSQL servidor aislado. No impide técnicamente instalar 4A cerrada, pero debe conservarse como riesgo documentado y no declararse validada.

## 11. Confirmación de alcance

**Cero escrituras en producción.** No se ejecutó `db push` real, SQL Editor, `migration repair`, despliegue de Edge Functions, publicación de frontend, cambio de secretos, campaña, apariencia ni Etapa D.
