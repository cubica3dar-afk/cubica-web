# CÚBICA 3D — Compatibilidad de 5B v3 y limpieza segura

Fecha: 2026-10-24. Alcance ejecutado exclusivamente de forma local.

## Resultado

La cadena futura de Etapa C quedó preparada para el contrato atómico de 5B v3.
No hubo conexión con Supabase de producción, `db push`, SQL Editor, `migration
repair`, despliegue de Edge Functions, publicación de frontend, configuración de
secretos ni eliminación de archivos de System32.

El SQL autorizado de 5B v3 no cambió y conserva el SHA-256
`772DDB1E8835316F83A694457BBBF6DDE1AB8871AAAC174A8C368C24F06189BE`.

## Archivos preparados o modificados

Migraciones futuras nuevas:

- `20261018171304_stage_c_suggestion_admin_private_functions_v2.sql`
- `20261018171401_stage_c_safe_defaults_v2.sql`
- `20261018171507_stage_c_public_appearance_wrappers_closed_v2.sql`
- `20261018171508_stage_c_campaign_content_wrappers_closed_v2.sql`
- `20261018171515_stage_c_suggestion_wrappers_closed_v2.sql`
- `20261018171516_stage_c_api_storage_activation_v2.sql`

Integración y pruebas:

- `supabase/functions/submit-suggestion/worker.js`
- `js/site-experience.js`
- `tests/stage-c-5b-v3-edge-contract.test.mjs`
- `tests/stage-c-5b-v3-postgres17.test.mjs`
- `tests/site-configuration-stage-c.test.mjs`
- `package.json`

Verificadores, contención y documentación:

- verificadores `171304`, `171401`, `171507`, `171508`, `171515`, `171516`;
- `supabase/verification/stage_c_installation_status.sql`;
- rollbacks seguros `171304`, `171515` y contención general `171500`;
- `docs/STAGE_C_SPLIT_DEPLOYMENT_PLAN.md` y `docs/STAGE_C_RECOVERY.md`.

Limpieza segura:

- `tools/cleanup-accidental-system32-supabase-safe.ps1`;
- `tools/system32-supabase-cleanup-manifest-20261024.json`;
- `outputs/system32-supabase-cleanup-simulation-20261024.txt`.

Las versiones futuras `171303`, `171400`, `171511`, `171512`, `171513` y
`171514`, junto con sus verificadores, fueron movidas a `supabase/archive`. No
estaban instaladas y no deben incluirse en un futuro directorio de despliegue.

## Contratos definitivos

La Edge Function ahora:

1. valida origen HTTP y tamaño de entrada;
2. exige una dirección de red válida proveniente de cabeceras confiables del
   proxy;
3. resuelve la sesión antes de derivar la identidad; un bearer inválido no se
   degrada a invitado;
4. deriva hashes separados para token, red y actor, sin exponer sal ni valores;
5. envía a Siteverify una clave UUID determinista distinta del `request_id`;
6. valida éxito, hostname, action y antigüedad del desafío;
7. reintenta una sola vez únicamente un fallo técnico de Siteverify con la misma
   clave idempotente;
8. llama una sola vez a
   `public.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)`;
9. distingue `accepted`, reintento idempotente, contenido duplicado,
   `idempotency_conflict`, `token_replayed`, `rate_limited` y error técnico.

El frontend conserva el mismo `request_id` tras un fallo legítimo, lo rota tras
éxito o edición y evita dobles envíos simultáneos. Las operaciones administrativas
de apariencia y campañas pasan las revisiones esperadas y claves idempotentes
requeridas por 4A v2 y 4B v2.

## Compatibilidad SQL y seguridad

- 5C v2 exige el centinela de 5B v3, conserva AAL2 y limpia tokens al vencer
  `expires_at`; los límites antiguos se limpian por `updated_at`.
- 6 v2 exige los centinelas definitivos de 4A v2, 4B v2, 4C v2, 5A v2, 5B v3
  y 5C v2. No publica campañas, FAQ, legales ni apariencia.
- 7A-1 v2 conserva el control optimista de apariencia.
- 7A-2 v2 conserva las claves idempotentes de campañas y agrega los wrappers de
  listar/restaurar FAQ.
- 7A-3 v2 elimina las dos firmas antiguas de sugerencias y crea cuatro wrappers,
  incluido el nuevo RPC atómico.
- Los 25 wrappers quedan sin `EXECUTE` para roles de API hasta 7B v2.
- 7B v2 concede el RPC de sugerencias solo a `service_role`, las lecturas
  públicas solo a `anon`/`authenticated` y la administración solo a
  `authenticated`; los guards privados siguen exigiendo MFA AAL2.
