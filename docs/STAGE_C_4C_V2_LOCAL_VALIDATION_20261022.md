# Cúbica 3D — Etapa C, 4C v2: corrección y validación local

Fecha: 2026-10-22  
Alcance: preparación local. No se conectó ni escribió en producción.  
Resultado: **candidata local aprobada; lista para un preflight remoto separado y autorizado**.

## Identidad

- Migración: `20261018171255_stage_c_phrase_admin_private_function_v2.sql`
- Nombre administrado previsto:
  `stage_c_20261018171255_phrase_admin_private_function_v2`
- SHA-256:
  `9A2A9FE644416662B0788ACF6F8EF3E1FAD00B09D44D1EAF19851B29F73D2E43`
- Centinela: `cubica_stage_c:20261018171255`
- Verificación SHA-256:
  `690CE6DA83F1D00FDEBA9268A2698EA03D877CB5760D4CB2C2EA08556A398EB1`
- Recuperación SHA-256:
  `96460AF9EFA33C0A77A5CE7B4947E2FC3F09B3EEDBA1757DCBD9CC7B1B1710AD`

El 4C original se movió a
`supabase/archive/20261018171253_stage_c_phrase_admin_private_function.pre_campaign_consistency.sql`.
Su SHA-256 histórico se conserva como
`A9650C07D4927C5D55457A86C1CF30851B1CBBD78B187069507EF9353B4B8768`.
De acuerdo con la última línea de base remota ya verificada, producción tenía
36 migraciones y 4C original seguía ausente. Esta tarea no hizo una consulta
remota nueva porque su autorización fue exclusivamente local.

## Corrección

La función conserva la firma:

```text
private.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean)
```

Los cambios son:

1. exige el centinela de 4B v2 (`20261018171254`);
2. se niega a sobrescribir una función 4C ya existente;
3. al crear una frase bloquea primero la campaña destino con `FOR SHARE`;
4. al editar obtiene una lectura inicial del vínculo, bloquea campaña anterior
   y destino por UUID, y recién después bloquea la frase con `FOR UPDATE`;
5. revalida versión y vínculo después de todos los locks;
6. distingue campaña inexistente (`23503`) de campaña retirada (`55000`);
7. rechaza crear, editar, reasignar o restaurar dentro de una campaña retirada;
8. conserva soft-delete y permite recuperar una frase histórica como general o
   reasignarla a otra campaña vigente;
9. una edición idéntica con revisión vigente es un no-op;
10. traduce el conflicto del índice único a un error explícito `23505`.

4B v2 y 4C v2 comparten el orden campaña → frases. Si 4C obtiene primero el
lock de campaña, una eliminación espera y luego retira la frase ya asociada. Si
la eliminación gana primero, 4C observa `deleted_at` o una versión obsoleta y
rechaza la operación. La transacción de la función evita estados parciales.

## Idempotencia

No se añadió otra tabla de idempotencia. La decisión se basa en el modelo
existente:

- el índice único parcial impide duplicar el mismo texto activo dentro del
  mismo destino;
- las ediciones, activaciones, eliminaciones y restauraciones exigen
  `p_expected_version`;
- una edición idéntica no aumenta la versión;
- una repetición obsoleta se rechaza con `40001`.

Agregar una clave de solicitud habría obligado a cambiar la firma, el wrapper y
el frontend sin aportar una garantía de integridad que hoy falte. Una creación
repetida devuelve un conflicto explícito en vez de duplicar la fila.

## Visibilidad y experiencia pública

El modelo no tiene un estado separado de publicación para frases. La
visibilidad se deriva de:

- `active=true`;
- `deleted_at is null`;
- campaña publicada y activa, cuando existe `campaign_id`;
- frase general como fallback cuando la campaña no tiene frases visibles.

`private.stage_c_active_campaign` ya excluye campañas retiradas y
`private.get_site_experience` ya excluye frases eliminadas. Las pruebas
confirmaron que una campaña borrador no filtra su frase, una campaña publicada
sí la muestra y una frase inactiva provoca el fallback general. No fue
necesario modificar calendario ni experiencia pública.

## Seguridad

- `private.stage_c_assert_admin()` se ejecuta antes de cualquier mutación.
- AAL1 fue rechazado con SQLSTATE `42501`.
- La función es `SECURITY DEFINER` y tiene `search_path=''`.
- `PUBLIC`, `anon`, `authenticated` y `service_role` no tienen `EXECUTE`.
- `private.site_welcome_phrases` conserva RLS y no tiene lectura directa para
  roles de Data API.
- No se creó ninguna RPC pública ni se cambió ningún grant.
- La función valida acción, versión, texto y destino.

## Pruebas en PostgreSQL 17.5 aislado

### Aprobadas

