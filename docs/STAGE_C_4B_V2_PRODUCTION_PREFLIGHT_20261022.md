# Cúbica 3D — Etapa C, preflight de producción 4B v2

Fecha: 2026-10-22 (America/Argentina/Buenos_Aires)

Resultado: **PREFLIGHT APROBADO, SIN ESCRITURAS EN PRODUCCIÓN**.

## 1. Artefacto autorizado

- Archivo: `20261018171254_stage_c_campaign_admin_private_functions_v2.sql`
- SHA-256 verificado:
  `3330F8118C5539548AFC0A6804D4BD1AEDD799F70E68CD4FBCDB3790E62DC429`
- Nombre de registro previsto:
  `stage_c_campaign_admin_private_functions_v2`
- El 4B original `20261018171252` está fuera de `supabase/migrations` y
  conservado en `supabase/archive`.
- El SQL candidato no fue modificado durante el preflight.

## 2. Estado de producción e historial

- Proyecto: `cubica-web` (`mymrbpwvghxmqqpzzdqk`).
- Estado: `ACTIVE_HEALTHY`.
- Región: `sa-east-1`.
- PostgreSQL: `17.11.0.002`; `server_version=17.11`.
- Supabase CLI: `2.121.0`.
- Conexión: Session Pooler IPv4, TLS `verify-full`, CA oficial de Supabase.
- La contraseña rotada se recibió por entrada oculta y se eliminó del proceso.
- Historial remoto: 35 migraciones.
- `migration fetch` recuperó exactamente las 35 migraciones del manifiesto.
- `migration list` mostró coincidencia local/remota completa antes de agregar
  la candidata.
- Se confirmaron 1, 2, 3A, 3B-1 v3, 3B-2 v2, 3C-1, 3C-2 y 4A v2.
- 4B v2 y sus objetos permanecen ausentes.
- La segunda consulta de historial, posterior al dry-run, volvió a mostrar 35
  migraciones remotas y 4B v2 únicamente como pendiente local.

## 3. Resultado literal sanitizado del dry-run

```text
DRY RUN: migrations will *not* be pushed to the database.
Connecting to remote database...
Would push these migrations:
 • 20261018171254_stage_c_campaign_admin_private_functions_v2.sql
{"upToDate":false,"dryRun":true,"migrations":["20261018171254_stage_c_campaign_admin_private_functions_v2.sql"],"seeds":[],"roles":[],"message":"Finished supabase db push."}
EXIT_CODE=0

CLI_VERSION=2.121.0
TLS_MODE=verify-full
CA_FILE=prod-ca-2021.crt
REMOTE_HISTORY=35_MATCHED
AUTHORIZED_FILE=20261018171254_stage_c_campaign_admin_private_functions_v2.sql
SHA256=3330F8118C5539548AFC0A6804D4BD1AEDD799F70E68CD4FBCDB3790E62DC429
PREFLIGHT_RESULT=PASS_ONLY_4B_V2
DATABASE_WRITE=NONE
```

## 4. Dependencias instaladas

Las funciones requeridas existen con el centinela esperado, `search_path=''`
y sin `EXECUTE` para `PUBLIC`, `anon`, `authenticated` o `service_role`:

| Dependencia | Centinela |
|---|---|
| `private.stage_c_assert_admin()` | `cubica_stage_c:20261018171210` |
| `private.stage_c_active_campaign(timestamptz)` | `cubica_stage_c:20261018171218` |
| `private.stage_c_next_change(timestamptz)` | `cubica_stage_c:20261018171223` |
| `private.get_site_experience(timestamptz)` | `cubica_stage_c:20261018171231` |
| `private.admin_get_site_configuration()` | `cubica_stage_c:20261018171232` |
| `private.admin_register_site_asset(...)` | `cubica_stage_c:20261018171249` |

Las once tablas existentes de Etapa C mantienen RLS y cero grants directos a
roles de Data API. `site-assets` sigue privado, con límite de 8 MiB, MIME JPEG,
PNG y WebP, y sin políticas públicas.

## 5. Auditoría de idempotencia

4B v2 incorpora `private.site_campaign_idempotency` con:

- clave primaria `(actor_id, operation, request_id)`;
- `actor_id` relacionado con `auth.users`;
- operación restringida a `create`, `duplicate` o `state`;
- payload normalizado, campaña resultante y respuesta original;
- RLS habilitado, política denegatoria y revocación total para roles API;
- índice parcial para la referencia a la campaña resultante.

Las funciones auxiliares reservan y completan la operación dentro de la misma
transacción que el cambio comercial. Un error revierte también la reserva. La
misma identidad, operación y clave con el mismo payload devuelve la respuesta
original; un payload diferente se rechaza. La identidad forma parte de la clave,
por lo que un administrador no recibe resultados de otro.

Creación, duplicación y cambio de estado utilizan el mecanismo. La creación
exige `request_id`; edición conserva el control de versión sin crear una reserva
innecesaria.

## 6. Concurrencia y consistencia

La duplicación usa este orden:

1. fila idempotente;
2. campaña fuente `FOR UPDATE`;
3. ocurrencias ordenadas por `id` con `FOR SHARE`;
4. frases ordenadas por `id` con `FOR SHARE`.

La revisión esperada y `deleted_at` se comprueban después de bloquear la fuente.
Campaña, fechas, frases y recursos se copian en una sola transacción. No quedan
copias parciales si una inserción falla.

