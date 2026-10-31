-- CÚBICA 3D — Etapa C, bloque 5A: contenidos y FAQ.

-- Migración cerrada: no concede EXECUTE a roles de Data API.

do $$
begin
  if obj_description(to_regprocedure('private.stage_c_assert_admin()')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171210' then
    raise exception 'stage_c_171301_missing_prerequisite:private.stage_c_assert_admin()';
  end if;
end $$;

create or replace function private.get_public_content_page(p_slug text)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('slug',p.slug,'label',p.label,'title',v.title,'content',v.content,'published_at',v.published_at)
  from private.site_content_pages p join lateral(
    select * from private.site_content_versions x where x.page_slug=p.slug and x.state='published' order by x.published_at desc,x.id desc limit 1
  ) v on true where p.slug=p_slug;
$$;

create or replace function private.get_public_faq()
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'question',question,'answer',answer) order by sort_order,id),'[]'::jsonb)
  from private.site_faq_items where active and deleted_at is null;
$$;

create or replace function private.stage_c_validate_content(p_content jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare body text; key text; value text;
begin
  if jsonb_typeof(coalesce(p_content,'{}'))<>'object' or (p_content-array['body','email','phone','instagram','address','hours','commercial'])<>'{}'::jsonb then raise exception 'Contenido inválido'; end if;
  body:=private.stage_c_safe_text(p_content->>'body',20000,false);
  for key,value in select * from jsonb_each_text(p_content-'body') loop
    perform private.stage_c_safe_text(value,500,false);
    if key='email' and value<>'' and value !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Email inválido'; end if;
    if key='instagram' and value<>'' and value !~* '^https://(www[.])?instagram[.]com/' then raise exception 'Enlace de Instagram inválido'; end if;
  end loop;
  return p_content;
end;
$$;

create or replace function private.admin_save_content_draft(p_slug text,p_title text,p_content jsonb,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.site_content_versions;
begin
  perform private.stage_c_assert_admin();
  if not exists(select 1 from private.site_content_pages where slug=p_slug) then raise exception 'Página inválida'; end if;
  select * into d from private.site_content_versions where page_slug=p_slug and state='draft' for update;
  if found and d.version<>p_expected_version then raise exception 'El borrador cambió' using errcode='40001'; end if;
  if found then update private.site_content_versions set title=private.stage_c_safe_text(p_title,140,true),content=private.stage_c_validate_content(p_content),version=version+1,created_at=now(),created_by=auth.uid() where id=d.id returning * into d;
  else insert into private.site_content_versions(page_slug,state,version,title,content,created_by) values(p_slug,'draft',1,private.stage_c_safe_text(p_title,140,true),private.stage_c_validate_content(p_content),auth.uid()) returning * into d; end if;
  return to_jsonb(d)-'created_by'-'published_by';
end;
$$;

create or replace function private.admin_publish_content_page(p_slug text,p_expected_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.site_content_versions; v private.site_content_versions; n integer;
begin
  perform private.stage_c_assert_admin(); select * into d from private.site_content_versions where page_slug=p_slug and state='draft' for update;
  if not found or d.version<>p_expected_version then raise exception 'El borrador cambió o no existe' using errcode='40001'; end if;
  update private.site_content_versions set state='archived' where page_slug=p_slug and state='published';
  select coalesce(max(version),0)+1 into n from private.site_content_versions where page_slug=p_slug and state in('published','archived');
  insert into private.site_content_versions(page_slug,state,version,title,content,created_by,published_at,published_by) values(p_slug,'published',n,d.title,private.stage_c_validate_content(d.content),auth.uid(),now(),auth.uid()) returning * into v;
  return to_jsonb(v)-'created_by'-'published_by';
end;
$$;

create or replace function private.admin_restore_content_version(p_slug text,p_version integer,p_expected_draft_version integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare source private.site_content_versions; draft private.site_content_versions;
begin
  perform private.stage_c_assert_admin();
  select * into source from private.site_content_versions where page_slug=p_slug and version=p_version and state in('published','archived') order by id desc limit 1;
  if not found then raise exception 'Versión inexistente'; end if;
  select * into draft from private.site_content_versions where page_slug=p_slug and state='draft' for update;
  if found and draft.version<>p_expected_draft_version then raise exception 'El borrador cambió' using errcode='40001'; end if;
  if found then update private.site_content_versions set title=source.title,content=source.content,version=version+1,created_at=now(),created_by=auth.uid() where id=draft.id returning * into draft;
  else insert into private.site_content_versions(page_slug,state,version,title,content,created_by) values(p_slug,'draft',1,source.title,source.content,auth.uid()) returning * into draft; end if;
  return to_jsonb(draft)-'created_by'-'published_by';
end;
$$;

create or replace function private.admin_upsert_faq(p_id bigint,p_question text,p_answer text,p_active boolean,p_sort_order integer,p_expected_version integer,p_delete boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare f private.site_faq_items;
begin
  perform private.stage_c_assert_admin();
  if p_id is null then insert into private.site_faq_items(question,answer,active,sort_order,created_by,updated_by) values(private.stage_c_safe_text(p_question,240,true),private.stage_c_safe_text(p_answer,3000,true),coalesce(p_active,true),coalesce(p_sort_order,0),auth.uid(),auth.uid()) returning * into f;
  else select * into f from private.site_faq_items where id=p_id for update; if not found or f.version<>p_expected_version then raise exception 'La pregunta cambió o no existe' using errcode='40001'; end if; update private.site_faq_items set question=private.stage_c_safe_text(p_question,240,true),answer=private.stage_c_safe_text(p_answer,3000,true),active=coalesce(p_active,active),sort_order=coalesce(p_sort_order,sort_order),deleted_at=case when p_delete then now() else null end,version=version+1,updated_at=now(),updated_by=auth.uid() where id=p_id returning * into f; end if;
  return to_jsonb(f)-'created_by'-'updated_by';
end;
$$;

do $$
declare signature regprocedure;
begin
  foreach signature in array array[
      'private.get_public_content_page(text)'::regprocedure,
      'private.get_public_faq()'::regprocedure,
      'private.stage_c_validate_content(jsonb)'::regprocedure,
      'private.admin_save_content_draft(text,text,jsonb,integer)'::regprocedure,
      'private.admin_publish_content_page(text,integer)'::regprocedure,
      'private.admin_restore_content_version(text,integer,integer)'::regprocedure,
      'private.admin_upsert_faq(bigint,text,text,boolean,integer,integer,boolean)'::regprocedure
    ] loop
      execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
    end loop;
end $$;

comment on function private.admin_upsert_faq(bigint,text,text,boolean,integer,integer,boolean) is 'cubica_stage_c:20261018171301';

do $$
declare signature regprocedure;
begin
  if obj_description(to_regprocedure('private.admin_upsert_faq(bigint,text,text,boolean,integer,integer,boolean)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171301' then
    raise exception 'stage_c_171301_missing_sentinel';
  end if;
  foreach signature in array array[
      'private.get_public_content_page(text)'::regprocedure,
      'private.get_public_faq()'::regprocedure,
      'private.stage_c_validate_content(jsonb)'::regprocedure,
      'private.admin_save_content_draft(text,text,jsonb,integer)'::regprocedure,
      'private.admin_publish_content_page(text,integer)'::regprocedure,
      'private.admin_restore_content_version(text,integer,integer)'::regprocedure,
      'private.admin_upsert_faq(bigint,text,text,boolean,integer,integer,boolean)'::regprocedure
    ] loop
      if signature is null then raise exception 'stage_c_171301_missing_function'; end if;
      if has_function_privilege('anon',signature,'execute')
        or has_function_privilege('authenticated',signature,'execute')
        or has_function_privilege('service_role',signature,'execute') then
        raise exception 'stage_c_171301_premature_execute:%',signature;
      end if;
      if exists(
        select 1 from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        where p.oid=signature::oid and acl.grantee=0 and acl.privilege_type='EXECUTE'
      ) then raise exception 'stage_c_171301_public_execute:%',signature; end if;
      if exists(
        select 1 from pg_proc p where p.oid=signature::oid
        and not exists(select 1 from unnest(coalesce(p.proconfig,array[]::text[])) setting where setting like 'search_path=%')
      ) then raise exception 'stage_c_171301_unrestricted_search_path:%',signature; end if;
      if (select not p.prosecdef from pg_proc p where p.oid=signature::oid) is distinct from (signature=any(array['private.stage_c_validate_content(jsonb)'::regprocedure]::regprocedure[])) then
        raise exception 'stage_c_171301_wrong_security_mode:%',signature;
      end if;
    end loop;
end $$;
