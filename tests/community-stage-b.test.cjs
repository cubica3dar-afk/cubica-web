const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const html=read('index.html'),js=read('js/community-ui.js'),css=read('styles.css');
const migration=read('supabase/migrations/20261018043000_community_moderation_stage_b.sql');
const rollback=read('supabase/rollback/20261018043000_community_moderation_stage_b_rollback.sql');
const sqlTest=read('tests/community-stage-b-rollback.sql');

for(const id of ['community-admin-tabs','community-admin-comments','community-admin-users','community-admin-terms','community-admin-settings','community-admin-history','community-admin-action-modal']){
  assert.equal((html.match(new RegExp(`id="${id}"`,'g'))||[]).length,1,`${id} missing or duplicated`);
}
for(const tab of ['comments','users','terms','settings','history'])assert.match(html,new RegExp(`data-community-admin-tab="${tab}"`));
for(const size of [10,25,50])assert.match(js,new RegExp(`\\[10,25,50\\]`));
assert.match(css,/\.community-admin-toolbar/);assert.match(css,/@media\(max-width:430px\)/);
assert.match(html,/js\/community-ui\.js\?v=community-stage-b1/);

for(const name of ['get_admin_community_comments','admin_moderate_community_comment','get_admin_community_users','admin_set_community_user_block','get_admin_community_terms','admin_manage_community_term','get_admin_community_settings','admin_set_community_link_blocking','get_admin_community_history']){
  assert.match(js,new RegExp(`"${name}"`),`${name} not used by UI`);
  assert.match(migration,new RegExp(`function public\\.${name}\\(`),`${name} public wrapper missing`);
}
assert.doesNotMatch(js,/\.from\(["'](?:community_|product_reactions|comment_likes)/,'frontend must not read private moderation tables');
assert.match(js,/cubicaAdminMfaAccessAllowed/);assert.match(js,/participation_restricted/);assert.match(js,/Podés seguir navegando y comprando normalmente/);
assert.match(js,/data-admin-comment="delete"/);assert.match(js,/data-admin-user/);assert.match(js,/p_reason/);

for(const table of ['community_user_restrictions','community_forbidden_terms','community_settings','community_moderation_log']){
  assert.match(migration,new RegExp(`create table if not exists private\\.${table}\\(`));
  assert.match(migration,new RegExp(`alter table private\\.${table} enable row level security`));
}
assert.match(migration,/revoke all on private\.community_user_restrictions,private\.community_forbidden_terms/);
assert.match(migration,/set search_path=''/g);
assert.doesNotMatch(migration,/security definer(?![^$]*set search_path='')/s);
assert.equal((migration.match(/not private\.is_admin\(\)/g)||[]).length>=9,true,'every admin RPC must check admin+AAL2');
assert.match(migration,/private\.assert_community_participation_allowed\(\)/g);
for(const name of ['create_community_comment','edit_community_comment','set_product_reaction','set_comment_like']){
  const start=migration.indexOf(`function private.${name}(`),end=migration.indexOf('$$;',start);
  assert.ok(start>=0&&end>start,`${name} body missing`);
  assert.match(migration.slice(start,end),/assert_community_participation_allowed/,`${name} does not enforce Community block`);
}
for(const name of ['create_community_comment','edit_community_comment']){
  const start=migration.indexOf(`function private.${name}(`),end=migration.indexOf('$$;',start);
  assert.match(migration.slice(start,end),/validate_community_body/,`${name} does not validate content`);
}
assert.match(migration,/community_contains_link/);assert.match(migration,/community_normalize_text/);assert.match(migration,/whole_word/);
assert.match(migration,/deletion_kind='admin'/);assert.match(migration,/community_moderation_log/);
assert.match(migration,/values\('term_deleted',null,auth\.uid\(\)/,'deleted terms must not violate the audit foreign key');
assert.match(migration,/where private\.community_comment_visible\(c\.id\)/,'analytics must count only visible threads');
assert.doesNotMatch(migration,/update\s+auth\.users|delete\s+from\s+auth\.users/i,'Community block must not alter Auth users');
assert.doesNotMatch(migration,/raw_user_meta_data->>'email'|email\s*,/i,'admin projections must not expose email');

for(const wrapper of ['get_admin_community_comments','get_admin_community_users','get_admin_community_terms','get_admin_community_history']){
  const start=migration.indexOf(`function public.${wrapper}(`),end=migration.indexOf('$$;',start);
  assert.match(migration.slice(start,end),/p_page integer default 1/,'PostgREST wrapper parameters must be named');
}
assert.match(migration,/revoke all on function[\s\S]*from public,anon,service_role/);
assert.match(migration,/grant execute on function[\s\S]*to authenticated/);

assert.match(rollback,/Recuperación no destructiva/);assert.doesNotMatch(rollback,/^\s*(drop|truncate|delete\s+from|update\s+private\.)/im,'rollback must preserve Stage B records');
assert.match(rollback,/select false/);assert.match(rollback,/from public,anon,authenticated,service_role/);
assert.match(sqlTest,/^begin;/m);assert.match(sqlTest,/^rollback;/m);assert.match(sqlTest,/request\.jwt\.claims/);assert.match(sqlTest,/community_user_restrictions/);assert.match(sqlTest,/community_forbidden_terms/);assert.match(sqlTest,/community_moderation_log/);

console.log('community-stage-b.test.cjs: OK');

