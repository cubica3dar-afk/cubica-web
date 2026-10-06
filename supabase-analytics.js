/* Cúbica + Supabase — eventos de navegación para el dashboard de Análisis */
(function(){
  const client=window.cubicaSupabase;
  if(!client)return;

  window.cubicaAnalyticsEvents=Array.isArray(window.cubicaAnalyticsEvents)?window.cubicaAnalyticsEvents:[];
  let analyticsAvailable=true;
  let loadInProgress=false;

  function analyticsSessionId(){
    let id=sessionStorage.getItem("cubica_analytics_session");
    if(!id){
      id=(globalThis.crypto?.randomUUID?.()||("sess-"+Date.now()+"-"+Math.random().toString(36).slice(2)));
      sessionStorage.setItem("cubica_analytics_session",id);
    }
    return id;
  }

  async function trackEvent(eventName,productId=null,metadata={}){
    if(!analyticsAvailable)return;
    // Las visitas del administrador no se mezclan con las métricas comerciales.
    if(typeof session!=="undefined" && session?.role==="admin")return;
    try{
      const {error}=await client.rpc("track_public_event",{
        p_event_name:eventName,
        p_product_id:productId?String(productId):null,
        p_session_id:analyticsSessionId(),
        p_metadata:metadata||{}
      });
      if(error){
        if(/track_public_event|PGRST202|Could not find the function|analytics_events/i.test(String(error.message||"")+" "+String(error.code||""))){
          analyticsAvailable=false;
          return;
        }
        console.warn("Evento de analítica no registrado:",error);
      }
    }catch(err){
      console.warn("Analítica no disponible:",err);
    }
  }
  window.cubicaTrackEvent=trackEvent;

  async function loadAnalyticsEvents(){
    if(loadInProgress || typeof session==="undefined" || session?.role!=="admin")return;
    loadInProgress=true;
    try{
      const {data,error}=await client
        .from("analytics_events")
        .select("id,event_name,product_id,session_id,metadata,created_at")
        .order("created_at",{ascending:false})
        .limit(5000);
      if(error)throw error;
      window.cubicaAnalyticsEvents=data||[];
      window.dispatchEvent(new CustomEvent("cubica:analytics-ready",{detail:{count:window.cubicaAnalyticsEvents.length}}));
      if(typeof renderAnalytics==="function" && document.getElementById("section-analytics") && !document.getElementById("section-analytics").classList.contains("hidden")){
        renderAnalytics();
      }
    }catch(err){
      if(/analytics_events|relation .* does not exist|42P01/i.test(String(err.message||"")+" "+String(err.code||""))){
        analyticsAvailable=false;
      }else{
        console.warn("No se pudo cargar analítica:",err);
      }
    }finally{
      loadInProgress=false;
    }
  }
  window.loadCubicaAnalytics=loadAnalyticsEvents;

  window.addEventListener("cubica:auth-ready",e=>{
    if(e.detail?.role==="admin")loadAnalyticsEvents();
  });

  document.addEventListener("DOMContentLoaded",()=>{
    setTimeout(()=>{
      if(typeof session!=="undefined" && session?.role==="admin")return;
      if(sessionStorage.getItem("cubica_page_view_sent")==="1")return;
      sessionStorage.setItem("cubica_page_view_sent","1");
      trackEvent("page_view",null,{path:location.pathname,referrer:document.referrer?document.referrer.slice(0,300):""});
    },1200);
  });
})();
