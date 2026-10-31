# CÚBICA 3D — Etapa C, corrección local y validación de 5A v2

Fecha: 2026-10-22 (America/Argentina/Buenos_Aires)

Resultado: **5A v2 LISTA PARA UN PREFLIGHT DE PRODUCCIÓN SEPARADO.**

Esta tarea no se conectó a Supabase de producción y no ejecutó migraciones,
`db push`, SQL Editor, `migration repair`, despliegues ni cambios remotos.

## Identidad y archivos

Migración aplicable nueva:

- Archivo: `supabase/migrations/20261018171256_stage_c_content_faq_private_functions_v2.sql`
- Nombre previsto: `stage_c_20261018171256_content_faq_private_functions_v2`
- SHA-256: `17BEF84D211B74F54A9354E0EB7F4887F065F751A3E7E0FE494905BC3772CB66`
- Centinela: `private.admin_restore_faq(bigint,integer)` = `cubica_stage_c:20261018171256`

Artefactos asociados:

- Verificación: `supabase/verification/20261018171256_verify.sql`
  - SHA-256: `6FDB029CEB1F17EDEC7F34D3DA4EABDD7E94C39ED07A9804ABAFFA028C42C389`
- Recuperación no destructiva:
  `supabase/rollback/20261018171256_stage_c_content_faq_private_functions_v2.sql`
  - SHA-256: `B475DFE8E9F51260F1972586F33DE5BF4E70D5D1A69E779083E93D4A4BB6FD2E`
- Prueba PostgreSQL 17:
  `tests/stage-c-5a-v2-postgres17.test.mjs`

Versión histórica archivada fuera de migraciones aplicables:

- `supabase/archive/20261018171301_stage_c_content_faq_private_functions.pre_idempotency.sql`
- SHA-256 conservado:
  `5351734526A909BACDE0A822258B811365C680B2D046AB11E9B40EBD08D99F50`
- Su verificación original también quedó archivada como
  `supabase/archive/20261018171301_verify.pre_idempotency.sql`.

Inventario completo de esta preparación:

- Creados: migración 5A v2, verificación 5A v2, recuperación 5A v2,
  `tests/stage-c-5a-v2-postgres17.test.mjs` y este informe.
- Archivados: migración 5A v1 y su verificación, sin cambiar sus bytes.
- Modificados: `tests/site-configuration-stage-c.test.mjs`,
  `tests/stage-c-5a-preflight-postgres17.test.mjs`,
  `supabase/verification/stage_c_installation_status.sql`,
  `supabase/rollback/20261018171500_stage_c_partial_safe_state.sql`,
  `docs/STAGE_C_SPLIT_DEPLOYMENT_PLAN.md`, `docs/STAGE_C_RECOVERY.md`,
  `docs/STAGE_C_FINAL_SUBDIVISION_20261018.md` y
  `docs/STAGE_C_FINAL_PREPARATION_20261019.md`.

## Publicaciones de páginas

5A v2 añade `source_draft_version` a `private.site_content_versions` y el índice
único parcial `site_content_one_publish_per_draft`.

La publicación ahora sigue estas reglas:

1. Bloquea el único borrador de la página con `FOR UPDATE`.
2. Comprueba `p_expected_version`; una revisión vieja devuelve SQLSTATE `40001`.
3. Busca una publicación histórica cuyo `source_draft_version` coincida con la
   revisión actual.
4. Si ya existe, devuelve exactamente esa fila sin cambiar `published_at`, sin
   incrementar versiones y sin crear historia adicional.
5. Si el borrador cambió, crea una versión pública nueva y archiva la anterior.

El bloqueo del borrador serializa publicaciones de la misma página. El índice
único es una defensa adicional en la base. Guardar un borrador sin cambios ahora
también es idempotente y no incrementa su versión.

## Regla de duplicidad de FAQ

