/* Explicit administrative actions; every mutation is version checked by PostgreSQL. */
(function(){
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const allowed=()=>session?.role==='admin'&&window.cubicaAdminMfaAccessAllowed?.()===true;
  const rpc=async(name,args={})=>{if(!allowed())throw Error('Sesión administrativa AAL2 requerida.');const {data,error}=await window.cubicaSupabase.rpc(name,args);if(error)throw error;return data;};
  const input=(name,label,v='',type='text')=>`<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(v)}" maxlength="300" ${type==='number'?'min="0.01" step="0.01"':''}></label>`;
  const read=(f,k)=>f.querySelector(`[name="${k}"]`)?.value.trim()||'';
  const check=(f,k)=>f.querySelector(`[name="${k}"]`)?.checked===true;
  const button=(action,label)=>`<button type="button" class="btn secondary" data-action="${action}">${label}</button>`;
  let revision=0;
  async function settings(){
    const target=document.getElementById('delivery-admin-content');if(!target||!allowed())return;
    const generation=++revision;
    try{const data=await rpc('admin_checkout_settings');if(generation!==revision||!allowed())return;
      const s=data.settings,b=s.bank||{};
      target.innerHTML=`<h2>Compras: transferencia y entregas</h2><p>Los transportistas permanecen deshabilitados para pedidos nuevos. Su configuración histórica se conserva.</p><form data-bank><h3>Datos bancarios</h3><p>Al aprobar, estos datos se mostrarán a clientes. Verificá su titularidad y exactitud antes de habilitar compras.</p><div class="commercial-grid">${input('cbu','CBU (22 dígitos)',b.cbu)}${input('holder','Titular',b.holder)}${input('bank','Banco',b.bank)}${input('alias','Alias (opcional)',b.alias)}${input('contact','Canal de contacto público',s.contact)}</div><label><input type="checkbox" name="approved" ${s.approved?'checked':''}> Datos bancarios revisados y aprobados para publicación</label><label><input type="checkbox" name="uber_enabled" ${s.uber_enabled?'checked':''}> Habilitar solicitudes Uber sujetas a revisión manual (solo después de la QA)</label><button type="submit" class="btn primary">Guardar configuración de compra</button><p role="status" data-status></p></form><h3>Puntos de retiro</h3><div data-points></div><button type="button" class="btn secondary" data-new>Crear punto deshabilitado</button>`;
      const form=target.querySelector('[data-bank]');
      form.onsubmit=event=>{event.preventDefault();if(!confirm('¿Guardar esta configuración? Los datos aprobados y las modalidades habilitadas serán visibles para compradores.'))return;mutate(form,()=>rpc('admin_save_checkout_settings',{p_expected_version:s.version,p_bank:Object.fromEntries(['cbu','holder','bank','alias'].map(k=>[k,read(form,k)])),p_contact:read(form,'contact'),p_approved:check(form,'approved'),p_uber_enabled:check(form,'uber_enabled')}),settings);};
      const points=target.querySelector('[data-points]');
      for(const p of data.points||[])pointEditor(points,p);
      target.querySelector('[data-new]').onclick=()=>pointEditor(points,{id:crypto.randomUUID(),version:0});
    }catch(error){if(allowed()&&generation===revision)target.textContent=error.message||'No se pudo cargar la configuración. No se modificó nada.';}
  }
  async function mutate(form,fn,refresh){
    if(form.dataset.busy==='true'||!allowed())return;form.dataset.busy='true';
    for(const b of form.querySelectorAll('button'))b.disabled=true;
    try{await fn();if(allowed())await refresh();}
    catch(error){const msg=form.querySelector('[data-status]');if(msg)msg.textContent=(error.code==='40001'?'La versión cambió.':error.message||'Respuesta no confirmada.')+' Recargá y verificá el estado antes de volver a guardar.';}
    finally{form.dataset.busy='false';for(const b of form.querySelectorAll('button'))b.disabled=false;}
  }
  function pointEditor(host,p){
    const form=document.createElement('form');form.className='commercial-panel card';
    form.innerHTML=`<h4>${esc(p.name||'Nuevo punto')}</h4>${input('name','Nombre público',p.name)}${['description','public_instructions','private_instructions'].map(k=>`<label>${{description:'Descripción pública',public_instructions:'Instrucciones públicas',private_instructions:'Ubicación / instrucciones privadas (solo se liberan expresamente al comprador)'}[k]}<textarea name="${k}" maxlength="${k==='description'?1000:1500}">${esc(p[k])}</textarea></label>`).join('')}<label><input type="checkbox" name="enabled" ${p.enabled?'checked':''}> Habilitado para retiro gratuito</label><button class="btn secondary" type="submit">Guardar punto</button><p role="status" data-status></p>`;
    host.appendChild(form);form.onsubmit=e=>{e.preventDefault();if(!confirm('¿Guardar el punto? Solo su información pública se mostrará si está habilitado.'))return;mutate(form,()=>rpc('admin_save_pickup_point',{p_id:p.id,p_expected_version:p.version,p_data:{...Object.fromEntries(['name','description','public_instructions','private_instructions'].map(k=>[k,read(form,k)])),enabled:check(form,'enabled')}}),settings);};
  }
  const delivery=window.cubicaDelivery,legacyOrder=delivery?.renderAdminOrder,legacyCustomer=delivery?.customerHtml;
  async function order(orderId,target){
    const owner=session?.supabaseUserId;if(!allowed()||!target)return;
    const stamp=crypto.randomUUID();target.dataset.commercialStamp=stamp;
    const current=()=>allowed()&&session?.supabaseUserId===owner&&target.isConnected!==false&&target.dataset.commercialStamp===stamp;
    try{const r=await rpc('get_checkout_receipt',{p_order_id:orderId,p_token:null});if(!current())return;
      if(!r){await legacyOrder?.(orderId,target);if(!current())return;const orderRecord=typeof orders!=='undefined'?orders.find(o=>o.id===orderId):null;if(orderRecord?.origin==='budget')budgetEditor(target,orderId,0);return;}
      const c=r.commercial,closed=r.order_status==='Cancelado',delivered=r.order_status==='Entregado',cfg=await rpc('admin_checkout_settings');if(!current())return;
      target.innerHTML=`<section class="commercial-panel">${window.cubicaCommercial.receiptHtml(r)}${r.admin_address?`<h4>Destino privado a verificar manualmente</h4><p>${Object.entries(r.admin_address).map(([k,v])=>`${esc(k)}: ${esc(v)}`).join('<br>')}</p>`:''}<p>Versión comercial: ${c.version}. Los pagos no modifican el estado de producción.</p><div data-controls>${closed?'<p>Pedido cerrado. No se admiten nuevas operaciones comerciales.</p>':`<div class="commercial-grid">${input('amount','Importe de esta operación ($)','','number')}${input('agreement','Acuerdo / evidencia de conformidad')}</div><div class="commercial-actions">${button('credit_products','Acreditar transferencia de productos')}${c.pickup_id&&!delivered?button('release_pickup','Comunicar ubicación privada al comprador'):''}</div>${r.delivery_mode==='uber'&&!delivered?`<label><input type="checkbox" name="caba_verified"> Verifiqué manualmente que el destino está dentro de CABA</label><label><input type="checkbox" name="compatible"> Verifiqué que el producto cumple las condiciones vigentes del servicio</label><div class="commercial-actions">${button('approve_uber','Aprobar solicitud Uber')}${button('reject_uber','Rechazar solicitud Uber')}${button('quote_uber','Registrar cotización (pedido preparado)')}${button('record_uber_acceptance','Registrar conformidad del cliente')}${button('credit_uber','Acreditar transferencia del traslado')}${button('dispatch_uber','Confirmar solicitud del traslado')}</div><label>Punto alternativo habilitado<select name="pickup_id"><option value="">Seleccionar</option>${(cfg.points||[]).filter(p=>p.enabled).map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label>${button('switch_pickup','Coordinar retiro en este mismo pedido')}`:''}`}</div><p role="status" data-status></p><button type="button" class="btn ghost" data-reload>Volver a leer estado</button></section>`;
      const panel=target.firstElementChild;panel.querySelector('[data-reload]').onclick=()=>order(orderId,target);
      for(const b of panel.querySelectorAll('[data-action]'))b.onclick=()=>{
        if(!current())return;
        const action=b.dataset.action;
        if(!confirm(`${b.textContent}. ¿Confirmás esta operación?${action==='release_pickup'?' La ubicación privada quedará disponible para el titular del comprobante.':''}${action==='dispatch_uber'?' Registrá esta acción al solicitar el traslado manualmente; el sitio no contrata Uber.':''}`))return;
        mutate(panel,()=>rpc('admin_checkout_order_action',{p_order_id:orderId,p_expected_version:c.version,p_action:action,p_data:{amount:read(panel,'amount')||null,agreement:read(panel,'agreement'),pickup_id:read(panel,'pickup_id')||null,caba_verified:check(panel,'caba_verified'),compatible:check(panel,'compatible')}}),()=>order(orderId,target));
      };
      if(r.origin==='budget'&&!closed&&!delivered)budgetEditor(target,orderId,c.version,c);
    }catch(error){if(current())target.textContent=error.message||'No se pudo leer el estado comercial. No se modificó el pedido.';}
  }
  function budgetEditor(target,id,version,c={}){
    const form=document.createElement('form');form.className='commercial-panel';form.innerHTML=`<h3>Acuerdo de presupuesto</h3><p>Conservá las condiciones del presupuesto convertido. La seña nunca se aplica automáticamente.</p>${input('agreement','Acuerdo explícito con el cliente',c.agreement)}<label><input type="checkbox" name="deposit" ${c.deposit_percent===50?'checked':''}> Se acordó expresamente una seña del 50%</label><button type="submit" class="btn secondary">Registrar acuerdo</button><p role="status" data-status></p>`;target.appendChild(form);
    form.onsubmit=e=>{e.preventDefault();if(!confirm('¿Registrar el acuerdo manual de este presupuesto? No acredita ningún pago.'))return;mutate(form,()=>rpc('admin_checkout_order_action',{p_order_id:id,p_expected_version:version,p_action:'budget_agreement',p_data:{agreement:read(form,'agreement'),deposit_percent:check(form,'deposit')?50:null}}),()=>order(id,target));};
  }
  if(delivery){delivery.loadAdmin=settings;delivery.renderAdminOrder=order;delivery.customerHtml=d=>d?.mode==='uber'?'<p>Solicitud Uber: consultá el comprobante para conocer la aprobación, la cotización vigente y los pagos del traslado. Coordinación manual con Cúbica.</p>':legacyCustomer?.(d)||'';}
  window.addEventListener('cubica:auth-ready',()=>{revision++;if(!allowed())for(const id of ['delivery-admin-content','order-delivery-panel']){const node=document.getElementById(id);if(node)node.textContent='';}});
  window.cubicaCommercialAdmin={settings,order};
})();
