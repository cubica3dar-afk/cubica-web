// Explicit opt-in production API smoke checks. No accounts, orders or emails are created.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const config={window:{}};
vm.runInNewContext(fs.readFileSync(new URL('../github-config.js',import.meta.url),'utf8'),config);
const {supabaseUrl:base,supabasePublishableKey:key}=config.window.CUBICA_CONFIG;
const headers={apikey:key,'Content-Type':'application/json'};
const cases=[
 ['orders','/rest/v1/orders?select=id&limit=1',401],
 ['profiles','/rest/v1/profiles?select=id&limit=1',401],
 ['recipes','/rest/v1/product_recipes?select=product_id&limit=1',401],
 ['outbox','/rest/v1/order_email_outbox?select=order_id&limit=1',401],
 ['private_schema','/rest/v1/buyer_details?select=user_id&limit=1',406,{headers:{...headers,'Accept-Profile':'private'}}],
 ['legacy_order','/rest/v1/rpc/create_public_order',401,{method:'POST',body:JSON.stringify({p_client_order_id:'audit-never-written',p_customer_name:'',p_customer_email:'',p_items:[]})}],
 ['admin_rpc','/rest/v1/rpc/get_admin_orders',401,{method:'POST',body:'{}'}],
 ['email_worker','/functions/v1/order-emails',401,{method:'POST',body:'{}'}],
 ['auth_settings','/auth/v1/settings',200],
 ['invalid_recovery','/auth/v1/verify?token='+'0'.repeat(64)+'&type=recovery&redirect_to='+encodeURIComponent('https://cubica3d.ar/?view=reset'),303,{redirect:'manual'}],
];
for(const [name,path,status,options={}] of cases){
 const response=await fetch(base+path,{headers,signal:AbortSignal.timeout(15000),...options});
 assert.equal(response.status,status,name);
 if(name==='invalid_recovery'){
  const target=new URL(response.headers.get('location'));
  assert.equal(target.origin,'https://cubica3d.ar');
  assert.equal(target.searchParams.get('view'),'reset');
  assert(new URLSearchParams(target.hash.slice(1)).has('error'));
 }else if(name==='email_worker'){
  assert.match(await response.text(),/unauthorized/i);
 }else{
  const data=await response.json();
  if(name==='auth_settings'){assert.equal(data.external.email,true);assert.equal(data.external.google,true);assert.equal(data.mailer_autoconfirm,false);}
  else if(name==='private_schema')assert.equal(data.code,'PGRST106');
  else if(name!=='email_worker')assert.equal(data.code,'42501');
 }
 console.log('PASS '+name+' HTTP '+response.status);
}
console.log('10 production API checks passed; no transactional business effects.');
