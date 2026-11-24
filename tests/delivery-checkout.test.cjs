/* The historical carrier-submit path is replaced by commercial checkout.
   End-to-end handler scenarios (guest/account, double submit, lost responses,
   security, stock and receipt) live in checkout-commercial.test.mjs. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../supabase-sales.js'),'utf8');
function setup(module){
 const dom=[],calls=[],notifications=[];
 const form={};
 const ctx={window:{cubicaSupabase:{},cubicaCommercial:module,addEventListener(){}},document:{addEventListener:(n,f)=>dom.push(f)},$:id=>id==='checkout-form'?form:null,toast:m=>notifications.push(m)};
 vm.runInNewContext(source,ctx);dom.forEach(f=>f());return{form,calls,notifications};
}
test('real submit delegates exclusively to the commercial handler',async()=>{
 let received=null;const s=setup({submit:async e=>received=e}),event={preventDefault(){}};await s.form.onsubmit(event);assert.equal(received,event);assert.equal(s.notifications.length,0);
});
test('missing commercial module fails closed instead of using a carrier or legacy write',async()=>{
 const s=setup(null);await s.form.onsubmit({preventDefault(){}});assert.match(s.notifications[0],/No se pudo cargar el checkout/);
});
