# Etapa C — Línea de base de producción

Capturada: 2026-10-18 21:07:28 UTC  
Proyecto Supabase: `mymrbpwvghxmqqpzzdqk`

## Dependencias

- Esquema `private`: presente.
- `storage.objects`: presente.
- Extensión `pgcrypto`: presente.
- `private.is_admin()`: presente, `SECURITY DEFINER`, `search_path=''`.
- Migración de Etapa B `20261018045628`: presente.
- Hash MD5 de la definición vigente de `private.is_admin()`:
  `8986d8adc88eb57e02dd57bb20da361b`.
- `private.is_admin()`: sin ejecución para `anon` ni `service_role`;
  ejecución para `authenticated`, con validación interna de rol y AAL2.

## Ausencia previa de Etapa C

- `private.site_assets`: ausente.
- `public.get_site_experience()`: ausente.
- Bucket `site-assets`: ausente.

## Conteos comerciales previos

| Entidad | Cantidad |
|---|---:|
| Productos | 17 |
| Categorías de producto | 4 |
| Insumos | 35 |
| Recetas | 2 |
| Pedidos | 15 |
| Artículos de pedido | 16 |
| Movimientos de inventario | 9 |
| Presupuestos | 4 |
| Versiones de presupuesto | 3 |
| Comentarios de Comunidad | 5 |
| Reacciones de productos | 4 |
| Likes de comentarios | 3 |

Estos conteos deben coincidir después de la migración y de todas las pruebas
transaccionales.
