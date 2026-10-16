/* Gestión administrativa. Las cantidades de materiales siempre vienen del backend. */
(function(){
  const states=["Pendiente","Confirmado","En producción","Preparado","Entregado"];
  let current=null,busy=false,opening=0;
  const number=value=>new Intl.NumberFormat("es-AR",{maximumFractionDigits:4}).format(Number(value)||0);
  const e=escapeHtml;
  const movementReason=reason=>({
    production:"Inicio de producción",
    cancelled_finished:"Pieza cancelada terminada al stock",
    checkout_reserved:"Reserva de stock para pedido",
    checkout_restocked:"Reposición por cancelación previa a producción",
    manual_supply:"Ajuste manual de insumos",
    manual_finished:"Ajuste manual de productos terminados"
  })[reason]||"Movimiento de inventario";
  const adminAccessAllowed=()=>session?.role==="admin"&&window.cubicaAdminMfaAccessAllowed?.()===true;

  function planHtml(plan){
    const missing=(plan.products||[]).filter(p=>p.recipe_missing);
    return `${missing.map(p=>`<p class="order-warning"><strong>${e(p.name)} × ${number(p.qty)}</strong><br>Receta no cargada. No es posible calcular automáticamente los insumos necesarios para este producto.</p>`).join("")}
      <div class="table-wrap"><table class="order-material-table"><thead><tr><th>Insumo</th><th>Necesario</th><th>Disponible</th><th>Faltante</th></tr></thead><tbody>${(plan.supplies||[]).map(s=>`<tr><td>${e(s.name)}${s.inactive?" (inactivo)":""}<small>${e(s.unit)}</small></td><td>${number(s.required)}</td><td>${number(s.available)}</td><td class="${s.missing>0?"order-shortage":""}">${number(s.missing)}</td></tr>`).join("")||'<tr><td colspan="4">Sin insumos calculables.</td></tr>'}</tbody></table></div>`;
  }

  function render(){
    if(!current||!adminAccessAllowed())return;
    const {order:o,items,consumption,history,movements}=current;
    const closed=["Entregado","Cancelado"].includes(o.status);
    const index=states.indexOf(o.status);
    const choices=states.filter((s,i)=>i<=index+1);
    $("order-management-title").textContent=`Pedido ${o.order_number||o.id}`;
    $("order-management-content").innerHTML=`
      <div class="order-management-summary"><strong class="order-status">${e(o.status)}</strong><strong>${money(o.total)}</strong></div>
      <p><strong>${e(o.customer_name)}</strong><br><span class="muted">${e(o.customer_email)} · ${e(o.phone||"Teléfono no informado")}<br>Pago: ${e(o.payment)}</span></p>
      <p class="order-notes">${e(o.notes||"Sin observaciones")}</p>
      <div id="order-delivery-panel"></div><h3>Productos</h3><ul>${items.map(i=>`<li>${e(i.name)}${i.color?` · ${e(i.color)}`:""} × ${number(i.qty)}</li>`).join("")}</ul>
      <div class="order-consumption ${consumption?"recorded":""}"><strong>${consumption?"Consumo registrado una sola vez":"Materiales sin consumir"}</strong><br>${consumption?`${e(formatDate(consumption.created_at))}. Los cambios de estado y la cancelación no devuelven ni vuelven a descontar insumos.`:"Los insumos se descuentan al iniciar producción."}</div>
      <h3>${consumption?"Receta registrada al iniciar producción":"Plan de materiales"}</h3>
      <p class="muted">${consumption?"Disponible indica el stock previo al consumo. Los faltantes autorizados quedan registrados; no representan materiales descontados." :"Calculado en Supabase para todas las unidades. Los insumos compartidos están sumados."}</p>
      ${planHtml(consumption?.plan||current.plan)}
      ${closed?"":`<h3>Cambiar estado</h3><div class="order-state-controls"><label for="order-next-status">Estado interno</label><select id="order-next-status">${choices.map(s=>`<option ${s===o.status?"selected":""}>${e(s)}</option>`).join("")}<option>Cancelado</option></select><button id="order-status-save" class="btn primary">Guardar estado</button></div>
      <div id="order-cancellation" class="hidden"><h3>Cancelar pedido</h3><p class="order-warning">Los insumos consumidos no se devuelven. Elegí explícitamente qué piezas están terminadas. Solo las piezas estándar reutilizables se incorporarán al stock comercial.</p>${items.map(i=>`<div class="order-cancel-item"><strong>${e(i.name)} · ${number(i.qty)} unidades</strong><label>Destino<select data-cancel-item="${i.id}"><option value="unfinished">Sin pieza terminada · no agregar stock</option>${o.production_started_at||o.status==="Preparado"?'<option value="finished_standard">Terminada y estándar reutilizable · agregar stock</option><option value="finished_personalized">Terminada y personalizada · no agregar stock</option>':""}</select></label><label>Cantidad terminada<input type="number" data-cancel-qty="${i.id}" min="0" max="${i.qty}" step="1" value="0" disabled></label></div>`).join("")}</div>`}
      <div id="order-production-confirm" class="hidden"></div>
      <p id="order-management-message" role="status" aria-live="polite"></p>
      <details><summary>Historial de estados (${history.length})</summary>${history.map(h=>`<p>${e(h.from_status)} → <strong>${e(h.to_status)}</strong><br><span class="muted">${e(formatDate(h.created_at))}</span>${h.cancellation?`<br>${h.cancellation.map(c=>{const item=items.find(i=>String(i.id)===String(c.item_id));return `${e(item?.name||"Producto")}: ${c.disposition==="finished_standard"?"estándar al stock":c.disposition==="finished_personalized"?"personalizada sin stock":"sin pieza terminada"} (${number(c.qty)})`;}).join("<br>")}`:""}</p>`).join("")||'<p class="muted">Sin transiciones registradas. Los pedidos anteriores conservan su estado original.</p>'}</details>
      <details><summary>Movimientos del pedido (${movements.length})</summary>${movements.map(m=>`<p><strong>${e(m.name)}</strong>: ${m.delta>0?"+":""}${number(m.delta)} ${e(m.unit)}<br><span class="muted">${e(movementReason(m.reason))} · ${e(formatDate(m.created_at))}</span>${m.deficit>0?`<br><span class="order-shortage">Necesario ${number(m.required)} · Faltante ${number(m.deficit)} ${e(m.unit)}</span>`:""}</p>`).join("")||'<p class="muted">Sin movimientos de inventario para este pedido.</p>'}</details>`;
    window.cubicaDelivery?.renderAdminOrder(o.id,$("order-delivery-panel"));
    $("order-next-status")?.addEventListener("change",()=>{
      $("order-cancellation").classList.toggle("hidden",$("order-next-status").value!=="Cancelado");
      $("order-production-confirm").classList.add("hidden");
    });
    $("order-status-save")?.addEventListener("click",()=>saveStatus(false));
    for(const select of document.querySelectorAll("[data-cancel-item]"))select.addEventListener("change",()=>{
      const input=document.querySelector(`[data-cancel-qty="${select.dataset.cancelItem}"]`);
      input.disabled=select.value==="unfinished";
      input.value=input.disabled?0:input.max;
    });
  }

  window.openOrderManagement=async id=>{
    if(!adminAccessAllowed()||busy)return;
    const generation=++opening;
    try{
      await window.flushCubicaCatalog?.();
      await window.flushCubicaInventory?.();
      const {data,error}=await window.cubicaSupabase.rpc("get_order_management",{p_order_id:id});
      if(error)throw error;
      if(generation!==opening||!adminAccessAllowed())return;
      current=data;render();openModal("order-management-modal");
    }catch(error){toast(error.message||"No se pudo cargar el pedido.");}
  };

  async function saveStatus(accept){
    if(busy||!current||!adminAccessAllowed())return;
    const next=$("order-next-status").value;
    const cancellation=next==="Cancelado"?current.items.map(i=>({item_id:i.id,
      disposition:document.querySelector(`[data-cancel-item="${i.id}"]`).value,
      qty:Number(document.querySelector(`[data-cancel-qty="${i.id}"]`).value)})):[];
    busy=true;
    for(const control of $("order-management-content").querySelectorAll("button,select,input"))control.disabled=true;
    $("order-management-message").textContent="Guardando…";
    try{
      const {data,error}=await window.cubicaSupabase.rpc("change_order_status",{
        p_order_id:current.order.id,p_status:next,p_expected_version:current.order.lifecycle_version,
        p_accept_warnings:accept,p_plan_fingerprint:accept?current.fingerprint:null,p_cancellation:cancellation,
      });
      if(error)throw error;
      if(data.confirmation_required){
        current.plan=data.plan;current.fingerprint=data.fingerprint;
        const block=$("order-production-confirm");
        block.innerHTML=`<h3>Revisá antes de iniciar producción</h3>${planHtml(data.plan)}<p class="order-warning">Hay faltantes, insumos inactivos o recetas ausentes. Se descontará el stock disponible hasta cero y se registrará el déficit. Las recetas ausentes no generan consumos.</p><div class="order-confirm-actions"><button id="production-dismiss" class="btn ghost">Cancelar</button><button id="production-accept" class="btn primary">Iniciar producción igualmente</button></div>`;
        block.classList.remove("hidden");
        $("production-dismiss").onclick=()=>{block.classList.add("hidden");$("order-management-message").textContent="Producción sin iniciar.";};
        $("production-accept").onclick=()=>saveStatus(true);
        $("order-management-message").textContent="El pedido sigue sin cambios. Confirmá para continuar.";
        block.scrollIntoView({block:"nearest",behavior:"smooth"});
      }else{
        current=data;render();
        // Refresh in order: catalog before recipes, so local snapshots cannot restore spent stock.
        await window.loadCubicaCatalogFromSupabase?.();
        await window.loadCubicaInventoryFromSupabase?.();
        await window.loadCubicaSalesFromSupabase?.({migrateLocal:false});
        toast(`Pedido actualizado: ${data.order.status}.`);
      }
    }catch(error){
      $("order-management-message").textContent=error.message||"No se pudo guardar. Actualizá el pedido antes de reintentar.";
    }finally{
      busy=false;
      for(const control of $("order-management-content").querySelectorAll("button,select,input"))control.disabled=false;
      for(const select of document.querySelectorAll("[data-cancel-item]"))document.querySelector(`[data-cancel-qty="${select.dataset.cancelItem}"]`).disabled=select.value==="unfinished";
    }
  }
  window.addEventListener("cubica:auth-ready",event=>{
    if(event.detail?.role!=="admin"){
      opening++;current=null;closeModal("order-management-modal");
      $("order-management-content").textContent="";
      closeModal("inventory-history-modal");
      $("inventory-history-content").textContent="";
    }
  });
  window.openInventoryHistory=async type=>{
    if(!adminAccessAllowed())return;
    try{
      const {data,error}=await window.cubicaSupabase.from("inventory_movements").select("*")
        .not(type==="supplies"?"supply_id":"product_id","is",null).order("id",{ascending:false}).limit(200);
      if(error)throw error;
      if(!adminAccessAllowed())return;
      $("inventory-history-title").textContent=type==="supplies"?"Movimientos de insumos":"Movimientos de productos terminados";
      $("inventory-history-content").innerHTML=`<p class="muted">Últimos 200 movimientos. Historial registrado desde la activación de este bloque.</p>${(data||[]).map(m=>`<article class="order-consumption"><strong>${e(m.name)} · ${m.delta>0?"+":""}${number(m.delta)} ${e(m.unit)}</strong><br>${e(m.order_number||"Inventario")} · ${e(movementReason(m.reason))}<br><span class="muted">${e(formatDate(m.created_at))} · ${number(m.quantity_before)} → ${number(m.quantity_after)}</span>${m.deficit>0?`<br><span class="order-shortage">Faltante: ${number(m.deficit)} ${e(m.unit)}</span>`:""}</article>`).join("")||"<p>Sin movimientos registrados.</p>"}`;
      openModal("inventory-history-modal");
    }catch(error){toast(error.message||"No se pudo cargar el historial.");}
  };
})();
