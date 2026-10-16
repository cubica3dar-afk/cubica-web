// Read-only/no-sale production checks. Every request is rejected before order creation.
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import crypto from "node:crypto";

const config={window:{}};
vm.runInNewContext(fs.readFileSync(new URL("../github-config.js",import.meta.url),"utf8"),config);
const {supabaseUrl:base,supabasePublishableKey:key}=config.window.CUBICA_CONFIG;
const requestId=crypto.randomUUID(),guestToken="e".repeat(64);
const headers={apikey:key,Authorization:`Bearer ${key}`,Origin:"https://cubica3d.ar","Content-Type":"application/json"};
const body={client_order_id:requestId,customer_name:"QA Seguridad",customer_email:"qa-security@example.invalid",phone:"1100000000",payment:"Efectivo",notes:"",items:[{product_id:"qa-never-created",qty:1,color:""}],delivery:{mode:"pickup",request_id:requestId,quote_token:guestToken}};

let response=await fetch(`${base}/functions/v1/create-order`,{method:"POST",headers,body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
assert.equal(response.status,400);assert.equal((await response.json()).error,"turnstile_required");

response=await fetch(`${base}/functions/v1/create-order`,{method:"POST",headers,body:JSON.stringify({...body,turnstile_token:"INVALID.QA.TOKEN"}),signal:AbortSignal.timeout(15000)});
assert.equal(response.status,400);assert.match((await response.json()).error,/^turnstile_(invalid|expired_or_used)$/);

response=await fetch(`${base}/functions/v1/create-order`,{method:"POST",headers:{...headers,Origin:"https://attacker.invalid"},body:JSON.stringify({...body,turnstile_token:"INVALID.QA.TOKEN"}),signal:AbortSignal.timeout(15000)});
assert.equal(response.status,403);assert.equal((await response.json()).error,"origin_not_allowed");

if(process.env.EXPECT_LEGACY_CLOSED==="1"){
  const legacyBody={p_client_order_id:requestId,p_customer_name:"QA Seguridad",p_customer_email:"qa-security@example.invalid",p_phone:"1100000000",p_payment:"Efectivo",p_notes:"",p_items:[],p_delivery:{mode:"pickup",request_id:requestId,quote_token:guestToken}};
  response=await fetch(`${base}/rest/v1/rpc/create_delivery_order`,{method:"POST",headers,body:JSON.stringify(legacyBody),signal:AbortSignal.timeout(15000)});
  assert.equal(response.status,401);assert.equal((await response.json()).code,"42501");
  response=await fetch(`${base}/rest/v1/rpc/create_public_order`,{method:"POST",headers,body:JSON.stringify({p_client_order_id:requestId,p_customer_name:"QA Seguridad",p_customer_email:"qa-security@example.invalid",p_phone:"1100000000",p_payment:"Efectivo",p_notes:"",p_items:[]}),signal:AbortSignal.timeout(15000)});
  assert.equal(response.status,401);assert.equal((await response.json()).code,"42501");
}

console.log(`PASS live order protection checks (${process.env.EXPECT_LEGACY_CLOSED==="1"?"enforced":"pre-activation"}); no order payload can reach creation.`);
