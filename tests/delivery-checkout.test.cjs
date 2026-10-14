/* Ejercita el submit real del checkout con un backend controlado, sin pedidos ni emails reales. */
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const source=fs.readFileSync(path.join(__dirname,"../supabase-sales.js"),"utf8");
const requestId="b6deef29-dcf3-4b7a-8b67-6d993e85d955";
const delivery={mode:"shipping",request_id:requestId,quote_token:"a".repeat(64),quote_id:"581dd859-bc40-46c2-b8db-9929d4f82d61",address:{recipient:"Cliente",phone:"1112345678",street:"Rivadavia",number:"5000",city:"Caballito",province:"Ciudad Autónoma de Buenos Aires",postal_code:"1405"}};
const serverOrder={order_id:"b6fe635b-67bd-4f54-bf81-afedaf9a180c",order_number:"CUB-1042",total:3499};

function setup({user=null,respond,validate,turnstile=null}={}){
  const domReady=[],calls=[],writes=[],events=[],steps=[],notifications=[];
  let validateCalls=0,afterSavedCalls=0,resetCalls=0;
  const button={disabled:false,textContent:"Confirmar pedido"},form={querySelector:()=>button,reset(){resetCalls++;steps.push("form-reset");}},nodes={"checkout-form":form,"customer-name":{value:"Cliente de prueba"},"customer-email":{value:"cliente@example.invalid"},"customer-phone":{value:"1112345678"},"payment-method":{value:"Transferencia"},"customer-notes":{value:"Nota"}};
  const context={console:{error(){},log(){}},Date,String,Number,Math,session:user,cart:[{productId:"product-1",qty:2,color:"Blanco"}],products:[{id:"product-1",name:"Velador",price:1000,stock:7}],orders:[],STORAGE:{orders:"orders",products:"products",cart:"cart",quotes:"quotes"},$:id=>nodes[id]||null,read:(_key,fallback)=>fallback,writeLocal:(key,value)=>writes.push({key,value:JSON.parse(JSON.stringify(value))}),calculateOrderSupplyPlan:()=>({products:[],supplies:[]}),toast:message=>notifications.push(message),closeModal:id=>steps.push(`close:${id}`),renderProducts:()=>steps.push("render-products"),renderCart:()=>steps.push("render-cart"),renderOrders:()=>steps.push("render-orders"),renderAnalytics(){},document:{addEventListener:(name,fn)=>{if(name==="DOMContentLoaded")domReady.push(fn);}},window:{addEventListener(){},cubicaTurnstile:turnstile,cubicaSupabase:{rpc:async(name,args)=>{
    calls.push({name,args:JSON.parse(JSON.stringify(args||{}))});
    if(name==="get_customer_orders")return {data:[{id:serverOrder.order_id,order_number:serverOrder.order_number,created_at:new Date().toISOString(),total:serverOrder.total,status:"Pendiente",order_items:[{product_id:"product-1",name:"Velador",qty:2,unit_price:1000,color:"Blanco"}]}],error:null};
    return respond?respond(name,args,calls.filter(c=>c.name==="create_delivery_order").length):{data:serverOrder,error:null};
  }},cubicaDelivery:{validate:async()=>{validateCalls++;if(validate)await validate();},payload:()=>JSON.parse(JSON.stringify(delivery)),afterOrderSaved:async()=>{afterSavedCalls++;steps.push("after-order-saved");assert.equal(context.cart.length,0,"solo guardar dirección después de confirmar el pedido");assert(writes.some(w=>w.key==="orders"&&w.value.some(o=>o.serverSaved)),"pedido persistido antes de guardar dirección opcional");}},loadCubicaCatalogFromSupabase:async()=>steps.push("reload-catalog"),cubicaTrackEvent:(...args)=>events.push(args)}};
  vm.createContext(context);vm.runInContext(source,context);for(const fn of domReady)fn();
  const submit=()=>form.onsubmit({target:form,submitter:button,preventDefault(){}});
  return {context,calls,writes,events,steps,notifications,button,form,submit,counts:()=>({validateCalls,afterSavedCalls,resetCalls})};
}

