# Funciones de Cúbica en GitHub Pages

## Funcionan directamente
- HTML/CSS/JavaScript de la tienda.
- Catálogo, buscador y filtros.
- Carrito en el navegador.
- Calculadora de presupuesto.
- Gráficos y análisis sobre datos que estén en el navegador.
- Vista 3D STL/3MF mediante Three.js.
- Cambio visual de colores.
- Enlaces a Instagram/MakerWorld.

## Funcionan, pero solo en ESE navegador
- Productos terminados.
- Insumos.
- Categorías.
- Pedidos locales.
- Presupuestos guardados.

Estos datos usan localStorage si no hay backend. No se comparten entre PC/celular.

## No los puede ejecutar GitHub Pages por sí solo
- Python / Flask (`app.py`).
- SQLite en el servidor.
- OrcaSlicer CLI.
- SMTP/Gmail con contraseña de aplicación.
- Guardado central de pedidos y stock.
- Login/admin seguro.

## Reemplazo recomendado
- Datos + stock + pedidos: Supabase Postgres o Cloudflare D1 + API.
- Login real: Supabase Auth / Firebase Auth / proveedor equivalente.
- Email de pedidos: función server-side/Edge Function con secretos, usando un proveedor de email.
- Slicer real: servidor Docker/VPS separado con OrcaSlicer; el frontend de GitHub Pages llama a su API.
- Alternativa de slicer: WASM en el navegador, posible pero más pesado y menos recomendable para móviles/modelos grandes.

## Arquitectura sugerida
GitHub Pages (frontend)
→ Supabase (datos, auth, pedidos, emails mediante Edge Function)
→ API OrcaSlicer separada (solo para presupuesto 3D)
