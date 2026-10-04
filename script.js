/* CÚBICA 3D — aplicación front-end.
   Inventario, productos, categorías, presupuestos guardados y ventas se sincronizan
   con SQLite en la Raspberry Pi. localStorage queda como caché/migración y para datos
   temporales del dispositivo (sesión y carrito). */

const STORAGE = {
  session:"cubica_session", products:"cubica_finished_products", supplies:"cubica_supplies",
  orders:"cubica_orders", cart:"cubica_cart", quotes:"cubica_quotes", supplyCategories:"cubica_supply_categories"
};


const CUBICA_RUNTIME = window.CUBICA_CONFIG || {};
const HAS_BACKEND = !!String(CUBICA_RUNTIME.apiBase || '').trim();
const apiUrl = path => window.cubicaApiUrl ? window.cubicaApiUrl(path) : path;
const initialProducts = [
  ["Buho Led","Veladores",44000,1],["Cuadro river con base retroiluminada personalizado","Decoración",30000,2],
  ["Cierre Bolsa Simple","Accesorios",7700,11],["Cierre Bolsa Simple Personalizado","Accesorios",12000,4],
  ["Cuadro river con base basic chico","Decoración",16000,1],["Oso panda velador","Veladores",44000,1],
  ["Sonic pintado","Figuras",9500,1],["Gato velador blanco","Veladores",48400,1],
  ["Messi pintado cara","Figuras",20000,1],["Dummy 13","Figuras",9000,2],
  ["Espada minecraft sin led","Figuras",20000,0],["Polaroid Arcoiris","Decoración",4500,2],
  ["Polaroid Flor","Decoración",3000,3],["Pikachu estuche cepillo","Accesorios",4500,1],
  ["Squirtle estuche cepillo","Accesorios",4500,1],["Gengar estuche cepillo","Accesorios",4500,1]
].map((p,i)=>({id:"p"+i,name:p[0],category:p[1],price:p[2],stock:p[3]}));

const initialSupplies = [
  ["Resistencias 220 ohms","Electrónica",56.28],["LED 3 V ROSA","Iluminación",102.39],
  ["LED 3 V AMARILLO","Iluminación",102.39],["LED 3 V VERDE","Iluminación",102.39],
  ["LED 3 V ROJO","Iluminación",102.39],["ADAP MICROUSB","Electrónica",219.05],
  ["INTERRUPTOR","Electrónica",1300],["barra silicona","Otros",500],["Cuerda","Otros",35],
  ["Pilas AA Vinnic","Electrónica",725],["Interruptor pequeño","Electrónica",814],
  ["PORTA PILAS x3 AAA","Electrónica",1478.33],["Unidor de leds","Electrónica",1200],
  ["Modulo touch","Electrónica",327.85],["Modulo de carga tp4056 usb c/ protección","Electrónica",900.87],
  ["luces led blanca frias 5v","Iluminación",5396.75],["LED 3V BLANCO","Iluminación",102.39],
  ["M.ESP32C3","Electrónica",7299],["M.Display 0.96 128x64","Electrónica",7490],
  ["Lampara Gota","Iluminación",2000],["Perilla Kalop","Electrónica",3000],
  ["Ficha 2 Patas blanco","Electrónica",1000],["Porta Lampara","Iluminación",1000],
  ["cable textil 10 mts","Electrónica",2625],["Filamento PLA+ Fremover ($/kg)","Filamento",18692],
  ["Filamento ASA Fremover ($/kg)","Filamento",21000],["Filamento PLA GST3D ($/kg)","Filamento",16990],
  ["Filamento ASA GST3D ($/kg)","Filamento",20828],["Caja + bolsa presentación","Packaging",1200],
  ["Bolsa transparente","Packaging",1000]
].map((s,i)=>({id:"s"+i,name:s[0],category:s[1],cost:s[2],qty:0}));

const DEFAULT_SUPPLY_CATEGORIES = ["Filamentos","Electrónica","Cajas","Electricidad","Iluminación","Packaging","Otros"];
const DEFAULT_FINISHED_CATEGORIES = ["Figuras","Veladores","Decoración","Accesorios"];
let finishedColors = [];
let finishedRecipe = [];
let finishedMedia = [];
let detailProductId = null;
let detailMediaIndex = 0;
let detailSelectedColor = "";
let detailSelectedColors = [];

const $ = id => document.getElementById(id);
const money = n => new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS",maximumFractionDigits:0}).format(Number(n)||0);
const read = (key,fallback) => { try { const x=localStorage.getItem(key); return x?JSON.parse(x):fallback; } catch { return fallback; } };
const writeLocal = (key,value) => localStorage.setItem(key,JSON.stringify(value));
const SERVER_STATE_KEYS = new Map([
  [STORAGE.products,"products"],
  [STORAGE.supplies,"supplies"],
  [STORAGE.supplyCategories,"supplyCategories"],
  [STORAGE.orders,"orders"],
  [STORAGE.quotes,"quotes"]
]);
const LOCAL_STATE_PRESENT = Object.fromEntries([...SERVER_STATE_KEYS.keys()].map(k=>[k, localStorage.getItem(k)!==null]));
let serverStateReady=false;
let serverStateInitialized=false;
let serverWriteChain=Promise.resolve();
let serverSyncError=false;
function updateServerBadge(text,mode="ok"){
  const el=$("server-sync-badge"); if(!el)return;
  el.textContent=text; el.dataset.mode=mode; el.classList.remove("hidden");
}
function queueServerWrite(localKey,value){
  if(!HAS_BACKEND)return;
  const serverKey=SERVER_STATE_KEYS.get(localKey);
  if(!serverStateReady||!serverKey)return;
  serverWriteChain=serverWriteChain.then(async()=>{
    const r=await fetch(apiUrl(`/api/state/${encodeURIComponent(serverKey)}`),{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({value})});
    if(!r.ok)throw new Error(`No se pudo guardar ${serverKey} en el servidor.`);
    if(serverSyncError){serverSyncError=false;updateServerBadge("Datos: Raspberry","ok");}
  }).catch(err=>{console.error("Sincronización Cúbica",err);serverSyncError=true;updateServerBadge("Datos: sin sincronizar","error");});
}
function write(key,value){
  writeLocal(key,value);
  queueServerWrite(key,value);
}
async function migrateCurrentBrowserToServer(force=false){
  if(!HAS_BACKEND) throw new Error("GitHub Pages no tiene base de datos de servidor configurada.");
  const state={products,supplies,supplyCategories,orders,quotes:read(STORAGE.quotes,[])};
  const r=await fetch(apiUrl("/api/state/bootstrap"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({state,force})});
  const out=await r.json().catch(()=>({}));
  if(!r.ok||!out.ok)throw new Error(out.error||"No se pudieron migrar los datos.");
  serverStateInitialized=true;serverStateReady=true;
  updateServerBadge("Datos: Raspberry","ok");
  return out;
}
async function initServerState(){
  if(!HAS_BACKEND){serverStateReady=false;serverStateInitialized=false;updateServerBadge("Datos: navegador","warn");return;}
  try{
    updateServerBadge("Datos: conectando…","pending");
    const r=await fetch(apiUrl("/api/state"),{cache:"no-store"});
    const out=await r.json();
    if(!r.ok||!out.ok)throw new Error(out.error||"No se pudo leer la Raspberry.");
    const st=out.state||{};
    serverStateInitialized=!!out.initialized;
    if(serverStateInitialized){
      if(Array.isArray(st.products))products=st.products;
      if(Array.isArray(st.supplies))supplies=st.supplies;
      if(Array.isArray(st.supplyCategories))supplyCategories=st.supplyCategories;
      if(Array.isArray(st.orders))orders=st.orders;
      if(Array.isArray(st.quotes))writeLocal(STORAGE.quotes,st.quotes);
      writeLocal(STORAGE.products,products);writeLocal(STORAGE.supplies,supplies);writeLocal(STORAGE.supplyCategories,supplyCategories);writeLocal(STORAGE.orders,orders);
      serverStateReady=true;updateServerBadge("Datos: Raspberry","ok");
      return;
    }
    const hasLegacy=Object.entries(LOCAL_STATE_PRESENT).some(([k,present])=>present && k!==STORAGE.session && k!==STORAGE.cart);
    if(hasLegacy){
      await migrateCurrentBrowserToServer(false);
      window.__cubicaMigratedFromBrowser=true;
      return;
    }
    serverStateReady=false;
    updateServerBadge("Datos: migración pendiente","warn");
  }catch(err){
    console.error("Estado del servidor",err);serverStateReady=false;
    updateServerBadge("Datos: modo local","error");
  }
}
async function refreshServerState(){
  if(!HAS_BACKEND||!serverStateInitialized)return;
  const r=await fetch(apiUrl("/api/state"),{cache:"no-store"});
  const out=await r.json();
  if(!r.ok||!out.ok)return;
  const st=out.state||{};
  if(Array.isArray(st.products))products=st.products;
  if(Array.isArray(st.supplies))supplies=st.supplies;
  if(Array.isArray(st.supplyCategories))supplyCategories=st.supplyCategories;
  if(Array.isArray(st.orders))orders=st.orders;
  if(Array.isArray(st.quotes))writeLocal(STORAGE.quotes,st.quotes);
  writeLocal(STORAGE.products,products);writeLocal(STORAGE.supplies,supplies);writeLocal(STORAGE.supplyCategories,supplyCategories);writeLocal(STORAGE.orders,orders);
}
const escapeHtml = s => String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const uid = p => p+Date.now().toString(36)+Math.random().toString(36).slice(2,7);

