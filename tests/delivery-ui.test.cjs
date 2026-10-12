const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const crypto=require("node:crypto").webcrypto;
const source=fs.readFileSync(require("node:path").join(__dirname,"../js/delivery-ui.js"),"utf8");
const address={recipient:"Diego Pérez",phone:"+54 9 11 1234 5678",street:"Av. Rivadavia",number:"5000",floor:"1",apartment:"A",city:"Caballito",province:"Ciudad Autónoma de Buenos Aires",postal_code:"C1405ABC",instructions:"Timbre A",label:"Casa"};

function setup({mode="",user=null,quoteData,rpc}={}){
  const nodes=new Map(),listeners={},calls=[],notifications=[];
  const node=()=>({value:"",checked:false,textContent:"",innerHTML:"",disabled:false,dataset:{},classList:{add(){},remove(){},toggle(){}},querySelectorAll:()=>[]});
  for(const key of Object.keys(address))nodes.set(`delivery-address-${key}`,{...node(),value:address[key]});
  for(const id of ["delivery-quote-button","delivery-checkout-message","delivery-checkout-total","delivery-save-address","delivery-saved-address","delivery-saved-address-wrap","delivery-save-address-wrap","delivery-address-list","delivery-address-profile-message","delivery-profile-form"])nodes.set(id,node());
  const context={crypto,Uint8Array,Intl,URL,Date,console,setTimeout,session:user,cart:[{productId:"p-1",qty:2,color:"Blanco"}],products:[{id:"p-1",price:100}],toast:msg=>notifications.push(msg),document:{getElementById:id=>nodes.get(id)||null,querySelector:selector=>selector==='input[name="delivery-mode"]:checked'&&context.mode?{value:context.mode}:null,querySelectorAll:()=>[],addEventListener:()=>{}},window:{addEventListener:(name,fn)=>listeners[name]=fn,confirm:()=>true,cubicaSupabase:{rpc:async(name,params)=>{calls.push({name,params});return rpc?rpc(name,params):{data:[],error:null};},functions:{invoke:async(name,params)=>{calls.push({name,params});return typeof quoteData==="function"?quoteData(name,params):{data:quoteData||{status:"unavailable",error_codes:["providers_not_configured"]},error:null};}}}},mode};
  vm.createContext(context);vm.runInContext(source,context);
  return {api:context.window.cubicaDelivery,context,nodes,listeners,calls,notifications};
}

test("checkout exige modalidad explícita y retiro no requiere domicilio ni cargos",async()=>{
  const s=setup();await assert.rejects(s.api.validate(),/Elegí envío/);
  s.context.mode="pickup";for(const [id,n] of s.nodes)if(id.startsWith("delivery-address-"))n.value="";
  assert.equal(await s.api.validate(),true);const p=s.api.payload();assert.equal(p.mode,"pickup");assert.equal(p.address,undefined);assert.match(p.request_id,/^[\da-f-]{36}$/);assert.match(p.quote_token,/^[\da-f]{64}$/);
  assert.deepEqual(s.api.payload(),p,"reintentos conservan la misma clave para que backend no duplique");
  s.api.invalidate();assert.notEqual(s.api.payload().request_id,p.request_id);assert.notEqual(s.api.payload().quote_token,p.quote_token);
});

test("valida dirección argentina sin exigir piso/departamento",()=>{
  const s=setup();assert.equal(s.api.addressError({...address,floor:"",apartment:"",instructions:""}),"");assert.equal(s.api.addressError({...address,postal_code:"1405"}),"");
  assert.match(s.api.addressError({...address,recipient:""}),/nombre/);assert.match(s.api.addressError({...address,phone:"123"}),/teléfono válido/);assert.match(s.api.addressError({...address,postal_code:"BAD"}),/código postal argentino/);assert.match(s.api.addressError({...address,province:"Otra"}),/provincia argentina/);
});

