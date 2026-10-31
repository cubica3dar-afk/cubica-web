# Cúbica 3D — paquete final local de Etapa C

Fecha: 2026-10-28  
Rama: `release/stage-c-final`  
Base oficial: `origin/main` en `27b5d99e44f4071a8420e104efe959a597cc529f`  
Estado: **preparado localmente; no desplegado**

## Alcance integrado

- Dieciocho migraciones finales de Etapa C, incluidas las diecisiete ya
  registradas en producción y 7B v3 todavía sin instalar.
- Verificaciones, rollbacks seguros, archivos históricos requeridos por las
  pruebas aisladas y documentación operativa.
- Dos Edge Functions: `site-assets` y `submit-suggestion`.
- Frontend con `stageCMode` cerrado por defecto y modos progresivos `admin` y
  `full`.
- Vista previa de retención de solo lectura y cron de hashes temporales
  preparado, no programado.

Se excluyeron credenciales, `.env`, `.temp`, `node_modules`, capturas y
resultados productivos, artefactos temporales y herramientas de limpieza de
System32.

## Edge Functions

| Función | Gateway | Validación propia | Estado |
|---|---|---|---|
| `site-assets` | JWT obligatorio | usuario real + RPC administrativo AAL2 antes de Storage | lista local, no desplegada |
| `submit-suggestion` | JWT no obligatorio | origen, sesión opcional, Turnstile, hostname, action, antigüedad, idempotencia y rate limit | lista local, no desplegada |

Los puntos de entrada están declarados en `supabase/config.toml`. Los workers
aceptan los mapas actuales de claves administradas por Supabase y conservan
compatibilidad con los nombres heredados. Ninguna clave de servidor forma parte
del bundle del navegador.

Los reintentos de Siteverify reutilizan un `idempotency_key` determinista. Los
reintentos de negocio conservan `request_id`: si se pierde la respuesta después
de un commit, un token nuevo reconcilia el resultado ya guardado sin crear otra
sugerencia. En `site-assets`, una respuesta de registro ambigua conserva el
objeto y permite reconciliarlo; no ejecuta un borrado destructivo incierto.

## Configuración y secretos requeridos

Secretos propios que deben configurarse únicamente en Supabase Edge Secrets:

1. `TURNSTILE_SECRET_KEY`.
2. `SUGGESTION_RATE_LIMIT_SALT`.

El salt debe generarse con un CSPRNG a partir de **32 bytes o más**, codificarse
como base64url sin padding y no reutilizar ninguna otra credencial. El worker
decodifica el valor y se niega a operar si contiene menos de 32 bytes.

Valores administrados por el runtime, que solo deben verificarse por presencia:

- `SUPABASE_URL`.
- `SUPABASE_PUBLISHABLE_KEYS`.
- `SUPABASE_SECRET_KEYS`.

Los nombres heredados `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` siguen
admitidos como compatibilidad. La Site Key de Turnstile es pública y permanece
en `github-config.js`; el secreto nunca debe incorporarse allí.

Las credenciales de prueba oficiales de Turnstile se permiten solo en un
ambiente aislado y deben seleccionarse desde la documentación oficial. Nunca
deben mezclarse con la configuración productiva. La prueba real de Siteverify
con `cubica3d.ar`, acción `suggestion_submit`, uso único y expiración continúa
pendiente de autorización.

## Retención propuesta — pendiente de aprobación legal y operativa

Definiciones:

- `resolved` y `dismissed` son estados terminales. La fecha de cierre es la
  última transición del estado vigente a uno de esos estados; para históricos
  sin transición registrada, `updated_at` es solo una estimación y exige
  revisión humana.
- Estados abiertos: `new`, `reviewing` y `accepted`.
- Contacto: anonimizar al primero de **90 días desde el cierre** o **365 días
  desde la recepción**. Una solicitud todavía abierta alcanza igualmente el
  límite ordinario de 365 días.
- Notas privadas: vaciar al primero de **180 días desde el cierre** o **730 días
  desde la recepción**. Una solicitud abierta alcanza igualmente el límite de
  730 días.
- Sugerencia eliminada lógicamente: anonimizar asunto, descripción, contacto y
  vínculo de usuario a los 365 días de `deleted_at`, preservando identidad
  técnica, categoría, estados, fechas, revisiones y auditoría mínima.
- Auditoría administrativa: conservar como mínimo cinco años desde
  `occurred_at`. No existe una eliminación automática preparada; al finalizar
  el plazo debe revisarse si corresponde conservar, archivar o seudonimizar.

