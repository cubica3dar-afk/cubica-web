# Cúbica 3D — Etapa C, preflight del bloque 4B

Fecha: 2026-10-21  
Alcance: revisión local y consultas de solo lectura en producción.  
Resultado: **NO APTO PARA INSTALAR; requiere una versión corregida de 4B.**

## Identificación

- Archivo: `20261018171252_stage_c_campaign_admin_private_functions.sql`
- SHA-256 comprobado: `CB1421D6F6F4CD8566B85974860B9E5AC1C6F54CBB10CFA2ADC50EA1AAEFB0EB`
- El archivo coincide con el hash autorizado y no fue modificado.
- El documento operativo principal contiene este hash. El documento histórico
  `STAGE_C_FINAL_SUBDIVISION_20261018.md` conserva un hash anterior distinto y
  debe considerarse obsoleto para 4B.

4B crearía cuatro funciones privadas:

1. `private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer) returns jsonb`
2. `private.admin_set_site_campaign_state(uuid,text,integer) returns jsonb`
3. `private.admin_duplicate_site_campaign(uuid) returns jsonb`
4. `private.admin_delete_site_campaign(uuid,integer) returns void`

Trabaja sobre `private.site_campaigns`,
`private.site_campaign_occurrences`, `private.site_welcome_phrases` y
`private.site_assets`. Crea y edita borradores, publica o desactiva campañas,
duplica campañas y realiza retiro lógico. Los estados almacenados son
`draft`, `published` y `disabled`; “programada”, “activa” y “finalizada” son
estados derivados del calendario de una campaña publicada.

## Producción, solo lectura

- Proyecto: `ACTIVE_HEALTHY`.
- PostgreSQL: `17.11.0.002`.
- Historial remoto: 35 migraciones.
- Instalados y con centinela válido: bloques 1, 2, 3A, 3B-1 v3, 3B-2 v2,
  3C-1, 3C-2 y 4A v2.
- 4B ausente: versión `20261018171252`, centinela y las cuatro funciones no
  existen.
- Las 11 tablas de Etapa C tienen RLS activo y no conceden permisos directos a
  `PUBLIC`, `anon`, `authenticated` ni `service_role`.
- Bucket `site-assets`: privado. Políticas públicas relacionadas: 0.
- Filas de Etapa C visual: 0 recursos, 0 apariencias, 0 campañas, 0
  ocurrencias y 0 frases.

Historial remoto relevante, obtenido por lectura de Supabase:

```text
20261018171218  stage_c_active_campaign_private_function_v3
20261018171223  stage_c_next_change_private_function_v2
20261018171231  stage_c_site_experience_private_function
20261018171232  stage_c_admin_configuration_private_function
20261018171249  stage_c_appearance_asset_admin_private_functions_v2
20261018213838  stage_c_20261018171000_visual_schema
20261018213927  stage_c_20261018171100_content_suggestion_schema
20261019015434  stage_c_20261018171210_visual_validators_private_functions
TOTAL_REMOTO=35
4B_20261018171252=AUSENTE
```

## Hallazgos bloqueantes

### 1. Creación sin idempotencia

Cuando `p_id` es `null`, la función genera un UUID nuevo en cada llamada. No
recibe un `request_id`, no conserva una clave de idempotencia y no existe una
restricción que relacione reintentos equivalentes. En PostgreSQL aislado, dos
llamadas idénticas crearon dos campañas.

Esto permite duplicados ante doble clic, repetición del navegador o respuesta
de red perdida.

### 2. Duplicación sin idempotencia

`admin_duplicate_site_campaign(uuid)` tampoco recibe una clave de operación.
Dos ejecuciones con el mismo origen crean dos copias diferentes. La prueba
aislada reprodujo exactamente ese resultado.

### 3. Copia no protegida frente a cambios concurrentes

La duplicación lee la campaña origen sin `FOR SHARE` o `FOR UPDATE` y copia
ocurrencias y frases en sentencias posteriores. No existe un control de versión
del origen. Una edición, retiro o cambio de estado concurrente puede producir
una copia formada con revisiones distintas del mismo origen. La carrera real
multisesión quedó **NO EJECUTADA** porque PGlite 17.5 ofrece una sola sesión;
el riesgo está demostrado por la ausencia de bloqueo y control optimista en el
SQL.

### 4. Repetición de publicación no idempotente

Volver a solicitar `published` sobre una campaña ya publicada aumenta la
versión y vuelve a escribir `published_at` y `published_by`. La prueba aislada
confirmó el incremento. Esto altera el desempate por publicación reciente y
puede cambiar qué campaña gana cuando existen prioridades e inicios iguales.

### 5. Compatibilidad pendiente en 4C

La futura función de frases comprueba que `site_campaigns.id` exista, pero no
excluye `deleted_at is not null`. Después de un retiro lógico sería posible
asociar una frase nueva a una campaña retirada. No expone el borrador al
público, pero contradice la integridad esperada y debe corregirse junto con la
actualización de firmas posterior a 4B.

## Controles que aprobaron

- Las cuatro funciones de 4B son `SECURITY DEFINER` y fijan
  `search_path=''`.
- Todas llaman a `private.stage_c_assert_admin()`, cuyo centinela instalado es
  válido y aplica administrador con MFA AAL2.
- El bloque revoca `EXECUTE` a `PUBLIC`, `anon`, `authenticated` y
  `service_role` y verifica esas revocaciones antes de confirmar la migración.
