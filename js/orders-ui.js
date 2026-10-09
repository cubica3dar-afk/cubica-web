/* CÚBICA 3D — interfaz de pedidos y planificación de insumos. */

let salesPeriod="day";

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