Excepciones que deben existir antes de automatizar datos personales:

- retención legal, fraude, disputa o solicitud de autoridad;
- atención activa que Diego decida prolongar expresamente;
- respaldo cifrado con acceso restringido y vencimiento documentado;
- exclusión absoluta de pedidos, compradores, presupuestos, inventario y sus
  auditorías comerciales.

El modelo actual no contiene un indicador de retención excepcional. Por eso no
se propone todavía una tarea destructiva. La consulta
`stage_c_suggestion_retention_preview.sql` solo cuenta candidatos y distingue
casos abiertos y cierres estimados. Una implementación futura deberá agregar
un mecanismo de hold aprobado, trabajar en lotes idempotentes, registrar solo
IDs técnicos y conteos, no valores personales, y validar referencias antes de
cada commit.

## Cron

`stage_c_suggestion_protection_cron.sql` está preparado para purgar únicamente
hashes temporales vencidos. No elimina sugerencias, contactos, notas ni
auditoría. Estado de este release: **no programado**. Su rollback de
desprogramación está versionado.

## Matriz de salida

| Control | Estado |
|---|---|
| Migraciones y hash de 7B | APROBADO local; 7B sin instalar |
| Contratos SQL/RLS/AAL2 de 7A/7B | APROBADO en PostgreSQL aislado |
| Edge Functions y auth explícita | APROBADO local |
| Salt base64url de 32 bytes reales | APROBADO local |
| `stageCMode=off` sin RPC nuevos | APROBADO local |
| `admin` visible solo a admin AAL2 | APROBADO local; integración real pendiente |
| `full` y contenido publicado | APROBADO local; integración real pendiente |
| Turnstile/Siteverify productivo | PENDIENTE |
| Edge Runtime, Storage y API Gateway reales | PENDIENTE |
| Política de retención | PENDIENTE de aprobación |
| Cron productivo | INACTIVO |
| Móvil y escritorio desplegados | PENDIENTE de smoke real |

## Activación propuesta

1. Aprobar retención y ventana de cambio; tomar línea base y respaldos.
2. Mantener `stageCMode: "off"`.
3. Configurar los dos secretos propios y comprobar únicamente su presencia.
4. Desplegar `site-assets` y `submit-suggestion`; validar que, con 7B aún
   cerrada, no puedan completar operaciones.
5. Ejecutar preflight/dry-run exclusivo de 7B, verificar su hash aprobado y,
   con autorización independiente, instalarla una sola vez.
6. Verificar 3 lectores públicos, 22 operaciones administrativas AAL2, 2 rutas
   internas, RLS, Storage y Security Advisor.
7. Activar `stageCMode: "admin"`; probar AAL2, AAL1, cliente e invitado.
8. Autorizar y ejecutar una única sugerencia QA con Siteverify real; comprobar
   uso único, expiración e idempotencia y cerrar el registro con trazabilidad.
9. Aprobar textos y recursos publicados; recién entonces cambiar a `full`.
10. Autorizar por separado el cron de hashes temporales.

## Contención

- Fallo de frontend o integración: volver a `stageCMode: "off"`; la tienda
  permanece operativa y deja de invocar los wrappers nuevos.
- Fallo de Edge: mantener `off`, retirar el despliegue afectado y no instalar
  permisos adicionales.
- Respuesta ambigua de migración: no reintentar; consultar historial, centinela
  y ACL.
- Regresión de 7B: no borrar tablas ni datos; mantener frontend `off` y aplicar
  solo el plan de recuperación previamente revisado y autorizado.

## Bloqueadores antes de la primera acción productiva

1. Revisión del commit local y autorización de push/merge, todavía ausente.
2. Aprobación de la política de retención.
3. Configuración segura de los dos secretos propios.
4. Despliegue controlado y prueba real de ambas Edge Functions.
5. Autorización separada para 7B.

Primera acción recomendada: revisar este commit y autorizar su publicación en
una rama remota de revisión; no instalar 7B ni cambiar `stageCMode` todavía.

Referencias vigentes verificadas:

- https://supabase.com/docs/guides/functions/function-configuration
- https://supabase.com/docs/guides/functions/secrets
- https://developers.cloudflare.com/turnstile/troubleshooting/testing/
- https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

`DATABASE_WRITE=NONE`  
`PRODUCTION_CONNECTIONS=0`  
`DEPLOYMENTS=0`  
`SECRETS_CONFIGURED=0`
