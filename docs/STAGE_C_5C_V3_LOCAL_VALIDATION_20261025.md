# Cúbica 3D — Etapa C — Validación local de 5C v3

Fecha: 2026-10-25  
Estado: **CANDIDATA LOCAL VALIDADA; NO INSTALADA**

## Identidad y alcance

- Migración: `20261024233029_stage_c_suggestion_admin_private_functions_v3.sql`.
- Nombre administrado previsto:
  `stage_c_20261024233029_suggestion_admin_private_functions_v3`.
- Centinela:
  `private.admin_update_suggestion(uuid,text,text,integer,text)` =
  `cubica_stage_c:20261024233029`.
- SHA-256: `FA8174E1D05F24A90F15684132EF12801786282900049508B43EBB8B18CA9B8D`.
- PostgreSQL aislado: PGlite PostgreSQL 17.5 y PostgreSQL 17.11 nativo.
- Producción de referencia declarada: PostgreSQL 17.11, 39 migraciones y 5C
  ausente. No se conectó ni se consultó producción durante este trabajo.

5C v2 se conservó intacta como evidencia histórica en
`supabase/archive/20261018171304_stage_c_suggestion_admin_private_functions_v2.replaced_by_5c_v3.sql`.
Su SHA-256 sigue siendo
`5E7B13ADFDC2B9587FA86BEB4959F03426D2639515A97CE0992C8BFCF68F1EAF`.

## Contrato funcional

### Revisión y concurrencia

Cada sugerencia tiene `revision integer not null default 1`. Las operaciones
de modificación bloquean la fila con `FOR UPDATE`, comparan
`p_expected_revision` y actualizan con la misma revisión en el `WHERE`. Una
modificación efectiva incrementa la revisión una vez. Una revisión obsoleta
devuelve `status=conflict`, `error=stale_revision` y el estado mínimo actual.

Un reintento con la revisión vigente y sin cambios devuelve
`status=unchanged`; no cambia `updated_at`, no incrementa `revision` y no crea
historial. Un reintento con revisión obsoleta devuelve conflicto aunque la
intención sea idéntica, para no ocultar una actualización concurrente.

### Máquina de estados

| Desde | Hacia permitido |
|---|---|
| `new` | `reviewing`, `accepted`, `dismissed` |
| `reviewing` | `accepted`, `resolved`, `dismissed` |
| `accepted` | `resolved`, `dismissed` |
| `resolved` | ninguno |
| `dismissed` | ninguno |

Permanecer en el mismo estado se admite para editar notas o detectar un no-op.
`resolved` y `dismissed` son terminales. No se creó reapertura implícita. Pasar
a `resolved` o `dismissed` exige motivo cuando el estado cambia.

### Auditoría

La tabla privada `private.suggestion_moderation_history` conserva sugerencia,
actor administrativo, hora, operación, estado anterior/nuevo, revisión
anterior/nueva, campos modificados y motivo. La modificación y el evento se
escriben en la misma transacción. Una restricción única impide dos eventos para
la misma revisión y un trigger rechaza `UPDATE`/`DELETE` ordinarios.

La tabla usa RLS y `FORCE RLS`, no concede acceso directo a roles de API y no
almacena contacto, Turnstile, hashes de red, tokens ni secretos. La retención
es indefinida hasta que exista una política de privacidad aprobada; no se
incluyó purga automática de historial.

### Ciclo de vida

`archive` y `unarchive` modifican solo `archived_at`. `soft_delete` y `restore`
modifican solo `deleted_at`. Cada cambio efectivo exige revisión vigente y
motivo, incrementa una vez la revisión y genera auditoría. Restaurar conserva
el estado de moderación y el archivo anteriores; no publica, reabre ni cambia
estado automáticamente. Las acciones repetidas son no-op.

### Privacidad y consultas

El listado devuelve únicamente id, categoría, asunto, estado, revisión,
marcas de archivo/eliminación, fechas operativas y conteo reciente de
duplicados. No incluye descripción, contacto, notas, actor, hashes ni tokens.

El detalle requiere el mismo guard administrativo AAL2 y un id concreto. Puede
devolver descripción, contacto y notas porque son necesarios para revisar la
sugerencia, más los últimos 100 eventos; nunca devuelve `user_id`,
`updated_by`, `request_id`, hashes o tokens. El frontend escapa todo texto antes
de insertarlo en HTML.

