const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const base=path.join(__dirname,'../js');
function setup(url,signedIn=false,pending=null){
 const store=new Map(pending?[['cubica_auth_product',pending]]:[]),opened=[];
 const nodes=new Map(['welcome-view','section-store','section-login','section-orders'].map(id=>[id,{id,classList:{add(){},remove(){},toggle(){}}}]));
 const location=new URL(url),ctx={URL,URLSearchParams,location,Intl,escapeHtml:String,session:signedIn?{role:'customer',supabaseUserId:'user'}:null,products:[{id:'product-1'}],
 sessionStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
 window:{location,history:{replaceState(){}},addEventListener(){}},document:{addEventListener(){},querySelectorAll:()=>[]},
 $:id=>nodes.get(id)||null,renderProducts(){},renderOrders(){},toast(){},openProductDetail:id=>opened.push(id),formatDate:String};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(base,'ui-shell.js'),'utf8'),ctx);vm.runInContext(fs.readFileSync(path.join(base,'community-ui.js'),'utf8'),ctx);
 return {ctx,store,opened};
}
let fixture=setup('https://cubica3d.ar/?product=product-1');
assert(fixture.ctx.window.cubicaOpenProductLink());assert.deepEqual(fixture.opened,['product-1']);assert(!fixture.ctx.window.cubicaOpenProductLink(),'does not double-count opening');
fixture=setup('https://cubica3d.ar/',false,'product-1');
assert.equal(fixture.ctx.window.cubicaAuthRedirectUrl(),'https://cubica3d.ar/?product=product-1');
assert(!fixture.ctx.window.cubicaOpenProductLink());fixture.ctx.session={role:'customer',supabaseUserId:'user'};
fixture.ctx.window.cubicaNavigateAfterSignIn();assert.deepEqual(fixture.opened,['product-1']);assert(!fixture.store.has('cubica_auth_product'));
fixture=setup('https://cubica3d.ar/?product=product-1#type=recovery',true);assert(!fixture.ctx.window.cubicaOpenProductLink());
fixture=setup('https://cubica3d.ar/?view=orders&product=product-1',true);assert(!fixture.ctx.window.cubicaOpenProductLink());
fixture=setup('https://cubica3d.ar/',true,'product-1');fixture.store.set('cubica_auth_destination','orders');assert(!fixture.ctx.window.cubicaOpenProductLink());
fixture=setup('https://cubica3d.ar/?product=unavailable');assert(!fixture.ctx.window.cubicaOpenProductLink());
console.log('PASS: public product link, Google/email stored return, single opening, recovery priority, orders priority and unavailable product.');