let products = read(STORAGE.products, initialProducts);
let supplies = read(STORAGE.supplies, initialSupplies);
let supplyCategories = read(STORAGE.supplyCategories, DEFAULT_SUPPLY_CATEGORIES);
let orders = read(STORAGE.orders, []);
let cart = read(STORAGE.cart, []);
let session = read(STORAGE.session, null);
let salesPeriod = "day";

function toast(msg){const el=document.createElement("div");el.className="toast";el.textContent=msg;$("toast-container").appendChild(el);setTimeout(()=>el.remove(),3000)}
function initData(){
  products = products.map(p=>normalizeProduct(p));
  supplies = supplies.map(s => ({...s, category: s.category === "Filamento" ? "Filamentos" : s.category}));
  supplyCategories = [...new Set([...DEFAULT_SUPPLY_CATEGORIES, ...supplyCategories, ...supplies.map(s=>s.category).filter(Boolean)])];
  writeLocal(STORAGE.products,products); writeLocal(STORAGE.supplies,supplies); writeLocal(STORAGE.supplyCategories,supplyCategories);
}
function formatDate(iso){return new Intl.DateTimeFormat("es-AR",{dateStyle:"medium",timeStyle:"short"}).format(new Date(iso))}
function todayKey(iso=new Date().toISOString()){const d=new Date(iso);return d.toLocaleDateString("sv-SE")}
const WELCOME_MESSAGES = [
  "Hay cosas que comprás porque las necesitás. Y hay otras que elegís porque simplemente querés tenerlas. Bienvenido a Cúbica.",
  "Que una impresión salga de una máquina no significa que sea una más. En Cúbica, cada objeto empieza con una idea y termina en tus manos.",
  "A veces un pequeño objeto puede cambiar un rincón, acompañar un momento o simplemente sacarte una sonrisa. Gracias por pasar por Cúbica.",
  "Elegiste algo hecho en 3D. Nosotros queremos que cuando llegue a tus manos se sienta mucho más que eso: que se sienta tuyo.",
  "Detrás de cada producto de Cúbica hay tiempo, material y muchas decisiones. Pero lo más importante sucede cuando finalmente llega a vos.",
  "No imprimimos solamente objetos. Le damos forma a ideas para que puedan encontrar un lugar en tu mundo. Bienvenido a Cúbica.",
  "Tu próxima compra puede terminar en un estante, en un escritorio, en una habitación o convertirse en un regalo inolvidable. Descubrila en Cúbica.",
  "Hay algo especial en recibir algo que fue creado para vos. Ojalá encuentres en Cúbica eso que estabas buscando sin saberlo.",
  "Cada pieza tiene un origen: una idea. Y quizás hoy esa idea encuentre un lugar en tu casa. Bienvenido a Cúbica.",
  "Gracias por elegir un emprendimiento que crea de a una pieza por vez. Esperamos que encuentres algo que realmente quieras llevarte.",
  "Lo que hoy ves en pantalla, mañana puede estar en tus manos. Elegí, imaginá y dejá que Cúbica haga el resto.",
  "Cúbica nace de transformar material en objetos con propósito. Ahora queremos transformar tu elección en algo que puedas disfrutar."
];

function navItems(){
  const base=[["store","Tienda"],["login","Ingresar"]];
  if(session) base.splice(2,0,["orders",session.role==="admin"?"Ventas / Pedidos":"Mis pedidos"]);
  if(session?.role==="admin") base.push(["stock-finished","Terminados"],["stock-supplies","Insumos"],["budget","Presupuestos"],["analytics","Análisis"]);
  return base;
}
function setupNav(){
  const nav=$("main-nav");nav.innerHTML="";
  navItems().forEach(([id,label])=>{const b=document.createElement("button");b.textContent=label;b.dataset.section=id;b.onclick=()=>showSection(id);nav.appendChild(b)});
  updateCartBadge();
}
function showSection(id){
  const section=$("section-"+id);
  if(!section)return;
  if(id==="orders" && !session){
    toast("Iniciá sesión para consultar tus pedidos.");
    id="login";
  }
  if(["stock-finished","stock-supplies","budget"].includes(id) && session?.role!=="admin"){
    toast("Esta sección es exclusiva del administrador.");
    id="login";
  }
  document.querySelectorAll(".page-section").forEach(s=>s.classList.add("hidden"));
  $("section-"+id).classList.remove("hidden");
  document.querySelectorAll(".nav button").forEach(b=>b.classList.toggle("active",b.dataset.section===id));
  if(id==="store") renderProducts(); if(id==="cart") renderCart(); if(id==="orders") renderOrders();
  if(id==="stock-finished") renderFinishedStock(); if(id==="stock-supplies") renderSupplies();
  if(id==="budget") renderBudget(); if(id==="analytics") renderAnalytics();
}
function renderWelcome(){
  const message=$("welcome-message");
  if(message){
    let index=Math.floor(Math.random()*WELCOME_MESSAGES.length);
    const previous=Number(sessionStorage.getItem("cubica_welcome_index"));
    if(WELCOME_MESSAGES.length>1 && index===previous) index=(index+1)%WELCOME_MESSAGES.length;
    sessionStorage.setItem("cubica_welcome_index",index);
    message.textContent=WELCOME_MESSAGES[index];
  }
}
function renderApp(){
  $("app").classList.remove("hidden");
  $("user-badge").textContent=session?(session.role==="admin"?"Administrador":"Cliente"):"";
  $("logout-btn").classList.toggle("hidden",!session);
  document.querySelectorAll(".admin-only").forEach(el=>el.classList.toggle("hidden",session?.role!=="admin"));
  setupNav();
  renderProducts();
  renderCart();
}
function renderProducts(){
  const search=($("product-search").value||"").trim().toLowerCase(), cat=$("product-category").value;
  const cats=[...new Set(products.map(p=>p.category).filter(Boolean))];
  const select=$("product-category");const current=select.value;
  select.innerHTML='<option value="all">Todas las categorías</option>'+cats.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  select.value=cats.includes(current)?current:"all";
  const list=products.filter(p=>{normalizeProduct(p); const hay=[p.name,p.category,p.description].join(" ").toLowerCase(); return (cat==="all"||p.category===cat)&&(!search||hay.includes(search));});
  $("product-grid").innerHTML=list.map(p=>{
    const firstImage=p.media.find(m=>m.type==="image");
    const cover=firstImage?`<img class="product-cover" src="${firstImage.src}" alt="${escapeHtml(p.name)}">`:`<div class="product-icon">${iconFor(p.category)}</div>`;
    return `<article class="product-card product-card-clickable" onclick="openProductDetail('${p.id}')">
      <div class="product-cover-wrap">${cover}${p.media.some(m=>m.type==="video")?'<span class="media-badge">▶ Video</span>':''}</div>
      <div class="product-meta">${escapeHtml(p.category)} · ${p.stock>0?`${p.stock} disponibles`:"Se fabrica a pedido"}</div>
      <h3>${escapeHtml(p.name)}</h3>
      <div class="price">${money(p.price)}</div>
      <div class="product-card-hint">Ver producto · fotos · colores · cantidad →</div>
    </article>`;
  }).join("") || '<div class="card" style="padding:25px">No hay productos que coincidan.</div>';
}
function iconFor(cat){return cat==="Veladores"?"◉":cat==="Figuras"?"♟":cat==="Decoración"?"◇":"▣"}
function addToCart(id, qtyOverride=null, colorOverride=null){
  const p=products.find(x=>x.id===id); if(!p)return;
  const input=$("qty-"+id); const q=Math.max(1,Number(qtyOverride ?? input?.value)||1);
  const color=colorOverride ?? (p.colors?.[0]?.name||"");
  const existing=cart.find(x=>x.productId===id && (x.color||"")===color); const next=(existing?.qty||0)+q;
  if(existing)existing.qty=next;else cart.push({productId:id,qty:q,color});
  write(STORAGE.cart,cart);toast("Producto agregado al carrito");renderCart();updateCartBadge();
}
function updateCartBadge(){
  const badge=$("cart-badge");
  if(!badge)return;
  const count=cart.reduce((sum,item)=>sum+(Number(item.qty)||0),0);
  badge.textContent=count>99?"99+":String(count);
  badge.classList.toggle("hidden",count<=0);
}
function renderCart(){
  const box=$("cart-items");
  if(!cart.length){box.innerHTML='<div class="muted">Tu carrito está vacío.</div>';$("cart-count").textContent="0";$("cart-total").textContent=money(0);updateCartBadge();return}
  let total=0,count=0;
  box.innerHTML=cart.map(item=>{
    const p=products.find(x=>x.id===item.productId);if(!p)return "";
    total+=p.price*item.qty;count+=item.qty;
    return `<div class="cart-row"><div><strong>${escapeHtml(p.name)}</strong><div class="muted">${item.color?`Color: ${escapeHtml(item.color)} · `:""}${money(p.price)} c/u</div></div>
      <input type="number" min="1" value="${item.qty}" onchange="changeCart('${p.id}',this.value,'${escapeHtml(item.color||"")}')">
      <strong>${money(p.price*item.qty)}</strong><button class="btn ghost" onclick="removeCart('${p.id}','${escapeHtml(item.color||"")}')">×</button></div>`;
  }).join("");
  $("cart-count").textContent=count;$("cart-total").textContent=money(total);updateCartBadge();
}
function changeCart(id,q,color=""){const item=cart.find(x=>x.productId===id && (x.color||"")===color),p=products.find(x=>x.id===id);q=Math.max(1,Number(q)||1);if(item)item.qty=q;write(STORAGE.cart,cart);renderCart();updateCartBadge()}
function removeCart(id,color=""){cart=cart.filter(x=>!(x.productId===id && (x.color||"")===color));write(STORAGE.cart,cart);renderCart();updateCartBadge()}
function openModal(id){$(id).classList.remove("hidden")}
function closeModal(id){$(id).classList.add("hidden")}

