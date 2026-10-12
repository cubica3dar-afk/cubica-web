const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const crypto=require("node:crypto").webcrypto;
const source=fs.readFileSync(path.join(__dirname,"../js/delivery-ui.js"),"utf8");
const keys=["recipient","phone","street","number","floor","apartment","city","province","postal_code","instructions","label"];
const address={recipient:"Diego Pérez",phone:"1155558888",street:"Avenida San Martín",number:"1653",floor:"1",apartment:"A",city:"Córdoba",province:"Córdoba",postal_code:"5000",instructions:"Timbre A",label:"Casa"};
const quoted=()=>({status:"quoted",quote_id:"quote-1",quote_token:"a".repeat(64),price:1500,expires_at:new Date(Date.now()+60000).toISOString(),service_label:"Servicio validado"});

function setup({mode="shipping",user={supabaseUserId:"user-1",role:"customer"},saved=[],quoteData=quoted(),mount=false,authReady=true}={}){
  const nodes=new Map(),listeners={},domListeners=[],calls=[],events=[];
  const node=id=>{
    const classes=new Set(),handlers={};
    return {id,value:"",checked:false,disabled:false,dataset:{},textContent:"",innerHTML:"",handlers,classList:{add(...v){v.forEach(x=>classes.add(x));},remove(...v){v.forEach(x=>classes.delete(x));},contains:x=>classes.has(x),toggle(x,state){const add=state===undefined?!classes.has(x):state;if(add)classes.add(x);else classes.delete(x);}},addEventListener:(name,fn)=>handlers[name]=fn,querySelectorAll:()=>[],querySelector:()=>null,closest(){return this.label;}};
  };
  const radios=[Object.assign(node("shipping"),{value:"shipping",checked:mode==="shipping"}),Object.assign(node("pickup"),{value:"pickup",checked:mode==="pickup"})];
  for(const key of keys){const n=node(`delivery-address-${key}`);n.label=node(`label-${key}`);nodes.set(n.id,n);}
  for(const id of ["customer-name","customer-last-name","customer-phone","delivery-same-recipient","delivery-save-address","delivery-saved-address","delivery-saved-address-wrap","delivery-save-address-wrap","delivery-checkout-message","delivery-checkout-total","delivery-address-list","delivery-address-profile-message","delivery-profile-form","delivery-quote-button","delivery-shipping-fields","delivery-pickup-note"])nodes.set(id,node(id));
  nodes.get("customer-name").value="Diego";nodes.get("customer-last-name").value="Pérez";nodes.get("customer-phone").value="1155558888";nodes.get("delivery-same-recipient").checked=true;
  let context;
  const parse=html=>{
    for(const match of html.matchAll(/<(input|select|textarea|div|p|label)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){
      const id=match[3],n=nodes.get(id)||node(id);n.value=match[2].match(/\bvalue="([^"]*)"/)?.[1]||"";n.checked=/\schecked(?:\s|$)/.test(match[2]);if(id.startsWith("delivery-address-"))n.label=node(`label-${id}`);nodes.set(id,n);
    }
    nodes.get("delivery-shipping-fields").querySelectorAll=()=>[...nodes.values()].filter(n=>n.id.startsWith("delivery-address-")||["delivery-same-recipient","delivery-save-address","delivery-saved-address","delivery-quote-button"].includes(n.id));
  };
  const form=node("checkout-form");form.insertBefore=()=>{};if(mount)nodes.set(form.id,form);
  context={crypto,Uint8Array,Intl,URL,Date,console,setTimeout,CustomEvent:class{constructor(type){this.type=type;}},session:user,cart:[{productId:"p-1",qty:2,color:"Blanco"}],products:[{id:"p-1",price:1000}],document:{getElementById:id=>nodes.get(id)||null,querySelector:selector=>selector==='input[name="delivery-mode"]:checked'?radios.find(r=>r.checked)||null:null,querySelectorAll:selector=>selector==='input[name="delivery-mode"]'?radios:[],addEventListener:(type,fn)=>domListeners.push(fn),createElement:()=>{const n=node("");Object.defineProperty(n,"innerHTML",{set:parse,get:()=>""});n.querySelectorAll=selector=>selector==='input[name="delivery-mode"]'?radios:[];return n;}},window:{cubicaCheckoutAuthReady:authReady,addEventListener:(type,fn)=>listeners[type]=fn,dispatchEvent:event=>events.push(event.type),cubicaSupabase:{rpc:async(name,params)=>{calls.push({name,params});return {data:name==="list_my_delivery_addresses"?saved:[],error:null};},functions:{invoke:async(name,params)=>{calls.push({name,params});return typeof quoteData==="function"?quoteData():{data:quoteData,error:null};}}}}};
  vm.createContext(context);vm.runInContext(source,context);if(mount)domListeners.forEach(fn=>fn());
  return {api:context.window.cubicaDelivery,nodes,context,calls,listeners,events,radios,setAddress(value){for(const key of keys)nodes.get(`delivery-address-${key}`).value=value[key]||"";},fire(id,type="input"){nodes.get(id).handlers[type]?.({target:nodes.get(id)});}};
}

