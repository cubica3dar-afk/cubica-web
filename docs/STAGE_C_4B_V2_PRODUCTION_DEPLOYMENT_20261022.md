# Cúbica 3D — Etapa C, despliegue de producción 4B v2

Fecha: 2026-10-22 (America/Argentina/Buenos_Aires)

Resultado: **4B v2 INSTALADA UNA SOLA VEZ Y VERIFICADA**.

`PRODUCTION_RESULT=APPLIED_ONCE_4B_V2`

## 1. Migración aplicada

- Archivo: `20261018171254_stage_c_campaign_admin_private_functions_v2.sql`
- Nombre remoto: `stage_c_campaign_admin_private_functions_v2`
- Versión remota: `20261018171254`
- SHA-256:
  `3330F8118C5539548AFC0A6804D4BD1AEDD799F70E68CD4FBCDB3790E62DC429`
- Supabase CLI: `2.121.0`.
- Conexión: Session Pooler IPv4, TLS `verify-full` y CA oficial.
- Contraseña recibida por entrada oculta y eliminada del proceso.

No se modificó el archivo aprobado y no se utilizó 4B v1 archivada.

## 2. Resultado literal sanitizado

```text
===== db push --dry-run --include-all =====
DRY RUN: migrations will *not* be pushed to the database.
Connecting to remote database...
Would push these migrations:
 • 20261018171254_stage_c_campaign_admin_private_functions_v2.sql
{"upToDate":false,"dryRun":true,"migrations":["20261018171254_stage_c_campaign_admin_private_functions_v2.sql"],"seeds":[],"roles":[],"message":"Finished supabase db push."}
EXIT_CODE=0

CLI_VERSION=2.121.0
TLS_MODE=verify-full
CA_FILE=prod-ca-2021.crt
REMOTE_HISTORY_BEFORE=35_MATCHED
AUTHORIZED_FILE=20261018171254_stage_c_campaign_admin_private_functions_v2.sql
SHA256=3330F8118C5539548AFC0A6804D4BD1AEDD799F70E68CD4FBCDB3790E62DC429
PREWRITE_CHECK=PASS_ONLY_4B_V2

===== db push real - ejecucion unica autorizada =====
Connecting to remote database...
Applying migration 20261018171254_stage_c_campaign_admin_private_functions_v2.sql...
{"upToDate":false,"dryRun":false,"migrations":["20261018171254_stage_c_campaign_admin_private_functions_v2.sql"],"seeds":[],"roles":[],"message":"Finished supabase db push."}
EXIT_CODE=0

PUSH_EXIT_CODE=0
PRODUCTION_RESULT=APPLIED_ONCE_4B_V2
REMOTE_HISTORY=36
```

## 3. Historial y centinelas

- Historial anterior: 35 migraciones.
- Historial posterior: 36 migraciones.
- Instancias de versión `20261018171254`: exactamente una.
- Centinela de 4B v2: `cubica_stage_c:20261018171254`.
- Centinelas anteriores 3A, 3B-1 v3, 3B-2 v2, 3C-1, 3C-2 y 4A v2
  permanecen instalados.
- Las firmas reemplazadas de 4B v1 permanecen ausentes.

## 4. Objetos instalados

Tabla privada:

- `private.site_campaign_idempotency`;
- clave primaria `(actor_id, operation, request_id)`;
- FK de `actor_id` a `auth.users`;
- FK de campaña resultante a `private.site_campaigns`;
- checks de operación, payload JSON y finalización coherente;
- índice parcial `site_campaign_idempotency_result_campaign_idx`;
- RLS habilitado y política denegatoria para `anon` y `authenticated`.

Funciones privadas:

1. `private.stage_c_begin_campaign_operation(text,uuid,jsonb)`
2. `private.stage_c_complete_campaign_operation(text,uuid,jsonb,uuid,jsonb)`
3. `private.admin_upsert_site_campaign(...,integer,uuid)`
4. `private.admin_set_site_campaign_state(uuid,text,integer,uuid)`
5. `private.admin_duplicate_site_campaign(uuid,integer,uuid)`
6. `private.admin_delete_site_campaign(uuid,integer)`

