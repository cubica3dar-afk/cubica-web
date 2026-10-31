# Etapa C — diagnóstico técnico de 3B-1

Fecha: 2026-10-19  
Proyecto: `mymrbpwvghxmqqpzzdqk` (`sa-east-1`, PostgreSQL 17.11)  
Alcance: lectura de producción y preparación local. No se ejecutaron escrituras.

## Resultado ejecutivo

La desconexión del mecanismo administrado no tiene una causa demostrada en los
logs disponibles. PostgreSQL recibió el lote completo, pero la sesión solo dejó
una entrada `LOG` con SQLSTATE `00000`; no existe `ERROR`, `FATAL`, duración ni
evento de espera para esa sesión.

La revisión sí encontró un defecto independiente y concreto en el SQL de
`stage_c_active_campaign`: el CTE `candidates` contiene las 26 columnas de
`private.site_campaigns` más `effective_start`, y la sentencia final devuelve
el registro completo del CTE mediante `select c`. Una sonda de solo lectura
confirmó `record` con 27 campos frente al retorno declarado
`private.site_campaigns` con 26 campos. PostgreSQL exige que una función SQL que
devuelve un tipo compuesto entregue exactamente ese tipo o sus columnas en el
orden y tipos correctos.

El desajuste fue reproducido posteriormente en PostgreSQL 17.5: la definición
original falló con SQLSTATE `XX000`, `nsitem not found (internal error)`, dentro
de `stage_c_active_campaign`, y no dejó la función creada. La versión corregida
se creó e invocó correctamente. Este resultado confirma el defecto SQL, pero no
demuestra por sí solo por qué `mgmt-api` cerró la conexión sin propagar ni
registrar ese error. El informe de validación está en
`docs/STAGE_C_3B1_POSTGRES17_VALIDATION_20261019.md`.

## Hechos comprobados

### Operación administrada

El mecanismo observado ejecutó dos lotes:

1. A las `2026-10-19 02:39:38.217 UTC`, una transacción creó o actualizó la
   estructura de `supabase_migrations.schema_migrations` y confirmó el cambio.
2. A las `2026-10-19 02:39:39.178 UTC`, otra transacción comenzó con el SQL de
   3B-1, agregó un `insert ... on conflict` para registrar versión, nombre,
   sentencias, autor, idempotencia y rollback, y terminó con `commit`.

El archivo autorizado mide 4.708 bytes. El lote registrado por PostgreSQL mide
10.166 caracteres; el SQL adicional pertenece al envoltorio administrado y al
registro de historial. El lote llegó por `mgmt-api` con:

- PID: `1512537`.
- Sesión: `6ad582ea.171459`.
- Aplicación: `mgmt-api`.
- Severidad: `LOG`.
- SQLSTATE: `00000`.
- `command_tag`: `idle`.
- Inicio de sesión: `2026-10-19 02:39:38 UTC`.

No se incluyen en este informe el usuario de Dashboard, la dirección de red ni
otros datos que no son necesarios para diagnosticar el servicio.

### Límites y sesión

La lectura actual de la base mostró:

- `statement_timeout = 2min`.
- `lock_timeout = 0`.
- `transaction_timeout = 0`.
- `idle_in_transaction_session_timeout = 0`.
- `check_function_bodies = on`.

No hay evidencia de que la operación alcanzara dos minutos. Los logs no
incluyen duración ni un error `statement timeout`. Tampoco registran bloqueo o
espera. Por eso timeout, bloqueo y problema de servicio siguen siendo hipótesis,
no conclusiones.

La documentación de Supabase indica que SQL Editor tiene un límite propio de
un minuto y que las consultas de Dashboard/API tienen límites distintos de una
conexión directa. No se encontró documentación pública que identifique el
timeout exacto del endpoint administrado usado por esta operación.

### Triggers DDL

- `public.rls_auto_enable()` solo recibe `CREATE TABLE`, `CREATE TABLE AS` y
  `SELECT INTO`; no interviene en `CREATE FUNCTION`.
- `extensions.pgrst_ddl_watch()` sí observa `CREATE FUNCTION` y `COMMENT`, y
  emite `NOTIFY pgrst, 'reload schema'`.
- El mismo observador estuvo presente cuando 3A creó cinco funciones con éxito,
  por lo que no existe evidencia de que sea la causa específica de 3B-1.

### Historial de intentos relacionados

Los logs muestran el mismo SQL de función dentro de lotes administrados en:

| UTC | PID | Tamaño del lote | Resultado conocido |
|---|---:|---:|---|
| 2026-10-18 21:09:02.910 | 1486069 | 80.149 | monolítica, revertida |
| 2026-10-18 21:11:14.501 | 1486726 | 80.149 | monolítica, revertida |
| 2026-10-18 21:39:54.812 | 1488500 | 29.802 | bloque 3, revertido |
| 2026-10-18 21:44:55.823 | 1489203 | 29.802 | bloque 3, revertido |
| 2026-10-19 01:54:55.684 | 1509287 | 15.115 | 3B, revertido |
| 2026-10-19 02:39:39.178 | 1512537 | 10.166 | 3B-1, revertido |

Esto demuestra recurrencia al incluir la función, pero no distingue entre un
error de su definición y un defecto de transporte o manejo de errores del
mecanismo administrado.

## Revisión técnica de `stage_c_active_campaign`

### Correcto o consistente

- Sintaxis de la consulta: PostgreSQL pudo analizarla con `EXPLAIN VERBOSE`.
- Dependencias presentes: `private.site_campaigns` y
  `private.site_campaign_occurrences` existen.
- Parámetro: `p_at timestamptz default now()` es compatible con `STABLE`.
- Retorno declarado: el tipo compuesto `private.site_campaigns` existe.
- Seguridad: `SECURITY DEFINER`, `search_path=''` y referencias privadas
  calificadas reducen el riesgo de sustitución de objetos.
