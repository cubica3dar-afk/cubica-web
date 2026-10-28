# CÚBICA 3D — Etapa C, corrección local y validación de 5B v2

Fecha inicial: 22 de octubre de 2026  
Actualización de concurrencia: 24 de octubre de 2026  
Alcance: preparación y pruebas locales aisladas. Supabase de producción fue consultado únicamente en modo lectura para el preflight; no fue modificado.  
Resultado: **5B v2 validada en PostgreSQL 17.5 y en PostgreSQL 17.11 real con sesiones independientes. El preflight remoto aprobó, aunque quedan dos observaciones de semántica de replay/idempotencia que conviene corregir antes de instalar.**

## Artefacto definitivo

- Archivo: `supabase/migrations/20261018171257_stage_c_suggestion_protection_private_functions_v2.sql`
- Nombre administrado previsto:
  `stage_c_20261018171257_suggestion_protection_private_functions_v2`
- SHA-256:
  `A90B2433C4CB0BB6CAA33BF269A650314FB62D95ABF62BDD65257168D0AA3129`
- Tamaño: 17.158 bytes.
- Centinela: `cubica_stage_c:20261018171257`.

Artefactos auxiliares:

| Archivo | SHA-256 |
|---|---|
| `supabase/verification/20261018171257_verify.sql` | `A5A770B89847D8B9A97D1782B0A90209B0526FFBAF92819FCE408F8CC9B66135` |
| `supabase/rollback/20261018171257_stage_c_suggestion_protection_private_functions_v2_safe_state.sql` | `246B7563D53F8E5D8CB067B1C679E6BE6087E1D2C631252B0E1F0A4BC7FA6E44` |

La candidata anterior permanece como referencia histórica fuera de las
migraciones aplicables:

| Archivo archivado | SHA-256 |
|---|---|
| `supabase/archive/20261018171302_stage_c_suggestion_protection_private_functions.pre_atomic.sql` | `9D47D8AF0C728234E30FDD8A1889D1C57E7CA34417236B04F4F50BB441732BB1` |
| `supabase/archive/20261018171302_verify.pre_full_signatures.sql` | `CD08E5651B5A192A28D34047A713AA46F6576B8FAC55AC5879BEFF9736EC0494` |

El test que documentaba los defectos de v1 fue movido a
`tests/archive/stage-c-5b-v1-preflight-postgres17.test.mjs` y apunta a esos
archivos archivados.

## Cambios de esquema locales

5B v2 no crea tablas públicas. Amplía las dos tablas privadas existentes:

### `private.suggestion_rate_limits`

- `scope`: `legacy`, `user`, `guest` o `network`.
- `updated_at`: fecha de la última evaluación.
- Constraint de hash hexadecimal de 64 caracteres.
- Índice de limpieza por `updated_at, blocked_until`.

### `private.suggestion_token_uses`

Se convierte también en el registro privado de idempotencia:

- `request_id`.
- `actor_kind`.
- `actor_hash`.
- `network_hash`.
- `payload_hash`.
- `result_code`.
- `suggestion_id`.
- `retry_after_seconds`.

Incluye constraints de coherencia, unicidad parcial por `request_id`, índice de
retención y un índice para detectar contenido repetido.

Las columnas nuevas aceptan filas históricas con `result_code` nulo. Las filas
nuevas creadas por v2 deben incluir todos los metadatos y hashes válidos.

## Contrato privado

### Auxiliar de límites

`private.stage_c_apply_suggestion_limit(text,text,integer,timestamptz)`

- Retorna `jsonb`.
- Es `SECURITY INVOKER`, volátil y tiene `search_path=''`.
- Usa un único `INSERT ... ON CONFLICT DO UPDATE` para crear o actualizar el
  contador.
- El UPSERT bloquea la fila conflictiva e incrementa sin ejecutar un
  `SELECT` previo sobre una fila inexistente.
- No extiende un bloqueo activo.
- Devuelve `allowed`, un código interno y `retry_after_seconds`.

### Operación transaccional

`private.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)`

Argumentos, en orden:

1. Hash del token Turnstile.
2. Hash del origen de red.
3. Hash del actor.
4. Tipo de actor: `user` o `guest`.
5. Categoría.
6. Asunto.
7. Descripción.
8. Contacto opcional.
9. UUID de solicitud.
10. UUID de usuario verificado o `NULL`.

