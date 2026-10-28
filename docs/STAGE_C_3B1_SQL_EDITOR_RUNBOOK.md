# Etapa C 3B-1 — procedimiento de contingencia para SQL Editor

**No ejecutar sin autorización nueva.** Este documento prepara la alternativa
para la versión corregida; no modifica producción ni el historial.

## Condiciones de entrada

1. La prueba aislada debe haber concluido y el SQL debe estar validado en
   PostgreSQL 17.
2. El archivo candidato final debe ser
   `20261018171218_stage_c_active_campaign_private_function_v3.sql`, SHA-256
   `D8A1556A05387F6ACF674D3E3BBCFC1B313D9F5E044E64CC8059EBB6DF64184B`.
3. La sonda debe confirmar 1, 2 y 3A, ausencia de 3B-1, 11/11 RLS, bucket
   privado y ninguna sesión de migración activa.
4. Debe existir autorización separada para SQL Editor y para reconciliar el
   historial.

## Transacción propuesta

En SQL Editor se preparará un único lote con esta estructura:

```sql
begin;
set local lock_timeout = '5s';
set local statement_timeout = '55s';

-- preflight de dependencias, centinelas y ausencia del objeto
-- contenido completo del archivo aprobado de 3B-1 v3
-- verificación de función, comentario, firma, search_path, SECURITY DEFINER y ACL

commit;
```

Si cualquier sentencia falla, no intentar arreglarla en la misma sesión:
ejecutar `rollback`, confirmar ausencia del objeto y detenerse.

No se copiará el SQL desde mensajes o logs. Se generará el lote desde el archivo
local cuyo hash fue aprobado, para evitar diferencias de codificación o edición.

## Verificación inmediata

1. Ejecutar `stage_c_installation_status.sql`.
2. Ejecutar `20261018171218_verify.sql`.
3. Consultar `pg_proc` para firma, retorno, propietario, `prosecdef`,
   `provolatile`, `proconfig` y ACL.
4. Confirmar que `PUBLIC`, `anon`, `authenticated` y `service_role` no tengan
   `EXECUTE`.
5. Ejecutar Security Advisor.
6. Conciliar conteos comerciales y confirmar cero datos nuevos de Etapa C.

## Historial

SQL Editor no registra migraciones. No se insertará directamente en
`supabase_migrations.schema_migrations`.

Antes de aplicar 3B-1 v3 hay que capturar `supabase migration list` y reconciliar
el hecho de que 1, 2 y 3A tienen versiones efectivas administradas diferentes
de sus timestamps locales. Solo después se podrá autorizar una reparación con
el comando oficial:

```text
supabase migration repair <version_aprobada> --status applied
```

Ese comando solo marca el historial; no ejecuta SQL. La versión no debe elegirse
ni ejecutarse hasta tener el mapeo completo y una autorización específica.

## Rollback de 3B-1 v3

Como los bloques posteriores todavía no existen, una recuperación autorizada
podría revocar permisos y eliminar exclusivamente
`private.stage_c_active_campaign(timestamptz)`. No debe tocar tablas, datos,
3A, Storage ni migraciones anteriores. El rollback exacto se preparará contra
la versión finalmente aprobada.

