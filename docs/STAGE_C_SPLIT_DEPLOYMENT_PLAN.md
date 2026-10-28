# Etapa C — Plan operativo de despliegue subdividido

Este documento describe únicamente el procedimiento para una futura instalación
en producción. No autoriza su ejecución.

Los bloques 3B-1 v3 y 3B-2 v2 quedaron instalados y verificados en producción
el 2026-10-20 con las versiones `20261018171218` y `20261018171223`. Sus
informes están en `docs/STAGE_C_3B1_V3_PRODUCTION_20261020.md` y
`docs/STAGE_C_3B2_V2_PRODUCTION_20261020.md`. La versión inválida
`20261018171221` y la versión previa a la regla de año bisiesto
`20261018171219` permanecen archivadas y nunca fueron registradas en
producción.

El diagnóstico vigente está en
`docs/STAGE_C_3B1_TECHNICAL_DIAGNOSTIC_20261019.md`. Detectó además un desajuste
de forma entre el `record` de 27 campos devuelto por la consulta y el tipo
`private.site_campaigns` de 26 campos declarado por la función. La nueva versión
mantiene `effective_start` separado y devuelve explícitamente las 26 columnas.
La misma validación corrigió referencias ambiguas en 3B-2. Las versiones finales
3B-1 v3 y 3B-2 v2 omiten de forma segura una ocurrencia anual basada en el 29 de
febrero cuando ese día no existe y buscan el próximo año bisiesto válido.

## Punto de partida obligatorio — actualizado 2026-10-25 después de 6 v3

Antes de cualquier escritura, la sonda debe confirmar:

- historial remoto de 41 migraciones (debe reconfirmarse en el futuro preflight);
- bloque 1 confirmado como `20261018213838`;
- bloque 2 confirmado como `20261018213927`;
- bloque 3A confirmado como `20261019015434`;
- bloques 3B-1 v3, 3B-2 v2, 3C-1, 3C-2, 4A v2, 4B v2, 4C v2,
  5A v2, 5B v3, 5C v3 y 6 v3 confirmados con sus versiones locales finales;
- 5B v1, 5B v2 y 5C v2 ausentes; 5C v3 confirmada como
  `20261024233029` exactamente una vez;
- 13 tablas de Etapa C con RLS; la tabla nueva
  `private.suggestion_moderation_history` también conserva FORCE RLS;
- cero permisos directos inesperados;
- bucket `site-assets` privado y sin políticas de Etapa C;
- ausencia de sesiones de migración anteriores todavía activas.

También deben verificarse nuevamente los hashes de todos los archivos.

## Preflight Supabase CLI confirmado — 2026-10-20

- CLI fijado: `2.121.0`.
- Directorio: temporal y separado del repositorio canónico.
- Conexión: Session Pooler IPv4 de `sa-east-1`, puerto 5432, con contraseña
  ingresada de forma oculta y transmitida solo mediante `PGPASSWORD` temporal.
- TLS: `PGSSLMODE=require`; no se utilizó `--debug`.
- `migration fetch`: recuperó exactamente las 30 migraciones del historial
  remoto.
- `migration list`: las 30 versiones locales recuperadas coincidieron con las
  30 remotas. Bloques de Etapa C confirmados: `20261018213838`,
  `20261018213927` y `20261019015434`.
- 3B-1 v3 fue el único archivo añadido después de conciliar el historial. Su
  hash volvió a resultar
  `D8A1556A05387F6ACF674D3E3BBCFC1B313D9F5E044E64CC8059EBB6DF64184B`.

Resultado literal sanitizado:

```text
DRY RUN: migrations will *not* be pushed to the database.
Connecting to remote database...
Would push these migrations:
 • 20261018171218_stage_c_active_campaign_private_function_v3.sql
{"upToDate":false,"dryRun":true,"migrations":["20261018171218_stage_c_active_campaign_private_function_v3.sql"],"seeds":[],"roles":[],"message":"Finished supabase db push."}
```

