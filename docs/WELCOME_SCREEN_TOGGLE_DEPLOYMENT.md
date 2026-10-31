# Interruptor de pantalla de bienvenida

## Estado del release

- La funcionalidad se prepara en una rama; no modifica producción.
- `stageCMode` permanece en `admin`.
- El valor inicial en base de datos es `false`: la tienda abre directamente en el catálogo.
- La preferencia es independiente del borrador de apariencia y no publica campañas, frases, páginas ni recursos.

## Migración requerida

Archivo: `supabase/migrations/20261031164756_welcome_screen_preference.sql`

SHA-256: `8B92A48E735B418608E7B972A19EBF9401D0558342AB43826C0FAF33A1A92A4D`

La migración agrega:

- una tabla privada singleton con RLS y sin permisos directos para roles de API;
- un lector público que devuelve únicamente `true` o `false`;
- lectura y escritura administrativa protegidas por `private.stage_c_assert_admin()`, que exige administrador con MFA AAL2;
- control de versión para rechazar guardados concurrentes u obsoletos.

## Orden de despliegue recomendado

1. Confirmar que producción mantiene la migración 7B v3 y el modo `admin`.
2. Reconstruir un directorio aislado con el historial remoto efectivo.
3. Ejecutar `supabase db push --dry-run --include-all` y exigir que aparezca solamente esta migración.
4. Con una autorización independiente, aplicar la migración una sola vez.
5. Ejecutar `supabase/verification/20261031164756_verify_welcome_screen_preference.sql` y comprobar el valor inicial `false`, RLS y ACL.
6. Recién después, fusionar y publicar el frontend de esta rama.
7. Verificar primero el ingreso directo; luego probar activado y desactivado con una sesión administrativa AAL2.

Si el frontend se publica antes que la migración o el lector falla, el comportamiento seguro es abrir directamente el catálogo.

## Contención

`supabase/rollback/20261031164756_welcome_screen_preference_safe_state.sql` cierra los RPC nuevos sin borrar la fila ni su auditoría. El frontend vuelve a su comportamiento seguro de ingreso directo. No debe ejecutarse sin autorización productiva específica.

