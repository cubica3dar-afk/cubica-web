const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const source=fs.readFileSync(path.join(__dirname,"../js/checkout-ui.js"),"utf8");
const key="cubica_checkout_draft_v1";
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

function setup({readyState="complete",href="https://cubica3d.ar/",user=null,mode="supabase",storage=new Map(),cart=[{productId:"p1",qty:2,color:"Blanco"}],catalog="ready",products=[{id:"p1",name:"Velador",price:2500,media:[]}],autofill}={}){
  const nodes=new Map(),events=new Map(),dom=[],navigations=[],tracks=[],calls=[],notifications=[];
  function node(id){
    const classes=new Set(id.startsWith("section-")?["hidden"]:[]),handlers={};
    return {value:id==="payment-method"?"Efectivo":"",innerHTML:"",textContent:"",dataset:{},disabled:false,handlers,classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x)},addEventListener:(name,fn)=>handlers[name]=fn,focus(){},appendChild(){}};
  }
  for(const id of ["section-checkout","section-cart","section-store","section-orders","welcome-view","customer-name","customer-last-name","customer-email","customer-phone","payment-method","customer-notes","checkout-summary-items","checkout-summary-message","checkout-confirm-btn","checkout-page-title","checkout-back-cart","checkout-summary-cart","delivery-checkout-total","checkout-delivery-total-host"])nodes.set(id,node(id));
  let current=new URL(href),position=0;
  const historyEntries=[href],emit=name=>{for(const fn of events.get(name)||[])fn();};
  const location={get href(){return current.href;},get hash(){return current.hash;},get search(){return current.search;},get origin(){return current.origin;},get pathname(){return current.pathname;}};
  const history={pushState(_state,_title,url){current=new URL(url,current);historyEntries.splice(++position);historyEntries.push(current.href);},replaceState(_state,_title,url){current=new URL(url,current);historyEntries[position]=current.href;},back(){if(position>0){current=new URL(historyEntries[--position]);emit("popstate");}},forward(){if(position<historyEntries.length-1){current=new URL(historyEntries[++position]);emit("popstate");}}};
  const ctx={session:user,cart,products,URL,URLSearchParams,Date,Promise,console,location,history,sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},escapeHtml:x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])),money:n=>`ARS ${n}`,toast:m=>notifications.push(m),document:{readyState,querySelector:()=>null,getElementById:id=>nodes.get(id)||null,addEventListener:(name,fn)=>{if(name==="DOMContentLoaded")dom.push(fn);}},window:{CUBICA_CONFIG:{mode},cubicaCatalogState:catalog,addEventListener:(name,fn)=>{if(!events.has(name))events.set(name,[]);events.get(name).push(fn);},scrollTo(){},cubicaTrackEvent:(...args)=>tracks.push(args),cubicaDelivery:{exportDraft:()=>({mode:"pickup",same_recipient:true}),restoreDraft:d=>calls.push(["restoreDelivery",d]),refreshCheckout:async()=>calls.push(["refreshDelivery"]),refreshTotal:()=>{},reset:()=>calls.push(["resetDelivery"])},cubicaBuyerProfile:{autofillCheckout:()=>autofill?autofill(ctx,nodes):calls.push(["autofillBuyer"]),clear:()=>calls.push(["clearBuyer"])}}};
  ctx.showSection=id=>{navigations.push(id);for(const [name,n] of nodes)if(name.startsWith("section-")){if(name===`section-${id}`)n.classList.remove("hidden");else n.classList.add("hidden");}ctx.window.cubicaCheckoutNavigation?.(id);};
  ctx.window.cubicaNavigateAfterSignIn=()=>calls.push(["previousNavigate"]);
  vm.createContext(ctx);vm.runInContext(source,ctx);
  return {ctx,nodes,events,dom,calls,storage,navigations,tracks,notifications,emit,location,history,historyEntries,api:ctx.window.cubicaCheckout};
}