function finishedCategories(){
  return [...new Set([...DEFAULT_FINISHED_CATEGORIES, ...products.map(p=>p.category).filter(Boolean)])].sort((a,b)=>a.localeCompare(b,"es"));
}
function normalizeProduct(p){
  p.colors=Array.isArray(p.colors)?p.colors:[];
  p.colorMode=p.colorMode==="multiple"?"multiple":"single";
  p.recipe=Array.isArray(p.recipe)?p.recipe:[];
  p.media=Array.isArray(p.media)?p.media:[];
  p.description=typeof p.description==="string"?p.description:"";
  return p;
}
function productCapacity(recipe){
  if(!recipe?.length)return {capacity:null,bottlenecks:[]};
  const details=recipe.map(r=>{
    const supply=supplies.find(s=>s.id===r.supplyId);
    const perUnit=Number(r.qty)||0;
    const available=Number(supply?.qty)||0;
    const possible=perUnit>0?Math.floor(available/perUnit):Infinity;
    return {supply,perUnit,available,possible};
  }).filter(x=>x.supply && x.perUnit>0);
  if(!details.length)return {capacity:null,bottlenecks:[]};
  const capacity=Math.min(...details.map(x=>x.possible));
  return {capacity,bottlenecks:details.filter(x=>x.possible===capacity).map(x=>x.supply.name)};
}
function renderFinishedStock(){
  products.forEach(normalizeProduct);
  const search=(($('finished-search')?.value)||'').trim().toLowerCase();
  const cat=$('finished-category-filter')?.value||'all';
  const filtered=products.filter(p=>{const hay=[p.name,p.category,p.description].join(' ').toLowerCase();return (cat==='all'||p.category===cat)&&(!search||hay.includes(search));});
  const filter=$('finished-category-filter');
  if(filter){const current=filter.value;const cats=finishedCategories();filter.innerHTML='<option value="all">Todas las categorías</option>'+cats.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');filter.value=cats.includes(current)?current:'all';}
  $('finished-stock-table').innerHTML=`<table><thead><tr><th>Producto</th><th>Categoría</th><th>Color(es)</th><th>Precio</th><th>Stock</th><th>Capacidad por insumos</th><th>Valor stock</th><th></th></tr></thead><tbody>
  ${filtered.map(p=>{
    const cap=productCapacity(p.recipe);
    const colors=p.colors?.length?p.colors.map(c=>`<span class="mini-color" title="${escapeHtml(c.name||'Color')}" style="--mini-color:${escapeHtml(c.hex||'#fff')}"></span>`).join(''):`<span class="muted">—</span>`;
    const capacity=cap.capacity===null?`<span class="muted">Sin receta</span>`:`<span class="${cap.capacity===0?'stock-low':'stock-ok'}">${cap.capacity} u.</span><small class="capacity-note">${cap.bottlenecks.length?`Limita: ${escapeHtml(cap.bottlenecks.join(', '))}`:''}</small>`;
    const mediaCount=p.media?.length||0;
    return `<tr><td><div class="finished-name-cell">${p.media?.find(m=>m.type==='image')?`<img src="${p.media.find(m=>m.type==='image').src}" alt="">`:''}<div><strong>${escapeHtml(p.name)}</strong><small class="capacity-note">${p.recipe?.length||0} insumo(s) · ${mediaCount} medio(s)</small></div></div></td><td>${escapeHtml(p.category)}</td><td><div class="mini-colors">${colors}</div></td><td><input type="number" min="0" value="${p.price}" onchange="updateProduct('${p.id}','price',this.value)"></td>
    <td><input type="number" min="0" value="${p.stock}" onchange="updateProduct('${p.id}','stock',this.value)"></td><td>${capacity}</td><td>${money(p.price*p.stock)}</td>
    <td class="table-actions"><button class="btn ghost" onclick="editProduct('${p.id}')">Editar</button><button class="btn ghost" onclick="deleteProduct('${p.id}')">Eliminar</button></td></tr>`;
  }).join('')}</tbody></table>`;
}
function updateProduct(id,key,val){const p=products.find(x=>x.id===id);if(!p)return;p[key]=key==="price"||key==="stock"?Number(val):val;write(STORAGE.products,products);renderFinishedStock();renderProducts()}
function deleteProduct(id){if(!confirm("¿Eliminar este producto?"))return;products=products.filter(p=>p.id!==id);write(STORAGE.products,products);renderFinishedStock();renderProducts()}
function renderFinishedCategorySelect(selected=""){
  const select=$("finished-category");
  if(!select)return;
  const cats=finishedCategories();
  select.innerHTML=cats.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  select.value=cats.includes(selected)?selected:(cats[0]||"");
}
function renderFinishedColors(){
  const list=$("finished-colors-list"), empty=$("finished-colors-empty");
  list.innerHTML=finishedColors.map((c,i)=>`<div class="color-chip"><span class="color-dot" style="--color-dot:${escapeHtml(c.hex)}"></span><span>${escapeHtml(c.name)}</span><small>${escapeHtml(c.hex)}</small><button type="button" onclick="removeFinishedColor(${i})">×</button></div>`).join("");
  empty.classList.toggle("hidden",finishedColors.length>0);
}
function addFinishedColor(){
  const name=$("finished-color-name").value.trim();
  const hex=$("finished-color-hex").value||"#ffffff";
  if(!name)return toast("Escribí el nombre del color.");
  if(finishedColors.some(c=>c.name.toLowerCase()===name.toLowerCase()))return toast("Ese color ya está agregado.");
  finishedColors.push({name,hex});
  $("finished-color-name").value="";
  renderFinishedColors();
}
function removeFinishedColor(index){finishedColors.splice(index,1);renderFinishedColors()}
function renderFinishedRecipe(){
  const list=$("finished-recipe-list"),empty=$("finished-recipe-empty");
  const options=supplies.map(s=>`<option value="${s.id}">${escapeHtml(s.name)} · stock ${Number(s.qty)||0}</option>`).join("");
  list.innerHTML=finishedRecipe.map((r,i)=>{
    const supply=supplies.find(s=>s.id===r.supplyId);
    const max=supply && Number(r.qty)>0?Math.floor((Number(supply.qty)||0)/Number(r.qty)):null;
    return `<div class="recipe-row"><select onchange="updateFinishedRecipe(${i},'supplyId',this.value)"><option value="">Seleccionar insumo...</option>${options}</select><input type="number" min="0.0001" step="0.01" value="${r.qty}" onchange="updateFinishedRecipe(${i},'qty',this.value)" placeholder="Cantidad/u"><span class="recipe-stock">${supply?`Stock: <strong>${Number(supply.qty)||0}</strong> · ${max===null?'—':`hasta ${max} u.`}`:"Sin seleccionar"}</span><button type="button" class="btn ghost" onclick="removeFinishedRecipe(${i})">×</button></div>`;
  }).join("");
  empty.classList.toggle("hidden",finishedRecipe.length>0);
  updateFinishedCapacityPreview();
}
function updateFinishedRecipe(index,key,value){
  if(!finishedRecipe[index])return;
  finishedRecipe[index][key]=key==="qty"?Number(value):value;
  renderFinishedRecipe();
}
function removeFinishedRecipe(index){finishedRecipe.splice(index,1);renderFinishedRecipe()}
function addFinishedRecipeRow(){finishedRecipe.push({supplyId:"",qty:1});renderFinishedRecipe()}
function updateFinishedCapacityPreview(){
  const preview=$("finished-capacity-preview");
  if(!preview)return;
  const valid=finishedRecipe.filter(r=>r.supplyId && Number(r.qty)>0);
  if(!valid.length){preview.innerHTML=`<div><strong>Vista previa de producción</strong><span>Agregá los insumos necesarios por unidad para calcular cuántas unidades podés fabricar con el stock actual.</span></div>`;return;}
  const result=productCapacity(valid);
  const extra=result.bottlenecks.length?`<small>El límite actual lo determina: ${escapeHtml(result.bottlenecks.join(', '))}.</small>`:"";
  preview.innerHTML=`<div><strong>Podés fabricar aproximadamente ${result.capacity} unidad${result.capacity===1?'':'es'}</strong><span>Calculado con el stock disponible de cada insumo.</span>${extra}</div><strong class="capacity-number">${result.capacity}</strong>`;
}
async function fileToDataUrl(file, maxImageBytes=5*1024*1024, maxVideoBytes=8*1024*1024){
  const isVideo=file.type.startsWith('video/'); const max=isVideo?maxVideoBytes:maxImageBytes;
  if(file.size>max) throw new Error(`${file.name} supera el límite de ${Math.round(max/1024/1024)} MB.`);
  return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('No se pudo leer el archivo.'));r.readAsDataURL(file);});
}
function renderFinishedMedia(){
  const box=$('finished-media-preview'); if(!box)return;
  box.innerHTML=finishedMedia.length?finishedMedia.map((m,i)=>`<div class="media-admin-card">${m.type==='image'?`<img src="${m.src}" alt="">`:`<video src="${m.src}" muted controls preload="metadata"></video>`}<div><span>${m.type==='image'?'Imagen':'Video'} ${i+1}</span><button type="button" class="btn ghost" onclick="removeFinishedMedia(${i})">×</button></div></div>`).join(''):'<div class="inline-empty">Todavía no agregaste imágenes ni videos.</div>';
}
async function handleFinishedMediaInput(input,type){
  const files=[...input.files]; if(!files.length)return;
  const maxCount=type==='image'?6:2; const existing=finishedMedia.filter(m=>m.type===type).length;
  if(existing+files.length>maxCount){toast(`Podés agregar hasta ${maxCount} ${type==='image'?'imágenes':'videos'}.`);input.value='';return;}
  try{for(const file of files){const src=await fileToDataUrl(file);finishedMedia.push({id:uid('m'),type,src,name:file.name});}renderFinishedMedia();}catch(err){toast(err.message)}
  input.value='';
}
function removeFinishedMedia(index){finishedMedia.splice(index,1);renderFinishedMedia()}
function openProductDetail(id){
  const p=products.find(x=>x.id===id);if(!p)return;normalizeProduct(p);detailProductId=id;detailMediaIndex=0;detailSelectedColor=p.colors?.[0]?.name||'';detailSelectedColors=p.colors?.length?[p.colors[0].name]:[];renderProductDetail();openModal('product-detail-modal');
}
function renderProductDetail(){
  const p=products.find(x=>x.id===detailProductId);if(!p)return;normalizeProduct(p);
  const media=p.media?.length?p.media:[{type:'placeholder'}]; if(detailMediaIndex>=media.length)detailMediaIndex=0; const m=media[detailMediaIndex];
  const viewer=m.type==='image'?`<img src="${m.src}" alt="${escapeHtml(p.name)}">`:m.type==='video'?`<video src="${m.src}" controls playsinline></video>`:`<div class="product-detail-placeholder">${iconFor(p.category)}</div>`;
  const thumbs=media.map((x,i)=>`<button class="detail-thumb ${i===detailMediaIndex?'active':''}" onclick="setProductMedia(${i})">${x.type==='image'?`<img src="${x.src}" alt="">`:`<span>▶</span>`}</button>`).join('');
  let colors='';
  if(p.colors?.length){
    if(p.colorMode==='multiple'){
      colors=`<div class="detail-colors"><strong>Colores (podés elegir más de uno)</strong><div>${p.colors.map(c=>`<button class="detail-color ${detailSelectedColors.includes(c.name)?'selected':''}" onclick="toggleProductColor('${escapeHtml(c.name)}')"><span style="--color-dot:${escapeHtml(c.hex||'#fff')}"></span>${escapeHtml(c.name)}</button>`).join('')}</div><small class="muted">Seleccionados: ${escapeHtml(detailSelectedColors.join(' + ')||'ninguno')}</small></div>`;
    } else {
      colors=`<div class="detail-colors"><strong>Color</strong><div>${p.colors.map(c=>`<button class="detail-color ${detailSelectedColor===c.name?'selected':''}" onclick="selectProductColor('${escapeHtml(c.name)}')"><span style="--color-dot:${escapeHtml(c.hex||'#fff')}"></span>${escapeHtml(c.name)}</button>`).join('')}</div></div>`;
    }
  }
  $('product-detail-content').innerHTML=`<div class="product-detail-grid"><div><div class="detail-viewer">${viewer}${media.length>1?`<button class="detail-arrow left" onclick="changeProductMedia(-1)">‹</button><button class="detail-arrow right" onclick="changeProductMedia(1)">›</button>`:''}</div><div class="detail-thumbs">${thumbs}</div></div><div class="product-detail-info"><p class="eyebrow">${escapeHtml(p.category)}</p><h2>${escapeHtml(p.name)}</h2><div class="detail-price">${money(p.price)}</div><div class="detail-stock">${p.stock>0?`${p.stock} disponibles para entrega inmediata · También podés pedir más unidades`:'Se fabrica a pedido'}</div><div class="detail-description">${escapeHtml(p.description||'Producto de Cúbica. Consultanos si necesitás más información.').replace(/\n/g,'<br>')}</div>${colors}<div class="detail-buy"><label>Cantidad<input id="detail-qty" type="number" min="1" value="1"></label><button class="btn primary" onclick="addDetailToCart()">Agregar al carrito</button></div></div></div>`;
}
function setProductMedia(i){detailMediaIndex=i;renderProductDetail()}
function changeProductMedia(delta){const p=products.find(x=>x.id===detailProductId);const len=p?.media?.length||1;detailMediaIndex=(detailMediaIndex+delta+len)%len;renderProductDetail()}
function selectProductColor(color){detailSelectedColor=color;detailSelectedColors=[color];renderProductDetail()}
function toggleProductColor(color){if(detailSelectedColors.includes(color))detailSelectedColors=detailSelectedColors.filter(c=>c!==color);else detailSelectedColors.push(color);detailSelectedColor=detailSelectedColors[0]||'';renderProductDetail()}
function addDetailToCart(){const p=products.find(x=>x.id===detailProductId);const q=Math.max(1,Number($('detail-qty').value)||1);let color=p.colorMode==='multiple'?detailSelectedColors.join(' + '):detailSelectedColor;if(p.colors?.length && !color)return toast('Elegí al menos un color.');addToCart(p.id,q,color);closeModal('product-detail-modal')}

