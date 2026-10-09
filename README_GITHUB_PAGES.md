# Cúbica — arquitectura web actual

Estado documentado: 2026-10-09.

Cúbica está publicada como frontend estático en GitHub Pages y utiliza Supabase como backend.

## Arquitectura

```text
GitHub Pages
  ├─ HTML / CSS / JavaScript
  ├─ Three.js para STL/3MF
  └─ Supabase JS
        ├─ PostgreSQL
        ├─ Auth
        ├─ Google OAuth
        ├─ Storage
        ├─ RPC
        └─ RLS
```

El modo activo se define en `github-config.js`:

```js
mode: "supabase"
```

La Publishable Key de Supabase puede estar en el frontend. La seguridad debe depender de RLS y de funciones server-side. Nunca agregar al repositorio una Secret Key, `service_role`, contraseña de base de datos, credencial SMTP ni Google Client Secret.

## Datos centralizados en Supabase

Actualmente se sincronizan:
- catálogo y stock;
- imágenes/videos y colores;
- insumos, categorías y recetas/BOM;
- pedidos y detalle de pedidos;
- presupuestos;
- perfiles de usuarios;
- analítica;
- orden personalizado de productos e insumos.

## Autenticación

- Clientes: Google OAuth mediante Supabase Auth.
- Administrador: email/contraseña de Supabase.
- Los clientes solamente pueden leer sus propios pedidos mediante RLS.
- Pedidos anteriores como invitado pueden vincularse al usuario si coinciden con su email autenticado.

## JavaScript

`script.js` conserva el núcleo y varias funciones históricas.

Como primera etapa de modularización:
- `js/inventory-ui.js`: interfaz/lógica de insumos.
- `js/analytics-ui.js`: cálculos y render del panel de análisis.
- `supabase-bridge.js`: auth, catálogo y Storage.
- `supabase-inventory.js`: persistencia de insumos/recetas.
- `supabase-sales.js`: pedidos, ventas y presupuestos.
- `supabase-analytics.js`: registro/carga de eventos.

Ver `js/README.md` para el orden de carga y dependencias.

## Esquema Supabase

El esquema consolidado de referencia está en:

`supabase_schema_current_v1.sql`

Los SQL incrementales históricos se conservan en el repositorio. No hace falta volver a ejecutarlos si ya fueron aplicados.

## Slicer

El visor STL/3MF funciona en el navegador con Three.js.

El slicing real con OrcaSlicer no puede ejecutarse en GitHub Pages. `slicer.js` conserva la interfaz preparada para un backend futuro (VPS/Raspberry/worker separado).

## Snapshot estable

Antes de la modularización se creó la rama:

`stable-v0.5-pre-community-2026-10-09`

Su commit base es:

`e9e5119720f9bff525a65e6821432afcdb544718`

Esa rama sirve como punto de rollback del estado funcional anterior a esta refactorización.
