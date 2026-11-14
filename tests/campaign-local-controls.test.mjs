import assert from "node:assert/strict";
import fs from "node:fs";
import {harness,validForm,responseFor,clone,event} from "./campaign-test-harness.mjs";

const pass=name=>console.log("✓ "+name);
{
  const h=harness();validForm(h);
  const form=h.get("site-campaign-form"),before=clone(h.i.state.campaignDraft);
  h.all("[data-calendar-move]")[1].onclick();
  assert.equal(h.i.state.calendarCursor,"2026-12");
  assert.equal(h.get("site-campaign-form"),form,"Month navigation must retain the actual form node");
  h.get("campaign-page-size").onchange({target:{value:"25"}});
  assert.equal(h.get("site-campaign-form"),form);
  h.i.state.admin.campaigns=Array.from({length:30},(_,n)=>responseFor(h.i.campaignPayload(before),{id:String(n),name:"Item "+n}));
  h.get("campaign-page-size").onchange({target:{value:"10"}});
  h.all("[data-campaign-page]")[1].onclick();
  assert.equal(h.i.state.campaignPage,2);assert.equal(h.get("site-campaign-form"),form);
  h.all("[data-site-tab]").find(b=>b.dataset.siteTab==="email").onclick();
  h.all("[data-site-tab]").find(b=>b.dataset.siteTab==="campaigns").onclick();
  assert.deepEqual(clone(h.i.state.campaignDraft),before);
  assert.equal(h.get("campaign-name").value,before.name);assert.equal(h.calls.length,0);
  pass("Mes, página, tamaño de página y pestañas conservan las ediciones; navegación sin RPC");
}
{
  const h=harness();validForm(h);
  let release;
  h.rpc=async()=>new Promise(resolve=>{release=resolve;});
  const first=h.submit();await h.submit();
  assert.equal(h.calls.length,1,"double click sends only one RPC");
  const initial=h.calls[0].args;
  assert.match(initial.p_request_id,/^[0-9a-f-]{36}$/);
  assert.equal(initial.p_id,null);assert.equal(initial.p_expected_version,0);
  assert.equal(h.get("campaign-save").disabled,true);
  release({data:null,error:{message:"Respuesta perdida"}});
  await first;
  assert.equal(h.get("campaign-name").disabled,true,"Ambiguous create locks the original payload");
  h.listeners["cubica:auth-ready"]();
  assert.equal(h.i.state.campaignAttempt.p_request_id,initial.p_request_id,"AAL2 renewal preserves pending creation");
  let warned=false;const leaving={preventDefault(){warned=true;}};h.listeners.beforeunload(leaving);
  assert.equal(warned,true);assert.equal(leaving.returnValue,"");
  h.get("site-campaign-form").onreset(event);
  assert.equal(h.i.state.campaignAttempt.p_request_id,initial.p_request_id);
  h.all("[data-site-tab]").find(b=>b.dataset.siteTab==="email").onclick();
  h.all("[data-site-tab]").find(b=>b.dataset.siteTab==="campaigns").onclick();
  h.rpc=async(_,p)=>({data:responseFor(p),error:null});
  await h.submit();
  assert.deepEqual(h.calls[1].args,initial,"Retry must replay the identical request");
  assert.equal(h.get("campaign-id").value,"10000000-0000-0000-0000-000000000001");
  assert.equal(h.get("campaign-version").value,"1");
  h.input("description","Editada");await h.submit();
  assert.equal(h.calls[2].args.p_request_id,null);assert.equal(h.calls[2].args.p_expected_version,1);
  assert.equal(h.get("campaign-version").value,"2");
  h.confirm=true;h.get("site-campaign-form").onreset(event);validForm(h);await h.submit();
  assert.notEqual(h.calls[3].args.p_request_id,initial.p_request_id,"Explicit new creation receives a new key");
  pass("Creación, doble clic, respuesta perdida, reintento idéntico, edición y nueva creación explícita");
}
{
  const h=harness();validForm(h);
  h.input("name","");await h.submit();assert.equal(h.calls.length,0);
  h.input("name","Prueba");h.input("end","2026-11-13T08:00");await h.submit();assert.equal(h.calls.length,0);
  h.input("recurrence","custom");h.input("start","");h.input("end","");
  assert.equal(h.get("campaign-start").required,false);assert.equal(h.get("campaign-start").disabled,true);
  assert.equal(h.get("campaign-occurrences").required,true);
  h.input("occurrences","2026-11-14T09:00 | 2026-11-14T08:00");await h.submit();assert.equal(h.calls.length,0);
  h.input("occurrences","2026-02-30T00:00 | 2026-03-01T00:00");await h.submit();assert.equal(h.calls.length,0);
  h.input("occurrences","2026-11-14T09:00 | 2026-11-14T10:00");
  h.rpc=async(_,p)=>({data:responseFor(p),error:null});await h.submit();
  assert.equal(h.calls[0].args.p_starts_at,null);assert.equal(h.calls[0].args.p_occurrences.length,1);
  h.confirm=true;h.i.startCampaignEdit(h.i.state.admin.campaigns[0]);
  assert.equal(h.get("campaign-start").required,false);
  await h.submit();assert.equal(h.calls[1].args.p_request_id,null);
  assert.equal(h.calls[1].args.p_expected_version,1);
  h.rpc=async()=>({data:null,error:{code:"40001",message:"La campaña cambió"}});
  h.input("description","No pisar otra sesión");await h.submit();
  assert.equal(h.get("campaign-version").value,"2");assert.equal(h.get("campaign-description").value,"No pisar otra sesión");
  assert.equal(h.calls.length,3,"No automatic retry after a version conflict");
  pass("Validación por recurrencia, fechas inválidas, edición custom y conflicto de versión sin sobrescritura");
}
{
  const h=harness();validForm(h);
  const c=responseFor(h.i.campaignPayload(h.i.state.campaignDraft),{theme:{colors:{accent:"#ffffff",background:"#17172b",text:"#fafafa"},hero:{title:"Preservado"},assets:{logo:null,banner:null,background:null}},state:"disabled",version:8});
  h.i.state.admin.campaigns=[c];h.i.renderAdmin();h.confirm=true;h.i.startCampaignEdit(c);
  h.input("description","Solo descripción");h.rpc=async(_,p)=>({data:responseFor(p,{state:"disabled"}),error:null});
  await h.submit();
  assert.equal(h.calls[0].args.p_expected_version,8);assert.equal(h.calls[0].args.p_request_id,null);
  assert.deepEqual(h.calls[0].args.p_theme,c.theme);assert.equal(h.i.state.campaignOriginal.state,"disabled");
  h.confirm=false;
  await h.i.campaignAction("state",c,"published");assert.equal(h.calls.length,1);
  assert.match(h.confirmations.at(-1),/públicamente.*RPC públicas.*admin/);
  assert.equal(c.state,"disabled");
  h.confirm=true;await h.i.campaignAction("state",c,"published");
  assert.equal(h.calls[1].name,"admin_set_site_campaign_state");
  assert.equal(h.calls[1].args.p_expected_version,8);
  h.i.startCampaignEdit({...c,state:"published"});
  assert.match(h.messages.at(-1),/Duplicá o desactivá/);
  pass("Tema y estado conservados al editar; publicación cancelada sin RPC; campaña publicada protegida");
}
{
  const h=harness();validForm(h);
  for(const identity of [null,{role:"customer",aal:"aal2"},{role:"admin",aal:"aal1"}]){
    h.context.session=identity;await h.submit();await h.i.campaignAction("state",{id:"x",version:1},"published");
  }
  assert.equal(h.calls.length,0);assert.equal(h.confirmations.length,0);
  h.context.session={role:"admin",aal:"aal2"};
  let release;h.rpc=async()=>new Promise(resolve=>{release=resolve;});
  const pending=h.submit(),payload=h.calls[0].args;
  h.i.clearAdminState();release({data:responseFor(payload),error:null});await pending;
  assert.equal(h.i.state.admin,null);assert.equal(h.i.state.campaignDraft,null);
  assert.equal(h.i.state.campaignAttempt,null);
  pass("Visitante, cliente y AAL1 sin RPC; respuesta tardía no repone datos tras cerrar sesión");
}
{
  const h=harness({assets:[{id:"logo",kind:"logo",storage_path:"private/logo.png"},{id:"banner",kind:"banner",storage_path:"private/banner.png"},{id:"background",kind:"background",storage_path:"private/bg.png"}]});validForm(h);
  h.input("logo","logo");h.input("banner","banner");h.input("background-asset","background");
  await new Promise(resolve=>setImmediate(resolve));
  const preview=h.get("campaign-theme-preview");
  assert.equal(preview.querySelector("[data-campaign-preview-logo]").src,"https://assets.invalid/private/logo.png");
  assert.equal(preview.querySelector("[data-campaign-preview-banner]").hidden,false);
  assert.match(preview.style.backgroundImage,/private\/bg.png/);
  h.input("logo","");await new Promise(resolve=>setImmediate(resolve));
  assert.equal(preview.querySelector("[data-campaign-preview-logo]").hidden,true);
  assert.equal(h.calls.length,0);
  pass("Vista previa privada muestra y quita logo, banner y fondo sin persistencia");
}
{
  const h=harness();validForm(h);const payload=h.i.campaignPayload(h.i.state.campaignDraft);
  h.i.state.admin.campaigns=["draft","disabled","published"].map((state,n)=>responseFor(payload,{id:String(n),state,name:state}));
  assert.deepEqual(clone(h.i.campaignOverlapNames(payload)),["published"]);
  h.input("start","2026-11-15T00:00");h.input("end","2026-11-16T00:00");
  assert.deepEqual(clone(h.i.campaignOverlapNames(h.i.campaignPayload(h.i.state.campaignDraft))),[]);
  pass("Superposiciones consideran el formulario actual y sólo otras campañas publicadas del mes visible");
}
{
  const h=harness();
  assert.equal(h.i.localToIso("2026-11-13T00:00"),"2026-11-13T03:00:00.000Z");
  assert.equal(h.i.localToIso("2026-11-13T00:00:00.123"),"2026-11-13T03:00:00.123Z");
  assert.throws(()=>h.i.localToIso("2027-02-29T00:00"));
  h.i.state.calendarCursor="2028-02";
  const annual={id:"annual",name:"Bisiesta",priority:0,state:"draft",recurrence_mode:"annual",annual_start_month:2,annual_start_day:29,annual_start_time:"00:00:00",annual_end_month:3,annual_end_day:1,annual_end_time:"00:00:00"};
  let markup=h.i.monthCalendarV2([annual]);assert.match(markup,/2028-02-29: Bisiesta/);
  h.i.state.calendarCursor="2027-02";markup=h.i.monthCalendarV2([annual]);assert.doesNotMatch(markup,/has-campaign/);
  h.i.state.calendarCursor="2026-12";h.i.moveCampaignMonth(1);assert.equal(h.i.state.calendarCursor,"2027-01");
  h.i.moveCampaignMonth(-1);assert.equal(h.i.state.calendarCursor,"2026-12");
  const css=fs.readFileSync(new URL("../styles.css",import.meta.url),"utf8");
  assert.match(css,/@media\(max-width:900px\)\{\.site-config-grid[^}]*grid-template-columns:1fr/);
  assert.match(css,/@media\(max-width:600px\)[^\n]*\.calendar-days>button\{min-height:48px/);
  assert.match(css,/#campaign-calendar-host,#campaign-list-host,#site-campaign-form\{min-width:0\}/);
  assert.match(css,/\.campaign-theme-preview img\{max-width:100%/);
  assert.match(markup,/aria-label=/);
  pass("29/02, cambio de año, límites de zona horaria y contratos CSS responsive (sin validación visual)");
}
{
  const h=harness();validForm(h);
  const c=responseFor(h.i.campaignPayload(h.i.state.campaignDraft),{version:7,starts_at:"2026-11-13T12:00:00.123456Z",ends_at:"2026-11-14T03:00:00.654321Z"});
  h.i.state.admin.campaigns=[c];h.confirm=true;h.i.startCampaignEdit(c);h.input("description","Preservar precisión");
  h.rpc=async(_,p)=>({data:responseFor(p),error:null});await h.submit();
  assert.equal(h.calls[0].args.p_starts_at,c.starts_at);assert.equal(h.calls[0].args.p_ends_at,c.ends_at);
  h.context.session={role:"admin",aal:"aal2",supabaseUserId:"otro-admin"};h.listeners["cubica:auth-ready"]();
  assert.equal(h.i.state.campaignDraft,null);assert.equal(h.i.state.campaignOriginal,null);
  pass("Normalización datetime-local conserva timestamps no editados; cambio de administrador limpia el formulario");
}
{
  const h=harness();validForm(h);
  h.input("recurrence","annual");h.input("start","2028-12-20T09:00");h.input("end","2028-01-10T18:00");
  let p=h.i.campaignPayload(h.i.state.campaignDraft);
  assert.equal(p.p_starts_at,null);assert.equal(p.p_annual_start_month,12);assert.equal(p.p_annual_end_month,1);
  h.input("start","2028-02-29T00:00");h.input("end","2028-03-01T00:00");
  assert.equal(h.get("campaign-leap-warning").classList.contains("hidden"),false);
  h.input("priority","1.5");await h.submit();assert.equal(h.calls.length,0);
  h.input("priority","3");
  h.input("recurrence","custom");h.input("occurrences","2026-11-13T09:00 | 2026-11-14T00:00\n2026-11-13T09:00 | 2026-11-14T00:00");
  await h.submit();assert.equal(h.calls.length,0);assert.match(h.messages.at(-1),/duplicada/);
  pass("Formulario anual admite cruce de año y 29/02; prioridad fraccional y ocurrencias duplicadas se rechazan");
}
{
  const h=harness();validForm(h);const c=responseFor(h.i.campaignPayload(h.i.state.campaignDraft),{version:4});
  h.i.state.admin.campaigns=[c];h.confirm=true;
  let release;h.rpc=async()=>new Promise(resolve=>{release=resolve;});
  const pending=h.i.campaignAction("duplicate",c);await h.i.campaignAction("duplicate",c);
  assert.equal(h.calls.length,1);release({data:null,error:{message:"red"}});await pending;
  h.rpc=async()=>({data:null,error:{message:"red"}});
  await h.i.campaignAction("duplicate",c);
  assert.deepEqual(h.calls[1].args,h.calls[0].args);
  assert.equal(h.get("campaign-name").value,"Campaña local");
  pass("Duplicar también bloquea doble clic y conserva su clave al reintentar");
}
console.log("QA frontend de Campañas completada con DOM y RPC simulados; sin conexiones productivas.");
