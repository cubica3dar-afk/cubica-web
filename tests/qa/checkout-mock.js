/* Exclusively synthetic QA. This is NOT a PostgREST/Auth/Turnstile implementation. */
window.fetch=async()=>{throw Error('QA blocks network fetch');};window.XMLHttpRequest=class{constructor(){throw Error('QA blocks XHR');}};window.WebSocket=class{constructor(){throw Error('QA blocks sockets');}};navigator.sendBeacon=()=>false;
const qaKey='qa_checkout_synthetic_v1',clone=x=>JSON.parse(JSON.stringify(x));
const qaPoint='11111111-1111-4111-8111-111111111111',qaDisabled='22222222-2222-4222-8222-222222222222';
let db=JSON.parse(sessionStorage.getItem(qaKey)||'null')||{version:1,approved:true,uber_enabled:true,bank:{cbu:'0000000000000000000000',holder:'SOLO QA — NO TRANSFERIR',bank:'BANCO FICTICIO QA',alias:'NO.TRANSFERIR.QA'},contact:'Contacto ficticio QA — no usar para compras',points:[{id:qaPoint,version:1,name:'Punto QA habilitado',description:'Lugar sintético sin dirección real',public_instructions:'Coordinar en QA',private_instructions:'UBICACION_PRIVADA_QA_789 — no es una dirección real',enabled:true},{id:qaDisabled,version:1,name:'Punto QA deshabilitado',enabled:false}],records:[],price:19999,role:'guest'};
const persist=()=>sessionStorage.setItem(qaKey,JSON.stringify(db)),log=[];
window.qaCalls=log;window.CUBICA_CONFIG={mode:'supabase',stageCMode:'admin'};
window.session=null;window.cart=[];window.products=[];window.orders=[];
window.STORAGE={cart:'qa_checkout_cart'};window.writeLocal=(_k,v)=>{db.cart=clone(v);persist();};window.renderCart=()=>{document.getElementById('checkout-summary-items').textContent=cart.length?'Producto exclusivamente sintético × 1':'Pedido confirmado; carrito vacío.';};
window.toast=m=>document.getElementById('qa-status').textContent=m;
window.showSection=()=>{};
window.cubicaCheckoutAuthReady=true;window.cubicaCheckoutBuyerName=()=>[document.getElementById('customer-name').value,document.getElementById('customer-last-name').value].join(' ').trim();
window.cubicaValidateCheckout=()=>{if(!cart.length)throw Error('Carrito sintético vacío. Elegí un total o iniciá otra compra.');if(!document.getElementById('customer-name').value||!document.getElementById('customer-last-name').value)throw Error('Completá nombre y apellido sintéticos.');};
window.cubicaAdminMfaAccessAllowed=()=>session?.role==='admin'&&session?.aal==='aal2';
window.cubicaDelivery={refreshCheckout(){},refreshTotal(){},renderAdminOrder:async(_id,target)=>target.textContent='Sin contrato sintético',customerHtml:()=>''};
const fail=(message,code='22023')=>{throw Object.assign(Error(message),{code});};
const options=()=>({ready:db.approved,version:db.version,bank:db.approved?db.bank:{},contact:db.contact,uber_enabled:db.approved&&db.uber_enabled,uber_limit:20000,pickup_points:db.points.filter(p=>p.enabled).map(p=>({id:p.id,name:p.name,description:p.description,instructions:p.public_instructions}))});
const isAdmin=()=>window.cubicaAdminMfaAccessAllowed();
const authorize=r=>{if(!isAdmin()&&((r.owner&&r.owner!==session?.supabaseUserId)||(!r.owner&&!r.token)))fail('Pedido sintético no disponible','42501');};
const receipt=r=>{const out=clone(r.receipt);out.options=options();if(!out.commercial.release_pickup)out.pickup_instructions=null;if(!isAdmin())out.admin_address=null;return out;};
function operation(name,p){
 if(name==='get_checkout_options')return options();
 if(name.startsWith('admin_')&&!isAdmin())fail('Administrador AAL2 requerido (simulado)','42501');
 if(name==='admin_checkout_settings')return {settings:{version:db.version,bank:db.bank,contact:db.contact,approved:db.approved,uber_enabled:db.uber_enabled},points:db.points};
 if(name==='admin_save_checkout_settings'){if(p.p_expected_version!==db.version)fail('Versión obsoleta simulada','40001');Object.assign(db,{version:db.version+1,bank:p.p_bank,contact:p.p_contact,approved:p.p_approved,uber_enabled:p.p_uber_enabled});return operation('admin_checkout_settings',{});}
 if(name==='admin_save_pickup_point'){const old=db.points.find(q=>q.id===p.p_id);if((old?.version||0)!==p.p_expected_version)fail('Versión obsoleta simulada','40001');if(!p.p_data.name)fail('Nombre requerido');const next={id:p.p_id,version:(old?.version||0)+1,...p.p_data};if(old)Object.assign(old,next);else db.points.push(next);return operation('admin_checkout_settings',{});}
 const r=db.records.find(r=>name==='reconcile_checkout'?r.request_id===p.p_request_id:r.receipt.order_id===p.p_order_id);
 if(!r){if(name==='reconcile_checkout')return null;fail('Pedido sintético no disponible','42501');}
 if(!isAdmin()){if(r.owner!==null){if(session?.supabaseUserId!==r.owner)fail('Otro titular','42501');}else if(p.p_token!==r.token)fail('Capacidad privada incorrecta','42501');}
 if(['get_checkout_receipt','reconcile_checkout'].includes(name))return receipt(r);
 const c=r.receipt.commercial;
 if(p.p_expected_version!==c.version)fail('Conflicto de versión SIMULADO','40001');
 if(name==='checkout_customer_action'){
  if(p.p_action==='report_transfer')c.transfer_reported=true;
  else if(p.p_action==='accept_uber_quote'&&c.uber_status==='approved'&&c.uber_quote!=null)c.accepted_quote_version=c.quote_version;
  else fail('Acción no disponible');
 }else if(name==='admin_checkout_order_action'){
  const d=p.p_data,a=p.p_action,amount=Number(d.amount);
  if(a==='credit_products'){if(!(amount>0)||amount+c.products_credited>c.products_total)fail('Importe inválido');c.products_credited+=amount;c.transfer_reported=false;}
  else if(a==='release_pickup'){if(r.receipt.order_status==='Pendiente')fail('Confirmá el pedido antes de comunicar ubicación');c.release_pickup=true;}
  else if(a==='approve_uber'){if(!d.caba_verified||!d.compatible)fail('Verificá CABA y compatibilidad');c.uber_status='approved';}
  else if(a==='reject_uber'){if(c.uber_credited>0)fail('Resolver acreditaciones antes de retirar');c.uber_status='rejected';c.uber_quote=null;c.accepted_quote_version=null;}
  else if(a==='quote_uber'){if(c.uber_status!=='approved'||r.receipt.order_status!=='Preparado'||!(amount>0)||amount<c.uber_credited)fail('Pedido preparado, aprobado e importe válido requeridos');c.uber_quote=amount;c.quote_version++;c.accepted_quote_version=null;}
  else if(a==='record_uber_acceptance'){if(!d.agreement||c.uber_quote==null)fail('Conformidad requerida');c.accepted_quote_version=c.quote_version;}
  else if(a==='credit_uber'){if(!(amount>0)||c.uber_quote==null||c.accepted_quote_version!==c.quote_version||c.uber_credited+amount>c.uber_quote)fail('Cotización aceptada e importe válido requeridos');c.uber_credited+=amount;}
  else if(a==='dispatch_uber'){if(c.uber_status!=='approved'||c.uber_quote==null||c.accepted_quote_version!==c.quote_version||c.products_credited<c.products_total||c.uber_credited<c.uber_quote||r.receipt.order_status!=='Preparado')fail('Faltan preparación, aprobación o acreditaciones');c.uber_status='dispatched';}
  else if(a==='switch_pickup'){const point=db.points.find(x=>x.id===d.pickup_id&&x.enabled);if(!point||!d.agreement||c.uber_credited>0)fail('Punto, acuerdo y pagos resueltos requeridos');c.pickup_id=point.id;c.pickup_public={name:point.name};c.release_pickup=false;c.uber_status='not_requested';c.uber_quote=null;r.receipt.delivery_mode='pickup';r.receipt.pickup_instructions=point.private_instructions;}
  else fail('Acción no implementada en QA');
 }else fail('RPC no habilitada en QA');
 c.version++;return receipt(r);
}
async function simulate(name,p,fn,write){
 const mode=write?document.getElementById('qa-failure').value:'normal';if(write)document.getElementById('qa-failure').value='normal';
 const entry={name,mode,params:JSON.parse(JSON.stringify(p,(k,v)=>/token/.test(k)?'[capacidad sintética omitida]':v)),status:'en curso'};log.push(entry);
 const render=()=>document.getElementById('qa-log').textContent=JSON.stringify(log,null,2);render();
 try{if(mode==='delay')await new Promise(r=>setTimeout(r,2500));if(mode==='before')fail('Fallo de red SIMULADO antes de guardar','order_network_error');if(mode==='conflict')fail('Versión obsoleta SIMULADA','40001');const result=fn();persist();if(mode==='lost')fail('Respuesta perdida SIMULADA después de guardar','order_network_error');entry.status='ok';return clone(result);}catch(e){entry.status=e.message;throw e;}finally{render();}
}
window.cubicaSupabase={rpc:async(name,p={})=>{try{return {data:await simulate(name,p,()=>operation(name,p),!['get_checkout_options','get_checkout_receipt','reconcile_checkout','admin_checkout_settings'].includes(name))};}catch(e){return {error:{message:e.message,code:e.code}};}}};
window.cubicaTurnstile={enabled:()=>true,requireToken:async()=> 'TURNSTILE_FICTICIO_NO_VALIDO',complete(){},handleFailure(){},createOrder:p=>simulate('create-order SIMULADO',p,()=>{
 const old=db.records.find(r=>r.request_id===p.client_order_id);if(old){if(JSON.stringify(old.payload)!==JSON.stringify(p)||old.owner!==(session?.supabaseUserId||null))fail('Mismo intento con otros datos','order_not_available');return clone(old.receipt);}
 if(p.payment!=='Transferencia')fail('Transferencia requerida','order_transfer_required');if(!db.approved)fail('Compra no configurada','order_checkout_not_configured');
 const total=db.price*p.items.reduce((n,i)=>n+i.qty,0),d=p.delivery,point=db.points.find(q=>q.id===d.pickup_id&&q.enabled);
 if(d.mode==='pickup'&&!point)fail('Punto no disponible','order_pickup_unavailable');
 if(d.mode==='uber'&&(!db.uber_enabled||total>20000))fail('Uber no elegible','order_uber_ineligible');
 if(d.mode==='uber'&&(!d.address||['street','number','neighborhood','city','postal_code'].some(k=>!d.address[k])||d.address.province!=='Ciudad Autónoma de Buenos Aires'))fail('Dirección completa en CABA requerida','order_uber_address_required');
 if(!['pickup','uber'].includes(d.mode))fail('Modalidad deshabilitada','order_delivery_disabled');
 const r={request_id:p.client_order_id,token:d.quote_token,owner:session?.supabaseUserId||null,payload:clone(p),receipt:{order_id:crypto.randomUUID(),order_number:'QA-SIM-'+(db.records.length+1),order_status:'Pendiente',origin:'store',items:[{name:'Producto exclusivamente sintético',qty:1,price:total}],delivery_mode:d.mode,admin_address:d.address||null,pickup_instructions:point?.private_instructions||null,commercial:{version:1,products_total:total,products_credited:0,deposit_percent:null,transfer_reported:false,pickup_id:point?.id||null,pickup_public:point?{name:point.name,description:point.description,instructions:point.public_instructions}:null,release_pickup:false,uber_status:d.mode==='uber'?'pending_review':'not_requested',uber_quote:null,quote_version:0,accepted_quote_version:null,uber_credited:0}}};db.records.push(r);return receipt(r);
},true)};
function setRole(role){db.role=role;session=role==='guest'?null:role==='customer'?{role:'customer',supabaseUserId:'33333333-3333-4333-8333-333333333333'}:{role:'admin',supabaseUserId:'44444444-4444-4444-8444-444444444444',aal:role==='admin'?'aal2':'aal1'};persist();window.dispatchEvent(new Event('cubica:auth-ready'));}
function setCart(price){db.price=Number(price);products=[{id:'qa-product',name:'Producto exclusivamente sintético',price:db.price,active:true,published:true}];cart=[{productId:'qa-product',qty:1,color:''}];db.cart=clone(cart);persist();renderCart();window.dispatchEvent(new Event('cubica:cart-updated'));}
document.addEventListener('DOMContentLoaded',()=>{
 document.getElementById('qa-role').value=db.role;setRole(db.role);document.getElementById('qa-cart').value=String(db.price);products=[{id:'qa-product',name:'Producto exclusivamente sintético',price:db.price,active:true,published:true}];cart=db.cart||[{productId:'qa-product',qty:1,color:''}];renderCart();
 document.getElementById('qa-role').onchange=e=>setRole(e.target.value);document.getElementById('qa-cart').onchange=e=>setCart(e.target.value);
 for(const [id,v]of Object.entries({'customer-name':'Cliente','customer-last-name':'Sintético','customer-email':'qa@example.invalid','customer-phone':'1112345678'}))document.getElementById(id).value=v;
 document.getElementById('checkout-form').onsubmit=e=>window.cubicaCommercial.submit(e);
 document.getElementById('qa-reset').onclick=()=>{for(const k of Object.keys(sessionStorage))if(k===qaKey||k.startsWith('cubica_commercial_checkout_v1:')||k==='cubica_checkout_draft_v1')sessionStorage.removeItem(k);location.reload();};
 document.getElementById('qa-config').onclick=()=>window.cubicaCommercialAdmin.settings();
 document.getElementById('qa-order').onclick=()=>{const last=db.records.at(-1);if(last)window.cubicaCommercialAdmin.order(last.receipt.order_id,document.getElementById('order-delivery-panel'));else toast('Creá un pedido sintético primero.');};
 document.getElementById('qa-ready').onclick=()=>{if(!isAdmin())return toast('Requiere administrador AAL2 simulado');const last=db.records.at(-1);if(last){last.receipt.order_status='Preparado';persist();toast('Pedido sintético preparado. Volvé a leer su panel.');}};
});
