/* CÚBICA 3D — interfaz de pedidos y planificación de insumos. */

let salesPeriod="day";
let orderPageSize=[10,25,50].includes(Number(globalThis.localStorage?.getItem("cubica_order_page_size")))?Number(globalThis.localStorage?.getItem("cubica_order_page_size")):10;
let orderPage=1;
let orderSortMode=globalThis.localStorage?.getItem("cubica_order_sort")==="oldest"?"oldest":"recent";

function orderSearchText(order){
  return [order?.orderNumber,order?.id,order?.customerName,order?.customerEmail].join(" ").toLocaleLowerCase("es");
}
function adminOrderView(list,{search="",status="all",payment="all",sort="recent"}={}){
  const needle=String(search||"").trim().toLocaleLowerCase("es");
  return [...(list||[])].filter(order=>(!needle||orderSearchText(order).includes(needle))
    &&(status==="all"||order.status===status)
    &&(payment==="all"||order.payment===payment))
    .sort((a,b)=>{
      const date=String(a.date||"").localeCompare(String(b.date||""));
      const stable=String(a.id||a.orderNumber||"").localeCompare(String(b.id||b.orderNumber||""));
      return sort==="oldest"?(date||stable):(-date||-stable);
    });
}
function renderOrderPaymentOptions(list){
  const select=$("orders-payment-filter");if(!select)return;
  const current=select.value||"all";
  const values=[...new Set((list||[]).map(order=>String(order.payment||"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"es",{sensitivity:"base"}));
  select.innerHTML='<option value="all">Todos los medios de pago</option>'+values.map(value=>`<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
  select.value=values.includes(current)?current:"all";
}
function setOrderPage(page){orderPage=Math.max(1,Math.trunc(Number(page)||1));renderOrders();$("orders-admin-toolbar")?.scrollIntoView({behavior:"smooth",block:"start"});}
function setOrderPageSize(size){const next=Number(size);if(![10,25,50].includes(next))return;orderPageSize=next;orderPage=1;globalThis.localStorage?.setItem("cubica_order_page_size",String(next));renderOrders();}
function customerOrderStage(order){
  const status=String(order?.status||"Pendiente"),shipping=order?.delivery?.mode==="shipping";
  const preparedLabel=shipping?"Preparado para envío":"Listo para entregar";
  if(status==="Cancelado")return {status,index:-1,label:"Cancelado",description:"Este pedido fue cancelado.",preparedLabel,cancelled:true};
  if(status==="Entregado")return {status,index:3,label:"Entregado",description:"El pedido fue entregado.",preparedLabel};
  if(["Preparado","Listo para entregar"].includes(status))return {status,index:2,label:preparedLabel,description:shipping?"Tu pedido está preparado para el envío.":"Tu pedido está listo. Nos comunicaremos con vos para coordinar el retiro.",preparedLabel};
  if(status==="En producción")return {status,index:1,label:"Preparando",description:"Tu pedido está actualmente en producción.",preparedLabel};
  if(status==="Confirmado")return {status,index:0,label:"Pedido confirmado",description:"Confirmamos tu pedido. Todavía está pendiente de producción.",preparedLabel,confirmed:true};
  return {status,index:0,label:"Pendiente",description:"Recibimos y registramos tu pedido.",preparedLabel};
}
function customerOrderStatus(status,delivery=null){
  return customerOrderStage({status,delivery}).label;
}
function orderProductImage(item){
  const product=products.find(p=>String(p.id)===String(item.productId));
  const source=product?.media?.find(media=>media.type==="image")?.src||"";
  return /^(https?:\/\/|assets\/)/i.test(source)?source:"";
}
function orderTimelineHtml(order){
  const stage=customerOrderStage(order);
  if(stage.cancelled)return `<div class="order-cancelled" role="status"><span aria-hidden="true">×</span><div><strong>Pedido cancelado</strong><p>${escapeHtml(stage.description)}</p></div></div>`;
  const steps=[
    {label:stage.confirmed?"Confirmado":"Pendiente",icon:"◷"},
    {label:"Preparando",icon:"⌘"},
    {label:stage.preparedLabel,icon:"▣"},
    {label:"Entregado",icon:"✓"}
  ];
  return `<div class="order-tracking" aria-label="Seguimiento del pedido"><div class="order-timeline">${steps.map((step,index)=>{
    const state=index<stage.index?"complete":index===stage.index?"current":"pending";
    return `<div class="order-timeline-step ${state}" aria-current="${state==="current"?"step":"false"}"><span class="order-timeline-icon" aria-hidden="true">${step.icon}</span><span>${escapeHtml(step.label)}</span></div>`;
  }).join("")}</div><p class="order-stage-message">${escapeHtml(stage.description)}</p></div>`;
}
function customerOrderCard(order){
  const number=String(order.orderNumber||order.id).startsWith("CUB-")?(order.orderNumber||order.id):`#${String(order.id).slice(-8).toUpperCase()}`;
  const stage=customerOrderStage(order),items=order.items||[];
  return `<article class="customer-order-card">
    <header class="customer-order-head"><div><span class="eyebrow">PEDIDO</span><strong>${escapeHtml(number)}</strong><time datetime="${escapeHtml(order.date)}">${formatDate(order.date)}</time></div><span class="customer-order-status ${stage.cancelled?"cancelled":""}">${escapeHtml(stage.label)}</span></header>
    <div class="customer-order-products">${items.map(item=>{const image=orderProductImage(item);return `<div class="customer-order-product">${image?`<img src="${escapeHtml(image)}" alt="" loading="lazy">`:'<span class="customer-order-product-placeholder" aria-hidden="true">◇</span>'}<div><strong>${escapeHtml(item.name)}</strong><span>${item.color?`${escapeHtml(item.color)} · `:""}Cantidad: ${Number(item.qty)||0}</span></div></div>`;}).join("")}</div>
    <footer class="customer-order-footer"><strong>${money(order.total)}</strong><details><summary class="btn secondary">Ver seguimiento</summary><div class="customer-order-detail">${orderTimelineHtml(order)}${window.cubicaDelivery?.customerHtml(order.delivery)||""}</div></details></footer>
  </article>`;
}

function renderOrders(){
  if(!session)return;
  const isAdmin=session.role==="admin";
  const mine=isAdmin?orders:orders.filter(o=>String(o.customerEmail||"").toLowerCase()===String(session.email||"").toLowerCase()||o.userId===session.supabaseUserId);
  const eyebrow=$("orders-eyebrow"),title=$("orders-title"),subtitle=$("orders-subtitle");
  if(eyebrow)eyebrow.textContent=isAdmin?"VENTAS":"CUENTA";
  if(title)title.textContent=isAdmin?"Ventas / Pedidos":"Mis pedidos";
  if(subtitle)subtitle.textContent=isAdmin?"Buscá y combiná filtros sin alterar el ciclo de cada pedido.":"Consultá tus compras realizadas con esta cuenta y su estado.";

  const periods=document.querySelector("#section-orders .period-tabs"),kpis=$("sales-kpis"),payments=$("payment-breakdown"),toolbar=$("orders-admin-toolbar"),pagination=$("orders-pagination");
  periods?.classList.toggle("hidden",!isAdmin);kpis?.classList.toggle("hidden",!isAdmin);payments?.classList.toggle("hidden",!isAdmin);toolbar?.classList.toggle("hidden",!isAdmin);pagination?.classList.toggle("hidden",!isAdmin);
  if(!isAdmin){
    $("orders-list").classList.add("customer-orders-list");
    $("orders-list").innerHTML=mine.slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))).map(customerOrderCard).join("")||'<div class="card customer-orders-empty"><span aria-hidden="true">▤</span><h3>Todavía no tenés pedidos</h3><p class="muted">Cuando hagas una compra, vas a poder seguirla desde acá.</p><button class="btn primary" type="button" onclick="showSection(\'store\')">Volver a la tienda</button></div>';
    return;
  }
  $("orders-list").classList.remove("customer-orders-list");
  renderOrderPaymentOptions(mine);
  const filtered=adminOrderView(mine,{search:$("orders-search")?.value||"",status:$("orders-status-filter")?.value||"all",payment:$("orders-payment-filter")?.value||"all",sort:$("orders-sort")?.value||orderSortMode});
  const totalPages=Math.max(1,Math.ceil(filtered.length/orderPageSize));orderPage=Math.min(Math.max(1,orderPage),totalPages);
  const pageStart=(orderPage-1)*orderPageSize,pageItems=filtered.slice(pageStart,pageStart+orderPageSize),groups=new Map();
  pageItems.forEach(o=>{const d=new Date(o.date),key=salesPeriod==="day"?todayKey(o.date):salesPeriod==="month"?`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`:String(d.getFullYear());if(!groups.has(key))groups.set(key,[]);groups.get(key).push(o);});
  const revenue=filtered.reduce((a,o)=>a+Number(o.total||0),0),units=filtered.reduce((a,o)=>a+(o.items||[]).reduce((x,i)=>x+(Number(i.qty)||0),0),0);
  const cash=filtered.filter(o=>o.payment==="Efectivo").reduce((a,o)=>a+Number(o.total||0),0),transfer=filtered.filter(o=>o.payment==="Transferencia").reduce((a,o)=>a+Number(o.total||0),0);
  $("sales-kpis").innerHTML=`<div class="kpi"><span>Pedidos encontrados</span><strong>${filtered.length}</strong></div><div class="kpi"><span>Unidades</span><strong>${units}</strong></div><div class="kpi"><span>Facturación filtrada</span><strong>${money(revenue)}</strong></div><div class="kpi"><span>Agrupación</span><strong>${salesPeriod==="day"?"Día":salesPeriod==="month"?"Mes":"Año"}</strong></div>`;
  $("payment-breakdown").innerHTML=`<div class="payment-card"><span>💵 Efectivo</span><strong>${money(cash)}</strong></div><div class="payment-card"><span>🏦 Transferencia</span><strong>${money(transfer)}</strong></div><div class="payment-card total"><span>Total filtrado</span><strong>${money(revenue)}</strong></div>`;
  $("orders-list").innerHTML=[...groups.entries()].map(([key,groupOrders])=>`<div><div class="orders-result-heading"><h3>${escapeHtml(key)}</h3><span>${groupOrders.length} en esta página</span></div>${groupOrders.map(o=>`
    <article class="order-card"><div class="order-head"><div><strong>${escapeHtml(String(o.orderNumber||o.id).startsWith("CUB-")?(o.orderNumber||o.id):`#${String(o.id).slice(-8).toUpperCase()}`)}</strong><div class="muted">${formatDate(o.date)}</div></div><strong>${money(o.total)}</strong></div>
    <div class="order-body">${o.origin==="budget"?'<span class="order-origin-badge">Pedido interno de presupuesto</span>':""}${window.cubicaDelivery?.customerHtml(o.delivery)||""}<div class="order-items">${(o.items||[]).map(i=>`${escapeHtml(i.name)}${i.color?` · ${escapeHtml(i.color)}`:""} × ${i.qty} — ${money(i.price*i.qty)}`).join("<br>")} </div>
    <p class="muted">Cliente: ${escapeHtml(o.customerName)}${o.customerEmail?` · ${escapeHtml(o.customerEmail)}`:""} · Pago: ${escapeHtml(o.payment)} · Estado: <strong>${escapeHtml(o.status)}</strong></p>
    <p class="muted">${o.productionStartedAt?"Consumo de materiales registrado":"Materiales sin consumir"}</p><button class="btn ghost" onclick="openOrderManagement('${escapeHtml(o.id)}')">Gestionar pedido</button></div></article>`).join("")}</div>`).join("")||'<div class="card" style="padding:20px">No se encontraron pedidos con esos filtros.</div>';
  renderPagination("orders-pagination",{page:orderPage,totalPages,totalItems:filtered.length,pageSize:orderPageSize,setter:"setOrderPage",pageSizeSetter:"setOrderPageSize"});
}
function markOrder(id){return window.openOrderManagement?.(id)}

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

window.markOrder=markOrder;
window.setOrderPage=setOrderPage;
window.setOrderPageSize=setOrderPageSize;
window.cubicaOrderUiInternals={customerOrderStage,customerOrderStatus,orderTimelineHtml,adminOrderView,orderSearchText};

