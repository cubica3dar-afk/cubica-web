/* Configuración pública de Cúbica para GitHub Pages + Supabase.
   La Publishable Key puede vivir en el frontend. La seguridad real la controla RLS.
   Nunca pongas aquí una Secret Key, service_role, contraseña de base de datos
   ni Client Secret de OAuth.
*/
window.CUBICA_CONFIG = {
  mode: "supabase",
  publicStore: true,
  supabaseUrl: "https://mymrbpwvghxmqqpzzdqk.supabase.co",
  supabasePublishableKey: "sb_publishable_jLx1W-mzf4pL2Z09MLr_Pw_tWS84NWV",

  // Backend opcional y exclusivamente dedicado al slicing (OrcaSlicer).
  // Vacío = visor 3D disponible, slicing real deshabilitado.
  slicerApiBase: ""
};

window.cubicaSlicerApiUrl = function(path){
  const base=String(window.CUBICA_CONFIG?.slicerApiBase||"").replace(/\/$/,"");
  return base ? base+path : path;
};
