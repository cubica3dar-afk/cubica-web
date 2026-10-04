# Cúbica — versión GitHub Pages

Esta carpeta está preparada para publicarse como sitio estático en GitHub Pages.

## Publicar
1. Crear un repositorio en GitHub.
2. Subir el contenido de esta carpeta a la raíz del repositorio.
3. Ir a **Settings → Pages**.
4. En **Build and deployment**, elegir **Deploy from a branch**.
5. Elegir `main` y `/ (root)`.
6. Guardar.

GitHub Pages publicará `index.html`.

## Modo actual
Con `github-config.js` y `apiBase: ""` la aplicación funciona sin backend:
- tienda y catálogo
- carrito
- inventario local del navegador
- calculadora de presupuestos
- gráficos basados en datos locales
- visor STL/3MF y cambio visual de colores

No funcionan como servicio compartido:
- SQLite / sincronización entre dispositivos
- emails
- pedidos centralizados
- slicing real con OrcaSlicer
- autenticación segura de administrador

## Conectar un backend después
Editar `github-config.js`:

```js
window.CUBICA_CONFIG = {
  mode: "github-pages",
  apiBase: "https://api.cubica3d.ar",
  publicStore: true
};
```

El backend deberá aceptar CORS desde el dominio de GitHub Pages o desde el dominio personalizado.

## Seguridad
No subas claves SMTP, contraseñas de aplicación, archivos `.env`, bases SQLite privadas ni secretos al repositorio.
La contraseña de administrador actual del demo vive en JavaScript y NO es seguridad real para un sitio público.
