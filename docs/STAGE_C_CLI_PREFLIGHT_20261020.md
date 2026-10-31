# Etapa C — informe de preflight con Supabase CLI

Fecha: 2026-10-20. Alcance: lectura y simulación; ninguna escritura en
producción.

## Herramienta y conexión

- Supabase CLI `2.121.0`, instalado con versión fijada.
- Directorio aislado:
  `<workspace>/stage-c-cli-preflight-20261019`.
- Proyecto: `mymrbpwvghxmqqpzzdqk`.
- Session Pooler de `sa-east-1`, puerto 5432, compatible con IPv4.
- Contraseña ingresada mediante `Read-Host -AsSecureString`, pasada al proceso
  exclusivamente como `PGPASSWORD` temporal y eliminada al finalizar.
- TLS forzado con `PGSSLMODE=require`.
- No se guardó ni imprimió la contraseña y la URL usada por el CLI no la
  contenía.

## Historial

`migration fetch` respondió `Migration history fetched` y creó 30 archivos.
El manifiesto recuperado coincidió exactamente con la lectura remota fresca.

`migration list` confirmó 30 pares local/remoto idénticos antes de agregar la
migración pendiente. En particular:

- bloque 1: `20261018213838_stage_c_20261018171000_visual_schema.sql`;
- bloque 2: `20261018213927_stage_c_20261018171100_content_suggestion_schema.sql`;
- bloque 3A: `20261019015434_stage_c_20261018171210_visual_validators_private_functions.sql`.

Después se agregó únicamente
`20261018171218_stage_c_active_campaign_private_function_v3.sql`; el segundo
`migration list` la mostró con versión local `20261018171218` y versión remota
vacía.

SHA-256 comprobado:
`D8A1556A05387F6ACF674D3E3BBCFC1B313D9F5E044E64CC8059EBB6DF64184B`.

## Dry-run literal sanitizado

```text
DRY RUN: migrations will *not* be pushed to the database.
Connecting to remote database...
Would push these migrations:
 • 20261018171218_stage_c_active_campaign_private_function_v3.sql
{"upToDate":false,"dryRun":true,"migrations":["20261018171218_stage_c_active_campaign_private_function_v3.sql"],"seeds":[],"roles":[],"message":"Finished supabase db push."}
```

Resultado automatizado: `PREFLIGHT_RESULT=PASS_ONLY_3B1_V3`.

## Producción después del dry-run

- Historial remoto sin cambios: 30 migraciones y solo 1, 2 y 3A de Etapa C.
- `stage_c_active_campaign` y `stage_c_next_change` ausentes.
- 11 tablas de Etapa C presentes; RLS activo en las 11.
- Sin permisos directos para roles de API.
- Cero filas de Etapa C.
- Bucket `site-assets` privado y sin políticas públicas de Etapa C.
- Sin sesiones de migración pendientes.
- PostgreSQL 17.11.

Conteos comerciales frescos: 17 productos, 4 categorías, 35 insumos, 2
recetas, 17 pedidos, 18 artículos, 11 movimientos, 4 presupuestos, 3 versiones
de presupuesto, 5 comentarios, 5 reacciones y 4 likes de comentarios.

No se ejecutó `db push` real, SQL Editor, `migration repair`, Edge Functions ni
despliegue de frontend.
