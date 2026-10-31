-- CÚBICA 3D — Etapa C, bloque 5A v2: contenidos y FAQ.
-- Migración cerrada: no concede EXECUTE a roles de Data API.

do $$
begin
  if obj_description(to_regprocedure('private.stage_c_assert_admin()')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171210' then
    raise exception 'stage_c_171256_missing_prerequisite:private.stage_c_assert_admin()';
  end if;
  if obj_description(to_regclass('private.site_suggestions')::oid,'pg_class') is distinct from 'cubica_stage_c:20261018171100' then
    raise exception 'stage_c_171256_missing_prerequisite:stage_c_content_schema';
  end if;
end $$;

alter table private.site_content_versions
  add column if not exists source_draft_version integer;

do $$
begin
  if not exists(
    select 1 from pg_constraint
    where conrelid='private.site_content_versions'::regclass
      and conname='site_content_source_draft_version_positive'
  ) then
    alter table private.site_content_versions
      add constraint site_content_source_draft_version_positive
      check(source_draft_version is null or source_draft_version>0);
  end if;
end $$;

create unique index if not exists site_content_one_publish_per_draft
  on private.site_content_versions(page_slug,source_draft_version)
  where state in('published','archived') and source_draft_version is not null;

create or replace function private.stage_c_normalize_faq_question(p_question text)
returns text language sql immutable set search_path='' as $$
  select lower(regexp_replace(btrim(coalesce(p_question,'')),'[[:space:]]+',' ','g'));
$$;

do $$
begin
  if exists(
    select 1
    from private.site_faq_items
    where deleted_at is null
    group by private.stage_c_normalize_faq_question(question)
    having count(*)>1
  ) then
    raise exception 'stage_c_171256_existing_faq_duplicates';
  end if;
end $$;

create unique index if not exists site_faq_unique_current_question
  on private.site_faq_items(private.stage_c_normalize_faq_question(question))
  where deleted_at is null;

create or replace function private.get_public_content_page(p_slug text)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'slug',p.slug,
    'label',p.label,
    'title',v.title,
    'content',v.content,
    'published_at',v.published_at
  )
  from private.site_content_pages p
  join lateral(
    select *
    from private.site_content_versions x
    where x.page_slug=p.slug and x.state='published'
    order by x.published_at desc,x.id desc
    limit 1
  ) v on true
  where p.slug=p_slug;
$$;

create or replace function private.get_public_faq()
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object('id',id,'question',question,'answer',answer)
      order by sort_order,id
    ),
    '[]'::jsonb
  )
  from private.site_faq_items
  where active and deleted_at is null;
$$;