test("direct checkout route uses query navigation and hides welcome without consuming cart",async()=>{
  const s=setup({href:"https://cubica3d.ar/?view=checkout"});assert.equal(s.ctx.window.cubicaOpenCheckoutLink(),true);
  assert.equal(s.navigations.at(-1),"checkout");assert.equal(s.nodes.get("welcome-view").classList.contains("hidden"),true);
  assert.equal(s.ctx.cart.length,1);assert.equal(s.historyEntries.length,1,"opening route does not add duplicate history entries");
  s.emit("cubica:auth-ready");await tick();assert.match(s.nodes.get("checkout-summary-items").innerHTML,/Velador/);
});

test("recovery callback/session has priority over checkout, saved draft and normal auth return",()=>{
  for(const flag of ["cubicaPasswordRecoveryActive","cubicaAuthCallbackBlocked"]){
    const s=setup({href:"https://cubica3d.ar/?view=checkout"});s.ctx.window[flag]=true;
    assert.equal(s.ctx.window.cubicaOpenCheckoutLink(),false);s.ctx.window.cubicaStartCheckout();s.api.saveDraft();
    assert.equal(s.navigations.length,0);assert.equal(s.storage.size,0);assert.equal(s.tracks.length,0);
  }
  const h=setup({href:"https://cubica3d.ar/?view=checkout#type=recovery"});assert.equal(h.ctx.window.cubicaOpenCheckoutLink(),false);h.ctx.window.cubicaStartCheckout();assert.equal(h.navigations.length,0);
});

test("cart and checkout navigation preserves buyer data and history back/forward",async()=>{
  const s=setup();s.emit("cubica:auth-ready");await tick();s.ctx.window.cubicaStartCheckout();await tick();
  s.nodes.get("customer-name").value="Diego";s.nodes.get("customer-last-name").value="Pérez";s.api.saveDraft();s.ctx.showSection("cart");
  assert.equal(new URL(s.location.href).searchParams.get("view"),"cart");assert.equal(s.nodes.get("customer-name").value,"Diego");
  s.history.back();await tick();assert.equal(s.navigations.at(-1),"checkout");assert.equal(s.nodes.get("customer-last-name").value,"Pérez");
  s.history.forward();assert.equal(s.navigations.at(-1),"cart");assert.equal(s.ctx.cart[0].qty,2);
});

test("same-account reload waits for verified Auth and restores draft before autofill",async()=>{
  const storage=new Map();const a=setup({user:{supabaseUserId:"a"},storage});a.ctx.window.cubicaStartCheckout();a.emit("cubica:auth-ready");await tick();a.nodes.get("customer-name").value="Compra específica";a.nodes.get("customer-phone").value="1122334455";a.api.saveDraft();
  const b=setup({href:"https://cubica3d.ar/?view=checkout",user:{supabaseUserId:"a"},storage,autofill:(_ctx,nodes)=>{assert.equal(nodes.get("customer-name").value,"Compra específica");}});
  b.ctx.window.cubicaOpenCheckoutLink();b.dom.forEach(fn=>fn());assert.equal(b.nodes.get("customer-name").value,"");b.api.restoreDraft();assert.equal(b.nodes.get("customer-name").value,"");
  b.emit("cubica:auth-ready");await tick();assert.equal(b.nodes.get("customer-name").value,"Compra específica");assert.equal(b.nodes.get("customer-phone").value,"1122334455");assert.equal(b.calls.filter(c=>c[0]==="restoreDelivery").length,1);
});

test("a different verified account cannot restore someone else's draft",async()=>{
  const storage=new Map([[key,JSON.stringify({version:1,owner:"a",saved_at:Date.now(),buyer:{"customer-name":"PRIVATE_A","customer-phone":"1122334455"}})]]);
  const s=setup({href:"https://cubica3d.ar/?view=checkout",user:{supabaseUserId:"b"},storage});s.ctx.window.cubicaOpenCheckoutLink();s.emit("cubica:auth-ready");await tick();assert.equal(s.nodes.get("customer-name").value,"");assert.doesNotMatch(storage.get(key)||"",/PRIVATE_A/);
});

