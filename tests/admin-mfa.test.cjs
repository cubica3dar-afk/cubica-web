const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const source=fs.readFileSync(path.join(__dirname,'../js/mfa-ui.js'),'utf8');
const bridgeSource=fs.readFileSync(path.join(__dirname,'../supabase-bridge.js'),'utf8');
const handlers={},windowHandlers={},nodes=new Map(),logs=[];
function node(id){
 if(nodes.has(id))return nodes.get(id);
 const n={id,value:'',textContent:'',innerHTML:'',dataset:{},disabled:false,src:'',classList:{values:new Set(['hidden']),add(x){this.values.add(x)},remove(x){this.values.delete(x)},toggle(x,v){v?this.values.add(x):this.values.delete(x)}},addEventListener:(type,fn)=>handlers[id+':'+type]=fn,focus(){n.focused=true}};
 nodes.set(id,n);return n;
}
const factors=[];
const client={auth:{mfa:{
 listFactors:async()=>({data:{all:factors},error:null}),
 enroll:async()=>({data:{id:'pending-1',totp:{qr_code:'data:image/svg+xml,secret',secret:'TEMP-SECRET'}},error:null}),
 challengeAndVerify:async({code})=>code==='123456'?{data:{},error:null}:{data:null,error:{message:'invalid totp code'}},
 unenroll:async()=>({data:{},error:null})
}}};
const ctx={console:{log:x=>logs.push(x),error:x=>logs.push(x)},document:{getElementById:node,addEventListener:(type,fn)=>handlers[type]=fn},window:{session:{role:'admin',adminMfaEnforcement:false,adminMfaAal:'aal1'},cubicaSupabase:client,cubicaRefreshSupabaseSession:async()=>{},cubicaSignOut:async()=>{ctx.signedOut=true;ctx.session=null},addEventListener:(type,fn)=>windowHandlers[type]=fn,confirm:()=>true},session:{role:'admin'},showSection:id=>ctx.lastSection=id,escapeHtml:String,setTimeout,toast:()=>{},CustomEvent:function(){}};
ctx.window.cubicaAdminMfaAccessAllowed=()=>ctx.session?.role!=="admin"||ctx.session?.adminMfaEnforcement!==true||ctx.session?.adminMfaAccessAllowed===true;
ctx.window.cubicaAdminMfaChallengeRequired=()=>ctx.session.role==='admin'&&ctx.session.adminMfaEnforcement===true&&ctx.session.adminMfaAccessAllowed!==true;
vm.createContext(ctx);vm.runInContext(source,ctx);handlers.DOMContentLoaded();
(async()=>{
 assert.match(bridgeSource,/access_allowed:false,status_unavailable:true/,'unavailable MFA status must fail closed in the UI');
 await ctx.window.cubicaAdminMfa.refresh({route:false});
 assert.match(node('admin-mfa-status').textContent,/no configurado/i);
 await ctx.window.cubicaAdminMfa.beginEnrollment();
 assert.equal(node('admin-mfa-secret').textContent,'TEMP-SECRET');
 assert(!logs.some(x=>String(x).includes('TEMP-SECRET')),'temporary secret logged');
 node('admin-mfa-code').value='12a34b56';
 assert.equal(ctx.window.cubicaAdminMfa.cleanCode(node('admin-mfa-code').value),'123456');
 factors.push({id:'verified-1',factor_type:'totp',status:'verified',friendly_name:'Principal'});
 ctx.session.adminMfaEnforcement=true;
 await ctx.window.cubicaAdminMfa.refresh();
 assert.equal(ctx.lastSection,'mfa','enforced AAL1 admin must be routed to challenge');
 node('mfa-challenge-factor').value='verified-1';node('mfa-challenge-code').value='000000';
 await ctx.window.cubicaAdminMfa.verifyChallenge({preventDefault(){}});
 assert.match(node('mfa-challenge-message').textContent,/no es válido/i);
 node('mfa-challenge-code').value='123456';
 await ctx.window.cubicaAdminMfa.verifyChallenge({preventDefault(){}});
 assert.equal(ctx.lastSection,'profile');
 assert(!handlers['mfa-challenge-back:click'],'profile escape must not exist during challenge');
 await handlers['mfa-challenge-logout:click']();
 assert(ctx.signedOut,'challenge must allow explicit sign out');
 assert.equal(ctx.lastSection,'login');
 ctx.window.session={role:'customer'};ctx.session=ctx.window.session;
 windowHandlers['cubica:auth-ready']({detail:{role:'customer'}});
 assert(node('admin-mfa-card').classList.values.has('hidden'),'customer sees admin MFA card');
 console.log('PASS: admin enrollment, temporary secret handling, AAL1 challenge, invalid code, verified code, challenge logout, customer isolation');
})().catch(e=>{console.error(e);process.exit(1)});