Una FAQ se considera duplicada cuando su pregunta normalizada coincide con otra
FAQ no eliminada. La normalización:

- elimina espacios al principio y al final;
- colapsa secuencias de espacios, tabulaciones y saltos a un único espacio;
- compara sin distinguir mayúsculas/minúsculas;
- conserva palabras, signos y acentos, por lo que preguntas meramente parecidas
  siguen siendo válidas.

La regla se aplica a FAQ visibles y ocultas mientras `deleted_at is null`. Esto
evita duplicados entre borradores y contenido visible. Dos registros eliminados
pueden conservarse como historial. El índice único parcial
`site_faq_unique_current_question` garantiza la regla también ante concurrencia.

Solicitudes repetidas se reconocen así:

- creación: la pregunta normalizada actúa como clave de unicidad;
- edición/eliminación/restauración: `id` + `p_expected_version`;
- actualización sin cambios: devuelve la fila actual sin incrementar `version`;
- revisión obsoleta: conflicto explícito `40001`.

## Restauración de FAQ

Se añadieron dos contratos privados:

- `private.admin_list_faq(p_include_deleted boolean)`
- `private.admin_restore_faq(p_id bigint,p_expected_version integer)`

El listado administrativo puede incluir FAQ eliminadas y devuelve `deleted_at`
y el indicador `deleted`. Restaurar:

1. exige administrador con MFA AAL2;
2. bloquea la fila y valida su versión;
3. conserva `id`, pregunta, respuesta y orden;
4. limpia `deleted_at`, incrementa `version` y registra quién actualizó;
5. fuerza `active=false`.

Por tanto, una FAQ restaurada no reaparece públicamente. Un administrador deberá
activarla en una segunda decisión explícita. Si otra FAQ no eliminada tiene la
misma pregunta normalizada, la restauración se rechaza con SQLSTATE `23505` y no
modifica el registro histórico.

`admin_upsert_faq` conserva su firma. Ya no restaura implícitamente registros
eliminados; exige utilizar `admin_restore_faq`.

## Contenido y XSS

- El contenido debe ser un objeto con claves permitidas y al menos un valor no
  vacío. Una página de contacto puede tener datos de contacto sin cuerpo.
- Cuerpo: máximo 20.000 caracteres. Campos de contacto: máximo 500. Título:
  obligatorio, máximo 140. FAQ: pregunta 3–240 y respuesta 3–3.000.
- Se rechazan valores anidados, claves desconocidas, formatos de email inválidos,
  Instagram fuera de HTTPS y patrones ejecutables (`script`, `iframe`, `object`,
  `embed`, `style`, atributos `on*`, `javascript:` y `data:text/html`).
- El frontend previsto escapa HTML antes de interpretar Markdown limitado. Solo
  transforma negrita y enlaces `https://`/`mailto:`; no interpreta imágenes ni
  HTML crudo.
- Las funciones públicas privadas solo devuelven versiones publicadas y FAQ
  activas/no eliminadas. No incluyen autores ni datos administrativos.

La defensa depende de ambas capas. Si el frontend cambia de renderizador deberá
mantener el escape previo y una lista explícita de protocolos/elementos.

## Seguridad

- Las ocho funciones lectoras/administrativas son `SECURITY DEFINER` con
  `search_path=''`.
- Los dos auxiliares de validación/normalización son `SECURITY INVOKER`, también
  con `search_path=''`.
- Todas las operaciones administrativas llaman al guard central
  `private.stage_c_assert_admin()`, que conserva rol administrador + MFA AAL2.
- `EXECUTE` queda revocado para `PUBLIC`, `anon`, `authenticated` y
  `service_role` en las diez funciones.
- No se crean RPC públicas, políticas, grants de tablas ni permisos de Storage.
- Los tres objetos de datos afectados mantienen RLS y no reciben acceso directo.
- La futura exposición deberá usar wrappers invoker y grants explícitos mínimos;
  no depende de privilegios automáticos de Supabase.

