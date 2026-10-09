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
].map((s,i)=>({
  id:"s"+i,
  name:s[0],
  category:s[1]==="Filamento"?"Filamentos":s[1],
  cost:s[2],
  qty:0,
  unit:s[1]==="Filamento"?"gramos":"unidades",
  materialType:s[1]==="Filamento"?(s[0].toUpperCase().includes("ASA")?"ASA":"PLA"):"",
  colorName:"",
  colorHex:"#ffffff"
}));

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
  if(typeof window.cubicaOnLocalWrite==="function"){
    try{ window.cubicaOnLocalWrite(key,value); }catch(err){ console.error("Hook de persistencia Cúbica",err); }
  }
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
let analyticsRange = "30d";
let analyticsView = "summary";
let supplySortMode = localStorage.getItem("cubica_supply_sort") || "manual";
const PRODUCT_PAGE_SIZE = 12;
const SUPPLY_PAGE_SIZE = 12;
const FINISHED_PAGE_SIZE = 12;
let productPage = 1;
let supplyPage = 1;
let finishedPage = 1;
let finishedSortMode = localStorage.getItem("cubica_finished_sort") || "manual";

function toast(msg){const el=document.createElement("div");el.className="toast";el.textContent=msg;$("toast-container").appendChild(el);setTimeout(()=>el.remove(),3000)}
function normalizeSupply(s){
  const category=s?.category==="Filamento"?"Filamentos":(s?.category||"Otros");
  let unit=String(s?.unit||"").toLowerCase();
  if(["u","unidad","unit","units",""].includes(unit))unit="unidades";
  if(["g","gr","gramo","gramos"].includes(unit))unit="gramos";
  if(["centimetros","centímetros","cms"].includes(unit))unit="cm";
  if(["metro","metros","mts"].includes(unit))unit="m";
  if(!["unidades","gramos","cm","m"].includes(unit))unit=category==="Filamentos"?"gramos":"unidades";
  return {
    ...s,
    category,
    cost:Number(s?.cost)||0,
    qty:Number(s?.qty)||0,
    unit,
    materialType:String(s?.materialType??s?.material_type??""),
    brand:String(s?.brand??""),
    colorName:String(s?.colorName??s?.color_name??""),
    colorHex:/^#[0-9a-f]{6}$/i.test(String(s?.colorHex??s?.color_hex??""))?String(s?.colorHex??s?.color_hex):"#ffffff",
    sortOrder:Number(s?.sortOrder??s?.sort_order)||0
  };
}
function supplyUnitLabel(unit,qty=null){
  const labels={unidades:"unidades",gramos:"g",cm:"cm",m:"m"};
  const label=labels[unit]||"unidades";
  if(unit==="unidades" && Number(qty)===1)return "unidad";
  return label;
}
function supplyCostForQty(s,qty){
  const amount=Number(qty)||0,cost=Number(s?.cost)||0;
  // En filamentos medidos en gramos, el costo histórico de Cúbica está cargado por kg.
  if(String(s?.category||"").toLowerCase().startsWith("filament") && s?.unit==="gramos")return cost*(amount/1000);
  return cost*amount;
}
function supplyCostLabel(s){
  if(String(s?.category||"").toLowerCase().startsWith("filament") && s?.unit==="gramos")return "por kg";
  const unit=supplyUnitLabel(s?.unit,1);
  return "por "+unit;
}
function initData(){
  products = products.map(p=>normalizeProduct(p));
  products = products.map((p,i)=>{
    const item=normalizeProduct(p);
    if(!(item.sortOrder>0)) item.sortOrder=(i+1)*10;
    return item;
  });
  supplies = supplies.map((raw,i)=>{
    const item=normalizeSupply(raw);
    if(!(item.sortOrder>0)) item.sortOrder=(i+1)*10;
    return item;
  });
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
  // La barra superior queda deliberadamente limpia. La gestión vive en el panel lateral.
  return [["store","Tienda"]];
}
function setupNav(){
  const nav=$("main-nav"); if(!nav)return;
  nav.innerHTML="";
  navItems().forEach(([id,label])=>{
    const b=document.createElement("button");
    b.textContent=label;b.dataset.section=id;b.onclick=()=>showSection(id);nav.appendChild(b);
  });
  updateCartBadge();
}
function openAccountSidebar(){
  if(!session){showSection("login");return;}
  const sidebar=$("account-sidebar"), overlay=$("account-sidebar-overlay");
  if(!sidebar||!overlay)return;
  renderAccountSidebar();
  sidebar.classList.add("open");
  sidebar.setAttribute("aria-hidden","false");
  overlay.classList.remove("hidden");
  requestAnimationFrame(()=>overlay.classList.add("visible"));
  document.body.classList.add("sidebar-open");
}
function closeAccountSidebar(){
  const sidebar=$("account-sidebar"), overlay=$("account-sidebar-overlay");
  if(!sidebar||!overlay)return;
  sidebar.classList.remove("open");
  sidebar.setAttribute("aria-hidden","true");
  overlay.classList.remove("visible");
  setTimeout(()=>{if(!sidebar.classList.contains("open"))overlay.classList.add("hidden");},180);
  document.body.classList.remove("sidebar-open");
}
function renderAccountSidebar(){
  const name=$("sidebar-user-name"), role=$("sidebar-user-role"), email=$("sidebar-user-email");
  if(name)name.textContent=session?.username||"Visitante";
  if(role)role.textContent=session?(session.role==="admin"?"Administrador":"Cliente"):"Sin sesión iniciada";
  if(email)email.textContent=session?.email||"";
  const img=$("sidebar-avatar-img"), fallback=$("sidebar-avatar-fallback");
  if(img&&fallback){
    if(session?.avatarUrl){img.src=session.avatarUrl;img.classList.remove("hidden");fallback.classList.add("hidden");}
    else{img.removeAttribute("src");img.classList.add("hidden");fallback.classList.remove("hidden");}
  }
  document.querySelectorAll(".account-sidebar .admin-only").forEach(el=>el.classList.toggle("hidden",session?.role!=="admin"));
  document.querySelectorAll(".account-sidebar .customer-only").forEach(el=>el.classList.toggle("hidden",session?.role!=="customer"));
  document.querySelectorAll(".account-sidebar .session-only").forEach(el=>el.classList.toggle("hidden",!session));
  const ordersLabel=$("sidebar-orders-label");
  if(ordersLabel)ordersLabel.textContent=session?.role==="admin"?"Ventas / Pedidos":"Mis pedidos";
  const editBadge=$("avatar-edit-badge");
  if(editBadge)editBadge.classList.toggle("hidden",session?.role!=="admin");
}
function showSection(id){
  const requested=id;
  const section=$("section-"+id);
  if(!section)return;
  if(id==="orders" && !session){
    toast("Iniciá sesión para consultar tus pedidos.");
    id="login";
  }
  if(["stock-finished","stock-supplies","budget","analytics"].includes(id) && session?.role!=="admin"){
    toast("Esta sección es exclusiva del administrador.");
    id="login";
  }
  if(id==="profile" && session?.role!=="customer"){
    id=session?"store":"login";
  }
  document.querySelectorAll(".page-section").forEach(sec=>sec.classList.add("hidden"));
  $("section-"+id).classList.remove("hidden");
  document.querySelectorAll(".nav button").forEach(b=>b.classList.toggle("active",b.dataset.section===id));
  document.querySelectorAll("[data-sidebar-section]").forEach(b=>b.classList.toggle("active",b.dataset.sidebarSection===id));
  closeAccountSidebar();
  if(id==="store") renderProducts(); if(id==="cart") renderCart(); if(id==="orders") renderOrders();
  if(id==="profile") renderCustomerProfile();
  if(id==="stock-finished") renderFinishedStock(); if(id==="stock-supplies") renderSupplies();
  if(id==="budget") renderBudget(); if(id==="analytics") renderAnalytics();
  if(requested==="store" && typeof window.cubicaTrackEvent==="function") window.cubicaTrackEvent("page_view",null,{section:"store"});
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
function renderCustomerProfile(){
  if(session?.role!=="customer")return;
  const name=$("profile-page-name"),email=$("profile-page-email"),provider=$("profile-page-provider");
  if(name)name.textContent=session.username||"Cliente";
  if(email)email.textContent=session.email||"";
  if(provider)provider.textContent=session.authProvider==="google"?"Google":"Cuenta Cúbica";
  const img=$("profile-page-avatar"),fallback=$("profile-page-avatar-fallback");
  if(img&&fallback){
    if(session.avatarUrl){
      img.src=session.avatarUrl;
      img.classList.remove("hidden");
      fallback.classList.add("hidden");
    }else{
      img.removeAttribute("src");
      img.classList.add("hidden");
      fallback.classList.remove("hidden");
    }
  }
}
function renderApp(){
  $("app").classList.remove("hidden");
  const logout=$("logout-btn"); if(logout)logout.classList.toggle("hidden",!session);

  const topImg=$("profile-avatar-top"), topFallback=$("profile-icon-fallback"), profileBtn=$("profile-btn");
  if(profileBtn)profileBtn.title=session?(session.role==="admin"?"Administrador":"Mi cuenta"):"Ingresar";
  if(topImg&&topFallback){
    if(session?.avatarUrl){topImg.src=session.avatarUrl;topImg.classList.remove("hidden");topFallback.classList.add("hidden");}
    else{topImg.removeAttribute("src");topImg.classList.add("hidden");topFallback.classList.remove("hidden");}
  }

  // No quitar .hidden de las secciones de página al refrescar la sesión.
  document.querySelectorAll(".admin-only").forEach(el=>{
    if(el.closest?.("#account-sidebar")) return;
    if(el.classList.contains("page-section")){
      if(session?.role!=="admin") el.classList.add("hidden");
    }else{
      el.classList.toggle("hidden",session?.role!=="admin");
    }
  });
  document.querySelectorAll(".customer-only").forEach(el=>{
    if(el.closest?.("#account-sidebar")) return;
    if(el.classList.contains("page-section")){
      if(session?.role!=="customer") el.classList.add("hidden");
    }else{
      el.classList.toggle("hidden",session?.role!=="customer");
    }
  });

  renderAccountSidebar();
  renderCustomerProfile();
  setupNav();
  renderProducts();
  renderCart();
}
function paginationNumbers(totalPages,currentPage){
  if(totalPages<=7)return Array.from({length:totalPages},(_,i)=>i+1);
  const pages=[1];
  const start=Math.max(2,currentPage-1);
  const end=Math.min(totalPages-1,currentPage+1);
  if(start>2)pages.push("…");
  for(let p=start;p<=end;p++)pages.push(p);
  if(end<totalPages-1)pages.push("…");
  pages.push(totalPages);
  return pages;
}
function renderPagination(id,{page,totalPages,totalItems,pageSize,setter}){
  const box=$(id);if(!box)return;
  if(totalItems<=pageSize || totalItems===0){
    box.classList.add("hidden");
    box.innerHTML="";
    return;
  }
  const start=(page-1)*pageSize+1;
  const end=Math.min(totalItems,page*pageSize);
  const pages=paginationNumbers(totalPages,page);
  box.classList.remove("hidden");
  box.innerHTML=`
    <div class="pagination-summary">Mostrando <strong>${start}–${end}</strong> de <strong>${totalItems}</strong></div>
    <div class="pagination-controls">
      <button class="pagination-btn pagination-arrow" type="button" onclick="${setter}(${page-1})" ${page<=1?"disabled":""} aria-label="Página anterior">‹</button>
      ${pages.map(p=>p==="…"
        ? '<span class="pagination-ellipsis">…</span>'
        : `<button class="pagination-btn ${p===page?"active":""}" type="button" onclick="${setter}(${p})" ${p===page?'aria-current="page"':""}>${p}</button>`
      ).join("")}
      <button class="pagination-btn pagination-arrow" type="button" onclick="${setter}(${page+1})" ${page>=totalPages?"disabled":""} aria-label="Página siguiente">›</button>
    </div>`;
}
function setProductPage(page){
  productPage=Math.max(1,Math.trunc(Number(page)||1));
  renderProducts();
  const head=$("section-store")?.querySelector(".section-head");
  head?.scrollIntoView({behavior:"smooth",block:"start"});
}
function renderProducts(){
  const search=($("product-search").value||"").trim().toLowerCase();
  const cats=[...new Set(products.map(p=>p.category).filter(Boolean))];
  const select=$("product-category");const current=select.value;
  select.innerHTML='<option value="all">Todas las categorías</option>'+cats.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  select.value=cats.includes(current)?current:"all";
  const cat=select.value;
  const list=products.filter(p=>{
    normalizeProduct(p);
    const hay=[p.name,p.category,p.description].join(" ").toLowerCase();
    return (cat==="all"||p.category===cat)&&(!search||hay.includes(search));
  });

  const totalPages=Math.max(1,Math.ceil(list.length/PRODUCT_PAGE_SIZE));
  productPage=Math.min(Math.max(1,productPage),totalPages);
  const start=(productPage-1)*PRODUCT_PAGE_SIZE;
  const pageItems=list.slice(start,start+PRODUCT_PAGE_SIZE);

  $("product-grid").innerHTML=pageItems.map(p=>{
    const firstImage=p.media.find(m=>m.type==="image");
    const cover=firstImage?`<img class="product-cover" src="${firstImage.src}" alt="${escapeHtml(p.name)}" loading="lazy" decoding="async">`:`<div class="product-icon">${iconFor(p.category)}</div>`;
    return `<article class="product-card product-card-clickable" onclick="openProductDetail('${p.id}')">
      <div class="product-cover-wrap">${cover}${p.media.some(m=>m.type==="video"||m.type==="social")?'<span class="media-badge">▶ Video</span>':''}</div>
      <div class="product-meta">${escapeHtml(p.category)} · ${p.stock>0?`${p.stock} disponibles`:"Se fabrica a pedido"}</div>
      <h3>${escapeHtml(p.name)}</h3>
      <div class="price">${money(p.price)}</div>
      <div class="product-card-hint">Ver producto · fotos · colores · cantidad →</div>
    </article>`;
  }).join("") || '<div class="card" style="padding:25px">No hay productos que coincidan.</div>';

  renderPagination("product-pagination",{
    page:productPage,
    totalPages,
    totalItems:list.length,
    pageSize:PRODUCT_PAGE_SIZE,
    setter:"setProductPage"
  });
}
function iconFor(cat){return cat==="Veladores"?"◉":cat==="Figuras"?"♟":cat==="Decoración"?"◇":"▣"}
function addToCart(id, qtyOverride=null, colorOverride=null){
  const p=products.find(x=>x.id===id); if(!p)return;
  const input=$("qty-"+id); const q=Math.max(1,Number(qtyOverride ?? input?.value)||1);
  const color=colorOverride ?? (p.colors?.[0]?.name||"");
  const existing=cart.find(x=>x.productId===id && (x.color||"")===color); const next=(existing?.qty||0)+q;
  if(existing)existing.qty=next;else cart.push({productId:id,qty:q,color});
  write(STORAGE.cart,cart);
  if(typeof window.cubicaTrackEvent==="function")window.cubicaTrackEvent("add_to_cart",id,{qty:q,color,price:Number(p.price)||0});
  toast("Producto agregado al carrito");renderCart();updateCartBadge();
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
  p.sortOrder=Number(p.sortOrder??p.sort_order)||0;
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
function sortedFinishedForView(list,mode=finishedSortMode){
  const copy=[...(list||[])];
  const byText=(a,b)=>String(a||"").localeCompare(String(b||""),"es",{sensitivity:"base"});
  if(mode==="category")return copy.sort((a,b)=>byText(a.category,b.category)||byText(a.name,b.name));
  if(mode==="name")return copy.sort((a,b)=>byText(a.name,b.name));
  if(mode==="stock-desc")return copy.sort((a,b)=>(Number(b.stock)||0)-(Number(a.stock)||0)||byText(a.name,b.name));
  if(mode==="stock-asc")return copy.sort((a,b)=>(Number(a.stock)||0)-(Number(b.stock)||0)||byText(a.name,b.name));
  if(mode==="price-desc")return copy.sort((a,b)=>(Number(b.price)||0)-(Number(a.price)||0)||byText(a.name,b.name));
  if(mode==="price-asc")return copy.sort((a,b)=>(Number(a.price)||0)-(Number(b.price)||0)||byText(a.name,b.name));
  return copy.sort((a,b)=>(Number(a.sortOrder)||0)-(Number(b.sortOrder)||0)||byText(a.name,b.name));
}
function moveFinishedProduct(id,direction){
  if(finishedSortMode!=="manual")return;
  const ordered=sortedFinishedForView(products,"manual");
  const index=ordered.findIndex(x=>String(x.id)===String(id));
  const target=index+(direction<0?-1:1);
  if(index<0||target<0||target>=ordered.length)return;
  [ordered[index],ordered[target]]=[ordered[target],ordered[index]];
  ordered.forEach((item,i)=>item.sortOrder=(i+1)*10);
  write(STORAGE.products,products);
  renderFinishedStock();
}
function setFinishedPage(page){
  finishedPage=Math.max(1,Math.trunc(Number(page)||1));
  renderFinishedStock();
  const toolbar=$("section-stock-finished")?.querySelector(".inventory-toolbar");
  toolbar?.scrollIntoView({behavior:"smooth",block:"start"});
}
function renderFinishedStock(){
  products.forEach(normalizeProduct);
  const search=(($('finished-search')?.value)||'').trim().toLowerCase();

  const filter=$('finished-category-filter');
  if(filter){
    const current=filter.value;
    const cats=finishedCategories();
    filter.innerHTML='<option value="all">Todas las categorías</option>'+cats.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    filter.value=cats.includes(current)?current:'all';
  }
  const cat=filter?.value||'all';

  const sortSelect=$("finished-sort");
  if(sortSelect){
    sortSelect.value=[...sortSelect.options].some(o=>o.value===finishedSortMode)?finishedSortMode:"manual";
    finishedSortMode=sortSelect.value;
  }

  const filtered=products.filter(p=>{
    const hay=[p.name,p.category,p.description].join(' ').toLowerCase();
    return (cat==='all'||p.category===cat)&&(!search||hay.includes(search));
  });
  const ordered=sortedFinishedForView(filtered,finishedSortMode);
  const canManualReorder=finishedSortMode==="manual" && !search && cat==="all";

  const totalPages=Math.max(1,Math.ceil(ordered.length/FINISHED_PAGE_SIZE));
  finishedPage=Math.min(Math.max(1,finishedPage),totalPages);
  const pageStart=(finishedPage-1)*FINISHED_PAGE_SIZE;
  const pageItems=ordered.slice(pageStart,pageStart+FINISHED_PAGE_SIZE);

  const hint=$("finished-sort-hint");
  if(hint){
    hint.textContent=finishedSortMode==="manual"
      ? (canManualReorder?"Usá ↑ y ↓ para definir el orden personalizado. Se guarda en Supabase.":"Quitá la búsqueda y el filtro de categoría para reordenar manualmente.")
      : "Este orden es solo una vista. Elegí “Orden personalizado” para guardar tu propio orden.";
  }

  $('finished-stock-table').innerHTML=`<table><thead><tr><th class="finished-order-col">Orden</th><th>Producto</th><th>Categoría</th><th>Color(es)</th><th>Precio</th><th>Stock</th><th>Capacidad por insumos</th><th>Valor stock</th><th></th></tr></thead><tbody>
  ${pageItems.length?pageItems.map((p,rowIndex)=>{
    const globalIndex=pageStart+rowIndex;
    const cap=productCapacity(p.recipe);
    const colors=p.colors?.length?p.colors.map(c=>`<span class="mini-color" title="${escapeHtml(c.name||'Color')}" style="--mini-color:${escapeHtml(c.hex||'#fff')}"></span>`).join(''):`<span class="muted">—</span>`;
    const capacity=cap.capacity===null?`<span class="muted">Sin receta</span>`:`<span class="${cap.capacity===0?'stock-low':'stock-ok'}">${cap.capacity} u.</span><small class="capacity-note">${cap.bottlenecks.length?`Limita: ${escapeHtml(cap.bottlenecks.join(', '))}`:''}</small>`;
    const mediaCount=p.media?.length||0;
    return `<tr>
      <td class="finished-order-cell">
        ${finishedSortMode==="manual"
          ?`<div class="finished-order-buttons"><button class="btn ghost finished-move" onclick="moveFinishedProduct('${p.id}',-1)" ${!canManualReorder||globalIndex===0?"disabled":""} title="Subir producto">↑</button><button class="btn ghost finished-move" onclick="moveFinishedProduct('${p.id}',1)" ${!canManualReorder||globalIndex===ordered.length-1?"disabled":""} title="Bajar producto">↓</button></div>`
          :`<span class="muted">${globalIndex+1}</span>`}
      </td>
      <td><div class="finished-name-cell">${p.media?.find(m=>m.type==='image')?`<img src="${p.media.find(m=>m.type==='image').src}" alt="">`:''}<div><strong>${escapeHtml(p.name)}</strong><small class="capacity-note">${p.recipe?.length||0} insumo(s) · ${mediaCount} medio(s)</small></div></div></td>
      <td>${escapeHtml(p.category)}</td><td><div class="mini-colors">${colors}</div></td><td><input type="number" min="0" value="${p.price}" onchange="updateProduct('${p.id}','price',this.value)"></td>
      <td><input type="number" min="0" value="${p.stock}" onchange="updateProduct('${p.id}','stock',this.value)"></td><td>${capacity}</td><td>${money(p.price*p.stock)}</td>
      <td class="table-actions"><button class="btn ghost" onclick="editProduct('${p.id}')">Editar</button><button class="btn ghost" onclick="deleteProduct('${p.id}')">Eliminar</button></td>
    </tr>`;
  }).join(''):`<tr><td colspan="9" class="empty-table">No se encontraron productos terminados con esos filtros.</td></tr>`}</tbody></table>`;

  renderPagination("finished-pagination",{
    page:finishedPage,
    totalPages,
    totalItems:ordered.length,
    pageSize:FINISHED_PAGE_SIZE,
    setter:"setFinishedPage"
  });
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
  if(!list||!empty)return;
  list.innerHTML=finishedRecipe.map((r,i)=>{
    const supply=supplies.find(s=>s.id===r.supplyId);
    const max=supply && Number(r.qty)>0?Math.floor((Number(supply.qty)||0)/Number(r.qty)):null;
    const unit=supply?supplyUnitLabel(supply.unit,r.qty):"";
    const options=supplies.map(s=>`<option value="${s.id}" ${String(s.id)===String(r.supplyId)?"selected":""}>${escapeHtml(s.name)} · stock ${Number(s.qty)||0} ${escapeHtml(supplyUnitLabel(s.unit,s.qty))}</option>`).join("");
    return `<div class="recipe-row"><select onchange="updateFinishedRecipe(${i},'supplyId',this.value)"><option value="">Seleccionar insumo...</option>${options}</select><input type="number" min="0.0001" step="0.01" value="${r.qty}" onchange="updateFinishedRecipe(${i},'qty',this.value)" placeholder="Cantidad/u"><span class="recipe-stock">${supply?`Por producto: <strong>${Number(r.qty)||0} ${escapeHtml(unit)}</strong> · Stock: <strong>${Number(supply.qty)||0} ${escapeHtml(supplyUnitLabel(supply.unit,supply.qty))}</strong> · ${max===null?'—':`hasta ${max} u.`}`:"Sin seleccionar"}</span><button type="button" class="btn ghost" onclick="removeFinishedRecipe(${i})">×</button></div>`;
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
function socialEmbedInfo(rawUrl){
  let u;
  try{u=new URL(rawUrl);}catch{return null;}
  const host=u.hostname.toLowerCase().replace(/^www\./,"").replace(/^m\./,"");
  const path=u.pathname.replace(/\/+$/,"");

  // YouTube: watch, youtu.be, Shorts y URLs embed.
  if(host==="youtube.com" || host==="youtu.be" || host==="youtube-nocookie.com"){
    let id="";
    if(host==="youtu.be") id=path.split("/").filter(Boolean)[0]||"";
    else if(path==="/watch") id=u.searchParams.get("v")||"";
    else {
      const m=path.match(/^\/(?:shorts|embed)\/([A-Za-z0-9_-]{6,})/);
      if(m) id=m[1];
    }
    if(/^[A-Za-z0-9_-]{6,}$/.test(id)){
      return {
        provider:"youtube",
        label:"YouTube",
        id,
        embedUrl:`https://www.youtube-nocookie.com/embed/${id}?rel=0`
      };
    }
  }

  // Instagram: reels, publicaciones y videos públicos.
  if(host==="instagram.com"){
    const m=path.match(/^\/(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i);
    if(m){
      const kind=m[1].toLowerCase()==="reels"?"reel":m[1].toLowerCase();
      const code=m[2];
      return {
        provider:"instagram",
        label:"Instagram",
        id:code,
        embedUrl:`https://www.instagram.com/${kind}/${code}/embed`
      };
    }
  }

  // TikTok: URL completa /@usuario/video/ID o player/v1/ID.
  if(host==="tiktok.com"){
    let id="";
    const full=path.match(/\/video\/(\d+)/);
    const player=path.match(/^\/player\/v1\/(\d+)/);
    if(full) id=full[1];
    else if(player) id=player[1];
    if(/^\d+$/.test(id)){
      return {
        provider:"tiktok",
        label:"TikTok",
        id,
        embedUrl:`https://www.tiktok.com/player/v1/${id}?controls=1&description=1`
      };
    }
  }

  return null;
}
function socialProviderIcon(provider){
  return provider==="youtube"?"▶":provider==="instagram"?"◎":provider==="tiktok"?"♪":"▶";
}
function videoLikeCount(){
  return finishedMedia.filter(m=>m.type==="video"||m.type==="social").length;
}
function renderFinishedMedia(){
  const box=$('finished-media-preview'); if(!box)return;
  box.innerHTML=finishedMedia.length?finishedMedia.map((m,i)=>{
    const social=m.type==='social'?socialEmbedInfo(m.src):null;
    const sourceLabel=m.type==='social'?(social?.label||m.provider||'Social'):m.source==='url'?'URL externa':m.source==='storage'?'Supabase':'Local';
    let preview='';
    if(m.type==='image'){
      preview=`<img src="${m.src}" alt="" loading="lazy" decoding="async">`;
    }else if(m.type==='social'){
      preview=`<div class="social-admin-preview"><span>${socialProviderIcon(social?.provider||m.provider)}</span><strong>${escapeHtml(social?.label||m.provider||'Video social')}</strong></div>`;
    }else{
      preview=`<video src="${m.src}" muted controls preload="metadata"></video>`;
    }
    const kindLabel=m.type==='image'?'Imagen':m.type==='social'?'Social':'Video';
    return `<div class="media-admin-card">${preview}<div><span>${kindLabel} ${i+1}<small>${escapeHtml(sourceLabel)}</small></span><button type="button" class="btn ghost" onclick="removeFinishedMedia(${i})">×</button></div></div>`;
  }).join(''):'<div class="inline-empty">Todavía no agregaste imágenes ni videos.</div>';
}
async function handleFinishedMediaInput(input,type){
  const files=[...input.files]; if(!files.length)return;
  const maxCount=type==='image'?6:2;
  const existing=type==='image'?finishedMedia.filter(m=>m.type==='image').length:videoLikeCount();
  if(existing+files.length>maxCount){toast(`Podés agregar hasta ${maxCount} ${type==='image'?'imágenes':'videos en total'}.`);input.value='';return;}
  try{
    for(const file of files){
      if(window.CUBICA_CONFIG?.mode==='supabase'){
        if(typeof window.cubicaUploadProductMedia!=='function') throw new Error('La subida a Supabase Storage todavía no está disponible.');
        toast(`Subiendo ${file.name}…`);
        const media=await window.cubicaUploadProductMedia(file,type);
        finishedMedia.push(media);
      }else{
        const src=await fileToDataUrl(file);
        finishedMedia.push({id:uid('m'),type,src,name:file.name,source:'local'});
      }
    }
    renderFinishedMedia();
  }catch(err){
    console.error(err);
    toast(err.message||'No se pudo subir el archivo.');
  }
  input.value='';
}
function addFinishedMediaUrl(){
  const input=$('finished-media-url');
  const selected=$('finished-media-url-type')?.value||'image';
  const value=(input?.value||'').trim();
  if(!value)return toast('Pegá una URL.');

  let parsed;
  try{parsed=new URL(value);}catch{return toast('La URL no es válida.');}
  if(!['http:','https:'].includes(parsed.protocol))return toast('La URL debe comenzar con http:// o https://');

  if(selected==='social'){
    const info=socialEmbedInfo(value);
    if(!info){
      if(/(^|\.)vm\.tiktok\.com$/i.test(parsed.hostname)) return toast('Para TikTok usá el enlace completo que contiene /video/ y su ID.');
      return toast('No pude reconocer ese enlace. Usá YouTube, Instagram Reel/Post o TikTok con URL pública.');
    }
    if(videoLikeCount()>=2)return toast('Podés agregar hasta 2 videos en total.');
    finishedMedia.push({
      id:uid('m'),
      type:'social',
      src:value,
      name:`${info.label} · video social`,
      storagePath:`external/social/${info.provider}/${info.id}`,
      source:'social',
      provider:info.provider
    });
    input.value='';
    renderFinishedMedia();
    toast(`${info.label} agregado al producto.`);
    return;
  }

  const type=selected==='video'?'video':'image';
  const maxCount=type==='image'?6:2;
  const existing=type==='image'?finishedMedia.filter(m=>m.type==='image').length:videoLikeCount();
  if(existing>=maxCount)return toast(`Podés agregar hasta ${maxCount} ${type==='image'?'imágenes':'videos en total'}.`);

  finishedMedia.push({
    id:uid('m'),
    type,
    src:value,
    name:type==='image'?'Imagen por URL':'Video por URL',
    storagePath:`external/${uid('u')}`,
    source:'url'
  });
  input.value='';
  renderFinishedMedia();
  toast(type==='image'?'Imagen por URL agregada.':'Video por URL agregado.');
}
function removeFinishedMedia(index){finishedMedia.splice(index,1);renderFinishedMedia()}
function openProductDetail(id){
  const p=products.find(x=>x.id===id);if(!p)return;
  normalizeProduct(p);detailProductId=id;detailMediaIndex=0;detailSelectedColor=p.colors?.[0]?.name||'';detailSelectedColors=p.colors?.length?[p.colors[0].name]:[];
  renderProductDetail();openModal('product-detail-modal');
  if(typeof window.cubicaTrackEvent==="function")window.cubicaTrackEvent("product_view",id,{name:p.name,category:p.category});
}
function renderProductDetail(){
  const p=products.find(x=>x.id===detailProductId);if(!p)return;normalizeProduct(p);
  const media=p.media?.length?p.media:[{type:'placeholder'}]; if(detailMediaIndex>=media.length)detailMediaIndex=0; const m=media[detailMediaIndex];
  const social=m.type==='social'?socialEmbedInfo(m.src):null;
  const viewer=m.type==='image'
    ?`<img src="${m.src}" alt="${escapeHtml(p.name)}" decoding="async">`
    :m.type==='video'
      ?`<video src="${m.src}" controls playsinline preload="metadata"></video>`
      :m.type==='social'&&social
        ?`<iframe class="social-embed social-${social.provider}" src="${escapeHtml(social.embedUrl)}" title="${escapeHtml(social.label)} — ${escapeHtml(p.name)}" loading="lazy" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`
        :`<div class="product-detail-placeholder">${iconFor(p.category)}</div>`;
  const thumbs=media.map((x,i)=>{
    const sx=x.type==='social'?socialEmbedInfo(x.src):null;
    const content=x.type==='image'
      ?`<img src="${x.src}" alt="" loading="lazy" decoding="async">`
      :x.type==='social'
        ?`<span class="social-thumb" title="${escapeHtml(sx?.label||'Video social')}">${socialProviderIcon(sx?.provider||x.provider)}</span>`
        :`<span>▶</span>`;
    return `<button class="detail-thumb ${i===detailMediaIndex?'active':''}" onclick="setProductMedia(${i})">${content}</button>`;
  }).join('');
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
    products.push({id:uid("p"),name,category,price,stock,description,colorMode,colors:finishedColors.map(c=>({...c})),recipe,media:finishedMedia.map(m=>({...m})),sortOrder:Math.max(0,...products.map(x=>Number(x.sortOrder)||0))+10});toast("Producto agregado");
  }
  write(STORAGE.products,products);e.target.reset();closeModal("finished-modal");renderFinishedStock();renderProducts();
}
/* Inventario UI movido a js/inventory-ui.js */

function renderBudget(){
  const mat=$("budget-material");const current=mat.value;
  mat.innerHTML=supplies.filter(s=>s.category.toLowerCase().startsWith("filamento")).map(s=>`<option value="${s.cost}">${escapeHtml(s.name)}${s.materialType?` · ${escapeHtml(s.materialType)}`:""} — ${money(s.cost)}${s.unit==="gramos"?"/kg":` ${escapeHtml(supplyCostLabel(s))}`}</option>`).join("");
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
  if(!session)return;
  const isAdmin=session.role==="admin";
  const mine=isAdmin?orders:orders.filter(o=>String(o.customerEmail||"").toLowerCase()===String(session.email||"").toLowerCase()||o.userId===session.supabaseUserId);

  const eyebrow=$("orders-eyebrow"),title=$("orders-title"),subtitle=$("orders-subtitle");
  if(eyebrow)eyebrow.textContent=isAdmin?"VENTAS":"CUENTA";
  if(title)title.textContent=isAdmin?"Ventas / Pedidos":"Mis pedidos";
  if(subtitle)subtitle.textContent=isAdmin?"Historial agrupable por día, mes y año.":"Consultá tus compras realizadas con esta cuenta y su estado.";

  const groups={};
  mine.forEach(o=>{
    const d=new Date(o.date),key=salesPeriod==="day"?todayKey(o.date):salesPeriod==="month"?`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`:String(d.getFullYear());
    (groups[key]??=[]).push(o);
  });
  const revenue=mine.reduce((a,o)=>a+Number(o.total||0),0),units=mine.reduce((a,o)=>a+(o.items||[]).reduce((x,i)=>x+(Number(i.qty)||0),0),0);
  const cash=mine.filter(o=>o.payment==="Efectivo").reduce((a,o)=>a+Number(o.total||0),0);
  const transfer=mine.filter(o=>o.payment==="Transferencia").reduce((a,o)=>a+Number(o.total||0),0);

  $("sales-kpis").innerHTML=isAdmin
    ?`<div class="kpi"><span>Pedidos</span><strong>${mine.length}</strong></div><div class="kpi"><span>Unidades</span><strong>${units}</strong></div><div class="kpi"><span>Facturación total</span><strong>${money(revenue)}</strong></div><div class="kpi"><span>Período</span><strong>${salesPeriod==="day"?"Día":salesPeriod==="month"?"Mes":"Año"}</strong></div>`
    :`<div class="kpi"><span>Mis pedidos</span><strong>${mine.length}</strong></div><div class="kpi"><span>Unidades compradas</span><strong>${units}</strong></div><div class="kpi"><span>Total comprado</span><strong>${money(revenue)}</strong></div><div class="kpi"><span>Período</span><strong>${salesPeriod==="day"?"Día":salesPeriod==="month"?"Mes":"Año"}</strong></div>`;

  $("payment-breakdown").innerHTML=`<div class="payment-card"><span>💵 Efectivo</span><strong>${money(cash)}</strong></div><div class="payment-card"><span>🏦 Transferencia</span><strong>${money(transfer)}</strong></div><div class="payment-card total"><span>${isAdmin?"Total":"Compras"}</span><strong>${money(cash+transfer)}</strong></div>`;

  $("orders-list").innerHTML=Object.keys(groups).sort().reverse().map(k=>`<div><h3>${escapeHtml(k)}</h3>${groups[k].sort((a,b)=>b.date.localeCompare(a.date)).map(o=>`
    <article class="order-card"><div class="order-head"><div><strong>${escapeHtml(String(o.orderNumber||o.id).startsWith("CUB-")?(o.orderNumber||o.id):`#${String(o.id).slice(-8).toUpperCase()}`)}</strong><div class="muted">${formatDate(o.date)}</div></div><strong>${money(o.total)}</strong></div>
    <div class="order-body"><div class="order-items">${(o.items||[]).map(i=>`${escapeHtml(i.name)}${i.color?` · ${escapeHtml(i.color)}`:''} × ${i.qty} — ${money(i.price*i.qty)}`).join("<br>")} </div>
    <p class="muted">${isAdmin?`Cliente: ${escapeHtml(o.customerName)} · `:""}Pago: ${escapeHtml(o.payment)} · Estado: ${escapeHtml(o.status)}</p>
    ${isAdmin?`<button class="btn ghost" onclick="markOrder('${o.id}')">Marcar preparado</button>`:""}</div></article>`).join("")}</div>`).join("") || '<div class="card" style="padding:20px">Todavía no hay pedidos asociados a esta cuenta.</div>';
}
function markOrder(id){const o=orders.find(x=>x.id===id);o.status=o.status==="Preparado"?"Pendiente":"Preparado";write(STORAGE.orders,orders);renderOrders()}

/* Analytics UI movido a js/analytics-ui.js */

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
  // En modo Supabase, el login/logout real lo instala supabase-bridge.js.
  if(CUBICA_RUNTIME.mode!=="supabase"){
    $("login-form").addEventListener("submit",e=>{e.preventDefault();const u=$("login-user").value.trim(),p=$("login-password").value;
      const accounts={admin:{password:"cubica123",role:"admin",username:"admin"},cliente:{password:"cliente123",role:"customer",username:"cliente",email:"cliente@ejemplo.com"}};
      const a=accounts[u];if(!a||a.password!==p)return toast("Usuario o contraseña incorrectos.");session={username:a.username,role:a.role,email:a.email||""};write(STORAGE.session,session);renderApp();showSection("store");toast("Sesión iniciada");
    });
    $("logout-btn").onclick=()=>{localStorage.removeItem(STORAGE.session);session=null;renderApp();showSection("store");toast("Sesión cerrada")};
  }
  $("cart-icon-btn").onclick=()=>showSection("cart");
  const brandHome=$("brand-home");
  if(brandHome){
    const goStore=()=>{showSection("store");window.scrollTo({top:0,behavior:"smooth"});};
    brandHome.addEventListener("click",goStore);
    brandHome.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();goStore();}});
  }
  $("profile-btn")?.addEventListener("click",()=>session?openAccountSidebar():showSection("login"));
  $("account-sidebar-close")?.addEventListener("click",closeAccountSidebar);
  $("account-sidebar-overlay")?.addEventListener("click",closeAccountSidebar);
  document.querySelectorAll("[data-sidebar-section]").forEach(b=>b.addEventListener("click",()=>showSection(b.dataset.sidebarSection)));
  $("sidebar-avatar-button")?.addEventListener("click",()=>{if(session?.role==="admin")$("profile-avatar-input")?.click();});
  $("profile-avatar-input")?.addEventListener("change",async e=>{
    const file=e.target.files?.[0]; if(!file)return;
    if(typeof window.cubicaUploadProfileAvatar!=="function"){toast("La foto de perfil requiere Supabase.");e.target.value="";return;}
    try{
      toast("Subiendo foto de perfil…");
      const avatar=await window.cubicaUploadProfileAvatar(file);
      if(session){session.avatarUrl=avatar.publicUrl;session.avatarPath=avatar.path;writeLocal(STORAGE.session,session);}
      renderApp();renderAccountSidebar();toast("Foto de perfil actualizada.");
    }catch(err){console.error(err);toast(err.message||"No se pudo subir la foto de perfil.");}
    e.target.value="";
  });
  document.addEventListener("keydown",e=>{if(e.key==="Escape")closeAccountSidebar();});
  $("product-search").oninput=()=>{productPage=1;renderProducts();};
  $("product-category").onchange=()=>{productPage=1;renderProducts();};
  $("finished-search").oninput=()=>{finishedPage=1;renderFinishedStock();};
  $("finished-category-filter").onchange=()=>{finishedPage=1;renderFinishedStock();};
  $("finished-sort").value=finishedSortMode;
  $("finished-sort").onchange=e=>{finishedSortMode=e.target.value;finishedPage=1;localStorage.setItem("cubica_finished_sort",finishedSortMode);renderFinishedStock();};
  $("finished-images").addEventListener("change",e=>handleFinishedMediaInput(e.target,"image"));
  $("finished-videos").addEventListener("change",e=>handleFinishedMediaInput(e.target,"video"));
  $("add-finished-media-url")?.addEventListener("click",addFinishedMediaUrl);
  $("supply-search").oninput=()=>{supplyPage=1;renderSupplies();};
  $("supply-category-filter").onchange=()=>{supplyPage=1;renderSupplies();};
  $("supply-sort").value=supplySortMode;
  $("supply-sort").onchange=e=>{supplySortMode=e.target.value;supplyPage=1;localStorage.setItem("cubica_supply_sort",supplySortMode);renderSupplies();};
  $("add-supply-category").onclick=()=>openModal("supply-category-modal");
  $("checkout-btn").onclick=()=>{
    if(!cart.length)return toast("El carrito está vacío.");
    if(session?.role==="customer"){
      const name=$("customer-name"),email=$("customer-email");
      if(name && !name.value)name.value=session.username||"";
      if(email){
        email.value=session.email||email.value;
        email.readOnly=true;
        email.title="El pedido quedará asociado a tu cuenta de Google.";
      }
    }else{
      const email=$("customer-email");
      if(email){email.readOnly=false;email.removeAttribute("title");}
    }
    if(typeof window.cubicaTrackEvent==="function")window.cubicaTrackEvent("checkout_started",null,{items:cart.reduce((a,x)=>a+(Number(x.qty)||0),0)});
    openModal("checkout-modal");
  };
  $("checkout-form").onsubmit=submitOrder;
  document.querySelectorAll("[data-close-modal]").forEach(b=>b.onclick=()=>closeModal(b.dataset.closeModal));
  document.querySelectorAll("[data-open-modal]").forEach(b=>b.onclick=()=>{
    try {
      if(b.dataset.openModal==="finished-modal") resetFinishedProductForm();
      if(b.dataset.openModal==="supply-modal") resetSupplyForm();
      openModal(b.dataset.openModal);
    } catch(err) {
      console.error("No se pudo abrir el modal", err);
      toast("No se pudo abrir el formulario. Recargá la página e intentá nuevamente.");
    }
  });
  $("finished-form").onsubmit=saveFinishedProduct;
  $("add-finished-color").onclick=addFinishedColor;
  $("add-finished-supply").onclick=addFinishedRecipeRow;
  $("supply-form").onsubmit=saveSupplyForm;
  $("supply-category").addEventListener("change",()=>updateSupplyFilamentFields({fromCategoryChange:true}));
  $("supply-unit").addEventListener("change",()=>updateSupplyFilamentFields());
  $("supply-material").addEventListener("change",()=>updateSupplyFilamentFields());
  $("supply-category-form").onsubmit=e=>{e.preventDefault();addSupplyCategory($("new-supply-category").value);e.target.reset();closeModal("supply-category-modal");};
  $("budget-form").addEventListener("input",calculateBudget);$("budget-form").addEventListener("change",calculateBudget);
  $("budget-form").onsubmit=e=>{e.preventDefault();calculateBudget();toast("Presupuesto calculado")};
  $("add-budget-supply").onclick=()=>{budgetRows.push({id:"",qty:1});renderBudgetSupplyRows();calculateBudget()};
  $("save-budget").onclick=saveBudget;$("copy-budget").onclick=copyBudget;
  document.querySelectorAll(".period-tabs .tab[data-period]").forEach(t=>t.onclick=()=>{salesPeriod=t.dataset.period;document.querySelectorAll(".period-tabs .tab[data-period]").forEach(x=>x.classList.toggle("active",x===t));renderOrders();});
  document.querySelectorAll("[data-analytics-range]").forEach(t=>t.onclick=()=>{analyticsRange=t.dataset.analyticsRange;renderAnalytics();});
  document.querySelectorAll("[data-analytics-view]").forEach(t=>t.onclick=()=>{analyticsView=t.dataset.analyticsView;renderAnalytics();});
  initBudgetDefaults();
  if(window.__cubicaMigratedFromBrowser)toast("Datos del navegador migrados a la Raspberry Pi.");
  const syncBadge=$("server-sync-badge");
  // Este comportamiento es solo para el backend Raspberry/Flask.
  // En modo Supabase, supabase-inventory.js instala su propio comportamiento.
  if(syncBadge && CUBICA_RUNTIME.mode!=="supabase")syncBadge.onclick=async()=>{
    if(serverStateInitialized)return toast("Productos, insumos, ventas y presupuestos se guardan en la Raspberry.");
    if(!confirm("¿Migrar los datos actuales de este navegador a la Raspberry Pi?"))return;
    try{await migrateCurrentBrowserToServer(false);toast("Datos migrados correctamente a la Raspberry.");}
    catch(err){toast(err.message||"No se pudo migrar.");}
  };
});
function initBudgetDefaults(){ if(!window.budgetRows.length)window.budgetRows=[{id:"",qty:1}];}
window.addToCart=addToCart;window.changeCart=changeCart;window.removeCart=removeCart;window.updateProduct=updateProduct;window.deleteProduct=deleteProduct;window.editProduct=editProduct;window.removeFinishedColor=removeFinishedColor;window.updateFinishedRecipe=updateFinishedRecipe;window.removeFinishedRecipe=removeFinishedRecipe;
window.setProductPage=setProductPage;window.setFinishedPage=setFinishedPage;window.moveFinishedProduct=moveFinishedProduct;window.openProductDetail=openProductDetail;window.setProductMedia=setProductMedia;window.changeProductMedia=changeProductMedia;window.selectProductColor=selectProductColor;window.toggleProductColor=toggleProductColor;window.removeBudgetRow=removeBudgetRow;window.updateBudgetRow=updateBudgetRow;window.markOrder=markOrder;
