/* Commercial checkout. The server owns eligibility, prices, balances and permissions. */
(function(){
  const el=id=>document.getElementById(id), esc=value=>String(value??"").replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cash=value=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS'}).format(Number(value)||0);
  const identity=()=>typeof session==='undefined'?"guest":session?.supabaseUserId||"guest";
  const key=()=>`cubica_commercial_checkout_v1:${identity()}`;
  let options=null,busy=false,receipt=null,activeOwner=identity(),epoch=0,deferredDraft=null;
  const rpc=async(name,args={})=>{const result=await window.cubicaSupabase.rpc(name,args);if(result.error)throw result.error;return result.data;};
  const read=()=>{const raw=sessionStorage.getItem(key());if(!raw)return null;const value=JSON.parse(raw);if(value.owner!==identity())throw Error('La compra pertenece a otra sesión.');return value;};
  const save=value=>sessionStorage.setItem(key(),JSON.stringify({...value,owner:identity()}));
  const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
  const field=(name,label,value='',type='text')=>`<label>${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}" maxlength="200" ${type==='number'?'min="0.01" step="0.01"':''}></label>`;
  const value=(form,name)=>form.querySelector(`[name="${name}"]`)?.value.trim()||'';
  function message(text){if(el('commercial-message'))el('commercial-message').textContent=text;}
  function locked(yes){
    for(const node of el('checkout-form')?.querySelectorAll('input,select,textarea')||[])node.disabled=yes;
    if(el('checkout-confirm-btn')){el('checkout-confirm-btn').disabled=yes;el('checkout-confirm-btn').dataset.submitting=yes?'true':'';}
  }
  function receiptHtml(r){
    const c=r.commercial,bank=r.options?.bank||{},cancelled=r.order_status==='Cancelado',pending=Number(c.products_total)-Number(c.products_credited);
    const uber={pending_review:'Solicitud Uber pendiente de aprobación administrativa. Todavía no está confirmada.',approved:'Destino y producto aprobados para coordinar Uber.',rejected:'Destino o producto no apto para Uber. Coordiná un punto de retiro habilitado.',dispatched:'Traslado solicitado por Cúbica.'};
    return `<h2>Pedido ${cancelled?'cancelado':'recibido'} · ${esc(r.order_number)}</h2>${cancelled?'<p role="alert">No transfieras para este pedido cancelado. Coordiná con Cúbica cualquier pago anterior.</p>':'<p>Crear un pedido no acredita su pago.</p>'}<ul>${(r.items||[]).map(i=>`<li>${esc(i.name)}${i.color?` · ${esc(i.color)}`:''} × ${Number(i.qty)} · ${cash(Number(i.qty)*Number(i.price))}</li>`).join('')}</ul><p><strong>Total de productos: ${cash(c.products_total)}</strong><br>Transferencia acreditada por Cúbica: ${cash(c.products_credited)}<br><strong>${pending>0?'Pendiente de acreditación: '+cash(pending):'Productos abonados'}</strong>${c.transfer_reported?'<br>Transferencia informada; pendiente de verificación.':''}</p>${c.deposit_percent===50?`<p>Seña acordada: ${cash(Number(c.products_total)/2)}. Saldo del acuerdo: ${cash(Number(c.products_total)/2)}. ${esc(c.agreement)}</p>`:''}${r.delivery_mode==='uber'?`<p>${esc(uber[c.uber_status])}</p><p><strong>${c.uber_quote==null?'Costo de envío pendiente de cotización':'Cotización Uber: '+cash(c.uber_quote)}</strong><br>Se cotiza manualmente cuando el producto está listo. El traslado se paga por adelantado, por separado de los productos.<br>Acreditado para Uber: ${cash(c.uber_credited)}${c.uber_quote!=null?`<br>Pendiente de acreditar para el traslado: ${cash(Math.max(0,Number(c.uber_quote)-Number(c.uber_credited)))}`:''}${c.uber_quote!=null?`<br>${c.accepted_quote_version===c.quote_version?'Cotización aceptada.':'Falta aceptar la cotización vigente.'}`:''}</p>`:r.delivery_mode==='pickup'?`<p>Retiro gratuito: ${esc(c.pickup_public?.name)}<br>${esc(c.pickup_public?.description)}<br>${esc(c.pickup_public?.instructions)}<br>Día y horario a coordinar.</p>${r.pickup_instructions?`<p class="commercial-private">Instrucciones privadas para este pedido: ${esc(r.pickup_instructions)}</p>`:'<p>La ubicación privada se comunica cuando Cúbica autoriza la coordinación.</p>'}`:''}${cancelled?'':bank.cbu?`<p>Transferencia · Banco: ${esc(bank.bank)}<br>Titular: ${esc(bank.holder)}<br>CBU: <strong>${esc(bank.cbu)}</strong>${bank.alias?`<br>Alias: ${esc(bank.alias)}`:''}</p>`:'<p>Consultá a Cúbica antes de transferir: los datos bancarios no están disponibles.</p>'}${r.options?.contact?`<p>Contacto para pagos y coordinación: ${esc(r.options.contact)}</p>`:''}`;
  }
  function showReceipt(r){
    receipt=r;const box=el('commercial-receipt');if(!box)return;
    box.hidden=false;box.innerHTML=receiptHtml(r)+`<div class="commercial-actions"><button type="button" class="btn secondary" data-copy>Copiar número</button><button type="button" class="btn ghost" data-refresh>Actualizar estado</button>${r.order_status!=='Cancelado'&&r.commercial.products_credited<r.commercial.products_total&&!r.commercial.transfer_reported?'<button type="button" class="btn secondary" data-action="report_transfer">Informar transferencia realizada</button>':''}${!['Cancelado','Entregado'].includes(r.order_status)&&r.delivery_mode==='uber'&&r.commercial.uber_status==='approved'&&r.commercial.uber_quote!=null&&r.commercial.accepted_quote_version!==r.commercial.quote_version?'<button type="button" class="btn secondary" data-action="accept_uber_quote">Aceptar cotización Uber</button>':''}<button type="button" class="btn ghost" data-new>Iniciar otra compra</button></div><p role="status" data-status></p><p class="muted">Este comprobante se conserva en esta pestaña. Guardá el número del pedido; no compartas el acceso privado.</p>`;
    el('checkout-layout').hidden=true;el('commercial-recovery').hidden=true;
    box.querySelector('[data-copy]').onclick=async()=>{try{await navigator.clipboard.writeText(String(r.order_number));}catch{box.querySelector('[data-status]').textContent='Seleccioná y copiá el número mostrado arriba.';}};
    box.querySelector('[data-refresh]').onclick=recover;
    box.querySelector('[data-new]').onclick=()=>{if(!confirm('El pedido recibido seguirá existiendo. ¿Querés iniciar otra compra?'))return;sessionStorage.removeItem(key());receipt=null;box.hidden=true;el('checkout-layout').hidden=false;locked(false);message('');};
    for(const button of box.querySelectorAll('[data-action]'))button.onclick=()=>customerAction(button.dataset.action);
  }
  async function customerAction(action){
    if(busy||!receipt)return;
    if(!confirm(action==='report_transfer'?'¿Informar que realizaste la transferencia? Cúbica debe verificar la acreditación.':`¿Aceptar la cotización de Uber de ${cash(receipt.commercial.uber_quote)}? Si cambia el precio, deberás aceptarlo nuevamente.`))return;
    busy=true;const owner=identity(),version=epoch;
    try{const p=read(),r=await rpc('checkout_customer_action',{p_order_id:receipt.order_id,p_token:p.token,p_action:action,p_expected_version:receipt.commercial.version});if(owner===identity()&&version===epoch)showReceipt(r);}
    catch{if(owner===identity())el('commercial-receipt').querySelector('[data-status]').textContent='No se confirmó la respuesta. Actualizá el estado antes de volver a realizar la acción.';}
    finally{busy=false;}
  }
  function recovery(text){
    locked(true);const box=el('commercial-recovery');if(!box)return;
    box.hidden=false;box.innerHTML=`<p role="status">${esc(text)}</p><p>Los datos del intento quedan protegidos. Consultá su resultado antes de iniciar otro pedido.</p><button type="button" class="btn secondary" data-recover>Consultar resultado</button><button type="button" class="btn ghost" data-retry>Reintentar el mismo pedido</button>`;
    box.querySelector('[data-recover]').onclick=recover;box.querySelector('[data-retry]').onclick=submit;
  }
  // At-most-one local attempt, not a payment event or server delivery guarantee.
  async function trackPurchase(r,p){
    if(!p.payload||!r.order_id||typeof window.cubicaTrackEvent!=='function')return;
    const owner=identity(),version=epoch,marker='cubica_purchase_attempt_v1:'+r.order_id;
    const send=()=>{
      if(owner!==identity()||version!==epoch||session?.role==='admin')return;
      try{
        const store=typeof localStorage==='undefined'?sessionStorage:localStorage;
        if(store.getItem(marker))return;
        // Mark BEFORE sending: ambiguous analytics responses must not be retried.
        store.setItem(marker,'1');
        Promise.resolve(window.cubicaTrackEvent('purchase',null,{
          order_number:r.order_number,total:Number(r.commercial.products_total),
          units:(r.items||[]).reduce((sum,item)=>sum+Number(item.qty),0)
        })).catch(()=>{});
      }catch{/* Analytics/storage failure never changes the commercial outcome. */}
    };
    try{if(navigator.locks?.request)await navigator.locks.request(marker,send);else send();}catch{}
  }
  async function confirmed(r,p){
    // Persist receipt access BEFORE clearing the cart. Storage failure remains recoverable.
    save({order_id:r.order_id,request_id:p.request_id,token:p.token,cart:p.cart});
    const old=p.cart||[];
    if(JSON.stringify(cart)===JSON.stringify(old)){cart=[];writeLocal(STORAGE.cart,cart);renderCart();}
    save({order_id:r.order_id,request_id:p.request_id,token:p.token});
    sessionStorage.removeItem('cubica_checkout_draft_v1');
    window.cubicaTurnstile?.complete();showReceipt(r);
    await trackPurchase(r,p);
    // Refresh read-only projections; receipt success must not depend on their availability.
    const refresh=typeof session!=='undefined'&&session?.role==='admin'?window.loadCubicaSalesFromSupabase:window.loadCubicaCustomerOrdersFromSupabase;
    if(refresh)Promise.resolve(refresh()).catch(()=>{});
    if(window.loadCubicaCatalogFromSupabase)Promise.resolve(window.loadCubicaCatalogFromSupabase()).catch(()=>{});
  }
  async function openReceipt(orderId){
    if(busy||identity()==='guest')return;
    const owner=identity(),version=epoch;
    try{
      const pending=read();if(pending?.payload){showSection('checkout');await recover();return;}
      busy=true;const r=await rpc('get_checkout_receipt',{p_order_id:orderId,p_token:null});
      if(owner!==identity()||version!==epoch)return;
      if(!r)throw Error('Este pedido conserva su seguimiento histórico.');
      save({order_id:r.order_id,token:null});showSection('checkout');showReceipt(r);
    }catch(error){if(owner===identity()&&typeof toast==='function')toast(error.message||'No se pudo cargar el comprobante.');}
    finally{busy=false;}
  }
  async function lookup(p){
    return p.order_id?rpc('get_checkout_receipt',{p_order_id:p.order_id,p_token:p.token}):rpc('reconcile_checkout',{p_request_id:p.request_id,p_token:p.token});
  }
  async function recover(){
    if(busy)return;busy=true;const owner=identity(),version=epoch;
    try{const p=read();if(!p)return;const r=await lookup(p);if(owner!==identity()||version!==epoch)return;
      if(r)await confirmed(r,p);else recovery('Todavía no hay un pedido confirmado para este intento. Podés reintentar conservando exactamente su identidad y datos.');
    }catch{if(owner===identity())recovery('No pudimos consultar el pedido. Conservamos el intento; no lo repitas como una compra nueva.');}
    finally{busy=false;}
  }
  function buildPayload(){
    window.cubicaValidateCheckout();
    if(!options?.ready)throw Error('La compra todavía no está habilitada: faltan datos de transferencia aprobados.');
    const name=window.cubicaCheckoutBuyerName(),email=el('customer-email').value.trim(),phone=el('customer-phone').value.trim();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!/^\d{8,15}$/.test(phone.replace(/\D/g,'')))throw Error('Completá email y teléfono válidos.');
    const form=el('commercial-fields'),mode=value(form,'mode'),request_id=crypto.randomUUID(),quote_token=token();
    const delivery={mode,request_id,quote_token};
    if(mode==='pickup'){
      delivery.pickup_id=value(form,'pickup_id');
      if(!options.pickup_points.some(p=>p.id===delivery.pickup_id))throw Error('Elegí un punto de retiro habilitado.');
    }else if(mode==='uber'){
      const total=cart.reduce((n,i)=>n+Number(products.find(p=>p.id===i.productId)?.price)*i.qty,0);
      if(!options.uber_enabled||!Number.isFinite(total)||total>20000)throw Error('Uber solo admite solicitudes de hasta $20.000 en productos.');
      delivery.address=Object.fromEntries(['street','number','neighborhood','city','postal_code','floor','apartment','instructions'].map(k=>[k,value(form,k)]));
      if(['street','number','neighborhood','city','postal_code'].some(k=>!delivery.address[k]))throw Error('Completá calle, altura, barrio, localidad y código postal.');
      if(!/^([0-9]{4}|[A-Z][0-9]{4}[A-Z]{3})$/i.test(delivery.address.postal_code))throw Error('Ingresá un código postal argentino válido.');
      if(!form.querySelector('[name="caba"]').checked)throw Error('Uber solo admite destinos declarados en CABA; Cúbica debe verificarlos.');
      Object.assign(delivery.address,{province:'Ciudad Autónoma de Buenos Aires',recipient:name,phone});
    }else throw Error('Elegí una modalidad disponible.');
    return {client_order_id:request_id,customer_name:name,customer_email:email,phone,payment:'Transferencia',notes:el('customer-notes').value,items:cart.map(i=>({product_id:i.productId,qty:Number(i.qty),color:i.color||''})),delivery};
  }
  async function submit(event){
    event?.preventDefault?.();if(busy)return;
    busy=true;const owner=identity(),version=epoch;let p,sent=false;
    try{
      if(window.cubicaCheckoutAuthReady!==true)throw Error('Esperá la verificación de la sesión antes de confirmar.');
      p=read();
      if(p){const r=await lookup(p);if(owner!==identity()||version!==epoch)return;if(r){await confirmed(r,p);return;}if(!p.payload)throw Error('El pedido requiere revisión; no se reenviará.');}
      else {const payload=buildPayload();p={payload,request_id:payload.delivery.request_id,token:payload.delivery.quote_token,cart:JSON.parse(JSON.stringify(cart))};}
      if(!window.cubicaTurnstile?.enabled())throw Error('La verificación de seguridad no está configurada. No se envió el pedido.');
      const turnstile_token=await window.cubicaTurnstile.requireToken();
      if(owner!==identity()||version!==epoch)return;
      save(p);locked(true);sent=true;message('Enviando pedido…');
      const result=await window.cubicaTurnstile.createOrder({...p.payload,turnstile_token});
      if(owner!==identity()||version!==epoch)return;
      if(!result?.order_id)throw Error('Respuesta incompleta.');
      p.order_id=result.order_id;save(p);
      const r=await lookup(p);if(owner!==identity()||version!==epoch)return;if(!r)throw Error('Comprobante todavía no disponible.');await confirmed(r,p);
    }catch(error){
      if(owner!==identity()||version!==epoch)return;
      window.cubicaTurnstile?.handleFailure(error);
      // Only explicit rejections with no commercial transaction permit editing again.
      const rejected=['order_checkout_not_configured','order_delivery_disabled','order_pickup_unavailable','order_uber_ineligible','order_uber_address_required','order_transfer_required','order_invalid_phone','order_invalid_address','order_invalid_items','order_invalid_customer','invalid_order','invalid_items','invalid_delivery'];
      if(sent&&rejected.includes(error.code)){sessionStorage.removeItem(key());locked(false);message('El servidor rechazó el pedido sin registrarlo. Revisá la modalidad y los datos antes de volver a confirmar.');}
      else if(sent||p?.owner){recovery('El resultado aún no pudo confirmarse. Conservamos tu carrito y el mismo intento para evitar duplicados.');}
      else {locked(false);message(error.message||'No se envió el pedido. Revisá los datos.');}
    }finally{busy=false;}
  }
  async function loadOptions(){
    const owner=identity(),version=epoch;
    try{const data=await rpc('get_checkout_options');if(owner!==identity()||version!==epoch)return;options=data;renderOptions();}
    catch{if(owner===identity()&&version===epoch)message('No pudimos cargar las modalidades de compra. No confirmes hasta que vuelva la conexión.');}
  }
  function renderOptions(){
    const box=el('commercial-fields');if(!box||!options)return;
    const previous=deferredDraft||captureDraft();deferredDraft=null;
    const points=options.pickup_points||[];
    box.innerHTML=`<h3>Pago y entrega</h3><p>Productos: 100% por transferencia. El pedido queda pendiente de acreditación verificada por Cúbica.</p>${!options.ready?'<p role="alert">Compra pendiente de configuración bancaria aprobada.</p>':''}<label>Modalidad<select name="mode"><option value="">Elegí una opción</option>${points.length?'<option value="pickup">Retiro gratuito en punto habilitado</option>':''}${options.uber_enabled?'<option value="uber">Solicitar Uber · sujeto a aprobación</option>':''}</select></label>${!points.length?'<p>No hay puntos de retiro habilitados actualmente.</p>':''}<div data-pickup hidden><label>Punto de retiro<select name="pickup_id"><option value="">Seleccioná un punto</option>${points.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label><p data-point></p><p>Día y horario a coordinar. No se admiten otros lugares como retiro gratuito.</p></div><div data-uber hidden><p>Solicitud para productos hasta $20.000. Cúbica verificará manualmente el destino en CABA y la compatibilidad del producto. La entrega no está confirmada.</p><p><strong>Costo de envío pendiente de cotización.</strong> Cuando esté listo el producto se comunica la tarifa; se requiere conformidad y acreditación anticipada antes de solicitar Uber.</p><div class="commercial-grid">${[['street','Calle'],['number','Altura'],['neighborhood','Barrio'],['city','Localidad'],['postal_code','Código postal'],['floor','Piso (opcional)'],['apartment','Departamento (opcional)'],['instructions','Indicaciones (opcional)']].map(([k,l])=>field(k,l)).join('')}</div><label><input type="checkbox" name="caba"> Declaro que el destino está dentro de CABA. Queda sujeto a revisión de Cúbica.</label></div><p>Correo Argentino, Andreani y OCA no están disponibles para nuevas compras.</p>`;
    box.querySelector('[name="mode"]').onchange=()=>{box.querySelector('[data-pickup]').hidden=value(box,'mode')!=='pickup';box.querySelector('[data-uber]').hidden=value(box,'mode')!=='uber';updateTotal();};
    box.querySelector('[name="pickup_id"]').onchange=()=>{const p=points.find(p=>p.id===value(box,'pickup_id'));box.querySelector('[data-point]').textContent=[p?.description,p?.instructions].filter(Boolean).join(' · ');};
    applyDraft(previous);
    box.oninput=box.onchange=()=>window.cubicaCheckout?.saveDraft?.();
    updateTotal();
    try{if(read())locked(true);}catch{locked(true);message('No se puede leer el intento guardado. No confirmes otro pedido; conservá esta pestaña y contactá a Cúbica.');}
  }
  function captureDraft(){
    const fields={};for(const n of el('commercial-fields')?.querySelectorAll('input,select')||[])fields[n.name]=n.type==='checkbox'?n.checked:n.value;
    return {owner:identity(),commercial:fields};
  }
  function applyDraft(draft){
    if(draft?.owner!==identity()||!draft.commercial)return;
    const box=el('commercial-fields');if(identity()!==activeOwner||!options||!box?.querySelector('[name="mode"]')){deferredDraft=draft;return;}
    for(const n of box.querySelectorAll('input,select')){const name=n.name;if(!Object.hasOwn(draft.commercial,name))continue;if(n.type==='checkbox')n.checked=draft.commercial[name]===true;else n.value=String(draft.commercial[name]);}
    const selected=value(box,'mode');if(selected==='uber'&&!options?.uber_enabled||selected==='pickup'&&!options?.pickup_points?.length)box.querySelector('[name="mode"]').value='';
    if(!options?.pickup_points?.some(p=>p.id===value(box,'pickup_id')))box.querySelector('[name="pickup_id"]').value='';
    box.querySelector('[name="mode"]').onchange();box.querySelector('[name="pickup_id"]').onchange();
  }
  function updateTotal(){
    const total=typeof cart==='undefined'?0:cart.reduce((sum,i)=>sum+Number(products.find(p=>p.id===i.productId)?.price||0)*i.qty,0);
    const host=el('checkout-delivery-total-host'),mode=value(el('commercial-fields')||document,'mode');
    if(host)host.innerHTML=`<p>Productos: <strong>${cash(total)}</strong></p><p>${mode==='uber'?'Uber: costo pendiente de cotización; sujeto a aprobación.':mode==='pickup'?'Retiro habilitado: $0.':'Elegí una modalidad de entrega.'}</p>`;
  }
  function mount(){
    const form=el('checkout-form');if(!form)return;
    el('checkout-delivery-fields')?.remove();el('delivery-checkout-total')?.remove();
    const box=document.createElement('div');box.id='commercial-fields';box.className='full-span commercial-panel';form.appendChild(box);
    const status=document.createElement('p');status.id='commercial-message';status.className='full-span';status.setAttribute('role','status');form.appendChild(status);
    for(const id of ['commercial-recovery','commercial-receipt']){const node=document.createElement('section');node.id=id;node.className='card commercial-panel';node.hidden=true;el('section-checkout').appendChild(node);}
    loadOptions();if(window.cubicaCheckoutAuthReady)recover();
  }
  window.addEventListener('cubica:cart-updated',updateTotal);
  if(window.cubicaDelivery){
    // Keep the profile/historical logistics module, but stop the old checkout from
    // restoring carrier quotes or overriding the commercial total.
    window.cubicaDelivery.refreshCheckout=async()=>updateTotal();
    window.cubicaDelivery.refreshTotal=updateTotal;
    window.cubicaDelivery.exportDraft=captureDraft;
    window.cubicaDelivery.restoreDraft=applyDraft;
    window.cubicaDelivery.reset=()=>{deferredDraft=null;};
  }
  window.addEventListener('cubica:auth-ready',()=>{
    const next=identity();if(next!==activeOwner){epoch++;activeOwner=next;receipt=null;options=null;if(deferredDraft?.owner!==next)deferredDraft=null;el('commercial-receipt')&&(el('commercial-receipt').hidden=true);el('commercial-recovery')&&(el('commercial-recovery').hidden=true);el('checkout-layout')&&(el('checkout-layout').hidden=false);locked(false);el('commercial-fields')&&(el('commercial-fields').innerHTML='');}
    loadOptions();if(el('commercial-receipt'))recover();
  });
  document.addEventListener('DOMContentLoaded',mount);
  window.cubicaCommercial={submit,recover,openReceipt,customerAction,receiptHtml,buildPayload,loadOptions};
})();