## Pruebas ejecutadas

Entorno: PGlite/PostgreSQL 17.5 descartable, datos ficticios y `ROLLBACK`.

5A v2:

- 23 comprobaciones aprobadas.
- 0 fallidas.
- 4 no ejecutadas: publicaciones simultáneas, altas simultáneas duplicadas,
  restauración contra creación/edición y eliminación contra restauración.
- No hay `psql`, Docker ni Podman disponibles para levantar un PostgreSQL 17 con
  dos conexiones independientes. Las pruebas secuenciales no se presentaron como
  concurrencia real.

Cobertura aprobada:

- creación/edición/no-op de borradores;
- publicación inicial, repetida y posterior a cambios;
- conflictos de revisión;
- aislamiento borrador/publicado;
- creación, edición, orden, soft-delete, listado y restauración de FAQ;
- duplicados normalizados y preguntas legítimamente distintas;
- restauración conflictiva y rollback atómico;
- contenido vacío, HTML ejecutable, URLs, Markdown y Unicode;
- AAL1 y usuario común rechazados;
- lectores públicos;
- ausencia de residuos QA;
- firmas, centinela, índices, modos de seguridad, `search_path` y ACL;
- recuperación no destructiva.

Regresión histórica:

- El archivo 5A v1 archivado volvió a reproducir los dos defectos originales:
  dos versiones al repetir una publicación y aceptación de una FAQ duplicada.
- El mismo conjunto base sobre 5A v2 aprobó las correcciones.

Suite estática general de Etapa C: 28/28 aprobadas tras registrar los nuevos
objetos intencionales.

## Matriz de compatibilidad antes de activar

| Componente | Estado frente a 5A v2 | Trabajo futuro necesario |
|---|---|---|
| 5B / 5C | Compatible | Ninguno; no dependen de firmas 5A. |
| Bloque 6 | Incompatible por centinela | Preparar versión nueva que exija `20261018171256`; no fue modificada. |
| 7A-1 | Incompatible por centinela 5A v1 | Preparar versión coordinada; no fue modificada. |
| 7A-2 | Firmas existentes compatibles, contratos nuevos ausentes | Añadir wrappers cerrados para `admin_list_faq(boolean)` y `admin_restore_faq(bigint,integer)` y actualizar conteos/verificación. |
| 7A-3 | Compatible | Ninguno. |
| 7B | Incompleto | Añadir grants explícitos solo a `authenticated` para los dos contratos privados y sus wrappers; mantenerlos cerrados a los demás roles. |
| Frontend público | Compatible | Mantener escape y Markdown limitado. |
| Frontend administrativo | Incompleto | Añadir filtro de eliminadas, acción Restaurar con confirmación, tratamiento de `40001`/`23505`/`55000` y recarga posterior. |
| `admin_get_site_configuration()` | Compatible para FAQ vigentes | Puede mantenerse; la papelera se obtiene por `admin_list_faq(true)`. |
| Sonda general | Actualizada localmente | Verificarla en el próximo preflight. |
| Recuperación parcial | Actualizada localmente | Incluye las tres firmas nuevas y conserva datos. |

No se modificaron frontend, wrappers, bloque 6 ni 7B durante esta tarea.

## Riesgos residuales y recomendación

La lógica transaccional y los índices cubren las carreras por diseño, pero las
cuatro pruebas multisesión reales siguen pendientes. Deben ejecutarse en una base
PostgreSQL 17 aislada antes de activar wrappers administrativos; no requieren
bloquear el preflight de instalación cerrada si el siguiente paso mantiene las
funciones sin `EXECUTE` para roles de API.

5A v2 está lista para un preflight separado de producción que vuelva a comprobar
las 37 migraciones remotas, confirme que 5A v1 y v2 están ausentes, ejecute un
`db push --dry-run --include-all` con únicamente 5A v2 y se detenga sin escribir.