function resetFinishedProductForm(){
  $("finished-id").value="";$("finished-modal-title").textContent="Nuevo producto terminado";$("finished-submit").textContent="Agregar producto";
  $("finished-form").reset();renderFinishedCategorySelect("Figuras");
  finishedColors=[];finishedRecipe=[];finishedMedia=[];$("finished-multi-color").checked=false;renderFinishedColors();renderFinishedRecipe();renderFinishedMedia();
}
function editProduct(id){
  const p=products.find(x=>x.id===id);if(!p)return;normalizeProduct(p);
  $("finished-id").value=p.id;$("finished-modal-title").textContent="Editar producto terminado";$("finished-submit").textContent="Guardar cambios";
  $("finished-name").value=p.name;$("finished-price").value=p.price;$("finished-qty").value=p.stock;$("finished-description").value=p.description||"";
  renderFinishedCategorySelect(p.category);finishedColors=p.colors.map(c=>({...c}));$("finished-multi-color").checked=p.colorMode==="multiple";finishedRecipe=p.recipe.map(r=>({...r}));finishedMedia=p.media.map(m=>({...m}));
  renderFinishedColors();renderFinishedRecipe();renderFinishedMedia();openModal("finished-modal");
}
function saveFinishedProduct(e){
  e.preventDefault();
  const name=$("finished-name").value.trim(),category=$("finished-category").value,price=Number($("finished-price").value),stock=Number($("finished-qty").value),description=$("finished-description").value.trim(),colorMode=$("finished-multi-color").checked?"multiple":"single";
  if(!name)return toast("El producto necesita un nombre.");
  const recipe=finishedRecipe.filter(r=>r.supplyId && Number(r.qty)>0).map(r=>({supplyId:r.supplyId,qty:Number(r.qty)}));
  const id=$("finished-id").value;
  if(id){
    const p=products.find(x=>x.id===id);if(!p)return;Object.assign(p,{name,category,price,stock,description,colorMode,colors:finishedColors.map(c=>({...c})),recipe,media:finishedMedia.map(m=>({...m}))});toast("Producto actualizado");
  }else{
    products.push({id:uid("p"),name,category,price,stock,description,colorMode,colors:finishedColors.map(c=>({...c})),recipe,media:finishedMedia.map(m=>({...m}))});toast("Producto agregado");
  }
  write(STORAGE.products,products);e.target.reset();closeModal("finished-modal");renderFinishedStock();renderProducts();
}
function renderSupplyCategoryControls(){
  const filter=$("supply-category-filter");
  const current=filter.value;
  filter.innerHTML='<option value="all">Todas las categorías</option>'+supplyCategories.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  filter.value=supplyCategories.includes(current)?current:"all";
  const select=$("supply-category");
  const selected=select.value;
  select.innerHTML=supplyCategories.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  select.value=supplyCategories.includes(selected)?selected:(supplyCategories[0]||"");
  $("supply-category-list").innerHTML=supplyCategories.map(c=>{
    const count=supplies.filter(s=>s.category===c).length;
    const locked=DEFAULT_SUPPLY_CATEGORIES.includes(c);
    return `<div class="category-chip"><span>${escapeHtml(c)} <small>${count}</small></span><button class="category-delete ${locked?"disabled":""}" ${locked?"disabled":""} title="${locked?"Categoría base":"Eliminar categoría"}" onclick="deleteSupplyCategory('${escapeHtml(c)}')">×</button></div>`;
  }).join("");
}
function renderSupplies(){
  renderSupplyCategoryControls();
  const search=($("supply-search").value||"").trim().toLowerCase();
  const cat=$("supply-category-filter").value;
  const filtered=supplies.filter(s=>{
    const matchesText=!search || s.name.toLowerCase().includes(search) || s.category.toLowerCase().includes(search);
    const matchesCategory=cat==="all" || s.category===cat;
    return matchesText && matchesCategory;
  });
  const total=supplies.reduce((a,s)=>a+s.cost*s.qty,0);
  const filteredTotal=filtered.reduce((a,s)=>a+s.cost*s.qty,0);
  $("stock-value-card").innerHTML=`<span>Valor acumulado en depósito</span><strong>${money(total)}</strong><span>${supplies.length} insumos registrados · costo unitario × cantidad${filtered.length!==supplies.length?` · vista filtrada: ${money(filteredTotal)}`:""}</span>`;
  $("supplies-stock-table").innerHTML=`<table><thead><tr><th>Insumo</th><th>Categoría</th><th>Costo unitario</th><th>Cantidad</th><th>Valor</th><th></th></tr></thead><tbody>
  ${filtered.length ? filtered.map(s=>`<tr><td>${escapeHtml(s.name)}</td><td><select onchange="updateSupply('${s.id}','category',this.value)">${supplyCategories.map(c=>`<option value="${escapeHtml(c)}" ${s.category===c?"selected":""}>${escapeHtml(c)}</option>`).join("")}</select></td><td><input type="number" min="0" step="0.01" value="${s.cost}" onchange="updateSupply('${s.id}','cost',this.value)"></td>
  <td><input type="number" min="0" step="0.01" value="${s.qty}" onchange="updateSupply('${s.id}','qty',this.value)"></td><td>${money(s.cost*s.qty)}</td>
  <td><button class="btn ghost" onclick="deleteSupply('${s.id}')">Eliminar</button></td></tr>`).join("") : `<tr><td colspan="6" class="empty-table">No se encontraron insumos con esos filtros.</td></tr>`}</tbody></table>`;
}
function updateSupply(id,key,val){const s=supplies.find(x=>x.id===id);if(!s)return;s[key]=(key==="cost"||key==="qty")?Number(val):val;write(STORAGE.supplies,supplies);renderSupplies();renderBudget()}
function deleteSupply(id){if(!confirm("¿Eliminar este insumo?"))return;supplies=supplies.filter(s=>s.id!==id);write(STORAGE.supplies,supplies);renderSupplies();renderBudget()}
function addSupplyCategory(name){
  name=name.trim().replace(/\s+/g," ");
  if(!name)return toast("Escribí un nombre para la categoría.");
  if(supplyCategories.some(c=>c.toLowerCase()===name.toLowerCase()))return toast("Esa categoría ya existe.");
  supplyCategories.push(name);supplyCategories.sort((a,b)=>a.localeCompare(b,"es"));write(STORAGE.supplyCategories,supplyCategories);renderSupplyCategoryControls();$("supply-category").value=name;toast(`Categoría "${name}" creada.`);
}
function deleteSupplyCategory(name){
  if(DEFAULT_SUPPLY_CATEGORIES.includes(name))return toast("Las categorías base no se pueden eliminar.");
  const used=supplies.some(s=>s.category===name);
  if(used){
    if(!confirm(`La categoría "${name}" tiene insumos. Se moverán a "Otros". ¿Continuar?`))return;
    supplies=supplies.map(s=>s.category===name?{...s,category:"Otros"}:s);write(STORAGE.supplies,supplies);
  }
  supplyCategories=supplyCategories.filter(c=>c!==name);write(STORAGE.supplyCategories,supplyCategories);renderSupplies();renderBudget();toast(`Categoría "${name}" eliminada.`);
}
function renderBudget(){
  const mat=$("budget-material");const current=mat.value;
  mat.innerHTML=supplies.filter(s=>s.category.toLowerCase().startsWith("filamento")).map(s=>`<option value="${s.cost}">${escapeHtml(s.name)} — ${money(s.cost)}/kg</option>`).join("");
  if(current)mat.value=current;
  renderBudgetSupplyRows();
  calculateBudget();
}
function renderBudgetSupplyRows(){
  const rows=window.budgetRows||[];$("budget-supplies").innerHTML=rows.map((r,i)=>`
    <div class="budget-supply-row"><select onchange="budgetRows[${i}].id=this.value;updateBudgetRow(${i})">
      <option value="">Sin insumo</option>${supplies.filter(s=>!s.category.toLowerCase().startsWith("filamento")).map(s=>`<option value="${s.id}" ${r.id===s.id?"selected":""}>${escapeHtml(s.name)} (${money(s.cost)})</option>`).join("")}</select>
      <input type="number" min="0" step="0.01" value="${r.qty}" onchange="budgetRows[${i}].qty=Number(this.value);calculateBudget()" placeholder="Cant.">
      <input class="row-cost" readonly value="${money(getSupplyCost(r.id)*r.qty)}">
      <button type="button" class="btn ghost" onclick="removeBudgetRow(${i})">×</button></div>`).join("");
}
window.budgetRows=[];
function getSupplyCost(id){return supplies.find(s=>s.id===id)?.cost||0}
function updateBudgetRow(){renderBudgetSupplyRows();calculateBudget()}
function removeBudgetRow(i){budgetRows.splice(i,1);renderBudgetSupplyRows();calculateBudget()}
function calculateBudget(){
  const weight=Number($("budget-weight").value)||0,time=Number($("budget-time").value)||0,watts=Number($("budget-watts").value)||0;
  const kwh=Number($("budget-kwh").value)||0,machine=Number($("budget-machine").value)||0,failure=(Number($("budget-failure").value)||0)/100,margin=(Number($("budget-margin").value)||0)/100;
  const suppliesMargin=(Number($("budget-supplies-margin")?.value)||0)/100;
  const materialPrice=Number($("budget-material").value)||0;
  const material=weight/1000*materialPrice,electricity=watts/1000*time*kwh,machineCost=time*machine;
  const suppliesCost=budgetRows.reduce((a,r)=>a+getSupplyCost(r.id)*r.qty,0);

  // El margen general ya no se aplica a los insumos adicionales.
  // La reserva de fallos se reparte proporcionalmente entre producción e insumos
  // para que cada grupo reciba luego su propio margen.
  const productionCost=material+electricity+machineCost;
  const subtotal=productionCost+suppliesCost;
  const fail=subtotal*failure;
  const productionFail=subtotal>0?fail*(productionCost/subtotal):0;
  const suppliesFail=subtotal>0?fail*(suppliesCost/subtotal):0;
  const productionTotal=productionCost+productionFail;
  const suppliesTotal=suppliesCost+suppliesFail;
  const productionSale=productionTotal*(1+margin);
  const suppliesSale=suppliesTotal*(1+suppliesMargin);
  const total=subtotal+fail;
  const sale=productionSale+suppliesSale;

  window.lastBudget={weight,time,materialPrice,material,electricity,machineCost,suppliesCost,productionCost,subtotal,fail,productionFail,suppliesFail,productionTotal,suppliesTotal,margin,suppliesMargin,productionSale,suppliesSale,total,sale};
  $("budget-result").innerHTML=`<h3>Resultado</h3>
    <div class="cost-line"><span>Material (${weight} g)</span><strong>${money(material)}</strong></div>
    <div class="cost-line"><span>Electricidad</span><strong>${money(electricity)}</strong></div>
    <div class="cost-line"><span>Costo máquina</span><strong>${money(machineCost)}</strong></div>
    <div class="cost-line"><span>Insumos adicionales · costo</span><strong>${money(suppliesCost)}</strong></div>
    <div class="cost-line"><span>Subtotal</span><strong>${money(subtotal)}</strong></div>
    <div class="cost-line"><span>Reserva por fallos</span><strong>${money(fail)}</strong></div>
    <div class="cost-line"><span>Costo total</span><strong>${money(total)}</strong></div>
    <div class="cost-line"><span>Producción + margen ${(margin*100).toFixed(0)}%</span><strong>${money(productionSale)}</strong></div>
    <div class="cost-line"><span>Insumos + margen ${(suppliesMargin*100).toFixed(0)}%</span><strong>${money(suppliesSale)}</strong></div>
    <div class="sale-price"><span>Precio de venta</span><strong>${money(sale)}</strong></div>`;
}

