# Cúbica 3D — 5B v3: validación local y auditoría de System32

Fecha: 24 de octubre de 2026.

## Alcance y resultado

Se preparó y validó 5B v3 exclusivamente en entornos locales. No hubo conexión
a Supabase de producción, `db push`, SQL Editor, `migration repair`, despliegue
de Edge Functions, cambios de secretos, publicación de frontend ni eliminación
en `System32`.

Resultado: **candidato local aprobado**. Requiere un preflight remoto separado y
una autorización posterior para producción.

## Artefactos

| Artefacto | SHA-256 |
|---|---|
| `supabase/migrations/20261018171258_stage_c_suggestion_protection_private_functions_v3.sql` | `772DDB1E8835316F83A694457BBBF6DDE1AB8871AAAC174A8C368C24F06189BE` |
| `supabase/verification/20261018171258_verify.sql` | `7903F38F288C122167DDA4FD1A01AE2DE91E4E951D1BECB030261F82CBB89436` |
| `supabase/rollback/20261018171258_stage_c_suggestion_protection_private_functions_v3_safe_state.sql` | `2B13AD4F44AD999A5A402D25B08DB6CF8302E397F2035338B299AE60D8696D63` |
| `tests/stage-c-5b-v3-postgres17.test.mjs` | `D972501B307BBD0C5A252B8790950DB50EF838ED9838ADFB7F5935C7941503FF` |
| `tests/stage-c-5b-v3-multisession-postgres17.test.mjs` | `2F858E82CEB95060B1B80E205F05721C3FB5525FEAC68125AFEF89E3F89B3168` |

5B v2 se archivó fuera de `supabase/migrations` sin modificarlo:

- archivo: `supabase/archive/20261018171257_stage_c_suggestion_protection_private_functions_v2.replaced_by_v3.sql`;
- SHA-256 histórico: `A90B2433C4CB0BB6CAA33BF269A650314FB62D95ABF62BDD65257168D0AA3129`;
- también se archivaron su verificador y su contención.

## Corrección técnica

5B v3 serializa primero por `request_id`. Una segunda sesión espera la
confirmación o el rollback de la primera y relee el ledger. Solo devuelve el
resultado original cuando actor, red y carga normalizada coinciden. Cualquier
diferencia devuelve `idempotency_conflict`.

Un request nuevo reclama el hash de token antes de consultar contenido
duplicado. Esto impide que la deduplicación oculte un replay. Luego se serializa
por actor y hash de carga, se deduplica, se aplican los límites y se inserta la
sugerencia dentro de la misma transacción.

La columna `was_duplicate` conserva la semántica del resultado original. Un
reintento de un request previamente deduplicado vuelve como `idempotent=true` y
`duplicate=true`; un reintento del request que creó la sugerencia vuelve como
`idempotent=true` y `duplicate=false`.

Se conservaron:

- usuario autenticado: 5 intentos por hora;
- invitado: 3 intentos por hora;
- red: 20 intentos agregados por hora;
- bloqueo fijo de una hora;
- deduplicación por actor y contenido durante 24 horas;
- RLS, funciones privadas cerradas, `SECURITY DEFINER` con `search_path=''` y
  ausencia de wrappers públicos;
- rollback completo ante errores técnicos.

## Pruebas

### PGlite PostgreSQL 17.5

16 aprobadas, 0 fallidas. Cubrieron firmas, tipos, ACL, `search_path`, entradas
inválidas, idempotencia secuencial, conflictos, deduplicación, replay, límites,
bloqueo persistente, aislamiento, AAL2, fallo técnico y rollback.

### PostgreSQL 17.11 aislado

11/11 pruebas multisesión aprobadas con dos conexiones reales:

1. inicialización simultánea del mismo contador;
2. incrementos concurrentes sin pérdida;
3. dos solicitudes con un único cupo;
4. bloqueo simultáneo y persistente;
5. dos reintentos simultáneos con el mismo `request_id`;
6. misma clave con contenido diferente;
7. misma clave con identidad diferente;
8. contenido duplicado con requests y tokens distintos;
9. token compartido por requests concurrentes;
10. rollback atómico ante error durante el guardado;
11. ausencia de deadlocks bajo tiempos límite acotados.

### Regresión Etapa C y Turnstile simulado

31/31 comprobaciones aprobadas. Las pruebas simuladas verificaron token
inválido, `timeout-or-duplicate`, desafío vencido, hostname, action y fallo de
red. En todos esos casos se detuvo el flujo antes de tocar Supabase.

Estas fueron simulaciones locales con respuestas controladas. No se probó la
integración real contra Cloudflare.

## Contrato entre Turnstile, Edge y PostgreSQL

