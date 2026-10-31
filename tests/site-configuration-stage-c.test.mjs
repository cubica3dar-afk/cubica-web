import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {normalizeSuggestion,createHandler as createSuggestionHandler} from "../supabase/functions/submit-suggestion/worker.js";
import {inspectImage,AssetError,createHandler as createAssetHandler} from "../supabase/functions/site-assets/worker.js";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const migrationPaths=[
  "supabase/migrations/20261018171000_stage_c_visual_schema.sql",
  "supabase/migrations/20261018171100_stage_c_content_suggestion_schema.sql",
  "supabase/migrations/20261018171210_stage_c_visual_validators_private_functions.sql",
  "supabase/migrations/20261018171218_stage_c_active_campaign_private_function_v3.sql",
  "supabase/migrations/20261018171223_stage_c_next_change_private_function_v2.sql",
  "supabase/migrations/20261018171231_stage_c_site_experience_private_function.sql",
  "supabase/migrations/20261018171232_stage_c_admin_configuration_private_function.sql",
  "supabase/migrations/20261018171249_stage_c_appearance_asset_admin_private_functions_v2.sql",
  "supabase/migrations/20261018171254_stage_c_campaign_admin_private_functions_v2.sql",
  "supabase/migrations/20261018171255_stage_c_phrase_admin_private_function_v2.sql",
  "supabase/migrations/20261018171256_stage_c_content_faq_private_functions_v2.sql",
  "supabase/migrations/20261018171258_stage_c_suggestion_protection_private_functions_v3.sql",
  "supabase/migrations/20261024233029_stage_c_suggestion_admin_private_functions_v3.sql",
  "supabase/migrations/20261018171402_stage_c_safe_defaults_v3.sql",
  "supabase/migrations/20261025120000_stage_c_public_appearance_wrappers_closed_v3.sql",
  "supabase/migrations/20261025120100_stage_c_campaign_content_wrappers_closed_v3.sql",
  "supabase/migrations/20261025120200_stage_c_suggestion_wrappers_closed_v3.sql",
  "supabase/migrations/20261025120300_stage_c_api_storage_activation_v3.sql"
];
const migrationParts=migrationPaths.map(read);
const migration=migrationParts.join("\n");
const defaults=migrationParts.find((_,index)=>migrationPaths[index].includes("171402"));
const wrappers=migrationParts.slice(14,17).join("\n");
const activation=migrationParts.find((_,index)=>migrationPaths[index].includes("120300"));
const monolith=read("supabase/archive/20261018170000_site_configuration_stage_c.monolithic.sql");
const replacedBlock3=read("supabase/archive/20261018171200_stage_c_visual_private_functions.replaced.sql");
const invalidActiveCampaign=read("supabase/archive/20261018171221_stage_c_active_campaign_private_function.invalid_return.sql");
const rollback=read("supabase/rollback/20261018171500_stage_c_partial_safe_state.sql");
const statusProbe=read("supabase/verification/stage_c_installation_status.sql");
const html=read("index.html"),ui=read("js/site-experience.js"),shell=read("js/ui-shell.js"),css=read("styles.css");

const checks=[];
function test(name,fn){checks.push(Promise.resolve().then(fn).then(()=>console.log(`✓ ${name}`)));}

