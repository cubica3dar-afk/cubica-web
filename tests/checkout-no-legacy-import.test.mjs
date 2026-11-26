import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../supabase-sales.js',import.meta.url),'utf8');
function setup({aal2=true,archiveFails=false}={}){
  const legacy={id:'legacy-synthetic',items:[{name:'QA',qty:1}],serverSaved:false};
  const storage=new Map([['orders',[legacy]]]),calls=[],events={};
  const context={window:{cubicaSupabase:{rpc:async name=>{calls.push(name);assert.equal(name,'get_admin_orders');return {data:[]};},from(){throw Error('Unexpected table write');}},cubicaAdminMfaAccessAllowed:()=>aal2,addEventListener:(name,fn)=>events[name]=fn},document:{addEventListener(){}},session:{role:'admin'},orders:[],STORAGE:{orders:'orders'},read:(key,fallback)=>storage.get(key)??fallback,writeLocal:(key,value)=>{if(archiveFails&&key.endsWith('legacy-unreviewed'))throw Error('Storage full');storage.set(key,JSON.parse(JSON.stringify(value)));},renderOrders(){},renderAnalytics(){},toast(){},console:{error(){}}};
  vm.runInNewContext(source,context);return {context,storage,calls,events,legacy};
}
test('admin AAL2 login only reads remote orders and preserves legacy records for review',async()=>{
  const h=setup();await h.events['cubica:auth-ready']({detail:{role:'admin',mfa:{accessAllowed:true}}});
  assert.deepEqual(h.calls,['get_admin_orders']);
  assert.deepEqual(h.storage.get('orders.legacy-unreviewed'),[h.legacy]);
  h.storage.set('orders',[h.legacy]);await h.context.window.loadCubicaSalesFromSupabase();
  assert.equal(h.storage.get('orders.legacy-unreviewed').length,1);
});
test('archive failure preserves original records and prevents refresh overwrite',async()=>{
  const h=setup({archiveFails:true});await h.context.window.loadCubicaSalesFromSupabase();
  assert.deepEqual(h.storage.get('orders'),[h.legacy]);assert.equal(h.calls.length,0);
});
test('AAL1 cannot load administrative sales',async()=>{
  const h=setup({aal2:false});await h.context.window.loadCubicaSalesFromSupabase();assert.equal(h.calls.length,0);
});
