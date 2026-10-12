/* Entregas: formularios públicos y administración privada. Los importes se validan en Supabase. */
(function(){
  "use strict";
  const addressKeys=["recipient","phone","street","number","floor","apartment","city","province","postal_code","instructions","label"];
  const required=["recipient","phone","street","number","city","province","postal_code"];
  const labels={recipient:"Nombre y apellido",phone:"Teléfono",street:"Calle",number:"Altura",floor:"Piso",apartment:"Departamento",city:"Localidad",province:"Provincia",postal_code:"Código postal",instructions:"Indicaciones",label:"Nombre de la dirección"};
  const provinces=["Ciudad Autónoma de Buenos Aires","Buenos Aires","Catamarca","Chaco","Chubut","Córdoba","Corrientes","Entre Ríos","Formosa","Jujuy","La Pampa","La Rioja","Mendoza","Misiones","Neuquén","Río Negro","Salta","San Juan","San Luis","Santa Cruz","Santa Fe","Santiago del Estero","Tierra del Fuego","Tucumán"];
  const providerNames={correo_argentino:"Correo Argentino",andreani:"Andreani",oca:"OCA"};
  const statusNames={pending:"Pendiente de despacho",dispatched:"Despachado",in_transit:"En tránsito",delivered:"Entregado",incident:"Incidencia",pickup_pending:"Retiro por coordinar",pickup_ready:"Listo para retirar",picked_up:"Retirado"};
  const e=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const el=id=>document.getElementById(id);
  const uuid=()=>globalThis.crypto.randomUUID();
  const token=()=>Array.from(globalThis.crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,"0")).join("");
  const currentUser=()=>typeof session!=="undefined"?session:null;
  const client=()=>window.cubicaSupabase;
  const currency=value=>typeof money==="function"?money(value):new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS",maximumFractionDigits:0}).format(Number(value)||0);
  let addresses=[],addressGeneration=0,quoteGeneration=0,acceptedQuote=null,acceptedFingerprint="",requestId=uuid(),requestToken=token(),profileEditing=null,settings=null,settingsBusy=false;
  let identity=currentUser()?.supabaseUserId||"";

  function cleanAddress(value={}){
    return Object.fromEntries(addressKeys.map(key=>[key,String(value[key]??"").trim().slice(0,key==="instructions"?500:120)]));
  }
  function addressError(value){
    for(const key of required)if(!String(value[key]||"").trim())return `Completá ${labels[key].toLowerCase()} del destinatario.`;
    if(String(value.recipient).trim().length<2)return "Indicá nombre y apellido del destinatario.";
    const digits=String(value.phone).replace(/\D/g,"");
    if(digits.length<8||digits.length>15)return "Ingresá un teléfono válido del destinatario.";
    if(!/^(?:\d{4}|[A-Z]\d{4}[A-Z]{3})$/i.test(String(value.postal_code).trim()))return "Ingresá un código postal argentino de 4 números o un CPA, por ejemplo C1405ABC.";
    if(!provinces.includes(value.province))return "Elegí una provincia argentina.";
    return "";
  }
  function selectedMode(){return document.querySelector('input[name="delivery-mode"]:checked')?.value||"";}
  function readAddress(prefix="delivery-address"){
    return cleanAddress(Object.fromEntries(addressKeys.map(key=>[key,el(`${prefix}-${key}`)?.value||""])));
  }
  function setAddress(value,prefix="delivery-address"){
    const address=cleanAddress(value);
    for(const key of addressKeys){const input=el(`${prefix}-${key}`);if(input)input.value=address[key];}
  }
  function items(){
    return (typeof cart!=="undefined"?cart:[]).map(item=>({product_id:String(item.productId),qty:Number(item.qty),color:String(item.color||"")}));
  }
  function fingerprint(){return JSON.stringify({mode:selectedMode(),address:readAddress(),items:items().slice().sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))});}
  function quoteIsCurrent(){
    return acceptedQuote&&acceptedFingerprint===fingerprint()&&Date.parse(acceptedQuote.expires_at)>Date.now()+5000;
  }
  function setCheckoutMessage(message,error=false){
    const node=el("delivery-checkout-message");if(!node)return;
    node.textContent=message;node.classList.toggle("delivery-error",error);
  }
  function subtotal(){
    return (typeof cart!=="undefined"?cart:[]).reduce((sum,item)=>sum+(Number((typeof products!=="undefined"?products:[]).find(p=>String(p.id)===String(item.productId))?.price)||0)*(Number(item.qty)||0),0);
  }
  function renderTotal(){
    const summary=el("delivery-checkout-total");if(!summary)return;
    const mode=selectedMode(),valid=quoteIsCurrent(),shipping=mode==="pickup"?0:valid?Number(acceptedQuote.price):null;
    summary.innerHTML=`<div><span>Productos</span><strong>${e(currency(subtotal()))}</strong></div><div><span>Entrega</span><strong>${shipping===null?"Por cotizar":e(currency(shipping))}</strong></div><div class="delivery-total"><span>Total del pedido</span><strong>${shipping===null?"Disponible al cotizar":e(currency(subtotal()+shipping))}</strong></div>`;
  }
  function invalidate(message="La cotización se actualizará al cambiar los datos o productos."){
    quoteGeneration++;acceptedQuote=null;acceptedFingerprint="";requestId=uuid();requestToken=token();
    if(selectedMode()==="shipping")setCheckoutMessage(message);
    renderTotal();
  }
  function addressFields(prefix,value={},includeLabel=false){
    const fields=[...(includeLabel?["label"]:[]),"recipient","phone","street","number","floor","apartment","city","province","postal_code","instructions"];
    return fields.map(key=>{
      const full=["recipient","instructions","label"].includes(key),req=required.includes(key)?" required":"",label=`${labels[key]}${["floor","apartment","instructions","label"].includes(key)?" (opcional)":""}`;
      const autocomplete={recipient:"name",phone:"tel",street:"address-line1",number:"off",floor:"off",apartment:"address-line2",city:"address-level2",province:"address-level1",postal_code:"postal-code"}[key]||"off";
      const input=key==="province"?`<select id="${prefix}-${key}"${req} autocomplete="${autocomplete}"><option value="">Elegí una provincia</option>${provinces.map(p=>`<option ${p===value[key]?"selected":""}>${e(p)}</option>`).join("")}</select>`:key==="instructions"?`<textarea id="${prefix}-${key}" rows="2" maxlength="500">${e(value[key])}</textarea>`:`<input id="${prefix}-${key}"${req} type="${key==="phone"?"tel":"text"}" autocomplete="${autocomplete}" maxlength="120" value="${e(value[key])}"${key==="postal_code"?' placeholder="1405 o C1405ABC" pattern="[0-9]{4}|[A-Za-z][0-9]{4}[A-Za-z]{3}"':""}>`;
      return `<label class="${full?"full-span":""}" for="${prefix}-${key}">${label}${input}</label>`;
    }).join("");
  }
  function syncMode(){
    const mode=selectedMode(),shipping=mode==="shipping",box=el("delivery-shipping-fields");
    box?.classList.toggle("hidden",!shipping);
    for(const input of box?.querySelectorAll("input,select,textarea")||[])input.disabled=!shipping;
    el("delivery-pickup-note")?.classList.toggle("hidden",mode!=="pickup");
    invalidate(mode==="shipping"?"Completá la dirección y calculá el envío antes de confirmar.":"");
    if(shipping&&currentUser())loadAddresses();
  }
  function renderCheckoutAddresses(){
    const select=el("delivery-saved-address");if(!select)return;
    const selected=select.value;
    select.innerHTML='<option value="">Usar una dirección nueva</option>'+addresses.map(a=>`<option value="${e(a.id)}">${e(a.label||`${a.street} ${a.number}, ${a.city}`)}${a.is_default?" · predeterminada":""}</option>`).join("");
    if(addresses.some(a=>String(a.id)===selected))select.value=selected;
    el("delivery-saved-address-wrap")?.classList.toggle("hidden",!currentUser());
    el("delivery-save-address-wrap")?.classList.toggle("hidden",!currentUser());
  }
  async function loadAddresses(){
    const user=currentUser(),userId=user?.supabaseUserId;if(!userId)return;
    const generation=++addressGeneration;
    try{
      const {data,error}=await client().rpc("list_my_delivery_addresses");if(error)throw error;
      if(generation!==addressGeneration||currentUser()?.supabaseUserId!==userId)return;
      addresses=Array.isArray(data)?data.map(row=>({...cleanAddress(row.address||row),id:row.id,is_default:!!row.is_default})):[];renderCheckoutAddresses();renderAddressList();
    }catch(error){
      if(generation!==addressGeneration)return;
      const node=el("delivery-address-profile-message");if(node)node.textContent=error.message||"No se pudieron cargar las direcciones. Podés ingresar una nueva durante la compra.";
    }
  }
  async function quote(){
    if(selectedMode()!=="shipping")return;
    const address=readAddress(),validation=addressError(address);
    if(validation){setCheckoutMessage(validation,true);return;}
    if(!items().length){setCheckoutMessage("El carrito está vacío.",true);return;}
    invalidate();const generation=quoteGeneration,captured=fingerprint(),button=el("delivery-quote-button");
    if(button){button.disabled=true;button.textContent="Calculando envío…";}
    setCheckoutMessage("Consultando las opciones disponibles…");
    try{
      const {data,error}=await client().functions.invoke("shipping-quotes",{body:{items:items(),address,request_id:requestId,guest_token:requestToken}});
      if(generation!==quoteGeneration||captured!==fingerprint())return;
      if(error)throw new Error("No se pudo consultar el envío. Reintentá o elegí retiro personal coordinado.");
      if(data?.status!=="quoted"||!data?.quote_token||!Number.isFinite(Number(data.price))||Number(data.price)<0||!data.expires_at||Date.parse(data.expires_at)<=Date.now()+5000){
        const errors=Array.isArray(data?.error_codes)?data.error_codes:[];
        const unconfigured=data?.status==="needs_configuration"||errors.some(code=>/config|credential|provider|weight|dimension|packaging/i.test(String(code)));
        throw new Error(unconfigured?"El envío a domicilio todavía no está habilitado para este pedido. Podés elegir retiro personal coordinado o consultarnos.":"No hay una tarifa de envío disponible. Reintentá o elegí retiro personal coordinado.");
      }
      acceptedQuote={quote_id:data.quote_id,quote_token:data.quote_token,price:Number(data.price),expires_at:data.expires_at,service_label:String(data.service_label||"Envío a domicilio")};
      acceptedFingerprint=captured;
      setCheckoutMessage(`${acceptedQuote.service_label}: ${currency(acceptedQuote.price)}. Cotización válida hasta ${new Date(acceptedQuote.expires_at).toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"})}.`);
    }catch(error){if(generation===quoteGeneration)setCheckoutMessage(error.message||"No se pudo cotizar el envío.",true);}
    finally{if(button){button.disabled=false;button.textContent="Calcular envío";}renderTotal();}
  }
  async function validate(){
    const mode=selectedMode();
    if(!["pickup","shipping"].includes(mode))throw new Error("Elegí envío a domicilio o retiro personal coordinado.");
    if(mode==="pickup"&&el("customer-phone")&&String(el("customer-phone").value||"").replace(/\D/g,"").length<8)throw new Error("Ingresá un teléfono para coordinar el retiro.");
    if(mode==="shipping"){
      const error=addressError(readAddress());if(error)throw new Error(error);
      if(!quoteIsCurrent()){invalidate("La cotización falta o venció. Volvé a calcular el envío.");throw new Error("Calculá un envío vigente antes de confirmar el pedido.");}
    }
    return true;
  }
  function payload(){
    const mode=selectedMode();
    if(mode==="pickup")return {mode,request_id:requestId,quote_token:requestToken};
    return {mode,address:readAddress(),quote_token:acceptedQuote?.quote_token||null,quote_id:acceptedQuote?.quote_id||null,request_id:requestId};
  }
  function reset(){
    for(const radio of document.querySelectorAll('input[name="delivery-mode"]'))radio.checked=false;
    setAddress({});if(el("delivery-save-address"))el("delivery-save-address").checked=false;
    if(el("delivery-saved-address"))el("delivery-saved-address").value="";
    syncMode();setCheckoutMessage("");
  }
  async function afterOrderSaved(){
    const consent=el("delivery-save-address")?.checked===true,user=currentUser(),address=readAddress();
    if(consent&&selectedMode()==="shipping"&&user?.supabaseUserId){
      try{
        const {error}=await client().rpc("save_my_delivery_address",{p_address:address,p_id:null,p_make_default:false});if(error)throw error;
        await loadAddresses();
      }catch(error){if(typeof toast==="function")toast("Tu pedido quedó guardado. No pudimos guardar la dirección en tu perfil; podés agregarla más tarde.");}
    }
    reset();
  }
  function mountCheckout(){
    const form=el("checkout-form");if(!form||el("checkout-delivery-fields"))return;
    const wrap=document.createElement("div");wrap.id="checkout-delivery-fields";wrap.className="full-span delivery-checkout";
    wrap.innerHTML=`<fieldset class="delivery-mode"><legend>¿Cómo querés recibir tu pedido?</legend><label><input type="radio" name="delivery-mode" value="shipping" required><span><strong>Envío a domicilio</strong><small>Calculá el precio final antes de confirmar.</small></span></label><label><input type="radio" name="delivery-mode" value="pickup" required><span><strong>Retiro personal coordinado</strong><small>Entrega $0 · coordinamos el lugar y horario.</small></span></label></fieldset><p id="delivery-pickup-note" class="delivery-note hidden">El retiro no lleva cargos adicionales de transporte ni embalaje de envío. Cuando el pedido esté listo nos pondremos en contacto para coordinarlo.</p><div id="delivery-shipping-fields" class="hidden"><label id="delivery-saved-address-wrap" class="hidden" for="delivery-saved-address">Tus direcciones<select id="delivery-saved-address"><option value="">Usar una dirección nueva</option></select></label><div class="delivery-address-grid">${addressFields("delivery-address")}</div><label id="delivery-save-address-wrap" class="delivery-checkbox hidden"><input id="delivery-save-address" type="checkbox"><span>Guardar esta dirección para futuras compras</span></label><p class="muted delivery-small">Cambiar estos datos no modifica una dirección que ya tengas guardada.</p><button id="delivery-quote-button" type="button" class="btn secondary full">Calcular envío</button></div><p id="delivery-checkout-message" role="status" aria-live="polite"></p><div id="delivery-checkout-total" class="delivery-checkout-total" aria-live="polite"></div>`;
    form.insertBefore(wrap,form.querySelector(".checkout-note")||form.querySelector('button[type="submit"]'));
    for(const radio of wrap.querySelectorAll('input[name="delivery-mode"]'))radio.addEventListener("change",syncMode);
    el("delivery-shipping-fields").addEventListener("input",event=>{if(event.target.id!=="delivery-save-address")invalidate();});
    el("delivery-saved-address").addEventListener("change",event=>{const address=addresses.find(a=>String(a.id)===event.target.value);setAddress(address||{});el("delivery-save-address").checked=false;invalidate();});
    el("delivery-quote-button").addEventListener("click",quote);
    syncMode();renderCheckoutAddresses();
    if(typeof MutationObserver!=="undefined")new MutationObserver(()=>{if(!el("checkout-modal")?.classList.contains("hidden")){renderTotal();if(currentUser())loadAddresses();}}).observe(el("checkout-modal"),{attributes:true,attributeFilter:["class"]});
  }
  function mountProfile(){
    const section=el("section-profile");if(!section||el("delivery-profile-addresses"))return;
    const node=document.createElement("div");node.id="delivery-profile-addresses";node.className="card delivery-profile-card";
    node.innerHTML='<div class="delivery-panel-heading"><div><h3>Mis direcciones</h3><p class="muted">Solo vos podés consultar y administrar estas direcciones.</p></div><button id="delivery-new-address" class="btn secondary" type="button">Agregar dirección</button></div><p id="delivery-address-profile-message" role="status" aria-live="polite"></p><div id="delivery-address-list"></div><form id="delivery-profile-form" class="hidden"><h4 id="delivery-profile-form-title">Nueva dirección</h4><div id="delivery-profile-fields" class="delivery-address-grid"></div><label class="delivery-checkbox"><input id="delivery-profile-default" type="checkbox"><span>Usar como dirección predeterminada</span></label><div class="delivery-action-row"><button type="submit" class="btn primary">Guardar dirección</button><button id="delivery-address-cancel" type="button" class="btn ghost">Cancelar</button></div></form>';
    section.appendChild(node);el("delivery-new-address").onclick=()=>openAddressEditor(null);el("delivery-address-cancel").onclick=()=>el("delivery-profile-form").classList.add("hidden");
    el("delivery-profile-form").onsubmit=saveProfileAddress;
  }
  function renderAddressList(){
    const list=el("delivery-address-list");if(!list)return;
    list.innerHTML=addresses.map(a=>`<article class="delivery-address-card"><div><strong>${e(a.label||a.recipient)}${a.is_default?' <span class="delivery-badge">Predeterminada</span>':""}</strong><p>${e(a.recipient)} · ${e(a.phone)}<br>${e(a.street)} ${e(a.number)}${a.floor?` · piso ${e(a.floor)}`:""}${a.apartment?` · depto. ${e(a.apartment)}`:""}<br>${e(a.city)}, ${e(a.province)} · CP ${e(a.postal_code)}</p></div><div class="delivery-action-row"><button type="button" class="btn ghost" data-delivery-edit="${e(a.id)}">Editar</button>${a.is_default?"":`<button type="button" class="btn ghost" data-delivery-default="${e(a.id)}">Predeterminar</button>`}<button type="button" class="btn ghost" data-delivery-delete="${e(a.id)}">Eliminar</button></div></article>`).join("")||'<p class="muted">Todavía no tenés direcciones guardadas.</p>';
    for(const button of list.querySelectorAll("[data-delivery-edit]"))button.onclick=()=>openAddressEditor(addresses.find(a=>String(a.id)===button.dataset.deliveryEdit));
    for(const button of list.querySelectorAll("[data-delivery-default]"))button.onclick=()=>mutateAddress(button,"default");
    for(const button of list.querySelectorAll("[data-delivery-delete]"))button.onclick=()=>mutateAddress(button,"delete");
  }
  function openAddressEditor(address){
    profileEditing=address?.id||null;el("delivery-profile-form-title").textContent=address?"Editar dirección":"Nueva dirección";
    el("delivery-profile-fields").innerHTML=addressFields("delivery-profile-address",address||{},true);el("delivery-profile-default").checked=!!address?.is_default;
    el("delivery-profile-form").classList.remove("hidden");el("delivery-profile-address-recipient")?.focus();
  }
  async function saveProfileAddress(event){
    event.preventDefault();if(!currentUser())return;
    const address=readAddress("delivery-profile-address"),error=addressError(address),message=el("delivery-address-profile-message");
    if(error){message.textContent=error;return;}
    const button=event.submitter||event.target.querySelector('[type="submit"]');button.disabled=true;message.textContent="Guardando dirección…";
    try{
      const {error}=await client().rpc("save_my_delivery_address",{p_address:address,p_id:profileEditing,p_make_default:el("delivery-profile-default").checked});if(error)throw error;
      await loadAddresses();message.textContent="Dirección guardada.";el("delivery-profile-form").classList.add("hidden");
    }catch(error){message.textContent=error.message||"No se pudo guardar la dirección.";}finally{button.disabled=false;}
  }
  async function mutateAddress(button,action){
    const id=button.dataset[action==="delete"?"deliveryDelete":"deliveryDefault"],address=addresses.find(a=>String(a.id)===id);if(!address||!currentUser())return;
    if(action==="delete"&&!window.confirm("¿Eliminar esta dirección de tu cuenta? Los pedidos anteriores conservarán su dirección de entrega."))return;
    button.disabled=true;
    try{
      const {error}=action==="delete"?await client().rpc("delete_my_delivery_address",{p_id:id}):await client().rpc("save_my_delivery_address",{p_address:cleanAddress(address),p_id:id,p_make_default:true});if(error)throw error;
      await loadAddresses();el("delivery-address-profile-message").textContent=action==="delete"?"Dirección eliminada.":"Dirección predeterminada actualizada.";
    }catch(error){el("delivery-address-profile-message").textContent=error.message||"No se pudo actualizar la dirección.";}finally{button.disabled=false;}
  }
  function renderProfile(){mountProfile();if(currentUser())loadAddresses();}
  function numericField(name,label,value,min=0,step="0.01"){
    return `<label>${e(label)}<input name="${e(name)}" type="number" min="${min}" step="${step}" value="${e(value??"")}"></label>`;
  }
  async function loadAdmin(){
    if(currentUser()?.role!=="admin")return;
    const target=el("delivery-admin-content")||el("section-delivery");if(!target)return;
    target.innerHTML='<p role="status">Cargando configuración de entregas…</p>';
    try{
      const {data,error}=await client().rpc("admin_delivery_settings");if(error)throw error;if(currentUser()?.role!=="admin")return;
      settings=data||{};renderAdminSettings(target);
    }catch(error){target.innerHTML=`<p class="delivery-error" role="alert">${e(error.message||"No se pudo cargar la configuración.")}</p>`;}
  }
  function renderAdminSettings(target){
    const origin=settings.origin||{},providers=settings.providers||[],boxes=settings.boxes||[],dims=settings.products||[];
    settings.quotes=(settings.quotes||[]).map(q=>({...q,service_label:q.service_label||q.selected?.label,base_price:q.base_price??q.selected?.base_price_ars,margin_amount:q.margin_amount??q.selected?.margin_ars,packaging_cost:q.packaging_cost??q.packaging_cost_ars}));
    target.innerHTML=`<form id="delivery-settings-form"><h3>Origen privado</h3><p class="muted">Los envíos salen de Caballito, CABA. La dirección exacta se usa únicamente en logística y no se publica en el catálogo.</p><div class="delivery-address-grid">${["street","number","city","province","postal_code","phone"].map(key=>`<label>${e(labels[key])}<input name="origin-${key}" value="${e(origin[key]||({city:"Caballito",province:"Ciudad Autónoma de Buenos Aires"}[key])||"")}" maxlength="120" ${["city","province"].includes(key)?"readonly":""}></label>`).join("")}</div><h3>Transportistas</h3><p class="delivery-note">Las cotizaciones reales requieren credenciales y acceso comercial habilitado. Activar un transportista no genera tarifas si esa integración todavía no está configurada. Los márgenes iniciales son provisionales.</p><div class="delivery-provider-grid">${providers.map(p=>`<article class="delivery-settings-item" data-provider="${e(p.code)}"><h4>${e(providerNames[p.code]||p.code)}</h4><label class="delivery-checkbox"><input name="provider-enabled" type="checkbox" ${p.enabled?"checked":""}><span>Activar consultas</span></label>${numericField("provider-margin","Margen de seguridad (%)",p.margin_percent)}<p class="muted">${p.configured?"Credenciales configuradas; disponibilidad sujeta a la API.":"Pendiente de credenciales / contrato y configuración de API."}</p></article>`).join("")}</div><h3>Embalaje de envío</h3><p class="muted">Medidas internas de cajas y límites de peso. El backend elige un embalaje válido para el pedido completo. Cotizar no descuenta inventario.</p><div id="delivery-admin-boxes">${boxes.map(box=>boxEditor(box)).join("")}</div><button id="delivery-add-box" class="btn secondary" type="button">Agregar caja</button><h3>Datos logísticos de productos</h3><p class="muted">Peso y dimensiones de una unidad lista para embalar. Si faltan datos, el envío queda sin cotización; no se inventa un costo.</p><div class="delivery-product-dimensions">${dims.map(p=>`<details class="delivery-settings-item" data-dimension-product="${e(p.product_id)}"><summary>${e(p.name)}</summary><div class="delivery-address-grid">${numericField("weight_g","Peso (g)",p.weight_g)}${numericField("length_cm","Largo (cm)",p.length_cm)}${numericField("width_cm","Ancho (cm)",p.width_cm)}${numericField("height_cm","Alto (cm)",p.height_cm)}</div></details>`).join("")||'<p class="muted">Sin productos disponibles.</p>'}</div><p id="delivery-admin-message" role="status" aria-live="polite"></p><button type="submit" class="btn primary">Guardar configuración logística</button></form><h3>Últimas cotizaciones</h3><p class="muted">Historial privado de tarifas y decisiones. Los clientes reciben únicamente el precio final.</p><div class="table-wrap delivery-quotes-table"><table><thead><tr><th>Fecha</th><th>Estado</th><th>Servicio</th><th>Tarifa</th><th>Margen</th><th>Embalaje</th><th>Final</th></tr></thead><tbody>${(settings.quotes||[]).map(q=>`<tr><td>${e(new Date(q.created_at).toLocaleString("es-AR"))}</td><td>${e(q.status)}</td><td>${e(q.service_label||q.provider_code||"Sin servicio")}</td><td>${q.base_price==null&&q.base_rate_ars==null?"—":e(currency(q.base_price??q.base_rate_ars))}</td><td>${q.margin_amount==null&&q.margin_ars==null?"—":e(currency(q.margin_amount??q.margin_ars))}</td><td>${q.packaging_cost==null&&q.packaging_ars==null?"—":e(currency(q.packaging_cost??q.packaging_ars))}</td><td>${q.price==null?"Sin tarifa":e(currency(q.price))}</td></tr>`).join("")||'<tr><td colspan="7">Todavía no hay cotizaciones.</td></tr>'}</tbody></table></div>`;
    el("delivery-settings-form").onsubmit=saveAdminSettings;
    el("delivery-add-box").onclick=()=>{const block=document.createElement("div");block.innerHTML=boxEditor({id:uuid(),name:""});el("delivery-admin-boxes").appendChild(block.firstElementChild);};
    el("delivery-admin-boxes").addEventListener("click",event=>{const button=event.target.closest("[data-remove-box]");if(button)button.closest("[data-box-id]").remove();});
    target.insertAdjacentHTML("beforeend",adminQuoteDetails(settings.quotes));
  }
  function adminQuoteDetails(quotes){
    return quotes.map(q=>`<details class="delivery-settings-item"><summary>${e(new Date(q.created_at).toLocaleString("es-AR"))} · comparación completa</summary>${(q.rates||[]).map(r=>`<p><strong>${e(providerNames[r.code]||r.code)} · ${e(r.label)}</strong><br>Tarifa: ${e(currency(r.base_price_ars))} · margen ${e(r.margin_percent)}%: ${e(currency(r.margin_ars))} · embalaje: ${e(currency(r.packaging_cost_ars))}<br>Precio final: <strong>${e(currency(r.final_price_ars))}</strong>${q.selected?.code===r.code&&q.selected?.service_code===r.service_code?" · seleccionada":""}</p>`).join("")||'<p class="muted">No se recibió una tarifa válida.</p>'}${(q.provider_results||[]).map(r=>`<p class="muted">${e(providerNames[r.code]||r.code)}: ${e(r.status||r.error||r.error_code||"Consulta registrada")}</p>`).join("")}${(q.error_codes||[]).length?`<p class="delivery-error">Configuración pendiente: ${q.error_codes.map(e).join(", ")}</p>`:""}</details>`).join("");
  }
  function boxEditor(box){
    return `<article class="delivery-settings-item" data-box-id="${e(box.id)}"><div class="delivery-panel-heading"><label>Nombre de la caja<input name="name" value="${e(box.name)}" maxlength="100" required></label><button type="button" class="btn ghost" data-remove-box>Quitar</button></div><div class="delivery-address-grid">${numericField("length_cm","Largo interno (cm)",box.length_cm,0.01)}${numericField("width_cm","Ancho interno (cm)",box.width_cm,0.01)}${numericField("height_cm","Alto interno (cm)",box.height_cm,0.01)}${numericField("weight_g","Peso de caja / protección (g)",box.weight_g)}${numericField("max_weight_g","Peso máximo total (g)",box.max_weight_g,1)}${numericField("cost_ars","Costo de caja y otros componentes ($)",box.cost_ars)}${numericField("protection_cost_ars","Costo de protección ($)",box.protection_cost_ars)}</div></article>`;
  }
  async function saveAdminSettings(event){
    event.preventDefault();if(settingsBusy||currentUser()?.role!=="admin")return;settingsBusy=true;
    const message=el("delivery-admin-message"),button=event.submitter||event.target.querySelector('[type="submit"]');button.disabled=true;message.textContent="Guardando configuración…";
    const value=(node,name)=>node.querySelector(`[name="${name}"]`)?.value||"",number=(node,name)=>{const raw=value(node,name);return raw===""?null:Number(raw);};
    const next={origin:Object.fromEntries(["street","number","city","province","postal_code","phone"].map(k=>[k,value(event.target,`origin-${k}`).trim()])),providers:[...event.target.querySelectorAll("[data-provider]")].map(n=>({code:n.dataset.provider,enabled:n.querySelector('[name="provider-enabled"]').checked,margin_percent:number(n,"provider-margin")})),boxes:[...event.target.querySelectorAll("[data-box-id]")].map(n=>({id:n.dataset.boxId,name:value(n,"name").trim(),...Object.fromEntries(["length_cm","width_cm","height_cm","weight_g","max_weight_g","cost_ars","protection_cost_ars"].map(k=>[k,number(n,k)]))})),products:[...event.target.querySelectorAll("[data-dimension-product]")].map(n=>({product_id:n.dataset.dimensionProduct,...Object.fromEntries(["weight_g","length_cm","width_cm","height_cm"].map(k=>[k,number(n,k)]))}))};
    try{const {error}=await client().rpc("admin_save_delivery_settings",{p_settings:next});if(error)throw error;message.textContent="Configuración guardada.";invalidate();}
    catch(error){message.textContent=error.message||"No se pudo guardar la configuración.";}finally{settingsBusy=false;button.disabled=false;}
  }
  async function renderAdminOrder(orderId,target){
    const node=typeof target==="string"?el(target):target;if(!node||currentUser()?.role!=="admin")return;
    node.dataset.deliveryOrder=String(orderId);node.innerHTML='<h3>Entrega y seguimiento</h3><p role="status">Cargando logística…</p>';
    try{
      const {data,error}=await client().rpc("admin_order_delivery",{p_order_id:orderId});if(error)throw error;
      if(currentUser()?.role!=="admin"||node.dataset.deliveryOrder!==String(orderId))return;
      const d=data?.delivery||data;if(!d?.mode){node.innerHTML='<h3>Entrega y seguimiento</h3><p class="muted">Pedido anterior al sistema de entregas. Su total y condiciones se conservan.</p>';return;}
      const pickup=d.mode==="pickup",address=d.address||{},statusOptions=pickup?["pickup_pending","pickup_ready","picked_up"]:["pending","dispatched","in_transit","delivered","incident"];
      const rawQuote=d.snapshot?.selected||d.quote_snapshot||d.quote||d;
      const quote={...rawQuote,service_label:rawQuote.service_label||rawQuote.label||d.snapshot?.service,base_price:rawQuote.base_price??rawQuote.base_price_ars,packaging_cost:rawQuote.packaging_cost??rawQuote.packaging_cost_ars};
      if(d.charged_ars!=null)d.price=d.charged_ars;
      if(Array.isArray(d.history))d.history=d.history.map(h=>({...h,logistics_status:h.change?.after?.logistics_status||h.logistics_status}));
      node.innerHTML=`<h3>Entrega y seguimiento</h3><strong>${pickup?"Retiro personal coordinado":"Envío a domicilio"}</strong>${pickup?'<p>Sin transporte ni embalaje adicional de envío.</p>':`<p>${e(address.recipient)} · ${e(address.phone)}<br>${e(address.street)} ${e(address.number)}${address.floor?` · piso ${e(address.floor)}`:""}${address.apartment?` · depto. ${e(address.apartment)}`:""}<br>${e(address.city)}, ${e(address.province)} · ${e(address.postal_code)}${address.instructions?`<br>${e(address.instructions)}`:""}</p><dl class="delivery-cost-list"><div><dt>Servicio</dt><dd>${e(quote.service_label||d.service_label||"—")}</dd></div><div><dt>Tarifa original</dt><dd>${e(currency(quote.base_price??quote.base_rate_ars))}</dd></div><div><dt>Margen aplicado</dt><dd>${e(currency(quote.margin_amount??quote.margin_ars))}${quote.margin_percent!=null?` (${e(quote.margin_percent)}%)`:""}</dd></div><div><dt>Embalaje</dt><dd>${e(currency(quote.packaging_cost??quote.packaging_ars))}</dd></div><div><dt>Cobrado al cliente</dt><dd>${e(currency(d.price??d.shipping_price??quote.price))}</dd></div><div><dt>Diferencia del despacho</dt><dd>${d.actual_cost_ars==null?"Pendiente de costo real":e(currency((Number(d.price??d.shipping_price??quote.price)||0)-Number(d.actual_cost_ars)))}</dd></div></dl>`}<form class="delivery-order-form"><div class="delivery-address-grid"><label>Estado logístico<select name="logistics_status">${statusOptions.map(s=>`<option value="${s}" ${d.logistics_status===s?"selected":""}>${e(statusNames[s])}</option>`).join("")}</select></label>${pickup?"":`${numericField("actual_cost_ars","Costo real total de despacho y embalaje ($)",d.actual_cost_ars)}<label>Código de seguimiento<input name="tracking_code" maxlength="150" value="${e(d.tracking_code)}"></label><label>Enlace de seguimiento (https)<input type="url" name="tracking_url" value="${e(d.tracking_url)}" placeholder="https://..."></label>`}</div><p class="muted delivery-small">Este seguimiento no cambia el estado de producción ni marca automáticamente el pedido como Entregado.</p><p class="delivery-order-message" role="status" aria-live="polite"></p><button class="btn secondary" type="submit">Guardar seguimiento</button></form>${Array.isArray(d.history)?`<details><summary>Historial logístico (${d.history.length})</summary>${d.history.map(h=>`<p>${e(statusNames[h.logistics_status]||h.logistics_status||h.status||"Actualización")} · ${e(new Date(h.created_at).toLocaleString("es-AR"))}</p>`).join("")}</details>`:""}`;
      node.querySelector("form").onsubmit=async event=>{
        event.preventDefault();if(currentUser()?.role!=="admin")return;
        const form=event.target,button=event.submitter||form.querySelector('[type="submit"]'),message=form.querySelector(".delivery-order-message"),read=name=>form.querySelector(`[name="${name}"]`)?.value||"";
        button.disabled=true;message.textContent="Guardando seguimiento…";
        try{
          const rawCost=read("actual_cost_ars"),tracking=read("tracking_url").trim();
          if(tracking&&(!/^https:\/\//i.test(tracking)||!URL.canParse(tracking)))throw new Error("El enlace de seguimiento debe ser una dirección HTTPS válida.");
          const update={logistics_status:read("logistics_status"),actual_cost_ars:pickup?null:rawCost===""?null:Number(rawCost),tracking_code:pickup?null:read("tracking_code").trim(),tracking_url:pickup?null:tracking};
          const {error}=await client().rpc("admin_update_order_delivery",{p_order_id:orderId,p_update:update});if(error)throw error;
          await renderAdminOrder(orderId,node);if(typeof toast==="function")toast("Seguimiento guardado.");
        }catch(error){message.textContent=error.message||"No se pudo actualizar la logística.";}finally{button.disabled=false;}
      };
      if(!pickup&&Array.isArray(d.snapshot?.rates))node.insertAdjacentHTML("beforeend",adminQuoteDetails([{created_at:d.updated_at,rates:d.snapshot.rates,selected:d.snapshot.selected}]));
    }catch(error){node.innerHTML=`<h3>Entrega y seguimiento</h3><p class="delivery-error">${e(error.message||"No se pudo cargar la logística.")}</p>`;}
  }
  function customerHtml(d){
    if(!d?.mode)return "";
    if(d.charged_ars!=null)d={...d,price:d.charged_ars};
    const pickup=d.mode==="pickup",safeTracking=typeof d.tracking_url==="string"&&/^https:\/\//i.test(d.tracking_url)&&URL.canParse(d.tracking_url)?d.tracking_url:null;
    return `<div class="delivery-customer-summary"><strong>${pickup?"Retiro personal coordinado":"Envío a domicilio"}</strong><p>${e(statusNames[d.logistics_status]||(pickup?"Retiro por coordinar":"Pendiente de despacho"))} · ${e(currency(d.price??d.shipping_price??0))}</p>${!pickup&&d.tracking_code?`<p>Seguimiento: ${e(d.tracking_code)}</p>`:""}${!pickup&&safeTracking?`<a class="btn ghost" href="${e(safeTracking)}" target="_blank" rel="noopener noreferrer">Seguir envío</a>`:""}</div>`;
  }
  window.cubicaDelivery={refreshCheckout:()=>{renderTotal();},validate,payload,reset,afterOrderSaved,invalidate,requestQuote:quote,renderProfile,loadAdmin,renderAdminOrder,customerHtml,addressError,cleanAddress};
  window.addEventListener("cubica:cart-updated",()=>invalidate("Los productos cambiaron. Calculá nuevamente el envío."));
  window.addEventListener("cubica:auth-ready",()=>{
    const nextIdentity=currentUser()?.supabaseUserId||"",changed=nextIdentity!==identity;identity=nextIdentity;
    if(changed){
      addressGeneration++;addresses=[];profileEditing=null;invalidate();setAddress({});
      renderCheckoutAddresses();renderAddressList();el("delivery-profile-form")?.classList.add("hidden");
      if(el("delivery-save-address"))el("delivery-save-address").checked=false;
    }
    if(currentUser())loadAddresses();
    if(currentUser()?.role!=="admin"){settings=null;const admin=el("delivery-admin-content");if(admin)admin.textContent="";}
    renderTotal();
  });
  document.addEventListener("DOMContentLoaded",()=>{mountCheckout();mountProfile();if(currentUser())loadAddresses();});
})();