El preflight no ejecutó SQL de migración, no modificó el historial remoto y no
usó `migration repair`. Una autorización posterior permitió aplicar únicamente
3B-1 v3. El historial remoto contiene ahora 31 migraciones y el resto de los
bloques de este plan continúa pendiente.

## Orden de aplicación

Los pasos 1 a 11 están confirmados. Los pasos 12 a 15 son candidatos locales,
requieren preflight y autorizaciones nuevas, y deben mantener el orden siguiente.

| Paso | Bloque | Nombre administrado | SHA-256 |
|---:|---|---|---|
| 1 | 3B-1 v3 | `stage_c_20261018171218_active_campaign_private_function_v3` | `D8A1556A05387F6ACF674D3E3BBCFC1B313D9F5E044E64CC8059EBB6DF64184B` |
| 2 | 3B-2 v2 | `stage_c_20261018171223_next_change_private_function_v2` | `175A658DE73E7650EDA8084F1374F0C0A323728C94F922ACB30173D7862786C7` |
| 3 | 3C-1 | `stage_c_20261018171231_site_experience_private_function` | `3980FA2AE7A570559B2ACD2A3AEF0CD5B4FD2F9BF53DACE311B5A90D0D1FA29A` |
| 4 | 3C-2 | `stage_c_20261018171232_admin_configuration_private_function` | `E2DC0ED8BC58A90028A11E55794A7D01AB01023659CD01F8CEFF19DC16E6F3DA` |
| 5 | 4A v2 | `stage_c_20261018171249_appearance_asset_admin_private_functions_v2` | `5B212BC9F45B3A0BEFF5E9D0B14AD413CB4EF85A2472DAE33829639253F454E3` |
| 6 | 4B v2 | `stage_c_20261018171254_campaign_admin_private_functions_v2` | `3330F8118C5539548AFC0A6804D4BD1AEDD799F70E68CD4FBCDB3790E62DC429` |
| 7 | 4C v2 | `stage_c_20261018171255_phrase_admin_private_function_v2` | `9A2A9FE644416662B0788ACF6F8EF3E1FAD00B09D44D1EAF19851B29F73D2E43` |
| 8 | 5A v2 | `stage_c_20261018171256_content_faq_private_functions_v2` | `17BEF84D211B74F54A9354E0EB7F4887F065F751A3E7E0FE494905BC3772CB66` |
| 9 | 5B v3 | `stage_c_20261018171258_suggestion_protection_private_functions_v3` | `772DDB1E8835316F83A694457BBBF6DDE1AB8871AAAC174A8C368C24F06189BE` |
| 10 | 5C v3 | `stage_c_20261024233029_suggestion_admin_private_functions_v3` | `FA8174E1D05F24A90F15684132EF12801786282900049508B43EBB8B18CA9B8D` |
| 11 | 6 v3 | `stage_c_20261018171402_safe_defaults_v3` | `BEE9CBA3CA6366813E327DF00B4C89432DBAAE9A6D02F33F856C855747918824` |
| 12 | 7A-1 v3 | `stage_c_20261025120000_public_appearance_wrappers_closed_v3` | `0234A0D9CDFE82DBFE9EE13BF457A6143DFF3B8EC3B7319AB0C43162F1B3BA39` |
| 13 | 7A-2 v3 | `stage_c_20261025120100_campaign_content_wrappers_closed_v3` | `9862DF29ED22BF85C25ACE52E69A727BDD8FD2C0E056A626466B5928AC0A1659` |
| 14 | 7A-3 v3 | `stage_c_20261025120200_suggestion_wrappers_closed_v3` | `C9499874A7F84F8D2111CC9B05D8951D9387C0F3DD9B4CBB4BE329CC03001B1D` |
| 15 | 7B v3 | `stage_c_20261025120300_api_storage_activation_v3` | `AD3FE8FDE86F4C3E5B28F9CD3C1220DC2FBB1295811E3D80584F6EE4F57C1AD8` |

No cambiar el orden. No reutilizar los nombres de los bloques archivados.

### Sustitución de 6 — 2026-10-25