create or replace function private.stage_c_validate_content(p_content jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare
  input jsonb:=coalesce(p_content,'{}'::jsonb);
  normalized jsonb:='{}'::jsonb;
  key text;
  raw_value jsonb;
  value text;
  maximum integer;
  has_content boolean:=false;
begin
  if jsonb_typeof(input)<>'object'
    or (input-array['body','email','phone','instagram','address','hours','commercial'])<>'{}'::jsonb then
    raise exception 'Contenido inválido';
  end if;

  for key,raw_value in select * from jsonb_each(input) loop
    if jsonb_typeof(raw_value) not in('string','null') then
      raise exception 'Contenido inválido';
    end if;
    value:=case when jsonb_typeof(raw_value)='null' then '' else raw_value#>>'{}' end;
    maximum:=case when key='body' then 20000 else 500 end;
    value:=private.stage_c_safe_text(value,maximum,false);
    if key='email' and value<>'' and value !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
      raise exception 'Email inválido';
    end if;
    if key='instagram' and value<>'' and value !~* '^https://(www[.])?instagram[.]com/' then
      raise exception 'Enlace de Instagram inválido';
    end if;
    normalized:=normalized||jsonb_build_object(key,value);
    has_content:=has_content or value<>'';
  end loop;

  if not has_content then
    raise exception 'Contenido vacío';
  end if;
  return normalized;
end;
$$;

create or replace function private.admin_save_content_draft(
  p_slug text,
  p_title text,
  p_content jsonb,
  p_expected_version integer
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  draft private.site_content_versions;
  normalized_title text:=private.stage_c_safe_text(p_title,140,true);
  normalized_content jsonb:=private.stage_c_validate_content(p_content);
begin
  perform private.stage_c_assert_admin();
  if not exists(select 1 from private.site_content_pages where slug=p_slug) then
    raise exception 'Página inválida';
  end if;

  select * into draft
  from private.site_content_versions
  where page_slug=p_slug and state='draft'
  for update;

  if found then
    if draft.version<>p_expected_version then
      raise exception 'El borrador cambió' using errcode='40001';
    end if;
    if draft.title=normalized_title and draft.content=normalized_content then
      return to_jsonb(draft)-'created_by'-'published_by';
    end if;
    update private.site_content_versions
    set title=normalized_title,
        content=normalized_content,
        version=version+1,
        created_at=now(),
        created_by=auth.uid()
    where id=draft.id
    returning * into draft;
  else
    if p_expected_version is distinct from 0 then
      raise exception 'El borrador cambió o no existe' using errcode='40001';
    end if;
    insert into private.site_content_versions(page_slug,state,version,title,content,created_by)
    values(p_slug,'draft',1,normalized_title,normalized_content,auth.uid())
    returning * into draft;
  end if;
  return to_jsonb(draft)-'created_by'-'published_by';
end;
$$;

create or replace function private.admin_publish_content_page(
  p_slug text,
  p_expected_version integer
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  draft private.site_content_versions;
  published private.site_content_versions;
  next_version integer;
begin
  perform private.stage_c_assert_admin();
  select * into draft
  from private.site_content_versions
  where page_slug=p_slug and state='draft'
  for update;

  if not found or draft.version<>p_expected_version then
    raise exception 'El borrador cambió o no existe' using errcode='40001';
  end if;

  select * into published
  from private.site_content_versions
  where page_slug=p_slug
    and state in('published','archived')
    and source_draft_version=draft.version
  order by id desc
  limit 1;
  if found then
    return to_jsonb(published)-'created_by'-'published_by';
  end if;

  update private.site_content_versions
  set state='archived'
  where page_slug=p_slug and state='published';

  select coalesce(max(version),0)+1 into next_version
  from private.site_content_versions
  where page_slug=p_slug and state in('published','archived');

  insert into private.site_content_versions(
    page_slug,state,version,title,content,created_by,published_at,published_by,source_draft_version
  )
  values(
    p_slug,'published',next_version,draft.title,private.stage_c_validate_content(draft.content),
    auth.uid(),now(),auth.uid(),draft.version
  )
  returning * into published;

  return to_jsonb(published)-'created_by'-'published_by';
end;
$$;

create or replace function private.admin_restore_content_version(
  p_slug text,
  p_version integer,
  p_expected_draft_version integer
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  source private.site_content_versions;
  draft private.site_content_versions;
begin
  perform private.stage_c_assert_admin();
  select * into source
  from private.site_content_versions
  where page_slug=p_slug and version=p_version and state in('published','archived')
  order by id desc
  limit 1;
  if not found then raise exception 'Versión inexistente'; end if;

  select * into draft
  from private.site_content_versions
  where page_slug=p_slug and state='draft'
  for update;

  if found then
    if draft.version<>p_expected_draft_version then
      raise exception 'El borrador cambió' using errcode='40001';
    end if;
    if draft.title=source.title and draft.content=source.content then
      return to_jsonb(draft)-'created_by'-'published_by';
    end if;
    update private.site_content_versions
    set title=source.title,
        content=source.content,
        version=version+1,
        created_at=now(),
        created_by=auth.uid()
    where id=draft.id
    returning * into draft;
  else
    if p_expected_draft_version is distinct from 0 then
      raise exception 'El borrador cambió o no existe' using errcode='40001';
    end if;
    insert into private.site_content_versions(page_slug,state,version,title,content,created_by)
    values(p_slug,'draft',1,source.title,source.content,auth.uid())
    returning * into draft;
  end if;
  return to_jsonb(draft)-'created_by'-'published_by';
end;
$$;

create or replace function private.admin_list_faq(p_include_deleted boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.stage_c_assert_admin();
  select coalesce(
    jsonb_agg(
      (to_jsonb(f)-'created_by'-'updated_by')||jsonb_build_object('deleted',f.deleted_at is not null)
      order by (f.deleted_at is not null),f.sort_order,f.id
    ),
    '[]'::jsonb
  ) into result
  from private.site_faq_items f
  where coalesce(p_include_deleted,false) or f.deleted_at is null;
  return result;
end;
$$;

create or replace function private.admin_upsert_faq(
  p_id bigint,
  p_question text,
  p_answer text,
  p_active boolean,
  p_sort_order integer,
  p_expected_version integer,
  p_delete boolean default false
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  faq private.site_faq_items;
  normalized_question text:=private.stage_c_safe_text(p_question,240,true);
  normalized_answer text:=private.stage_c_safe_text(p_answer,3000,true);
  desired_active boolean;
  desired_order integer;
begin
  perform private.stage_c_assert_admin();

  if p_id is null then
    if coalesce(p_delete,false) then raise exception 'FAQ inexistente'; end if;
    if p_expected_version is distinct from 0 then
      raise exception 'La pregunta cambió o no existe' using errcode='40001';
    end if;
    insert into private.site_faq_items(question,answer,active,sort_order,created_by,updated_by)
    values(normalized_question,normalized_answer,coalesce(p_active,false),coalesce(p_sort_order,0),auth.uid(),auth.uid())
    returning * into faq;
  else
    select * into faq from private.site_faq_items where id=p_id for update;
    if not found or faq.version<>p_expected_version then
      raise exception 'La pregunta cambió o no existe' using errcode='40001';
    end if;
    if faq.deleted_at is not null then
      if coalesce(p_delete,false) then
        return to_jsonb(faq)-'created_by'-'updated_by';
      end if;
      raise exception 'La FAQ fue eliminada; use la restauración administrativa' using errcode='55000';
    end if;

    if coalesce(p_delete,false) then
      update private.site_faq_items
      set active=false,
          deleted_at=now(),
          version=version+1,
          updated_at=now(),
          updated_by=auth.uid()
      where id=p_id
      returning * into faq;
    else
      desired_active:=coalesce(p_active,faq.active);
      desired_order:=coalesce(p_sort_order,faq.sort_order);
      if faq.question=normalized_question
        and faq.answer=normalized_answer
        and faq.active=desired_active
        and faq.sort_order=desired_order then
        return to_jsonb(faq)-'created_by'-'updated_by';
      end if;
      update private.site_faq_items
      set question=normalized_question,
          answer=normalized_answer,
          active=desired_active,
          sort_order=desired_order,
          version=version+1,
          updated_at=now(),
          updated_by=auth.uid()
      where id=p_id
      returning * into faq;
    end if;
  end if;
  return to_jsonb(faq)-'created_by'-'updated_by';
exception when unique_violation then
  raise exception 'Ya existe una FAQ con la misma pregunta' using errcode='23505';
end;
$$;

create or replace function private.admin_restore_faq(
  p_id bigint,
  p_expected_version integer
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare faq private.site_faq_items;
begin
  perform private.stage_c_assert_admin();
  select * into faq from private.site_faq_items where id=p_id for update;
  if not found or faq.version<>p_expected_version then
    raise exception 'La pregunta cambió o no existe' using errcode='40001';
  end if;
  if faq.deleted_at is null then
    raise exception 'La FAQ no está eliminada' using errcode='55000';
  end if;

  update private.site_faq_items
  set deleted_at=null,
      active=false,
      version=version+1,
      updated_at=now(),
      updated_by=auth.uid()
  where id=p_id
  returning * into faq;
  return to_jsonb(faq)-'created_by'-'updated_by';
exception when unique_violation then
  raise exception 'No se puede restaurar: ya existe una FAQ con la misma pregunta' using errcode='23505';
end;
$$;

do $$
declare signature regprocedure;
begin
  foreach signature in array array[
      'private.stage_c_normalize_faq_question(text)'::regprocedure,
      'private.get_public_content_page(text)'::regprocedure,
      'private.get_public_faq()'::regprocedure,
      'private.stage_c_validate_content(jsonb)'::regprocedure,
      'private.admin_save_content_draft(text,text,jsonb,integer)'::regprocedure,
      'private.admin_publish_content_page(text,integer)'::regprocedure,
      'private.admin_restore_content_version(text,integer,integer)'::regprocedure,
      'private.admin_list_faq(boolean)'::regprocedure,
      'private.admin_upsert_faq(bigint,text,text,boolean,integer,integer,boolean)'::regprocedure,
      'private.admin_restore_faq(bigint,integer)'::regprocedure
    ] loop
      execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
    end loop;
end $$;

comment on function private.admin_restore_faq(bigint,integer) is 'cubica_stage_c:20261018171256';

do $$
declare signature regprocedure;
begin
  if obj_description(to_regprocedure('private.admin_restore_faq(bigint,integer)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171256' then
    raise exception 'stage_c_171256_missing_sentinel';
  end if;
  if not exists(
    select 1 from information_schema.columns
    where table_schema='private' and table_name='site_content_versions' and column_name='source_draft_version'
  ) then raise exception 'stage_c_171256_missing_source_version'; end if;
  if to_regclass('private.site_content_one_publish_per_draft') is null
    or to_regclass('private.site_faq_unique_current_question') is null then
    raise exception 'stage_c_171256_missing_unique_index';
  end if;

  foreach signature in array array[
      'private.stage_c_normalize_faq_question(text)'::regprocedure,
      'private.get_public_content_page(text)'::regprocedure,
      'private.get_public_faq()'::regprocedure,
      'private.stage_c_validate_content(jsonb)'::regprocedure,
      'private.admin_save_content_draft(text,text,jsonb,integer)'::regprocedure,
      'private.admin_publish_content_page(text,integer)'::regprocedure,
      'private.admin_restore_content_version(text,integer,integer)'::regprocedure,
      'private.admin_list_faq(boolean)'::regprocedure,
      'private.admin_upsert_faq(bigint,text,text,boolean,integer,integer,boolean)'::regprocedure,
      'private.admin_restore_faq(bigint,integer)'::regprocedure
    ] loop
      if signature is null then raise exception 'stage_c_171256_missing_function'; end if;
      if has_function_privilege('anon',signature,'execute')
        or has_function_privilege('authenticated',signature,'execute')
        or has_function_privilege('service_role',signature,'execute') then
        raise exception 'stage_c_171256_premature_execute:%',signature;
      end if;
      if exists(
        select 1 from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        where p.oid=signature::oid and acl.grantee=0 and acl.privilege_type='EXECUTE'
      ) then raise exception 'stage_c_171256_public_execute:%',signature; end if;
      if exists(
        select 1 from pg_proc p where p.oid=signature::oid
        and not exists(
          select 1 from unnest(coalesce(p.proconfig,array[]::text[])) setting
          where setting like 'search_path=%'
        )
      ) then raise exception 'stage_c_171256_unrestricted_search_path:%',signature; end if;
      if (select p.prosecdef from pg_proc p where p.oid=signature::oid) is distinct from
        (signature<>all(array[
          'private.stage_c_normalize_faq_question(text)'::regprocedure,
          'private.stage_c_validate_content(jsonb)'::regprocedure
        ]::regprocedure[])) then
        raise exception 'stage_c_171256_wrong_security_mode:%',signature;
      end if;
    end loop;
end $$;
