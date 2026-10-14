/* Cloudflare Turnstile for the final order confirmation. The public site key is
   optional during staged rollout; the secret exists only in the Edge Function. */
(function(){
  "use strict";
  const config=()=>window.CUBICA_CONFIG||{};
  const enabled=()=>Boolean(String(config().turnstileSiteKey||"").trim());
  let widgetId=null,token="",readyPromise=null;

  const el=id=>document.getElementById(id);
  function message(value,error=false){
    const node=el("checkout-turnstile-message");if(!node)return;
    node.textContent=value||"";node.dataset.state=error?"error":"info";
  }
  function clearToken(){token="";}
  function reset(){
    clearToken();
    if(widgetId!==null&&window.turnstile?.reset)window.turnstile.reset(widgetId);
  }
  function render(){
    if(!enabled()||widgetId!==null||!window.turnstile)return;
    const host=el("checkout-turnstile-widget");if(!host)return;
    widgetId=window.turnstile.render(host,{
      sitekey:String(config().turnstileSiteKey).trim(),action:"create_order",theme:"dark",appearance:"interaction-only",size:"flexible",
      callback:value=>{token=String(value||"");message(token?"Verificación lista.":"");},
      "expired-callback":()=>{clearToken();message("La verificación venció. Completala nuevamente.",true);},
      "timeout-callback":()=>{clearToken();message("La verificación tardó demasiado. Intentá nuevamente.",true);},
      "error-callback":()=>{clearToken();message("No se pudo completar la verificación. Reintentá.",true);},
    });
  }
  function load(){
    if(!enabled())return Promise.resolve(false);
    el("checkout-turnstile")?.classList.remove("hidden");
    if(window.turnstile){render();return Promise.resolve(true);}
    if(readyPromise)return readyPromise;
    readyPromise=new Promise((resolve,reject)=>{
      const script=document.createElement("script");
      script.src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";script.async=true;script.defer=true;
      script.onload=()=>{render();resolve(true);};
      script.onerror=()=>{message("No se pudo cargar la verificación de seguridad.",true);reject(new Error("turnstile_script_unavailable"));};
      document.head.appendChild(script);
    });
    return readyPromise;
  }
  async function requireToken(){
    if(!enabled())return null;
    await load();
    if(!token){message("Completá la verificación de seguridad antes de confirmar.",true);throw new Error("Completá la verificación de seguridad antes de confirmar el pedido.");}
    return token;
  }
  function friendlyError(code,retryAfter){
    if(code==="order_rate_limit")return `Se realizaron demasiados intentos. Esperá ${Math.max(1,Math.ceil((Number(retryAfter)||60)/60))} minuto(s) y volvé a intentar.`;
    if(code==="turnstile_expired_or_used")return "La verificación venció o ya fue utilizada. Completala nuevamente.";
    if(["turnstile_invalid","turnstile_hostname_mismatch","turnstile_action_mismatch","turnstile_required"].includes(code))return "No pudimos validar la verificación de seguridad. Completala nuevamente.";
    if(code==="turnstile_unavailable")return "La verificación de seguridad no está disponible temporalmente. Reintentá en unos minutos.";
    if(code==="order_protection_not_configured")return "La protección del pedido todavía no está configurada. Contactanos si el problema continúa.";
    if(code==="invalid_authentication")return "La sesión no pudo validarse. Volvé a iniciar sesión o continuá como invitado.";
    if(code==="order_not_available")return "Este intento de compra no coincide con el pedido original. Volvé a revisar el checkout.";
    return "No se pudo registrar el pedido. Tus productos siguen en el carrito para que puedas reintentar.";
  }
  async function createOrder(payload){
    const cfg=config(),client=window.cubicaSupabase;
    if(!enabled()||!client){const error=new Error(friendlyError("order_protection_not_configured"));error.code="order_protection_not_configured";throw error;}
    let authToken=cfg.supabasePublishableKey;
    try{const {data}=await client.auth.getSession();if(data?.session?.access_token)authToken=data.session.access_token;}catch{/* guest checkout */}
    let response;
    try{
      response=await fetch(`${String(cfg.supabaseUrl).replace(/\/$/,"")}/functions/v1/create-order`,{
        method:"POST",headers:{apikey:cfg.supabasePublishableKey,Authorization:`Bearer ${authToken}`,"Content-Type":"application/json"},
        body:JSON.stringify(payload),signal:AbortSignal.timeout(20000),
      });
    }catch(error){error.code="order_network_error";throw error;}
    let result={};try{result=await response.json();}catch{/* fixed fallback below */}
    if(!response.ok){const error=new Error(friendlyError(result.error,result.retry_after));error.code=result.error||"order_creation_failed";error.retryAfter=result.retry_after||0;throw error;}
    return result;
  }
  function handleFailure(error){
    const code=error?.code||"";
    if(/^turnstile_/.test(code)){reset();message(friendlyError(code,error.retryAfter),true);}
  }
  function complete(){reset();message("");}

  document.addEventListener("DOMContentLoaded",()=>{if(enabled())load().catch(()=>{});});
  window.cubicaTurnstile={enabled,load,requireToken,createOrder,handleFailure,complete,reset};
})();