test("logout/account switch clears buyer/delivery PII and preserves the cart",async()=>{
  const s=setup({user:{supabaseUserId:"a"}});s.emit("cubica:auth-ready");await tick();s.nodes.get("customer-name").value="PRIVATE_A";s.nodes.get("customer-phone").value="1122334455";s.nodes.get("customer-notes").value="Privado";s.api.saveDraft();
  s.ctx.session=null;s.emit("cubica:auth-ready");await tick();
  for(const id of ["customer-name","customer-last-name","customer-phone","customer-email","customer-notes"])assert.equal(s.nodes.get(id).value,"");
  assert.ok(s.calls.some(c=>c[0]==="clearBuyer"));assert.ok(s.calls.some(c=>c[0]==="resetDelivery"));assert.equal(s.ctx.cart[0].qty,2);assert.doesNotMatch(s.storage.get(key)||"",/PRIVATE_A|Privado/);
});

test("empty cart, unavailable product and catalog failure block confirmation distinctly",()=>{
  const empty=setup({cart:[]});empty.ctx.window.cubicaStartCheckout();assert.equal(empty.navigations.at(-1),"cart");assert.match(empty.notifications[0],/vacío/);assert.equal(empty.nodes.get("checkout-confirm-btn").disabled,false);empty.api.renderSummary();assert.equal(empty.nodes.get("checkout-confirm-btn").disabled,true);
  const loading=setup({catalog:"loading",products:[]});assert.match(loading.api.validCart().message,/comprobando/);loading.api.renderSummary();assert.equal(loading.nodes.get("checkout-confirm-btn").disabled,true);
  const failed=setup({catalog:"error",products:[]});assert.match(failed.api.validCart().message,/conexión/);
  const missing=setup({products:[]});assert.match(missing.api.validCart().message,/no está disponible/);
  const inactive=setup({products:[{id:"p1",name:"Privado",price:1,active:false}]});assert.equal(inactive.api.validCart().valid,false);
  const invalidQty=setup({cart:[{productId:"p1",qty:1.5}]});assert.match(invalidQty.api.validCart().message,/cantidades/);
});

test("catalog readiness rechecks confirmation and does not enable an active submit",async()=>{
  const s=setup({href:"https://cubica3d.ar/?view=checkout",catalog:"loading"});s.ctx.window.cubicaOpenCheckoutLink();assert.equal(s.nodes.get("checkout-confirm-btn").disabled,true);
  s.ctx.window.cubicaCatalogState="ready";s.emit("cubica:catalog-ready");assert.equal(s.nodes.get("checkout-confirm-btn").disabled,false);
  s.nodes.get("checkout-confirm-btn").dataset.submitting="true";s.nodes.get("checkout-confirm-btn").disabled=true;s.emit("cubica:catalog-ready");assert.equal(s.nodes.get("checkout-confirm-btn").disabled,true);
});

test("repeated checkout opening avoids duplicate checkout_started analytics and history",async()=>{
  const s=setup();s.ctx.window.cubicaStartCheckout();s.ctx.window.cubicaStartCheckout();assert.equal(s.tracks.length,1);assert.equal(s.historyEntries.length,2);assert.equal(s.ctx.cart[0].qty,2);
});

test("checkout sign-in destination keeps checkout and removes product context",async()=>{
  const s=setup({href:"https://cubica3d.ar/?product=p1"});s.ctx.window.cubicaStartCheckout();const redirect=new URL(s.ctx.window.cubicaAuthRedirectUrl());assert.equal(redirect.searchParams.get("view"),"checkout");assert.equal(redirect.searchParams.has("product"),false);
});

test("first verified Auth restores the real owner's draft even when the app session cache is empty",async()=>{
  const draft={version:1,owner:"actual-user",saved_at:Date.now(),buyer:{"customer-name":"Compra específica","customer-last-name":"Restaurada","customer-phone":"1122334455"},buyer_edited:{"customer-name":true},delivery:{owner:"actual-user",mode:"pickup",request_id:"saved-id",request_token:"saved-token"}};
  const storage=new Map([[key,JSON.stringify(draft)]]),s=setup({href:"https://cubica3d.ar/?view=checkout",storage,user:null});
  s.ctx.window.cubicaOpenCheckoutLink();s.dom.forEach(fn=>fn());assert.equal(s.nodes.get("customer-name").value,"");
  s.ctx.session={supabaseUserId:"actual-user"};s.emit("cubica:auth-ready");await tick();
  assert.equal(s.nodes.get("customer-name").value,"Compra específica");assert.equal(s.nodes.get("customer-last-name").value,"Restaurada");
  assert.equal(s.calls.find(c=>c[0]==="restoreDelivery")[1].request_id,"saved-id");
  assert.ok(s.calls.some(c=>c[0]==="clearBuyer"),"cached form memory is cleared before restoring the verified owner's draft");
  s.ctx.session={supabaseUserId:"another-user"};s.emit("cubica:auth-ready");await tick();
  assert.equal(s.nodes.get("customer-name").value,"");assert.doesNotMatch(s.storage.get(key)||"",/Compra específica/);
});

