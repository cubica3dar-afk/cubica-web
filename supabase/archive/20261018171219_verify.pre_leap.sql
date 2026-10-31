-- Solo lectura: verificación posterior de 20261018171219.
with expected_columns(ordinal,column_name,data_type) as (values
  (1,'id','uuid'),(2,'name','text'),(3,'description','text'),(4,'state','text'),
  (5,'priority','integer'),(6,'recurrence_mode','text'),
  (7,'starts_at','timestamp with time zone'),(8,'ends_at','timestamp with time zone'),
  (9,'annual_start_month','smallint'),(10,'annual_start_day','smallint'),
  (11,'annual_start_time','time without time zone'),(12,'annual_end_month','smallint'),
  (13,'annual_end_day','smallint'),(14,'annual_end_time','time without time zone'),
  (15,'theme','jsonb'),(16,'apply_email_theme','boolean'),(17,'email_theme_key','text'),
  (18,'version','integer'),(19,'created_at','timestamp with time zone'),(20,'created_by','uuid'),
  (21,'updated_at','timestamp with time zone'),(22,'updated_by','uuid'),
  (23,'published_at','timestamp with time zone'),(24,'published_by','uuid'),
  (25,'deleted_at','timestamp with time zone'),(26,'deleted_by','uuid')
), actual_columns as (
  select a.attnum ordinal,a.attname column_name,format_type(a.atttypid,a.atttypmod) data_type
  from pg_attribute a
  where a.attrelid='private.site_campaigns'::regclass and a.attnum>0 and not a.attisdropped
), signature as (
  select to_regprocedure('private.stage_c_active_campaign(timestamptz)') procedure_id
)
select jsonb_build_object(
  'version','20261018171219',
  'sentinel',obj_description(signature.procedure_id::oid,'pg_proc'),
  'sentinel_ok',obj_description(signature.procedure_id::oid,'pg_proc')='cubica_stage_c:20261018171219',
  'return_type',pg_get_function_result(signature.procedure_id::oid),
  'return_type_ok',pg_get_function_result(signature.procedure_id::oid)='private.site_campaigns',
  'column_count',(select count(*) from actual_columns),
  'columns_exact',not exists(
    (select * from expected_columns except select * from actual_columns)
    union all
    (select * from actual_columns except select * from expected_columns)
  ),
  'security_definer',(select p.prosecdef from pg_proc p where p.oid=signature.procedure_id::oid),
  'stable',(select p.provolatile='s' from pg_proc p where p.oid=signature.procedure_id::oid),
  'search_path',(select p.proconfig from pg_proc p where p.oid=signature.procedure_id::oid),
  'public_execute',exists(
    select 1 from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    where p.oid=signature.procedure_id and acl.grantee=0 and acl.privilege_type='EXECUTE'
  ),
  'anon_execute',coalesce(has_function_privilege('anon',signature.procedure_id,'execute'),false),
  'authenticated_execute',coalesce(has_function_privilege('authenticated',signature.procedure_id,'execute'),false),
  'service_role_execute',coalesce(has_function_privilege('service_role',signature.procedure_id,'execute'),false)
) from signature;

