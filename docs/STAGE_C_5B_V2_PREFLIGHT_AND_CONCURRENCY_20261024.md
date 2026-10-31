# CÚBICA 3D — Etapa C, preflight 5B v2 y concurrencia

Fecha: 24 de octubre de 2026  
Alcance: consultas remotas de solo lectura, `db push --dry-run` y pruebas en PostgreSQL local aislado.  
Resultado: **preflight aprobado; 5B v2 no fue instalada. Se recomienda corregir dos detalles de replay/idempotencia antes de autorizar producción.**

## Artefacto revisado

- Archivo: `20261018171257_stage_c_suggestion_protection_private_functions_v2.sql`
- SHA-256 confirmado: `A90B2433C4CB0BB6CAA33BF269A650314FB62D95ABF62BDD65257168D0AA3129`
- Tamaño: 17.158 bytes.
- Centinela previsto: `cubica_stage_c:20261018171257`.
- 5B v1 permanece archivado fuera de `supabase/migrations`.
- La sonda usa las firmas completas de las dos funciones privadas.

## Estado remoto e historial

- Proyecto `cubica-web`: `ACTIVE_HEALTHY`.
- Región: `sa-east-1`.
- PostgreSQL de producción: 17.11 (`17.11.0.002`).
- Historial anterior y posterior al dry-run: **38 migraciones**.
- Historial recuperado: coincidencia completa entre las 38 versiones locales y remotas.
- Bloques 1, 2, 3A, 3B-1 v3, 3B-2 v2, 3C-1, 3C-2, 4A v2, 4B v2, 4C v2 y 5A v2 confirmados.
- 5B v2 ausente en producción.

El prompt mencionaba 12 tablas actuales de Etapa C. El esquema real contiene **11**:
`site_appearance_versions`, `site_assets`, `site_campaign_occurrences`,
`site_campaigns`, `site_welcome_phrases`, `site_content_pages`,
`site_content_versions`, `site_faq_items`, `site_suggestions`,
`suggestion_rate_limits` y `suggestion_token_uses`. Las once existen, tienen RLS
activo y no conceden permisos directos a `anon`, `authenticated` ni
`service_role`.

El bucket `site-assets` existe, continúa privado y no tiene políticas públicas.
Las funciones privadas de 5B v2 no existen todavía en producción.

## Resultado literal sanitizado del dry-run

```text
DRY RUN: migrations will *not* be pushed to the database.
Connecting to remote database...
Would push these migrations:
 • 20261018171257_stage_c_suggestion_protection_private_functions_v2.sql
{"upToDate":false,"dryRun":true,"migrations":["20261018171257_stage_c_suggestion_protection_private_functions_v2.sql"],"seeds":[],"roles":[],"message":"Finished supabase db push."}
EXIT_CODE=0
```

Marcadores finales:

```text
TLS_MODE=verify-full
CA_FILE=prod-ca-2021.crt
REMOTE_HISTORY=38_MATCHED
AUTHORIZED_FILE=20261018171257_stage_c_suggestion_protection_private_functions_v2.sql
SHA256=A90B2433C4CB0BB6CAA33BF269A650314FB62D95ABF62BDD65257168D0AA3129
PREFLIGHT_RESULT=PASS_ONLY_5B_V2
DATABASE_WRITE=NONE
```

Supabase CLI 2.121.0 se ejecutó contra Session Pooler IPv4 con TLS
`verify-full` y la CA oficial. La contraseña se recibió mediante entrada oculta,
se mantuvo solo en memoria durante el proceso y se eliminó al finalizar.

## Auditoría de 5B v2

La revisión confirmó:

- `blocked_until` persiste y los rechazos durante un bloqueo no extienden su fecha.
- Los contadores usan UPSERT atómico y un orden estable actor → red.
- Las ventanas vencidas se reinician y los límites son 5/h por usuario, 3/h por invitado y 20/h por red.
- La operación principal reúne token, límites, idempotencia y guardado en una transacción.
- Los fallos técnicos revierten conjuntamente sugerencia, token y contadores.
- Los identificadores se reciben como hashes de 64 caracteres; no se almacena IP en claro.
- Las funciones quedan en `private`, con `search_path=''` y sin `EXECUTE` para roles API.
- La validación cubre categorías, longitudes, texto vacío, HTML y esquemas peligrosos.
- El contenido idéntico del mismo actor se deduplica durante 24 horas.

La futura Edge Function debe derivar actor y red desde fuentes verificadas. La
clave de idempotencia aportada por el navegador no puede cambiar la identidad,
red ni payload asociados sin provocar conflicto.

## Pruebas multisesión reales

Entorno: PostgreSQL 17.11 portátil y temporal, accesible solo desde localhost,
sin datos ni credenciales productivas. Las conexiones fueron independientes y
se sincronizaron con barreras. Se configuraron `statement_timeout=8s` y
`lock_timeout=6s`.

### 5B v2 — 7/7 aprobadas

1. Inicialización simultánea del mismo contador: dos aceptadas, contador final 2.
2. Diez incrementos concurrentes: contador final 10, sin pérdidas.
3. Dos solicitudes con un solo cupo: exactamente una aceptada y una limitada; contador final 5.
4. Bloqueo simultáneo: ambas limitadas y fecha de bloqueo estable.
5. Mismo `request_id`: una única sugerencia y un único registro privado.
6. Fallos técnicos concurrentes: rollback completo, sin residuos.
7. Sin deadlocks, timeouts ni esperas indefinidas.

