const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const html=read("index.html"),css=read("styles.css"),ordersSource=read("js/orders-ui.js"),productsSource=read("js/products-ui.js"),bridge=read("supabase-bridge.js"),migration=read("supabase/migrations/20261017205803_admin_product_categories.sql");

for(const id of ["orders-search","orders-status-filter","orders-payment-filter","orders-sort","orders-pagination","add-finished-category","finished-category-modal","finished-category-list"]){
  assert.match(html,new RegExp(`id="${id}"`),`Falta el control ${id}`);
}
for(const status of ["Pendiente","Confirmado","En producción","Preparado","Entregado","Cancelado"]){
  assert.match(html,new RegExp(`value="${status}"`),`Falta el estado ${status}`);
}
assert.match(css,/\.supply-toolbar\{[^}]*grid-template-columns:repeat\(12,minmax\(0,1fr\)\)/,"La barra de insumos debe repartir el ancho real");
assert.match(css,/\.supply-toolbar>\*\{[^}]*min-width:0/,"Los controles no deben forzar desborde");
assert.doesNotMatch(css,/\.supply-toolbar \.inventory-search\{min-width:250px\}/,"La búsqueda de insumos no debe conservar un ancho mínimo rígido");
assert.match(css,/@media\(max-width:600px\)\{[\s\S]*?\.supply-toolbar \.inventory-search,.supply-toolbar select\{grid-column:1\/-1\}/,"En móvil cada filtro debe ocupar una fila segura");

const storage={getItem:()=>null,setItem:()=>{}};
const orderContext={window:{},globalThis:null,localStorage:storage,products:[],session:null,orders:[],supplies:[],escapeHtml:value=>String(value??""),money:value=>`$${value}`,formatDate:value=>String(value),todayKey:value=>String(value),$:()=>null,document:{querySelector:()=>null},console};
orderContext.globalThis=orderContext;
vm.createContext(orderContext);vm.runInContext(ordersSource,orderContext);
const orderUi=orderContext.window.cubicaOrderUiInternals;
const sample=[
  {id:"b",orderNumber:"CUB-2",customerName:"Ana Pérez",customerEmail:"ana@example.com",status:"Preparado",payment:"Transferencia",date:"2026-10-17T12:00:00Z"},
  {id:"a",orderNumber:"CUB-1",customerName:"Diego Solís",customerEmail:"diego@example.com",status:"Pendiente",payment:"Efectivo",date:"2026-10-16T12:00:00Z"},
  {id:"c",orderNumber:"CUB-3",customerName:"Ana Pérez",customerEmail:"ana@example.com",status:"Pendiente",payment:"Efectivo",date:"2026-10-18T12:00:00Z"}
];
assert.deepEqual(Array.from(orderUi.adminOrderView(sample,{search:"ana",status:"Pendiente",payment:"Efectivo"})).map(x=>x.id),["c"],"La búsqueda y los filtros deben combinarse");
assert.deepEqual(Array.from(orderUi.adminOrderView(sample,{search:"CUB-",sort:"oldest"})).map(x=>x.id),["a","b","c"],"El orden antiguo debe usar la fecha real");
assert.deepEqual(Array.from(orderUi.adminOrderView(sample,{search:"example.com",sort:"recent"})).map(x=>x.id),["c","b","a"],"La búsqueda por email y el orden reciente deben funcionar");

const productContext={window:{addEventListener:()=>{},location:{href:"https://cubica3d.ar/"}},globalThis:null,localStorage:storage,productCategories:[{name:"Figuras",sortOrder:10,active:true},{name:"Oculta",sortOrder:20,active:false}],products:[{id:"1",category:"Figuras"},{id:"2",category:"Histórica"}],DEFAULT_FINISHED_CATEGORIES:[],session:null,escapeHtml:value=>String(value??""),$:()=>null,toast:()=>{},writeLocal:()=>{},STORAGE:{},uid:()=>"x",console,URL,FileReader:function(){},history:{replaceState:()=>{},pushState:()=>{}},location:{href:"https://cubica3d.ar/",search:"",pathname:"/"},document:{title:"",querySelector:()=>null}};
productContext.globalThis=productContext;
vm.createContext(productContext);vm.runInContext(productsSource,productContext);
const categoryUi=productContext.window.cubicaFinishedCategoryInternals;
assert.deepEqual(Array.from(categoryUi.finishedCategories({activeOnly:true})),["Figuras"],"Solo las categorías persistidas y activas deben asignarse a productos nuevos");
assert.equal(categoryUi.normalizedFinishedCategoryName("  Luz   y color  "),"Luz y color");

assert.match(bridge,/from\("product_categories"\)\.select\("name,sort_order,active"\)/,"Debe cargar categorías reales de Supabase");
assert.match(bridge,/rpc\("manage_admin_product_category"/,"La administración debe usar la operación transaccional");
assert.match(migration,/not private\.is_admin\(\)/,"La mutación debe exigir admin AAL2");
assert.match(migration,/update public\.products set category=v_new_name/,"Renombrar debe reasignar productos en la misma transacción");
assert.match(migration,/product_categories_normalized_name_uidx/,"Debe impedir duplicados normalizados");
assert.match(migration,/revoke all on function[\s\S]*from public,anon,service_role/,"La RPC no debe quedar expuesta a roles públicos");
assert.match(productsSource,/openFinishedCategoryDelete/,"La corrección de Etapa A debe ofrecer eliminación protegida");

console.log("admin-stage-a.test.cjs: OK");