Publicar nuevamente el mismo estado no incrementa la versión ni modifica
`published_at`. Un `request_id` repetido devuelve la publicación original. Una
revisión obsoleta distinta se rechaza con conflicto explícito y una edición
posterior puede publicarse legítimamente.

La concurrencia real con dos conexiones PostgreSQL independientes sigue **NO
EJECUTADA**. PGlite 17.5 tiene una sola sesión y no había PostgreSQL servidor ni
Docker disponibles. Los locks reducen el riesgo por diseño, pero la carrera no
está demostrada empíricamente.

## 7. Seguridad de 4B v2

Las seis funciones nuevas son `SECURITY DEFINER`, fijan `search_path=''`, quedan
sin ejecución para `PUBLIC`, `anon`, `authenticated` y `service_role`, y dependen
del guard administrativo AAL2. No se crea ninguna RPC pública ni se publica una
campaña al guardar un borrador.

La tabla y las funciones candidatas siguen ausentes en producción porque no se
aplicó la migración.

Security Advisor conserva solamente hallazgos anteriores al bloque:

- ocho avisos informativos por tablas privadas cerradas mediante RLS y sin
  políticas permisivas;
- `track_public_event` ejecutable por `anon`;
- diecisiete RPC `SECURITY DEFINER` ejecutables por usuarios autenticados;
- protección contra contraseñas filtradas deshabilitada.

No apareció ningún hallazgo atribuible a 4B v2.

## 8. Compatibilidad pendiente

- 4A v2: compatible y confirmada como dependencia.
- 4C v1: congelado; 4C v2 deberá impedir asociar o restaurar frases en campañas
  eliminadas y mantener el orden campaña → frase.
- 5A, 5B y 5C: no llaman operaciones administrativas de campañas.
- Bloque 6: debe exigir el centinela 171254.
- 7A-1: debe actualizar el requisito de 4B.
- 7A-2: debe incorporar `request_id` y revisión esperada en los wrappers.
- 7A-3: no depende de campañas.
- 7B: debe actualizar firmas y conceder únicamente grants explícitos mínimos.
- Frontend: debe conservar un UUID estable por intento y enviar la revisión al
  duplicar.
- Edge Functions actuales: no administran campañas.
- Sonda de instalación: actualizada para 4B v2.
- Recuperación específica: elimina las superficies ejecutables y conserva la
  tabla idempotente privada como auditoría.

El cambio anunciado por Supabase para permisos de objetos nuevos en `public` no
afecta la tabla privada. Los wrappers futuros deberán recibir grants por función
y rol en 7B, sin permisos globales.

## 9. Pruebas posteriores preparadas

Después de una instalación autorizada se deberá comprobar:

1. historial, centinela, tabla, índice, restricciones y seis funciones;
2. ACL, RLS, MFA AAL2 y ausencia de RPC pública;
3. creación, duplicación y publicación idempotentes;
4. conflicto por reutilización de clave o revisión obsoleta;
5. rechazo de campañas eliminadas;
6. rollback de un fallo intermedio;
7. coherencia de fechas, frases y recursos;
8. aislamiento entre identidades administrativas;
9. Storage y las once tablas anteriores;
10. conciliación comercial y ausencia de residuos QA.

Las pruebas dinámicas de escritura deberán usar fixtures ficticios, una
transacción y `ROLLBACK`. No fueron ejecutadas durante este preflight.

## 10. Conciliación comercial

Los conteos frescos fueron iguales antes y después del dry-run:

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

Las tablas de Etapa C permanecen vacías. No hay registros QA.

La línea de base del preflight anterior registraba 17 productos y 35 insumos.
Antes de iniciar este preflight ya había 16 productos y 36 insumos. Los tiempos
de actualización muestran una operación administrativa previa el 21 de octubre
de 2026 y un nuevo insumo creado en ese intervalo. No hubo movimientos de
inventario nuevos. Este dry-run no produjo la diferencia. Conviene confirmar
que esos cambios comerciales fueron intencionales antes de una instalación real.

## 11. Incidencias y pruebas no ejecutadas

- Una primera consulta de conteos usó un nombre histórico de tabla inexistente;
  PostgreSQL la rechazó antes de devolver datos. Se corrigió y se repitió en modo
  lectura, sin efectos.
- Concurrencia multisesión real: no ejecutada.
- Pruebas dinámicas posteriores a la instalación: no ejecutadas porque 4B v2 no
  fue aplicada.
- No hubo pruebas fallidas del artefacto ni discrepancias del CLI.

## 12. Recomendación

El preflight técnico permite proceder con una instalación única y controlada de
4B v2: archivo, hash, dependencias, historial y dry-run coinciden, y no existen
objetos candidatos previos.

La autorización de instalación debería exigir nuevamente el dry-run inmediato,
aplicar una sola migración y detenerse ante cualquier diferencia. También debe
confirmarse que la línea comercial actual de 16 productos y 36 insumos es la
esperada. La concurrencia multisesión continúa como riesgo residual documentado.

## 13. Confirmación de alcance

**Cero escrituras en producción.** No se ejecutó `db push` real, SQL Editor,
`migration repair`, migraciones, DDL, DML, grants, políticas, Edge Functions,
frontend, campañas, secretos ni Etapa D.
