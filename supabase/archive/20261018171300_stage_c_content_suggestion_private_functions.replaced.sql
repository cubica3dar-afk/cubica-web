-- CÚBICA 3D — Etapa C, bloque 5/7: funciones privadas de contenidos y sugerencias.

-- Ninguna función recibe EXECUTE desde roles de API en este bloque.

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

create or replace function private.consume_suggestion_protection(p_token_hash text,p_identity_hash text,p_request_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare current private.suggestion_rate_limits; now_at timestamptz:=now();
begin
  if auth.role()<>'service_role' then raise exception 'Ruta interna' using errcode='42501'; end if;
  if p_token_hash !~ '^([0-9a-f]{64})$' or p_identity_hash !~ '^([0-9a-f]{64})$' or p_request_id is null then raise exception 'Protección inválida'; end if;
  insert into private.suggestion_token_uses(token_hash,expires_at) values(p_token_hash,now_at+interval '10 minutes')
  on conflict do nothing;
  if not found then raise exception 'suggestion_turnstile_replayed' using errcode='23505'; end if;
  select * into current from private.suggestion_rate_limits where identity_hash=p_identity_hash for update;
  if not found or current.window_started_at<=now_at-interval '1 hour' then
    insert into private.suggestion_rate_limits(identity_hash,window_started_at,attempts,blocked_until) values(p_identity_hash,now_at,1,null)
    on conflict(identity_hash) do update set window_started_at=excluded.window_started_at,attempts=1,blocked_until=null;
  else
    if current.blocked_until>now_at or current.attempts>=5 then
      update private.suggestion_rate_limits set blocked_until=greatest(coalesce(blocked_until,now_at),now_at+interval '1 hour') where identity_hash=p_identity_hash;
      raise exception 'suggestion_rate_limit' using errcode='P0001';
    end if;
    update private.suggestion_rate_limits set attempts=attempts+1 where identity_hash=p_identity_hash;
  end if;
end;
$$;

create or replace function private.submit_public_suggestion(p_category text,p_subject text,p_description text,p_contact text,p_request_id uuid,p_verified_user_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare new_id uuid;
begin
  if auth.role()<>'service_role' then raise exception 'Ruta interna' using errcode='42501'; end if;
  insert into private.site_suggestions(category,subject,description,contact,user_id,request_id)
  values(p_category,private.stage_c_safe_text(p_subject,160,true),private.stage_c_safe_text(p_description,3000,true),nullif(private.stage_c_safe_text(p_contact,320,false),''),p_verified_user_id,p_request_id)
  on conflict(request_id) do update set request_id=excluded.request_id returning id into new_id;
  return new_id;
end;
$$;

create or replace function private.admin_list_suggestions(p_page integer default 1,p_page_size integer default 25,p_search text default null,p_status text default 'all',p_category text default 'all',p_sort text default 'recent')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_page integer:=greatest(coalesce(p_page,1),1);v_size integer;v_search text:=btrim(coalesce(p_search,''));v_status text:=lower(coalesce(p_status,'all'));v_category text:=lower(coalesce(p_category,'all'));v_sort text:=lower(coalesce(p_sort,'recent'));v_total bigint;v_items jsonb;
begin
  perform private.stage_c_assert_admin(); v_size:=case when p_page_size in(10,25,50) then p_page_size else 25 end;
  if v_status not in('all','new','reviewing','accepted','resolved','dismissed') or v_category not in('all','funcionalidad','visual','error','compra','otro') or v_sort not in('recent','oldest') then raise exception 'Filtro inválido'; end if;
  select count(*) into v_total from private.site_suggestions s where (v_status='all' or s.status=v_status) and (v_category='all' or s.category=v_category) and (v_search='' or s.subject ilike '%'||v_search||'%' or s.description ilike '%'||v_search||'%');
  select coalesce(jsonb_agg(to_jsonb(q)-'user_id' order by case when v_sort='recent' then q.created_at end desc,case when v_sort='oldest' then q.created_at end asc,q.id),'[]'::jsonb) into v_items from(
    select s.id,s.category,s.subject,s.description,s.contact,s.status,s.private_notes,s.created_at,s.updated_at,s.user_id from private.site_suggestions s where (v_status='all' or s.status=v_status) and (v_category='all' or s.category=v_category) and (v_search='' or s.subject ilike '%'||v_search||'%' or s.description ilike '%'||v_search||'%') order by case when v_sort='recent' then s.created_at end desc,case when v_sort='oldest' then s.created_at end asc,s.id limit v_size offset (v_page-1)*v_size
  ) q;
  return jsonb_build_object('items',v_items,'page',v_page,'page_size',v_size,'total',v_total);
end;
$$;

create or replace function private.admin_update_suggestion(p_id uuid,p_status text,p_private_notes text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.site_suggestions;
begin
  perform private.stage_c_assert_admin(); if p_status not in('new','reviewing','accepted','resolved','dismissed') then raise exception 'Estado inválido'; end if;
  update private.site_suggestions set status=p_status,private_notes=private.stage_c_safe_text(p_private_notes,4000,false),updated_at=now(),updated_by=auth.uid() where id=p_id returning * into s;
  if not found then raise exception 'Sugerencia inexistente'; end if;
  return to_jsonb(s)-'user_id'-'updated_by';
end;
$$;

create or replace function private.cleanup_suggestion_protection()
returns void language sql security definer set search_path='' as $$
  delete from private.suggestion_token_uses where expires_at<now()-interval '1 day';
  delete from private.suggestion_rate_limits where window_started_at<now()-interval '2 days' and coalesce(blocked_until,'-infinity')<now();
$$;

do $$ declare signature regprocedure; begin
    foreach signature in array array[
      'private.get_public_content_page(text)'::regprocedure,
      'private.get_public_faq()'::regprocedure,
      'private.stage_c_validate_content(jsonb)'::regprocedure,
      'private.admin_save_content_draft(text,text,jsonb,integer)'::regprocedure,
      'private.admin_publish_content_page(text,integer)'::regprocedure,
      'private.admin_restore_content_version(text,integer,integer)'::regprocedure,
      'private.admin_upsert_faq(bigint,text,text,boolean,integer,integer,boolean)'::regprocedure,
      'private.consume_suggestion_protection(text,text,uuid)'::regprocedure,
      'private.submit_public_suggestion(text,text,text,text,uuid,uuid)'::regprocedure,
      'private.admin_list_suggestions(integer,integer,text,text,text,text)'::regprocedure,
      'private.admin_update_suggestion(uuid,text,text)'::regprocedure,
      'private.cleanup_suggestion_protection()'::regprocedure
    ] loop execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role'; end loop;
  end $$;

comment on function private.admin_update_suggestion(uuid,text,text) is 'cubica_stage_c:20261018171300';

do $$ begin
    if to_regprocedure('private.get_public_content_page(text)') is null or to_regprocedure('private.submit_public_suggestion(text,text,text,text,uuid,uuid)') is null then raise exception 'stage_c_171300_missing_functions'; end if;
    if has_function_privilege('anon','private.get_public_content_page(text)','execute') or has_function_privilege('service_role','private.submit_public_suggestion(text,text,text,text,uuid,uuid)','execute') then raise exception 'stage_c_171300_premature_execute'; end if;
  end $$;
