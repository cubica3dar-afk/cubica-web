# CÚBICA 3D — Etapa C, preflight exclusivo de producción 5B v3

Fecha: 24 de octubre de 2026  
Alcance: consultas remotas de solo lectura, recuperación local del historial y
`db push --dry-run`.  
Resultado: **APROBADO. 5B v3 no fue instalada.**

## Candidata

- Archivo: `20261018171258_stage_c_suggestion_protection_private_functions_v3.sql`.
- SHA-256: `772DDB1E8835316F83A694457BBBF6DDE1AB8871AAAC174A8C368C24F06189BE`.
- El archivo copiado al directorio aislado coincide con el validado.
- 5B v1/pre-atómica y 5B v2 permanecen en `supabase/archive`; no fueron
  incorporadas al directorio aislado.
- 5C, 6, 7A-1/2/3 y 7B tampoco fueron incorporadas.
- La sonda vigente espera las dos firmas completas y el centinela
  `cubica_stage_c:20261018171258`.

## Proyecto e historial remoto

- Proyecto: `cubica-web`, estado `ACTIVE_HEALTHY`, región `sa-east-1`.
- PostgreSQL: 17.11 (`17.11.0.002`).
- Supabase CLI fijado: 2.121.0. La actualización 2.122.0 se dejó sin instalar
  para conservar el procedimiento previamente validado.
- Conexión: Session Pooler IPv4, puerto 5432, TLS `verify-full`, CA oficial
  validada por SHA-256 y hostname del pooler.
- `migration fetch`: 38 archivos recuperados.
- `migration list`: 38 versiones locales/remotas coincidentes antes y después
  del dry-run.
- Dependencias 1, 2, 3A, 3B-1 v3, 3B-2 v2, 3C-1, 3C-2, 4A v2, 4B v2, 4C v2
  y 5A v2 presentes, con sus centinelas y firmas esperados.
- 5B v3 permanece ausente en el historial, en el catálogo de funciones y como
  centinela remoto.
- No existen RPC públicas de Etapa C activadas prematuramente.

## Resultado literal sanitizado del dry-run

```text
DRY RUN: migrations will *not* be pushed to the database.
Connecting to remote database...
Would push these migrations:
 • 20261018171258_stage_c_suggestion_protection_private_functions_v3.sql
{"upToDate":false,"dryRun":true,"migrations":["20261018171258_stage_c_suggestion_protection_private_functions_v3.sql"],"seeds":[],"roles":[],"message":"Finished supabase db push."}
EXIT_CODE=0
```

Marcadores finales:

```text
CLI_VERSION=2.121.0
TLS_MODE=verify-full
REMOTE_HISTORY=38_MATCHED
AUTHORIZED_FILE=20261018171258_stage_c_suggestion_protection_private_functions_v3.sql
SHA256=772DDB1E8835316F83A694457BBBF6DDE1AB8871AAAC174A8C368C24F06189BE
PREFLIGHT_RESULT=PASS_ONLY_5B_V3
DATABASE_WRITE=NONE
SYSTEM32_CHANGE=NONE
```

## Inventario de tablas y explicación 11/12

El esquema tiene **11 tablas núcleo** creadas por los bloques 1 y 2:

1. `private.site_assets`
2. `private.site_appearance_versions`
3. `private.site_campaigns`
4. `private.site_campaign_occurrences`
5. `private.site_welcome_phrases`
6. `private.site_content_pages`
7. `private.site_content_versions`
8. `private.site_faq_items`
9. `private.site_suggestions`
10. `private.suggestion_token_uses`
11. `private.suggestion_rate_limits`

4B v2 agregó la tabla auxiliar número 12,
`private.site_campaign_idempotency`. Por eso “11” es correcto al contar el
esquema núcleo original y “12” es correcto al contar todas las tablas actuales
de Etapa C. No hay una tabla faltante.

Las 12 existen, tienen RLS activo, una política de denegación para roles API,
cero grants directos a `PUBLIC`, `anon`, `authenticated` o `service_role` y cero
filas. No se detectó ninguna discrepancia de seguridad.

## Seguridad y contrato de 5B v3

La revisión del SQL y las pruebas confirman:

- idempotencia por `request_id`; un reintento idéntico recupera el resultado sin
  incrementar límites;
- `idempotency_conflict` si cambian identidad, red o contenido;
- el reclamo del token sucede antes de deduplicar contenido, por lo que un token
  reutilizado no puede ocultarse como duplicado;
- deduplicación de contenido en una ventana de 24 horas;
- límites atómicos de 5/h para usuario, 3/h para invitado y 20/h por red;
- bloqueo persistente de una hora mediante `blocked_until`;
- protección, deduplicación y almacenamiento dentro de una sola función y una
  misma transacción;
- las excepciones técnicas revierten token, contadores y sugerencia;
- hashes separados de token, actor y red; el navegador no entrega valores de
  confianza para decidir identidad o límites;
- `private.submit_protected_suggestion(...)` es `SECURITY DEFINER` con
  `search_path=''`; el helper de límite es `SECURITY INVOKER`;
- el SQL revoca `EXECUTE` para `PUBLIC`, `anon`, `authenticated` y
  `service_role` antes de confirmar el centinela;
