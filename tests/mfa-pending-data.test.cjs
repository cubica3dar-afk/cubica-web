const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');

async function inventoryScenario(){
  const source=fs.readFileSync(path.join(__dirname,'../supabase-inventory.js'),'utf8');
  const listeners={},timers=[],badges=[],calls=[];
  function query(table){
    calls.push(table);
    const data=table==='supplies'?[{id:'s1',name:'PLA',category:'Filamentos',cost:1,qty:10,unit:'g',active:true}]:[];
    return {data,error:null,select(){return this},eq(){return this},order(){return this},limit(){return this},in(){return this},delete(){return this},insert(){return this},upsert(){return this}};
  }
  const ctx={window:{cubicaSupabase:{from:query,rpc:async()=>({data:null,error:null})},cubicaAdminMfaAccessAllowed:()=>ctx.session.adminMfaAccessAllowed,addEventListener:(type,fn)=>listeners[type]=fn},session:{role:'admin',adminMfaAccessAllowed:false},document:{addEventListener(){},getElementById(){return null}},setTimeout:fn=>{timers.push(fn);return timers.length},clearTimeout(){},updateServerBadge:(text,mode)=>badges.push([text,mode]),console,sessionStorage:{getItem(){return '1'},setItem(){}},normalizeSupply:x=>x,normalizeProduct:x=>x,supplyCategories:[],supplies:[],products:[],writeLocal(){},STORAGE:{},renderSupplies(){},renderFinishedStock(){},renderBudget(){},toast(){},confirm(){return false}};
  vm.createContext(ctx);vm.runInContext(source,ctx);
  await listeners['cubica:auth-ready']({detail:{role:'admin',mfa:{accessAllowed:false}}});
  assert.equal(calls.length,0,'inventory must not query before AAL2');
  assert.equal(badges.at(-1)[0],'Supabase: MFA pendiente');
  ctx.session.adminMfaAccessAllowed=true;
  await listeners['cubica:auth-ready']({detail:{role:'admin',mfa:{accessAllowed:true}}});
  assert.equal(timers.length,1,'AAL2 must schedule automatic inventory load');
  await timers.shift()();
  assert(calls.includes('supplies'),'inventory must query after AAL2');
  assert.equal(badges.at(-1)[0],'Datos: Supabase');
}

function assertAdaptersGateOnMfa(){
  const sales=fs.readFileSync(path.join(__dirname,'../supabase-sales.js'),'utf8');
  const analytics=fs.readFileSync(path.join(__dirname,'../supabase-analytics.js'),'utf8');
  assert.match(sales,/e\.detail\?\.mfa\?\.accessAllowed===true/,'sales auth listener must require AAL2');
  assert.match(analytics,/e\.detail\?\.mfa\?\.accessAllowed===true/,'analytics auth listener must require AAL2');
}

inventoryScenario().then(()=>{assertAdaptersGateOnMfa();console.log('PASS: MFA pending avoids admin data requests and AAL2 triggers automatic inventory load');}).catch(error=>{console.error(error);process.exit(1)});