El candidato 6 v2 fue rechazado antes de conectarse a producción y quedó
archivado, intacto, como
`supabase/archive/20261018171401_stage_c_safe_defaults_v2.rejected.sql`, con
SHA-256 `7359EAF312C72F12A84C1FB607E4FFE1021B3C1C660A94D7900FBA3F43A8E813`.

6 v3 usa la versión local libre `20261018171402`. Comprueba las firmas y
centinelas definitivos de 4A v2, 4B v2, 4C v2, 5A v2, 5B v3 y 5C v3; inserta
solo páginas ausentes; conserva etiquetas y contenido existente; crea un
borrador visual únicamente cuando no existe ninguna apariencia; y agrega las
doce frases sugeridas como `active=false`. La detección de frases abarca
también filas con soft-delete para no restaurarlas ni recrearlas.

La validación local PostgreSQL 17.5 aprobó 27/27 escenarios. El bloque no crea
wrappers, grants, políticas, campañas, FAQ ni publicaciones. La recuperación
`supabase/rollback/20261018171402_stage_c_safe_defaults_v3_safe_state.sql` es
una contención no destructiva: invalida el centinela, reafirma RLS/ACL y no
borra semillas que pudieran haber sido editadas legítimamente.

**Bloqueador resuelto localmente:** 7A-1 v3 exige ahora el centinela
`cubica_stage_c:20261018171402`. Como los centinelas de los cuatro bloques son
encadenados, se versionaron coordinadamente 7A-2, 7A-3 y 7B. Las versiones v2
se archivaron intactas y no deben incorporarse a un futuro directorio de
despliegue.

### Auditoría conjunta de 7A/7B — 2026-10-25

La cadena final contiene 27 wrappers: tres lectores públicos y 24 rutas
administrativas o internas. 7A-1/2/3 los crea con `EXECUTE` revocado para
`PUBLIC`, `anon`, `authenticated` y `service_role`; 7B concede después solo la
matriz explícita y verifica los 24 contratos antes de confirmar la migración.

Hallazgos corregidos localmente:

1. 7A-1 v2 dependía del centinela reemplazado de 6 v2.
2. Su precondición de FAQ comprobaba una función que no porta el centinela del
   bloque 5A; v3 comprueba `private.admin_restore_faq(bigint,integer)`.
3. La política pública de Storage de 7B v2 consultaba directamente
   `private.site_assets`, aunque esa tabla no concede lectura a roles de API.
   7B v3 usa `private.stage_c_public_asset_allowed(text)`, un helper booleano
   `SECURITY DEFINER`, con `search_path=''`, que no expone filas ni metadatos.
4. 7B v3 incorpora una atestación exhaustiva de los 22 wrappers
   administrativos y sus 22 destinos privados, las tres lecturas públicas,
   las dos rutas exclusivas de `service_role`, las 13 tablas con RLS y las dos
   políticas de Storage.

La validación aislada en PostgreSQL 17.5 aprobó la creación cerrada, activación,
AAL1/AAL2, visitante, cliente, administración, lectura pública sin borradores,
Storage público/privado, sugerencias internas y ausencia de grants directos.
No se conectó a producción. No fue necesaria una prueba multisesión: estos
bloques crean funciones y cambian ACL/políticas en una única transacción, sin
operaciones de negocio concurrentes.

Bloqueos previos a un futuro preflight o despliegue:

- verificar localmente los hashes de esta tabla inmediatamente antes de copiar;
- reconciliar las 41 migraciones remotas y exigir que el dry-run muestre solo
  el bloque autorizado en cada paso;
- configurar `SUGGESTION_RATE_LIMIT_SALT` y confirmar `TURNSTILE_SECRET_KEY`
  antes de desplegar la Edge Function o activar el formulario;
- definir y habilitar por separado el job de retención que invoque
  `cleanup_suggestion_protection()`; 7B solo concede la ruta a `service_role`;
- completar Siteverify real, despliegue de Edge Functions y frontend mediante
  autorizaciones independientes;