Las seis están presentes, son `SECURITY DEFINER`, fijan `search_path=''` y no
tienen `EXECUTE` para `PUBLIC`, `anon`, `authenticated` ni `service_role`.
No se creó ninguna RPC pública.

## 5. Pruebas transaccionales

La suite QA ejecutó estos escenarios con una identidad administradora y claims
de sesión controlados:

1. AAL1 rechazado.
2. AAL2 autorizado.
3. Creación idempotente.
4. Conflicto por reutilizar una clave con otro payload.
5. Duplicación idempotente.
6. Copia coherente de ocurrencia, frase y tema con recursos nulos.
7. Repetición de publicación con la misma clave.
8. Publicación repetida con otra clave sin cambiar versión ni `published_at`.
9. Revisión obsoleta rechazada.
10. Fuente eliminada rechazada.
11. Reservas fallidas revertidas.
12. Compatibilidad con `stage_c_next_change`.
13. Compatibilidad con `get_site_experience`.

Resultado:

```text
result=PASS
transaction=ROLLED_BACK
```

El primer intento del arnés QA se detuvo por una referencia ambigua a la
variable `theme` en una aserción del propio test. La transacción se revirtió y
se verificaron cero residuos antes de corregir la aserción. La migración no se
reintentó ni se modificó.

La concurrencia real con dos conexiones independientes continúa **NO
EJECUTADA**. No se hizo una prueba multisesión de escritura sobre producción.

## 6. Seguridad e integridad

- Tablas de Etapa C consideradas: 12.
- Tablas con RLS: 12.
- Grants directos de tablas a roles API: 0.
- RPC públicas nuevas: 0.
- `site-assets`: privado, límite 8 MiB, MIME JPEG/PNG/WebP.
- Políticas públicas de Storage para `site-assets`: 0.
- Campañas reales: 0.
- Ocurrencias reales: 0.
- Frases reales: 0.
- Recursos de Etapa C: 0.
- Registros idempotentes persistentes: 0.
- Residuos QA: 0.

Security Advisor no agregó hallazgos atribuibles a 4B v2. Conserva los avisos
preexistentes sobre ocho tablas privadas cerradas, `track_public_event`,
diecisiete RPC autenticadas `SECURITY DEFINER` y protección contra contraseñas
filtradas deshabilitada.

Los logs PostgreSQL del intervalo de despliegue no muestran errores, fallos
fatales ni desconexiones inesperadas.

## 7. Conciliación comercial

Diego confirmó previamente que 16 productos y 36 insumos representan la línea
actual legítima. Los conteos antes y después permanecieron:

| Entidad | Antes | Después |
|---|---:|---:|
| Productos | 16 | 16 |
| Categorías | 4 | 4 |
| Insumos | 36 | 36 |
| Recetas | 2 | 2 |
| Pedidos | 17 | 17 |
| Ítems de pedido | 18 | 18 |
| Movimientos de inventario | 11 | 11 |
| Presupuestos | 4 | 4 |
| Versiones de presupuesto | 3 | 3 |
| Comentarios | 5 | 5 |
| Reacciones | 5 | 5 |
| Likes de comentarios | 4 | 4 |

No se modificaron productos, insumos, pedidos, inventario, presupuestos ni
Comunidad.

## 8. Riesgos y próximos límites

- Falta validar locks con dos conexiones PostgreSQL independientes en un entorno
  aislado.
- 4C v1 sigue congelado; requiere una 4C v2 con validación de campañas retiradas
  y locks campaña → frase.
- Bloque 6, 7A-1, 7A-2, 7B y frontend todavía deben adoptar el nuevo centinela y
  las nuevas firmas antes de su activación.
- La tabla idempotente no tiene aún política de retención; permanece vacía y
  privada.

## 9. Alcance final

No se aplicó 4C ni ninguna migración posterior. No se activaron wrappers, RPC,
Edge Functions, secretos, campañas ni frontend. No se inició la Etapa D.
