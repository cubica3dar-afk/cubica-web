# Etapa C — preflight del bloque 4A

> **Documento histórico.** La candidata `20261018171251` fue reemplazada antes
> de aplicarse. La candidata vigente y su validación local están documentadas en
> `STAGE_C_4A_V2_LOCAL_VALIDATION_20261021.md`.

Fecha: 2026-10-20 (America/Argentina/Buenos_Aires)

## Resultado del preflight

Archivo evaluado:

`20261018171251_stage_c_appearance_asset_admin_private_functions.sql`

SHA-256:

`5FA98396577D575CE9D8AAAABD91E96F484944BE7B6E04629D326B0CD7158E6C`

El hash coincide con el plan operativo. Supabase CLI 2.121.0 recuperó y
concilió las 34 migraciones remotas. El dry-run incluyó exclusivamente 4A:

```text
DRY RUN: migrations will *not* be pushed to the database.
Connecting to remote database...
Would push these migrations:
 • 20261018171251_stage_c_appearance_asset_admin_private_functions.sql
{"upToDate":false,"dryRun":true,"migrations":["20261018171251_stage_c_appearance_asset_admin_private_functions.sql"],"seeds":[],"roles":[],"message":"Finished supabase db push."}
EXIT_CODE=0

PREFLIGHT_RESULT=PASS_ONLY_4A
DATABASE_WRITE=NONE
```

La salida literal completa y sanitizada está en
`<workspace>/stage-c-4a-preflight-20261020/preflight-4a-results.txt`.

## Estado de producción

- Proyecto `ACTIVE_HEALTHY`, PostgreSQL 17.11.
- 34 migraciones remotas antes y después del preflight.
- Bloques 1, 2, 3A, 3B-1 v3, 3B-2 v2, 3C-1 y 3C-2 presentes.
- Centinelas y dependencias privadas verificados.
- 4A ausente: cero funciones objetivo y ningún registro de migración.
- Las 11 tablas de Etapa C tienen RLS y una política denegatoria cada una.
- Cero permisos directos para `anon`, `authenticated` y `service_role`.
- Bucket `site-assets` privado, límite de 8 MiB y cero políticas públicas.
- MFA administrativo continúa obligatorio.

## Funciones de 4A

| Función | Retorno | Escritura |
|---|---|---|
| `admin_save_site_appearance_draft(jsonb,integer)` | `jsonb` | Inserta o actualiza el borrador de apariencia |
| `admin_publish_site_appearance(integer)` | `jsonb` | Archiva la publicación vigente, crea otra y marca recursos públicos |
| `admin_reset_site_appearance_draft()` | `jsonb` | Reemplaza el borrador por la publicación vigente o valores predeterminados |
| `admin_restore_original_appearance_draft()` | `jsonb` | Reemplaza el borrador por la apariencia original |
| `admin_register_site_asset(text,text,text,text,bigint,integer,integer)` | `jsonb` | Inserta metadatos en `private.site_assets` |
| `admin_retire_site_asset(uuid)` | `void` | Marca un recurso como retirado si no está referenciado |

Todas son `SECURITY DEFINER`, usan `search_path=''`, llaman primero a
`private.stage_c_assert_admin()` y quedan sin `EXECUTE` para `PUBLIC`, `anon`,
`authenticated` y `service_role`. No se crean wrappers públicos en este bloque.

## Hallazgos

### 1. Publicación repetible con la misma versión — requiere corrección

`admin_publish_site_appearance` bloquea la fila de borrador y compara
`p_expected_version`, pero no consume, archiva ni incrementa esa versión al
publicar. Una segunda llamada, incluso después de esperar el mismo bloqueo,
vuelve a aceptar el mismo número, archiva la publicación recién creada e
inserta otra versión idéntica. Esto permite duplicados ante doble clic, replay o
reintento de red y afecta la integridad del historial publicado.