test("destinatario inicial reutiliza nombre completo y contacto del comprador",async()=>{
  const s=setup();s.setAddress({...address,recipient:"Dato anterior",phone:"1144442222"});
  assert.equal(s.api.payload().address.recipient,"Diego Pérez");assert.equal(s.api.payload().address.phone,"1155558888");
  await s.api.requestQuote();assert.equal(await s.api.validate(),true);
  s.nodes.get("customer-phone").value="1166669999";await assert.rejects(s.api.validate(),/vigente/);
  assert.equal(s.api.payload().quote_token,null,"cambiar comprador cambia el snapshot de envío");
});

test("oculta campos duplicados solo cuando se usa el comprador y conserva destinatario explícito",async()=>{
  const s=setup({mount:true});s.setAddress(address);await s.api.refreshCheckout();
  assert.equal(s.nodes.get("delivery-address-recipient").disabled,true);assert.equal(s.nodes.get("delivery-address-recipient").label.classList.contains("hidden"),true);
  s.nodes.get("delivery-same-recipient").checked=false;s.fire("delivery-same-recipient","change");
  assert.equal(s.nodes.get("delivery-address-recipient").disabled,false);assert.equal(s.nodes.get("delivery-address-phone").label.classList.contains("hidden"),false);
  s.nodes.get("delivery-address-recipient").value="Ana Gómez";s.nodes.get("delivery-address-phone").value="1144442222";
  await s.api.requestQuote();s.nodes.get("customer-phone").value="1133331111";s.fire("customer-phone");
  assert.equal(await s.api.validate(),true);assert.equal(s.api.payload().address.recipient,"Ana Gómez");assert.equal(s.api.payload().address.phone,"1144442222");
});

test("elige únicamente la dirección predeterminada entre varias y mantiene privacidad RPC",async()=>{
  const s=setup({saved:[{id:"office",address:{...address,label:"Oficina",street:"Otra calle"},is_default:false},{id:"home",address,is_default:true}]});
  await s.api.refreshCheckout();assert.equal(s.nodes.get("delivery-saved-address").value,"home");assert.equal(s.api.payload().address.street,address.street);assert.equal(s.nodes.get("delivery-same-recipient").checked,true);
  assert.deepEqual(s.calls.map(c=>c.name),["list_my_delivery_addresses"]);assert.equal(s.calls.some(c=>c.name==="save_my_delivery_address"),false);
});

test("dirección predeterminada de otra persona no pierde destinatario ni teléfono",async()=>{
  const other={...address,recipient:"Ana Gómez",phone:"1144442222"};const s=setup({saved:[{id:"family",address:other,is_default:true}]});
  await s.api.refreshCheckout();assert.equal(s.nodes.get("delivery-same-recipient").checked,false);assert.equal(s.api.payload().address.recipient,other.recipient);assert.equal(s.api.payload().address.phone,other.phone);
  s.nodes.get("customer-name").value="Otro nombre";await s.api.refreshCheckout();assert.equal(s.api.payload().address.recipient,other.recipient);
});

test("perfil sin dirección y visitante mantienen campos por completar sin guardar datos",async()=>{
  for(const user of [null,{supabaseUserId:"new-user",role:"customer"}]){
    const s=setup({user});s.nodes.get("customer-name").value="";s.nodes.get("customer-last-name").value="";s.nodes.get("customer-phone").value="";
    await s.api.refreshCheckout();assert.equal(s.api.payload().address.street,"");await assert.rejects(s.api.validate(),/Completá nombre/);assert.equal(s.calls.some(c=>c.name==="save_my_delivery_address"),false);
    if(!user)assert.equal(s.calls.length,0);
  }
});

test("logout borra del DOM el editor privado de direcciones, su mensaje y predeterminada",()=>{
  const s=setup();
  s.nodes.set("delivery-profile-fields",{innerHTML:'<input value="Dirección privada anterior">'});
  s.nodes.set("delivery-profile-default",{checked:true});
  s.nodes.get("delivery-address-profile-message").textContent="Dato de la cuenta anterior";
  s.context.session=null;s.listeners["cubica:auth-ready"]();
  assert.equal(s.nodes.get("delivery-profile-fields").innerHTML,"");
  assert.equal(s.nodes.get("delivery-profile-default").checked,false);
  assert.equal(s.nodes.get("delivery-address-profile-message").textContent,"");
  assert.equal(s.nodes.get("delivery-profile-form").classList.contains("hidden"),true);
});

