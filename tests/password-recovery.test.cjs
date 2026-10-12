const fs=require('fs'),vm=require('vm'),assert=require('assert');
const base=require('path').resolve(__dirname,'..');
const wait=()=>new Promise(r=>setTimeout(r,20));
async function scenario(hash,event,stored,search=""){
 const dom=[],events=[],sections=[],storage=new Map(stored?[['cubica_password_recovery_user',stored]]:[]);
 let callback,authApiCalls=0,inCallback=false;
 const db=new Proxy({}, {get:(_,key)=>key==='then'?resolve=>resolve({data:[],error:null}):()=>db});
 const client={from:()=>db,rpc:async()=>{assert(!inCallback);authApiCalls++;return {data:0}},auth:{
  onAuthStateChange:fn=>{callback=fn;inCallback=true;fn(event,{user:{id:'user-1',email:'test@example.com'}});inCallback=false;},
  resetPasswordForEmail:async(email,opts)=>{assert.equal(opts.redirectTo,'https://cubica3d.ar/?view=reset');return {data:{}}},signOut:async()=>({}),updateUser:async()=>({data:{}})
 }};
 const ctx={URLSearchParams,Promise,setTimeout,console,CustomEvent:function(type){this.type=type},
 document:{readyState:'loading',addEventListener:(type,fn)=>dom.push(fn)},
 window:{location:{hash,origin:'https://cubica3d.ar',pathname:'/',search},CUBICA_CONFIG:{supabaseUrl:'url',supabasePublishableKey:'key'},supabase:{createClient:()=>client},dispatchEvent:e=>events.push(e.type)},
 sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},localStorage:{removeItem(){}},STORAGE:{session:'session'},session:null,products:[],writeLocal(){},renderApp(){},showSection:s=>sections.push(s),renderProducts(){},renderFinishedStock(){},toast(){}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(base+'/supabase-bridge.js','utf8'),ctx);
 assert(callback,'subscription registered at script evaluation');
 await wait();assert(!events.length,'UI waits for DOM');dom.forEach(fn=>fn());await wait();
 await ctx.window.cubicaSendPasswordReset('test@example.com');
 const failed=hash.includes('error=')||search==='?view=reset';
 const recovery=!failed&&(event==='PASSWORD_RECOVERY'||hash.includes('type=recovery')||stored==='user-1');
 if(failed){assert(events.includes('cubica:recovery-invalid'));assert(ctx.window.cubicaAuthCallbackBlocked);assert(!sections.includes('store'));await assert.rejects(ctx.window.cubicaUpdatePassword('dummy-test-password'),/Recovery session required/);return;}
 assert.equal(events.includes('cubica:password-recovery'),recovery);
 assert.equal(ctx.window.cubicaPasswordRecoveryActive,recovery);
 if(recovery){
  inCallback=true;const result=callback('SIGNED_IN',{user:{id:'user-1'}});inCallback=false;
  assert.equal(result,undefined,'callback is synchronous');await wait();assert(!sections.includes('store'));
  await ctx.window.cubicaSignOut();assert(!storage.has('cubica_password_recovery_user'));assert(!ctx.window.cubicaPasswordRecoveryActive);
 }else assert(authApiCalls>0,'normal session processed');
}
(async()=>{
 await scenario('#type=recovery&access_token=fake','INITIAL_SESSION');
 await scenario('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&sb=','INITIAL_SESSION','user-1');
 await scenario('','INITIAL_SESSION',undefined,'?view=reset');
 await scenario('','PASSWORD_RECOVERY');
 await scenario('','INITIAL_SESSION','user-1');
 await scenario('','INITIAL_SESSION','other-user');
 await scenario('','SIGNED_IN');
 // UI reset submission must retain form after currentTarget is cleared.
 const handlers={},elements={};
 const element=id=>elements[id]||=( {value:id.includes('password')?'password123':'',classList:{add(){},toggle(){}},dataset:{},addEventListener:(type,fn)=>handlers[id+':'+type]=fn,reset(){this.didReset=true}} );
 const ctx={window:{addEventListener:(type,fn)=>handlers[type]=fn,cubicaUpdatePassword:async()=>{},cubicaSignOut:async()=>{}},document:{addEventListener:(type,fn)=>handlers[type]=fn,querySelectorAll:()=>[]},$:element,showSection(){},console};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(base+'/js/auth-ui.js','utf8'),ctx);handlers.DOMContentLoaded();
 const form=element('reset-password-form'),e={preventDefault(){},currentTarget:form,submitter:{textContent:'Guardar'}};
 const pending=handlers['reset-password-form:submit'](e);e.currentTarget=null;await pending;
 assert(form.didReset);assert.equal(element('auth-feedback').dataset.type,'success');
 console.log('PASS: early recovery, event recovery, reload, different user, normal login, sign-out cleanup, async reset success');
})().catch(e=>{console.error(e);process.exit(1)});



