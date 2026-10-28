# CÚBICA 3D — Etapa C · preparación local del bloque 6 v3

Fecha: 2026-10-25  
Alcance: preparación y validación exclusivamente local.  
Resultado: **APROBADO LOCALMENTE, NO AUTORIZADO PARA PRODUCCIÓN**.

## Identidad definitiva

| Elemento | Valor |
|---|---|
| Archivo aplicable | `supabase/migrations/20261018171402_stage_c_safe_defaults_v3.sql` |
| Versión | `20261018171402` |
| Nombre previsto | `stage_c_20261018171402_safe_defaults_v3` |
| SHA-256 | `BEE9CBA3CA6366813E327DF00B4C89432DBAAE9A6D02F33F856C855747918824` |
| Centinela | `private.site_content_pages = cubica_stage_c:20261018171402` |
| Verificación | `supabase/verification/20261018171402_verify.sql` |
| Contención | `supabase/rollback/20261018171402_stage_c_safe_defaults_v3_safe_state.sql` |

El candidato v2 se movió intacto a
`supabase/archive/20261018171401_stage_c_safe_defaults_v2.rejected.sql`.
Su hash histórico continúa siendo
`7359EAF312C72F12A84C1FB607E4FFE1021B3C1C660A94D7900FBA3F43A8E813`.

## Correcciones de los siete defectos

1. **Campañas:** la compuerta usa la firma vigente de 17 argumentos de 4B v2,
   incluido `request_id`; la firma antigua de 16 argumentos no se acepta.
2. **FAQ:** el centinela `20261018171256` se comprueba en
   `private.admin_restore_faq(bigint,integer)`. La existencia de
   `admin_upsert_faq(...)` se verifica separadamente.
3. **Etiquetas:** las cuatro páginas usan `ON CONFLICT DO NOTHING`; una etiqueta
   existente, incluso vacía si el esquema la admite, no se sobrescribe.
4. **Soft-delete:** una frase se considera existente aunque tenga
   `deleted_at`; nunca se restaura ni se duplica para eludir la eliminación.
5. **Apariencia:** el borrador sugerido se crea solo si la tabla de apariencias
   está completamente vacía. Un borrador, publicación o versión archivada se
   conserva byte a byte.
6. **Contenido legítimo:** no se exige que páginas, versiones, FAQ, campañas o
   sugerencias estén vacías. No se escribe en esas filas.
7. **Frases:** las doce sugerencias se insertan explícitamente con
   `active=false`; no se asocian a campañas ni reciben fecha de publicación.

Además, un advisory lock transaccional serializa dos evaluaciones concurrentes
de la semilla. La migración valida previamente 13 tablas con RLS, ACL cerradas,
las funciones privadas requeridas, `search_path=''` y ausencia de wrappers
públicos prematuros.

## Inventario exacto de inicialización

- Crea únicamente los slugs ausentes `about`, `contact`, `terms` y `community`,
  con sus etiquetas sugeridas.
- Si no existe ninguna apariencia, crea un único `draft` versión 1 con colores,
  texto de portada y referencias de recursos nulas.
- Agrega únicamente las frases sugeridas que no tengan coincidencia global,
  incluyendo en la búsqueda coincidencias activas, inactivas o eliminadas.
- Las doce frases nuevas quedan inactivas.
- No crea campañas, ocurrencias, versiones de contenido, FAQ, sugerencias,
  recursos de Storage, políticas, funciones, wrappers ni grants.

## Matriz de preservación

| Estado anterior | Resultado v3 |
|---|---|
| Página ausente | Se crea la fila base sin versión publicada |
| Página existente con etiqueta personalizada | Se conserva completa |
| Versión de página draft/published/archived | Se conserva completa |
| Sin apariencias | Se crea un borrador privado |
| Apariencia draft/published/archived o personalizada | No se crea ni modifica otra |
| Recurso referenciado desde JSON | La referencia no cambia |
| Frase global ausente | Se crea inactiva |
| Frase activa o inactiva existente | Se conserva completa |
| Frase con soft-delete | Se conserva eliminada; no se recrea |
| FAQ activa, inactiva o eliminada | Se conserva completa |
| Campaña existente | Se conserva completa y no se activa otra |
| Datos comerciales | No se consultan para mutación ni se modifican |

El esquema no modela soft-delete para apariencias; el estado histórico
equivalente es `archived`, que fue probado. No se inventó un cuarto estado.

## Firmas y centinelas verificados

- `stage_c_assert_admin()` → `20261018171210`.
- `stage_c_active_campaign(timestamptz)` → `20261018171218`.
- `stage_c_next_change(timestamptz)` → `20261018171223`.
- `get_site_experience(timestamptz)` → `20261018171231`.
- `admin_get_site_configuration()` → `20261018171232`.
- `admin_register_site_asset(...)` → `20261018171249`.
- `admin_upsert_site_campaign(...,integer,uuid)` → `20261018171254`.
- `admin_upsert_welcome_phrase(...)` → `20261018171255`.
- `admin_restore_faq(bigint,integer)` → `20261018171256`.
- `submit_protected_suggestion(...)` → `20261018171258`.
- `admin_update_suggestion(uuid,text,text,integer,text)` → `20261024233029`.
- Tablas centinela `site_campaigns` → `20261018171000` y
  `site_suggestions` → `20261018171100`.

La compuerta diferencia función ausente de centinela incorrecto. También exige
que `admin_upsert_faq(...)` y `stage_c_validate_theme(jsonb)` existan con ACL y
`search_path` seguros.