Retorna un JSON con uno de estos estados:

| Estado | Significado | HTTP futuro |
|---|---|---:|
| `accepted` | Creada, reintento idempotente o contenido ya recibido | 201 nuevo / 200 repetido |
| `rate_limited` | Actor o red bloqueados | 429 + `Retry-After` |
| `idempotency_conflict` | Mismo UUID con identidad, red o contenido distintos | 409 |
| `token_replayed` | Token ya asociado a otra solicitud | 409 |

No devuelve hashes, contadores ni el ámbito que produjo el bloqueo. Los errores
técnicos siguen usando excepciones y deben mapearse a una respuesta genérica
503.

## Semántica transaccional

La operación completa ocurre en una sola transacción PostgreSQL:

1. Comprueba que el invocador efectivo sea `service_role`.
2. Valida hashes, actor, usuario, categoría, longitudes y texto plano.
3. Normaliza y calcula el hash del payload en la base.
4. Resuelve un reintento previo por `request_id`.
5. Serializa actor + payload mediante advisory lock para evitar duplicados
   concurrentes.
6. Detecta contenido idéntico del mismo actor en las últimas 24 horas.
7. Reserva token e idempotencia.
8. Aplica primero el límite del actor y luego el de red, siempre en ese orden.
9. Inserta la sugerencia.
10. Guarda el resultado aceptado y devuelve su UUID.

Un rechazo esperado retorna normalmente. Así se confirman el bloqueo y el
resultado de idempotencia. El bloqueo dura una hora desde el primer exceso y
los intentos posteriores no lo prolongan.

Una excepción técnica revierte conjuntamente token, contadores, registro de
idempotencia y sugerencia. La prueba con un trigger que falla durante el INSERT
confirmó ausencia de registros parciales.

## Límites definidos

| Ámbito | Cupo | Ventana | Bloqueo al exceder |
|---|---:|---:|---:|
| Usuario autenticado | 5 intentos | 1 hora | 1 hora fija |
| Invitado | 3 intentos | 1 hora | 1 hora fija |
| Origen de red agregado | 20 intentos | 1 hora | 1 hora fija |

Los intentos rechazados quedan asociados al UUID y token. El contenido idéntico
del mismo actor se deduplica durante 24 horas y devuelve el UUID original sin
crear otra sugerencia ni consumir otro cupo.

El actor autenticado debe derivarse del UUID obtenido por Supabase Auth. El
invitado debe usar un hash con dominio propio que combine el origen de red
confiable y una señal secundaria normalizada. Esa señal puede ser manipulable,
pero el límite agregado por red impide depender exclusivamente de ella.

No se almacena la IP en texto plano. La Edge Function deberá calcular hashes
con dominios separados y `SUGGESTION_RATE_LIMIT_SALT`, idealmente mediante
HMAC-SHA-256:

- `suggestion:user:<uuid verificado>`;
- `suggestion:guest:<red confiable>:<user-agent normalizado>`;
- `suggestion:network:<red confiable>`;
- `suggestion:token:<token Turnstile>`.

La sal no forma parte del SQL, frontend ni respuestas.

## Idempotencia y retención

- `request_id` es único en el registro privado.
- La huella incluye actor, red y payload normalizado.
- Repetir exactamente la solicitud devuelve el mismo `suggestion_id`.
- Reutilizar el UUID con datos distintos devuelve `idempotency_conflict`.
- Reutilizar un token en otra solicitud devuelve `token_replayed`.
- El registro declara `expires_at=used_at+24 horas`.
- 5C deberá eliminar registros cuando `expires_at<now()`. Su implementación
  actual conserva un día adicional y debe corregirse en una versión posterior.
- Los límites vencidos pueden limpiarse después de 48 horas, siempre que
  `blocked_until` también haya vencido.

Un UUID que recibió `rate_limited` conserva ese resultado. Después de vencer el
bloque se inicia una nueva solicitud con un UUID y un token nuevos.

## Validación y seguridad

La migración valida:

- categorías permitidas;
- asunto de 3–160 caracteres;
- descripción de 10–3.000;
- contacto opcional de hasta 320;
- hashes hexadecimales de 64 caracteres;
- coherencia entre `actor_kind` y usuario verificado;
- rechazo de HTML, `javascript:`, `vbscript:` y `data:`;
- FK real para el UUID autenticado;
- constraints de integridad en el registro privado.