- revisar la política comercial de conservación de contactos y notas privadas
  de sugerencias. Los hashes de actor/red se guardan solo en las tablas de
  protección y no se exponen por RPC pública.

### Sustitución de 5C — 2026-10-25

El candidato 5C v2 fue auditado, no se aplicó y quedó archivado sin cambios con
SHA-256 `5E7B13ADFDC2B9587FA86BEB4959F03426D2639515A97CE0992C8BFCF68F1EAF`.
5C v3 usa la versión local única `20261024233029` y depende de 3A y 5B v3.

5C v3 añade revisión optimista, máquina de estados, historial privado e
inmutable para roles operativos, archivo, eliminación lógica, restauración y
separación entre listado mínimo y detalle autorizado. Las funciones privadas
permanecen cerradas hasta 7B. Los consumidores futuros 6, 7A-1, 7A-3 y 7B fueron
adaptados localmente; sus hashes cambiaron y no deben confundirse con versiones
anteriores del plan.

Antes de cualquier preflight remoto se debe exigir que 5C v2 y v3 estén
ausentes, volver a conciliar el historial y copiar únicamente 5C v3. La prueba
local multisesión real quedó **APROBADA** el 2026-10-25 en PostgreSQL 17.11:
11/11 grupos aprobados, tres conexiones independientes, 33 carreras o
comprobaciones repetidas y solapamiento demostrado por
`pg_stat_activity.wait_event_type='Lock'`. No hubo deadlocks ni pérdida de
actualizaciones. PGlite 17.5 conserva la cobertura complementaria de 30/30
escenarios funcionales.

El preflight remoto exclusivo de 5C v3 quedó **APROBADO** el 2026-10-25 con
Supabase CLI 2.121.0, Session Pooler IPv4 y TLS `verify-full`. Se conciliaron
39 migraciones remotas y `db push --dry-run --include-all` mostró únicamente
`20261024233029_stage_c_suggestion_admin_private_functions_v3.sql`. El
historial remoto permaneció en 39 y no hubo escrituras durante el preflight.
Una autorización posterior permitió instalar exclusivamente 5C v3. La
instalación quedó **APROBADA** como `PRODUCTION_RESULT=APPLIED_ONCE_5C_V3`:
historial remoto en 40, centinela correcto, 13 tablas protegidas, pruebas
transaccionales con `ROLLBACK`, cero residuos QA y sin wrappers públicos. El
informe está en
`outputs/STAGE_C_5C_V3_PRODUCTION_DEPLOYMENT_20261025.md`. El siguiente bloque
continúa pendiente de una nueva autorización expresa.

### Sustitución de 5B — 2026-10-24

Los candidatos `20261018171302` y `20261018171257` quedaron archivados sin
aplicarse. El SHA-256 histórico de 5B v2 se conserva como
`A90B2433C4CB0BB6CAA33BF269A650314FB62D95ABF62BDD65257168D0AA3129`.
Ninguno debe copiarse a un directorio de despliegue.

5B v3 usa la versión local libre `20261018171258`, posterior a 5A v2 y
anterior a 5C. Conserva la firma privada
`private.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)`
y el auxiliar
`private.stage_c_apply_suggestion_limit(text,text,integer,timestamptz)`.

El orden transaccional de v3 es obligatorio:

1. validar y normalizar la entrada;
2. serializar por `request_id` y releer el resultado previo;
3. devolver idempotencia solo si actor, red y carga coinciden exactamente;
4. reclamar el hash del token antes de deduplicar contenido;
5. serializar por actor y carga normalizada;
6. deduplicar dentro de 24 horas;
7. aplicar límites atómicos de actor y red;
8. insertar la sugerencia y confirmar el ledger en la misma transacción.

El contrato conserva 5 intentos por hora para usuarios, 3 para invitados, 20
por red, bloqueo fijo de una hora y deduplicación durante 24 horas. Añade
`was_duplicate` al ledger para que un reintento pueda reproducir el resultado
original. Un `request_id` reutilizado con datos distintos devuelve
`idempotency_conflict`; un token reclamado por otro request devuelve
`token_replayed`. Los errores técnicos lanzan excepción y revierten token,
contadores y sugerencia.

