# Etapa C — corrección y validación PostgreSQL 17 de 3B-1

> **Registro histórico, reemplazado.** Conserva el resultado de la validación
> previa a la decisión del 29 de febrero. La versión definitiva, sus hashes y
> las nuevas pruebas están en `STAGE_C_FINAL_PREPARATION_20261019.md`.

Fecha: 2026-10-19  
Alcance: entorno local descartable, sin conexión ni escrituras a producción.

## Resultado

La causa técnica del defecto SQL quedó confirmada. La función declaraba
`returns private.site_campaigns`, un tipo compuesto de 26 atributos, pero el
CTE original expandía `c.*` y agregaba `effective_start`; `select c from
candidates c` intentaba devolver el registro anónimo completo de 27 atributos.

La corrección conserva `effective_start` dentro del CTE solo para ordenar. La
campaña se mantiene como un valor compuesto separado y la salida enumera en
orden los 26 campos de `private.site_campaigns`. No utiliza casts para ocultar
el desajuste.

## Identidad de la migración

- Archivo activo:
  `supabase/migrations/20261018171219_stage_c_active_campaign_private_function_v2.sql`
- Nombre administrado preparado:
  `stage_c_20261018171219_active_campaign_private_function_v2`
- Centinela: `cubica_stage_c:20261018171219`
- SHA-256:
  `3CA84542E1DFB1B2AEBF04074B2D3A364EF0540874DB5763A999CAC5B2F50756`
- Tamaño: 5.903 bytes.

La versión anterior fue movida sin cambiar sus bytes a
`supabase/archive/20261018171221_stage_c_active_campaign_private_function.invalid_return.sql`.
Conserva SHA-256
`A054C2D586CA58562E752BDBE9D91E8CAC36C42DB79F4CCC95FAD300D77024AE`.
Nunca fue aplicada en producción.

## PostgreSQL aislado

Se usó PGlite 0.3.16, que incorpora PostgreSQL 17.5, con un esquema mínimo y
datos totalmente ficticios. No se usó una base remota ni un recurso pago.

### SQL original

La creación de la definición original falló dentro de la validación de la
función:

- SQLSTATE: `XX000`.
- Mensaje: `nsitem not found (internal error)`.
- Contexto: `SQL function "stage_c_active_campaign"`.
- Archivo/rutina del servidor: `parse_relation.c` /
  `GetNSItemByRangeTablePosn`.
- La función no quedó creada.

PostgreSQL 17 no emitió el mensaje convencional de cantidad de columnas; su
validador llegó al desajuste y produjo el error interno anterior. Esto explica
un defecto real del SQL, pero no demuestra por sí solo por qué `mgmt-api`
terminó la conexión sin devolver o registrar el error del servidor.

### SQL corregido

La migración corregida se creó y se invocó sin errores para los casos válidos.
La inspección de catálogo confirmó:

- firma `private.stage_c_active_campaign(timestamptz)`;
- retorno `private.site_campaigns`;
- 26 atributos exactos, en el orden y tipos declarados;
- `STABLE`;
- `SECURITY DEFINER`;
- `search_path=''`;
- sin `EXECUTE` para `PUBLIC`, `anon`, `authenticated` ni `service_role`;
- centinela propio correcto.

## Casos de calendario

Superaron invocaciones reales:

- ausencia de campañas activas;
- campaña única;
- inicio inclusivo y fin exclusivo;
- dos campañas superpuestas;
- prioridades distintas;
- prioridad igual con desempate por inicio efectivo;
- desempate posterior por fecha de publicación e ID;
- ocurrencias personalizadas;
- recurrencia anual en años sucesivos;
- campaña anual que cruza diciembre y enero;
- zona horaria `America/Argentina/Buenos_Aires`;
- 29 de febrero en un año bisiesto.

### Decisión pendiente: 29 de febrero

La lógica histórica usa `make_date(año_actual, 2, 29)`. En un año no bisiesto
eso produce `date field value out of range`. La prueba lo confirmó en 2027. No
se cambió esta regla porque no está definido si la campaña debe omitirse,
ejecutarse el 28 de febrero o trasladarse al 1 de marzo. Además, la validación
administrativa existente usa un año no bisiesto y actualmente impediría crear
esa configuración desde el flujo normal.

## Consumidores

La prueba de compatibilidad descubrió un segundo defecto previo en
`stage_c_next_change`: las columnas `starts_at` y `ends_at` de la unión con
`site_campaign_occurrences` eran ambiguas frente a las columnas homónimas de
`site_campaigns`. Se calificaron como `o.starts_at` y `o.ends_at`; la selección
y los criterios de negocio permanecen iguales.

El archivo actualizado
`20261018171222_stage_c_next_change_private_function.sql` tiene SHA-256
`8F8461EBA5BF36C979175358CCC317869FB1D6033947414B8803280D652F7E91`.

Después de esa corrección, se crearon e invocaron correctamente:

- `private.stage_c_next_change(timestamptz)`;
- `private.get_site_experience(timestamptz)`.

`get_site_experience` recibió la campaña activa, devolvió su ID y nombre y
resolvió la frase asociada. Las otras 54 funciones de Etapa C conservan paridad
textual con el monolito original.

## Archivos actualizados

- migración 3B-1 v2 y verificación `20261018171219_verify.sql`;
- dependencias de 3B-2 y 3C-1;
- corrección de referencias ambiguas en 3B-2;
- sonda `stage_c_installation_status.sql`;
- plan de despliegue y recuperación;
- rollback de contención, que ya incluye las funciones 3B;
- prueba PostgreSQL 17 y pruebas de paridad;
- dependencia local fijada a PGlite 0.3.16.

## Pruebas

- Arnés PostgreSQL 17.5: 12 grupos de validación superados.
- Etapa C: 28 comprobaciones superadas.
- Regresiones de presupuestos, experiencia, Etapa A, corrección de categorías y
  Etapa B: todas superadas.
- Suite integrada ejecutada mediante `CI=true pnpm test`: aprobada.

## Recomendación para el próximo despliegue

No reutilizar `20261018171221`. Solicitar una autorización nueva para instalar
`20261018171219` y luego `20261018171222`, uno por uno, con sus verificadores.
Debido a las desconexiones previas del mecanismo administrado, la opción más
controlable es una transacción por SQL Editor o una conexión PostgreSQL directa,
seguida de `supabase migration list` y, solo si se aprueba expresamente, la
reconciliación oficial mediante `supabase migration repair`. Nunca insertar ni
editar manualmente `supabase_migrations.schema_migrations`.

Antes de habilitar campañas del 29 de febrero debe definirse su semántica en
años no bisiestos. Esta decisión no bloquea campañas con fechas válidas.

## Producción

No se ejecutaron consultas de escritura, SQL Editor, migraciones, secretos,
Edge Functions ni despliegues. Una lectura final confirmó:

- bloques 1, 2 y 3A como únicas migraciones instaladas de Etapa C;
- `stage_c_active_campaign` ausente;
- 11/11 tablas de Etapa C con RLS y cero filas;
- bucket `site-assets` privado;
- conteos comerciales sin cambios: 17 productos, 4 categorías, 35 insumos, 2
  recetas, 17 pedidos, 18 artículos, 11 movimientos, 4 presupuestos, 3
  versiones, 5 comentarios, 5 reacciones y 4 likes de comentarios.
