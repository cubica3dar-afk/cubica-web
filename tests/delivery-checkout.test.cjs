/* Ejercita el submit real con una Edge Function controlada, sin pedidos ni emails reales. */
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const source=fs.readFileSync(path.join(__dirname,"../supabase-sales.js"),"utf8");
const requestId="b6deef29-dcf3-4b7a-8b67-6d993e85d955";
const delivery={mode:"shipping",request_id:requestId,quote_token:"a".repeat(64),quote_id:"581dd859-bc40-46c2-b8db-9929d4f82d61",address:{recipient:"Cliente",phone:"1112345678",street:"Rivadavia",number:"5000",city:"Caballito",province:"Ciudad Autónoma de Buenos Aires",postal_code:"1405"}};
const serverOrder={order_id:"b6fe635b-67bd-4f54-bf81-afedaf9a180c",order_number:"CUB-1042",total:3499};

function setup({user=null,edgeRespond,validate,turnstile}={}){
  const domReady=[],calls=[],edgeCalls=[],writes=[],events=[],steps=[],notifications=[];
  let validateCalls=0,afterSavedCalls=0,resetCalls=0,completed=0;
  const button={disabled:false,textContent:"Confirmar pedido"},form={querySelector:()=>button,reset(){resetCalls++;steps.push("form-reset");}},nodes={"checkout-form":form,"customer-name":{value:"Cliente de prueba"},"customer-email":{value:"cliente@example.invalid"},"customer-phone":{value:"1112345678"},"payment-method":{value:"Transferencia"},"customer-notes":{value:"Nota"}};
  const protectedTurnstile=turnstile===undefined?{
    enabled:()=>true,
    requireToken:async()=>"valid-token",
    createOrder:async payload=>{edgeCalls.push(JSON.parse(JSON.stringify(payload)));return edgeRespond?edgeRespond(payload,edgeCalls.length):serverOrder;},
    complete:()=>completed++,handleFailure(){}
  }:turnstile;
  const context={console:{error(){},log(){}},Date,String,Number,Math,session:user,cart:[{productId:"product-1",qty:2,color:"Blanco"}],products:[{id:"product-1",name:"Velador",price:1000,stock:7}],orders:[],STORAGE:{orders:"orders",products:"products",cart:"cart",quotes:"quotes"},$:id=>nodes[id]||null,read:(_key,fallback)=>fallback,writeLocal:(key,value)=>writes.push({key,value:JSON.parse(JSON.stringify(value))}),calculateOrderSupplyPlan:()=>({products:[],supplies:[]}),toast:message=>notifications.push(message),closeModal:id=>steps.push(`close:${id}`),renderProducts:()=>steps.push("render-products"),renderCart:()=>steps.push("render-cart"),renderOrders:()=>steps.push("render-orders"),renderAnalytics(){},document:{addEventListener:(name,fn)=>{if(name==="DOMContentLoaded")domReady.push(fn);}},window:{addEventListener(){},cubicaTurnstile:protectedTurnstile,cubicaSupabase:{rpc:async(name,args)=>{
    calls.push({name,args:JSON.parse(JSON.stringify(args||{}))});
    if(name==="get_customer_orders")return {data:[{id:serverOrder.order_id,order_number:serverOrder.order_number,created_at:new Date().toISOString(),total:serverOrder.total,status:"Pendiente",order_items:[{product_id:"product-1",name:"Velador",qty:2,unit_price:1000,color:"Blanco"}]}],error:null};
    throw new Error(`RPC de pedido inesperada: ${name}`);
  }},cubicaDelivery:{validate:async()=>{validateCalls++;if(validate)await validate();},payload:()=>JSON.parse(JSON.stringify(delivery)),afterOrderSaved:async()=>{afterSavedCalls++;steps.push("after-order-saved");assert.equal(context.cart.length,0,"solo guardar dirección después de confirmar el pedido");assert(writes.some(w=>w.key==="orders"&&w.value.some(o=>o.serverSaved)),"pedido persistido antes de guardar dirección opcional");}},loadCubicaCatalogFromSupabase:async()=>steps.push("reload-catalog"),cubicaTrackEvent:(...args)=>events.push(args)}};
  vm.createContext(context);vm.runInContext(source,context);for(const fn of domReady)fn();
  const submit=()=>form.onsubmit({target:form,submitter:button,preventDefault(){}});
  return {context,calls,edgeCalls,writes,events,steps,notifications,button,form,nodes,submit,counts:()=>({validateCalls,afterSavedCalls,resetCalls,completed})};
}