test("checkout keeps its Auth destination after opening login and returns after email sign-in",async()=>{
  const s=setup();s.emit("cubica:auth-ready");await tick();s.ctx.window.cubicaStartCheckout();await tick();s.ctx.showSection("login");
  assert.equal(new URL(s.location.href).searchParams.has("view"),false);
  assert.equal(new URL(s.ctx.window.cubicaAuthRedirectUrl()).searchParams.get("view"),"checkout");
  s.ctx.session={supabaseUserId:"signed-in-buyer"};s.emit("cubica:auth-ready");await tick();
  assert.equal(s.ctx.window.cubicaOpenCheckoutLink(),true,"bridge Auth return takes precedence before older product/order destinations");
  s.ctx.window.cubicaNavigateAfterSignIn();await tick();
  assert.equal(s.navigations.at(-1),"checkout");assert.equal(new URL(s.location.href).searchParams.get("view"),"checkout");
  assert.equal(s.calls.some(c=>c[0]==="previousNavigate"),false);assert.equal(s.ctx.cart[0].qty,2);
});

test("OAuth checkout destination works in a fresh page without a saved return flag",async()=>{
  const a=setup({mode:"local"});a.ctx.window.cubicaStartCheckout();a.ctx.showSection("login");
  const b=setup({href:a.ctx.window.cubicaAuthRedirectUrl(),user:{supabaseUserId:"google-buyer"}});
  b.ctx.window.cubicaOpenCheckoutLink();b.emit("cubica:auth-ready");await tick();b.ctx.window.cubicaNavigateAfterSignIn();
  assert.equal(b.navigations.at(-1),"checkout");assert.equal(b.ctx.cart[0].qty,2);assert.equal(b.calls.some(c=>c[0]==="previousNavigate"),false);
});

test("explicit navigation to store abandons the checkout Auth return",async()=>{
  const s=setup({mode:"local"});s.dom.forEach(fn=>fn());s.ctx.window.cubicaStartCheckout();s.ctx.showSection("login");
  assert.equal(new URL(s.ctx.window.cubicaAuthRedirectUrl()).searchParams.get("view"),"checkout");
  s.ctx.showSection("store");assert.equal(new URL(s.ctx.window.cubicaAuthRedirectUrl()).searchParams.has("view"),false);
  s.ctx.session={supabaseUserId:"buyer"};s.emit("cubica:auth-ready");await tick();s.ctx.window.cubicaNavigateAfterSignIn();
  assert.equal(s.calls.at(-1)[0],"previousNavigate");assert.equal(s.ctx.window.cubicaOpenCheckoutLink(),false);
});

test("password recovery overrides a remembered checkout Auth destination",()=>{
  for(const flag of ["cubicaPasswordRecoveryActive","cubicaAuthCallbackBlocked"]){
    const s=setup({mode:"local"});s.ctx.window.cubicaStartCheckout();s.ctx.showSection("login");s.ctx.window[flag]=true;
    const count=s.navigations.length;s.ctx.session={supabaseUserId:"recovering"};
    assert.equal(s.ctx.window.cubicaOpenCheckoutLink(),false);s.ctx.window.cubicaNavigateAfterSignIn();
    assert.equal(s.navigations.length,count);assert.equal(s.calls.some(c=>c[0]==="previousNavigate"),false);
  }
});

test("normal product and orders sign-in navigation continues through the existing handler",()=>{
  for(const href of ["https://cubica3d.ar/?product=p1","https://cubica3d.ar/?view=orders"]){
    const s=setup({href,user:{supabaseUserId:"buyer"},mode:"local"});s.ctx.window.cubicaNavigateAfterSignIn();
    assert.equal(s.calls.at(-1)[0],"previousNavigate");assert.equal(s.ctx.window.cubicaOpenCheckoutLink(),false);
  }
});

