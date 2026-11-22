import assert from 'node:assert/strict';
import {harness,event,clone} from './campaign-test-harness.mjs';
const setup=()=>{
 const h=harness();Object.assign(h.i.state,{tab:'content'});
 Object.assign(h.i.state.admin,{pages:[{slug:'about',label:'Sobre',draft:{title:'Original',content:{body:'Texto'},version:1},history:[]},{slug:'terms',label:'Términos',draft:null,history:[]}],faqs:[],phrases:[]});
 h.i.renderAdmin();return h;
};
const args=(kind,extra={})=>kind==='faq'?{p_id:null,p_question:'Pregunta',p_answer:'Respuesta',p_active:false,p_sort_order:0,p_expected_version:0,p_delete:false,...extra}:{p_id:null,p_campaign_id:null,p_phrase:'Frase',p_active:false,p_sort_order:0,p_expected_version:0,p_delete:false,...extra};
const rpcName=k=>k==='faq'?'admin_upsert_faq':'admin_upsert_welcome_phrase';
const result=(k,p)=>({id:30,version:p.p_expected_version+1,active:p.p_active,sort_order:p.p_sort_order,...(k==='faq'?{question:p.p_question,answer:p.p_answer}:{phrase:p.p_phrase,campaign_id:p.p_campaign_id})});
const formSnapshot=(h,kind)=>Object.fromEntries((kind==='faq'?['id','version','question','answer','order','active']:['id','version','text','campaign','order','active']).map(key=>[key,key==='active'?h.get(kind+'-'+key).checked===true:h.get(kind+'-'+key).value]));
const withRecords=kind=>{
 const h=setup(),plural=kind==='faq'?'faqs':'phrases';
 h.i.state.admin[plural]=[result(kind,args(kind)),{...result(kind,args(kind)),id:31}];
 h.i.renderAdmin();
 h.rpc=async(name,p)=>{
  if(name==='admin_get_site_configuration')return {data:clone(h.i.state.admin)};
  if(name==='admin_get_welcome_screen_preference')return {data:{enabled:false,version:3}};
  assert.equal(name,rpcName(kind));const row={...result(kind,p),id:p.p_id||30};
  h.i.state.admin[plural]=p.p_delete?h.i.state.admin[plural].filter(x=>x.id!==p.p_id):h.i.state.admin[plural].map(x=>x.id===p.p_id?row:x);
  return {data:row};
 };
 return h;
};
const answers=(h,values)=>Object.defineProperty(h,'confirm',{configurable:true,get(){assert.ok(values.length,'Unexpected extra confirmation');return values.shift();}});
for(const [kind,field,value] of [['faq','answer','Respuesta sin pregunta'],['faq','order','7'],['faq','active',true],['phrase','campaign','campaign-qa'],['phrase','order','8'],['phrase','active',true],['faq','id','99'],['phrase','version','7']]){
 const h=withRecords(kind),input=h.get(kind+'-'+field);if(field==='active')input.checked=value;else input.value=value;
 const before=formSnapshot(h,kind);h.confirm=false;h.get('site-'+kind+'-form').onreset(event);
 assert.deepEqual(formSnapshot(h,kind),before);assert.equal(h.confirmations.length,1);assert.equal(h.calls.length,0);
 h.all('[data-edit-'+kind+']')[0].onclick();assert.deepEqual(formSnapshot(h,kind),before);assert.equal(h.confirmations.length,2);
 h.confirm=true;h.all('[data-edit-'+kind+']')[0].onclick();assert.equal(h.get(kind+'-id').value,'30');assert.equal(h.i.contentFormDirty(kind),false);
 console.log('PASS full discard detection, cancellation and replacement: '+kind+'/'+field);
}
for(const kind of ['faq','phrase']){
 const h=withRecords(kind);h.confirm=false;
 h.get('site-'+kind+'-form').onreset(event);h.all('[data-edit-'+kind+']')[0].onclick();
 h.all('[data-edit-'+kind+']')[1].onclick();h.get('site-'+kind+'-form').onreset(event);
 assert.equal(h.confirmations.length,0);assert.equal(h.calls.length,0);assert.equal(h.get(kind+'-active').checked,false);
 console.log('PASS pristine new and existing forms need no discard confirmation: '+kind);
}
for(const kind of ['faq','phrase'])for(const action of ['activate','deactivate','delete']){
 const h=withRecords(kind),plural=kind==='faq'?'faqs':'phrases',field=kind==='faq'?'answer':'text';
 if(action==='deactivate')h.i.state.admin[plural][0].active=true;
 h.i.renderAdmin();h.all('[data-edit-'+kind+']')[0].onclick();h.get(kind+'-'+field).value='Edición pendiente';
 const before=formSnapshot(h,kind),selector='[data-'+(action==='delete'?'delete':'toggle')+'-'+kind+']';
 answers(h,action==='delete'?[true,false]:[false]);await h.all(selector)[0].onclick();
 assert.deepEqual(formSnapshot(h,kind),before);assert.equal(h.calls.length,0);assert.equal(h.i.contentFormDirty(kind),true);
 if(action==='activate'){
  answers(h,[true,false]);await h.all(selector)[0].onclick();assert.deepEqual(formSnapshot(h,kind),before);assert.equal(h.calls.length,0);
  assert.match(h.confirmations.at(-2),/Descartar/);assert.match(h.confirmations.at(-1),/RPC públicas/);
 }
 answers(h,action==='delete'||action==='activate'?[true,true]:[true]);await h.all(selector)[0].onclick();
 assert.equal(h.calls.filter(c=>c.name===rpcName(kind)).length,1);assert.equal(h.i.contentFormDirty(kind),false);
 assert.equal(h.get(kind+'-version').value,action==='delete'?'0':'2');
 assert.equal(h.get(kind+'-active').checked,action==='activate');
 if(action!=='delete')assert.notEqual(h.get(kind+'-'+field).value,'Edición pendiente');
 console.log('PASS list action: discard, public cancellation, success and new baseline: '+kind+'/'+action);
}
{
 const h=withRecords('faq');h.all('[data-edit-faq]')[0].onclick();h.get('faq-answer').value='Local';const before=formSnapshot(h,'faq');
 h.confirm=true;await h.all('[data-toggle-faq]')[1].onclick();assert.deepEqual(formSnapshot(h,'faq'),before);assert.equal(h.confirmations.length,1);
 h.context.session={role:'admin',aal:'aal1'};const count=h.calls.length;h.get('site-faq-form').onreset(event);h.all('[data-edit-faq]')[1].onclick();await h.all('[data-toggle-faq]')[0].onclick();
 assert.deepEqual(formSnapshot(h,'faq'),before);assert.equal(h.calls.length,count);
 console.log('PASS actions on another record preserve local edits; AAL1 cannot discard or write');
}
for(const kind of ['faq','phrase']){
 const h=setup();h.rpc=async(name,p)=>name==='admin_get_site_configuration'?{data:h.i.state.admin}:name==='admin_get_welcome_screen_preference'?{data:{enabled:false,version:3}}:{data:result(kind,p)};
 if(kind==='faq'){h.get('faq-question').value='Pregunta';h.get('faq-answer').value='Respuesta';}else h.get('phrase-text').value='Frase';
 await h.get('site-'+kind+'-form').onsubmit(event);
 assert.equal(h.calls[0].args.p_active,false);assert.equal(h.confirmations.length,0);
 assert.equal(h.i.contentFormDirty(kind),false,'Confirmed save refreshes the baseline');
 h.confirm=false;await assert.rejects(()=>h.i.contentRpc(rpcName(kind),args(kind,{p_id:30,p_expected_version:1,p_active:true})),/cancelada/);
 assert.equal(h.calls.filter(c=>c.name===rpcName(kind)).length,1);
 h.confirm=true;await h.i.contentRpc(rpcName(kind),args(kind,{p_id:30,p_expected_version:1,p_active:true}));
 assert.equal(h.calls.at(-1).args.p_active,true);assert.match(h.confirmations.at(-1),/RPC públicas/);
 h.confirm=false;await assert.rejects(()=>h.i.contentRpc(rpcName(kind),args(kind,{p_id:30,p_expected_version:2,p_active:true})),/cancelada/);
 h.confirm=true;h.get('site-'+kind+'-form').onreset(event);assert.equal(h.get(kind+'-id').value,'');assert.equal(h.get(kind+'-active').checked,false);
 console.log('PASS inactive creation / explicit public edits / cancellation: '+kind);
}
{
 const h=setup(),p=args('phrase');h.get('phrase-text').value='Frase';
 h.rpc=async()=>({error:{message:'Sin respuesta'}});await assert.rejects(()=>h.i.contentRpc(rpcName('phrase'),p),e=>e.message==='Sin respuesta');
 assert.equal(h.get('phrase-text').disabled,true);
 h.rpc=async()=>({data:{phrases:[result('phrase',p)]}});await h.i.contentRpc(rpcName('phrase'),p);
 assert.equal(h.get('phrase-id').value,'30');assert.equal(h.get('phrase-version').value,'1');assert.equal(h.get('phrase-active').checked,false);assert.equal(h.get('phrase-text').disabled,false);
 assert.equal(h.i.contentFormDirty('phrase'),false,'Reconciliation refreshes identity and baseline');
 h.rpc=async()=>({error:{code:'23505',message:'Duplicado'}});await assert.rejects(()=>h.i.contentRpc(rpcName('phrase'),p),e=>e.code==='23505');assert.equal(h.i.contentControls.pending,null);
 console.log('PASS phrase reconciliation adopts identity; duplicate rejection is not an ambiguous write');
}
{
 const h=setup();h.get('site-page-title').value='Local';h.get('faq-question').value='Sin guardar';h.get('phrase-text').value='Conservar';
 h.get('site-page-slug').value='terms';h.get('site-page-slug').onchange();h.get('site-page-title').value='Términos locales';
 h.get('site-page-slug').value='about';h.get('site-page-slug').onchange();assert.equal(h.get('site-page-title').value,'Local');
 h.i.renderAdmin();assert.equal(h.get('faq-question').value,'Sin guardar');assert.equal(h.get('phrase-text').value,'Conservar');assert.equal(h.get('site-page-title').value,'Local');
 await assert.rejects(()=>h.i.contentRpc('admin_publish_content_page',{p_slug:'about',p_expected_version:1}),/cambios locales/);assert.equal(h.calls.length,0);
 h.get('site-page-title').value='Original';h.confirm=false;
 await assert.rejects(()=>h.i.contentRpc('admin_publish_content_page',{p_slug:'about',p_expected_version:1}),/cancelada/);assert.match(h.confirmations.at(-1),/persistida 1/);assert.equal(h.calls.length,0);
 h.rpc=async name=>({data:name==='admin_get_site_configuration'?h.i.state.admin:{enabled:false,version:3}});
 await h.window.cubicaSiteExperience.loadAdmin();assert.equal(h.get('faq-question').value,'Sin guardar');
 h.get('faq-search').value='inexistente';h.get('faq-search').oninput();assert.equal(h.get('faq-question').value,'Sin guardar');
 h.i.state.admin.faqs=[{id:1,question:'Uno',answer:'Dos',sort_order:0,version:1,active:false}];h.get('faq-search').value='';h.i.state.faqPage=8;h.i.renderFaqAdmin();assert.equal(h.i.state.faqPage,1);
 h.i.state.admin.phrases=[{id:1,phrase:'Uno',sort_order:0,version:1,active:false}];h.i.state.phrasePage=8;h.i.renderPhraseAdmin();assert.equal(h.i.state.phrasePage,1);
 h.confirm=false;h.all('[data-edit-faq]')[0].onclick();assert.equal(h.get('faq-question').value,'Sin guardar');
 console.log('PASS page drafts, reload, filters, pagination, discard and publication guards');
}
{
 const h=setup(),p=args('faq');let release;
 h.rpc=()=>new Promise(resolve=>release=resolve);
 const first=h.i.contentRpc(rpcName('faq'),p);
 await assert.rejects(()=>h.i.contentRpc(rpcName('faq'),p),/curso/);assert.equal(h.calls.length,1);
 release({error:{message:'Respuesta perdida'}});await assert.rejects(()=>first,e=>e.message.includes("perdida"));
 h.rpc=async()=>({data:{faqs:[]}});await assert.rejects(()=>h.i.contentRpc(rpcName('faq'),p),/ambiguo/);assert.equal(h.calls.at(-1).name,'admin_get_site_configuration');
 h.rpc=async()=>({data:{faqs:[result('faq',p)]}});await h.i.contentRpc(rpcName('faq'),p);assert.equal(h.i.contentControls.pending,null);assert.equal(h.calls.filter(c=>c.name===rpcName('faq')).length,1);
 h.rpc=async()=>({error:{code:'40001',message:'Versión obsoleta'}});await assert.rejects(()=>h.i.contentRpc(rpcName('faq'),args('faq',{p_id:30,p_expected_version:1})),e=>e.code==="40001");assert.equal(h.i.contentControls.pending,null);
 h.context.session={role:'admin',aal:'aal1'};const before=h.calls.length;await assert.rejects(()=>h.i.contentRpc(rpcName('faq'),p),/AAL2/);assert.equal(h.calls.length,before);
 console.log('PASS double submission, ambiguous response read reconciliation, stale versions and AAL1');
}