function budgetSummary(){const b=window.lastBudget;return `CÚBICA — PRESUPUESTO\nFilamento: ${b.weight} g\nMaterial: ${money(b.material)}\nElectricidad: ${money(b.electricity)}\nMáquina: ${money(b.machineCost)}\nInsumos: ${money(b.suppliesCost)}\nFallos: ${money(b.fail)}\nCosto total: ${money(b.total)}\nMargen general: ${b.margin*100}%\nMargen insumos: ${b.suppliesMargin*100}%\nPrecio de venta: ${money(b.sale)}`}
function saveBudget(){const b=window.lastBudget;if(!b)return;const qs=read(STORAGE.quotes,[]);qs.push({id:uid("q"),date:new Date().toISOString(),data:b,summary:budgetSummary()});write(STORAGE.quotes,qs);toast("Presupuesto guardado")}
async function copyBudget(){await navigator.clipboard.writeText(budgetSummary());toast("Resumen copiado")}

function renderOrders(){
  const mine=session.role==="admin"?orders:orders.filter(o=>o.customerEmail===session.email||o.username===session.username);
  const groups={};
  mine.forEach(o=>{
    const d=new Date(o.date),key=salesPeriod==="day"?todayKey(o.date):salesPeriod==="month"?`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`:String(d.getFullYear());
    (groups[key]??=[]).push(o);
  });
  const revenue=mine.reduce((a,o)=>a+Number(o.total||0),0),units=mine.reduce((a,o)=>a+o.items.reduce((x,i)=>x+(Number(i.qty)||0),0),0);
  const cash=mine.filter(o=>o.payment==="Efectivo").reduce((a,o)=>a+Number(o.total||0),0);
  const transfer=mine.filter(o=>o.payment==="Transferencia").reduce((a,o)=>a+Number(o.total||0),0);
  $("sales-kpis").innerHTML=`<div class="kpi"><span>Pedidos</span><strong>${mine.length}</strong></div><div class="kpi"><span>Unidades</span><strong>${units}</strong></div><div class="kpi"><span>Facturación total</span><strong>${money(revenue)}</strong></div><div class="kpi"><span>Período</span><strong>${salesPeriod==="day"?"Día":salesPeriod==="month"?"Mes":"Año"}</strong></div>`;
  $("payment-breakdown").innerHTML=`<div class="payment-card"><span>💵 Efectivo</span><strong>${money(cash)}</strong></div><div class="payment-card"><span>🏦 Transferencia</span><strong>${money(transfer)}</strong></div><div class="payment-card total"><span>Total</span><strong>${money(cash+transfer)}</strong></div>`;
  $("orders-list").innerHTML=Object.keys(groups).sort().reverse().map(k=>`<div><h3>${escapeHtml(k)}</h3>${groups[k].sort((a,b)=>b.date.localeCompare(a.date)).map(o=>`
    <article class="order-card"><div class="order-head"><div><strong>${escapeHtml(String(o.orderNumber||o.id).startsWith("CUB-")?(o.orderNumber||o.id):`#${String(o.id).slice(-8).toUpperCase()}`)}</strong><div class="muted">${formatDate(o.date)}</div></div><strong>${money(o.total)}</strong></div>
    <div class="order-body"><div class="order-items">${o.items.map(i=>`${escapeHtml(i.name)}${i.color?` · ${escapeHtml(i.color)}`:''} × ${i.qty} — ${money(i.price*i.qty)}`).join("<br>")} </div>
    <p class="muted">Cliente: ${escapeHtml(o.customerName)} · Pago: ${escapeHtml(o.payment)} · Estado: ${escapeHtml(o.status)}</p>
    ${session.role==="admin"?`<button class="btn ghost" onclick="markOrder('${o.id}')">Marcar preparado</button>`:""}</div></article>`).join("")}</div>`).join("") || '<div class="card" style="padding:20px">Todavía no hay pedidos.</div>';
}
function markOrder(id){const o=orders.find(x=>x.id===id);o.status=o.status==="Preparado"?"Pendiente":"Preparado";write(STORAGE.orders,orders);renderOrders()}