Validación local final:

- PGlite PostgreSQL 17.5: 16 aprobadas, 0 fallidas;
- PostgreSQL 17.11 aislado, dos conexiones: 11/11 carreras aprobadas;
- regresión Etapa C y Turnstile simulado: 31/31 aprobadas;
- ninguna prueba real contra Cloudflare y ninguna conexión a producción.

Antes de un futuro preflight remoto de 5B v3:

1. volver a conciliar el historial remoto; no asumir que continúa en 38;
2. copiar solo `20261018171258...v3` al directorio aislado;
3. exigir SHA-256
   `772DDB1E8835316F83A694457BBBF6DDE1AB8871AAAC174A8C368C24F06189BE`;
4. confirmar ausentes `20261018171302`, `20261018171257` y `20261018171258`;
5. exigir que el dry-run muestre exclusivamente 5B v3;
6. ejecutar luego `supabase/verification/20261018171258_verify.sql` y la sonda
   general actualizada.

### Compatibilidad posterior a 5B v3 — 2026-10-24 (histórico, reemplazado por 7A/7B v3)

Se prepararon versiones coordinadas, todavía exclusivamente locales:

- 5C v2 exige el centinela de 5B v3 y limpia tokens por `expires_at < now()` y
  límites por `updated_at`, sin alterar la administración AAL2;
- 6 v3 referencia los centinelas definitivos de 4A v2, 4B v2, 4C v2, 5A v2,
  5B v3 y 5C v3, sin publicar datos;
- 7A-1 v2 y 7A-2 v2 conservan las firmas definitivas de 4A/4B/4C/5A,
  incluyendo control optimista, claves idempotentes y los dos wrappers FAQ;
- 7A-3 v2 sustituye los dos wrappers antiguos por un único wrapper atómico
  `public.submit_protected_suggestion(...)`, más tres wrappers administrativos;
- 7B v2 concede ese wrapper únicamente a `service_role`; `anon` y
  `authenticated` no pueden invocarlo y las firmas antiguas deben estar ausentes;
- la Edge Function resuelve primero la sesión, valida origen de red, usa
  Siteverify y llama una sola vez al RPC atómico. El navegador conserva
  `request_id` en reintentos fallidos y lo rota tras éxito o cambio de formulario.

Las versiones futuras reemplazadas `171303`, `171400`, `171511`, `171512`,
`171513` y `171514` quedaron archivadas y no deben incorporarse a un directorio de despliegue.
La activación continúa bloqueada hasta preflight y autorización independientes.

### Sustitución de 5A — 2026-10-22

El candidato `20261018171301_stage_c_content_faq_private_functions.sql` quedó
archivado sin modificar con SHA-256
`5351734526A909BACDE0A822258B811365C680B2D046AB11E9B40EBD08D99F50`.
No debe incluirse en directorios de despliegue.

5A v2 usa la versión local libre `20261018171256`, posterior a 4C v2 y anterior
a 5B. Añade idempotencia por revisión fuente para publicaciones, unicidad de FAQ
no eliminadas y contratos privados para listar/restaurar FAQ. Su preflight futuro
debe contener las 37 migraciones remotas actuales y solamente 5A v2 como
pendiente.

Nota histórica ya superada por la compatibilidad del 24 de octubre: antes de
instalar los bloques 6, 7A-1, 7A-2 o 7B debían prepararse versiones
coordinadas: 6 y 7A-1 aún exigen el centinela reemplazado de 5A v1; 7A-2 no crea
wrappers para `admin_list_faq(boolean)` ni `admin_restore_faq(bigint,integer)`;
7B tampoco concede sus permisos explícitos. Esos archivos no fueron modificados
durante la corrección local de 5A v2. Las versiones v2 vigentes enumeradas en
la tabla de orden ya resuelven esos puntos.