- Las once tablas permanecen bajo RLS y `site-assets` continúa privado hasta la
  activación final.

## SHA-256 de migraciones futuras

| Bloque | Archivo | SHA-256 |
|---|---|---|
| 5C v2 | `20261018171304...sql` | `5E7B13ADFDC2B9587FA86BEB4959F03426D2639515A97CE0992C8BFCF68F1EAF` |
| 6 v2 | `20261018171401...sql` | `B8A9465685578F14A19632D31AAFD12E0BE0FC2AF57C80EC8FAD6DACEB1D493B` |
| 7A-1 v2 | `20261018171507...sql` | `BCDC968676322FB9222F80892A5DD67C11DCA3E8259D4502F5EBDB493BDA21B1` |
| 7A-2 v2 | `20261018171508...sql` | `885C94030C32D7C1FB12406A0BE2CF3573C85830898408AE69ABC82856B2E1F5` |
| 7A-3 v2 | `20261018171515...sql` | `08392EBEC6C0CFAFC7C24B2C893326C315D2479A1BA9146680BC5201F5160C46` |
| 7B v2 | `20261018171516...sql` | `0478B8DD5352E993156BBA18C3DDB6F8ED0E684605057EC5F0E14AB2098A4798` |

## Pruebas

- Regresión completa: 12/12 archivos de prueba aprobados.
- Etapa C estática/contratos/UI: 31/31 comprobaciones.
- PostgreSQL 17.5 aislado: 20 aprobadas, 0 fallidas; 5C y los 25 wrappers se
  aplicaron dentro de transacción y terminaron en `ROLLBACK`, sin residuos.
- Edge contract local: 14 escenarios, incluyendo invitado, autenticado, sesión
  inválida, idempotencia, conflicto, replay, duplicado, rate limit, fallos de
  Siteverify, ausencia de red y error de base. No hubo llamadas a pedidos.
- La concurrencia real de 5B v3 ya había aprobado 11/11 en PostgreSQL 17.11 y su
  SQL no cambió. En esta preparación no se repitió: el servidor multisesión y el
  paquete `pg` no estaban disponibles. No se presenta PGlite como prueba de
  concurrencia real.
- La integración real con Cloudflare/Siteverify y una Edge Function desplegada
  no se ejecutó porque este alcance prohíbe producción. Las pruebas de esta fase
  son contractuales y simuladas, no sustituyen ese preflight real.

## Limpieza segura de System32

El nuevo script acepta exclusivamente `C:\Windows\System32\supabase`, rechaza
reparse points, exige exactamente `.temp` y `migrations`, verifica los 39 paths,
tamaños y SHA-256 y falla ante cualquier archivo adicional. El modo de ejecución
requeriría simultáneamente `-Execute` y una frase exacta; vuelve a verificar cada
archivo inmediatamente antes de eliminarlo, usa rutas literales y nunca usa
borrado recursivo.

- Script: SHA-256
  `D124CAA3FD68D6F8CA47B7D99B1CEC135F70EE50CBA5AE91C84240CBC70B5BDA`.
- Manifiesto: SHA-256
  `6AA0220A9238C0C43EE424D24582A2318A8079560024A1A05455C6ED0924FA1D`.
- Se validó la resolución automática del manifiesto con Windows PowerShell; la
  ejecución predeterminada continúa siendo únicamente de simulación.

La simulación real de solo lectura devolvió:

`SIMULATION_ONLY VERIFIED_FILES=39 TARGET=C:\Windows\System32\supabase`

También se comprobó que otro objetivo es rechazado. El directorio continúa
existiendo y se eliminaron cero archivos. La copia de referencia tenía 40
archivos porque contiene además 5B v2; por seguridad, el manifiesto aprobado se
construyó sobre los 39 archivos reales auditados del objetivo y no autorizó ese
archivo adicional inexistente.

## Riesgos y próximo paso recomendado

Quedan pendientes la integración real de Turnstile, el preflight individual de
cada migración futura y la validación final contra PostgreSQL 17.11 de
producción. Ninguna de esas pendientes habilita un despliegue automático.

Próximo paso recomendado: autorizar por separado un preflight de solo lectura
de 5B v3 con CLI, historia remota conciliada y dry-run que muestre una única
migración. Después de instalar y verificar 5B v3, continuar de a un bloque con
5C v2, 6 v2, 7A-1 v2, 7A-2 v2, 7A-3 v2 y por último 7B v2. La limpieza real de
System32 requiere otra autorización independiente y nunca debe combinarse con
el despliegue de Supabase.