- Una edición con versión obsoleta se rechaza con SQLSTATE `40001`; no se
  observó sobrescritura silenciosa en ese camino.
- Editar ocurrencias personalizadas usa una transacción única: si una
  ocurrencia falla, también se revierte el borrado previo.
- Una campaña publicada no puede editarse ni retirarse sin desactivarla.
- La validación de tema heredada de 4A v2 comprueba estructura, UUID, existencia,
  retiro y tipo del recurso, y toma bloqueo `FOR SHARE`.
- El retiro de recursos de 4A v2 detecta referencias en campañas y usa bloqueo,
  por lo que no se elimina un recurso todavía utilizado.
- Inicio inclusivo y fin exclusivo, prioridades, desempate, recurrencia anual,
  cruces diciembre-enero, ocurrencias personalizadas y 29 de febrero fueron
  aprobados en PostgreSQL 17.5 aislado.
- El 29 de febrero se omite en años no bisiestos y
  `stage_c_next_change` encuentra la siguiente ocurrencia válida, incluidos
  2028 y 2104.
- `get_site_experience` consume correctamente la campaña seleccionada y no
  devuelve borradores.

## Pruebas

### Aprobadas

- Suite de calendario y consumidores de campaña: aprobada.
- Suite 4A v2: controles de recursos, borrador/publicación, idempotencia de
  apariencia, versión obsoleta, AAL2 y rollback, aprobada.
- Suite estática general de Etapa C: 28 comprobaciones aprobadas.
- Seguridad estructural de 4B: cuatro firmas, guard AAL2, `SECURITY DEFINER`,
  `search_path` y ACL cerradas, aprobada.
- Versión obsoleta de campaña: rechazada con SQLSTATE `40001`.

### Fallidas por comportamiento del producto

- Reintento idéntico de creación: produjo 2 campañas.
- Reintento idéntico de duplicación: produjo 2 copias.
- Repetición de `published`: incrementó la versión y reescribió metadatos.

### No ejecutadas

- Carrera multisesión entre duplicación y edición/retiro del origen: el entorno
  PGlite 17.5 es de una sola sesión.
- `migration list` mediante Supabase CLI: no ejecutado.
- `db push --dry-run --include-all`: no ejecutado.

Los dos últimos pasos se omitieron deliberadamente al activarse la instrucción
de detener el preflight ante un defecto relevante. No se abrió una terminal de
credenciales y no se intentó ninguna conexión de escritura.

## Compatibilidad

- 4B usa la firma vigente de `stage_c_validate_theme(jsonb)` instalada por 4A
  v2; no depende de una firma reemplazada.
- 4C depende de campañas y requiere el ajuste descrito para campañas retiradas.
- 5A, 5B y 5C no llaman directamente las cuatro funciones de 4B.
- El bloque 6 exige el centinela actual de 4B.
- 7A-1 exige el centinela de 4B. 7A-2 replica exactamente las cuatro firmas
  actuales en wrappers públicos cerrados.
- 7B concede de forma explícita `EXECUTE` a `authenticated` tanto para las
  funciones administrativas privadas como para sus wrappers; el guard AAL2
  sigue siendo la autorización efectiva. Esto satisface el futuro cambio de
  permisos implícitos anunciado para el 30 de octubre de 2026, pero cualquier
  incorporación de `request_id` exige actualizar 7A-1, 7A-2, 7B, la sonda, la
  interfaz y las pruebas antes de activar la API.
- El frontend actual no envía claves de idempotencia para crear o duplicar.
- Las Edge Functions actuales no administran campañas; `site-assets` solo
  registra recursos y conserva las comprobaciones AAL2.

## Security Advisor

No aparecieron hallazgos nuevos de Etapa C. Persisten avisos anteriores:

- ocho tablas privadas con RLS y sin políticas, configuración deliberadamente
  cerrada;
- advertencias sobre funciones `SECURITY DEFINER` públicas existentes, sujetas
  a guards internos ya auditados;
- protección de contraseñas filtradas desactivada.

4B no está instalado, por lo que no agregó advertencias.

## Conciliación comercial

Los conteos antes y después de la revisión permanecieron:

| Entidad | Conteo |
|---|---:|
| Productos | 17 |
| Categorías | 4 |
| Insumos | 35 |
| Recetas | 2 |
| Pedidos | 17 |
| Ítems de pedido | 18 |
| Movimientos de inventario | 11 |
| Presupuestos | 4 |
| Versiones de presupuesto | 3 |
| Comentarios | 5 |
| Reacciones de producto | 5 |
| Likes de comentarios | 4 |

No se crearon campañas, recursos, pedidos, correos ni registros QA en
producción.

## Recomendación

No instalar el archivo actual. Preparar una nueva versión de 4B con identidad y
hash nuevos que:

1. incorpore una clave de idempotencia para crear y duplicar;
2. haga idempotente la transición al estado que ya está vigente;
3. bloquee o valide por versión una fuente mientras crea toda su copia;
4. conserve el control optimista y la atomicidad existentes;
5. actualice de forma coordinada 4C, 6, 7A-1, 7A-2, 7B, frontend, sondas,
   verificaciones y rollback.

Después corresponde repetir PostgreSQL aislado, ejecutar una prueba real con
dos sesiones PostgreSQL y recién entonces realizar `migration fetch`,
`migration list` y el `dry-run` de CLI con una sola migración pendiente.

Producción permaneció intacta. 4B no fue instalada.