Las dos funciones nuevas quedan sin `EXECUTE` para `PUBLIC`, `anon`,
`authenticated` y `service_role`. La auxiliar es invoker; la operación principal
es definer con `search_path=''`. No se creó ninguna función en `public`.

La futura Edge Function no llamará directamente a la función privada. 7A-3
deberá crear un único wrapper `public.submit_protected_suggestion(...)`, cerrado
por defecto; 7B podrá conceder `EXECUTE` solamente a `service_role`. Esto evita
depender de permisos implícitos en el cambio de grants anunciado por Supabase.

La lectura y moderación siguen perteneciendo a 5C y deben conservar el guard
administrativo AAL2. 5B v2 no abre ninguna lectura administrativa.

## Sonda corregida

`20261018171257_verify.sql` usa las firmas completas y comprueba:

- presencia exacta de las dos funciones;
- retorno `jsonb`;
- volatilidad;
- modo definer/invoker;
- `search_path`;
- permisos efectivos de los cuatro roles;
- centinela;
- tablas e índices esperados.

La prueba reprodujo el falso negativo del nombre sin argumentos y confirmó que
la nueva sonda identifica correctamente ambos objetos.

## Pruebas locales

Entorno: PGlite PostgreSQL 17.5, aislado, sin acceso a producción.

Archivo: `tests/stage-c-5b-v2-postgres17.test.mjs`.

Resultado: **16 aprobadas, 0 fallidas, 3 no ejecutadas**.

Aprobadas:

1. Firmas, retorno, volatilidad, seguridad, `search_path` y ACL.
2. Rechazo de acceso no autorizado.
3. Sugerencia autenticada con Unicode e identidad verificada.
4. Vacíos, longitudes, HTML y enlaces peligrosos.
5. Idempotencia y conflictos.
6. Deduplicación de contenido durante 24 horas.
7. Límite por usuario y persistencia del bloqueo.
8. Límite por invitado.
9. Límite agregado por red.
10. Expiración de bloqueo y renovación de ventana.
11. Aislamiento entre identidades.
12. Rollback atómico ante un fallo de inserción.
13. Guard administrativo AAL2.
14. Sonda con firmas completas.
15. Compatibilidad con el esquema existente.
16. Rollback total de fixtures sin residuos.

### Concurrencia real en PostgreSQL 17.11

Entorno: PostgreSQL 17.11 portátil, escuchando únicamente en localhost, sin
acceso a producción y con dos o más conexiones realmente independientes.

Archivo: `tests/stage-c-5b-v2-multisession-postgres17.test.mjs`.

Resultado: **7 aprobadas, 0 fallidas**.

1. Dos inicializaciones simultáneas del mismo contador: ambas aceptadas; contador final 2.
2. Diez incrementos concurrentes: contador final 10, sin pérdidas.
3. Dos solicitudes con un único cupo restante: una aceptada y una limitada; contador final 5.
4. Dos solicitudes simultáneas durante el bloqueo: ambas limitadas y `blocked_until` no se extendió.
5. Dos solicitudes con el mismo `request_id`: una sola sugerencia y un solo registro de idempotencia.
6. Dos fallos técnicos concurrentes: rollback completo, sin sugerencias, tokens ni contadores residuales.
7. Ninguna prueba superó `statement_timeout=8s` ni `lock_timeout=6s`; no hubo deadlocks.

La carrera del mismo `request_id` preservó exactamente una fila, pero la segunda
respuesta fue `accepted + duplicate` en lugar de `accepted + idempotent`. Además,
si el mismo actor repite el mismo contenido con otro `request_id` y reutiliza el
token, la deduplicación de contenido puede resolverse antes de comprobar el replay
del token. Esto no crea duplicados ni evade el límite para insertar contenido,
pero debilita la semántica de auditoría y defensa en profundidad.

Continúa pendiente la integración real de Turnstile y Edge Function; no pertenecía
al alcance autorizado de esta prueba.

### Concurrencia acumulada 4A–5A

Archivo: `tests/stage-c-4a-to-5a-multisession-postgres17.test.mjs`.

