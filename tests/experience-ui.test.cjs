const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const html=read("index.html"),css=read("styles.css"),ordersSource=read("js/orders-ui.js"),shellSource=read("js/ui-shell.js");

assert.equal((html.match(/id="logout-btn"/g)||[]).length,1,"Debe existir un único cierre de sesión");
for(const id of ["sidebar-menu-btn","profile-menu","budget-tab-create","budget-tab-history","budget-tab-detail","budget-review-summary"]){
  assert.match(html,new RegExp(`id="${id}"`),`Falta ${id}`);
}
assert.match(html,/data-budget-step="1"[\s\S]*data-budget-step="2"[\s\S]*data-budget-step="3"/);
assert.match(css,/account-sidebar-pinned[\s\S]*left:/);
assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
assert.match(css,/\.profile-menu/);
assert.match(css,/\.order-timeline-step\.current/);

const orderContext={
  window:{},products:[],session:null,orders:[],supplies:[],
  escapeHtml:value=>String(value??""),money:value=>`$${value}`,formatDate:value=>String(value),todayKey:value=>String(value),
  $:()=>null,console
};
vm.createContext(orderContext);
vm.runInContext(ordersSource,orderContext);
const orderUi=orderContext.window.cubicaOrderUiInternals;
assert.equal(orderUi.customerOrderStage({status:"Pendiente"}).label,"Pendiente");
assert.equal(orderUi.customerOrderStage({status:"Confirmado"}).label,"Pedido confirmado");
assert.equal(orderUi.customerOrderStage({status:"En producción"}).label,"Preparando");
assert.equal(orderUi.customerOrderStage({status:"Preparado",delivery:{mode:"pickup"}}).label,"Listo para entregar");
assert.equal(orderUi.customerOrderStage({status:"Preparado",delivery:{mode:"shipping"}}).label,"Preparado para envío");
assert.equal(orderUi.customerOrderStage({status:"Entregado"}).label,"Entregado");
assert.equal(orderUi.customerOrderStage({status:"Cancelado"}).cancelled,true);
assert.match(ordersSource,/periods\?\.classList\.toggle\("hidden",!isAdmin\)/,"La vista cliente debe ocultar períodos");
assert.match(ordersSource,/kpis\?\.classList\.toggle\("hidden",!isAdmin\)/,"La vista cliente debe ocultar KPIs");
assert.match(ordersSource,/payments\?\.classList\.toggle\("hidden",!isAdmin\)/,"La vista cliente debe ocultar pagos agregados");

const shellContext={
  window:{location:{search:"",hash:"",pathname:"/",origin:"https://cubica3d.ar",href:"https://cubica3d.ar/"},matchMedia:()=>({matches:true})},
  document:{documentElement:{clientWidth:1040}},session:{role:"customer"},
  sessionStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},URL,URLSearchParams,console,setTimeout,requestAnimationFrame:fn=>fn()
};
vm.createContext(shellContext);
vm.runInContext(shellSource,shellContext);
assert.equal(shellContext.window.cubicaShellInternals.shouldPinAccountSidebar(),true,"Debe anclar con espacio útil suficiente");
shellContext.document.documentElement.clientWidth=900;
assert.equal(shellContext.window.cubicaShellInternals.shouldPinAccountSidebar(),false,"Debe usar drawer cuando falta espacio útil");
shellContext.session={role:"admin",adminMfaEnforcement:true,adminMfaAccessAllowed:false};
assert.equal(shellContext.window.cubicaShellInternals.accountSidebarEligible(),false,"AAL1 no debe habilitar navegación administrativa");

console.log("experience-ui.test.cjs: OK");