function svgEscape(s){return escapeHtml(String(s));}
function renderLineChart(svgId, points, xLabels, caption){
  const svg=$(svgId); if(!svg)return;
  const W=900,H=360, pad={l:60,r:25,t:25,b:55}, iw=W-pad.l-pad.r, ih=H-pad.t-pad.b;
  const max=Math.max(1,...points.map(p=>p.y));
  const x=i=>pad.l+(points.length===1?iw/2:(i/(points.length-1))*iw);
  const y=v=>pad.t+ih-(v/max)*ih;
  let out=`<rect x="0" y="0" width="${W}" height="${H}" fill="transparent"/>`;
  for(let g=0;g<=4;g++){const val=Math.round(max*g/4), yy=y(val);out+=`<line x1="${pad.l}" y1="${yy}" x2="${W-pad.r}" y2="${yy}" class="chart-gridline"/><text x="${pad.l-10}" y="${yy+4}" text-anchor="end" class="chart-axis-text">${val}</text>`;}
  // Dibujamos los ejes antes de los puntos para que los puntos con 0 ventas no queden tapados por el eje X.
  out+=`<line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${H-pad.b}" class="chart-axis"/><line x1="${pad.l}" y1="${H-pad.b}" x2="${W-pad.r}" y2="${H-pad.b}" class="chart-axis"/>`;
  if(points.length){let d=points.map((p,i)=>`${i?'L':'M'} ${x(i).toFixed(1)} ${y(p.y).toFixed(1)}`).join(' ');out+=`<path d="${d}" class="chart-line"/>`;points.forEach((p,i)=>{out+=`<circle cx="${x(i)}" cy="${y(p.y)}" r="7" class="chart-point" data-tooltip="${svgEscape(p.label)} · ${p.y} venta${p.y===1?"":"s"}" tabindex="0"><title>${svgEscape(p.label)} · ${p.y} venta${p.y===1?"":"s"}</title></circle>`;});}
  const skip=Math.max(1,Math.ceil(points.length/10)); points.forEach((p,i)=>{if(i%skip===0||i===points.length-1){out+=`<text x="${x(i)}" y="${H-20}" text-anchor="middle" class="chart-axis-text">${svgEscape(xLabels[i])}</text>`;}});
  svg.innerHTML=out; if($(caption))$(caption).textContent=caption; attachChartTooltips(svg);
}
function renderWeeklyTimeChart(){
  const svg=$("weekly-time-chart");if(!svg)return;const W=900,H=360,pad={l:60,r:25,t:25,b:55},iw=W-pad.l-pad.r,ih=H-pad.t-pad.b;
  const days=["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];let out='';
  for(let h=0;h<=24;h+=4){const yy=pad.t+ih-(h/24)*ih;out+=`<line x1="${pad.l}" y1="${yy}" x2="${W-pad.r}" y2="${yy}" class="chart-gridline"/><text x="${pad.l-10}" y="${yy+4}" text-anchor="end" class="chart-axis-text">${String(h).padStart(2,'0')}:00</text>`;}
  days.forEach((d,i)=>{const xx=pad.l+(i/6)*iw;out+=`<line x1="${xx}" y1="${pad.t}" x2="${xx}" y2="${H-pad.b}" class="chart-gridline"/><text x="${xx}" y="${H-20}" text-anchor="middle" class="chart-axis-text">${d}</text>`;});
  const mine=session.role==="admin"?orders:orders.filter(o=>o.customerEmail===session.email||o.username===session.username);
  mine.forEach(o=>{const d=new Date(o.date),day=d.getDay(),hour=d.getHours()+d.getMinutes()/60;const xx=pad.l+(day/6)*iw,yy=pad.t+ih-(hour/24)*ih;out+=`<circle cx="${xx}" cy="${yy}" r="6" class="chart-point" data-tooltip="${svgEscape(formatDate(o.date))} · ${svgEscape(o.customerName||"Cliente")}" tabindex="0"></circle>`;});
  out+=`<line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${H-pad.b}" class="chart-axis"/><line x1="${pad.l}" y1="${H-pad.b}" x2="${W-pad.r}" y2="${H-pad.b}" class="chart-axis"/>`;svg.innerHTML=out;attachChartTooltips(svg);
}
function attachChartTooltips(svg){
  if(!svg)return;
  const old=document.getElementById("chart-tooltip"); if(old)old.remove();
  const tip=document.createElement("div");tip.id="chart-tooltip";tip.className="chart-tooltip hidden";document.body.appendChild(tip);
  const hide=()=>tip.classList.add("hidden");
  svg.querySelectorAll(".chart-point[data-tooltip]").forEach(point=>{
    const show=()=>{tip.textContent=point.dataset.tooltip||"";tip.classList.remove("hidden");const r=point.getBoundingClientRect();let left=r.left+r.width/2,top=r.top-10;tip.style.left=`${Math.min(window.innerWidth-12,Math.max(12,left))}px`;tip.style.top=`${Math.max(12,top)}px`;tip.style.transform="translate(-50%,-100%)";};
    point.addEventListener("mouseenter",show);point.addEventListener("mouseleave",hide);point.addEventListener("focus",show);point.addEventListener("blur",hide);
  });
}
function renderAnalytics(){
  const mine=session?.role==="admin"?orders:[]; const now=new Date(); let points=[],labels=[],caption='';
  if(salesPeriod==='day'){
    const n=30;for(let i=n-1;i>=0;i--){const d=new Date(now);d.setHours(0,0,0,0);d.setDate(d.getDate()-i);const key=todayKey(d.toISOString());const y=mine.filter(o=>todayKey(o.date)===key).length;points.push({y,label:d.toLocaleDateString('es-AR')});labels.push(`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`);}caption='Cantidad de pedidos por día · últimos 30 días';
  } else if(salesPeriod==='month'){
    for(let i=11;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;const y=mine.filter(o=>{const od=new Date(o.date);return `${od.getFullYear()}-${String(od.getMonth()+1).padStart(2,'0')}`===key}).length;points.push({y,label:d.toLocaleDateString('es-AR',{month:'long',year:'numeric'})});labels.push(d.toLocaleDateString('es-AR',{month:'short'}));}caption='Cantidad de pedidos por mes · últimos 12 meses';
  } else {
    const years=[...new Set(mine.map(o=>new Date(o.date).getFullYear()))].sort((a,b)=>a-b);const ys=years.length?years:[now.getFullYear()];ys.forEach(y=>{points.push({y:mine.filter(o=>new Date(o.date).getFullYear()===y).length,label:String(y)});labels.push(String(y));});caption='Cantidad de pedidos por año';
  }
  renderLineChart('sales-chart',points,labels);$('sales-chart-caption').textContent=caption;renderWeeklyTimeChart();
}

function calculateOrderSupplyPlan(items){
  const byProduct={};
  for(const item of items){
    const p=products.find(x=>x.id===item.productId);
    if(!p) continue;
    const key=p.id;
    if(!byProduct[key]) byProduct[key]={productId:p.id,name:p.name,ordered:0,availableFinished:Number(p.stock)||0,recipe:Array.isArray(p.recipe)?p.recipe:[]};
    byProduct[key].ordered+=Number(item.qty)||0;
  }
  const aggregate={};
  Object.values(byProduct).forEach(p=>{
    const toMake=Math.max(0,p.ordered-p.availableFinished);
    p.toMake=toMake;
    if(!toMake)return;
    p.recipe.forEach(r=>{
      const qtyPer=Number(r.qty)||0;
      if(!r.supplyId||qtyPer<=0)return;
      const supply=supplies.find(s=>s.id===r.supplyId);
      if(!supply)return;
      if(!aggregate[r.supplyId]) aggregate[r.supplyId]={supplyId:r.supplyId,name:supply.name,stock:Number(supply.qty)||0,required:0,unitQty:0,products:[]};
      aggregate[r.supplyId].required += qtyPer*toMake;
      aggregate[r.supplyId].unitQty = qtyPer;
      aggregate[r.supplyId].products.push({name:p.name,qty:toMake});
    });
  });
  const suppliesPlan=Object.values(aggregate).map(x=>({...x,missing:Math.max(0,x.required-x.stock),enough:x.stock>=x.required}));
  return {products:Object.values(byProduct),supplies:suppliesPlan};
}
async function submitOrder(e){
  e.preventDefault();
  if(!cart.length)return toast("El carrito está vacío.");

  const submitBtn=e.submitter || e.target.querySelector('button[type="submit"]');
  const originalText=submitBtn?.textContent || "Confirmar pedido";
  if(submitBtn){submitBtn.disabled=true;submitBtn.textContent="Enviando pedido…";}

  try{
    const name=$("customer-name").value.trim(),email=$("customer-email").value.trim(),phone=$("customer-phone").value.trim();
    let total=0;const items=[];
    for(const c of cart){
      const p=products.find(x=>x.id===c.productId);
      if(!p)throw new Error("Uno de los productos ya no está disponible.");
      const qty=Number(c.qty)||1;
      items.push({productId:p.id,name:p.name,qty,price:p.price,color:c.color||""});
      total+=p.price*qty;
    }

    const supplyPlan=calculateOrderSupplyPlan(items);
    const draftOrder={
      id:uid("ord"),date:new Date().toISOString(),customerName:name,customerEmail:email,phone,
      payment:$("payment-method").value,notes:$("customer-notes").value,items,total,
      status:"Pendiente",username:session?.username||"guest",supplyPlan
    };

    if(!HAS_BACKEND){
      const order={...draftOrder,id:uid("ord"),orderNumber:"LOCAL-"+Date.now(),serverSaved:false};
      items.forEach(i=>{const p=products.find(x=>x.id===i.productId);if(p)p.stock=Math.max(0,(Number(p.stock)||0)-i.qty)});
      orders.push(order);
      writeLocal(STORAGE.orders,orders); writeLocal(STORAGE.products,products);
      cart=[]; writeLocal(STORAGE.cart,cart);
      closeModal("checkout-modal"); renderProducts(); renderCart(); if(session)renderOrders();
      toast("Modo GitHub Pages: pedido guardado solo en este navegador. No se envió email.");
      e.target.reset();
      return;
    }

    const response=await fetch(apiUrl("/api/orders"),{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({order:draftOrder})
    });
    let out={};
    try{out=await response.json();}catch{}
    if(!response.ok||!out.ok)throw new Error(out.error||"No se pudo registrar el pedido en Cúbica.");

    const order={...draftOrder,id:out.order_number||draftOrder.id,orderNumber:out.order_number||"",serverSaved:true,
      internalEmailSent:!!out.internal_email_sent,customerEmailSent:!!out.customer_email_sent,emailErrors:out.email_errors||[]};

    // El servidor ya guardó el pedido y actualizó el stock central antes de responder.
    if(serverStateInitialized){
      await refreshServerState();
    }else{
      items.forEach(i=>{const p=products.find(x=>x.id===i.productId);if(p)p.stock=Math.max(0,(Number(p.stock)||0)-i.qty)});
      orders.push(order);
      writeLocal(STORAGE.orders,orders);writeLocal(STORAGE.products,products);
    }
    cart=[];writeLocal(STORAGE.cart,cart);
    closeModal("checkout-modal");renderProducts();renderCart();if(session)renderOrders();

    const n=out.order_number||"Pedido registrado";
    if(out.internal_email_sent && out.customer_email_sent){
      toast(`${n}: enviado a Cúbica y confirmación enviada al cliente.`);
    }else if(out.internal_email_sent && out.customer_confirmation_enabled===false){
      toast(`${n}: enviado a Cúbica.`);
    }else if(out.internal_email_sent){
      toast(`${n}: enviado a Cúbica. La confirmación al cliente quedó pendiente.`);
    }else{
      toast(`${n}: guardado correctamente. El correo quedó pendiente de configuración o reintento.`);
      if(out.email_errors?.length)console.warn("Correo del pedido:",out.email_errors);
    }
    e.target.reset();
  }catch(err){
    console.error(err);
    toast(err.message||"No se pudo finalizar el pedido.");
  }finally{
    if(submitBtn){submitBtn.disabled=false;submitBtn.textContent=originalText;}
  }
}

document.addEventListener("DOMContentLoaded",async()=>{
  await initServerState();
  initData();
  // Persist normalized products/supplies after a successful migration/load.
  if(serverStateReady){
    queueServerWrite(STORAGE.products,products);
    queueServerWrite(STORAGE.supplies,supplies);
    queueServerWrite(STORAGE.supplyCategories,supplyCategories);
  }
  renderWelcome();
  renderApp();
  showSection("store");
  $("enter-store-btn").onclick=()=>{
    $("welcome-view").classList.add("hidden");
    showSection("store");
    window.scrollTo({top:0,behavior:"smooth"});
  };
  $("login-form").addEventListener("submit",e=>{e.preventDefault();const u=$("login-user").value.trim(),p=$("login-password").value;
    const accounts={admin:{password:"cubica123",role:"admin",username:"admin"},cliente:{password:"cliente123",role:"customer",username:"cliente",email:"cliente@ejemplo.com"}};
    const a=accounts[u];if(!a||a.password!==p)return toast("Usuario o contraseña incorrectos.");session={username:a.username,role:a.role,email:a.email||""};write(STORAGE.session,session);renderApp();showSection("store");toast("Sesión iniciada");
  });
  $("logout-btn").onclick=()=>{localStorage.removeItem(STORAGE.session);session=null;renderApp();showSection("store");toast("Sesión cerrada")};
  $("cart-icon-btn").onclick=()=>showSection("cart");
  $("product-search").oninput=renderProducts;$("product-category").onchange=renderProducts;
  $("finished-search").oninput=renderFinishedStock;$("finished-category-filter").onchange=renderFinishedStock;
  $("finished-images").addEventListener("change",e=>handleFinishedMediaInput(e.target,"image"));
  $("finished-videos").addEventListener("change",e=>handleFinishedMediaInput(e.target,"video"));
  $("supply-search").oninput=renderSupplies;$("supply-category-filter").onchange=renderSupplies;
  $("add-supply-category").onclick=()=>openModal("supply-category-modal");
  $("checkout-btn").onclick=()=>cart.length?openModal("checkout-modal"):toast("El carrito está vacío.");
  $("checkout-form").onsubmit=submitOrder;
  document.querySelectorAll("[data-close-modal]").forEach(b=>b.onclick=()=>closeModal(b.dataset.closeModal));
  document.querySelectorAll("[data-open-modal]").forEach(b=>b.onclick=()=>{
    try {
      if(b.dataset.openModal==="finished-modal") resetFinishedProductForm();
      openModal(b.dataset.openModal);
    } catch(err) {
      console.error("No se pudo abrir el modal", err);
      toast("No se pudo abrir el formulario. Recargá la página e intentá nuevamente.");
    }
  });
  $("finished-form").onsubmit=saveFinishedProduct;
  $("add-finished-color").onclick=addFinishedColor;
  $("add-finished-supply").onclick=addFinishedRecipeRow;
  $("supply-form").onsubmit=e=>{e.preventDefault();supplies.push({id:uid("s"),name:$("supply-name").value,category:$("supply-category").value,cost:Number($("supply-cost").value),qty:Number($("supply-qty").value)});write(STORAGE.supplies,supplies);e.target.reset();closeModal("supply-modal");renderSupplies();renderBudget();toast("Insumo agregado")};
  $("supply-category-form").onsubmit=e=>{e.preventDefault();addSupplyCategory($("new-supply-category").value);e.target.reset();closeModal("supply-category-modal");};
  $("budget-form").addEventListener("input",calculateBudget);$("budget-form").addEventListener("change",calculateBudget);
  $("budget-form").onsubmit=e=>{e.preventDefault();calculateBudget();toast("Presupuesto calculado")};
  $("add-budget-supply").onclick=()=>{budgetRows.push({id:"",qty:1});renderBudgetSupplyRows();calculateBudget()};
  $("save-budget").onclick=saveBudget;$("copy-budget").onclick=copyBudget;
  document.querySelectorAll(".period-tabs .tab[data-period]").forEach(t=>t.onclick=()=>{salesPeriod=t.dataset.period;document.querySelectorAll(".period-tabs .tab[data-period]").forEach(x=>x.classList.toggle("active",x===t));renderOrders();});
  document.querySelectorAll(".analytics-tabs .tab").forEach(t=>t.onclick=()=>{salesPeriod=t.dataset.analysisPeriod;document.querySelectorAll(".analytics-tabs .tab").forEach(x=>x.classList.toggle("active",x===t));renderAnalytics();});
  initBudgetDefaults();
  if(window.__cubicaMigratedFromBrowser)toast("Datos del navegador migrados a la Raspberry Pi.");
  const syncBadge=$("server-sync-badge");
  if(syncBadge)syncBadge.onclick=async()=>{
    if(serverStateInitialized)return toast("Productos, insumos, ventas y presupuestos se guardan en la Raspberry.");
    if(!confirm("¿Migrar los datos actuales de este navegador a la Raspberry Pi?"))return;
    try{await migrateCurrentBrowserToServer(false);toast("Datos migrados correctamente a la Raspberry.");}
    catch(err){toast(err.message||"No se pudo migrar.");}
  };
});
function initBudgetDefaults(){ if(!window.budgetRows.length)window.budgetRows=[{id:"",qty:1}];}
window.addToCart=addToCart;window.changeCart=changeCart;window.removeCart=removeCart;window.updateProduct=updateProduct;window.deleteProduct=deleteProduct;window.editProduct=editProduct;window.removeFinishedColor=removeFinishedColor;window.updateFinishedRecipe=updateFinishedRecipe;window.removeFinishedRecipe=removeFinishedRecipe;
window.updateSupply=updateSupply;window.deleteSupply=deleteSupply;window.openProductDetail=openProductDetail;window.setProductMedia=setProductMedia;window.changeProductMedia=changeProductMedia;window.selectProductColor=selectProductColor;window.toggleProductColor=toggleProductColor;window.deleteSupplyCategory=deleteSupplyCategory;window.removeBudgetRow=removeBudgetRow;window.updateBudgetRow=updateBudgetRow;window.markOrder=markOrder;