1. Seguridad de función, ACL y RLS.
2. Creación de frase general.
3. Creación para campaña válida.
4. Rechazo de campaña inexistente.
5. Rechazo de campaña retirada al crear.
6. Edición y reasignación válida.
7. Eliminación lógica y restauración válida.
8. Preservación histórica y rechazo de restauración en campaña retirada.
9. Recuperación de una frase histórica como frase general.
10. Reasignación a campaña retirada rechazada.
11. Revisión obsoleta rechazada.
12. Edición idéntica sin aumento de versión.
13. Creación repetida sin duplicado.
14. Borrador, publicación, inactividad y fallback público.
15. Campaña retirada sin filtración pública y con frase histórica conservada.
16. Recurrencia anual, año bisiesto y omisión en año no bisiesto.
17. Rechazo de AAL1.
18. Error sin escritura parcial.
19. `ROLLBACK` sin residuos QA.
20. Recuperación que retira la función y conserva tabla, datos y RLS.

Además aprobaron las otras nueve suites del proyecto incluidas en la ejecución
integral: presupuestos, interfaz, Etapas A/B, calendario, 4A v2, 4B v2 y las 28
comprobaciones estáticas/funcionales de Etapa C.

### No ejecutada

La carrera real entre dos conexiones PostgreSQL independientes está **NO
EJECUTADA**. PGlite 17.5 ofrece una sola sesión. Se inspeccionó el orden de
locks y se ejercitaron los dos resultados secuenciales, pero no se presenta una
simulación como prueba multisesión. Producción usa PostgreSQL 17.11; no se usó
para escrituras de QA.

## Recuperación

`supabase/rollback/20261018171255_stage_c_phrase_admin_private_function_v2.sql`
revoca permisos y elimina solamente la función 4C v2. Conserva
`private.site_welcome_phrases`, todas sus filas y RLS. No borra frases ni
restaura automáticamente una función anterior que nunca fue instalada.

## Componentes posteriores

| Componente | Estado frente a 4C v2 | Acción pendiente |
|---|---|---|
| 4B v2 | Compatible | Ninguna. 4C v2 exige su centinela y respeta su orden de locks. |
| Bloque 6 | Bloqueado | Cambiar requisitos 4A v1/4B v1/4C v1 por las versiones vigentes antes de instalar. |
| 7A-1 | Bloqueado por prerrequisitos antiguos | Actualizar sus comprobaciones de 4A/4B/4C y las firmas de apariencia. |
| 7A-2 | Frase compatible; bloque bloqueado | Actualizar el centinela de 4C; el wrapper de frase conserva su firma. Los wrappers de campaña deben incorporar `request_id` y versión esperada. |
| 7A-3 | Funcionalmente independiente | Mantener el orden de instalación después de wrappers corregidos. |
| 7B | Bloqueado | Actualizar firmas y grants mínimos de 4A/4B antes de activar. |
| Frontend de frases | Compatible con la firma | La UI actual no lista frases eliminadas; una restauración histórica requerirá una vista administrativa futura. |
| Frontend de campañas | Bloqueado por 4B v2 | Generar UUID estable por intento y enviar versión al duplicar/transicionar. |
| Experiencia pública | Compatible | Ningún cambio necesario; se probó integración y fallback. |
| Sonda general | Actualizada | Reconoce 4C v1 como reemplazado y 4C v2 como vigente. |

No se modificaron silenciosamente los bloques posteriores, wrappers ni
frontend.

## Archivos

### Creados

- `supabase/migrations/20261018171255_stage_c_phrase_admin_private_function_v2.sql`
- `supabase/verification/20261018171255_verify.sql`
- `supabase/rollback/20261018171255_stage_c_phrase_admin_private_function_v2.sql`
- `tests/stage-c-4c-v2-postgres17.test.mjs`
- `docs/STAGE_C_4C_V2_LOCAL_VALIDATION_20261022.md`

### Archivado

- `supabase/archive/20261018171253_stage_c_phrase_admin_private_function.pre_campaign_consistency.sql`
- `supabase/archive/20261018171253_verify.replaced.sql`

### Actualizados

- `docs/STAGE_C_SPLIT_DEPLOYMENT_PLAN.md`
- `supabase/verification/stage_c_installation_status.sql`
- `tests/site-configuration-stage-c.test.mjs`
- `package.json`

## Riesgos y recomendación

El riesgo residual principal es la falta de prueba multisesión real. La
protección estructural es coherente con 4B v2, pero el preflight debería volver
a revisar SQL, hash, dependencias y confirmar que el dry-run contiene
exclusivamente 4C v2. Los bloques 6 y 7 no están listos y no deben incluirse.

La candidata está lista para solicitar autorización de **preflight solamente**.
No está autorizada ni aplicada en producción.