Recomendación: hacer la publicación idempotente para una versión de borrador,
por ejemplo registrando qué versión ya fue publicada o devolviendo la última
publicación cuando el mismo borrador ya fue aplicado.

### 2. Registro de recurso sin comprobar Storage — requiere corrección

`admin_register_site_asset` confía en los metadatos recibidos. Las constraints
impiden traversal y limitan path, MIME, tamaño y dimensiones, pero no verifican
que exista `storage.objects(bucket_id='site-assets', name=p_storage_path)`.
Tampoco comprueban que MIME coincida con la extensión ni que `kind` coincida
con el slot de apariencia utilizado.

La futura Edge Function sí inspecciona los bytes, genera una ruta aleatoria,
sube el objeto y elimina el archivo si falla el registro. Sin embargo, 7B
concede ejecución directa de la RPC administrativa a usuarios autenticados;
un administrador AAL2 podría saltarse la Edge Function y registrar metadatos
huérfanos. El validador de temas comprobaría solo la fila de `site_assets`, no
la existencia del objeto real.

Recomendación: validar existencia en el bucket dentro de la operación de
registro, comprobar extensión/MIME y validar que cada slot use el `kind`
esperado. Otra opción es no exponer la RPC de registro y permitir el alta
únicamente mediante la Edge Function.

### 3. Reset y restauración sin control de versión — riesgo moderado

Las funciones de reset y restauración no reciben `p_expected_version`. Dos
sesiones administrativas pueden sobrescribir el borrador más reciente sin
detectar el conflicto. La actualización sigue siendo atómica, pero no conserva
optimistic concurrency.

### 4. Retiro seguro con limitación menor

El retiro comprueba referencias en borradores/publicaciones y campañas antes de
marcar el recurso. La búsqueda usa `jsonb::text LIKE '%uuid%'`, por lo que puede
producir un falso positivo si el UUID aparece como texto no referencial. No
produce referencias colgantes, pero puede impedir un retiro legítimo.

## Pruebas previstas después de una versión corregida

1. Verificar firmas, centinela, `SECURITY DEFINER`, `search_path` y ACL.
2. AAL2 autorizado mediante una identidad QA real; AAL1, cliente y anónimo rechazados.
3. Crear y editar borrador con versión esperada; conflicto concurrente rechazado.
4. Publicar una vez y repetir la misma solicitud; no crear otra versión.
5. Reset/restauración con control de concurrencia.
6. Rechazar colores, textos, slots y UUID inválidos.
7. Rechazar recurso inexistente, retirado o con `kind` incorrecto.
8. Rechazar path, MIME, extensión, tamaño o dimensiones inconsistentes.
9. Registrar un objeto QA real aislado, utilizarlo y retirarlo sin referencias colgantes.
10. Confirmar que el borrador no cambia la experiencia pública.
11. Confirmar que publicar cambia solo la versión pública esperada.
12. Ejecutar fixtures SQL con `ROLLBACK`; probar Storage mediante un objeto QA separado y limpiarlo expresamente.

Los casos de identidad deben marcarse como no ejecutados si no existe una
identidad QA real AAL2. No se deben simular JWT ni modificar usuarios reales.

## Integridad

Los conteos comerciales antes y después permanecieron iguales: 17 productos,
4 categorías, 35 insumos, 2 recetas, 17 pedidos, 18 ítems de pedido, 11
movimientos, 4 presupuestos, 3 versiones, 5 comentarios, 5 reacciones y 4
likes. Las once tablas de Etapa C continúan vacías.

Security Advisor conserva exactamente los hallazgos previos. El único error de
PostgreSQL del intervalo fue una consulta de auditoría de solo lectura con una
firma dinámica mal formada; se corrigió y repitió sin cambios. No hubo fallos
de autenticación, desconexiones ni escrituras.

## Recomendación

No aplicar todavía 4A con el hash actual. Preparar una versión corregida con
identificador y SHA-256 nuevos, validar los escenarios anteriores y repetir el
preflight antes de solicitar una escritura en producción.
