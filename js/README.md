# Módulos JavaScript de Cúbica

Refactorización consolidada: 2026-10-09.

El frontend continúa usando JavaScript nativo y scripts clásicos para mantener compatibilidad y reducir riesgo. La aplicación ya no depende de un backend general Raspberry/Flask/SQLite: los datos compartidos viven en Supabase.

## Orden de carga

1. `github-config.js`
2. Supabase JS
3. `js/core.js`
4. `js/ui-shell.js`
5. `js/store-ui.js`
6. `js/products-ui.js`
7. `js/inventory-ui.js`
8. `js/budget-ui.js`
9. `js/orders-ui.js`
10. `js/analytics-ui.js`
11. `js/app-init.js`
12. `supabase-bridge.js`
13. `supabase-inventory.js`
14. `supabase-sales.js`
15. `supabase-analytics.js`
16. `viewer.js`
17. `slicer.js`

## Responsabilidades

- **core.js**: estado compartido, localStorage temporal/caché, utilidades, formato y helpers de insumos.
- **ui-shell.js**: navegación, sidebar, perfil visual, secciones, modales y paginación genérica.
- **store-ui.js**: catálogo público y carrito.
- **products-ui.js**: detalle de producto y administración de productos terminados, colores, recetas y medios.
- **inventory-ui.js**: insumos, filtros, categorías, unidades, filamentos, edición y orden.
- **budget-ui.js**: calculadora y representación de presupuestos.
- **orders-ui.js**: historial de pedidos y planificación de insumos para fabricación.
- **analytics-ui.js**: KPIs, tablas, gráficos y métricas.
- **app-init.js**: listeners DOM y ensamblado de la interfaz.

Los archivos `supabase-*.js` son adaptadores de persistencia/autenticación y están separados por dominio.

## Persistencia

`localStorage` ya no actúa como base compartida. Se utiliza como caché/estado temporal para una mejor experiencia del navegador. Supabase es la fuente central de catálogo, inventario, pedidos, presupuestos, perfiles y analítica.

## Slicer

El visor 3D es local. El slicing real puede conectarse en el futuro a un servicio dedicado mediante `slicerApiBase`. Ese servicio no forma parte de la persistencia principal de Cúbica.
