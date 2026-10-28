# Cúbica 3D — Etapa C — Preflight de producción 5A v2

Fecha: 2026-10-22 (America/Argentina/Buenos_Aires)

Resultado: **APROBADO PARA SOLICITAR UNA AUTORIZACIÓN SEPARADA DE INSTALACIÓN**.

Este procedimiento fue exclusivamente de lectura. No se instaló 5A v2, no se
modificó el historial de migraciones, no se ejecutó `migration repair`, no se
usó SQL Editor y no se alteraron datos, permisos, RLS, Storage, secretos,
funciones ni frontend de producción.

## Artefactos verificados

- Candidato: `20261018171256_stage_c_content_faq_private_functions_v2.sql`
- SHA-256: `17BEF84D211B74F54A9354E0EB7F4887F065F751A3E7E0FE494905BC3772CB66`
- Tamaño: 17.403 bytes.
- Verificación: `supabase/verification/20261018171256_verify.sql`, SHA-256
  `6FDB029CEB1F17EDEC7F34D3DA4EABDD7E94C39ED07A9804ABAFFA028C42C389`.
- Recuperación: `supabase/rollback/20261018171256_stage_c_content_faq_private_functions_v2.sql`, SHA-256
  `B475DFE8E9F51260F1972586F33DE5BF4E70D5D1A69E779083E93D4A4BB6FD2E`.
- La versión reemplazada está archivada como
  `supabase/archive/20261018171301_stage_c_content_faq_private_functions.pre_idempotency.sql`, SHA-256
  `5351734526A909BACDE0A822258B811365C680B2D046AB11E9B40EBD08D99F50`.
- La versión reemplazada no está presente en `supabase/migrations`.
- No se modificó el SQL candidato durante el preflight.

## Estado inicial y final de producción

- Proyecto: `cubica-web` (`mymrbpwvghxmqqpzzdqk`), estado `ACTIVE_HEALTHY`.
- Región: `sa-east-1`.
- PostgreSQL: 17.11.
- Historial remoto: 37 migraciones antes y después del dry-run.
- 5A v2: ausente antes y después (`candidate_rows=0`).
- Dependencias verificadas: bloques 1, 2, 3A, 3B-1 v3, 3B-2 v2, 3C-1,
  3C-2, 4A v2, 4B v2 y 4C v2, con centinelas y firmas esperados.
- Tablas privadas de Etapa C: 12 de 12 con RLS habilitado.
- Grants directos de API sobre esas tablas: 0.
- Bucket `site-assets`: privado, límite 8 MiB, MIME JPEG/PNG/WebP y 0 políticas
  públicas aplicables.
- Objetos propios de 5A v2 presentes en producción: 0 funciones, 0 columna
  `source_draft_version` y 0 índices nuevos.

Conteos comerciales conciliados antes y después:

| Entidad | Antes | Después |
|---|---:|---:|
| Productos | 16 | 16 |
| Insumos | 36 | 36 |
| Pedidos | 17 | 17 |
| Movimientos de inventario | 11 | 11 |

Contenido de Etapa C en producción: 0 páginas, 0 versiones de contenido y 0
FAQ. El preflight no creó registros QA.

## Historial y dry-run de Supabase CLI

- CLI: 2.121.0.
- Conexión: Session Pooler IPv4, TLS `verify-full`, CA oficial y contraseña
  rotada ingresada de forma oculta.
- `migration fetch`: recuperó exactamente las 37 migraciones del manifiesto.
- `migration list`: las 37 versiones locales recuperadas coincidieron con las
  37 remotas.
- Directorio aislado: 37 migraciones recuperadas más una única candidata.

Salida literal sanitizada relevante:

