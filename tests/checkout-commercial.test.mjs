// Real browser handlers in a minimal DOM, with synthetic RPC/Edge and no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {normalizeOrderRequest} from '../supabase/functions/create-order/worker.js';
const decode=s=>s.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
class Node {
 constructor(tag='div',attrs={}){this.tag=tag;this.attrs=attrs;this.children=[];this.dataset={};this.value=attrs.value||'';this.checked='checked'in attrs;this.disabled=false;this.hidden='hidden'in attrs;this.textContent='';for(const [k,v]of Object.entries(attrs))if(k.startsWith('data-'))this.dataset[k.slice(5)]=v;}
 set id(v){this.attrs.id=v;}get id(){return this.attrs.id;}
 get name(){return this.attrs.name;}get type(){return this.attrs.type;}
 get firstElementChild(){return this.children[0];}
 appendChild(n){n.parent=this;this.children.push(n);return n;}
 remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}
 setAttribute(k,v){this.attrs[k]=v;}
 set innerHTML(html){this.html=html;this.children=[];const stack=[this];for(const token of html.match(/<[^>]+>|[^<]+/g)||[]){if(token.startsWith('</')){if(stack.length>1)stack.pop();}else if(token.startsWith('<')){const tag=token.match(/^<([\w-]+)/)?.[1];if(!tag)continue;const attrs={};for(const m of token.slice(tag.length+1,-1).matchAll(/([\w-]+)(?:="([^"]*)")?/g))attrs[m[1]]=decode(m[2]||'');const node=stack.at(-1).appendChild(new Node(tag,attrs));if(!['input','br','img','link'].includes(tag))stack.push(node);}else{stack.at(-1).textContent+=decode(token);if(stack.at(-1).tag==='textarea')stack.at(-1).value+=decode(token);}}for(const select of this.querySelectorAll('select')){const option=select.querySelectorAll('option').find(n=>'selected'in n.attrs)||select.children[0];select.value=option?.attrs.value||'';}}
 get innerHTML(){return this.html||'';}
 matches(s){if(s.includes(','))return s.split(',').some(x=>this.matches(x));if(s.startsWith('#'))return this.id===s.slice(1);const m=s.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);return m?m[1]in this.attrs&&(m[2]===undefined||this.attrs[m[1]]===m[2]):this.tag===s;}
 querySelectorAll(s){return this.children.flatMap(n=>[...(n.matches(s)?[n]:[]),...n.querySelectorAll(s)]);}
 querySelector(s){return this.querySelectorAll(s)[0]||null;}
}
const point='b6deef29-dcf3-4b7a-8b67-6d993e85d955';
const options={ready:true,uber_enabled:true,pickup_points:[{id:point,name:'Synthetic square',description:'QA public',instructions:'Coordinate'}],bank:{cbu:'0'.repeat(22),bank:'QA BANK',holder:'QA'},contact:'QA contact'};
const receipt={order_id:'aa13c17b-36fc-47fa-8b38-b8016ffb5953',order_number:'QA-100',items:[{name:'QA product',qty:2,price:1000}],commercial:{version:1,products_total:2000,products_credited:0,uber_status:'not_requested',uber_quote:null,pickup_public:{name:'Synthetic square'}},delivery_mode:'pickup',options};
const tick=()=>new Promise(r=>setTimeout(r,0));
async function setup({edge,rpc,storage=new Map(),storageFails=false,user=null,settings=options,track}={}){
 const root=new Node(),dom=[],listeners={},calls=[],writes=[],edgeCalls=[],confirmations=[];let accept=false,record=null;
 root.innerHTML='<section id="section-checkout"><div id="checkout-layout"><form id="checkout-form"><input id="customer-email" value="qa@example.invalid"><input id="customer-phone" value="1112345678"><input id="customer-notes" value="QA notes"><select id="payment-method"></select></form><button id="checkout-confirm-btn"></button><div id="checkout-delivery-total-host"></div></div></section><div id="delivery-admin-content"></div><div id="order-delivery-panel"></div>';
 const ctx={console,Intl,crypto:webcrypto,Uint8Array,session:user,cart:[{productId:'qa',qty:2,color:''}],products:[{id:'qa',price:1000,stock:10}],orders:[],STORAGE:{cart:'cart'},writeLocal:(k,v)=>writes.push([k,structuredClone(v)]),renderCart(){},sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>{if(storageFails)throw Error('Storage unavailable');storage.set(k,v);},removeItem:k=>storage.delete(k)},confirm:m=>{confirmations.push(m);return accept;},navigator:{clipboard:{writeText:async()=>{}}},document:{getElementById:id=>root.querySelector('#'+id),createElement:tag=>new Node(tag),addEventListener:(name,fn)=>dom.push(fn),querySelector:s=>root.querySelector(s)},window:{cubicaTrackEvent:track,cubicaCheckoutAuthReady:true,cubicaValidateCheckout(){if(!ctx.cart.length)throw Error('Empty cart');},cubicaCheckoutBuyerName:()=> 'QA Customer',cubicaAdminMfaAccessAllowed:()=>ctx.session?.aal==='aal2',addEventListener:(n,fn)=>(listeners[n]??=[]).push(fn),cubicaDelivery:{refreshCheckout(){},refreshTotal(){},renderAdminOrder:async()=>{},customerHtml:()=>''},cubicaSupabase:{rpc:async(n,a)=>{calls.push({n,a:structuredClone(a)});if(rpc)return rpc(n,a);if(n==='get_checkout_options')return{data:settings};if(n==='reconcile_checkout'||n==='get_checkout_receipt')return{data:record};if(n==='checkout_customer_action')return {data:record};throw Error('Unexpected RPC '+n);}},cubicaTurnstile:{enabled:()=>true,requireToken:async()=> 'synthetic-turnstile',createOrder:async p=>{edgeCalls.push(structuredClone(p));if(edge)return edge(p);record=structuredClone(receipt);return record;},complete(){},handleFailure(){}}}};
 vm.runInNewContext(fs.readFileSync(new URL('../js/checkout-commercial.js',import.meta.url),'utf8'),ctx);
 for(const fn of dom)fn();await tick();
 const field=(k,v)=>{const n=root.querySelector('#commercial-fields').querySelector(`[name="${k}"]`);n.value=v;n.onchange?.();return n;};
 if(root.querySelector('#commercial-fields').querySelector('[name="mode"]')){field('mode','pickup');field('pickup_id',point);}
 return {ctx,root,calls,writes,edgeCalls,confirmations,storage,field,api:ctx.window.cubicaCommercial,set accept(v){accept=v;},set record(v){record=v;},emit:n=>{for(const fn of listeners[n]||[])fn();},key:()=>`cubica_commercial_checkout_v1:${ctx.session?.supabaseUserId||'guest'}`,admin:()=>vm.runInNewContext(fs.readFileSync(new URL('../js/checkout-commercial-admin.js',import.meta.url),'utf8'),ctx)};
}
test('new frontend against predecessor without checkout RPC fails closed, preserving cart without a write',async()=>{
 const h=await setup({rpc:async()=>({error:{code:'PGRST202',message:'get_checkout_options missing from predecessor schema'}})});
 assert.match(h.root.querySelector('#commercial-message').textContent,/No pudimos cargar/);
 await h.api.submit();
 assert.equal(h.edgeCalls.length,0);assert.equal(h.ctx.cart.length,1);assert.equal(h.storage.size,0);
 assert.ok(h.calls.every(c=>c.n==='get_checkout_options'));assert.match(h.root.querySelector('#commercial-message').textContent,/todavía no está habilitada/);
});
test('guest and registered orders use transfer, persistent receipt, server total and clear cart only on confirmation',async()=>{
 for(const user of [null,{supabaseUserId:'customer-A',role:'customer'}]){const h=await setup({user});await h.api.submit();assert.equal(h.edgeCalls.length,1);assert.equal(h.edgeCalls[0].payment,'Transferencia');assert.equal(h.edgeCalls[0].items[0].price,undefined);assert.equal(h.ctx.cart.length,0);assert.equal(h.ctx.products[0].stock,10);assert.equal(h.root.querySelector('#commercial-receipt').hidden,false);assert.match(h.root.querySelector('#commercial-receipt').innerHTML,/QA-100/);assert.equal(JSON.parse(h.storage.get(h.key())).order_id,receipt.order_id);assert.ok(!h.storage.get(h.key()).includes('qa@example'));}
});
test('missing security or storage stops request without discarding cart',async()=>{
 const h=await setup();h.ctx.window.cubicaTurnstile=null;await h.api.submit();assert.equal(h.edgeCalls.length,0);assert.equal(h.ctx.cart.length,1);
 const fail=await setup({storageFails:true});await fail.api.submit();assert.equal(fail.edgeCalls.length,0);assert.equal(fail.ctx.cart.length,1);
});
test('double click sends once; no optimistic stock changes',async()=>{
 let resolve,started;const ready=new Promise(r=>started=r);const h=await setup({edge:()=>{started();return new Promise(r=>resolve=r);}});const pending=h.api.submit();await ready;await h.api.submit();assert.equal(h.edgeCalls.length,1);assert.equal(h.ctx.cart.length,1);h.record=receipt;resolve(receipt);await pending;assert.equal(h.ctx.cart.length,0);assert.equal(h.ctx.products[0].stock,10);
});
test('lost response reconciles read-only without duplicating create',async()=>{
 const h=await setup({edge:async()=>{throw Error('Response lost');}});await h.api.submit();assert.equal(h.ctx.cart.length,1);assert.equal(h.root.querySelector('#commercial-recovery').hidden,false);h.record=receipt;await h.api.recover();assert.equal(h.edgeCalls.length,1);assert.equal(h.ctx.cart.length,0);
});
test('retry preserves exact original body and identity despite changed fields/cart; reload restores pending attempt',async()=>{
 const storage=new Map(),h=await setup({storage,edge:async()=>{throw Error('network');}});await h.api.submit();const original=h.edgeCalls[0];h.root.querySelector('#customer-notes').value='Changed';h.ctx.cart[0].qty=4;await h.api.submit();assert.deepEqual(h.edgeCalls[1],original);assert.equal(h.ctx.cart[0].qty,4);
 const reloaded=await setup({storage,edge:async()=>{throw Error('network');}});await reloaded.api.submit();assert.deepEqual(reloaded.edgeCalls[0],original);
});
test('authentication change while sending cannot expose receipt or clear another user cart',async()=>{
 let resolve,started;const ready=new Promise(r=>started=r);const h=await setup({edge:()=>{started();return new Promise(r=>resolve=r);}});const pending=h.api.submit();await ready;h.ctx.session={supabaseUserId:'different'};h.emit('cubica:auth-ready');resolve(receipt);await pending;await tick();assert.equal(h.ctx.cart.length,1);assert.equal(h.root.querySelector('#commercial-receipt').hidden,true);assert.equal(h.storage.has(h.key()),false);
});
test('Uber UI requires all address fields, declares review, enforces preview limit and Edge preserves neighborhood',async()=>{
 const h=await setup();h.field('mode','uber');assert.throws(()=>h.api.buildPayload(),/Completá/);for(const [k,v]of Object.entries({street:'Synthetic',number:'123',neighborhood:'QA',city:'CABA',postal_code:'1405'}))h.field(k,v);h.root.querySelector('[name="caba"]').checked=true;
 h.ctx.products[0].price=10000;const p=h.api.buildPayload();assert.equal(p.delivery.mode,'uber');const normalized=normalizeOrderRequest({...p,turnstile_token:'synthetic'});assert.equal(normalized.rpc.p_delivery.address.neighborhood,'QA');assert.equal(normalized.rpc.p_delivery.quote_id,undefined);h.ctx.products[0].price=10001;assert.throws(()=>h.api.buildPayload(),/20.000/);assert.match(h.root.querySelector('#commercial-fields').innerHTML,/no está confirmada/);assert.match(h.root.querySelector('#checkout-delivery-total-host').innerHTML,/pendiente/);
});
test('disabled pickup or unapproved bank cannot be bypassed through form values',async()=>{
 const h=await setup({settings:{...options,ready:false}});assert.throws(()=>h.api.buildPayload(),/transferencia aprobados/);const p=await setup();p.field('pickup_id','invented');assert.throws(()=>p.api.buildPayload(),/habilitado/);
});
test('receipt escapes text and does not call Uber free or paid before accreditation',async()=>{
 const h=await setup(),r=structuredClone(receipt);r.delivery_mode='uber';r.commercial.uber_status='pending_review';r.items[0].name='<script>bad()</script>';const html=h.api.receiptHtml(r);assert.ok(!html.includes('<script>'));assert.match(html,/pendiente de aprobación/);assert.match(html,/Costo de envío pendiente/);assert.ok(!html.includes('Retiro gratuito'));assert.match(html,/Pendiente de acreditación/);
});
test('customer cancellation executes no action RPC; transfer notice sends version not amount',async()=>{
 const h=await setup();await h.api.submit();await h.api.customerAction('report_transfer');assert.equal(h.calls.filter(c=>c.n==='checkout_customer_action').length,0);h.accept=true;await h.api.customerAction('report_transfer');const action=h.calls.find(c=>c.n==='checkout_customer_action');assert.equal(action.a.p_expected_version,1);assert.equal(action.a.amount,undefined);
});
test('admin forms preserve private/public separation, default new point disabled, and AAL1 has no RPC',async()=>{
 const h=await setup({user:{supabaseUserId:'admin',role:'admin',aal:'aal1'}});h.admin();await h.ctx.window.cubicaCommercialAdmin.settings();assert.equal(h.calls.some(c=>c.n==='admin_checkout_settings'),false);
 h.ctx.session.aal='aal2';h.ctx.window.cubicaSupabase.rpc=async(n)=>{assert.equal(n,'admin_checkout_settings');return {data:{settings:{version:1,bank:{},approved:false,uber_enabled:false},points:[]}};};await h.ctx.window.cubicaCommercialAdmin.settings();const host=h.root.querySelector('#delivery-admin-content');host.querySelector('[data-new]').onclick();assert.equal(host.querySelector('[name="enabled"]').checked,false);assert.ok(host.querySelector('[name="private_instructions"]'));assert.ok(host.querySelector('[name="public_instructions"]'));assert.equal(host.querySelector('[name="approved"]').checked,false);
});
test('Edge preserves legacy shipping canonical form while accepting new pickup identity',()=>{
 const id=webcrypto.randomUUID(),base={client_order_id:id,items:[{product_id:'QA',qty:1}],delivery:{mode:'pickup',request_id:id,quote_token:'a'.repeat(64),pickup_id:point},turnstile_token:'synthetic'};assert.equal(normalizeOrderRequest(base).rpc.p_delivery.pickup_id,point);delete base.delivery.pickup_id;assert.equal(Object.hasOwn(normalizeOrderRequest(base).rpc.p_delivery,'pickup_id'),false);base.delivery.mode='shipping';base.delivery.quote_id=webcrypto.randomUUID();base.delivery.address={street:'QA'};const old=normalizeOrderRequest(base).rpc.p_delivery;assert.equal(Object.hasOwn(old.address,'neighborhood'),false);assert.equal(old.quote_id,base.delivery.quote_id);
});
test('delivery draft survives refresh and same-owner restoration without retaining another account address',async()=>{
 const h=await setup();h.field('mode','uber');h.field('street','Synthetic edited street');h.root.querySelector('[name="caba"]').checked=true;const draft=h.ctx.window.cubicaDelivery.exportDraft();await h.api.loadOptions();assert.equal(h.root.querySelector('[name="street"]').value,'Synthetic edited street');assert.equal(h.root.querySelector('[name="caba"]').checked,true);
 const reload=await setup();reload.ctx.window.cubicaDelivery.restoreDraft(draft);assert.equal(reload.root.querySelector('[name="street"]').value,'Synthetic edited street');reload.ctx.session={supabaseUserId:'different'};reload.emit('cubica:auth-ready');await tick();assert.equal(reload.root.querySelector('[name="street"]').value,'');reload.ctx.window.cubicaDelivery.restoreDraft(draft);assert.equal(reload.root.querySelector('[name="street"]').value,'');
});
test('definitive backend rejection unlocks editing; ambiguous rejection keeps immutable attempt',async()=>{
 for(const code of ['order_pickup_unavailable','order_invalid_address','order_creation_failed']){const h=await setup({edge:async()=>{const e=Error('Synthetic');e.code=code;throw e;}});await h.api.submit();assert.equal(h.edgeCalls.length,1);assert.equal(h.ctx.cart.length,1);assert.equal(h.storage.has(h.key()),code==='order_creation_failed');assert.equal(h.root.querySelector('#customer-email').disabled,code==='order_creation_failed');}
});
test('registered owner can reopen receipt from history; cancelled receipt never instructs a transfer',async()=>{
 const h=await setup({user:{supabaseUserId:'owner',role:'customer'}});let shown='';h.ctx.showSection=s=>shown=s;h.record=receipt;await h.api.openReceipt(receipt.order_id);assert.equal(shown,'checkout');assert.equal(JSON.parse(h.storage.get(h.key())).order_id,receipt.order_id);assert.equal(h.edgeCalls.length,0);assert.equal(h.ctx.cart.length,1);
 const cancelled={...receipt,order_status:'Cancelado'};const html=h.api.receiptHtml(cancelled);assert.match(html,/No transfieras/);assert.ok(!html.includes('CBU:'));
});

function analytics(h){const events=[];h.ctx.window.cubicaTrackEvent=(...args)=>events.push(JSON.parse(JSON.stringify(args)));return events;}
test('purchase uses confirmed server metrics once, never balance or repeated receipt/payment/Uber actions',async()=>{
 const h=await setup(),events=analytics(h);await h.api.submit();
 assert.deepEqual(events,[['purchase',null,{order_number:'QA-100',total:2000,units:2}]]);
 await h.api.recover();await h.api.recover();h.accept=true;
 h.record={...receipt,commercial:{...receipt.commercial,version:2,products_credited:2000}};
 await h.api.customerAction('report_transfer');
 h.record={...receipt,delivery_mode:'uber',commercial:{...receipt.commercial,uber_status:'approved',uber_quote:500,quote_version:1}};
 await h.api.recover();await h.api.customerAction('accept_uber_quote');await h.api.recover();assert.equal(events.length,1);
});
test('purchase after lost response recovery, including reload, is attempted once by stable order identity',async()=>{
 const storage=new Map(),h=await setup({storage,edge:async()=>{throw Error('lost');}}),events=analytics(h);
 await h.api.submit();assert.equal(events.length,0);h.record=receipt;await h.api.recover();assert.equal(events.length,1);
 const restored=await setup({storage});const again=analytics(restored);restored.record=receipt;await restored.api.recover();assert.equal(again.length,0);
 // Even another pending envelope for the same order cannot repeat it.
 storage.set(restored.key(),JSON.stringify({owner:'guest',payload:{},order_id:receipt.order_id}));await restored.api.recover();assert.equal(again.length,0);
});
test('history consultation without creation intent never produces purchase',async()=>{
 const h=await setup({user:{supabaseUserId:'owner'}}),events=analytics(h);h.ctx.showSection=()=>{};h.record=receipt;
 await h.api.openReceipt(receipt.order_id);await h.api.recover();assert.equal(events.length,0);
});
test('failed and explicitly rejected orders never produce purchase',async()=>{
 for(const code of ['order_pickup_unavailable','order_network_error']){const h=await setup({edge:async()=>{throw Object.assign(Error('QA'),{code});}}),events=analytics(h);await h.api.submit();await h.api.recover();assert.equal(events.length,0);}
});
test('session change while creating does not attribute another owner purchase or expose personal fields',async()=>{
 let done;const h=await setup({edge:()=>new Promise(r=>done=r)}),events=analytics(h);const pending=h.api.submit();await tick();h.ctx.session={supabaseUserId:'other'};h.emit('cubica:auth-ready');done(receipt);await pending;assert.equal(events.length,0);
});
test('shared browser marker and lock prevent duplicate attempts; analytics failure does not fail the order',async()=>{
 const shared=new Map();const run=async()=>{const h=await setup();h.ctx.localStorage={getItem:k=>shared.get(k),setItem:(k,v)=>shared.set(k,v)};h.ctx.navigator.locks={request:async(_key,fn)=>fn()};const events=analytics(h);await h.api.submit();return events;};
 assert.equal((await run()).length,1);assert.equal((await run()).length,0);assert.deepEqual([...shared.values()],['1']);
 const h=await setup();let calls=0;h.ctx.window.cubicaTrackEvent=()=>{calls++;return Promise.reject(Error('analytics offline'));};await h.api.submit();await h.api.recover();assert.equal(calls,1);assert.equal(h.ctx.cart.length,0);
});
test('unwritable analytics marker skips telemetry safely and admin purchases stay excluded',async()=>{
 const h=await setup(),events=analytics(h);h.ctx.localStorage={getItem(){return null;},setItem(){throw Error('denied');}};await h.api.submit();assert.equal(events.length,0);assert.equal(h.ctx.cart.length,0);
 const a=await setup({user:{supabaseUserId:'admin',role:'admin'}}),adminEvents=analytics(a);await a.api.submit();assert.equal(adminEvents.length,0);
});

test('reload recovers an unconfirmed lost response and emits its confirmed metrics',async()=>{
 const storage=new Map(),h=await setup({storage,edge:async()=>{throw Error('lost');}});await h.api.submit();const events=[];
 await setup({storage,track:(...a)=>events.push(JSON.parse(JSON.stringify(a))),rpc:async n=>({data:n==='get_checkout_options'?options:receipt})});
 assert.deepEqual(events,[['purchase',null,{order_number:'QA-100',total:2000,units:2}]]);
});
test('session changes while waiting for analytics lock suppress attribution',async()=>{
 const h=await setup(),events=analytics(h);let release;
 h.ctx.navigator.locks={request:(_key,fn)=>new Promise(resolve=>release=()=>{fn();resolve();})};const submit=h.api.submit();await tick();
 h.ctx.session={supabaseUserId:'other'};h.emit('cubica:auth-ready');release();await submit;assert.equal(events.length,0);
});