test("envío sin tarifa disponible nunca confirma ni inventa precio",async()=>{
  const s=setup({mode:"shipping"});await s.api.requestQuote();await assert.rejects(s.api.validate(),/todavía no está habilitado/);assert.doesNotMatch(s.nodes.get("delivery-checkout-message").textContent,/venció/);
  assert.equal(s.api.payload().quote_token,null);assert.doesNotMatch(s.nodes.get("delivery-checkout-total").innerHTML,/>\$\s*0/);assert.match(s.nodes.get("delivery-checkout-total").innerHTML,/Por cotizar/);
});

test("cotización queda ligada a dirección, cantidades y variantes",async()=>{
  const q={status:"quoted",quote_token:"a".repeat(64),quote_id:"quote-1",price:1500,expires_at:new Date(Date.now()+60000).toISOString(),service_label:"Servicio oficial",margin_percent:99,base_price:1};
  const s=setup({mode:"shipping",quoteData:q});await s.api.requestQuote();assert.equal(await s.api.validate(),true);
  const body=s.calls.find(c=>c.name==="shipping-quotes").params.body;assert.deepEqual(JSON.parse(JSON.stringify(body.items)),[{product_id:"p-1",qty:2,color:"Blanco"}]);assert.equal(body.address.postal_code,address.postal_code);assert.equal(body.items[0].price,undefined);assert.match(body.guest_token,/^[\da-f]{64}$/);
  assert.equal(s.api.payload().quote_token,q.quote_token);assert.match(s.nodes.get("delivery-checkout-message").textContent,/Servicio oficial/);assert.doesNotMatch(s.nodes.get("delivery-checkout-message").textContent,/99/);
  s.context.cart[0].color="Negro";await assert.rejects(s.api.validate(),/vigente/);assert.equal(s.api.payload().quote_token,null);
  await s.api.requestQuote();s.nodes.get("delivery-address-number").value="5001";await assert.rejects(s.api.validate(),/vigente/);
  await s.api.requestQuote();s.context.cart[0].qty=3;await assert.rejects(s.api.validate(),/vigente/);
});

test("no acepta una tarifa vencida, negativa o sin estado quoted",async()=>{
  for(const q of [{status:"quoted",price:-1,expires_at:new Date(Date.now()+60000).toISOString()},{status:"quoted",price:100,expires_at:new Date(Date.now()-1000).toISOString()},{status:"unavailable",price:100,expires_at:new Date(Date.now()+60000).toISOString()}]){
    const s=setup({mode:"shipping",quoteData:{...q,quote_token:"b".repeat(64)}});await s.api.requestQuote();assert.equal(s.api.payload().quote_token,null);await assert.rejects(s.api.validate(),/vigente|tarifa/);
  }
});

test("respuesta demorada se ignora después de modificar checkout",async()=>{
  let finish;const s=setup({mode:"shipping",quoteData:()=>new Promise(resolve=>finish=resolve)});const pending=s.api.requestQuote();s.api.invalidate();finish({data:{status:"quoted",price:1,quote_token:"c".repeat(64),expires_at:new Date(Date.now()+60000).toISOString()},error:null});await pending;assert.equal(s.api.payload().quote_token,null);
});

test("direcciones privadas se cargan del RPC y se borran de memoria al cambiar cuenta",async()=>{
  const s=setup({mode:"shipping",user:{role:"customer",supabaseUserId:"user-1"},rpc:async()=>({data:[{id:"addr-1",address,is_default:true}],error:null})});
  s.api.renderProfile();await new Promise(resolve=>setTimeout(resolve,0));assert.match(s.nodes.get("delivery-saved-address").innerHTML,/Casa/);assert.match(s.nodes.get("delivery-address-list").innerHTML,/Av\. Rivadavia/);
  s.context.session=null;s.listeners["cubica:auth-ready"]();assert.doesNotMatch(s.nodes.get("delivery-address-list").innerHTML,/Rivadavia/);assert.equal(s.nodes.get("delivery-address-recipient").value,"");
});