```text
DRY RUN: migrations will *not* be pushed to the database.
Connecting to remote database...
Would push these migrations:
 • 20261018171256_stage_c_content_faq_private_functions_v2.sql
{"upToDate":false,"dryRun":true,"migrations":["20261018171256_stage_c_content_faq_private_functions_v2.sql"],"seeds":[],"roles":[],"message":"Finished supabase db push."}
EXIT_CODE=0

CLI_VERSION=2.121.0
TLS_MODE=verify-full
CA_FILE=prod-ca-2021.crt
REMOTE_HISTORY=37_MATCHED
AUTHORIZED_FILE=20261018171256_stage_c_content_faq_private_functions_v2.sql
SHA256=17BEF84D211B74F54A9354E0EB7F4887F065F751A3E7E0FE494905BC3772CB66
PREFLIGHT_RESULT=PASS_ONLY_5A_V2
DATABASE_WRITE=NONE
```

La lista posterior al dry-run volvió a mostrar 5A v2 solo como local pendiente
y mantuvo 37 versiones remotas.

## Auditoría funcional

### Publicación idempotente

- `source_draft_version` identifica la revisión exacta que originó una versión
  publicada.
- El índice parcial único `(page_slug, source_draft_version)` impide publicar
  dos veces la misma revisión, incluso si la versión anterior ya fue archivada.
- La publicación bloquea el borrador con `FOR UPDATE`, valida la versión
  esperada y devuelve el registro histórico existente ante un reintento. No
  altera su fecha ni crea una versión adicional.
- Una revisión nueva puede publicarse y una revisión obsoleta se rechaza con
  conflicto de concurrencia.
- Los lectores públicos seleccionan únicamente estado `published`; el borrador
  continúa separado.

### FAQ, duplicados y restauración

- La clave de unicidad normaliza mayúsculas/minúsculas, espacios iniciales y
  finales y grupos de espacios internos.
- Acentos y puntuación se conservan, por lo que preguntas legítimamente
  diferentes no se unifican.
- La unicidad abarca todos los registros no eliminados, activos e inactivos;
  el soft-delete libera la pregunta y una restauración conflictiva falla sin
  cambios parciales.
- La eliminación conserva identidad e historial y oculta inmediatamente la FAQ
  del lector público.
- `admin_list_faq(true)` permite listar eliminadas desde administración.
- `admin_restore_faq` exige la versión esperada, conserva identidad, contenido
  y orden, y restaura con `active=false`. La reactivación requiere una acción
  posterior explícita.
- `admin_upsert_faq` no puede restaurar implícitamente un registro eliminado.

## Seguridad del contenido

- El payload debe ser un objeto plano con claves permitidas: `body`, `email`,
  `phone`, `instagram`, `address`, `hours` y `commercial`.
- Se rechazan objetos anidados, arrays, claves desconocidas, contenido vacío,
  longitudes excesivas, correo inválido, URL de Instagram fuera de HTTPS y
  patrones ejecutables rechazados por el validador central.
- El backend no interpreta HTML ni Markdown. La prueba del renderizador previsto
  confirmó que escapa HTML y no convierte protocolos `javascript:`.
- Antes de publicar el frontend debe mantenerse ese renderizador seguro: texto
  escapado, Markdown limitado y vínculos restringidos a protocolos aprobados.
  La validación SQL sola no sustituye el escape de salida ni una CSP adecuada.
- No hay soporte para referencias arbitrarias a imágenes dentro del contenido;
  los recursos visuales continúan gestionados por el bucket privado y las
  funciones de activos de Etapa C.

## Seguridad administrativa

- Todas las operaciones administrativas llaman al guard central
  `private.stage_c_assert_admin()`, que exige administrador y MFA AAL2.
- Ocho funciones administrativas/lectoras privilegiadas son `SECURITY DEFINER`;
  dos auxiliares de normalización/validación son `SECURITY INVOKER`.
- Las diez funciones tienen `search_path=''`.
- La propia migración revoca `EXECUTE` de `PUBLIC`, `anon`, `authenticated` y
  `service_role` antes de validar el centinela.
- No crea RPC públicas ni concede acceso directo a tablas privadas.
- No publica páginas ni FAQ automáticamente.

