-- CÚBICA 3D — Etapa C, bloque 3C-2: lectura administrativa de configuración.

-- Migración cerrada: no concede EXECUTE a roles de Data API.

do $$
begin
  if obj_description(to_regprocedure('private.stage_c_assert_admin()')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171210' then
    raise exception 'stage_c_171232_missing_prerequisite:private.stage_c_assert_admin()';
  end if;
end $$;

create or replace function private.admin_get_site_configuration()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.stage_c_assert_admin();
  select jsonb_build_object(
    'appearance',coalesce((select to_jsonb(v)-'created_by'-'published_by' from private.site_appearance_versions v where state='draft' order by id desc limit 1),'{}'::jsonb),
    'published_appearance',coalesce((select to_jsonb(v)-'created_by'-'published_by' from private.site_appearance_versions v where state='published' order by published_at desc,id desc limit 1),'{}'::jsonb),
    'assets',coalesce((select jsonb_agg(to_jsonb(a)-'created_by'-'retired_by' order by created_at desc) from private.site_assets a),'[]'::jsonb),
    'campaigns',coalesce((select jsonb_agg(to_jsonb(c)-'created_by'-'updated_by'-'published_by'-'deleted_by' order by priority desc,updated_at desc) from private.site_campaigns c where deleted_at is null),'[]'::jsonb),
    'occurrences',coalesce((select jsonb_agg(to_jsonb(o)-'created_by' order by starts_at) from private.site_campaign_occurrences o),'[]'::jsonb),
    'phrases',coalesce((select jsonb_agg(to_jsonb(w)-'created_by'-'updated_by' order by campaign_id nulls first,sort_order,id) from private.site_welcome_phrases w where deleted_at is null),'[]'::jsonb),
    'pages',coalesce((select jsonb_agg(jsonb_build_object('slug',p.slug,'label',p.label,'draft',(select to_jsonb(v)-'created_by'-'published_by' from private.site_content_versions v where v.page_slug=p.slug and state='draft' order by id desc limit 1),'published',(select to_jsonb(v)-'created_by'-'published_by' from private.site_content_versions v where v.page_slug=p.slug and state='published' order by published_at desc,id desc limit 1),'history',(select coalesce(jsonb_agg(to_jsonb(h)-'created_by'-'published_by' order by h.version desc),'[]'::jsonb) from (select * from private.site_content_versions v where v.page_slug=p.slug and state in('published','archived') order by version desc limit 20) h)) order by p.slug) from private.site_content_pages p),'[]'::jsonb),
    'faqs',coalesce((select jsonb_agg(to_jsonb(f)-'created_by'-'updated_by' order by sort_order,id) from private.site_faq_items f where deleted_at is null),'[]'::jsonb),
    'timezone','America/Argentina/Buenos_Aires','email_theme_enabled',false
  ) into result;
  return result;
end;
$$;

do $$
declare signature regprocedure;
begin
  foreach signature in array array[
      'private.admin_get_site_configuration()'::regprocedure
    ] loop
      execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
    end loop;
end $$;

comment on function private.admin_get_site_configuration() is 'cubica_stage_c:20261018171232';

do $$
declare signature regprocedure;
begin
  if obj_description(to_regprocedure('private.admin_get_site_configuration()')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171232' then
    raise exception 'stage_c_171232_missing_sentinel';
  end if;
  foreach signature in array array[
      'private.admin_get_site_configuration()'::regprocedure
    ] loop
      if signature is null then raise exception 'stage_c_171232_missing_function'; end if;
      if has_function_privilege('anon',signature,'execute')
        or has_function_privilege('authenticated',signature,'execute')
        or has_function_privilege('service_role',signature,'execute') then
        raise exception 'stage_c_171232_premature_execute:%',signature;
      end if;
      if exists(
        select 1 from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        where p.oid=signature::oid and acl.grantee=0 and acl.privilege_type='EXECUTE'
      ) then raise exception 'stage_c_171232_public_execute:%',signature; end if;
      if exists(
        select 1 from pg_proc p where p.oid=signature::oid
        and not exists(select 1 from unnest(coalesce(p.proconfig,array[]::text[])) setting where setting like 'search_path=%')
      ) then raise exception 'stage_c_171232_unrestricted_search_path:%',signature; end if;
      if (select not p.prosecdef from pg_proc p where p.oid=signature::oid) is distinct from (false) then
        raise exception 'stage_c_171232_wrong_security_mode:%',signature;
      end if;
    end loop;
end $$;
