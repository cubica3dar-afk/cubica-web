-- Solo lectura: verificación posterior de 5A v2.
with expected(identity,security_definer) as (values
  ('private.stage_c_normalize_faq_question(text)',false),
  ('private.get_public_content_page(text)',true),
  ('private.get_public_faq()',true),
  ('private.stage_c_validate_content(jsonb)',false),
  ('private.admin_save_content_draft(text,text,jsonb,integer)',true),
  ('private.admin_publish_content_page(text,integer)',true),
  ('private.admin_restore_content_version(text,integer,integer)',true),
  ('private.admin_list_faq(boolean)',true),
  ('private.admin_upsert_faq(bigint,text,text,boolean,integer,integer,boolean)',true),
  ('private.admin_restore_faq(bigint,integer)',true)
)
select jsonb_build_object(
  'version','20261018171256',
  'sentinel',obj_description(to_regprocedure('private.admin_restore_faq(bigint,integer)')::oid,'pg_proc'),
  'sentinel_ok',obj_description(to_regprocedure('private.admin_restore_faq(bigint,integer)')::oid,'pg_proc')='cubica_stage_c:20261018171256',
  'source_draft_version',exists(
    select 1 from information_schema.columns
    where table_schema='private' and table_name='site_content_versions' and column_name='source_draft_version'
  ),
  'publish_idempotency_index',to_regclass('private.site_content_one_publish_per_draft') is not null,
  'faq_uniqueness_index',to_regclass('private.site_faq_unique_current_question') is not null,
  'objects',jsonb_agg(jsonb_build_object(
    'identity',identity,
    'exists',to_regprocedure(identity) is not null,
    'security_definer',(select p.prosecdef from pg_proc p where p.oid=to_regprocedure(identity)),
    'security_mode_ok',(select p.prosecdef from pg_proc p where p.oid=to_regprocedure(identity))=security_definer,
    'search_path_restricted',exists(
      select 1 from pg_proc p,unnest(coalesce(p.proconfig,array[]::text[])) setting
      where p.oid=to_regprocedure(identity) and setting like 'search_path=%'
    ),
    'public_execute',exists(
      select 1 from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      where p.oid=to_regprocedure(identity) and acl.grantee=0 and acl.privilege_type='EXECUTE'
    ),
    'anon_execute',coalesce(has_function_privilege('anon',to_regprocedure(identity),'execute'),false),
    'authenticated_execute',coalesce(has_function_privilege('authenticated',to_regprocedure(identity),'execute'),false),
    'service_role_execute',coalesce(has_function_privilege('service_role',to_regprocedure(identity),'execute'),false)
  ) order by identity)
) from expected;
