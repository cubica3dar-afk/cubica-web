# Etapa C — Intento de despliegue detenido

> Seguimiento: se eligió preparar una instalación dividida. El análisis y la
> secuencia vigente están en `docs/STAGE_C_SPLIT_DEPLOYMENT_PLAN.md`; este
> documento conserva la evidencia histórica de los dos intentos fallidos.

Fecha: 2026-10-18  
Proyecto Supabase: `mymrbpwvghxmqqpzzdqk`

## Resultado

El despliegue fue detenido antes de configurar secretos, desplegar Edge
Functions o publicar el frontend.

La migración
`20261018170000_site_configuration_stage_c.sql`, con SHA-256
`561BC72B285C1AACC56F395100C2D0F0C6D4E1080F935539A6488874B1910795`,
fue enviada dos veces mediante la operación transaccional de migraciones de
Supabase. Ambas llamadas terminaron con `Connection terminated unexpectedly`.

Los registros de PostgreSQL muestran que cada ejecución comenzó correctamente,
creó las once tablas dentro de la transacción y ejecutó el trigger existente
`public.rls_auto_enable()` con SQLSTATE `00000`. No registran un error SQL
de sintaxis o constraint antes de que la conexión de administración terminara.
La causa exacta de la desconexión no quedó expuesta por el servicio.

Después de cada fallo se comprobó que PostgreSQL revirtió la transacción:

- La migración no aparece en `supabase_migrations.schema_migrations`.
- No existen `private.site_assets` ni `private.site_campaigns`.
- No existe `public.get_site_experience()`.
- No existe el bucket `site-assets`.
- No quedan sesiones de las dos ejecuciones en `pg_stat_activity`.

No fue necesario ejecutar el rollback porque no quedó ningún objeto de Etapa C.

## Conciliación comercial

Los conteos posteriores coinciden exactamente con la línea de base:

| Entidad | Antes | Después |
|---|---:|---:|
| Productos | 17 | 17 |
| Categorías de producto | 4 | 4 |
| Insumos | 35 | 35 |
| Recetas | 2 | 2 |
| Pedidos | 15 | 15 |
| Artículos de pedido | 16 | 16 |
| Movimientos de inventario | 9 | 9 |
| Presupuestos | 4 | 4 |
| Versiones de presupuesto | 3 | 3 |
| Comentarios de Comunidad | 5 | 5 |
| Reacciones de productos | 4 | 4 |
| Likes de comentarios | 3 | 3 |

## Acciones no realizadas

- No se configuró `SUGGESTION_RATE_LIMIT_SALT`.
- No se desplegaron `site-assets` ni `submit-suggestion`.
- No se ejecutaron pruebas QA SQL, porque su esquema no llegó a instalarse.
- No se modificaron las Edge Functions existentes.
- No se publicaron archivos ni commits en GitHub.
- GitHub Pages continúa sirviendo la Etapa B.
- No se enviaron correos, no se crearon pedidos y no se modificó inventario.

La revisión posterior de Security Advisor coincide con la línea de base: 8
avisos informativos de tablas privadas con RLS y sin políticas, 1 advertencia
existente sobre `track_public_event`, 17 wrappers existentes accesibles a
usuarios autenticados y la protección de contraseñas filtradas desactivada. No
apareció ningún hallazgo de Etapa C porque sus objetos no quedaron instalados.

`main` permanece en
`27b5d99e44f4071a8420e104efe959a597cc529f` (`Deploy Community moderation
Stage B`).

## Próximo paso propuesto

Antes de un nuevo intento se necesita una autorización nueva para cambiar el
método de aplicación. Las alternativas seguras son:

1. Ejecutar el mismo archivo desde el SQL Editor de Supabase, conservando una
   única transacción y un tiempo de espera mayor, y registrar después la
   migración de forma verificable.
2. Dividir el archivo en migraciones más pequeñas, revisar hashes y rollback de
   cada una, y desplegarlas en orden.
3. Crear una rama de Supabase para reproducir el problema antes de producción;
   esta opción puede generar costo y requiere aprobación específica del costo.

No debe publicarse el frontend ni desplegarse ninguna Edge Function hasta que la
migración pueda aplicarse y validarse por completo.