La paginación admite páginas `1..100000` y tamaños `10`, `25` o `50`; la
búsqueda tiene máximo 120 caracteres y escapa `\`, `%` y `_`. Estado,
categoría, orden y ciclo de vida usan listas blancas. Todos los órdenes
desempatan por id.

### Duplicados de 5B v3

5B v3 persiste reintentos aceptados con `was_duplicate=true` mientras su
ledger temporal siga retenido. 5C v3 expone un `recent_duplicate_count` sin
exponer hashes. No crea una segunda sugerencia ni presenta rechazos como
aceptaciones.

Limitación documentada: replay de token, rate limit, conflicto de idempotencia
y duplicados ya purgados no cuentan con un evento histórico permanente en 5B
v3. Obtener visibilidad completa exigiría una nueva migración compatible y
autorización independiente; 5C v3 no fabrica datos ni modifica 5B v3.

## Seguridad

- Todas las funciones nuevas tienen `search_path=''`.
- Las operaciones administrativas y de detalle son `SECURITY DEFINER` y
  llaman al guard central AAL2.
- Los auxiliares puros son `SECURITY INVOKER`.
- `EXECUTE` está revocado para `PUBLIC`, `anon`, `authenticated` y
  `service_role` en la migración cerrada.
- No se crean wrappers públicos ni permisos prematuros.
- La tabla de historial usa RLS, `FORCE RLS`, política denegatoria y ACL
  cerrada.
- La limpieza conserva sugerencias e historial y elimina solo protección
  temporal expirada.

El diseño sigue la recomendación de Supabase de no depender solo de RLS o UI
para funciones privilegiadas: valida identidad/AAL2 dentro de la función,
restringe `search_path` y revoca `EXECUTE` por defecto.

## Compatibilidad preparada

Se actualizaron localmente, sin instalarlos:

- bloque 6: dependencia del nuevo centinela y firma;
- 7A-1: dependencia de 5C v3;
- 7A-3: seis wrappers cerrados, incluyendo detalle y ciclo de vida;
- 7B: grants finales para las cuatro RPC administrativas v3;
- sonda general, verificador 5C v3 y contenciones no destructivas;
- frontend administrativo: detalle bajo demanda, revisión esperada, motivo,
  conflicto, filtros de ciclo de vida y renderizado escapado.

La Edge Function `submit-suggestion` y 5B v3 no fueron modificadas.

## Pruebas

### Reproducción de 5C v2

- 5 controles de seguridad aprobados.
- 8 defectos bloqueantes reproducidos.
- La carrera multisesión se ejecutó posteriormente sobre 5C v3 en PostgreSQL
  17.11 nativo; no se reutilizó 5C v2 como candidata.

### 5C v3 en PostgreSQL 17.5

- 30 pruebas aprobadas.
- 0 fallidas.
- La etiqueta interna `NOT_EXECUTED` queda limitada a este runner PGlite de una
  sola sesión; la cobertura multisesión se completó en PostgreSQL 17.11.

Se cubrieron los 30 escenarios solicitados: listado, detalle, AAL2/AAL1,
cliente no administrador, filtros, búsqueda, paginación, orden, transiciones,
revisión obsoleta, dos cambios sobre la misma revisión, no-op, historial,
archivo, eliminación, restauración, privacidad, compatibilidad 5B, duplicados,
limpieza, atomicidad, rollback, firmas, centinela, RLS y ACL.

### Regresiones locales

- 5B v3 + 5C v3 + wrappers futuros: 20 aprobadas, 0 fallidas. Las carreras
  multisesión pendientes de ese runner se cubrieron con el servidor nativo;
  los servicios externos permanecieron deliberadamente fuera de alcance.
- integración estática Etapa C y workers simulados: 31 aprobadas, 0 fallidas.
- sintaxis de `js/site-experience.js`: aprobada.
- batería completa: todos los archivos declarados en `pnpm test` ejecutados y
  aprobados.

### Concurrencia real

**EJECUTADA Y APROBADA.** Se inició un PostgreSQL 17.11 nativo, descartable y
limitado a `127.0.0.1:55434`, desde los binarios oficiales de EDB. El archivo
`postgresql-17.11-5-windows-x64-binaries.zip` coincidió con el SHA-256 oficial
`80379B2C04D51C30225532E0AE04509899141E9957ED096FE749D7FD9DF8F82F`.

El runner `tests/stage-c-5c-v3-multisession-postgres17.test.mjs` usa tres
conexiones persistentes e independientes (operación A, operación B y
observador), además de conexiones separadas de preparación/control. Para cada
carrera, una sesión mantiene el bloqueo de fila, la otra inicia la operación
competidora y el observador exige ver una espera real con
`pg_stat_activity.wait_event_type='Lock'` antes de liberar la primera. Por lo
tanto, las operaciones no fueron simuladas ni ejecutadas secuencialmente.

Resultado: 11/11 grupos aprobados, 0 fallidos:

- A — editar/editar: 6 carreras;
- B — revisión obsoleta: 3 comprobaciones;
- C — archivar/editar: 6 carreras;
- D — eliminar/restaurar: 6 carreras;
- E — no-op y no-op obsoleto: 6 carreras;
- F — fallo forzado del historial y atomicidad: 3 comprobaciones;
- G — roles de API y protección directa: 3 comprobaciones;
- identidad local, entorno PostgreSQL real, validaciones complementarias y
  ausencia de deadlocks: aprobadas.

En todas las carreras progresó una sola operación efectiva; la competidora
recibió el conflicto esperado o respetó el estado terminal. No hubo pérdida de
actualizaciones, dobles revisiones, historial huérfano ni deadlocks. Los fallos
forzados de historial revirtieron también la modificación principal.

La tabla de historial mantuvo `RLS` y `FORCE RLS`. Las funciones legítimas
`SECURITY DEFINER`, propiedad del rol privilegiado del entorno aislado,
pudieron escribir el historial de forma transaccional; `PUBLIC`, `anon`,
`authenticated` y `service_role` no obtuvieron acceso directo. Todas las
funciones verificadas conservaron `search_path=''`; los wrappers futuros siguen
cerrados hasta 7B.

El runner tiene SHA-256
`8E69A1B5DF9B7BEDFF45FEF475CE6E7C8A20B7F511830CAA49FA7354CF887E7C`
y una entrada reproducible `pnpm run test:5c-multisession`. Requiere que el
operador proporcione una URL de un PostgreSQL aislado; no contiene
credenciales ni destinos de producción.

## Recuperación

- Verificador 5C v3:
  `supabase/verification/20261024233029_verify.sql`, SHA-256
  `F2D784BAF66C2A4AD503FA6FC4A83D241D80E89B5154AB490384EA80C3BAFA68`.
- Contención 5C v3:
  `supabase/rollback/20261024233029_stage_c_suggestion_admin_private_functions_v3_safe_state.sql`,
  SHA-256
  `CEAAA57A0CA42E2A0D5E39DF1458F30123F8DD5828BEB188C6AE0DB8688C4D6B`.

La contención no borra sugerencias, revisiones ni historial. Revoca funciones,
mantiene RLS/`FORCE RLS` y preserva evidencia. No existe rollback destructivo
automático.

## Riesgos residuales y recomendación

1. El conteo de duplicados es temporal y depende de la retención de 5B v3.
2. El historial conserva `actor_id`; una futura política de retención/privacidad
   debe decidir cuándo anonimizarlo sin destruir trazabilidad obligatoria.
3. Un futuro preflight debe reconfirmar producción, hashes, orden y ausencia de
   5C v2/v3; este trabajo no lo hizo.

Recomendación: la candidata queda técnicamente apta para un preflight remoto
independientemente autorizado. No avanzar si el SHA-256 cambia, si producción
no coincide con las dependencias declaradas o si el dry-run incluye otra
migración.

## Confirmación de límites

No hubo conexión a producción, `db push`, SQL Editor, `migration repair`,
secretos, despliegue de Edge Functions, publicación de frontend, creación de
sugerencias reales, cambios comerciales, limpieza de System32 ni inicio de la
Etapa D. El servidor PostgreSQL 17.11, la base ficticia, sus logs y los
binarios descargados fueron temporales y se eliminaron al terminar.