test("no guarda dirección sin consentimiento; un fallo al guardarla no pierde la venta",async()=>{
  const s=setup({mode:"shipping",user:{role:"customer",supabaseUserId:"user-1"},rpc:async()=>({data:null,error:{message:"fallo"}})});
  await s.api.afterOrderSaved();assert.equal(s.calls.filter(c=>c.name==="save_my_delivery_address").length,0);
  s.context.mode="shipping";for(const [key,value]of Object.entries(address))s.nodes.get(`delivery-address-${key}`).value=value;s.nodes.get("delivery-save-address").checked=true;
  await s.api.afterOrderSaved();assert.equal(s.calls.filter(c=>c.name==="save_my_delivery_address").length,1);assert.match(s.notifications[0],/pedido quedó guardado/);
});

test("seguimiento público omite costos internos y rechaza enlaces inseguros",()=>{
  const s=setup();const html=s.api.customerHtml({mode:"shipping",logistics_status:"dispatched",price:1500,margin_percent:11,base_price:1000,packaging_cost:300,bom:"SECRET",tracking_code:"123",tracking_url:"javascript:alert(1)"});
  assert.match(html,/Despachado/);assert.match(html,/123/);assert.doesNotMatch(html,/javascript|margin|packaging|SECRET|1000/);
  const pickup=s.api.customerHtml({mode:"pickup",logistics_status:"pickup_ready",price:0,tracking_code:"NO",tracking_url:"https://carrier.example/"});assert.match(pickup,/Listo para retirar/);assert.doesNotMatch(pickup,/NO|carrier/);
});

test("respeta charged_ars público y snapshot.selected privado del esquema real",async()=>{
  const selected={code:"andreani",service_code:"standard",label:"Andreani estándar",base_price_ars:2100,margin_percent:10,margin_ars:210,packaging_cost_ars:500,final_price_ars:2810};
  const s=setup({user:{role:"admin",supabaseUserId:"admin-1"},rpc:async()=>({data:{mode:"shipping",address,charged_ars:2810,actual_cost_ars:3000,logistics_status:"dispatched",snapshot:{service:selected.label,selected,rates:[selected]},updated_at:new Date().toISOString(),history:[{created_at:new Date().toISOString(),change:{after:{logistics_status:"dispatched"}}}]},error:null})});
  const form={onsubmit:null},target={dataset:{},innerHTML:"",querySelector:()=>form,insertAdjacentHTML:(_where,html)=>target.innerHTML+=html};
  await s.api.renderAdminOrder("order-1",target);assert.match(target.innerHTML,/Andreani estándar/);assert.match(target.innerHTML,/2\.100/);assert.match(target.innerHTML,/2\.810/);assert.match(target.innerHTML,/-\$\s*190/);assert.match(target.innerHTML,/10%|10 %/);assert.match(target.innerHTML,/Despachado/);
  const customer=s.api.customerHtml({mode:"shipping",charged_ars:2810,logistics_status:"dispatched",snapshot:{selected}});assert.match(customer,/2\.810/);assert.doesNotMatch(customer,/2\.100|Margen|210/);
});

test("refrescar la misma cuenta conserva cotización; cambiar cuenta limpia PII y la invalida",async()=>{
  const s=setup({mode:"shipping",user:{role:"customer",supabaseUserId:"user-1"},quoteData:{status:"quoted",quote_token:"d".repeat(64),price:1000,expires_at:new Date(Date.now()+60000).toISOString()}});
  await s.api.requestQuote();s.listeners["cubica:auth-ready"]();assert.equal(s.api.payload().quote_token,"d".repeat(64));
  s.context.session={role:"customer",supabaseUserId:"user-2"};s.listeners["cubica:auth-ready"]();assert.equal(s.api.payload().quote_token,null);assert.equal(s.nodes.get("delivery-address-recipient").value,"");
});

