# Etapa C — despliegue controlado de 3C-2

Fecha: 2026-10-20 (America/Argentina/Buenos_Aires)

## Resultado

`20261018171232_stage_c_admin_configuration_private_function.sql` fue aplicada
una sola vez mediante Supabase CLI 2.121.0, Session Pooler IPv4 y TLS
`verify-full` con la CA oficial de Supabase.

- SHA-256 verificado antes de escribir:
  `E2DC0ED8BC58A90028A11E55794A7D01AB01023659CD01F8CEFF19DC16E6F3DA`.
- Historial anterior: 33 migraciones.
- Dry-run: solamente 3C-2.
- Resultado del push: `PRODUCTION_RESULT=APPLIED_ONCE_3C2`.
- Historial posterior: 34 migraciones.
- Versión registrada: `20261018171232`.
- Nombre registrado: `stage_c_admin_configuration_private_function`.

Salida literal sanitizada relevante:

```text
DRY RUN: migrations will *not* be pushed to the database.
Would push these migrations:
 • 20261018171232_stage_c_admin_configuration_private_function.sql
{"upToDate":false,"dryRun":true,"migrations":["20261018171232_stage_c_admin_configuration_private_function.sql"],"seeds":[],"roles":[],"message":"Finished supabase db push."}
EXIT_CODE=0

Applying migration 20261018171232_stage_c_admin_configuration_private_function.sql...
{"upToDate":false,"dryRun":false,"migrations":["20261018171232_stage_c_admin_configuration_private_function.sql"],"seeds":[],"roles":[],"message":"Finished supabase db push."}
EXIT_CODE=0

PRODUCTION_RESULT=APPLIED_ONCE_3C2
REMOTE_HISTORY=34
```

La salida completa sanitizada está en
`<workspace>/stage-c-3c2-preflight-20261020/production-3c2-results.txt`.

## Función y permisos

Se verificó `private.admin_get_site_configuration()`:

- retorno `jsonb`;
- `STABLE`;
- `SECURITY DEFINER`;
- `search_path=''`;
- centinela `cubica_stage_c:20261018171232`;
- guard `private.stage_c_assert_admin()` presente;
- sin `EXECUTE` para `PUBLIC`, `anon`, `authenticated` ni `service_role`;
- sin función pública equivalente;
- sin permisos directos nuevos sobre tablas.

Las funciones previas `stage_c_assert_admin`, `stage_c_active_campaign`,
`stage_c_next_change` y `get_site_experience` conservaron sus firmas,
centinelas, modo de seguridad y `search_path`.

La cadena de autorización continúa exigiendo `auth.uid()`, rol administrador y
`aal2`. Una invocación de lectura sin contexto de autenticación fue rechazada
con SQLSTATE `42501` y el mensaje `Solo administradores con MFA AAL2`.

## Pruebas funcionales

Resultados ejecutados:

- usuario sin contexto de autenticación: rechazado por el guard AAL2;
- acceso directo de `anon`, `authenticated` y `service_role`: denegado por ACL;
- separación borrador/publicado, filtros de eliminados y eliminación de campos
  internos: verificados en la definición instalada;
- ausencia de publicación automática: confirmada; todas las tablas de Etapa C
  continúan con cero registros;
- integridad de campañas, frases, páginas y FAQ: conteos sin cambios.

No se ejecutaron pruebas dinámicas como administrador AAL2, administrador AAL1
o cliente común. No hay una identidad QA AAL2 disponible y la autorización
prohibía simular un JWT de producción o modificar usuarios/factores reales.
Por la misma razón no se insertaron fixtures y no hubo una transacción QA que
requiriera `ROLLBACK`. Estas pruebas quedan pendientes para cuando existan los
wrappers autorizados y una identidad QA real.

## Integridad y seguridad

Conteos comerciales antes y después:

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

Las 11 tablas de Etapa C mantienen RLS y cero permisos directos para roles API.
El bucket `site-assets` sigue privado, con límite de 8 MiB y sin políticas
públicas. No se desplegaron Edge Functions ni se cambió el frontend.

Security Advisor no agregó hallazgos por 3C-2. Conserva los avisos anteriores:
8 informativos por tablas privadas con RLS sin políticas, 1 función pública
`SECURITY DEFINER`, 17 funciones autenticadas `SECURITY DEFINER` y protección
contra contraseñas filtradas desactivada. Los logs del intervalo de despliegue
no mostraron errores, fallos de autenticación ni desconexiones.

La Etapa C queda detenida después de 3C-2. No se aplicó 4A ni ningún bloque
posterior.
