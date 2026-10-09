# Esquema consolidado de Supabase — Cúbica

Fecha: 2026-10-09

El archivo `supabase_schema_current_v1.sql` consolida en un solo lugar las tablas, columnas, funciones RPC, RLS, permisos y Storage que utiliza actualmente el frontend de Cúbica.

## Fuente de la consolidación

Se reconstruyó a partir de:
- los SQL incrementales existentes en el repositorio;
- las consultas, inserts y upserts actuales de `supabase-bridge.js`, `supabase-inventory.js`, `supabase-sales.js` y `supabase-analytics.js`;
- el comportamiento ya probado del proyecto actual.

No se realizó una introspección directa del catálogo PostgreSQL del proyecto Supabase en vivo. Por ese motivo, antes de usar este archivo como migración sobre la base productiva se debe comparar con la BD real.

## Uso recomendado

- **Proyecto actual:** conservarlo como documento de referencia y base para futuras migraciones. No hace falta ejecutarlo ahora.
- **Proyecto Supabase nuevo:** usarlo como bootstrap y luego crear manualmente el usuario administrador / asignar su rol.
- **Futuras modificaciones:** crear migraciones pequeñas nuevas y actualizar este esquema consolidado periódicamente.

Los SQL históricos se mantienen porque sirven como registro de evolución y porque algunos ya fueron ejecutados en la base actual.