### Concurrencia acumulada 4A–5A — 10/10 aprobadas

- 4A: doble publicación y retiro de recurso frente a publicación.
- 4B: creación idempotente y dos cambios sobre la misma versión.
- 4C: eliminación de campaña frente a asociación de frase.
- 5A: doble publicación, FAQ duplicada, restauración frente a edición y eliminación frente a restauración.

No hubo deadlocks ni pérdida de datos en estas pruebas.

## Hallazgos residuales

1. Con dos llamadas concurrentes del mismo `request_id`, se conserva una sola
   sugerencia, pero la segunda puede responder `accepted + duplicate` en vez de
   `accepted + idempotent`. La seguridad de almacenamiento se conserva; el
   contrato de respuesta no refleja con precisión el reintento.
2. Una solicitud nueva que reutiliza un token y repite contenido idéntico puede
   resolverse por deduplicación antes de llegar a la comprobación SQL de replay.
   Siteverify debe rechazar el token antes de SQL, pero la defensa en profundidad
   y la auditoría SQL quedan incompletas en esa ruta.
3. Usuarios legítimos bajo una IP compartida comparten el cupo agregado de 20/h.
   Los usuarios autenticados mantienen además su cupo individual de 5/h. Si el
   actor invitado se deriva solo de la IP, todos los invitados de esa red
   compartirían en la práctica el límite de 3/h; la Edge debe añadir una señal
   secundaria normalizada y conservar el límite de red.
4. Debe normalizarse IPv6 a un prefijo estable para evitar evasión mediante
   rotación de direcciones dentro de la misma red.

## Turnstile y Edge Function

La Edge desplegada actualmente no es compatible con 5B v2: todavía llama a dos
RPC antiguas y resuelve Auth después de la protección. La integración futura debe:

1. verificar Siteverify en servidor: éxito, hostname, acción, antigüedad y uso único;
2. resolver el usuario real mediante Supabase Auth antes de calcular hashes;
3. tomar la red únicamente de cabeceras confiables de la plataforma;
4. usar dominios separados y HMAC-SHA-256 con `SUGGESTION_RATE_LIMIT_SALT`;
5. invocar un solo wrapper transaccional de 5B;
6. traducir `accepted`, `rate_limited`, `idempotency_conflict`, `token_replayed` y errores técnicos sin exponer hashes o contadores.

No se configuraron secretos, no se desplegó la Edge Function y no se realizó una
prueba Turnstile real en esta tarea.

## Compatibilidad posterior

| Componente | Estado | Acción requerida |
|---|---|---|
| 5C | Incompatible | Actualizar centinela/dependencia y retención. |
| 6 | Sin dependencia directa de 5B | Mantener bloqueado por dependencias anteriores. |
| 7A-1 / 7A-2 | Sin dependencia directa de 5B | Mantener ajustes de firmas previas. |
| 7A-3 | Incompatible | Reemplazar wrappers antiguos por uno único para v2/v3. |
| 7B | Incompatible | Conceder únicamente el wrapper final a `service_role`. |
| Edge `submit-suggestion` | Incompatible | Adoptar una sola operación y resolver Auth antes de hashes. |
| Frontend público | Compatible vía Edge | La Edge debe conservar el contrato visible. |
| Administración | Depende de 5C | Mantener MFA AAL2. |
| Sondas y rollback | Preparados para v2 | Regenerar hashes/centinelas si se crea v3. |

Los wrappers públicos posteriores deben usar grants explícitos mínimos; Supabase
anunció que las tablas y funciones nuevas dejarán de exponerse automáticamente a
la Data API a partir del 30 de octubre de 2026.

## Integridad comercial y Security Advisor

Conteos posteriores al dry-run:

- Productos: 16.
- Insumos: 36.
- Pedidos: 17.
- Movimientos de inventario: 11.
- Sugerencias: 0.
- Tokens de sugerencias: 0.
- Contadores de sugerencias: 0.

Security Advisor no agregó hallazgos por 5B. Permanecen hallazgos preexistentes:

- 8 avisos informativos por tablas privadas con RLS y sin políticas, configuración cerrada intencional.
- 1 advertencia por `track_public_event` ejecutable por `anon`.
- 17 advertencias por funciones `SECURITY DEFINER` ejecutables por autenticados; requieren revisión individual y varias corresponden a wrappers con controles internos.
- Protección de contraseñas filtradas deshabilitada.

## Recomendación

**No instalar todavía el archivo v2 actual.** Preparar una 5B v3 limitada a:

- volver a comprobar `request_id` después del advisory lock para identificar el reintento concurrente como idempotente;
- reservar/comprobar el token antes de devolver una deduplicación de contenido, sin consumir cupo ni duplicar sugerencias;
- repetir las siete pruebas multisesión y el preflight con un hash nuevo.

La migración v2 es segura frente a duplicación, pérdida de incrementos y rollback
parcial, pero estas correcciones mejoran la trazabilidad y hacen coincidir el
contrato SQL con la política de token de un solo uso.

## Confirmación de alcance

**No hubo escrituras en Supabase de producción.** No se instaló 5B v2, no se
ejecutó `db push` real, SQL Editor ni `migration repair`; tampoco se modificaron
RLS, Storage, secretos, Edge Functions, frontend, campañas ni datos comerciales.