test("restaura borrador y cotización sin renovar claves ni reemplazar dirección específica",async()=>{
  const first=setup({saved:[{id:"default",address,is_default:true}]});first.setAddress({...address,street:"Compra específica"});await first.api.requestQuote();
  const draft=JSON.parse(JSON.stringify(first.api.exportDraft()));draft.selected_address_id="custom";draft.save_consent=true;
  const reload=setup({saved:[{id:"default",address,is_default:true},{id:"custom",address:{...address,street:"Anterior"},is_default:false}]});
  assert.equal(reload.api.restoreDraft(draft),true);await reload.api.refreshCheckout();const restored=reload.api.exportDraft();
  assert.equal(restored.request_id,draft.request_id);assert.equal(restored.request_token,draft.request_token);assert.equal(restored.accepted_quote.quote_token,draft.accepted_quote.quote_token);assert.equal(restored.address.street,"Compra específica");assert.equal(restored.selected_address_id,"custom");assert.equal(restored.save_consent,true);assert.equal(await reload.api.validate(),true);
});

test("no restaura PII de otra cuenta y eventos Auth repetidos no borran la misma compra",async()=>{
  const first=setup();first.setAddress(address);await first.api.requestQuote();const draft=first.api.exportDraft();
  const other=setup({user:{supabaseUserId:"user-2",role:"customer"}});assert.equal(other.api.restoreDraft(draft),false);assert.equal(other.api.payload().address.street,"");
  first.listeners["cubica:auth-ready"]();assert.equal(first.api.payload().quote_token,draft.accepted_quote.quote_token);
  first.context.session={supabaseUserId:"user-2",role:"customer"};first.listeners["cubica:auth-ready"]();assert.equal(first.api.payload().address.street,"");assert.equal(first.api.payload().quote_token,null);assert.notEqual(first.api.exportDraft().request_id,draft.request_id);
});

test("espera verificación Auth antes de leer direcciones guardadas al iniciar",async()=>{
  const s=setup({authReady:false,mount:true,saved:[{id:"home",address,is_default:true}]});await s.api.refreshCheckout();assert.equal(s.calls.length,0);
  s.context.window.cubicaCheckoutAuthReady=true;await s.api.refreshCheckout();assert.equal(s.nodes.get("delivery-saved-address").value,"home");
});

test("calle y altura eliminan solo duplicación coincidente y preservan nombres numéricos",()=>{
  const s=setup();
  assert.equal(s.api.cleanAddress({...address,street:"Avenida San Martín 1653"}).street,"Avenida San Martín");
  assert.equal(s.api.cleanAddress({...address,street:"25 de Mayo 1653"}).street,"25 de Mayo");
  for(const [street,number] of [["25 de Mayo","25"],["Calle 9","9"],["Ruta 40","40"],["Diagonal 74","1653"],["Avenida 1","1653"]]){
    const value={...address,street,number};assert.equal(s.api.cleanAddress(value).street,street);assert.equal(s.api.addressError(value),"");
  }
  const conflict={...address,street:"Avenida San Martín 2500"};assert.equal(s.api.cleanAddress(conflict).street,conflict.street);assert.match(s.api.addressError(conflict),/altura distinta/);
});

test("retiro requiere contacto 8 a 15 dígitos sin dirección postal ni envío",async()=>{
  const s=setup({mode:"pickup",user:null});
  for(const phone of ["", "1234567","1234567890123456"]){s.nodes.get("customer-phone").value=phone;await assert.rejects(s.api.validate(),/8 a 15/);}
  for(const phone of ["1155558888","+54 9 11 5555-8888"]){s.nodes.get("customer-phone").value=phone;assert.equal(await s.api.validate(),true);}
  assert.equal(s.api.payload().address,undefined);assert.equal(s.calls.length,0);
});

test("falta de transportistas persiste al confirmar y restaurar sin decir cotización vencida",async()=>{
  const s=setup({quoteData:{status:"needs_configuration",error_codes:["providers_not_configured"]}});s.setAddress(address);await s.api.requestQuote();
  const message=s.nodes.get("delivery-checkout-message").textContent;assert.match(message,/todavía no está habilitado/);await assert.rejects(s.api.validate(),/todavía no está habilitado/);assert.equal(s.nodes.get("delivery-checkout-message").textContent,message);assert.doesNotMatch(message,/venció|vencida/);
  const reload=setup();reload.api.restoreDraft(s.api.exportDraft());await assert.rejects(reload.api.validate(),/todavía no está habilitado/);assert.equal(reload.api.payload().quote_token,null);
});

test("vencimiento real invalida una cotización restaurada y bloquea el envío",async()=>{
  const s=setup();s.setAddress(address);await s.api.requestQuote();const draft=s.api.exportDraft();draft.accepted_quote.expires_at=new Date(Date.now()-1000).toISOString();
  const reload=setup();reload.api.restoreDraft(draft);await assert.rejects(reload.api.validate(),/vigente/);assert.match(reload.nodes.get("delivery-checkout-message").textContent,/venció/);assert.equal(reload.api.payload().quote_token,null);
});

test("precio ausente en cotización no se convierte en envío gratuito",async()=>{
  const s=setup({quoteData:{...quoted(),price:null}});s.setAddress(address);await s.api.requestQuote();
  assert.equal(s.api.payload().quote_token,null);await assert.rejects(s.api.validate(),/tarifa/);assert.match(s.nodes.get("delivery-checkout-total").innerHTML,/Por cotizar/);
});

