# Módulos JavaScript de Cúbica

Primera etapa de modularización: 2026-10-09.

No se cambió el framework ni se migró a React/Vue. Los archivos siguen siendo scripts clásicos para minimizar riesgo durante la refactorización.

## Orden de carga

En `index.html`:

1. `github-config.js`
2. Supabase JS
3. `script.js`
4. `js/inventory-ui.js`
5. `js/analytics-ui.js`
6. `supabase-bridge.js`
7. `supabase-inventory.js`
8. `supabase-sales.js`
9. `supabase-analytics.js`
10. `viewer.js`
11. `slicer.js`

## inventory-ui.js

Contiene la interfaz y lógica de:
- categorías de insumos;
- listado, búsqueda, filtros y paginación;
- orden manual;
- alta/edición/baja;
- detalles de filamentos (material, marca, color);
- unidades de medida.

Usa el estado global definido por `script.js` y expone las funciones necesarias para handlers inline mediante `window.*`.

## analytics-ui.js

Contiene:
- filtros temporales de analytics;
- cálculo de KPIs;
- métricas de productos/clientes/producción;
- gráficos SVG;
- embudo;
- tablas de análisis.

Consume `orders`, `products`, `supplies` y eventos cargados por `supabase-analytics.js`.

## Próximas extracciones recomendadas

Sin urgencia, los siguientes candidatos naturales son:
- `store-ui.js`
- `products-admin-ui.js`
- `orders-ui.js`
- `budget-ui.js`
- `auth-ui.js`

Conviene hacerlo en cambios pequeños y verificables, no reescribir todo el frontend de una sola vez.
