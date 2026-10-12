const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const source=fs.readFileSync(path.join(__dirname,"../js/checkout-profile.js"),"utf8");
const data={user_id:"owner-a",first_name:"Diego",last_name:"Pérez",phone:"+54 9 11 2345 6789",email:"auth@example.test"};

function setup({user={supabaseUserId:"owner-a",email:"auth@example.test"},ready=true,rpc}={}){
  const nodes=new Map(),listeners={},calls=[],events=[];
  const node=()=>({value:"",dataset:{},disabled:false,readOnly:false,textContent:"",classList:{toggle(){}},addEventListener(){}});
  for(const id of ["customer-name","customer-last-name","customer-phone","customer-email","buyer-profile-first-name","buyer-profile-last-name","buyer-profile-phone","buyer-profile-email","buyer-profile-save","buyer-profile-message"])nodes.set(id,node());
  const ctx={session:user,Promise,console,CustomEvent:function(type,init){this.type=type;this.detail=init?.detail;},document:{getElementById:id=>nodes.get(id)||null,addEventListener(){}},window:{cubicaCheckoutAuthReady:ready,addEventListener:(name,fn)=>listeners[name]=fn,dispatchEvent:event=>events.push(event),cubicaSupabase:{rpc:async(name,params)=>{calls.push({name,params});return rpc?rpc(name,params):{data,error:null};}}}};
  vm.createContext(ctx);vm.runInContext(source,ctx);
  return {ctx,nodes,listeners,calls,events,api:ctx.window.cubicaBuyerProfile};
}

test("authenticated incomplete profile gets Auth email readonly and does not invent names",async()=>{
  const s=setup({rpc:async()=>({data:{...data,first_name:"",last_name:"",phone:""},error:null})});await s.api.load();
  assert.equal(s.nodes.get("customer-name").value,"");assert.equal(s.nodes.get("customer-last-name").value,"");assert.equal(s.nodes.get("customer-phone").value,"");
  assert.equal(s.nodes.get("customer-email").value,data.email);assert.equal(s.nodes.get("customer-email").readOnly,true);
});

test("private buyer details autofill first,last,phone without copying public nickname",async()=>{
  const s=setup({user:{supabaseUserId:"owner-a",email:data.email,username:"PUBLIC_NICKNAME"}});await s.api.load();
  assert.equal(s.nodes.get("customer-name").value,"Diego");assert.equal(s.nodes.get("customer-last-name").value,"Pérez");assert.equal(s.nodes.get("customer-phone").value,data.phone);
  assert.equal(s.events.at(-1).type,"cubica:buyer-details");assert.equal(s.events.at(-1).detail.owner,"owner-a");assert.equal(s.events.at(-1).detail.data.first_name,"Diego");
  assert.equal(s.calls.length,1);await s.api.load();assert.equal(s.calls.length,1,"cached same owner prevents duplicate profile queries");
});

test("autofill preserves manually entered values and intentionally emptied draft fields",async()=>{
  const s=setup();s.nodes.get("customer-name").value="Comprador específico";
  s.nodes.get("customer-last-name").dataset.checkoutEdited="true";s.nodes.get("customer-phone").dataset.userEdited="true";
  s.nodes.get("customer-email").value="spoof@example.test";await s.api.load();
  assert.equal(s.nodes.get("customer-name").value,"Comprador específico");assert.equal(s.nodes.get("customer-last-name").value,"");assert.equal(s.nodes.get("customer-phone").value,"");
  assert.equal(s.nodes.get("customer-email").value,data.email,"authenticated email is always authoritative");
  assert.equal(s.calls.filter(c=>c.name==="save_my_buyer_details").length,0,"checkout edits never save a personal profile");
});

test("a delayed old account response cannot repopulate fields after account switch",async()=>{
  let finish;const s=setup({rpc:()=>new Promise(resolve=>finish=resolve)});const pending=s.api.load();
  s.ctx.session={supabaseUserId:"owner-b",email:"b@example.test"};s.api.clear();finish({data,error:null});await pending;
  assert.equal(s.nodes.get("customer-name").value,"");assert.equal(s.nodes.get("customer-last-name").value,"");assert.equal(s.nodes.get("customer-phone").value,"");
  assert.equal(s.events.at(-1).detail.data,null);
});