Resultado: **10 aprobadas, 0 fallidas**, incluyendo doble publicación, retiro de
recursos frente a publicación, idempotencia y cambios de estado de campañas,
eliminación frente a asociación de frases, publicación de contenido, FAQ duplicada,
restauración frente a edición y eliminación repetida frente a restauración. No hubo
deadlocks ni esperas indefinidas.

La regresión completa ejecutó directamente con Node los 11 archivos definidos
en `package.json`: todos finalizaron correctamente. Las comprobaciones generales
de Etapa C pasaron de 28 a 29 y aprobaron.

## Compatibilidad con componentes posteriores

| Componente | Estado con 5B v2 | Acción necesaria |
|---|---|---|
| 5C | Incompatible | Cambiar dependencia al centinela 171257 y ajustar limpieza a la retención v2. |
| 6 | Sin dependencia directa de la firma | Mantener bloqueado hasta corregir sus dependencias anteriores conocidas. |
| 7A-1 | Sin dependencia directa de 5B | Mantener bloqueado por cambios previos de 4A/5A. |
| 7A-2 | Sin dependencia directa de 5B | Mantener bloqueado por firmas previas de 4B/5A. |
| 7A-3 | Incompatible | Sustituir los dos wrappers antiguos por un wrapper único de v2. |
| 7B | Incompatible | Conceder solo el wrapper v2 a `service_role`; retirar grants antiguos. |
| Edge `submit-suggestion` | Incompatible | Resolver Auth antes de hashes, generar actor/red y ejecutar una sola RPC. |
| Frontend público | Compatible con ajustes de respuesta en Edge | Mantiene datos y Turnstile; la Edge traduce resultados v2. |
| Frontend administrativo | Depende de 5C | Sin cambio de contrato visible previsto. |
| Sonda general | Actualizada localmente | Verificar versión, centinela y firmas v2. |
| Rollback | Añadido | Contención no destructiva, sin borrar datos. |

La Edge Function actual todavía llama a `consume_suggestion_protection` y
`submit_public_suggestion` por separado. No fue modificada porque pertenece a
una etapa posterior. Antes del despliegue deberá:

1. verificar Turnstile (`success`, hostname, action, timestamp y uso único);
2. resolver el usuario real con Supabase Auth;
3. tomar la red exclusivamente de una cabecera confiable normalizada por la
   plataforma;
4. calcular hashes con dominios separados;
5. llamar una sola vez al wrapper v2;
6. mapear los estados a 200/201/409/429/503 sin exponer detalles internos.

## Archivos modificados o añadidos

- Nueva migración 5B v2.
- Nueva verificación 5B v2.
- Nuevo rollback seguro específico.
- Nueva prueba PostgreSQL 17.5.
- Migración, verificación y prueba de v1 archivadas.
- `stage_c_installation_status.sql` actualizado.
- `STAGE_C_SPLIT_DEPLOYMENT_PLAN.md` actualizado.
- Suite general y `package.json` actualizados para incluir v2.

No se modificaron 5C, 6, 7A-1, 7A-2, 7A-3, 7B, la Edge Function ni los
frontends.

## Riesgos pendientes y recomendación

Riesgos pendientes:

- La respuesta concurrente del mismo `request_id` no se identifica siempre como `idempotent`, aunque conserva exactamente una fila.
- La deduplicación de contenido puede adelantarse a la detección SQL de un token reutilizado en una solicitud nueva.
- Falta validar el origen real de `cf-connecting-ip` en la Edge desplegada.
- Falta implementar HMAC y la única RPC en la Edge Function.
- Falta preparar versiones compatibles de 5C, 7A-3 y 7B.
- Falta verificar Turnstile real y la traducción de resultados HTTP.

**Recomendación actualizada:** el preflight remoto de solo lectura y `dry-run`
aprobó mostrando únicamente 5B v2. Antes de autorizar su instalación real,
conviene preparar una v3 que revalide idempotencia y token bajo el mismo orden de
bloqueo, de modo que la semántica de replay sea inequívoca y auditable.

## Confirmación de alcance

Producción fue consultada únicamente en modo lectura. Se ejecutó Supabase CLI
2.121.0 con `db push --dry-run --include-all`; no se ejecutó `db push` real,
SQL Editor, `migration repair`, secretos, Edge Functions, frontend, Storage,
campañas ni cambios sobre datos comerciales.