test("an explicit cart, product or orders route supersedes an older saved checkout Auth return",()=>{
  for(const href of ["https://cubica3d.ar/?view=cart","https://cubica3d.ar/?product=p1","https://cubica3d.ar/?view=orders"]){
    const storage=new Map([["cubica_checkout_auth_destination","checkout"]]);const s=setup({href,storage,user:{supabaseUserId:"buyer"},mode:"local",readyState:"loading"});
    s.ctx.showSection("store");
    if(href.includes("view=cart")){assert.equal(s.ctx.window.cubicaOpenCheckoutLink(),true);assert.equal(s.navigations.at(-1),"cart");}
    else {assert.equal(s.ctx.window.cubicaOpenCheckoutLink(),false);s.ctx.window.cubicaNavigateAfterSignIn();assert.equal(s.calls.at(-1)[0],"previousNavigate");}
  }
});

test("reloading a saved checkout sign-in destination waits for verified Auth",async()=>{
  const storage=new Map([["cubica_checkout_auth_destination","checkout"]]);
  const s=setup({readyState:"loading",storage,user:{supabaseUserId:"buyer"}});s.ctx.showSection("store");
  assert.equal(storage.get("cubica_checkout_auth_destination"),"checkout","default boot section does not cancel the pending return");
  assert.equal(s.ctx.window.cubicaOpenCheckoutLink(),false);for(const fn of s.dom)fn();s.emit("cubica:auth-ready");await tick();
  assert.equal(s.ctx.window.cubicaOpenCheckoutLink(),true);assert.equal(s.navigations.at(-1),"checkout");assert.equal(storage.has("cubica_checkout_auth_destination"),false);
});

test("expired drafts are discarded and summary safely renders product and variant strings",async()=>{
  const storage=new Map([[key,JSON.stringify({version:1,owner:"guest",saved_at:Date.now()-25*3600000,buyer:{"customer-name":"Expired private"}})]]);
  const s=setup({storage,products:[{id:"p1",name:'<img src=x onerror="bad">',price:5,media:[]}],cart:[{productId:"p1",qty:1,color:"<script>"}]});s.ctx.window.cubicaStartCheckout();s.emit("cubica:auth-ready");await tick();
  assert.equal(s.nodes.get("customer-name").value,"");assert.doesNotMatch(s.storage.get(key)||"",/Expired private/);assert.match(s.nodes.get("checkout-summary-items").innerHTML,/&lt;img/);assert.doesNotMatch(s.nodes.get("checkout-summary-items").innerHTML,/<script>/);
});

test("a late autofill from a previous account cannot continue delivery refresh",async()=>{
  let finish;const s=setup({user:{supabaseUserId:"a"},autofill:()=>new Promise(resolve=>finish=resolve)});s.ctx.window.cubicaCheckoutAuthReady=true;const fill=s.api.fillCheckout();
  await tick();s.ctx.session={supabaseUserId:"b"};s.api.clearPersonal();finish();await fill;assert.equal(s.calls.filter(c=>c[0]==="refreshDelivery").length,0);
});

test("a slower private profile loads before a default address compares its recipient with the buyer",async()=>{
  let finish;
  const s=setup({user:{supabaseUserId:"a"},autofill:(_ctx,nodes)=>{
    assert.equal(nodes.get("customer-name").value,"Comprador");
  }});
  s.ctx.window.cubicaCheckoutAuthReady=true;
  s.ctx.window.cubicaBuyerProfile.load=()=>new Promise(resolve=>finish=()=>{
    s.nodes.get("customer-name").value="Comprador";resolve();
  });
  const fill=s.api.fillCheckout();await tick();
  assert.equal(s.calls.filter(c=>c[0]==="refreshDelivery").length,0,"address selection waits for buyer details");
  finish();await fill;
  assert.equal(s.calls.filter(c=>c[0]==="refreshDelivery").length,1);
});

