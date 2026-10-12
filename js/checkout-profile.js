/* Private purchase details. Public community names are never changed here. */
(function(){
  "use strict";
  const fields={first_name:"customer-name",last_name:"customer-last-name",phone:"customer-phone"};
  const profileFields={first_name:"buyer-profile-first-name",last_name:"buyer-profile-last-name",phone:"buyer-profile-phone"};
  const el=id=>document.getElementById(id);
  const user=()=>typeof session!=="undefined"?session:null;
  const owner=()=>user()?.supabaseUserId||"";
  const authenticated=()=>window.cubicaCheckoutAuthReady===true&&!!owner();
  let identity=owner(),details=null,loadedOwner="",generation=0,pending=null,saveBusy=false;
  const untouched=input=>input&&input.dataset.checkoutEdited!=="true"&&input.dataset.userEdited!=="true";
  const clean=data=>({first_name:String(data?.first_name||""),last_name:String(data?.last_name||""),phone:String(data?.phone||""),email:String(data?.email||"")});

  function message(text,error=false){
    const node=el("buyer-profile-message");if(!node)return;
    node.textContent=text;node.classList.toggle("delivery-error",error);
  }
  function emit(){
    window.dispatchEvent(new CustomEvent("cubica:buyer-details",{detail:{owner:loadedOwner||owner(),data:details?{...details}:null}}));
  }
  function fillProfile(force=false){
    for(const [key,id] of Object.entries(profileFields)){
      const input=el(id);if(input){input.disabled=!authenticated()||saveBusy;if(force||(!input.value&&untouched(input)))input.value=details?.[key]||"";}
    }
    const email=el("buyer-profile-email");if(email){email.value=authenticated()?(details?.email||user()?.email||""):"";email.readOnly=true;}
    const button=el("buyer-profile-save");if(button)button.disabled=!authenticated()||saveBusy;
  }
  function autofillCheckout(){
    const valid=authenticated()&&loadedOwner===owner();
    for(const [key,id] of Object.entries(fields)){
      const input=el(id);if(valid&&input&&!input.value&&untouched(input))input.value=details?.[key]||"";
    }
    const email=el("customer-email");
    if(email){email.readOnly=authenticated();if(authenticated())email.value=valid?details.email:user()?.email||"";}
    return valid?{...details}:null;
  }
  function clear(){
    generation++;details=null;loadedOwner="";pending=null;saveBusy=false;
    for(const id of [...Object.values(fields),...Object.values(profileFields),"customer-email","buyer-profile-email"]){
      const input=el(id);if(input){input.value="";delete input.dataset.checkoutEdited;delete input.dataset.userEdited;}
    }
    const email=el("customer-email");if(email)email.readOnly=authenticated();
    message("");fillProfile(true);emit();
  }
  async function load({force=false}={}){
    if(!authenticated())return null;
    if(saveBusy)return details&&loadedOwner===owner()?{...details}:null;
    const capturedOwner=owner();
    if(!force&&loadedOwner===capturedOwner&&details){autofillCheckout();fillProfile();return {...details};}
    if(!force&&pending?.owner===capturedOwner)return pending.promise;
    const capturedGeneration=++generation;
    const promise=(async()=>{
      try{
        const {data,error}=await window.cubicaSupabase.rpc("get_my_buyer_details");if(error)throw error;
        if(capturedGeneration!==generation||!authenticated()||owner()!==capturedOwner||data?.user_id!==capturedOwner)return null;
        details=clean(data);loadedOwner=capturedOwner;
        autofillCheckout();fillProfile();emit();return {...details};
      }catch(error){
        if(capturedGeneration===generation&&owner()===capturedOwner)message("No pudimos cargar tus datos personales. Podés completarlos durante la compra.",true);
        return null;
      }finally{if(pending?.generation===capturedGeneration)pending=null;}
    })();
    pending={owner:capturedOwner,generation:capturedGeneration,promise};return promise;
  }
  function validation(value){
    if(value.first_name.length>60||value.last_name.length>60)return "El nombre y el apellido admiten hasta 60 caracteres.";
    const digits=value.phone.replace(/\D/g,"");
    if(value.phone.length>40||(value.phone&&(digits.length<8||digits.length>15)))return "Ingresá un teléfono válido de 8 a 15 números.";
    return "";
  }
  async function save(){
    if(!authenticated()||saveBusy)return null;
    const value=Object.fromEntries(Object.entries(profileFields).map(([key,id])=>[key,String(el(id)?.value||"").trim()]));
    const invalid=validation(value);if(invalid){message(invalid,true);return null;}
    const capturedOwner=owner(),capturedGeneration=++generation;pending=null;saveBusy=true;fillProfile();message("Guardando tus datos…");
    try{
      const {data,error}=await window.cubicaSupabase.rpc("save_my_buyer_details",{p_first_name:value.first_name,p_last_name:value.last_name,p_phone:value.phone});if(error)throw error;
      if(capturedGeneration!==generation||!authenticated()||owner()!==capturedOwner||data?.user_id!==capturedOwner)return null;
      details=clean(data);loadedOwner=capturedOwner;fillProfile(true);autofillCheckout();emit();message("Tus datos personales quedaron guardados.");return {...details};
    }catch(error){
      if(capturedGeneration===generation&&owner()===capturedOwner)message(error.message||"No pudimos guardar tus datos. Reintentá.",true);
      return null;
    }finally{if(capturedGeneration===generation){saveBusy=false;fillProfile();}}
  }
  function mount(){
    const section=el("section-profile");if(!section)return;
    let card=el("buyer-profile-fields");
    if(!card){card=document.createElement("div");card.id="buyer-profile-fields";section.insertBefore(card,el("delivery-profile-addresses")||null);}
    if(el("buyer-profile-form"))return;
    card.className="card delivery-profile-card";
    card.innerHTML='<div class="delivery-panel-heading"><div><h3>Mis datos para comprar</h3><p class="muted">Estos datos son privados y sirven para completar tus próximas compras.</p></div></div><form id="buyer-profile-form"><div class="delivery-address-grid"><label for="buyer-profile-first-name">Nombre<input id="buyer-profile-first-name" autocomplete="given-name" maxlength="60"></label><label for="buyer-profile-last-name">Apellido<input id="buyer-profile-last-name" autocomplete="family-name" maxlength="60"></label><label for="buyer-profile-phone">Teléfono / WhatsApp<input id="buyer-profile-phone" type="tel" autocomplete="tel" maxlength="40" placeholder="11 1234 5678"></label><label for="buyer-profile-email">Email de tu cuenta<input id="buyer-profile-email" type="email" autocomplete="email" readonly aria-readonly="true"></label></div><p class="muted delivery-small">El email corresponde a tu cuenta. Tus datos de compra no cambian el nombre público de Community.</p><p id="buyer-profile-message" role="status" aria-live="polite"></p><button id="buyer-profile-save" class="btn primary" type="submit">Guardar mis datos</button></form>';
    el("buyer-profile-form").addEventListener("submit",event=>{event.preventDefault();save();});
    for(const id of Object.values(profileFields))el(id)?.addEventListener("input",event=>{event.target.dataset.userEdited="true";});
    fillProfile();
  }
  function renderProfile(){mount();fillProfile();if(authenticated())load();}
  window.cubicaBuyerProfile={load,autofillCheckout,renderProfile,clear,save};
  window.addEventListener("cubica:auth-ready",()=>{
    const next=owner();if(next!==identity){identity=next;clear();}
    // All auth listeners finish before requesting data; checkout verifies this auth event.
    Promise.resolve().then(()=>{if(authenticated()){autofillCheckout();load();}else fillProfile();});
  });
  document.addEventListener("DOMContentLoaded",()=>{mount();if(authenticated())load();});
})();