- El mismo bloque revoca `EXECUTE` a `PUBLIC`, `anon`, `authenticated` y
  `service_role` antes de confirmar la transacción.
- La función es interna; no realiza por sí misma una operación administrativa.

### Defecto reproducible de forma

`candidates` se construye con `c.*` más `effective_start`. Por eso `select c`
produce un `record` anónimo de 27 campos. El retorno declarado tiene 26. El
plan de PostgreSQL muestra explícitamente `ROW(...26 campos..., effective_start)`.

La corrección implementada conserva la campaña como un compuesto separado,
mantiene `effective_start` solo para ordenar y enumera explícitamente los 26
campos del tipo de retorno. La versión inválida se archivó sin cambios.

### Riesgos de calendario que no explican `CREATE FUNCTION`

- `make_date` puede fallar en ejecución ante combinaciones mes/día inválidas.
- La validación administrativa existente usa un año fijo no bisiesto, por lo
  que una campaña anual del 29 de febrero requerirá una decisión funcional.
- Los horarios locales ambiguos o inexistentes por cambios de zona horaria se
  resuelven al ejecutar, no al crear la función.

Estos puntos deben probarse luego, pero no explican por sí solos una caída de la
conexión durante la creación.

## Alternativas

### A. PostgreSQL 17 aislado — recomendada primero

Ejecutar el bootstrap local y luego el archivo 3B-1 exacto con
`ON_ERROR_STOP=1`. Esto separa un error normal de PostgreSQL de la capa
`mgmt-api` y no toca producción.

Riesgos: el entorno mínimo no reproduce event triggers ni la infraestructura
de Supabase. Si se usa una rama Supabase, reproduce mejor la plataforma, pero
puede generar costos.

Costos posibles:

- PostgreSQL local o contenedor local: software sin costo; usa recursos del
  equipo.
- Preview Branch de Supabase: no tiene tarifa fija, pero factura compute,
  almacenamiento y egreso. Como referencia publicada, Micro cuesta
  USD 0,01344 por hora y cada fracción se factura como hora completa. Los
  créditos de compute no cubren Branching. No se creó ninguna rama.

### B. SQL Editor — preparar, no ejecutar todavía

Permitiría ver directamente el error SQL sin el envoltorio de migración. El
archivo debe ejecutarse dentro de una transacción con preflight, revocación y
postflight. Su límite documentado es un minuto, suficiente para una función
pequeña si no hay bloqueos.

Riesgos: una modificación hecha en SQL Editor evita el historial de migraciones.
No debe usarse hasta resolver el defecto de retorno y autorizar un procedimiento
de reconciliación.

### C. Soporte de Supabase — recomendada en paralelo después de la prueba local

Solicitar por qué `mgmt-api` cerró la sesión sin propagar ni registrar un error
SQL y si existe un límite o incidente aplicable al endpoint. El borrador está en
`docs/STAGE_C_3B1_SUPABASE_SUPPORT_DRAFT.md`.

## Procedimiento recomendado

1. Mantener archivada y fuera del directorio activo la versión inválida.
2. Usar únicamente la migración corregida `20261018171219`, cuyo hash figura en
   el informe de validación.
3. Adjuntar al ticket de soporte el SQLSTATE y el contexto reproducidos para
   pedir diagnóstico de la desconexión de `mgmt-api`.
4. Con autorización nueva, elegir entre conexión directa o SQL Editor con
   transacción controlada y reconciliación oficial del historial.
5. Mantener 7A-1/7A-2/7A-3/7B sin cambios hasta confirmar 3B-1 v2 y 3B-2.

## Historial de migraciones si se autorizara SQL Editor

La documentación oficial advierte que SQL Editor no actualiza el historial y
que `supabase migration repair <version> --status applied` solo corrige el
registro; no ejecuta SQL.

Este proyecto ya contiene versiones efectivas asignadas por el mecanismo
administrado distintas de los timestamps locales. Por eso no es seguro reparar
solo la nueva versión local `20261018171219` sin reconciliar primero 1, 2 y 3A.
El procedimiento sería:

1. capturar `supabase migration list` y el historial remoto;
2. establecer un mapeo explícito entre archivo local, nombre administrado y
   versión efectiva para 1, 2 y 3A;
3. aplicar manualmente 3B-1 v2 y verificar objeto/ACL/centinela;
4. ejecutar únicamente el comando oficial `migration repair` aprobado para la
   identidad decidida;
5. volver a listar y comprobar que `db push --dry-run` no intenta repetirla.

No se preparó ningún `INSERT` manual sobre
`supabase_migrations.schema_migrations` y no se modificó ese historial.

## Estado de producción

- Migraciones de Etapa C presentes: 1, 2 y 3A únicamente.
- Funciones privadas presentes: las cinco de 3A.
- `stage_c_active_campaign` ausente.
- 11/11 tablas con RLS.
- Cero filas en las once tablas de Etapa C.
- Bucket `site-assets` privado.
- Security Advisor sin hallazgos nuevos de Etapa C.
- No se configuraron secretos, Edge Functions, frontend, campañas ni Etapa D.

## Fuentes técnicas

- https://www.postgresql.org/docs/17/xfunc-sql.html
- https://www.postgresql.org/docs/17/sql-createfunction.html
- https://www.postgresql.org/docs/17/runtime-config-client.html
- https://supabase.com/docs/guides/database/postgres/timeouts
- https://supabase.com/docs/guides/deployment/database-migrations
- https://supabase.com/docs/guides/platform/manage-your-usage/branching
- https://supabase.com/docs/guides/platform/manage-your-usage/compute