test("an Auth API owner different from local session is ignored",async()=>{
  const s=setup({rpc:async()=>({data:{...data,user_id:"owner-b"},error:null})});assert.equal(await s.api.load(),null);
  assert.equal(s.nodes.get("customer-name").value,"");assert.equal(s.events.length,0);
});

test("logout and account changes clear private profile and checkout values",async()=>{
  const s=setup();await s.api.load();s.ctx.session=null;s.listeners["cubica:auth-ready"]();await Promise.resolve();
  for(const id of ["customer-name","customer-last-name","customer-phone","customer-email","buyer-profile-first-name","buyer-profile-last-name","buyer-profile-phone","buyer-profile-email"])assert.equal(s.nodes.get(id).value,"");
  assert.equal(s.nodes.get("customer-email").readOnly,false);assert.equal(s.nodes.get("buyer-profile-save").disabled,true);assert.equal(s.events.at(-1).detail.data,null);
});

test("cached local session before Auth ready cannot trigger private profile requests",async()=>{
  const s=setup({ready:false});assert.equal(await s.api.load(),null);assert.equal(s.calls.length,0);
  s.listeners["cubica:auth-ready"]();s.ctx.window.cubicaCheckoutAuthReady=true;await Promise.resolve();await Promise.resolve();
  assert.equal(s.calls.length,1,"deferred event waits for root checkout auth listener to verify session");
});

test("guest keeps entered email editable and never queries personal details",async()=>{
  const s=setup({user:null});s.nodes.get("customer-email").value="guest@example.test";s.api.autofillCheckout();await s.api.load();
  assert.equal(s.nodes.get("customer-email").value,"guest@example.test");assert.equal(s.nodes.get("customer-email").readOnly,false);assert.equal(s.calls.length,0);
});

test("explicit profile save sends only personal fields, no spoofed userid/email",async()=>{
  const s=setup();s.nodes.get("buyer-profile-first-name").value="  Diego ";s.nodes.get("buyer-profile-last-name").value=" Pérez ";s.nodes.get("buyer-profile-phone").value=data.phone;
  s.nodes.get("buyer-profile-email").value="spoof@example.test";await s.api.save();
  assert.deepEqual(JSON.parse(JSON.stringify(s.calls[0])),{name:"save_my_buyer_details",params:{p_first_name:"Diego",p_last_name:"Pérez",p_phone:data.phone}});
  assert.equal(s.nodes.get("buyer-profile-email").value,data.email);assert.match(s.nodes.get("buyer-profile-message").textContent,/guardados/);
});

test("incomplete personal profile can be saved; invalid phone and excessive names are rejected",async()=>{
  const s=setup();s.nodes.get("buyer-profile-phone").value="123";await s.api.save();assert.equal(s.calls.length,0);assert.match(s.nodes.get("buyer-profile-message").textContent,/teléfono/);
  s.nodes.get("buyer-profile-phone").value="";s.nodes.get("buyer-profile-first-name").value="a".repeat(61);await s.api.save();assert.equal(s.calls.length,0);
  s.nodes.get("buyer-profile-first-name").value="";await s.api.save();assert.equal(s.calls.length,1);assert.equal(s.calls[0].params.p_first_name,"");
});

test("double profile saves do not duplicate requests and a delayed save cannot leak to new account",async()=>{
  let finish;const s=setup({rpc:()=>new Promise(resolve=>finish=resolve)});s.nodes.get("buyer-profile-first-name").value="Diego";
  const pending=s.api.save();await s.api.save();assert.equal(s.calls.length,1);assert.equal(s.nodes.get("buyer-profile-save").disabled,true);
  s.ctx.session={supabaseUserId:"owner-b",email:"b@example.test"};s.api.clear();finish({data,error:null});await pending;
  assert.equal(s.nodes.get("buyer-profile-first-name").value,"");assert.doesNotMatch(s.nodes.get("buyer-profile-message").textContent,/guardados/);
});

test("same-account Auth refresh preserves a modified checkout",async()=>{
  const s=setup();await s.api.load();s.nodes.get("customer-name").value="Otra persona";s.nodes.get("customer-name").dataset.checkoutEdited="true";
  s.listeners["cubica:auth-ready"]();await Promise.resolve();await Promise.resolve();assert.equal(s.nodes.get("customer-name").value,"Otra persona");assert.equal(s.calls.length,1);
});

