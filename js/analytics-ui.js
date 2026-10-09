/* CÚBICA 3D — módulo UI de análisis.
   Extraído de script.js el 2026-10-09.
   Mantiene la lógica visual/cálculos de analytics separada del núcleo de la app.
*/

function svgEscape(s){return escapeHtml(String(s));}
function analyticsRangeBounds(range=analyticsRange, anchor=new Date()){
  const now=new Date(anchor), end=new Date(anchor);
  let start=null, previousStart=null, previousEnd=null;
  if(range==="today"){
    start=new Date(now);start.setHours(0,0,0,0);
    previousEnd=new Date(start.getTime()-1);previousStart=new Date(previousEnd);previousStart.setHours(0,0,0,0);
  }else if(range==="7d"||range==="30d"){
    const days=range==="7d"?7:30;
    start=new Date(now);start.setHours(0,0,0,0);start.setDate(start.getDate()-(days-1));
    previousEnd=new Date(start.getTime()-1);
    previousStart=new Date(previousEnd);previousStart.setHours(0,0,0,0);previousStart.setDate(previousStart.getDate()-(days-1));
  }else if(range==="month"){
    start=new Date(now.getFullYear(),now.getMonth(),1);
    previousStart=new Date(now.getFullYear(),now.getMonth()-1,1);
    previousEnd=new Date(start.getTime()-1);
  }else if(range==="year"){
    start=new Date(now.getFullYear(),0,1);
    previousStart=new Date(now.getFullYear()-1,0,1);
    previousEnd=new Date(start.getTime()-1);
  }
  return {start,end,previousStart,previousEnd};
}
function filterOrdersByAnalyticsRange(list,range=analyticsRange){
  if(range==="all")return [...list];
  const {start,end}=analyticsRangeBounds(range);
  return list.filter(o=>{const d=new Date(o.date);return d>=start&&d<=end;});
}
function validAnalyticsOrders(list){
  return (list||[]).filter(o=>String(o.status||"").toLowerCase()!=="cancelado");
}
function analyticsRangeLabel(range=analyticsRange){
  return ({today:"Hoy","7d":"Últimos 7 días","30d":"Últimos 30 días",month:"Este mes",year:"Este año",all:"Todo el historial"})[range]||"Período";
}
function recipeCostInfo(product){
  if(!product?.recipe?.length)return {cost:0,complete:false};
  let cost=0,complete=true;
  for(const r of product.recipe){
    const supply=supplies.find(s=>s.id===r.supplyId);
    const qty=Number(r.qty)||0;
    if(!supply || qty<=0 || !(Number(supply.cost)>0)){complete=false;continue;}
    cost+=supplyCostForQty(supply,qty);
  }
  return {cost,complete};
}
function estimateRecipeUnitCost(product){return recipeCostInfo(product).cost}
function analyticsProductRows(list){
  const map=new Map();
  for(const o of list){
    for(const i of (o.items||[])){
      const key=String(i.productId||i.name||"producto");
      if(!map.has(key))map.set(key,{id:i.productId||"",name:i.name||"Producto",units:0,revenue:0,orders:new Set(),cost:0,costComplete:true});
      const row=map.get(key), qty=Number(i.qty)||0, price=Number(i.price)||0;
      row.units+=qty;row.revenue+=qty*price;row.orders.add(o.id);
      const p=products.find(x=>String(x.id)===String(i.productId));
      const info=recipeCostInfo(p);
      row.cost+=info.cost*qty;
      if(!info.complete)row.costComplete=false;
    }
  }
  return [...map.values()].map(r=>({
    ...r,
    orders:r.orders.size,
    profit:r.costComplete?r.revenue-r.cost:null,
    margin:r.costComplete&&r.revenue>0?((r.revenue-r.cost)/r.revenue)*100:null
  })).sort((a,b)=>b.revenue-a.revenue);
}
function analyticsCustomerRows(periodOrders,allOrders){
  const allMap=new Map();
  const keyFor=o=>(String(o.customerEmail||"").trim().toLowerCase()||String(o.customerName||"Cliente").trim().toLowerCase());
  for(const o of allOrders){
    const key=keyFor(o); if(!allMap.has(key))allMap.set(key,0); allMap.set(key,allMap.get(key)+1);
  }
  const map=new Map();
  for(const o of periodOrders){
    const key=keyFor(o);
    if(!map.has(key))map.set(key,{name:o.customerName||"Cliente",email:o.customerEmail||"",orders:0,revenue:0,last:o.date});
    const r=map.get(key);r.orders++;r.revenue+=Number(o.total)||0;if(new Date(o.date)>new Date(r.last))r.last=o.date;
  }
  return [...map.entries()].map(([key,r])=>({...r,recurrent:(allMap.get(key)||0)>1,ticket:r.orders?r.revenue/r.orders:0})).sort((a,b)=>b.revenue-a.revenue);
}
function analyticsSupplyConsumption(productRows){
  const map=new Map();
  for(const row of productRows){
    const p=products.find(x=>String(x.id)===String(row.id)); if(!p)continue;
    for(const r of (p.recipe||[])){
      const supply=supplies.find(x=>x.id===r.supplyId);if(!supply)continue;
      if(!map.has(supply.id))map.set(supply.id,{name:supply.name,category:supply.category,unit:supply.unit,qty:0,cost:0});
      const x=map.get(supply.id),used=(Number(r.qty)||0)*row.units;
      x.qty+=used;x.cost+=supplyCostForQty(supply,used);
    }
  }
  return [...map.values()].sort((a,b)=>b.cost-a.cost);
}
function percentChange(current,previous){
  if(!previous)return current>0?100:0;
  return ((current-previous)/previous)*100;
}
function variationHtml(current,previous){
  const v=percentChange(current,previous);
  const cls=v>0?"up":v<0?"down":"flat";
  return `<small class="kpi-variation ${cls}">${v>0?"▲":v<0?"▼":"•"} ${Math.abs(v).toFixed(0)}% vs período anterior</small>`;
}
function renderAnalyticsLineChart(svgId,points,xLabels,{currency=false}={}){
  const svg=$(svgId);if(!svg)return;
  const W=900,H=360,pad={l:76,r:25,t:25,b:55},iw=W-pad.l-pad.r,ih=H-pad.t-pad.b;
  const max=Math.max(1,...points.map(p=>Number(p.y)||0));
  const x=i=>pad.l+(points.length===1?iw/2:(i/(Math.max(1,points.length-1)))*iw);
  const y=v=>pad.t+ih-((Number(v)||0)/max)*ih;
  const short=v=>currency?new Intl.NumberFormat("es-AR",{notation:"compact",maximumFractionDigits:1}).format(v):Math.round(v);
  let out=`<rect x="0" y="0" width="${W}" height="${H}" fill="transparent"/>`;
  for(let g=0;g<=4;g++){const val=max*g/4,yy=y(val);out+=`<line x1="${pad.l}" y1="${yy}" x2="${W-pad.r}" y2="${yy}" class="chart-gridline"/><text x="${pad.l-10}" y="${yy+4}" text-anchor="end" class="chart-axis-text">${currency?"$":""}${short(val)}</text>`;}
  out+=`<line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${H-pad.b}" class="chart-axis"/><line x1="${pad.l}" y1="${H-pad.b}" x2="${W-pad.r}" y2="${H-pad.b}" class="chart-axis"/>`;
  if(points.length){
    const d=points.map((p,i)=>`${i?"L":"M"} ${x(i).toFixed(1)} ${y(p.y).toFixed(1)}`).join(" ");
    out+=`<path d="${d}" class="chart-line"/>`;
    points.forEach((p,i)=>{
      const value=currency?money(p.y):String(Math.round(p.y));
      out+=`<circle cx="${x(i)}" cy="${y(p.y)}" r="7" class="chart-point" data-tooltip="${svgEscape(p.label)} · ${svgEscape(value)}" tabindex="0"><title>${svgEscape(p.label)} · ${svgEscape(value)}</title></circle>`;
    });
  }
  const skip=Math.max(1,Math.ceil(points.length/9));
  points.forEach((p,i)=>{if(i%skip===0||i===points.length-1)out+=`<text x="${x(i)}" y="${H-20}" text-anchor="middle" class="chart-axis-text">${svgEscape(xLabels[i]||"")}</text>`;});
  svg.innerHTML=out;attachChartTooltips(svg);
}
function renderWeeklyTimeChart(list=null){
  const svg=$("weekly-time-chart");if(!svg)return;
  const W=900,H=360,pad={l:60,r:25,t:25,b:55},iw=W-pad.l-pad.r,ih=H-pad.t-pad.b;
  const days=["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];let out="";
  for(let h=0;h<=24;h+=4){const yy=pad.t+ih-(h/24)*ih;out+=`<line x1="${pad.l}" y1="${yy}" x2="${W-pad.r}" y2="${yy}" class="chart-gridline"/><text x="${pad.l-10}" y="${yy+4}" text-anchor="end" class="chart-axis-text">${String(h).padStart(2,"0")}:00</text>`;}
  days.forEach((d,i)=>{const xx=pad.l+(i/6)*iw;out+=`<line x1="${xx}" y1="${pad.t}" x2="${xx}" y2="${H-pad.b}" class="chart-gridline"/><text x="${xx}" y="${H-20}" text-anchor="middle" class="chart-axis-text">${d}</text>`;});
  const mine=list||filterOrdersByAnalyticsRange(validAnalyticsOrders(orders));
  mine.forEach(o=>{const d=new Date(o.date),day=d.getDay(),hour=d.getHours()+d.getMinutes()/60,xx=pad.l+(day/6)*iw,yy=pad.t+ih-(hour/24)*ih;out+=`<circle cx="${xx}" cy="${yy}" r="6" class="chart-point" data-tooltip="${svgEscape(formatDate(o.date))} · ${svgEscape(o.customerName||"Cliente")}" tabindex="0"></circle>`;});
  out+=`<line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${H-pad.b}" class="chart-axis"/><line x1="${pad.l}" y1="${H-pad.b}" x2="${W-pad.r}" y2="${H-pad.b}" class="chart-axis"/>`;
  svg.innerHTML=out;attachChartTooltips(svg);
}
function attachChartTooltips(svg){
  if(!svg)return;
  const old=document.getElementById("chart-tooltip");if(old)old.remove();
  const tip=document.createElement("div");tip.id="chart-tooltip";tip.className="chart-tooltip hidden";document.body.appendChild(tip);
  const hide=()=>tip.classList.add("hidden");
  svg.querySelectorAll(".chart-point[data-tooltip]").forEach(point=>{
    const show=()=>{tip.textContent=point.dataset.tooltip||"";tip.classList.remove("hidden");const r=point.getBoundingClientRect();const left=r.left+r.width/2,top=r.top-10;tip.style.left=`${Math.min(window.innerWidth-12,Math.max(12,left))}px`;tip.style.top=`${Math.max(12,top)}px`;tip.style.transform="translate(-50%,-100%)";};
    point.addEventListener("mouseenter",show);point.addEventListener("mouseleave",hide);point.addEventListener("focus",show);point.addEventListener("blur",hide);
  });
}
function analyticsTimeline(periodOrders){
  const now=new Date(),points=[],labels=[];
  if(analyticsRange==="today"){
    for(let h=0;h<24;h+=2){
      const subset=periodOrders.filter(o=>new Date(o.date).getHours()>=h&&new Date(o.date).getHours()<h+2);
      points.push({y:subset.reduce((a,o)=>a+(Number(o.total)||0),0),label:`${String(h).padStart(2,"0")}:00–${String(h+2).padStart(2,"0")}:00`});labels.push(`${String(h).padStart(2,"0")}h`);
    }
  }else if(analyticsRange==="year"||analyticsRange==="all"){
    let months=[];
    if(analyticsRange==="year"){
      months=Array.from({length:12},(_,m)=>new Date(now.getFullYear(),m,1));
    }else{
      const dates=periodOrders.map(o=>new Date(o.date)).sort((a,b)=>a-b);
      const first=dates[0]||now;let d=new Date(first.getFullYear(),first.getMonth(),1);const last=new Date(now.getFullYear(),now.getMonth(),1);
      while(d<=last&&months.length<36){months.push(new Date(d));d.setMonth(d.getMonth()+1);}
    }
    for(const d of months){
      const subset=periodOrders.filter(o=>{const od=new Date(o.date);return od.getFullYear()===d.getFullYear()&&od.getMonth()===d.getMonth();});
      points.push({y:subset.reduce((a,o)=>a+(Number(o.total)||0),0),label:d.toLocaleDateString("es-AR",{month:"long",year:"numeric"})});
      labels.push(d.toLocaleDateString("es-AR",{month:"short"}));
    }
  }else{
    const {start}=analyticsRangeBounds(analyticsRange);
    let d=new Date(start);d.setHours(0,0,0,0);const today=new Date();today.setHours(0,0,0,0);
    while(d<=today&&points.length<62){
      const key=todayKey(d.toISOString()),subset=periodOrders.filter(o=>todayKey(o.date)===key);
      points.push({y:subset.reduce((a,o)=>a+(Number(o.total)||0),0),label:d.toLocaleDateString("es-AR")});
      labels.push(`${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`);
      d.setDate(d.getDate()+1);
    }
  }
  return {points,labels};
}
function renderAnalytics(){
  if(session?.role!=="admin")return;
  const allValid=validAnalyticsOrders(orders);
  const mine=filterOrdersByAnalyticsRange(allValid);
  const {previousStart,previousEnd}=analyticsRangeBounds(analyticsRange);
  const previous=analyticsRange==="all"||!previousStart?[]:allValid.filter(o=>{const d=new Date(o.date);return d>=previousStart&&d<=previousEnd;});

  const revenue=mine.reduce((a,o)=>a+(Number(o.total)||0),0);
  const units=mine.reduce((a,o)=>a+(o.items||[]).reduce((x,i)=>x+(Number(i.qty)||0),0),0);
  const ticket=mine.length?revenue/mine.length:0;
  const pending=mine.filter(o=>["pendiente","preparado"].includes(String(o.status||"").toLowerCase())).length;
  const prevRevenue=previous.reduce((a,o)=>a+(Number(o.total)||0),0);
  const prevOrders=previous.length;
  const prevUnits=previous.reduce((a,o)=>a+(o.items||[]).reduce((x,i)=>x+(Number(i.qty)||0),0),0);
  const productRows=analyticsProductRows(mine);
  const recipeCost=productRows.reduce((a,r)=>a+r.cost,0);
  const costDataComplete=productRows.length>0 && productRows.every(r=>r.costComplete);
  const estimatedProfit=costDataComplete?revenue-recipeCost:null;

  const kpis=$("analytics-kpis");
  if(kpis)kpis.innerHTML=
    `<article class="analytics-kpi"><span>Facturación</span><strong>${money(revenue)}</strong>${analyticsRange!=="all"?variationHtml(revenue,prevRevenue):"<small>Histórico completo</small>"}</article>`+
    `<article class="analytics-kpi"><span>Ganancia estimada*</span><strong>${revenue===0?money(0):(costDataComplete?money(estimatedProfit):"Datos incompletos")}</strong><small>${costDataComplete?"Venta − costo de recetas registradas":"Faltan costos o recetas en productos vendidos"}</small></article>`+
    `<article class="analytics-kpi"><span>Pedidos</span><strong>${mine.length}</strong>${analyticsRange!=="all"?variationHtml(mine.length,prevOrders):"<small>Total histórico</small>"}</article>`+
    `<article class="analytics-kpi"><span>Ticket promedio</span><strong>${money(ticket)}</strong><small>Promedio por pedido</small></article>`+
    `<article class="analytics-kpi"><span>Unidades</span><strong>${units}</strong>${analyticsRange!=="all"?variationHtml(units,prevUnits):"<small>Unidades vendidas</small>"}</article>`+
    `<article class="analytics-kpi"><span>Pendientes</span><strong>${pending}</strong><small>Pedidos por preparar/entregar</small></article>`;

  const timeline=analyticsTimeline(mine);
  renderAnalyticsLineChart("sales-chart",timeline.points,timeline.labels,{currency:true});
  const caption=$("sales-chart-caption");if(caption)caption.textContent=`Facturación · ${analyticsRangeLabel()}`;
  renderWeeklyTimeChart(mine);

  const payment=new Map(),statuses=new Map();
  mine.forEach(o=>{const pay=o.payment||"Sin especificar";payment.set(pay,(payment.get(pay)||0)+(Number(o.total)||0));const st=o.status||"Pendiente";statuses.set(st,(statuses.get(st)||0)+1);});
  const best=productRows[0];
  const customerRows=analyticsCustomerRows(mine,allValid);
  const recurring=customerRows.filter(c=>c.recurrent).length;
  const events=Array.isArray(window.cubicaAnalyticsEvents)?window.cubicaAnalyticsEvents:[];
  const periodEvents=events.filter(e=>{if(analyticsRange==="all")return true;const {start,end}=analyticsRangeBounds();const d=new Date(e.created_at||e.date);return d>=start&&d<=end;});
  const sessions=new Set(periodEvents.filter(e=>e.event_name==="page_view").map(e=>e.session_id).filter(Boolean)).size;
  const productViews=periodEvents.filter(e=>e.event_name==="product_view").length;
  const adds=periodEvents.filter(e=>e.event_name==="add_to_cart").length;
  const purchases=periodEvents.filter(e=>e.event_name==="purchase").length;

  const summary=$("analytics-summary-cards");
  if(summary)summary.innerHTML=`
    <article class="analytics-mini-card"><span>Producto líder</span><strong>${best?escapeHtml(best.name):"Sin ventas"}</strong><small>${best?`${best.units} u. · ${money(best.revenue)}`:"Todavía no hay datos en el período."}</small></article>
    <article class="analytics-mini-card"><span>Clientes recurrentes</span><strong>${recurring}</strong><small>${customerRows.length?Math.round(recurring/customerRows.length*100):0}% de los clientes del período</small></article>
    <article class="analytics-mini-card funnel-card"><span>Embudo de tienda</span><strong>${sessions||"—"} visitas → ${productViews||"—"} vistas → ${adds||"—"} carritos → ${purchases||"—"} compras</strong><small>${events.length?"Datos de navegación registrados en Supabase.":"Se activará cuando ejecutes el SQL de analítica."}</small></article>
    <article class="analytics-mini-card"><span>Margen de receta*</span><strong>${revenue===0?"—":costDataComplete?((estimatedProfit/revenue)*100).toFixed(1)+"%":"Sin costo suficiente"}</strong><small>${costDataComplete?"*Estimación según los insumos/recetas cargados; no incluye costos no registrados.":"Completá la receta y los costos de los productos vendidos para calcularlo."}</small></article>`;

  const salesBox=$("analytics-sales-breakdown");
  if(salesBox){
    const paymentCards=[...payment.entries()].sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<article class="analytics-detail-card"><span>${escapeHtml(k)}</span><strong>${money(v)}</strong><small>${revenue?((v/revenue)*100).toFixed(1):0}% de la facturación</small></article>`).join("");
    const statusCards=[...statuses.entries()].map(([k,v])=>`<article class="analytics-detail-card"><span>Estado · ${escapeHtml(k)}</span><strong>${v}</strong><small>pedidos</small></article>`).join("");
    salesBox.innerHTML=paymentCards+statusCards+`<article class="analytics-detail-card emphasis"><span>Período</span><strong>${analyticsRangeLabel()}</strong><small>${mine.length} pedidos · ${units} unidades</small></article>`;
  }

  const productsBox=$("analytics-products-table");
  if(productsBox)productsBox.innerHTML=`<table><thead><tr><th>Producto</th><th>Unidades</th><th>Pedidos</th><th>Facturación</th><th>Costo receta*</th><th>Ganancia est.*</th><th>Margen est.</th></tr></thead><tbody>${productRows.length?productRows.map(r=>`<tr><td><strong>${escapeHtml(r.name)}</strong></td><td>${r.units}</td><td>${r.orders}</td><td>${money(r.revenue)}</td><td>${r.costComplete?money(r.cost):'<span class="muted">Sin datos</span>'}</td><td>${r.costComplete?money(r.profit):'<span class="muted">Sin datos</span>'}</td><td>${r.costComplete&&r.margin!==null?r.margin.toFixed(1)+"%":'<span class="muted">Sin datos</span>'}</td></tr>`).join(""):`<tr><td colspan="7" class="empty-table">No hay ventas en este período.</td></tr>`}</tbody></table>`;

  const customersBox=$("analytics-customers-table");
  if(customersBox)customersBox.innerHTML=`<table><thead><tr><th>Cliente</th><th>Pedidos</th><th>Gasto</th><th>Ticket prom.</th><th>Tipo</th><th>Última compra</th></tr></thead><tbody>${customerRows.length?customerRows.map(c=>`<tr><td><strong>${escapeHtml(c.name)}</strong><small class="analytics-cell-sub">${escapeHtml(c.email)}</small></td><td>${c.orders}</td><td>${money(c.revenue)}</td><td>${money(c.ticket)}</td><td><span class="analytics-pill ${c.recurrent?"good":""}">${c.recurrent?"Recurrente":"Nuevo"}</span></td><td>${formatDate(c.last)}</td></tr>`).join(""):`<tr><td colspan="6" class="empty-table">No hay clientes en este período.</td></tr>`}</tbody></table>`;

  const production=$("analytics-production-grid");
  if(production){
    const capacities=products.map(p=>({p,cap:productCapacity(p.recipe)})).filter(x=>x.cap.capacity!==null).sort((a,b)=>a.cap.capacity-b.cap.capacity);
    const consumed=analyticsSupplyConsumption(productRows).slice(0,8);
    const noSales=products.filter(p=>!productRows.some(r=>String(r.id)===String(p.id))).length;
    production.innerHTML=`
      <article class="analytics-section-card span-2"><div class="analytics-card-head"><div><h3>Capacidad actual por insumos</h3><p class="muted">Productos con menor capacidad primero.</p></div></div><div class="production-list">${capacities.length?capacities.slice(0,10).map(x=>`<div><span><strong>${escapeHtml(x.p.name)}</strong><small>${x.cap.bottlenecks.length?`Limita: ${escapeHtml(x.cap.bottlenecks.join(", "))}`:"Receta completa"}</small></span><b class="${x.cap.capacity<=2?"danger":x.cap.capacity<=5?"warn":""}">${x.cap.capacity} u.</b></div>`).join(""):'<p class="muted">Todavía no hay recetas cargadas.</p>'}</div></article>
      <article class="analytics-section-card"><div class="analytics-card-head"><div><h3>Insumos más consumidos</h3><p class="muted">${analyticsRangeLabel()}</p></div></div><div class="ranking-list">${consumed.length?consumed.map((x,i)=>`<div><span><b>#${i+1}</b> ${escapeHtml(x.name)}</span><strong>${Number(x.qty).toFixed(2)} ${escapeHtml(supplyUnitLabel(x.unit,x.qty))} <small>· ${money(x.cost)}</small></strong></div>`).join(""):'<p class="muted">Sin consumo calculable.</p>'}</div></article>
      <article class="analytics-section-card"><div class="analytics-card-head"><div><h3>Inventario</h3></div></div><div class="analytics-stat-stack"><div><span>Valor de insumos</span><strong>${money(supplies.reduce((a,x)=>a+supplyCostForQty(x,x.qty),0))}</strong></div><div><span>Productos sin ventas</span><strong>${noSales}</strong></div><div><span>Productos sin receta</span><strong>${products.filter(p=>!p.recipe?.length).length}</strong></div></div></article>`;
  }

  document.querySelectorAll(".analytics-panel").forEach(p=>p.classList.toggle("hidden",p.id!==`analytics-panel-${analyticsView}`));
  document.querySelectorAll("[data-analytics-view]").forEach(b=>b.classList.toggle("active",b.dataset.analyticsView===analyticsView));
  document.querySelectorAll("[data-analytics-range]").forEach(b=>b.classList.toggle("active",b.dataset.analyticsRange===analyticsRange));
}