Cloudflare exige validar cada token mediante Siteverify; los tokens vencen a los
cinco minutos, son de un solo uso y una repetición o vencimiento devuelve
`timeout-or-duplicate`. Siteverify también permite un `idempotency_key` UUID para
reintentos seguros. Referencia oficial:
<https://developers.cloudflare.com/turnstile/get-started/server-side-validation/>.

La futura Edge Function debe:

1. validar tamaño, formato y origen;
2. resolver el JWT antes de derivar el actor;
3. llamar Siteverify y validar `success`, `hostname`, `action` y
   `challenge_ts`;
4. reutilizar el mismo `idempotency_key` al reintentar una verificación que
   falló por red;
5. derivar hashes separados de token, actor y red con el secreto del backend;
6. llamar una sola vez al nuevo RPC atómico;
7. mapear `accepted`, `idempotency_conflict`, `token_replayed` y
   `rate_limited` sin exponer hashes, tokens ni secretos.

El `request_id` del navegador sirve para correlación e idempotencia, pero no es
prueba de identidad. PostgreSQL no puede confirmar por sí solo autenticidad,
hostname, action o expiración de Turnstile porque recibe solamente un hash; esas
garantías pertenecen a Siteverify y a la Edge Function. PostgreSQL sí garantiza
replay local, idempotencia, deduplicación, límites y persistencia atómica.

Riesgo residual: la Edge Function actual todavía usa dos RPC antiguos y debe
actualizarse antes de activar 5B v3. No se modificó por estar fuera del alcance.

## Compatibilidad posterior

- **5C:** debe cambiar su prerrequisito al centinela
  `cubica_stage_c:20261018171258`. La limpieza puede conservar su firma, pero
  debe verificarse contra la nueva columna `was_duplicate`.
- **6:** no consume directamente la firma de sugerencias; debe volver a probarse
  cuando 5C quede coordinado.
- **7A-3:** debe reemplazar los wrappers antiguos
  `consume_suggestion_protection` + `submit_public_suggestion` por un único
  wrapper cerrado de `submit_protected_suggestion(...) returns jsonb`.
- **7B:** debe conceder `EXECUTE` a `service_role` solo sobre ese wrapper nuevo;
  `anon` y `authenticated` deben continuar sin ejecución directa.
- **Frontend:** puede conservar el `request_id`, pero debe interpretar respuestas
  diferenciadas y no asumir que ese UUID autentica al usuario.
- **Edge `submit-suggestion`:** debe resolver identidad, verificar Turnstile y
  llamar el RPC atómico en el orden documentado.

## Auditoría de `C:\Windows\System32\supabase`

La inspección fue exclusivamente de lectura.

- Es un directorio ordinario, sin `LinkType`, `Target` ni reparse points.
- Creación UTC: 24 de octubre de 2026 03:11:22.
- Contiene 2 directorios, 39 archivos y 384.464 bytes.
- Hay 38 migraciones SQL y `.temp\cli-latest`.
- Cada una de las 39 rutas relativas existe en el directorio aislado del
  preflight.
- Longitud y SHA-256 coinciden en 39/39; no hay faltantes ni diferencias.
- `.temp\cli-latest`: 8 bytes, SHA-256
  `E259CEEF24C76934BC3C6884C465E636C7F058E1B275E46DE8D1E51A5DC8C4C4`.

La evidencia permite atribuir el directorio a la descarga accidental del
preflight, no a Windows. Aun así, no se eliminó nada.

El script auditado tiene SHA-256
`D35B7B4DFB24B062E2814CC9B1C5DBE874C573CF113D8C5EF433D94D032A1109`.
Usa una ruta literal, exige exactamente `.temp` y `migrations`, rechaza
subdirectorios inesperados en `migrations` y detiene ante errores. No modifica
permisos ni usa comodines.

No se recomienda ejecutar ese script sin endurecerlo: su validación final solo
comprueba nombres, conteos y extensiones, y después usa borrado recursivo. El
procedimiento mínimo recomendado para una autorización futura es:

1. volver a comprobar que la ruta resuelta es exactamente
   `C:\Windows\System32\supabase` y que no hay reparse points;
2. construir un manifiesto de las 39 rutas, longitudes y SHA-256 a partir del
   directorio aislado confirmado;
3. exigir coincidencia exacta y ausencia de archivos adicionales;
4. eliminar cada archivo por su ruta literal, sin comodines;
5. retirar solamente los tres directorios ya vacíos;
6. detenerse ante cualquier diferencia, archivo abierto o cambio de fecha/hash.

No debe usarse cambio de permisos, toma de propiedad ni borrado recursivo de una
ruta calculada.

## Pendientes

- preparar versiones coordinadas de 5C, 7A-3 y 7B;
- actualizar y volver a probar la Edge Function y el frontend;
- ejecutar un preflight remoto independiente de 5B v3;
- probar Siteverify real solo con autorización posterior;
- preparar, revisar y autorizar por separado una limpieza endurecida de la copia
  accidental.

