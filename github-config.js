/* Configuración de Cúbica para GitHub Pages.
   Dejá apiBase vacío para modo 100% estático/localStorage.
   Cuando tengas un backend externo, poné por ejemplo:
   apiBase: "https://api.cubica3d.ar"
*/
window.CUBICA_CONFIG = {
  mode: "github-pages",
  apiBase: "",
  publicStore: true
};
window.cubicaApiUrl = function(path){
  const base = String(window.CUBICA_CONFIG?.apiBase || "").replace(/\/$/, "");
  return base ? base + path : path;
};
