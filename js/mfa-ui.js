/* CÚBICA 3D — MFA TOTP administrativo con Supabase Auth.
   El QR, la clave de configuración y los códigos viven únicamente en memoria. */
(function(){
  let enrollment=null;
  let factors=[];
  let busy=false;

  const el=id=>document.getElementById(id);
  const cleanCode=value=>String(value||"").replace(/\D/g,"").slice(0,6);
  const verified=()=>factors.filter(f=>f?.factor_type==="totp"&&f?.status==="verified");
  const pending=()=>factors.filter(f=>f?.factor_type==="totp"&&f?.status!=="verified");
  const isAdmin=()=>session?.role==="admin";
  const hasAdminAccess=()=>isAdmin()&&window.cubicaAdminMfaAccessAllowed?.()===true;
  const state=()=>session||{};

  function message(target,text,type="info"){
    const node=el(target);if(!node)return;
    node.textContent=text||"";
    node.dataset.type=type;
    node.classList.toggle("hidden",!text);
  }

  function friendlyError(error,fallback){
    const value=String(error?.message||"");
    if(/expired|session.*missing|not authenticated|jwt/i.test(value))return "La sesión venció. Iniciá sesión nuevamente.";
    if(/invalid.*code|challenge|verification|totp/i.test(value))return "El código no es válido o venció. Esperá el próximo código e intentá otra vez.";
    if(/rate limit|too many/i.test(value))return "Hubo demasiados intentos. Esperá unos minutos antes de volver a probar.";
    return fallback;
  }

  async function loadFactors(){
    if(!isAdmin()||!window.cubicaSupabase){factors=[];return factors;}
    const {data,error}=await window.cubicaSupabase.auth.mfa.listFactors();
    if(error)throw error;
    factors=Array.isArray(data?.all)?data.all:Array.isArray(data?.totp)?data.totp:[];
    return factors;
  }

  function factorLabel(f,index){
    return f?.friendly_name||`Aplicación autenticadora ${index+1}`;
  }

  function renderProfile(){
    const card=el("admin-mfa-card");
    if(!card)return;
    card.classList.toggle("hidden",!isAdmin());
    if(!isAdmin())return;
    const items=verified(),waiting=pending(),enforced=state().adminMfaEnforcement===true,aal=state().adminMfaAal||"aal1";
    const status=el("admin-mfa-status"),summary=el("admin-mfa-summary"),list=el("admin-mfa-factor-list");
    status.textContent=items.length?(aal==="aal2"?"Segundo factor verificado":"Segundo factor configurado"):"Segundo factor no configurado";
    status.dataset.state=items.length?(aal==="aal2"?"verified":"configured"):"missing";
    summary.textContent=enforced
      ? (aal==="aal2"?"La protección obligatoria está activa y esta sesión cumple AAL2.":"La protección obligatoria está activa. Ingresá un código para administrar Cúbica.")
      : "La inscripción está disponible. La exigencia obligatoria seguirá desactivada hasta que pruebes tus factores y autorices su activación.";
    list.innerHTML=items.map((factor,index)=>`<li><span><strong>${escapeHtml(factorLabel(factor,index))}</strong><small>Verificado</small></span><button class="btn ghost" type="button" data-mfa-remove="${escapeHtml(factor.id)}" ${enforced&&items.length===1?"disabled title=\"Agregá un respaldo antes de quitar el último factor\"":""}>Quitar</button></li>`).join("")
      +waiting.map((factor,index)=>`<li><span><strong>${escapeHtml(factorLabel(factor,index))}</strong><small>Inscripción pendiente</small></span><button class="btn ghost" type="button" data-mfa-remove-pending="${escapeHtml(factor.id)}">Descartar</button></li>`).join("");
    if(!items.length&&!waiting.length)list.innerHTML="<li class=\"mfa-empty\">Todavía no hay aplicaciones autenticadoras registradas.</li>";
    const activate=el("admin-mfa-enroll");
    activate.textContent=items.length?"Agregar dispositivo de respaldo":"Activar autenticación en dos pasos";
    activate.disabled=busy||Boolean(enrollment)||waiting.length>0||(items.length>0&&aal!=="aal2");
    el("admin-mfa-test").classList.toggle("hidden",!items.length||aal==="aal2");
    el("admin-mfa-backup-note").classList.toggle("hidden",!items.length);
  }

  function renderChallenge(){
    const select=el("mfa-challenge-factor");if(!select)return;
    const items=verified();
    select.innerHTML=items.map((factor,index)=>`<option value="${escapeHtml(factor.id)}">${escapeHtml(factorLabel(factor,index))}</option>`).join("");
    el("mfa-challenge-empty")?.classList.toggle("hidden",items.length>0);
    const submit=el("mfa-challenge-submit");if(submit)submit.disabled=!items.length||busy;
  }

  async function refresh(options={}){
    if(!isAdmin())return;
    try{
      await loadFactors();
      renderProfile();renderChallenge();
      if(options.route!==false&&window.cubicaAdminMfaChallengeRequired?.())showSection("mfa");
    }catch(error){
      message("admin-mfa-message",friendlyError(error,"No se pudo consultar el estado del segundo factor."),"error");
    }
  }

  async function beginEnrollment(){
    if(busy||!isAdmin())return;
    if(!hasAdminAccess()){
      showSection("mfa");
      return message("mfa-challenge-message","Verificá tu identidad antes de gestionar aplicaciones autenticadoras.","info");
    }
    busy=true;message("admin-mfa-message","");renderProfile();
    try{
      await loadFactors();
      if(pending().length)throw new Error("pending-factor");
      if(verified().length&&state().adminMfaAal!=="aal2"){
        showSection("mfa");
        message("mfa-challenge-message","Primero verificá tu factor actual para agregar otro dispositivo.","info");
        return;
      }
      const friendlyName=verified().length?"Cúbica - respaldo":"Cúbica - administrador";
      const {data,error}=await window.cubicaSupabase.auth.mfa.enroll({factorType:"totp",friendlyName});
      if(error)throw error;
      enrollment={factorId:data.id,qr:data.totp?.qr_code||"",secret:data.totp?.secret||""};
      factors.push({id:data.id,factor_type:"totp",status:"unverified",friendly_name:data.friendly_name||friendlyName});
      const qr=el("admin-mfa-qr");if(qr){qr.src=enrollment.qr;qr.alt="Código QR temporal para configurar la aplicación autenticadora";}
      el("admin-mfa-secret").textContent=enrollment.secret;
      el("admin-mfa-enrollment").classList.remove("hidden");
      el("admin-mfa-code").value="";
      el("admin-mfa-code").focus();
      message("admin-mfa-message","Escaneá el QR y confirmá con el código de seis dígitos.","info");
    }catch(error){
      message("admin-mfa-message",String(error?.message)==="pending-factor"
        ?"Hay una inscripción pendiente de otra sesión. Descartala antes de comenzar de nuevo."
        :friendlyError(error,"No se pudo iniciar la configuración del segundo factor."),"error");
    }finally{busy=false;renderProfile();}
  }

  async function verifyEnrollment(event){
    event?.preventDefault();if(busy||!enrollment)return;
    const code=cleanCode(el("admin-mfa-code")?.value);
    if(code.length!==6)return message("admin-mfa-message","Ingresá los seis dígitos de tu aplicación.","error");
    busy=true;el("admin-mfa-verify").disabled=true;
    try{
      const {error}=await window.cubicaSupabase.auth.mfa.challengeAndVerify({factorId:enrollment.factorId,code});
      if(error)throw error;
      enrollment=null;
      el("admin-mfa-enrollment").classList.add("hidden");
      el("admin-mfa-code").value="";
      await window.cubicaRefreshSupabaseSession?.();
      await refresh({route:false});
      message("admin-mfa-message","Autenticación en dos pasos activada correctamente. Configurá también un dispositivo de respaldo antes de exigirla.","success");
    }catch(error){message("admin-mfa-message",friendlyError(error,"No se pudo verificar el código."),"error");}
    finally{busy=false;el("admin-mfa-verify").disabled=false;}
  }

  async function verifyChallenge(event){
    event?.preventDefault();if(busy||!isAdmin())return;
    const factorId=el("mfa-challenge-factor")?.value,code=cleanCode(el("mfa-challenge-code")?.value);
    if(!factorId||code.length!==6)return message("mfa-challenge-message","Ingresá los seis dígitos de tu aplicación.","error");
    busy=true;el("mfa-challenge-submit").disabled=true;message("mfa-challenge-message","Verificando…","info");
    try{
      const {error}=await window.cubicaSupabase.auth.mfa.challengeAndVerify({factorId,code});
      if(error)throw error;
      el("mfa-challenge-code").value="";
      await window.cubicaRefreshSupabaseSession?.();
      await refresh({route:false});
      message("mfa-challenge-message","Identidad verificada. Ya podés usar las herramientas administrativas.","success");
      showSection("profile");
    }catch(error){message("mfa-challenge-message",friendlyError(error,"No se pudo verificar el código."),"error");}
    finally{busy=false;renderChallenge();}
  }

  async function removeFactor(id,isPending=false){
    if(busy||!isAdmin()||!id)return;
    if(!hasAdminAccess()){
      showSection("mfa");
      return message("mfa-challenge-message","Verificá tu identidad antes de gestionar aplicaciones autenticadoras.","info");
    }
    const items=verified(),enforced=state().adminMfaEnforcement===true;
    if(!isPending&&state().adminMfaAal!=="aal2"){
      showSection("mfa");
      return message("mfa-challenge-message","Verificá tu identidad antes de quitar un factor.","info");
    }
    if(!isPending&&enforced&&items.length<=1)return message("admin-mfa-message","Agregá y verificá un dispositivo de respaldo antes de quitar el último factor.","error");
    if(!isPending&&!window.confirm("¿Quitar esta aplicación autenticadora?"))return;
    busy=true;renderProfile();
    try{
      const {error}=await window.cubicaSupabase.auth.mfa.unenroll({factorId:id});if(error)throw error;
      if(enrollment?.factorId===id)enrollment=null;
      await window.cubicaRefreshSupabaseSession?.();await refresh({route:false});
      message("admin-mfa-message",isPending?"Inscripción pendiente descartada.":"Aplicación autenticadora eliminada.","success");
    }catch(error){message("admin-mfa-message",friendlyError(error,"No se pudo quitar la aplicación autenticadora."),"error");}
    finally{busy=false;renderProfile();}
  }

  document.addEventListener("DOMContentLoaded",()=>{
    el("admin-mfa-enroll")?.addEventListener("click",beginEnrollment);
    el("admin-mfa-enrollment-form")?.addEventListener("submit",verifyEnrollment);
    el("admin-mfa-cancel")?.addEventListener("click",async()=>{
      const id=enrollment?.factorId;enrollment=null;el("admin-mfa-enrollment")?.classList.add("hidden");
      if(id)await removeFactor(id,true);
    });
    el("admin-mfa-test")?.addEventListener("click",()=>{renderChallenge();showSection("mfa");});
    el("mfa-challenge-form")?.addEventListener("submit",verifyChallenge);
    el("mfa-challenge-logout")?.addEventListener("click",async()=>{
      const button=el("mfa-challenge-logout");if(button)button.disabled=true;
      try{
        await window.cubicaSignOut?.();
        showSection("login");
        toast("Sesión cerrada.");
      }catch(error){
        message("mfa-challenge-message",friendlyError(error,"No se pudo cerrar la sesión."),"error");
      }finally{if(button)button.disabled=false;}
    });
    el("admin-mfa-factor-list")?.addEventListener("click",event=>{
      const button=event.target.closest("[data-mfa-remove],[data-mfa-remove-pending]");if(!button)return;
      removeFactor(button.dataset.mfaRemove||button.dataset.mfaRemovePending,Boolean(button.dataset.mfaRemovePending));
    });
  });
  window.addEventListener("cubica:auth-ready",event=>{
    if(event.detail?.role==="admin")refresh();
    else{factors=[];enrollment=null;renderProfile();}
  });
  window.addEventListener("cubica:mfa-required",()=>refresh());
  window.cubicaAdminMfa={refresh,beginEnrollment,verifyChallenge,cleanCode};
})();
