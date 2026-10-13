const fs=require('fs'),vm=require('vm'),assert=require('assert');
const path=require('path');
const source=fs.readFileSync(path.join(__dirname,'../js/ui-shell.js'),'utf8');
function setup(url,signedIn=false,stored=new Map()){
 const nodes=new Map();for(const id of ['welcome-view','section-store','section-login','section-orders','section-mfa','section-profile'])nodes.set(id,{id,hidden:false,classList:{add(){nodes.get(id).hidden=true},remove(){nodes.get(id).hidden=false},toggle(_,hidden){nodes.get(id).hidden=hidden}}});
 const ctx={URL,URLSearchParams,window:{location:new URL(url),history:{replaceState(_,__,next){ctx.window.location=new URL(next)}}},session:signedIn?{role:'customer'}:null,sessionStorage:{getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)},$:id=>nodes.get(id)||null,document:{querySelectorAll:s=>s==='.page-section'?[...nodes.values()].filter(n=>n.id.startsWith('section-')):[]},renderOrders(){},renderProducts(){},toast(){}};
 vm.createContext(ctx);vm.runInContext(source,ctx);return {ctx,nodes,stored};
}
let {ctx,nodes,stored}=setup('https://cubica3d.ar/?view=orders');
assert(ctx.window.cubicaOpenOrdersLink());assert(nodes.get('welcome-view').hidden);assert(!nodes.get('section-login').hidden);assert.equal(ctx.window.cubicaAuthRedirectUrl(),'https://cubica3d.ar/?view=orders');
ctx.session={role:'customer'};ctx.window.cubicaNavigateAfterSignIn();assert(!nodes.get('section-orders').hidden);
ctx.window.cubicaOpenOrdersLink();ctx.window.cubicaNavigateAfterSignIn();assert(!nodes.get('section-orders').hidden,'async auth does not override orders');
vm.runInContext('showSection("store")',ctx);assert.equal(ctx.window.location.search,'');assert.equal(stored.size,0);assert(!ctx.window.cubicaOpenOrdersLink());
({ctx,nodes}=setup('https://cubica3d.ar/?view=orders',true));ctx.window.cubicaOpenOrdersLink();assert(!nodes.get('section-orders').hidden);
({ctx,nodes}=setup('https://cubica3d.ar/',true,new Map([['cubica_auth_destination','orders']])));ctx.window.cubicaOpenOrdersLink();assert(!nodes.get('section-orders').hidden,'OAuth fallback resumes intent');
({ctx,nodes}=setup('https://cubica3d.ar/?view=orders#type=recovery',true));assert(!ctx.window.cubicaOpenOrdersLink(),'recovery takes priority');
({ctx,nodes}=setup('https://cubica3d.ar/',true));ctx.window.cubicaNavigateAfterSignIn();assert(!nodes.get('section-store').hidden,'ordinary login unchanged');
({ctx,nodes}=setup('https://cubica3d.ar/',true));ctx.session={role:'admin',adminMfaEnforcement:true,adminMfaAccessAllowed:false};ctx.window.cubicaNavigateAfterSignIn();assert(!nodes.get('section-mfa').hidden,'enforced admin AAL1 is routed to MFA');
for(const destination of ['store','profile','orders']){
 vm.runInContext(`showSection("${destination}")`,ctx);
 assert(!nodes.get('section-mfa').hidden,`AAL1 admin cannot navigate to ${destination}`);
}
console.log('PASS: guest link, authenticated link, login race, OAuth fallback, recovery priority, ordinary login, global MFA navigation lock');
