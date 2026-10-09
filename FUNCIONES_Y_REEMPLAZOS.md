# Mapa funcional de Cúbica

Estado: 2026-10-09.

## Funciones que viven en GitHub Pages

El navegador se ocupa de:
- interfaz y navegación;
- catálogo y filtros;
- carrito;
- fichas de producto;
- formularios administrativos;
- cálculos de presupuestos;
- gráficos y visualizaciones;
- visor STL/3MF con Three.js.

## Funciones que viven en Supabase

Supabase es responsable de:
- autenticación;
- perfiles y roles;
- catálogo compartido;
- stock;
- insumos y recetas;
- pedidos;
- presupuestos;
- analítica;
- Storage de imágenes/videos;
- permisos RLS;
- funciones RPC seguras.

## Persistencia local

`localStorage` se utiliza como caché y para estado temporal, no como base de datos compartida.

## Servicio de slicing futuro

GitHub Pages no puede ejecutar OrcaSlicer CLI. Si se habilita slicing real, deberá utilizarse un servicio dedicado configurado con `slicerApiBase`.

Ese servicio tendrá una responsabilidad aislada: analizar modelos y devolver métricas de impresión. No administrará usuarios, stock ni pedidos.
