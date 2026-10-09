/* CÚBICA 3D — núcleo compartido.
   Estado base, utilidades y persistencia local temporal.
   La fuente de verdad de datos comerciales es Supabase.
*/

const STORAGE = {
  session:"cubica_session",
  products:"cubica_finished_products",
  supplies:"cubica_supplies",
  orders:"cubica_orders",
  cart:"cubica_cart",
  quotes:"cubica_quotes",
  supplyCategories:"cubica_supply_categories"
};

const DEFAULT_SUPPLY_CATEGORIES = ["Filamentos","Electrónica","Cajas","Electricidad","Iluminación","Packaging","Otros"];
const DEFAULT_FINISHED_CATEGORIES = ["Figuras","Veladores","Decoración","Accesorios"];

const $ = id => document.getElementById(id);
const money = n => new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS",maximumFractionDigits:0}).format(Number(n)||0);
const read = (key,fallback) => {
  try {
    const x=localStorage.getItem(key);
    return x?JSON.parse(x):fallback;
  } catch {
    return fallback;
  }
};
const writeLocal = (key,value) => localStorage.setItem(key,JSON.stringify(value));

function write(key,value){
  writeLocal(key,value);
  if(typeof window.cubicaOnLocalWrite==="function"){
    try{
      window.cubicaOnLocalWrite(key,value);
    }catch(err){
      console.error("Hook de persistencia Cúbica",err);
    }
  }
}

const escapeHtml = s => String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const uid = p => p+Date.now().toString(36)+Math.random().toString(36).slice(2,7);

let products = read(STORAGE.products, []);
let supplies = read(STORAGE.supplies, []);
let supplyCategories = read(STORAGE.supplyCategories, DEFAULT_SUPPLY_CATEGORIES);
let orders = read(STORAGE.orders, []);
let cart = read(STORAGE.cart, []);
let session = read(STORAGE.session, null);

function updateDataBadge(text,mode="ok"){
  const el=$("server-sync-badge");
  if(!el)return;
  el.textContent=text;
  el.dataset.mode=mode;
  el.classList.remove("hidden");
}

// Alias interno para los adaptadores Supabase existentes.
const updateServerBadge=updateDataBadge;

function toast(msg){
  const el=document.createElement("div");
  el.className="toast";
  el.textContent=msg;
  $("toast-container")?.appendChild(el);
  setTimeout(()=>el.remove(),3000);
}

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
  if(String(s?.category||"").toLowerCase().startsWith("filament") && s?.unit==="gramos")return cost*(amount/1000);
  return cost*amount;
}

function supplyCostLabel(s){
  if(String(s?.category||"").toLowerCase().startsWith("filament") && s?.unit==="gramos")return "por kg";
  return "por "+supplyUnitLabel(s?.unit,1);
}

function initData(){
  products = products.map(p=>normalizeProduct(p)).map((p,i)=>{
    if(!(p.sortOrder>0))p.sortOrder=(i+1)*10;
    return p;
  });
  supplies = supplies.map((raw,i)=>{
    const item=normalizeSupply(raw);
    if(!(item.sortOrder>0))item.sortOrder=(i+1)*10;
    return item;
  });
  supplyCategories=[...new Set([...DEFAULT_SUPPLY_CATEGORIES,...supplyCategories,...supplies.map(s=>s.category).filter(Boolean)])];

  // localStorage funciona como caché/UI temporal. Supabase vuelve a cargar la
  // fuente de verdad apenas se inicializan sus adaptadores.
  writeLocal(STORAGE.products,products);
  writeLocal(STORAGE.supplies,supplies);
  writeLocal(STORAGE.supplyCategories,supplyCategories);
}

function formatDate(iso){
  return new Intl.DateTimeFormat("es-AR",{dateStyle:"medium",timeStyle:"short"}).format(new Date(iso));
}

function todayKey(iso=new Date().toISOString()){
  return new Date(iso).toLocaleDateString("sv-SE");
}
