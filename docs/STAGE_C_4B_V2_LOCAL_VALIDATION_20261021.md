# Cúbica 3D — Etapa C, 4B v2: corrección y validación local

Fecha: 2026-10-21  
Alcance: preparación local. No se conectó ni escribió en producción.  
Resultado: **candidata local aprobada, pendiente de concurrencia multisesión y de un preflight remoto separado**.

## Identidad

- Migración: `20261018171254_stage_c_campaign_admin_private_functions_v2.sql`
- Nombre administrado previsto:
  `stage_c_20261018171254_campaign_admin_private_functions_v2`
- SHA-256:
  `3330F8118C5539548AFC0A6804D4BD1AEDD799F70E68CD4FBCDB3790E62DC429`
- Centinela: `cubica_stage_c:20261018171254`

El 4B original se movió a
`supabase/archive/20261018171252_stage_c_campaign_admin_private_functions.pre_idempotency.sql`.
Su SHA-256 histórico sigue siendo
`CB1421D6F6F4CD8566B85974860B9E5AC1C6F54CBB10CFA2ADC50EA1AAEFB0EB`.

## Cambios respecto de 4B v1

### Idempotencia transaccional

Se añadió `private.site_campaign_idempotency` con clave primaria:

```text
(actor_id, operation, request_id)
```

La tabla conserva el payload solicitado, la campaña resultante y la respuesta
original. Está en el esquema `private`, tiene RLS activo, una política de
denegación y ningún permiso para `PUBLIC`, `anon`, `authenticated` o
`service_role`. La FK `result_campaign_id` tiene un índice parcial para que una
eliminación o conciliación futura no obligue a recorrer toda la auditoría.

El flujo es:

1. el guard central valida administrador y MFA AAL2;
2. se intenta reservar la clave con `INSERT ... ON CONFLICT DO NOTHING`;
3. se bloquea la fila de idempotencia con `FOR UPDATE`;
4. una clave existente con otro payload se rechaza con SQLSTATE `22023`;
5. una repetición válida devuelve el JSON guardado;
6. una operación nueva ejecuta toda la mutación y guarda su resultado en la
   misma transacción.

Un error posterior revierte simultáneamente la campaña, sus relaciones y la
reserva. La clave no puede quedar consumida por una operación fallida.

La identidad se toma exclusivamente de `auth.uid()` dentro de funciones
cerradas. Otro administrador puede usar el mismo UUID sin leer ni recibir el
resultado del primero.

### Nuevas firmas

```text
private.admin_upsert_site_campaign(..., p_expected_version integer, p_request_id uuid)
private.admin_set_site_campaign_state(uuid,text,integer,uuid)
private.admin_duplicate_site_campaign(uuid,integer,uuid)
private.admin_delete_site_campaign(uuid,integer)
```

En `admin_upsert_site_campaign`, `p_request_id` es obligatorio al crear y debe
ser nulo al editar. La edición conserva control optimista por versión.

Duplicar requiere ahora la versión esperada y el UUID de solicitud. Cambiar el
estado también requiere UUID de solicitud.

### Publicación

- Repetir la misma solicitud devuelve la respuesta original.
- Una solicitud diferente que intenta publicar una campaña que ya está
  publicada y usa su versión vigente es un no-op: no aumenta `version` ni
  cambia `published_at`.
- Una repetición con revisión antigua solamente se acepta si coincide con la
  clave y el payload de una operación confirmada. En cualquier otro caso se
  rechaza con SQLSTATE `40001`.
- Desactivar, editar y publicar nuevamente produce una nueva publicación
  legítima.

### Duplicación coherente

El orden de locks es:

1. fila de idempotencia;
2. campaña fuente `FOR UPDATE`;
3. ocurrencias por `id` con `FOR SHARE`;
4. frases por `id` con `FOR SHARE`.

La versión y `deleted_at` se verifican después de bloquear la fuente. La copia
de campaña, fechas y frases se ejecuta dentro de una sola transacción. Si una
inserción falla, no queda campaña parcial ni clave reservada.

Una edición o eliminación que termina antes del lock hace que la duplicación
rechace la versión obsoleta. Si la duplicación obtiene primero el lock, copia
una revisión coherente y la operación concurrente espera.

## Seguridad

Seis funciones quedan cerradas:

1. `stage_c_begin_campaign_operation(text,uuid,jsonb)`
2. `stage_c_complete_campaign_operation(text,uuid,jsonb,uuid,jsonb)`
3. `admin_upsert_site_campaign(...,integer,uuid)`
4. `admin_set_site_campaign_state(uuid,text,integer,uuid)`
5. `admin_duplicate_site_campaign(uuid,integer,uuid)`
6. `admin_delete_site_campaign(uuid,integer)`

Todas son `SECURITY DEFINER`, usan `search_path=''`, llaman directa o
indirectamente al guard AAL2 y no conceden `EXECUTE` a roles de Data API. La
migración exige los centinelas de 3A, 3B-1 v3 y 4A v2 antes de crear objetos.

La tabla nueva está en `private`; el cambio anunciado por Supabase para tablas
nuevas de `public` el 30 de octubre no requiere ningún `GRANT` adicional.

## Pruebas PostgreSQL 17.5

### Aprobadas