## Pruebas

- Suite específica 5A v2: 23 aprobadas, 0 fallidas.
- Suite general Etapa C: 28/28 aprobadas.
- PostgreSQL aislado: 17.5; producción: 17.11.
- Se verificaron firma, centinela, modos de seguridad, ACL, `search_path`,
  idempotencia, revisión obsoleta, separación borrador/publicado, duplicados,
  soft-delete, listado de eliminadas, restauración válida y conflictiva, AAL1,
  usuario común, contenido malicioso, lectura pública y rollback sin residuos.

No ejecutadas, sin presentarlas como pruebas secuenciales equivalentes:

1. Dos publicaciones simultáneas.
2. Creación simultánea de FAQ duplicadas.
3. Restauración concurrente con creación o edición.
4. Eliminación concurrente con restauración.

El diseño usa bloqueos de fila, control de versión e índices únicos, por lo que
dispone de defensas correctas. La validación multisesión real sigue siendo un
riesgo residual y debe completarse antes de habilitar wrappers administrativos.

## Compatibilidad y tareas coordinadas pendientes

- 5B y 5C son compatibles con los objetos privados de 5A v2.
- El bloque 6 aún verifica el centinela reemplazado `20261018171301`; necesita
  una versión coordinada que dependa de `20261018171256`.
- 7A-1 también conserva esa dependencia antigua y necesita actualización.
- 7A-2 crea el wrapper de `admin_upsert_faq`, pero aún no incluye wrappers para
  `admin_list_faq(boolean)` ni `admin_restore_faq(bigint,integer)`.
- 7B debe conceder únicamente los permisos mínimos y explícitos a los wrappers
  finales, incluyendo los dos nuevos, manteniendo privadas las funciones base.
- El frontend administrativo todavía necesita el filtro de papelera, la acción
  de restaurar y mensajes de conflicto/revisión obsoleta.
- El frontend público es compatible si conserva el renderizado seguro ya
  probado.
- La preparación para el cambio de permisos anunciado por Supabase exige que
  los futuros grants sean explícitos y mínimos; 5A v2 permanece cerrada y no
  depende de permisos implícitos.

## Security Advisor

El Advisor no presenta hallazgos nuevos atribuibles a 5A v2, que sigue ausente.
Persisten los hallazgos ya conocidos:

- 8 avisos informativos de tablas privadas con RLS y sin políticas.
- 1 advertencia por `track_public_event` ejecutable por `anon`.
- 17 advertencias de funciones `SECURITY DEFINER` ejecutables por usuarios
  autenticados; pertenecen a flujos existentes y requieren validación interna
  de identidad/MFA según cada caso.
- Protección de contraseñas filtradas deshabilitada.

Estos hallazgos no cambiaron durante el preflight y no se modificaron porque
están fuera del alcance autorizado.

## Verificaciones previstas después de una eventual instalación

Con autorización separada se deberán ejecutar dentro de transacciones con
`ROLLBACK`: firma y centinela; ACL/MFA AAL2; publicación inicial y repetida;
revisión obsoleta; borrador frente a publicado; FAQ duplicada y distinta;
soft-delete; listado de eliminadas; restauración válida y conflictiva;
restauración inactiva; lecturas administrativa y pública; RLS/Storage; conteos
comerciales y ausencia de residuos QA. Las pruebas multisesión deben usar un
servidor aislado con conexiones independientes, nunca escrituras concurrentes
en producción.

## Recomendación

No se detectó un bloqueador para instalar **solo 5A v2** mediante el mismo
procedimiento controlado, porque la migración queda cerrada y no activa
wrappers. La instalación requiere una autorización nueva y específica.

Después de instalarla, no se deben activar wrappers ni avanzar a los bloques
6/7 hasta corregir sus referencias y permisos, y completar las pruebas
multisesión pendientes. La instalación de 5A v2 no fue ejecutada en este
preflight.
