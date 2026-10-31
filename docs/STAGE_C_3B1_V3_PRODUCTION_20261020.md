# Etapa C — despliegue de 3B-1 v3 en producción

Fecha: 2026-10-20 (America/Argentina/Buenos_Aires)

## Resultado

Se aplicó exactamente una vez la migración autorizada:

- versión: `20261018171218`;
- nombre remoto: `stage_c_active_campaign_private_function_v3`;
- archivo: `20261018171218_stage_c_active_campaign_private_function_v3.sql`;
- SHA-256: `D8A1556A05387F6ACF674D3E3BBCFC1B313D9F5E044E64CC8059EBB6DF64184B`;
- Supabase CLI: `2.121.0`;
- conexión: Session Pooler IPv4 con TLS y contraseña ingresada de forma oculta.

No se ejecutó `migration repair`, SQL Editor, otra migración, Edge Functions,
frontend, campañas ni escrituras comerciales.

## Salida literal sanitizada

```text
PREWRITE_CHECK=PASS_ONLY_3B1_V3

===== db push real — ejecución única autorizada =====
Connecting to remote database...
Applying migration 20261018171218_stage_c_active_campaign_private_function_v3.sql...
{"upToDate":false,"dryRun":false,"migrations":["20261018171218_stage_c_active_campaign_private_function_v3.sql"],"seeds":[],"roles":[],"message":"Finished supabase db push."}
EXIT_CODE=0

PRODUCTION_RESULT=APPLIED_ONCE_3B1_V3
```

El historial remoto pasó de 30 a 31 migraciones. `migration list` confirmó la
correspondencia local/remota de `20261018171218` y la API de administración de
Supabase devolvió el mismo nombre y versión.

## Sonda de función

`private.stage_c_active_campaign(timestamptz)` quedó confirmada con:

- centinela `cubica_stage_c:20261018171218`;
- retorno `private.site_campaigns`;
- exactamente 26 campos, en el orden y tipos de la tabla compuesta;
- `LANGUAGE SQL`, `STABLE`, `SECURITY DEFINER`;
- `search_path=''`;
- cero `EXECUTE` para `PUBLIC`, `anon`, `authenticated` y `service_role`;
- cero función homónima en `public`;
- invocación de solo lectura sin campañas: resultado nulo esperado.

El guard existente `private.stage_c_assert_admin()` conserva el centinela de
3A, `SECURITY DEFINER`, `search_path=''`, comprobación AAL2 y permisos de
ejecución cerrados para los roles de API.

## RLS, Storage e integridad

- Las 11 tablas de Etapa C existen y mantienen RLS activa.
- Ninguna concede acceso directo a `anon`, `authenticated` o `service_role`.
- Todas continúan vacías; no quedaron registros QA.
- El bucket `site-assets` continúa privado, con límite de 8 MiB y sin políticas
  públicas de Etapa C.
- No había sesiones de migración activas al finalizar.

Conteos comerciales antes y después:

| Entidad | Antes | Después |
|---|---:|---:|
| Productos | 17 | 17 |
| Categorías | 4 | 4 |
| Insumos | 35 | 35 |
| Recetas | 2 | 2 |
| Pedidos | 17 | 17 |
| Artículos de pedidos | 18 | 18 |
| Movimientos de inventario | 11 | 11 |
| Presupuestos | 4 | 4 |
| Versiones de presupuestos | 3 | 3 |
| Comentarios | 5 | 5 |
| Reacciones de productos | 5 | 5 |
| Likes de comentarios | 4 | 4 |

## Logs y Security Advisor

Los logs del intervalo muestran una sola creación de la función y la aplicación
inmediata de su centinela. No se observaron errores de PostgreSQL asociados.

Security Advisor no añadió hallazgos de Etapa C. Conserva la línea de base ya
documentada: ocho avisos informativos de tablas privadas con RLS sin políticas,
una advertencia para `track_public_event`, diecisiete advertencias sobre RPC
`SECURITY DEFINER` autenticadas existentes y la protección contra contraseñas
filtradas desactivada. Ninguno fue introducido por 3B-1 v3.

## Estado detenido

3B-2 v2 y todos los bloques posteriores siguen pendientes. No se configuraron
secretos, no se desplegaron Edge Functions ni frontend y no se inició Etapa D.