### Sustitución de 4A — 2026-10-21

La candidata `20261018171251` quedó archivada sin haberse aplicado. La candidata
vigente es `20261018171249_stage_c_appearance_asset_admin_private_functions_v2.sql`.
Su versión se ubica deliberadamente después de 3C-2 (`20261018171232`) y antes
de 4B (`20261018171252`). Añade idempotencia de publicación, control optimista
para guardar/restablecer/recuperar borradores, validación contra
`storage.objects` y referencias JSONB estructuradas.

Antes de cualquier preflight nuevo de 4A deben cumplirse además estas condiciones:

1. El directorio aislado contiene las 34 migraciones remotas confirmadas y solo
   `20261018171249...v2` como pendiente.
2. El hash es exactamente
   `5B212BC9F45B3A0BEFF5E9D0B14AD413CB4EF85A2472DAE33829639253F454E3`.
3. La versión antigua `20261018171251` no aparece en `supabase/migrations` ni
   en el plan del dry-run.
4. El dry-run muestra exclusivamente 4A v2.
5. Después de una eventual instalación se ejecutan
   `supabase/verification/20261018171249_verify.sql` y la sonda general.

La migración cambia las firmas privadas de restablecimiento y recuperación a
`(integer)`. Nota histórica ya resuelta: antes de instalar 7A-1/7B y publicar
el frontend debían prepararse y
aprobarse de forma coordinada sus wrappers, permisos, rollback y llamadas de UI.
Esos cambios dependientes no forman parte de la corrección local autorizada de
4A, pero sí quedaron incorporados en 7A-1 v2, 7B v2 y el frontend vigente de
esta preparación local.

### Sustitución de 4B — 2026-10-21

El bloque original `20261018171252` quedó archivado sin haberse aplicado. La
candidata vigente es
`20261018171254_stage_c_campaign_admin_private_functions_v2.sql`, con SHA-256
`3330F8118C5539548AFC0A6804D4BD1AEDD799F70E68CD4FBCDB3790E62DC429`.

4B v2 crea la tabla privada `private.site_campaign_idempotency`, protegida por
RLS y sin permisos de Data API. Las claves quedan separadas por administrador,
operación y UUID de solicitud. La reserva, la mutación y el resultado se
confirman en una sola transacción. También añade revisión esperada y locks a la
duplicación, y vuelve idempotentes las transiciones de estado.

El archivo 4C original (`20261018171253`) quedó archivado sin haberse aplicado.
Su SHA-256 histórico es
`A9650C07D4927C5D55457A86C1CF30851B1CBBD78B187069507EF9353B4B8768`.
Su verificación anterior también quedó archivada para evitar usar el centinela
reemplazado durante un despliegue futuro.
La candidata vigente es
`20261018171255_stage_c_phrase_admin_private_function_v2.sql`, posterior a 4B
v2, con locks en orden campaña → frase y rechazo explícito de campañas
inexistentes o retiradas.

Nota histórica ya superada: los bloques anteriores 6, 7A-1, 7A-2 y 7B
conservaban firmas y centinelas de 4B v1. No debían
instalarse hasta preparar versiones coordinadas que incluyan `p_request_id` y
`p_expected_version` donde corresponda. El frontend debe mantener un UUID de
solicitud estable durante cada intento de crear, duplicar o cambiar estado. Las
versiones v2 vigentes y el frontend preparado ya aplican ese contrato.

Antes de un preflight de 4B v2:

1. conciliar las 35 migraciones remotas confirmadas;
2. copiar únicamente `20261018171254...v2` al directorio aislado;
3. confirmar el hash anterior y que `20261018171252` siga ausente;
4. exigir que el dry-run muestre exclusivamente 4B v2;
5. ejecutar después la verificación `20261018171254_verify.sql` y la sonda
   general actualizada.

### Sustitución de 4C — 2026-10-22