test("draft preserves edited-empty fields while unedited empty fields remain eligible for autofill",async()=>{
  const a=setup();a.ctx.window.cubicaStartCheckout();a.emit("cubica:auth-ready");await tick();
  a.nodes.get("customer-last-name").value="";a.nodes.get("customer-last-name").dataset.checkoutEdited="true";a.api.saveDraft();
  const b=setup({href:"https://cubica3d.ar/?view=checkout",storage:a.storage});b.ctx.window.cubicaOpenCheckoutLink();b.emit("cubica:auth-ready");await tick();
  assert.equal(b.nodes.get("customer-last-name").dataset.checkoutEdited,"true");assert.notEqual(b.nodes.get("customer-phone").dataset.checkoutEdited,"true");
});

test("leaving checkout saves the latest form values before switching active view",async()=>{
  const s=setup();s.ctx.window.cubicaStartCheckout();s.emit("cubica:auth-ready");await tick();
  s.nodes.get("customer-name").value="Latest browser autofill";s.ctx.showSection("cart");
  assert.equal(JSON.parse(s.storage.get(key)).buyer["customer-name"],"Latest browser autofill");
});

test("successful purchase clears the draft and chooses orders for accounts or cart for guests",async()=>{
  for(const user of [null,{supabaseUserId:"a"}]){
    const s=setup({user});s.ctx.window.cubicaStartCheckout();s.emit("cubica:auth-ready");await tick();s.nodes.get("customer-name").value="Diego";s.api.saveDraft();assert.ok(s.storage.has(key));
    s.ctx.window.cubicaCheckoutComplete();assert.equal(s.storage.has(key),false);assert.equal(s.navigations.at(-1),user?"orders":"cart");
  }
});

test("a completed purchase cannot resurrect a draft from an earlier async fill",async()=>{
  let finish;const s=setup({autofill:()=>new Promise(resolve=>finish=resolve)});s.ctx.window.cubicaStartCheckout();s.ctx.window.cubicaCheckoutAuthReady=true;
  const fill=s.api.fillCheckout();await tick();s.ctx.window.cubicaCheckoutComplete();finish();await fill;assert.equal(s.storage.has(key),false);assert.equal(s.calls.filter(c=>c[0]==="refreshDelivery").length,0);
});

test("shipping cannot enable confirmation without a genuine current quote",()=>{
 const s=setup({mode:"local"});s.ctx.document.querySelector=()=>({value:"shipping"});s.ctx.window.cubicaDelivery.hasValidQuote=()=>false;
 s.ctx.window.cubicaStartCheckout();assert.equal(s.nodes.get("checkout-confirm-btn").disabled,true);
 s.ctx.window.cubicaDelivery.hasValidQuote=()=>true;s.api.renderSummary();assert.equal(s.nodes.get("checkout-confirm-btn").disabled,false);
 s.nodes.get("checkout-confirm-btn").dataset.submitting="true";s.nodes.get("checkout-confirm-btn").disabled=true;s.api.renderSummary();assert.equal(s.nodes.get("checkout-confirm-btn").disabled,true);
});

test("early verified Auth waits for delivery controls before restoring a same-owner reload",async()=>{
 const draft={version:1,owner:"a",saved_at:Date.now(),buyer:{"customer-name":"Restored","customer-last-name":"Buyer"},buyer_edited:{"customer-name":true},delivery:{owner:"a",mode:"pickup",request_id:"stable-request",request_token:"stable-token"}};
 const storage=new Map([[key,JSON.stringify(draft)]]),s=setup({readyState:"loading",href:"https://cubica3d.ar/?view=checkout",user:{supabaseUserId:"a"},storage});let mounted=false,restored;
 s.ctx.window.cubicaDelivery.restoreDraft=d=>{assert(mounted);restored=d;};
 s.ctx.window.cubicaOpenCheckoutLink();s.emit("cubica:auth-ready");await tick();assert.equal(restored,undefined);assert.equal(JSON.parse(storage.get(key)).buyer["customer-name"],"Restored");
 mounted=true;s.ctx.document.readyState="complete";for(const fn of s.dom)fn();await tick();
 assert.equal(s.nodes.get("customer-name").value,"Restored");assert.equal(restored.request_id,"stable-request");assert.equal(restored.request_token,"stable-token");
});