test("crea las entidades privadas y activa RLS",()=>{
  for(const table of ["site_assets","site_appearance_versions","site_campaigns","site_campaign_occurrences","site_welcome_phrases","site_content_pages","site_content_versions","site_faq_items","site_suggestions","suggestion_token_uses","suggestion_rate_limits"]){
    assert.match(migration,new RegExp(`create table if not exists private\\.${table}\\b`));
  }
  assert.equal((migration.match(/execute format\('alter table private\.%I enable row level security',t\)/g)||[]).length,2);
  assert.equal((migration.match(/stage_c_171(?:000|100)_rls_disabled/g)||[]).length,2);
});
test("divide los bloques pendientes y sustituye 4B por su versión idempotente",()=>{
  assert.deepEqual(migrationPaths.map(file=>path.basename(file).slice(0,14)),[
    "20261018171000","20261018171100","20261018171210","20261018171218","20261018171223","20261018171231","20261018171232",
    "20261018171249","20261018171254","20261018171255","20261018171256","20261018171258","20261024233029","20261018171402",
    "20261025120000","20261025120100","20261025120200","20261025120300"
  ]);
  assert.equal(new Set(migrationPaths).size,18);
  assert.equal(fs.existsSync(path.join(root,"supabase/migrations/20261018170000_site_configuration_stage_c.sql")),false);
  assert.equal(fs.existsSync(path.join(root,"supabase/migrations/20261018171200_stage_c_visual_private_functions.sql")),false);
  assert.equal(fs.existsSync(path.join(root,"supabase/migrations/20261018171501_stage_c_api_wrappers_closed.sql")),false);
  assert.ok(fs.existsSync(path.join(root,"supabase/archive/20261018171200_stage_c_visual_private_functions.replaced.sql")));
  assert.ok(fs.existsSync(path.join(root,"supabase/archive/20261018171221_stage_c_active_campaign_private_function.invalid_return.sql")));
  assert.ok(fs.existsSync(path.join(root,"supabase/archive/20261018171219_stage_c_active_campaign_private_function_v2.pre_leap.sql")));
  assert.ok(fs.existsSync(path.join(root,"supabase/archive/20261018171222_stage_c_next_change_private_function.pre_leap.sql")));
  assert.ok(fs.existsSync(path.join(root,"supabase/archive/20261018171251_stage_c_appearance_asset_admin_private_functions.pre_consistency.sql")));
  assert.ok(fs.existsSync(path.join(root,"supabase/archive/20261018171252_stage_c_campaign_admin_private_functions.pre_idempotency.sql")));
  assert.ok(fs.existsSync(path.join(root,"supabase/archive/20261018171253_stage_c_phrase_admin_private_function.pre_campaign_consistency.sql")));
  assert.ok(fs.existsSync(path.join(root,"supabase/archive/20261018171401_stage_c_safe_defaults_v2.rejected.sql")));
  assert.ok(fs.existsSync(path.join(root,"supabase/archive/20261018171302_stage_c_suggestion_protection_private_functions.pre_atomic.sql")));
  assert.ok(fs.existsSync(path.join(root,"supabase/archive/20261018171302_verify.pre_full_signatures.sql")));
  assert.ok(fs.existsSync(path.join(root,"supabase/archive/20261018171501_stage_c_api_wrappers_closed.replaced.sql")));
  for(const [index,part] of migrationParts.entries()){
    const version=path.basename(migrationPaths[index]).slice(0,14);
    assert.match(part,new RegExp(`cubica_stage_c:${version}`),migrationPaths[index]);
    assert.match(part,new RegExp(`stage_c_(?:${version.slice(-6)}|${version})_`),migrationPaths[index]);
  }
});
test("los bloques preservan la lógica y corrigen la forma de retorno y dos referencias ambiguas",()=>{
  const names=sql=>[...sql.matchAll(/^create or replace function\s+private\.([a-z0-9_]+)/gim)].map(match=>match[1]);
  assert.deepEqual(names(migrationParts[2]),["stage_c_assert_admin","stage_c_safe_text","stage_c_luminance","stage_c_validate_theme","stage_c_asset_paths"]);
  assert.deepEqual(names(migrationParts[3]),["stage_c_active_campaign"]);
  assert.deepEqual(names(migrationParts[4]),["stage_c_next_change"]);
  assert.deepEqual(names(migrationParts[5]),["get_site_experience"]);
  assert.deepEqual(names(migrationParts[6]),["admin_get_site_configuration"]);
  const functionDefinitions=sql=>{
    const lines=sql.replace(/\r/g,"").split("\n"),result=new Map();
    for(let start=0;start<lines.length;start++){
      const found=lines[start].match(/^create or replace function\s+(private\.[a-z0-9_]+)/i);
      if(!found)continue;
      let end=start;while(end<lines.length&&!lines[end].includes("$$;"))end++;
      result.set(found[1].toLowerCase(),lines.slice(start,end+1).join("\n").trim());start=end;
    }
    return result;
  };
  const originalFunctions=functionDefinitions(replacedBlock3);
  const splitFunctions=functionDefinitions(migrationParts.slice(2,7).join("\n"));
  assert.equal(originalFunctions.size,9);assert.equal(splitFunctions.size,9);
  for(const [name,definition] of originalFunctions){
    if(["private.stage_c_active_campaign","private.stage_c_next_change"].includes(name))continue;
    assert.equal(splitFunctions.get(name),definition,name);
  }
  const corrected=splitFunctions.get("private.stage_c_active_campaign");
  assert.match(invalidActiveCampaign,/select c\.\*,[\s\S]*?end effective_start/);
  assert.match(invalidActiveCampaign,/select c from candidates c/);
  assert.match(corrected,/select c campaign,/);
  assert.doesNotMatch(corrected,/select c from candidates c/);
  assert.equal((corrected.match(/\(c\.campaign\)\.[a-z_]+/g)||[]).length,29);
  assert.doesNotMatch(corrected,/::private\.site_campaigns|cast\s*\(/i);
  assert.match(corrected,/annual_start_day-1/);
  assert.match(corrected,/annual_end_day-1/);
  const correctedNext=splitFunctions.get("private.stage_c_next_change");
  assert.match(correctedNext,/select o\.starts_at[\s\S]*o\.starts_at>p_at/);
  assert.match(correctedNext,/select o\.ends_at[\s\S]*o\.ends_at>p_at/);
});
test("los subbloques conservan dependencias y quedan cerrados por separado",()=>{
  assert.match(migrationParts[2],/stage_c_assert_admin/);assert.match(migrationParts[2],/stage_c_validate_theme/);
  assert.match(migrationParts[3],/missing_prerequisite:private\.stage_c_assert_admin/);
  assert.match(migrationParts[4],/missing_prerequisite:private\.stage_c_active_campaign/);
  assert.match(migrationParts[5],/private\.stage_c_active_campaign\(p_at\)/);
  assert.match(migrationParts[5],/private\.stage_c_next_change\(p_at\)/);
  assert.match(migrationParts[8],/cubica_stage_c:20261018171218/);
  assert.match(migrationParts[7],/private\.stage_c_assert_admin/);assert.match(migrationParts[7],/private\.stage_c_validate_theme/);
  assert.match(migrationParts[10],/private\.stage_c_assert_admin/);assert.match(migrationParts[10],/private\.stage_c_safe_text/);
  assert.match(wrappers,/private\.get_site_experience\(now\(\)\)/);
  for(const [part,version] of migrationParts.slice(2,7).map((part,index)=>[part,["171210","171218","171223","171231","171232"][index]])){
    assert.match(part,new RegExp(`cubica_stage_c:20261018${version}`));
    assert.match(part,new RegExp(`stage_c_${version}_public_execute`));
    assert.match(part,new RegExp(`stage_c_${version}_unrestricted_search_path`));
    assert.match(part,/from public,anon,authenticated,service_role/);
  }
});
test("conserva el esquema previo y documenta los auxiliares nuevos hasta 5C v3",()=>{
  const names=(sql,pattern)=>[...sql.matchAll(pattern)].map(match=>match[1].toLowerCase()).sort();
  const oldTables=names(monolith,/^create table if not exists\s+([a-z0-9_.]+)/gim);
  const newTables=names(migration,/^create table if not exists\s+([a-z0-9_.]+)/gim);
  assert.deepEqual(newTables.filter(name=>name!=="private.suggestion_moderation_history"),oldTables);
  assert.ok(newTables.includes("private.suggestion_moderation_history"));
  const oldIndexes=names(monolith,/^create (?:unique )?index if not exists\s+([a-z0-9_]+)/gim);
  const newIndexes=names(migration,/^create (?:unique )?index if not exists\s+([a-z0-9_]+)/gim);
  const intentionalIndexes=new Set(["site_appearance_source_draft_once","site_content_one_publish_per_draft","site_faq_unique_current_question","suggestion_request_once","suggestion_token_cleanup","suggestion_payload_lookup","suggestion_rate_limit_cleanup","site_suggestions_admin_v3","suggestion_token_duplicate_lookup","suggestion_moderation_history_timeline"]);
  assert.deepEqual(newIndexes.filter(name=>!intentionalIndexes.has(name)),oldIndexes);
  for(const name of intentionalIndexes)assert.ok(newIndexes.includes(name));
  const functions=sql=>{
    const lines=sql.replace(/\r/g,"").split("\n"),result=new Map();
    for(let start=0;start<lines.length;start++){
      const found=lines[start].match(/^create (?:or replace )?function\s+([a-z0-9_.]+)/i);
      if(!found)continue;
      let end=start;
      while(end<lines.length&&!lines[end].includes("$$;"))end++;
      assert.ok(end<lines.length,`Función sin cierre: ${found[1]}`);
      result.set(found[1].toLowerCase(),lines.slice(start,end+1).join("\n").trim());
      start=end;
    }
    return result;
  };
  const oldFunctions=functions(monolith),newFunctions=functions(migration);
  assert.equal(newFunctions.size,69);
  const intentionalNewFunctions=[
    "private.stage_c_begin_campaign_operation","private.stage_c_complete_campaign_operation",
    "private.stage_c_normalize_faq_question","private.admin_list_faq","private.admin_restore_faq",
    "private.stage_c_apply_suggestion_limit","private.submit_protected_suggestion",
    "private.stage_c_prevent_suggestion_history_mutation","private.stage_c_suggestion_transition_allowed",
    "private.admin_get_suggestion","private.admin_set_suggestion_lifecycle",
    "public.submit_protected_suggestion","public.admin_list_faq","public.admin_restore_faq",
    "public.admin_get_suggestion","public.admin_set_suggestion_lifecycle",
    "private.stage_c_public_asset_allowed"
  ];
  const replacedOldFunctions=[
    "private.consume_suggestion_protection","private.submit_public_suggestion",
    "public.consume_suggestion_protection","public.submit_public_suggestion"
  ];
  assert.deepEqual(
    [...newFunctions.keys()].filter(name=>!intentionalNewFunctions.includes(name)).sort(),
    [...oldFunctions.keys()].filter(name=>!replacedOldFunctions.includes(name)).sort()
  );
  for(const [signature,definition] of oldFunctions){
    if([
      "private.stage_c_active_campaign","private.stage_c_next_change","private.admin_upsert_site_campaign",
      "private.admin_set_site_campaign_state","private.admin_duplicate_site_campaign","private.admin_delete_site_campaign",
      "private.admin_upsert_welcome_phrase",
      "private.stage_c_validate_theme","private.admin_save_site_appearance_draft","private.admin_publish_site_appearance",
      "private.admin_reset_site_appearance_draft","private.admin_restore_original_appearance_draft",
       "private.admin_register_site_asset","private.admin_retire_site_asset",
       "private.get_public_content_page","private.get_public_faq","private.stage_c_validate_content",
       "private.admin_save_content_draft","private.admin_publish_content_page",
       "private.admin_restore_content_version","private.admin_upsert_faq","private.cleanup_suggestion_protection",
       "private.admin_list_suggestions","private.admin_update_suggestion",
       "private.consume_suggestion_protection","private.submit_public_suggestion",
       "public.admin_reset_site_appearance_draft","public.admin_restore_original_appearance_draft",
       "public.admin_upsert_site_campaign","public.admin_set_site_campaign_state","public.admin_duplicate_site_campaign",
       "public.admin_list_suggestions","public.admin_update_suggestion",
       "public.consume_suggestion_protection","public.submit_public_suggestion"
    ].includes(signature))continue;
    assert.equal(newFunctions.get(signature),definition,signature);
  }
});
test("los bloques privados permanecen cerrados y 7A-1/2/3 crean wrappers sin activarlos",()=>{
  for(const part of migrationParts.slice(0,14))assert.doesNotMatch(part,/create or replace function public\./i);
  assert.match(migrationParts[0],/enable row level security/);
  assert.match(migrationParts[1],/enable row level security/);
  assert.doesNotMatch(migrationParts[1],/create policy site_assets_public_read/i);
  assert.match(activation,/create policy site_assets_public_read/);
  assert.match(wrappers,/create or replace function public\.get_site_experience/);
  assert.equal((wrappers.match(/^create or replace function public\./gim)||[]).length,27);
  assert.equal((wrappers.match(/revoke all on function/g)||[]).length,3);
  assert.deepEqual(migrationParts.slice(14,17).map(part=>(part.match(/^create or replace function public\./gim)||[]).length),[10,11,6]);
  assert.doesNotMatch(wrappers,/grant execute on function/);
  assert.match(activation,/grant execute on function public\.get_site_experience/);
});
test("cada bloque privado revoca EXECUTE antes de confirmar",()=>{
  for(const part of migrationParts.slice(2,13)){
    assert.match(part,/revoke all on function/);
    assert.match(part,/from public,anon,authenticated,service_role/);
    assert.match(part,/premature_execute/);
  }
});
test("mantiene recursos visuales privados y publica solo referencias autorizadas",()=>{
  assert.match(migration,/values\('site-assets','site-assets',false/);
  assert.match(migration,/a\.public_since is not null\s+and a\.retired_at is null/);
  assert.match(activation,/site_assets_public_read[\s\S]*private\.stage_c_public_asset_allowed\(name\)/);
  assert.match(migration,/site_assets_admin_read[\s\S]*private\.is_admin\(\)/);
  assert.doesNotMatch(html,/SUPABASE_SERVICE_ROLE_KEY|TURNSTILE_SECRET_KEY|SUGGESTION_RATE_LIMIT_SALT/);
});
test("toda acción administrativa exige el guard central con MFA",()=>{
  assert.match(migration,/private\.stage_c_assert_admin\(\)/);
  const adminBodies=migration.match(/create or replace function private\.admin_[\s\S]*?\$\$;/g)||[];
  assert.ok(adminBodies.length>=10);
  for(const body of adminBodies)assert.match(body,/perform private\.stage_c_assert_admin\(\)/);
  assert.match(activation,/'public\.admin_get_site_configuration\(\)'::regprocedure/);
  assert.match(activation,/execute 'revoke all on function '\|\|signature\|\|' from public,anon,service_role'/);
  assert.match(activation,/execute 'grant execute on function '\|\|signature\|\|' to authenticated'/);
});
test("campañas usan horario argentino, omiten fechas inexistentes y desempatan de forma determinista",()=>{
  assert.match(migration,/America\/Argentina\/Buenos_Aires/);
  assert.match(migration,/order by \(c\.campaign\)\.priority desc,c\.effective_start desc,\(c\.campaign\)\.published_at desc,\(c\.campaign\)\.id asc/);
  assert.match(migration,/apply_email_theme boolean not null default false check\(apply_email_theme=false\)/);
  assert.match(migration,/site_campaign_email_future check\(email_theme_key is null and apply_email_theme=false\)/);
  assert.match(migrationParts[4],/generate_series\([^\n]+\+8\)/);
  assert.match(migrationParts[8],/case when p_annual_start_month=2 and p_annual_start_day=29 then 2000 else 2001 end/);
  assert.match(migrationParts[8],/case when p_annual_end_month=2 and p_annual_end_day=29 then 2000 else 2001 end/);
  assert.match(ui,/Solo se ejecutará en años bisiestos/);
});
test("campañas admiten duplicación, retiro lógico, fechas móviles y navegación mensual",()=>{
  assert.match(migration,/admin_duplicate_site_campaign/);assert.match(migration,/admin_delete_site_campaign/);assert.match(migration,/deleted_at=now\(\)/);
  assert.match(migrationParts[8],/site_campaign_idempotency/);
  assert.match(migrationParts[8],/p_request_id uuid/);
  assert.match(migrationParts[8],/for update/);
  assert.match(migrationParts[8],/for share/);
  assert.match(ui,/data-calendar-move/);assert.match(ui,/campaign-occurrences/);assert.match(ui,/data-duplicate-campaign/);assert.match(ui,/data-delete-campaign/);
});
test("un borrador nunca se filtra como experiencia pública",()=>{
  const publicResolver=migration.match(/create or replace function private\.get_site_experience[\s\S]*?\$\$;/)?.[0]||"";
  assert.doesNotMatch(publicResolver,/state='draft'/);
  assert.match(publicResolver,/state='published'/);
});
test("contenido legal nace sin versión publicada y rechaza código",()=>{
  assert.match(migration,/insert into private\.site_content_pages/);
  assert.doesNotMatch(defaults,/insert into private\.site_content_versions/);
  assert.match(migration,/script\|iframe\|object\|embed\|style/);
  assert.match(ui,/Contenido aún no publicado/);
});
test("contenido conserva historial y recupera una versión solo en borrador",()=>{
  assert.match(migration,/admin_restore_content_version/);assert.match(migration,/'history'/);assert.match(ui,/data-restore-page-version/);
  assert.match(ui,/La página pública no cambiará/);
});
test("FAQ y frases incluyen búsqueda, paginación, orden y soft-delete",()=>{
  assert.match(ui,/faq-page-size/);assert.match(ui,/phrase-page-size/);assert.match(ui,/faq-search/);assert.match(ui,/phrase-search/);
  assert.match(migration,/site_faq_items[\s\S]*deleted_at timestamptz/);assert.match(migration,/site_welcome_phrases[\s\S]*deleted_at timestamptz/);
});
test("sugerencias no aceptan user_id y tienen Turnstile separado",()=>{
  assert.match(ui,/action:"suggestion_submit"/);
  assert.doesNotMatch(ui,/p_verified_user_id|user_id/);
  assert.match(migration,/auth\.role\(\)<>'service_role'/);
  assert.match(migration,/function public\.submit_protected_suggestion[\s\S]*?security definer set search_path=''/);
  assert.match(migration,/grant execute on function public\.submit_protected_suggestion[\s\S]*to service_role/);
  assert.match(migration,/revoke all on function public\.submit_protected_suggestion[\s\S]*from public,anon,authenticated/);
  assert.doesNotMatch(migration,/grant execute on function private\.consume_suggestion_protection.*to service_role/);
  assert.match(migration,/function public\.cleanup_suggestion_protection\(\)[\s\S]*?auth\.role\(\)<>'service_role'/);
  assert.match(migration,/function private\.submit_protected_suggestion[\s\S]*?security definer set search_path=''/);
  assert.match(migration,/function private\.stage_c_apply_suggestion_limit[\s\S]*?security invoker set search_path=''/);
  assert.match(migration,/v_actor_limit:=case when p_actor_kind='user' then 5 else 3 end/);
  assert.match(migration,/p_network_hash,'network',20/);
  assert.match(migration,/result_code='rate_limited'/);
  assert.doesNotMatch(migration,/grant execute on function private\.submit_protected_suggestion.*to service_role/);
});
test("5B v3 permanece cerrado y wrappers/Edge usan el contrato atómico",()=>{
  assert.match(migrationParts[11],/cubica_stage_c:20261018171258/);
  assert.match(migrationParts[11],/submit_protected_suggestion/);
  assert.match(migrationParts[11],/suggestion-request:/);
  assert.match(migrationParts[11],/suggestion-payload:/);
  assert.match(migrationParts[11],/was_duplicate/);
  assert.doesNotMatch(migrationParts[11],/create or replace function public\./i);
  assert.match(migrationParts[12],/cubica_stage_c:20261018171258/);
  assert.match(migrationParts[16],/public\.submit_protected_suggestion/);
  assert.doesNotMatch(migrationParts[16],/create or replace function public\.consume_suggestion_protection/);
  assert.match(activation,/public\.submit_protected_suggestion/);
});
test("sugerencias admiten estado aceptada, filtros y orden sin lectura pública",()=>{
  assert.match(migration,/accepted/);assert.match(migration,/p_category text default 'all'/);assert.match(migration,/p_sort text default 'recent'/);
  assert.match(ui,/admin-suggestion-category/);assert.match(ui,/admin-suggestion-sort/);
  assert.doesNotMatch(migration,/grant select on private\.site_suggestions/i);
});
test("la navegación conserva el control MFA y agrega Configuración",()=>{
  assert.match(shell,/"configuration"\]/);
  assert.match(shell,/cubicaAdminMfaChallengeRequired/);
  assert.match(html,/data-sidebar-section="configuration"[^>]*data-stage-c="admin"[^>]*class="admin-only hidden"/);
  assert.match(ui,/stageCMode/);assert.match(ui,/if\(!publicEnabled\(\)\)return/);
  assert.match(html,/data-public-page="suggestions"/);
});
test("la interfaz incluye preview aislado, calendario y diseño responsive",()=>{
  assert.match(ui,/preview:"desktop"/);assert.match(ui,/site-preview \$\{state\.preview\}/);assert.match(ui,/campaign-calendar/);assert.match(ui,/America\/Argentina\/Buenos_Aires/);
  assert.match(css,/@media\(max-width:600px\)/);assert.match(css,/\.site-preview\.mobile/);
});
test("el rollback preserva datos y vuelve privado el bucket",()=>{
  assert.doesNotMatch(rollback,/drop (?:table|function)|delete from private|truncate/i);
  assert.match(rollback,/update storage\.buckets set public=false/);
  assert.match(rollback,/to_regprocedure\(signature\)/);
  assert.match(rollback,/revoke all on function/);
  assert.match(rollback,/enable row level security/);
});
test("la sonda posterior a una desconexión cruza registro y objeto centinela",()=>{
  const registryNames=[
    "stage_c_20261018171000_visual_schema","stage_c_20261018171100_content_suggestion_schema",
    "stage_c_20261018171210_visual_validators_private_functions","stage_c_20261018171218_active_campaign_private_function_v3",
    "stage_c_20261018171223_next_change_private_function_v2","stage_c_20261018171231_site_experience_private_function",
    "stage_c_20261018171232_admin_configuration_private_function","stage_c_20261018171249_appearance_asset_admin_private_functions_v2",
    "stage_c_20261018171254_campaign_admin_private_functions_v2","stage_c_20261018171255_phrase_admin_private_function_v2",
    "stage_c_20261018171256_content_faq_private_functions_v2","stage_c_20261018171258_suggestion_protection_private_functions_v3",
    "stage_c_20261024233029_suggestion_admin_private_functions_v3","stage_c_20261018171402_safe_defaults_v3",
    "stage_c_20261025120000_public_appearance_wrappers_closed_v3","stage_c_20261025120100_campaign_content_wrappers_closed_v3",
    "stage_c_20261025120200_suggestion_wrappers_closed_v3","stage_c_20261025120300_api_storage_activation_v3"
  ];
  for(const [index,version] of migrationPaths.map(file=>path.basename(file).slice(0,14)).entries()){
    assert.match(statusProbe,new RegExp(`'${version}','${registryNames[index]}'`));
    assert.match(statusProbe,new RegExp(`cubica_stage_c:${version}`));
  }
  assert.match(statusProbe,/stage_c_20261018171200_visual_private_functions/);
  assert.match(statusProbe,/stage_c_20261018171221_active_campaign_private_function/);
  assert.match(statusProbe,/original_replaced/);
  assert.match(statusProbe,/effective_version/);
  assert.match(statusProbe,/permissions_ok/);
  assert.match(statusProbe,/expected_object_count/);
  assert.match(statusProbe,/supabase_migrations\.schema_migrations/);
  assert.match(statusProbe,/obj_description/);
});
test("los artefactos SQL conservan cierres dollar-quote balanceados",()=>{
  const verificationPaths=fs.readdirSync(path.join(root,"supabase/verification")).filter(name=>/^20261018171\d+_verify[.]sql$/.test(name));
  for(const [name,sql] of [
    ...migrationPaths.map((name,index)=>[name,migrationParts[index]]),
    ["rollback",rollback],["status",statusProbe],
    ...verificationPaths.map(name=>[name,read(`supabase/verification/${name}`)])
  ])assert.equal((sql.match(/\$\$/g)||[]).length%2,0,name);
});
test("normaliza una sugerencia válida y rechaza categorías o cuerpos inválidos",()=>{
  const good=normalizeSuggestion({request_id:"018f0c2d-0ec4-7f88-8c8a-cd20274bb20a",category:"funcionalidad",subject:"Nueva variante",description:"Me gustaría otro color disponible",turnstile_token:"token"});
  assert.equal(good.category,"funcionalidad");
  assert.throws(()=>normalizeSuggestion({...good,category:"admin"}),/invalid_request/);
  assert.throws(()=>normalizeSuggestion({...good,description:"corto"}),/invalid_request/);
});
test("valida bytes y dimensiones reales de PNG",()=>{
  const png=new Uint8Array(24);png.set([137,80,78,71,13,10,26,10],0);const view=new DataView(png.buffer);view.setUint32(16,800);view.setUint32(20,600);
  assert.deepEqual(inspectImage(png,"image/png"),{mime:"image/png",extension:"png",width:800,height:600,size:24});
  assert.throws(()=>inspectImage(new Uint8Array(24),"image/png"),AssetError);
  assert.throws(()=>inspectImage(png,"image/svg+xml"),AssetError);
});
test("Siteverify válido crea una sugerencia y nunca un pedido",async()=>{
  const calls=[],now=Date.now();
  const fetchImpl=async(url,options={})=>{calls.push({url:String(url),body:String(options.body||"")});if(String(url).includes("siteverify"))return Response.json({success:true,hostname:"cubica3d.ar",action:"suggestion_submit",challenge_ts:new Date(now).toISOString()});if(String(url).includes("submit_protected_suggestion"))return Response.json({status:"accepted",suggestion_id:"018f0c2d-0ec4-7f88-8c8a-cd20274bb20b",idempotent:false,duplicate:false});throw new Error("unexpected call");};
  const env=name=>({SUPABASE_URL:"https://example.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"secret",TURNSTILE_SECRET_KEY:"turnstile",SUGGESTION_RATE_LIMIT_SALT:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"})[name];
  const handler=createSuggestionHandler({env,fetchImpl,now:()=>now});
  const response=await handler(new Request("https://example.test",{method:"POST",headers:{origin:"https://cubica3d.ar","content-type":"application/json","cf-connecting-ip":"203.0.113.8"},body:JSON.stringify({request_id:"018f0c2d-0ec4-7f88-8c8a-cd20274bb20a",category:"funcionalidad",subject:"Nueva variante",description:"Me gustaría otro color disponible",turnstile_token:"valid-token"})}));
  const responseBody=await response.clone().text();assert.equal(response.status,201,`${responseBody} ${JSON.stringify(calls)}`);assert.equal(calls.filter(x=>x.url.includes("submit_protected_suggestion")).length,1);assert.equal(calls.filter(x=>x.url.includes("create_order")||x.url.includes("orders")).length,0);assert.match(calls[0].body,/response=valid-token/);assert.doesNotMatch(calls[0].body,/idempotency_key=018f0c2d/);
});
test("Siteverify rechaza hostname y acción incorrectos antes de persistir",async()=>{
  for(const bad of [{hostname:"evil.example",action:"suggestion_submit"},{hostname:"cubica3d.ar",action:"create_order"}]){
    const calls=[],now=Date.now(),fetchImpl=async url=>{calls.push(String(url));return Response.json({success:true,...bad,challenge_ts:new Date(now).toISOString()});};
    const env=name=>({SUPABASE_URL:"https://example.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"secret",TURNSTILE_SECRET_KEY:"turnstile",SUGGESTION_RATE_LIMIT_SALT:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"})[name];
    const response=await createSuggestionHandler({env,fetchImpl,now:()=>now})(new Request("https://example.test",{method:"POST",headers:{origin:"https://cubica3d.ar","content-type":"application/json","cf-connecting-ip":"203.0.113.8"},body:JSON.stringify({request_id:"018f0c2d-0ec4-7f88-8c8a-cd20274bb20a",category:"funcionalidad",subject:"Nueva variante",description:"Me gustaría otro color disponible",turnstile_token:"token"})}));
    assert.equal(response.status,403);assert.equal(calls.length,1);
  }
});
test("Siteverify simulado rechaza token inválido o expirado sin tocar Supabase",async()=>{
  for(const result of [
    {success:false,"error-codes":["invalid-input-response"]},
    {success:false,"error-codes":["timeout-or-duplicate"]},
    {success:true,hostname:"cubica3d.ar",action:"suggestion_submit",challenge_ts:new Date(Date.now()-331000).toISOString()}
  ]){
    const calls=[],fetchImpl=async url=>{calls.push(String(url));return Response.json(result);};
    const env=name=>({SUPABASE_URL:"https://example.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"secret",TURNSTILE_SECRET_KEY:"turnstile",SUGGESTION_RATE_LIMIT_SALT:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"})[name];
    const response=await createSuggestionHandler({env,fetchImpl,now:Date.now})(new Request("https://example.test",{method:"POST",headers:{origin:"https://cubica3d.ar","content-type":"application/json","cf-connecting-ip":"203.0.113.8"},body:JSON.stringify({request_id:"018f0c2d-0ec4-7f88-8c8a-cd20274bb20a",category:"funcionalidad",subject:"Nueva variante",description:"Me gustaría otro color disponible",turnstile_token:"token"})}));
    assert.equal(response.status,400);assert.equal(calls.length,1);assert.match(calls[0],/siteverify/);
  }
});
test("fallo de red simulado de Siteverify devuelve 503 sin persistencia",async()=>{
  const calls=[],fetchImpl=async url=>{calls.push(String(url));throw new Error("network");};
  const env=name=>({SUPABASE_URL:"https://example.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"secret",TURNSTILE_SECRET_KEY:"turnstile",SUGGESTION_RATE_LIMIT_SALT:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"})[name];
  const response=await createSuggestionHandler({env,fetchImpl})(new Request("https://example.test",{method:"POST",headers:{origin:"https://cubica3d.ar","content-type":"application/json","cf-connecting-ip":"203.0.113.8"},body:JSON.stringify({request_id:"018f0c2d-0ec4-7f88-8c8a-cd20274bb20a",category:"funcionalidad",subject:"Nueva variante",description:"Me gustaría otro color disponible",turnstile_token:"token"})}));
  assert.equal(response.status,503);assert.equal(calls.length,2);assert.ok(calls.every(x=>x.includes("siteverify")));
});
test("el rate limit corta el envío antes de insertar",async()=>{
  const calls=[],now=Date.now(),fetchImpl=async(url)=>{calls.push(String(url));if(String(url).includes("siteverify"))return Response.json({success:true,hostname:"cubica3d.ar",action:"suggestion_submit",challenge_ts:new Date(now).toISOString()});if(String(url).includes("submit_protected_suggestion"))return Response.json({status:"rate_limited",retry_after_seconds:3600});throw new Error("unexpected");};
  const env=name=>({SUPABASE_URL:"https://example.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"secret",TURNSTILE_SECRET_KEY:"turnstile",SUGGESTION_RATE_LIMIT_SALT:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"})[name];
  const response=await createSuggestionHandler({env,fetchImpl,now:()=>now})(new Request("https://example.test",{method:"POST",headers:{origin:"https://cubica3d.ar","content-type":"application/json","cf-connecting-ip":"203.0.113.8"},body:JSON.stringify({request_id:"018f0c2d-0ec4-7f88-8c8a-cd20274bb20a",category:"error",subject:"Error visible",description:"La página muestra un problema reproducible",turnstile_token:"token"})}));
  assert.equal(response.status,429);assert.equal(calls.filter(x=>x.includes("submit_protected_suggestion")).length,1);
});
test("la subida rechaza una sesión sin MFA antes de tocar Storage",async()=>{
  const calls=[],fetchImpl=async url=>{calls.push(String(url));if(String(url).includes("/auth/v1/user"))return Response.json({id:"018f0c2d-0ec4-7f88-8c8a-cd20274bb20a"});if(String(url).includes("admin_get_site_configuration"))return Response.json({message:"AAL2 required"},{status:403});throw new Error("Storage no debe invocarse");};
  const env=name=>({SUPABASE_URL:"https://example.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"secret"})[name];
  const response=await createAssetHandler({env,fetchImpl})(new Request("https://example.test",{method:"POST",headers:{origin:"https://cubica3d.ar",authorization:"Bearer aal1"},body:new FormData()}));
  assert.equal(response.status,403);assert.equal(calls.some(x=>x.includes("/storage/v1/object")),false);
});

await Promise.all(checks);
console.log(`\nEtapa C: ${checks.length} comprobaciones superadas.`);

