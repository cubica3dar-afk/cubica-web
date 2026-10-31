# Cúbica 3D — Runbook de activación controlada de Etapa C

Estado: **preparado, no ejecutado**. Este procedimiento presupone 44
migraciones remotas, 27 wrappers cerrados y `stageCMode: "off"`.

## 1. Condiciones y decisiones previas

1. Aprobar expresamente la política de retención propuesta en el informe final.
2. Confirmar una ventana de despliegue, responsable y plan de contención.
3. Tomar línea de base de migraciones, objetos, ACL, RLS, Storage y conteos
   comerciales. Guardar las definiciones actuales necesarias para recuperar.
4. Comprobar que 7B sigue ausente y que su SHA-256 continúa siendo
   `AD3FE8FDE86F4C3E5B28F9CD3C1220DC2FBB1295811E3D80584F6EE4F57C1AD8`.
5. Mantener `github-config.js` con `stageCMode: "off"` durante todo el backend.

## 2. Secretos y configuración

Configurar mediante Supabase Edge Secrets, sin copiarlos a archivos o logs:

- `TURNSTILE_SECRET_KEY`: secreto del widget autorizado para
  `cubica3d.ar`/`www.cubica3d.ar`.
- `SUGGESTION_RATE_LIMIT_SALT`: exactamente un valor base64url sin padding,
  generado a partir de 32 bytes aleatorios o más. Para 32 bytes el valor tiene
  43 caracteres. El worker decodifica el valor y rechaza cualquier cadena que
  no represente al menos 32 bytes; no reutilizar claves de Auth, Resend,
  PostgreSQL o Turnstile.

El runtime aporta `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEYS` y
`SUPABASE_SECRET_KEYS`. El código conserva compatibilidad con los nombres
heredados `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`; verificar solo su
presencia, nunca su valor. El frontend conserva únicamente la Site Key pública.
No hay secretos propios necesarios para `site-assets`.

En una estación aislada, generar el salt con un generador criptográfico y
convertir esos bytes a base64url sin `=`. Configurarlo directamente mediante
Edge Secrets. No guardarlo en `.env`, historial de terminal, documentación ni
capturas. Para pruebas automatizadas usar exclusivamente las credenciales de
prueba oficiales publicadas por Cloudflare y separadas por ambiente; nunca
promoverlas a producción.

## 3. Backend cerrado antes de 7B

1. Desplegar `site-assets` con verificación JWT del gateway habilitada.
2. Desplegar `submit-suggestion` permitiendo invitados en el gateway y dejando
   la validación efectiva al worker: origen, Turnstile, sesión opcional,
   hostname, action, antigüedad, idempotencia y rate limit.
3. Con los wrappers todavía cerrados, comprobar que ninguna función logra una
   escritura. Un 403/503 controlado es el resultado esperado.
4. No publicar aún el frontend ni activar el cron.

## 4. Activación SQL 7B

1. Ejecutar el preflight remoto y el dry-run en el directorio aislado. Debe
   aparecer solo `20261025120300_stage_c_api_storage_activation_v3.sql`.
2. Con autorización separada, aplicar 7B una sola vez.
3. Verificar inmediatamente historial, centinela, 3 lectores públicos,
   22 operaciones administrativas AAL2 y 2 rutas internas de `service_role`.
4. Confirmar 13 tablas privadas con RLS, cero grants directos indebidos,
   bucket `site-assets` privado y políticas de objetos limitadas a recursos
   publicados o administradores AAL2.
5. Ejecutar Security Advisor y conciliar la línea de base comercial.

Si la respuesta es ambigua, no reintentar: consultar historial, centinela,
funciones y ACL. Si 7B se aplicó pero la capa siguiente falla, mantener el
frontend en `off`; la contención no requiere borrar información.

## 5. Limpieza y prueba real

1. Revisar el SQL preparado en
   `supabase/activation/stage_c_suggestion_protection_cron.sql`.
2. Con autorización, programarlo y verificar un único job activo. El job llama
   directamente a la función privada como propietario de la programación; no
   guarda una clave `service_role` en SQL ni Vault.
3. Para desactivarlo, usar únicamente
   `supabase/rollback/stage_c_suggestion_protection_cron_off.sql`.
4. Validar Siteverify con un token real de acción `suggestion_submit`. La prueba
   integral actual crea una sugerencia; requiere autorización para un único
   registro QA, que luego debe cerrarse y eliminarse lógicamente conservando su
   auditoría. No presentar las simulaciones locales como prueba real.
5. Verificar que reusar el token falla y que reintentar el mismo `request_id`
   devuelve el mismo resultado sin duplicar.

Las claves de prueba de Cloudflare prueban integración aislada, no el widget de
producción. La validación real debe comprobar además `hostname`, `action`,
`challenge_ts`, uso único y reintento con el mismo `idempotency_key`.

## 6. Activación progresiva del frontend

1. Publicar primero `stageCMode: "admin"`. Probar administrador AAL2, subida
   privada, borradores, campañas, páginas, FAQ, frases y moderación. AAL1 y
   clientes deben ser rechazados.
2. Confirmar que los recursos no publicados no tienen lectura pública.
3. Cambiar a `stageCMode: "full"` únicamente después de aprobar la prueba real
   de Siteverify y los textos públicos definitivos.
4. Probar visitante, cliente, móvil (~390 px), escritorio (~1280 px), red
   interrumpida, Auth, recuperación, checkout, pedidos, inventario, Comunidad,
   Analytics y presupuestos.
5. Ante una regresión, volver `stageCMode` a `off`. Esto oculta Etapa C y evita
   sus RPC sin tocar la tienda, tablas o historial.

## 7. Cierre

Revisar logs sin tokens ni contactos, Security Advisor, residuos QA, conteos y
estado del cron. Registrar versiones de Edge Functions, commit frontend y hora
de activación. No activar campañas, páginas o frases ficticias.

Referencias oficiales revisadas:

- https://supabase.com/docs/guides/storage/security/access-control
- https://supabase.com/docs/guides/storage/buckets/fundamentals
- https://supabase.com/docs/guides/cron
- https://supabase.com/docs/guides/functions/schedule-functions