- las tablas permanecen privadas y bajo RLS.

Las nueve funciones privadas instaladas que actúan como dependencias conservan
`SECURITY DEFINER`, `search_path=''`, sus centinelas y cero `EXECUTE` para los
roles API. 5B v3 todavía no existe en producción, como corresponde a este
preflight.

## Compatibilidad posterior

Los hashes locales continúan coincidiendo:

| Componente | SHA-256 |
|---|---|
| 5C v2 | `5E7B13ADFDC2B9587FA86BEB4959F03426D2639515A97CE0992C8BFCF68F1EAF` |
| 6 v2 | `B8A9465685578F14A19632D31AAFD12E0BE0FC2AF57C80EC8FAD6DACEB1D493B` |
| 7A-1 v2 | `BCDC968676322FB9222F80892A5DD67C11DCA3E8259D4502F5EBDB493BDA21B1` |
| 7A-2 v2 | `885C94030C32D7C1FB12406A0BE2CF3573C85830898408AE69ABC82856B2E1F5` |
| 7A-3 v2 | `08392EBEC6C0CFAFC7C24B2C893326C315D2479A1BA9146680BC5201F5160C46` |
| 7B v2 | `0478B8DD5352E993156BBA18C3DDB6F8ED0E684605057EC5F0E14AB2098A4798` |
| Edge `submit-suggestion` | `E3889D56B66B1AED5494C05979E442E88172BE27EC0CC84CA8A1C828C3097606` |
| Frontend | `BEBA04EF63E057EBAC0662EA0C68469E6E42F68FBFC799CB97665813AC43AA5C` |

No se encontraron centinelas reemplazados en las migraciones activas. Las
referencias a firmas antiguas que permanecen en verificadores y rollbacks son
comprobaciones explícitas de ausencia o contención, no dependencias activas.

## Pruebas

- PostgreSQL 17.5 aislado: 20 aprobadas, 0 fallidas y 3 no ejecutadas.
- Edge contract simulado: 14/14 escenarios aprobados, sin llamadas a producción.
- Regresión general de Etapa C: 31/31 aprobadas.
- Las 11/11 pruebas multisesión reales anteriores en PostgreSQL 17.11 siguen
  siendo aplicables porque el SQL y su hash no cambiaron. No se repitieron contra
  producción durante este preflight.

Marcadas **NO EJECUTADAS** en esta fase:

- Siteverify real contra Cloudflare;
- token real válido, usado o expirado;
- hostname y action reales;
- error de red/reintento contra el servicio real;
- Edge Function desplegada con secretos productivos.

## Storage, integridad y Security Advisor

- `site-assets` existe, es privado, limita archivos a 8 MiB y acepta JPEG, PNG y
  WebP.
- No existen políticas públicas de Storage relacionadas con `site-assets`.
- Conteos anteriores y posteriores: 16 productos, 36 insumos, 17 pedidos y 11
  movimientos de inventario.
- Las 12 tablas de Etapa C siguen con cero filas.
- Security Advisor no produjo hallazgos nuevos relacionados con 5B v3.

Hallazgos preexistentes, sin cambios en este preflight:

- ocho avisos informativos `rls_enabled_no_policy` sobre tablas privadas que se
  mantienen cerradas sin grants de API;
- un aviso por `track_public_event` ejecutable por `anon` y 17 avisos sobre RPC
  `SECURITY DEFINER` ejecutables por autenticados; pertenecen a flujos existentes
  y no fueron modificados aquí;
- protección de contraseñas filtradas desactivada, ya documentada y dependiente
  de la configuración/plan de Auth.

Referencias de remediación:

- https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
- https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable
- https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
- https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

## Pruebas previstas después de una eventual instalación

En una autorización independiente deberán ejecutarse, preferentemente en
transacciones con `ROLLBACK` y sin llamadas externas:

1. historial, centinela, dos firmas y tipos de retorno;
2. ACL, `SECURITY DEFINER`/`INVOKER` y `search_path`;
3. reintento idempotente y conflicto de `request_id`;
4. token nuevo y replay;
5. límites usuario/invitado/red y persistencia del bloqueo;
6. deduplicación dentro y fuera de 24 horas;
7. fallo inducido y atomicidad sin residuos;
8. RLS, grants, Storage y ausencia de RPC pública;
9. conciliación comercial y Security Advisor.

La integración real de Cloudflare debe esperar al despliegue coordinado de la
Edge Function y sus secretos; no debe mezclarse con la prueba SQL transaccional.

## Riesgos residuales y recomendación

No se encontró un bloqueador para instalar exclusivamente 5B v3. Los riesgos
residuales son la integración real aún no ejecutada de Turnstile/Edge y los
hallazgos preexistentes del Security Advisor, ninguno introducido por esta
candidata.

La recomendación es autorizar, si Diego decide continuar, una única instalación
de 5B v3 mediante el mismo directorio aislado y Supabase CLI 2.121.0, seguida de
las verificaciones anteriores. No deben incorporarse 5C ni bloques posteriores
en esa ejecución.

## Confirmación de límites

Hubo **cero escrituras en producción**, cero migraciones aplicadas, cero cambios
de permisos/Storage, cero despliegues y **cero eliminaciones o modificaciones en
`C:\Windows\System32\supabase`**.

