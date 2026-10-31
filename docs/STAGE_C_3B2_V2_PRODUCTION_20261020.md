# Etapa C — despliegue de 3B-2 v2 en producción

Fecha: 2026-10-20 (America/Argentina/Buenos_Aires)

## Resultado

Se aplicó exactamente una vez la migración autorizada:

- versión: `20261018171223`;
- nombre remoto: `stage_c_next_change_private_function_v2`;
- archivo: `20261018171223_stage_c_next_change_private_function_v2.sql`;
- SHA-256: `175A658DE73E7650EDA8084F1374F0C0A323728C94F922ACB30173D7862786C7`;
- Supabase CLI: `2.121.0`;
- conexión: Session Pooler IPv4 con TLS y contraseña ingresada de forma oculta.

El historial remoto pasó de 31 a 32 migraciones. No se utilizó SQL Editor ni
`migration repair`, y no se ejecutó otro bloque.

## Salida literal sanitizada

```text
PREWRITE_CHECK=PASS_ONLY_3B2_V2

===== db push real — ejecución única autorizada =====
Connecting to remote database...
Applying migration 20261018171223_stage_c_next_change_private_function_v2.sql...
{"upToDate":false,"dryRun":false,"migrations":["20261018171223_stage_c_next_change_private_function_v2.sql"],"seeds":[],"roles":[],"message":"Finished supabase db push."}
EXIT_CODE=0

PRODUCTION_RESULT=APPLIED_ONCE_3B2_V2
```

## Función y permisos

`private.stage_c_next_change(timestamptz)` quedó confirmada con:

- centinela `cubica_stage_c:20261018171223`;
- retorno `timestamp with time zone`;
- `LANGUAGE SQL`, `STABLE`, `SECURITY DEFINER`;
- `search_path=''`;
- cero `EXECUTE` para `PUBLIC`, `anon`, `authenticated` y `service_role`;
- cero función homónima expuesta en `public`;
- compatibilidad de invocación con
  `private.stage_c_active_campaign(timestamptz)`.

Las referencias usadas en ramas con joins están calificadas y las invocaciones
con datos transaccionales finalizaron sin errores de columna ambigua.

## Pruebas de calendario

Se ejecutaron aserciones dentro de una transacción finalizada con `ROLLBACK`:

- ausencia de campañas;
- campaña única y límites de inicio/fin;
- campaña anual que cruza diciembre y enero;
- conversión con zona horaria `America/Argentina/Buenos_Aires`;
- campaña anual del 29 de febrero activa en 2032;
- omisión en año no bisiesto;
- próxima ocurrencia válida en 2032 y 2036;
- campañas superpuestas y selección por prioridad;
- próximo límite temporal durante una superposición;
- ocurrencia `custom` y sus límites;
- compatibilidad entre `stage_c_next_change` y `stage_c_active_campaign`.

Resultado: `PASS_ALL_CALENDAR_ASSERTIONS_ROLLED_BACK`. Después del rollback
había cero campañas y cero ocurrencias persistentes.

## Seguridad e integridad

- Las 11 tablas de Etapa C conservan RLS activa y cero permisos directos para
  roles de API.
- El bucket `site-assets` continúa privado y sin políticas públicas de Etapa C.
- Todas las tablas de Etapa C permanecen vacías.
- No quedaron registros QA ni sesiones de migración activas.
- Los logs registran una creación de la función, un centinela y cero errores en
  el intervalo del despliegue.
- Security Advisor no incorporó hallazgos de Etapa C; conserva exactamente la
  línea de base previa.

Conteos comerciales antes y después: 17 productos, 4 categorías, 35 insumos,
2 recetas, 17 pedidos, 18 artículos, 11 movimientos, 4 presupuestos, 3 versiones
de presupuestos, 5 comentarios, 5 reacciones y 4 likes.

## Estado detenido

3C-1 y todos los bloques posteriores siguen pendientes. No se configuraron
secretos, no se desplegaron Edge Functions ni frontend, no se activaron
campañas y no se inició Etapa D.