4C v2 conserva la firma privada existente para no ampliar innecesariamente la
superficie futura de wrappers. Exige el centinela de 4B v2 y no se instala si
la función 4C anterior ya existe. En creación bloquea primero la campaña
destino. En edición lee el vínculo únicamente para determinar locks, bloquea
campaña anterior y destino en orden UUID, y recién después bloquea la frase y
revalida su versión.

Las asociaciones nuevas, ediciones, reasignaciones y restauraciones rechazan
campañas inexistentes o con `deleted_at` no nulo. Las frases de una campaña
retirada siguen conservándose con soft-delete; pueden recuperarse como frases
generales o reasignarse a otra campaña vigente, pero no restaurarse dentro de
la campaña retirada. Las ediciones idénticas son no-op. El índice único parcial
continúa impidiendo duplicados de texto por destino, por lo que no se añadió
una segunda tabla de idempotencia para frases: las creaciones repetidas no
duplican filas y las mutaciones usan `p_expected_version`.

Antes de un preflight futuro de 4C v2:

1. conciliar las 36 migraciones remotas confirmadas;
2. copiar únicamente `20261018171255...v2` al directorio aislado;
3. confirmar el SHA-256 de la tabla de orden y que `20261018171253` siga
   ausente;
4. exigir que el dry-run muestre exclusivamente 4C v2;
5. ejecutar después `supabase/verification/20261018171255_verify.sql` y la
   sonda general actualizada.

Nota histórica ya superada: en la revisión de 4C los componentes posteriores
permanecían bloqueados hasta su corrección coordinada. El bloque 6 exigía los
centinelas 4A v1, 4B v1 y 4C v1. 7A-1 y 7A-2 conservaban firmas antiguas de
4A/4B; 7B conservaba sus grants. El frontend mantenía llamadas antiguas de
campañas. 7A-3 no administra campañas
ni frases, pero solo debe instalarse en su orden después de los wrappers
anteriores ya corregidos. No se modificaron esos archivos en la preparación
local de 4C v2. Las versiones v2 vigentes y el frontend preparados el 24 de
octubre sustituyen ese estado.

## Conexión y preflight con Supabase CLI

El mecanismo previsto es Supabase CLI fijado a una versión concreta, ejecutado
desde un directorio temporal separado del repositorio canónico. La conexión usa
el **session pooler** de `sa-east-1`, puerto 5432 y usuario
`postgres.mymrbpwvghxmqqpzzdqk`. La contraseña se ingresa de forma oculta y se
mantiene únicamente en memoria. El host directo del proyecto resuelve solo por
IPv6 en el entorno de despliegue; el pooler ofrece conectividad IPv4.

Antes de cualquier escritura:

1. inicializar el directorio aislado sin copiar migraciones canónicas;
2. ejecutar `migration fetch --db-url <conexión>` para recuperar el historial;
3. ejecutar `migration list --db-url <conexión>` y confirmar correspondencia
   exacta con producción, incluidas las versiones efectivas de 1, 2 y 3A;
4. copiar una sola migración autorizada y comprobar nuevamente su SHA-256;
5. ejecutar `db push --dry-run --include-all --skip-vault --db-url <conexión>`;
6. exigir que el plan muestre exclusivamente esa migración;
7. detenerse si aparece cualquier archivo histórico o inesperado.

`migration fetch`, `migration list` y `db push --dry-run` son el preflight. No
se usa `migration repair`, no se modifica el historial y nunca se ejecuta
`db push` sin `--dry-run` durante esta fase.

## Procedimiento futuro por bloque

Una autorización de escritura posterior deberá conservar el mismo directorio
ya conciliado y, para cada paso:

1. confirmar mediante la sonda que todas sus dependencias están instaladas;
2. verificar el SHA-256 local;
3. repetir `db push --dry-run --include-all --skip-vault` y exigir un solo
   archivo;
4. aplicar una sola migración con Supabase CLI, sin iniciar otra en paralelo;
5. consultar `migration list` y confirmar la versión local exacta;
6. ejecutar `stage_c_installation_status.sql`;
7. ejecutar el archivo `<versión>_verify.sql` correspondiente;
8. comprobar centinela, objetos, `search_path`, modo de seguridad y permisos;
9. continuar únicamente si el estado es inequívocamente `confirmed`.

