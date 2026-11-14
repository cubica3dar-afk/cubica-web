import assert from "node:assert/strict";
import fs from "node:fs";
import {PGlite} from "@electric-sql/pglite";
import {harness,validForm,clone,event} from "./campaign-test-harness.mjs";
const read=file=>fs.readFileSync(new URL("../"+file,import.meta.url),"utf8");
const db=new PGlite();await db.waitReady;
try{
  // In-memory PostgreSQL only. No connection string, HTTP, production client or external seed.
  await db.exec(read("supabase/diagnostics/stage_c_4a_isolated_bootstrap.sql"));
  await db.exec("create table auth.users(id uuid primary key); insert into auth.users values('00000000-0000-0000-0000-000000000099')");
  await db.exec("create table private.site_campaign_occurrences(id bigint generated always as identity primary key,campaign_id uuid not null references private.site_campaigns(id),starts_at timestamptz not null,ends_at timestamptz not null,created_at timestamptz default now(),created_by uuid,check(starts_at<ends_at),unique(campaign_id,starts_at,ends_at))");
  await db.exec("create table private.site_welcome_phrases(id bigint generated always as identity primary key,campaign_id uuid references private.site_campaigns(id),phrase text,active boolean default true,sort_order integer default 0,version integer default 1,created_at timestamptz default now(),created_by uuid,updated_at timestamptz default now(),updated_by uuid,deleted_at timestamptz)");
  await db.exec("select set_config('app.test_uid','00000000-0000-0000-0000-000000000099',false); select set_config('app.test_admin','true',false); select set_config('app.test_aal','aal2',false)");
  for(const file of ["20261018171218_stage_c_active_campaign_private_function_v3.sql","20261018171249_stage_c_appearance_asset_admin_private_functions_v2.sql","20261018171254_stage_c_campaign_admin_private_functions_v2.sql"])await db.exec(read("supabase/migrations/"+file));
  const keys=["p_id","p_name","p_description","p_priority","p_recurrence_mode","p_starts_at","p_ends_at","p_annual_start_month","p_annual_start_day","p_annual_start_time","p_annual_end_month","p_annual_end_day","p_annual_end_time","p_theme","p_occurrences","p_expected_version","p_request_id"];
  const sql="select private.admin_upsert_site_campaign($1::uuid,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8,$9,$10::time,$11,$12,$13::time,$14::jsonb,$15::jsonb,$16,$17::uuid) value";
  const upsert=async p=>(await db.query(sql,keys.map(key=>["p_theme","p_occurrences"].includes(key)?JSON.stringify(p[key]):p[key]))).rows[0].value;
  const h=harness();validForm(h);let loseResponse=true;
  h.rpc=async(name,p)=>{
    assert.equal(name,"admin_upsert_site_campaign");
    try{const result=await upsert(p);if(loseResponse){loseResponse=false;throw new TypeError("Respuesta perdida después del COMMIT local");}return {data:result,error:null};}
    catch(error){return {data:null,error};}
  };
  await h.submit();
  assert.equal((await db.query("select count(*)::int n from private.site_campaigns")).rows[0].n,1);
  const request=clone(h.calls[0].args);
  await h.submit();assert.deepEqual(h.calls[1].args,request);
  assert.equal((await db.query("select count(*)::int n from private.site_campaigns")).rows[0].n,1);
  const id=h.get("campaign-id").value;assert.equal(h.get("campaign-version").value,"1");
  h.input("description","Editada desde formulario");await h.submit();
  assert.equal(h.calls[2].args.p_request_id,null);assert.equal(h.get("campaign-version").value,"2");
  const row=(await db.query("select * from private.site_campaigns where id=$1",[id])).rows[0];
  assert.equal(row.description,"Editada desde formulario");assert.equal(row.state,"draft");
  // Simulate a different session's completed update sequentially, not real concurrency.
  await upsert({...h.calls[2].args,p_description:"Edición externa",p_expected_version:2});
  h.input("description","Versión obsoleta");await h.submit();
  assert.equal(h.get("campaign-version").value,"2");
  assert.equal((await db.query("select description from private.site_campaigns where id=$1",[id])).rows[0].description,"Edición externa");
  assert.match(h.messages.at(-1),/cambió/);
  console.log("✓ Formulario real → SQL local: creación, replay tras COMMIT, una sola fila, edición y versión obsoleta");
  h.confirm=true;h.get("site-campaign-form").onreset(event);validForm(h);
  h.input("recurrence","custom");h.input("start","");h.input("end","");
  h.input("occurrences","2026-12-31T23:00 | 2027-01-02T00:00");
  await h.submit();const customId=h.get("campaign-id").value;
  h.input("description","Custom editada");await h.submit();
  assert.equal(h.get("campaign-version").value,"2");
  assert.equal((await db.query("select count(*)::int n from private.site_campaign_occurrences where campaign_id=$1",[customId])).rows[0].n,1);
  // Database also rejects AAL1 even if the client gate were bypassed.
  await db.exec("select set_config('app.test_aal','aal1',false)");
  await assert.rejects(()=>upsert({...h.calls.at(-1).args,p_expected_version:2}),/MFA|AAL2|segundo/i);
  await db.exec("select set_config('app.test_aal','aal2',false)");
  console.log("✓ Custom se guarda/edita sin Inicio/Fin; SQL rechaza AAL1");
  await db.exec("update private.site_campaigns set state='disabled'");
  const scenarios=[
    {name:"Única cruza mes",recurrence_mode:"none",starts_at:"2026-11-30T23:30:00-03:00",ends_at:"2026-12-01T00:30:00-03:00",points:["2026-11-30T23:29:59","2026-11-30T23:30:00","2026-12-01T00:00:00","2026-12-01T00:30:00"]},
    {name:"Custom cruza año",recurrence_mode:"custom",occurrences:[{starts_at:"2026-12-31T23:00:00-03:00",ends_at:"2027-01-02T00:00:00-03:00"}],points:["2026-12-31T22:59:59","2026-12-31T23:00:00","2027-01-01T12:00:00","2027-01-02T00:00:00"]},
    {name:"Anual cruza año",annual:[12,20,"09:00:00",1,10,"18:00:00"],points:["2026-12-20T08:59:59","2026-12-20T09:00:00","2027-01-05T12:00:00","2027-01-10T18:00:00"]},
    {name:"Anual mismo límite dura año",annual:[7,1,"00:00:00",7,1,"00:00:00"],points:["2026-06-30T23:59:59","2026-07-01T00:00:00","2027-07-01T00:00:00"]},
    {name:"Inicio bisiesto",annual:[2,29,"00:00:00",3,1,"00:00:00"],points:["2027-02-28T12:00:00","2027-03-01T00:00:00","2028-02-29T00:00:00","2028-02-29T23:59:59","2028-03-01T00:00:00","2100-02-28T12:00:00","2104-02-29T12:00:00"]},
    {name:"Fin bisiesto cruza año",annual:[12,20,"00:00:00",2,29,"00:00:00"],points:["2026-12-25T12:00:00","2027-01-05T12:00:00","2027-12-20T00:00:00","2028-01-05T12:00:00","2028-02-29T00:00:00"]},
    {name:"Anual cruza mes",annual:[11,30,"23:30:00",12,1,"00:30:00"],points:["2026-11-30T23:29:59","2026-11-30T23:30:00","2026-12-01T00:00:00","2026-12-01T00:30:00"]}
  ];
  for(const scenario of scenarios){
    const a=scenario.annual||[null,null,null,null,null,null];
    const c=(await db.query("insert into private.site_campaigns(name,state,recurrence_mode,starts_at,ends_at,annual_start_month,annual_start_day,annual_start_time,annual_end_month,annual_end_day,annual_end_time,published_at) values($1,'published',$2,$3,$4,$5,$6,$7,$8,$9,$10,now()) returning *",[scenario.name,scenario.recurrence_mode||"annual",scenario.starts_at||null,scenario.ends_at||null,...a])).rows[0];
    const occurrences=(scenario.occurrences||[]).map(o=>({...o,campaign_id:c.id}));
    for(const o of occurrences)await db.query("insert into private.site_campaign_occurrences(campaign_id,starts_at,ends_at) values($1,$2,$3)",[c.id,o.starts_at,o.ends_at]);
    for(const point of scenario.points){
      const iso=h.i.localToIso(point),t=Date.parse(iso),ranges=h.i.campaignIntervals(c,t,t+1,occurrences);
      const uiActive=ranges.some(([start,end])=>start<=t&&t<end);
      const backend=(await db.query("select (private.stage_c_active_campaign($1::timestamptz)).id id",[iso])).rows[0].id;
      assert.equal(uiActive,backend===c.id,scenario.name+" / "+point);
    }
    await db.query("update private.site_campaigns set state='disabled' where id=$1",[c.id]);
  }
  console.log("✓ Calendario contrastado contra SQL autoritativo: única, custom, anual, cruces, 29/02, siglo 2100 y límites [inicio,fin)");
  console.log("○ Concurrencia real entre conexiones: NO EJECUTADA; conflicto secuencial y doble clic sí verificados.");
}finally{await db.close();}