## Pruebas ejecutadas

### Reproducción de v2

`node tests/stage-c-6-v2-audit-postgres17.test.mjs`

- 10 comprobaciones ejecutadas.
- 7 defectos bloqueantes reproducidos: frases activas, etiquetas sobrescritas,
  soft-delete eludido, apariencia publicada rechazada, contenido legítimo
  rechazado, firma 4B antigua y centinela FAQ incorrecto.
- 2 garantías de v2 confirmadas: rollback atómico ante centinela incorrecto y
  conservación de la superficie cerrada.

### Matriz v3

`node tests/stage-c-6-v3-postgres17.test.mjs`

PostgreSQL compatible 17.5 aislado mediante PGlite: **27/27 aprobadas**.

1. base vacía; 2. parcial; 3. completa; 4. etiquetas personalizadas;
5. soft-delete de frase; 6. frase activa; 7. frase inactiva;
8. apariencia publicada; 9. borrador; 10. apariencia personalizada/archivada;
11. página publicada; 12. página borrador; 13. FAQ activa; 14. FAQ eliminada;
15. contenido preexistente; 16. campañas existentes; 17. firma 4B v2;
18. centinela 5A v2; 19. centinelas restantes; 20. idempotencia;
21. JSON válido; 22. cero publicación automática; 23. lectura futura 7A/7B;
24. RLS/ACL; 25. datos comerciales; 26. rollback; 27. cero residuos QA.

La sonda `20261018171402_verify.sql` también se ejecutó dentro del entorno
aislado y confirmó 13 tablas con RLS/ACL, 12 coincidencias de frases, cero
frases predeterminadas activas y cero wrappers prematuros.

### Regresión completa

`pnpm test`: **aprobada**.

- presupuestos, experiencia, Etapas A y B;
- calendario y año bisiesto;
- 4A v2, 4B v2, 4C v2;
- 5B v3 y contrato Edge simulado;
- 5C v3;
- bloque 6 v3;
- 31 comprobaciones integrales de Etapa C.

La suite conserva avisos históricos de pruebas multisesión no ejecutadas en
4A/4B/4C/5B/5C bajo PGlite y de integraciones reales de Turnstile/Edge no
autorizadas en esta etapa. No hubo fallos; esos avisos no se presentan como
pruebas ejecutadas.

No hubo conexiones, consultas ni escrituras en Supabase de producción.

## Lectura futura y garantía de no publicación

La lectura aislada equivalente a `get_site_experience` devolvió:

- cero frases predeterminadas;
- cero campañas nuevas;
- cero páginas o FAQ sin publicación administrativa;
- fallback visual válido cuando no existe apariencia publicada.

Cuando existían una apariencia, frase, página o FAQ ya publicadas, la lectura
continuó devolviendo exclusivamente esos valores legítimos. Por lo tanto,
instalar 6 v3 por sí solo no publica las doce frases.

## RLS, ACL y recuperación

- Las 13 tablas privadas permanecen con RLS y sin acceso directo de `PUBLIC`,
  `anon`, `authenticated` o `service_role`.
- Las dependencias privadas permanecen sin `EXECUTE` para esos roles.
- La migración no crea funciones ni rutas administrativas, por lo que no abre
  una alternativa al guard AAL2.
- La recuperación no elimina filas. Invalida el centinela para bloquear pasos
  posteriores, reafirma RLS/ACL, revoca wrappers si existieran y mantiene
  `site-assets` privado.

## Pruebas no ejecutadas

- No se ejecutó PostgreSQL 17.11: esa es la versión conocida de producción y
  estaba expresamente prohibido conectarse.
- No se ejecutó concurrencia multisesión real del bloque 6: el entorno PGlite
  ofrece una sola sesión y no había un servidor PostgreSQL local activo. El
  riesgo específico está mitigado por `pg_advisory_xact_lock`, por las claves
  únicas existentes y por inserciones conservadoras, pero esta evidencia es
  estructural, no una carrera real observada.
- No se ejecutó Supabase CLI remoto, `db push --dry-run`, SQL Editor, Storage,
  Edge Functions, frontend ni Security Advisor de producción.

## Compatibilidad y riesgo residual

La migración v3 es compatible localmente con las funciones privadas y los
formatos de lectura futuros. Sin embargo, **7A-1 v2 no es instalable después de
6 v3 en su forma actual**, porque todavía exige el centinela
`cubica_stage_c:20261018171401`.

Por instrucción expresa no se modificaron 7A-1, 7A-2, 7A-3 ni 7B. Antes de
avanzar más allá del bloque 6 debe prepararse una versión nueva de 7A-1 que
exija `20261018171402`, recalcular sus hashes y repetir la integración cerrada
de 7A/7B. Esto no impide un preflight exclusivo de 6 v3, pero sí impide
autorizar en cadena los bloques posteriores con los archivos actuales.

## Recomendación

6 v3 está listo para solicitar un **preflight remoto exclusivo y de solo
lectura**, con directorio aislado, historial remoto recién conciliado, hash
exacto y exigencia de que el dry-run liste únicamente
`20261018171402_stage_c_safe_defaults_v3.sql`.

No se recomienda todavía autorizar 7A/7B. Producción permanece, según el último
estado conocido, con 40 migraciones y bloque 6 ausente; ese estado no fue
reconsultado durante esta preparación porque la conexión estaba prohibida.