## Reglas ante desconexiones

Si una llamada pierde la conexión:

- no reintentar automáticamente;
- consultar registro, centinela, funciones y permisos;
- considerar confirmado solamente un bloque completamente coherente;
- considerar revertido solamente un bloque sin registro, centinela ni objetos;
- detener todo ante un estado parcial o ambiguo;
- no cambiar al SQL Editor, `migration repair` ni otro mecanismo sin
  autorización nueva.

## Controles de seguridad entre fases

### Hasta 5C

Las funciones permanecen en `private` y sin `EXECUTE` para `PUBLIC`, `anon`,
`authenticated` o `service_role`.

### Después de 6

Los valores iniciales permanecen privados. No debe existir apariencia publicada,
campaña activa, FAQ pública, documento legal publicado ni sugerencia QA.

### Después de 7A-1, 7A-2 o 7A-3

Cada grupo confirmado debe conservar sus wrappers sin permisos de ejecución. Al
final de 7A-3 deben existir los 27 wrappers (3 lectores públicos y 24 rutas
administrativas/internas), todos cerrados. El bucket continúa
privado y sin políticas de Etapa C.

### Después de 7B

Verificar inmediatamente:

- lecturas públicas únicamente para experiencia, contenidos publicados y FAQ;
- RPC administrativas únicamente para `authenticated`, con validación AAL2 en
  las funciones privadas;
- RPC internas de sugerencias únicamente para `service_role`;
- cero acceso anónimo a administración o sugerencias privadas;
- exactamente dos políticas de Storage previstas;
- bucket `site-assets` todavía marcado como privado.

## Pruebas posteriores a los quince pasos

Ejecutar pruebas SQL con registros QA y `ROLLBACK` para:

- administrador AAL2 autorizado;
- administrador AAL1 rechazado;
- cliente y visitante rechazados en operaciones administrativas;
- borradores no visibles públicamente;
- campañas por fecha, prioridad, recurrencia anual y zona horaria argentina;
- campañas anuales del 29 de febrero: ejecución solo en años bisiestos,
  omisión segura en los demás y próximo cambio en el siguiente año válido;
- restauración de apariencia predeterminada;
- contenidos, historial y FAQ;
- validación contra XSS;
- protección, rate limiting y privacidad de sugerencias;
- ausencia de registros QA residuales.

Después ejecutar Security Advisor y conciliar productos, categorías, insumos,
recetas, pedidos, artículos, inventario, presupuestos y Comunidad con la línea de
base tomada antes de comenzar.

## Criterios de detención

Detener el despliegue si aparece cualquiera de estas condiciones:

- migración, centinela y objetos no coinciden;
- una función obtiene permisos antes de la fase prevista;
- `search_path` no está restringido;
- una función administrativa no exige AAL2;
- RLS queda desactivado;
- borradores o datos privados resultan accesibles;
- aparecen políticas de Storage antes de 7B;
- cambian datos comerciales o quedan registros QA;
- Security Advisor informa una vulnerabilidad nueva relacionada con Etapa C.

## Recuperación

La primera respuesta es detenerse y conservar el estado parcial cerrado. Si 7B
ya activó las rutas y se detecta una regresión crítica, utilizar únicamente con
autorización separada:

`supabase/rollback/20261018171500_stage_c_partial_safe_state.sql`

Ese procedimiento revoca las rutas, elimina las dos políticas de Storage de
Etapa C, vuelve a afirmar RLS y mantiene tablas, funciones y datos. No existe un
rollback destructivo automático.

## Pasos posteriores fuera de este plan

La instalación SQL no autoriza por sí misma:

- configurar `SUGGESTION_RATE_LIMIT_SALT`;
- desplegar las Edge Functions;
- publicar el frontend;
- activar campañas o publicar contenidos;
- iniciar la Etapa D.

Esas acciones requieren autorización independiente después del informe de las
migraciones.