test("checkout invitado y autenticado usan create_delivery_order y el snapshot seguro de entrega",async()=>{
  for(const user of [null,{role:"customer",supabaseUserId:"0acb1b4d-a367-4363-8bdc-e0030893968b"}]){
    const s=setup({user});await s.submit();const created=s.calls.find(c=>c.name==="create_delivery_order");assert(created);assert.equal(created.args.p_client_order_id,requestId);assert.deepEqual(created.args.p_delivery,delivery);
    assert.deepEqual(created.args.p_items,[{product_id:"product-1",qty:2,color:"Blanco"}]);assert.equal(created.args.p_items[0].price,undefined,"precio de productos lo calcula Supabase");assert.equal(created.args.p_delivery.price,undefined,"importe de envío no proviene del navegador");
    assert.equal(s.calls.some(c=>c.name==="create_public_order"),false);assert.equal(s.context.cart.length,0);assert.equal(s.context.orders[0].total,3499,"el total final es el devuelto por el servidor");
    assert.equal(s.events.length,1);assert.equal(s.events[0][0],"purchase");assert.equal(s.events[0][2].total,3499);assert.equal(s.events[0][2].units,2);assert.equal(s.counts().afterSavedCalls,1);assert.equal(s.counts().resetCalls,1);assert(s.steps.indexOf("after-order-saved")<s.steps.indexOf("form-reset"),"consentimiento y domicilio se leen antes de resetear el formulario");
    assert.equal(s.button.disabled,false);assert.equal(s.button.textContent,"Confirmar pedido");if(user)assert(s.calls.some(c=>c.name==="get_customer_orders"));
  }
});

test("doble submit mientras guarda genera un solo pedido y un solo evento purchase",async()=>{
  let finish,started;const ready=new Promise(resolve=>started=resolve);
  const s=setup({respond:()=>{started();return new Promise(resolve=>finish=resolve);}});
  const first=s.submit();await ready;assert.equal(s.button.disabled,true);await s.submit();assert.equal(s.calls.filter(c=>c.name==="create_delivery_order").length,1);assert.equal(s.counts().validateCalls,1);
  finish({data:serverOrder,error:null});await first;assert.equal(s.context.orders.length,1);assert.equal(s.events.length,1);assert.equal(s.counts().afterSavedCalls,1);assert.equal(s.counts().resetCalls,1);
  await s.submit();assert.equal(s.calls.filter(c=>c.name==="create_delivery_order").length,1,"un submit posterior con carrito vacío tampoco duplica");
});

test("error de red conserva carrito, clave y token para recuperar el mismo pedido al reintentar",async()=>{
  const s=setup({respond:(_name,_args,attempt)=>attempt===1?Promise.reject(new Error("No se pudo recibir la respuesta")):{data:serverOrder,error:null}});
  await s.submit();assert.equal(s.context.cart.length,1);assert.equal(s.context.orders.length,0);assert.equal(s.context.products[0].stock,7);assert.equal(s.counts().afterSavedCalls,0);assert.equal(s.counts().resetCalls,0);assert.equal(s.events.length,0);assert.equal(s.writes.length,0);assert.equal(s.button.disabled,false);
  await s.submit();const requests=s.calls.filter(c=>c.name==="create_delivery_order");assert.equal(requests.length,2);assert.deepEqual(requests[1].args,requests[0].args,"reintento manda exactamente el mismo client ID, request ID, token y contenido");assert.equal(s.context.orders.length,1);assert.equal(s.context.cart.length,0);assert.equal(s.events.length,1);
});

test("RPC ausente no genera una venta local ni descuenta stock",async()=>{
  const s=setup({respond:()=>({data:null,error:{code:"PGRST202",message:"Could not find the function public.create_delivery_order"}})});await s.submit();assert.equal(s.context.orders.length,0);assert.equal(s.context.cart.length,1);assert.equal(s.context.products[0].stock,7);assert.equal(s.writes.length,0);assert.equal(s.events.length,0);assert.equal(s.counts().afterSavedCalls,0);assert.equal(s.counts().resetCalls,0);assert.equal(s.button.disabled,false);
});

test("validación de entrega impide consultar el RPC hasta tener modalidad/cotización válida",async()=>{
  const s=setup({validate:async()=>{throw new Error("Calculá un envío vigente antes de confirmar el pedido.");}});await s.submit();assert.equal(s.calls.length,0);assert.equal(s.context.cart.length,1);assert.equal(s.writes.length,0);assert.match(s.notifications[0],/envío vigente/);assert.equal(s.button.disabled,false);
});

test("Turnstile activo usa la Edge Function y no la RPC pública",async()=>{
  let protectedPayload,completed=0;
  const turnstile={enabled:()=>true,requireToken:async()=>"valid-token",createOrder:async payload=>{protectedPayload=payload;return serverOrder;},complete:()=>completed++,handleFailure(){}};
  const s=setup({turnstile});await s.submit();
  assert.equal(s.calls.some(c=>c.name==="create_delivery_order"),false);assert.equal(protectedPayload.turnstile_token,"valid-token");
  assert.equal(protectedPayload.client_order_id,requestId);assert.equal(protectedPayload.items[0].price,undefined);assert.equal(completed,1);assert.equal(s.context.orders.length,1);
});