1. Creación inicial.
2. Repetición de creación con igual clave.
3. Aislamiento de la misma clave entre dos identidades administrativas.
4. Reutilización de clave con datos diferentes.
5. Dos campañas idénticas intencionales con claves distintas.
6. Duplicación inicial.
7. Repetición de duplicación.
8. Duplicaciones intencionales distintas.
9. Publicación inicial.
10. Republicación sin cambios.
11. Edición y nueva publicación.
12. Publicación obsoleta.
13. Duplicación con revisión obsoleta.
14. Duplicación de campaña retirada.
15. Copia de dos fechas, dos frases y recurso visual.
16. Fallo intermedio y rollback de copia más reserva.
17. Recurrencia y 29 de febrero.
18. Superposición y prioridades.
19. Rechazo sin AAL2.
20. Recurso inexistente.
21. Recurso de 4A v2 todavía utilizado.
22. Firmas, `SECURITY DEFINER`, `search_path`, ACL y RLS.
23. Sonda de verificación de 4B v2.
24. Rollback sin residuos QA.
25. Recuperación que retira funciones y conserva la auditoría privada.

Las suites de calendario, 4A v2 y Etapa C también aprobaron. Se mantuvieron la
zona horaria argentina, inicio inclusivo, fin exclusivo, recurrencia anual,
cruce diciembre-enero, ocurrencias personalizadas, prioridades y omisión del
29 de febrero en años no bisiestos.

### No ejecutada

La carrera real entre dos sesiones PostgreSQL está **NO EJECUTADA**. PGlite
17.5 ofrece una sola sesión y el entorno no tiene servidor PostgreSQL ni Docker.
No se presenta una secuencia de llamadas como prueba de concurrencia.

## Solución propuesta para 4C

4C no fue modificado. La versión actual queda congelada porque su número
`20261018171253` es anterior a 4B v2 y porque acepta campañas con
`deleted_at is not null`.

La futura 4C v2 debería:

1. usar una versión posterior a `20261018171254`;
2. exigir el centinela de 4B v2;
3. bloquear primero las campañas y después la frase, respetando el mismo orden
   campaña → frase usado por la eliminación;
4. al crear, mover o restaurar una frase, exigir campaña existente y no
   retirada;
5. si cambia de campaña, bloquear campaña anterior y destino en orden UUID
   antes de bloquear la frase;
6. conservar soft-delete e historial de frases asociadas a campañas retiradas;
7. excluir contenido retirado de experiencia pública, pero conservarlo como
   auditoría administrativa explícita;
8. probar la carrera entre retiro de campaña y asociación/restauración de
   frase con dos sesiones reales.

## Matriz de compatibilidad

| Componente | Estado | Cambio necesario antes de activarlo |
|---|---|---|
| 4A v2 | Compatible | Ninguno; 4B v2 exige su centinela y usa su validador de recursos. |
| 4C v1 | Incompatible/congelado | Crear 4C v2 posterior a 171254 con validación `deleted_at` y locks ordenados. |
| 5A, 5B, 5C | Compatibles | No llaman las funciones de campaña. |
| Bloque 6 | Incompatible | Actualizar requisito del centinela 171252 al 171254. |
| 7A-1 | Incompatible | Actualizar requisito de 4B y firma privada. |
| 7A-2 | Incompatible | Añadir `p_request_id` y `p_expected_version` a wrappers de campaña. |
| 7A-3 | Compatible | No contiene operaciones de campaña. |
| 7B | Incompatible | Actualizar listas de firmas y grants explícitos mínimos. |
| Frontend | Incompatible todavía | Mantener UUID estable por intento de crear, duplicar y cambiar estado; enviar versión al duplicar. |
| Edge Functions | Compatible | Ninguna Edge Function administra campañas actualmente. |
| Sonda | Actualizada | Reconoce 4B v1 como reemplazado y 4B v2 como bloque vigente. |
| Rollback general | Pendiente | Actualizar firmas cuando se autoricen los wrappers coordinados. |

No se modificaron 4C, wrappers, frontend, Edge Functions ni activación.

## Recuperación

`supabase/rollback/20261018171254_stage_c_campaign_admin_private_functions_v2.sql`
revoca y elimina las seis funciones, pero conserva
`private.site_campaign_idempotency` con RLS y permisos cerrados. Esto evita
borrar auditoría legítima si alguna vez fuera necesario desactivar 4B v2 tras
su uso.

## Riesgos pendientes

- Falta ejecutar concurrencia real con dos conexiones PostgreSQL 17.
- La tabla de idempotencia no tiene todavía una política de retención; se
  conserva como auditoría y podría crecer con el uso.
- 4C y los bloques 6/7 deben versionarse de nuevo antes de continuar.
- El frontend debe generar y conservar correctamente las claves de solicitud;
  el backend ya garantiza la seguridad aun ante doble clic o reintento.
- Falta un preflight Supabase CLI separado y autorizado. No se ejecutó
  `migration fetch`, `migration list` ni `db push --dry-run` en esta etapa.

## Producción

No se hicieron consultas remotas nuevas ni escrituras. No se ejecutaron
migraciones, SQL Editor, `migration repair`, funciones, campañas, secretos,
Storage, frontend ni Edge Functions en producción.
