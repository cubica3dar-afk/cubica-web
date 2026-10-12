const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const base=path.join(__dirname,'../js');
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function setup(url='https://cubica3d.ar/',withCommunity=false,withShell=false){
 let currentUrl=new URL(url),activeSection='store',checkoutCount=0;
 const nodes=new Map(),listeners=new Map(),storage=new Map(),timers=[],events=[],metrics=[],rpcCalls=[],history=[currentUrl.href],messages=[];
 function node(id){
  if(nodes.has(id))return nodes.get(id);
  const classes=new Set(),element={id,value:'',disabled:false,dataset:{},textContent:'',classList:{add:cls=>classes.add(cls),remove:cls=>classes.delete(cls),contains:cls=>classes.has(cls),toggle(cls,state){state??=!classes.has(cls);if(state)classes.add(cls);else classes.delete(cls);}},focus(){},scrollIntoView(){},querySelector(selector){if(selector==='h1')return {focus(){}};if(selector==='.product-detail-grid')return this.innerHTML.includes('product-detail-grid')?{}:null;return null;},querySelectorAll(){return [];},click(){if(id==='checkout-btn')checkoutCount++;},setAttribute(){}};
  let html='';Object.defineProperty(element,'innerHTML',{get:()=>html,set:value=>{html=value;const quantity=String(value).match(/id="detail-qty"[^>]*value="([^"]*)"/);if(quantity)node('detail-qty').value=quantity[1];}});
  nodes.set(id,element);return element;
 }
 const products=[{id:'product-1',name:'Velador búho',category:'Veladores',price:12000,stock:0,description:'Diseño para tu casa.',colors:[{name:'Blanco',hex:'#fff'},{name:"Azul 'marino'",hex:'#123456'}],colorMode:'single',media:[{type:'image',src:'https://example.test/buho.jpg'},{type:'video',src:'https://example.test/buho.mp4'}],recipe:[{supplyId:'private-material',qty:240}]},{id:'product-2',name:'Figura',category:'Figuras',price:5000,stock:2,colors:[],media:[]}];
 const window={get location(){return currentUrl;},history:{pushState(_state,_unused,target){currentUrl=new URL(target,currentUrl);history.push(currentUrl.href);},replaceState(_state,_unused,target){currentUrl=new URL(target,currentUrl);history[history.length-1]=currentUrl.href;}},cubicaCatalogState:'ready',addEventListener(type,handler){const list=listeners.get(type)||[];list.push(handler);listeners.set(type,list);},dispatchEvent(event){events.push(event);for(const handler of listeners.get(event.type)||[])handler(event);},cubicaTrackEvent:(...args)=>metrics.push(args),cubicaAuthRedirectUrl:()=>currentUrl.origin+currentUrl.pathname,cubicaNavigateAfterSignIn(){},cubicaOpenOrdersLink:()=>false,cubicaSupabase:{async rpc(name,args){rpcCalls.push([name,args]);return {data:{product_likes:4,my_reaction:null,comments:[],has_more:false},error:null};}}};
 const ctx={window,URL,URLSearchParams,Intl,console,products,cart:[{productId:'product-2',qty:2,color:''}],session:null,supplies:[{id:'private-material',cost:500,qty:10000}],DEFAULT_FINISHED_CATEGORIES:[],STORAGE:{cart:'cart',products:'products'},localStorage:{getItem:()=>null,setItem(){}},sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},document:{body:node('body'),addEventListener(){},querySelectorAll:selector=>selector==='.page-section'?['store','login','product','orders','cart'].map(id=>node('section-'+id)):[]},CustomEvent:function(type,options={}){this.type=type;this.detail=options.detail;},$:node,escapeHtml:escape,money:value=>`$${value}`,write(){},toast:message=>messages.push(message),renderPagination(){},renderOrders(){},formatDate:String,setTimeout:callback=>timers.push(callback),showSection(id){window.cubicaProductNavigation?.(id);activeSection=id;if(id==='cart')ctx.renderCart();},closeModal(id){node(id).classList.add('hidden');},openModal(){throw new Error('Product page must not open a modal');}};
 Object.defineProperty(ctx,'location',{get:()=>currentUrl});vm.createContext(ctx);
 for(const file of ['store-ui.js','products-ui.js',...(withShell?['ui-shell.js']:[]),...(withCommunity?['community-ui.js']:[])])vm.runInContext(fs.readFileSync(path.join(base,file),'utf8'),ctx,{filename:file});
 return {ctx,node,window,history,storage,events,metrics,rpcCalls,messages,timers,get section(){return activeSection;},get checkoutCount(){return checkoutCount;},pop(url,state){currentUrl=new URL(url);window.dispatchEvent({type:'popstate',state});},flush(){while(timers.length)timers.shift()();}};
}
test('full product page creates shareable URL and browser back/forward without duplicate opens',()=>{
 const f=setup();f.ctx.openProductDetail('product-1');
 assert.equal(f.section,'product');assert.equal(f.history.at(-1),'https://cubica3d.ar/?product=product-1');
 assert.match(f.node('product-detail-content').innerHTML,/<h1[^>]*>Velador búho/);
 assert.equal(f.events.filter(e=>e.type==='cubica:product-open').length,1);assert.equal(f.metrics.filter(e=>e[0]==='product_view').length,1);
 f.ctx.openProductDetail('product-1');assert.equal(f.metrics.filter(e=>e[0]==='product_view').length,1);
 f.pop('https://cubica3d.ar/');assert.equal(f.section,'store');
 f.pop('https://cubica3d.ar/?product=product-1');assert.equal(f.section,'product');assert.equal(f.metrics.filter(e=>e[0]==='product_view').length,2);
 assert.equal(f.history.length,2,'popstate does not create new history entries');
});
test('direct URL preserves old links and opens existing Community below details',async()=>{
 const f=setup('https://cubica3d.ar/?product=product-1',true);
 assert.equal(f.window.cubicaOpenProductLink(),true);await new Promise(setImmediate);
 assert.equal(f.section,'product');assert.equal(f.history.length,1);
 assert.deepEqual(f.rpcCalls.map(call=>call[0]),['get_product_community']);
 assert.match(f.node('product-community').innerHTML,/Comunidad/);assert.match(f.node('product-community').innerHTML,/No me gusta/);
 f.window.cubicaOpenProductLink();assert.equal(f.metrics.filter(e=>e[0]==='product_view').length,1);
 assert.doesNotMatch(f.node('product-detail-content').innerHTML,/private-material|10000|Receta|cost/);
});
test('pending, failed and unavailable server catalog are distinct route states',()=>{
 const f=setup('https://cubica3d.ar/?product=missing');f.window.cubicaCatalogState='loading';
 f.ctx.openProductDetail('missing',{history:'none'});assert.match(f.node('product-detail-content').innerHTML,/Cargando producto/);
 f.window.cubicaCatalogState='error';f.window.dispatchEvent(new f.ctx.CustomEvent('cubica:catalog-error'));assert.match(f.node('product-detail-content').innerHTML,/No pudimos cargar/);
 f.window.cubicaCatalogState='ready';f.window.dispatchEvent(new f.ctx.CustomEvent('cubica:catalog-ready'));assert.match(f.node('product-detail-content').innerHTML,/Producto no encontrado/);
 assert.equal(f.node('product-community').classList.contains('hidden'),true);assert.equal(f.metrics.length,0);
});
test('loading route resolves once the real product becomes available',()=>{
 const f=setup('https://cubica3d.ar/?product=later');f.window.cubicaCatalogState='loading';f.ctx.openProductDetail('later',{history:'none'});
 f.ctx.products.push({id:'later',name:'Nuevo',category:'Figuras',price:3000,colors:[],media:[]});f.window.cubicaCatalogState='ready';f.window.dispatchEvent(new f.ctx.CustomEvent('cubica:catalog-ready'));
 assert.match(f.node('product-detail-content').innerHTML,/>Nuevo<\/h1>/);assert.equal(f.metrics.filter(e=>e[0]==='product_view').length,1);
});
test('Buy now merges selected variant and quantity, retains other items, opens checkout exactly once',()=>{
 const f=setup();f.ctx.openProductDetail('product-1');f.ctx.setProductQuantity('3');f.node('detail-qty').value='3';f.ctx.selectProductColor("Azul 'marino'");
 assert.equal(f.node('detail-qty').value,'3','changing variant preserves quantity');
 assert.equal(f.ctx.buyProductNow(),true);assert.equal(f.ctx.buyProductNow(),false);assert.equal(f.ctx.addDetailToCart(),false);
 assert.equal(f.section,'cart');assert.equal(f.checkoutCount,1);assert.equal(f.ctx.cart.length,2);
 assert.equal(f.ctx.cart[0].productId,'product-2');assert.equal(f.ctx.cart[1].qty,3);assert.equal(f.ctx.cart[1].color,"Azul 'marino'");
 assert.equal(f.metrics.filter(e=>e[0]==='add_to_cart').length,1);assert.equal(f.node('cart-badge').textContent,'5');
 assert.equal(f.history.at(-1),'https://cubica3d.ar/');
});
test('secondary action stays on page, gives live feedback, merges cart on a later intentional action',()=>{
 const f=setup();f.ctx.openProductDetail('product-1');assert(f.ctx.addDetailToCart());assert.equal(f.section,'product');assert.equal(f.checkoutCount,0);
 assert.match(f.node('product-purchase-feedback').textContent,/Producto agregado al carrito/);assert.equal(f.node('product-buy-now').disabled,true);
 f.flush();assert.equal(f.node('product-buy-now').disabled,false);assert(f.ctx.addDetailToCart());assert.equal(f.ctx.cart[1].qty,2);assert.equal(f.metrics.filter(e=>e[0]==='add_to_cart').length,2);
});
test('rejects empty, zero, negative, fractional and unsafe quantities without cart metrics',()=>{
 const f=setup();f.ctx.openProductDetail('product-1');
 for(const qty of ['',0,-1,1.5,101,Infinity,'9007199254740993']){f.node('detail-qty').value=qty;assert.equal(f.ctx.buyProductNow(),false);}
 assert.equal(f.ctx.cart.length,1);assert.equal(f.checkoutCount,0);assert.equal(f.metrics.filter(e=>e[0]==='add_to_cart').length,0);
});
test('respects backend limit of 100 units per cart variant',()=>{
 const f=setup();f.ctx.openProductDetail('product-1');f.node('detail-qty').value='100';assert(f.ctx.addDetailToCart());f.flush();f.node('detail-qty').value='1';assert.equal(f.ctx.addDetailToCart(),false);assert.equal(f.ctx.cart[1].qty,100);assert.equal(f.metrics.filter(e=>e[0]==='add_to_cart').length,1);
 f.ctx.changeCart('product-1',101,'Blanco');assert.equal(f.ctx.cart[1].qty,100);f.ctx.changeCart('product-1',99,'Blanco');assert.equal(f.ctx.cart[1].qty,99);
});
test('Supabase route waits for authoritative catalog instead of showing browser cached products',()=>{
 const f=setup('https://cubica3d.ar/?product=product-1');f.window.CUBICA_CONFIG={mode:'supabase'};f.window.cubicaCatalogState=undefined;f.ctx.openProductDetail('product-1',{history:'none'});
 assert.match(f.node('product-detail-content').innerHTML,/Cargando producto/);assert.equal(f.metrics.length,0);
 f.window.cubicaCatalogState='ready';f.window.dispatchEvent(new f.ctx.CustomEvent('cubica:catalog-ready'));assert.match(f.node('product-detail-content').innerHTML,/Velador búho/);assert.equal(f.metrics.filter(e=>e[0]==='product_view').length,1);
});
test('empty authoritative catalog does not expose cached product while admin migration keeps its cache',()=>{
 const f=setup('https://cubica3d.ar/?product=product-1');f.window.CUBICA_CONFIG={mode:'supabase'};f.window.cubicaCatalogEmpty=true;f.window.cubicaCatalogState='ready';
 f.ctx.openProductDetail('product-1',{history:'none'});assert.match(f.node('product-detail-content').innerHTML,/Producto no encontrado/);assert.equal(f.metrics.length,0);assert.equal(f.ctx.products.length,2,'migration cache remains intact');
});
test('multiple colors must be selected from configured variants and gallery retains quantity',()=>{
 const f=setup();f.ctx.products[0].colorMode='multiple';f.ctx.openProductDetail('product-1');f.ctx.setProductQuantity('4');f.node('detail-qty').value='4';f.ctx.changeProductMedia(1);
 assert.equal(f.node('detail-qty').value,'4');f.ctx.toggleProductColor('Blanco');assert.equal(f.ctx.buyProductNow(),false);
 f.ctx.toggleProductColor('missing-color');assert.equal(f.ctx.buyProductNow(),false);
 f.ctx.toggleProductColor("Azul 'marino'");assert(f.ctx.addDetailToCart());assert.equal(f.ctx.cart[1].color,"Azul 'marino'");assert.equal(f.ctx.cart[1].qty,4);
});
test('recovery callback takes priority over product route and purchase actions',()=>{
 const f=setup('https://cubica3d.ar/?product=product-1#type=recovery',true);assert.equal(f.window.cubicaOpenProductLink(),false);assert.equal(f.ctx.openProductDetail('product-1'),false);assert.equal(f.metrics.length,0);
 const expired=setup('https://cubica3d.ar/?product=product-1',true);expired.window.cubicaAuthCallbackBlocked=true;assert.equal(expired.window.cubicaOpenProductLink(),false);
});
test('Community login stores return, clears it on authenticated return and never loses orders priority',()=>{
 const f=setup('https://cubica3d.ar/',true);f.storage.set('cubica_auth_product','product-1');
 // Reloaded pending login route is captured during script initialization.
 const pending=setup('https://cubica3d.ar/?product=product-1',true);pending.storage.set('cubica_auth_product','product-1');assert.equal(pending.window.cubicaOpenProductLink(),false);
 pending.ctx.session={role:'customer',supabaseUserId:'user'};pending.window.cubicaNavigateAfterSignIn();assert.equal(pending.section,'product');assert.equal(pending.storage.has('cubica_auth_product'),false);
 const orders=setup('https://cubica3d.ar/?view=orders&product=product-1',true);assert.equal(orders.window.cubicaOpenProductLink(),false);
});
test('actual shell startup does not erase shared product URL before authoritative catalog loads',()=>{
 const f=setup('https://cubica3d.ar/?product=product-1',true,true);f.window.CUBICA_CONFIG={mode:'supabase'};f.window.cubicaCatalogState=undefined;
 f.ctx.showSection('store');assert.equal(f.window.cubicaOpenProductLink(),true);assert.equal(f.history.at(-1),'https://cubica3d.ar/?product=product-1');
 assert.equal(f.node('section-product').classList.contains('hidden'),false);assert.match(f.node('product-detail-content').innerHTML,/Cargando producto/);
 f.window.cubicaCatalogState='ready';f.window.dispatchEvent(new f.ctx.CustomEvent('cubica:catalog-ready'));assert.equal(f.metrics.filter(e=>e[0]==='product_view').length,1);
 f.ctx.backToProductCatalog();assert.equal(f.node('section-store').classList.contains('hidden'),false);assert.equal(f.history.at(-1),'https://cubica3d.ar/');
 f.pop('https://cubica3d.ar/?product=product-1');assert.equal(f.node('section-product').classList.contains('hidden'),false);
});
test('actual shell keeps recovery priority and Community login destination',()=>{
 const f=setup('https://cubica3d.ar/?product=product-1',true,true);f.ctx.openProductDetail('product-1',{history:'none'});f.storage.set('cubica_auth_product','product-1');f.ctx.showSection('login');
 assert.equal(f.history.at(-1),'https://cubica3d.ar/?product=product-1');assert.equal(f.node('section-login').classList.contains('hidden'),false);
 f.ctx.session={role:'customer',supabaseUserId:'user'};f.window.cubicaNavigateAfterSignIn();assert.equal(f.node('section-product').classList.contains('hidden'),false);
 f.window.cubicaAuthCallbackBlocked=true;f.ctx.showSection('product');assert.equal(f.node('section-login').classList.contains('hidden'),false);assert.equal(f.window.cubicaProductPageActive(),false);
});
test('actual shell supports back and forward between orders and product routes',()=>{
 const f=setup('https://cubica3d.ar/?product=product-1',true,true);f.ctx.session={role:'customer',supabaseUserId:'user'};f.window.cubicaOpenProductLink();
 f.pop('https://cubica3d.ar/?view=orders');assert.equal(f.node('section-orders').classList.contains('hidden'),false);
 f.pop('https://cubica3d.ar/?product=product-1');assert.equal(f.node('section-product').classList.contains('hidden'),false);assert.equal(f.history.at(-1),'https://cubica3d.ar/?product=product-1');
 assert.equal(f.storage.has('cubica_auth_destination'),false);
});
test('catalog cards are real links with a shareable URL and preserve modified clicks',()=>{
 const f=setup();f.ctx.renderProducts();const markup=f.node('product-grid').innerHTML;
 assert.match(markup,/<a class="product-card product-card-clickable" href="\?product=product-1"/);
 assert.match(markup,/!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey/);assert.doesNotMatch(markup,/<article class="product-card/);
});
test('index embeds one dedicated page and one community host with styles after base stylesheet',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');for(const id of ['section-product','product-detail-content','product-community'])assert.equal((source.match(new RegExp(`id="${id}"`,'g'))||[]).length,1);
 assert.doesNotMatch(source,/id="product-detail-modal"/);assert(source.indexOf('styles-product-page.css')>source.indexOf('styles.css'));
});

test('back from checkout closes its overlay and forward restores the cart',()=>{
 const f=setup();f.ctx.openProductDetail('product-1');f.ctx.buyProductNow();
 f.node('checkout-modal').classList.remove('hidden');
 f.pop('https://cubica3d.ar/?product=product-1');
 assert.equal(f.section,'product');assert(f.node('checkout-modal').classList.contains('hidden'));
 f.pop('https://cubica3d.ar/',{cubicaView:'cart'});
 assert.equal(f.section,'cart');assert(f.node('checkout-modal').classList.contains('hidden'));
 assert.equal(f.ctx.cart.find(i=>i.productId==='product-1').qty,1);
});