test("checkout invitado y autenticado usan exclusivamente create-order",async()=>{
  for(const user of [null,{role:"customer",supabaseUserId:"0acb1b4d-a367-4363-8bdc-e0030893968b"}]){
    const s=setup({user});await s.submit();assert.equal(s.edgeCalls.length,1);const created=s.edgeCalls[0];assert.equal(created.client_order_id,requestId);assert.deepEqual(created.delivery,delivery);
    assert.deepEqual(created.items,[{product_id:"product-1",qty:2,color:"Blanco"}]);assert.equal(created.items[0].price,undefined);assert.equal(created.delivery.price,undefined);assert.equal(created.turnstile_token,"valid-token");
    assert.equal(s.calls.some(c=>c.name==="create_delivery_order"||c.name==="create_public_order"),false);assert.equal(s.context.cart.length,0);assert.equal(s.context.orders[0].total,3499);
    assert.equal(s.events.length,1);assert.equal(s.events[0][0],"purchase");assert.equal(s.counts().afterSavedCalls,1);assert.equal(s.counts().resetCalls,1);assert.equal(s.counts().completed,1);if(user)assert(s.calls.some(c=>c.name==="get_customer_orders"));
  }
});

test("doble submit mientras guarda genera una sola llamada protegida",async()=>{
  let finish,started;const ready=new Promise(resolve=>started=resolve);
  const s=setup({edgeRespond:()=>{started();return new Promise(resolve=>finish=resolve);}});
  const first=s.submit();await ready;assert.equal(s.button.disabled,true);await s.submit();assert.equal(s.edgeCalls.length,1);assert.equal(s.counts().validateCalls,1);
  finish(serverOrder);await first;assert.equal(s.context.orders.length,1);assert.equal(s.events.length,1);await s.submit();assert.equal(s.edgeCalls.length,1);
});

test("error de red conserva carrito, datos y la misma identidad de reintento",async()=>{
  const s=setup({edgeRespond:(_payload,attempt)=>attempt===1?Promise.reject(new Error("No se pudo recibir la respuesta")):serverOrder});
  await s.submit();assert.equal(s.context.cart.length,1);assert.equal(s.context.orders.length,0);assert.equal(s.context.products[0].stock,7);assert.equal(s.counts().afterSavedCalls,0);assert.equal(s.counts().resetCalls,0);assert.equal(s.events.length,0);assert.equal(s.writes.length,0);assert.equal(s.nodes["customer-name"].value,"Cliente de prueba");assert.equal(s.nodes["customer-notes"].value,"Nota");
  await s.submit();assert.equal(s.edgeCalls.length,2);assert.deepEqual(s.edgeCalls[1],s.edgeCalls[0]);assert.equal(s.context.orders.length,1);assert.equal(s.context.cart.length,0);
});

test("Turnstile ausente bloquea el pedido y nunca usa una RPC antigua",async()=>{
  const s=setup({turnstile:null});await s.submit();assert.equal(s.edgeCalls.length,0);assert.equal(s.calls.length,0);assert.equal(s.context.orders.length,0);assert.equal(s.context.cart.length,1);assert.equal(s.context.products[0].stock,7);assert.equal(s.writes.length,0);assert.equal(s.counts().afterSavedCalls,0);assert.equal(s.counts().resetCalls,0);assert.equal(s.nodes["customer-email"].value,"cliente@example.invalid");assert.match(s.notifications[0],/verificación de seguridad no está disponible/i);assert.equal(s.button.disabled,false);
});

test("validación de entrega impide llamar a la Edge Function",async()=>{
  const s=setup({validate:async()=>{throw new Error("Calculá un envío vigente antes de confirmar el pedido.");}});await s.submit();assert.equal(s.edgeCalls.length,0);assert.equal(s.calls.length,0);assert.equal(s.context.cart.length,1);assert.equal(s.writes.length,0);assert.match(s.notifications[0],/envío vigente/);
});

test("respuesta protegida fallida no crea una venta local",async()=>{
  const error=new Error("No se pudo registrar el pedido. Tus productos siguen en el carrito para que puedas reintentar.");error.code="turnstile_invalid";
  const s=setup({edgeRespond:()=>Promise.reject(error)});await s.submit();assert.equal(s.context.orders.length,0);assert.equal(s.context.cart.length,1);assert.equal(s.context.products[0].stock,7);assert.equal(s.writes.length,0);assert.equal(s.events.length,0);assert.equal(s.counts().afterSavedCalls,0);assert.equal(s.counts().resetCalls,0);
});
