# Cúbica — arquitectura web actual

Estado documentado: 2026-10-09.

Cúbica está publicada como frontend estático en GitHub Pages y utiliza Supabase como backend principal.

## Arquitectura

```text
GitHub Pages
  ├─ HTML / CSS / JavaScript
  ├─ módulos UI por dominio
  ├─ Three.js para STL/3MF
  └─ Supabase JS
        ├─ PostgreSQL
        ├─ Auth
        ├─ Google OAuth
        ├─ Storage
        ├─ RPC
        └─ RLS
```

Ya no existe un backend general Raspberry/Flask/SQLite para catálogo, inventario, ventas o autenticación.

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

`localStorage` queda limitado a caché y estado temporal del navegador, como carrito y una copia local de datos ya obtenidos.

## Autenticación

- Clientes: Google OAuth mediante Supabase Auth.
- Administrador: email/contraseña de Supabase.
- Los clientes solamente pueden leer sus propios pedidos mediante RLS.
- Pedidos anteriores como invitado pueden vincularse al usuario si coinciden con su email autenticado.

## Frontend modular

La aplicación se divide en:
- `js/core.js`
- `js/ui-shell.js`
- `js/store-ui.js`
- `js/products-ui.js`
- `js/inventory-ui.js`
- `js/budget-ui.js`
- `js/orders-ui.js`
- `js/analytics-ui.js`
- `js/app-init.js`

Los adaptadores Supabase permanecen separados:
- `supabase-bridge.js`
- `supabase-inventory.js`
- `supabase-sales.js`
- `supabase-analytics.js`

Ver `js/README.md` para responsabilidades y orden de carga.

## Seguridad de configuración

La Publishable Key de Supabase puede estar en el frontend. La seguridad real debe depender de RLS y funciones server-side.

Nunca agregar al repositorio:
- Secret Key / service_role;
- contraseña de base de datos;
- credenciales SMTP;
- Google Client Secret.

## Esquema Supabase

El esquema consolidado de referencia está en:

`supabase_schema_current_v1.sql`

Los SQL incrementales históricos se conservan como registro de evolución. El consolidado no necesita ejecutarse sobre el proyecto actual si ya está funcionando.

## Slicer

El visor STL/3MF funciona en el navegador con Three.js.

El slicing real con OrcaSlicer requiere un servicio dedicado externo. Su URL futura se configura mediante `slicerApiBase`. Ese servicio solo se ocuparía de slicing y no reemplazaría a Supabase.

## Snapshot estable

Antes de la refactorización se creó:

`stable-v0.5-pre-community-2026-10-09`

Commit base:

`e9e5119720f9bff525a65e6821432afcdb544718`

Esa rama conserva el estado funcional anterior a la modularización.
