/* Configuración pública de Cúbica para GitHub Pages + Supabase.
   La Publishable Key puede vivir en el frontend. La seguridad real la controla RLS.
   Nunca pongas aquí una Secret Key, service_role ni la contraseña de la base de datos.
*/
window.CUBICA_CONFIG = {
  mode: "supabase",
  apiBase: "",
  publicStore: true,
  supabaseUrl: "https://mymrbpwvghxmqqpzzdqk.supabase.co",
  supabasePublishableKey: "sb_publishable_jLx1W-mzf4pL2Z09MLr_Pw_tWS84NWV"
};

window.cubicaApiUrl = function(path){
  const base = String(window.CUBICA_CONFIG?.apiBase || "").replace(/\/$/, "");
  return base ? base + path : path;
};
