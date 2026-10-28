-- CÚBICA 3D — Etapa C, bloque 5C v3: administración segura de sugerencias.

-- Migración cerrada: no crea wrappers públicos ni concede EXECUTE a roles de API.
-- 5B v3 permanece intacta. Los conteos de duplicados reflejan únicamente el
-- ledger temporal todavía retenido por 5B v3; no se fabrican eventos históricos.

do $$
begin
  if obj_description(to_regprocedure('private.stage_c_assert_admin()')::oid,'pg_proc')
      is distinct from 'cubica_stage_c:20261018171210' then
    raise exception 'stage_c_20261024233029_missing_prerequisite:private.stage_c_assert_admin()';
  end if;
  if obj_description(
      to_regprocedure('private.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)')::oid,
      'pg_proc'
    ) is distinct from 'cubica_stage_c:20261018171258' then
    raise exception 'stage_c_20261024233029_missing_prerequisite:private.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)';
  end if;
  if obj_description(to_regclass('private.site_suggestions'),'pg_class')
      is distinct from 'cubica_stage_c:20261018171100' then
    raise exception 'stage_c_20261024233029_missing_prerequisite:private.site_suggestions';
  end if;
end $$;

alter table private.site_suggestions
  add column if not exists revision integer,
  add column if not exists archived_at timestamptz,
  add column if not exists deleted_at timestamptz;

update private.site_suggestions
set revision=1
where revision is null;

alter table private.site_suggestions
  alter column revision set default 1,
  alter column revision set not null;

do $$
begin
  if not exists(
    select 1 from pg_constraint
    where conrelid='private.site_suggestions'::regclass
      and conname='site_suggestions_revision_positive'
  ) then
    alter table private.site_suggestions
      add constraint site_suggestions_revision_positive check(revision>0);
  end if;
end $$;

create index if not exists site_suggestions_admin_v3
  on private.site_suggestions(deleted_at,archived_at,status,created_at desc,id);

create index if not exists suggestion_token_duplicate_lookup
  on private.suggestion_token_uses(suggestion_id)
  where result_code='accepted' and was_duplicate;

create table if not exists private.suggestion_moderation_history(
  id bigint generated always as identity primary key,
  suggestion_id uuid not null references private.site_suggestions(id) on delete restrict,
  actor_id uuid not null,
  occurred_at timestamptz not null default clock_timestamp(),
  operation text not null check(operation in('update','archive','unarchive','soft_delete','restore')),
  previous_status text not null check(previous_status in('new','reviewing','accepted','resolved','dismissed')),
  new_status text not null check(new_status in('new','reviewing','accepted','resolved','dismissed')),
  previous_revision integer not null check(previous_revision>0),
  new_revision integer not null check(new_revision=previous_revision+1),
  changed_fields text[] not null check(cardinality(changed_fields)>0),
  reason text check(reason is null or char_length(reason)<=1000),
  unique(suggestion_id,new_revision)
);

create index if not exists suggestion_moderation_history_timeline
  on private.suggestion_moderation_history(suggestion_id,id desc);

alter table private.suggestion_moderation_history enable row level security;
alter table private.suggestion_moderation_history force row level security;
drop policy if exists stage_c_deny_suggestion_moderation_history
  on private.suggestion_moderation_history;
create policy stage_c_deny_suggestion_moderation_history
  on private.suggestion_moderation_history
  for all to anon,authenticated,service_role
  using(false) with check(false);
revoke all on private.suggestion_moderation_history
  from public,anon,authenticated,service_role;

create or replace function private.stage_c_prevent_suggestion_history_mutation()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
begin
  raise exception 'El historial de moderación es inmutable' using errcode='55000';
end;
$$;

drop trigger if exists stage_c_suggestion_history_immutable
  on private.suggestion_moderation_history;
create trigger stage_c_suggestion_history_immutable
before update or delete on private.suggestion_moderation_history
for each row execute function private.stage_c_prevent_suggestion_history_mutation();

create or replace function private.stage_c_suggestion_transition_allowed(
  p_previous text,
  p_next text
)
returns boolean
language sql
immutable
security invoker
set search_path=''
as $$
  select case
    when p_previous=p_next then true
    when p_previous='new' and p_next in('reviewing','accepted','dismissed') then true
    when p_previous='reviewing' and p_next in('accepted','resolved','dismissed') then true
    when p_previous='accepted' and p_next in('resolved','dismissed') then true
    else false
  end;
$$;

create or replace function private.admin_list_suggestions(
  p_page integer default 1,
  p_page_size integer default 25,
  p_search text default null,
  p_status text default 'all',
  p_category text default 'all',
  p_sort text default 'recent',
  p_lifecycle text default 'active'
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_page integer:=coalesce(p_page,0);
  v_size integer:=coalesce(p_page_size,0);
  v_search text:=btrim(coalesce(p_search,''));
  v_pattern text;
  v_status text:=lower(coalesce(p_status,''));
  v_category text:=lower(coalesce(p_category,''));
  v_sort text:=lower(coalesce(p_sort,''));
  v_lifecycle text:=lower(coalesce(p_lifecycle,''));
  v_total bigint;
  v_items jsonb;
begin
  perform private.stage_c_assert_admin();

  if v_page<1 or v_page>100000 then
    raise exception 'Página inválida';
  end if;
  if v_size not in(10,25,50) then
    raise exception 'Tamaño de página inválido';
  end if;
  if char_length(v_search)>120 then
    raise exception 'Búsqueda demasiado extensa';
  end if;
  if v_status not in('all','new','reviewing','accepted','resolved','dismissed')
      or v_category not in('all','funcionalidad','visual','error','compra','otro')
      or v_sort not in('recent','oldest','updated')
      or v_lifecycle not in('active','archived','deleted','all') then
    raise exception 'Filtro inválido';
  end if;

  v_pattern:=replace(replace(replace(v_search,chr(92),chr(92)||chr(92)),'%',chr(92)||'%'),'_',chr(92)||'_');

  select count(*) into v_total
  from private.site_suggestions s
  where (v_status='all' or s.status=v_status)
    and (v_category='all' or s.category=v_category)
    and (v_search='' or s.subject ilike '%'||v_pattern||'%' escape E'\\'
      or s.description ilike '%'||v_pattern||'%' escape E'\\')
    and case v_lifecycle
      when 'active' then s.archived_at is null and s.deleted_at is null
      when 'archived' then s.archived_at is not null and s.deleted_at is null
      when 'deleted' then s.deleted_at is not null
      else true
    end;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',q.id,
        'category',q.category,
        'subject',q.subject,
        'status',q.status,
        'revision',q.revision,
        'archived_at',q.archived_at,
        'deleted_at',q.deleted_at,
        'created_at',q.created_at,
        'updated_at',q.updated_at,
        'recent_duplicate_count',q.recent_duplicate_count
      )
      order by
        case when v_sort='recent' then q.created_at end desc,
        case when v_sort='oldest' then q.created_at end asc,
        case when v_sort='updated' then q.updated_at end desc,
        q.id
    ),
    '[]'::jsonb
  ) into v_items
  from(
    select s.id,s.category,s.subject,s.status,s.revision,s.archived_at,s.deleted_at,
      s.created_at,s.updated_at,coalesce(d.duplicate_count,0)::bigint recent_duplicate_count
    from private.site_suggestions s
    left join lateral(
      select count(*) duplicate_count
      from private.suggestion_token_uses t
      where t.suggestion_id=s.id and t.result_code='accepted' and t.was_duplicate
    ) d on true
    where (v_status='all' or s.status=v_status)
      and (v_category='all' or s.category=v_category)
      and (v_search='' or s.subject ilike '%'||v_pattern||'%' escape E'\\'
        or s.description ilike '%'||v_pattern||'%' escape E'\\')
      and case v_lifecycle
        when 'active' then s.archived_at is null and s.deleted_at is null
        when 'archived' then s.archived_at is not null and s.deleted_at is null
        when 'deleted' then s.deleted_at is not null
        else true
      end
    order by
      case when v_sort='recent' then s.created_at end desc,
      case when v_sort='oldest' then s.created_at end asc,
      case when v_sort='updated' then s.updated_at end desc,
      s.id
    limit v_size offset (v_page-1)*v_size
  ) q;

  return jsonb_build_object(
    'items',v_items,
    'page',v_page,
    'page_size',v_size,
    'total',v_total,
    'lifecycle',v_lifecycle
  );
end;
$$;

create or replace function private.admin_get_suggestion(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  s private.site_suggestions;
  v_history jsonb;
  v_history_total bigint;
  v_duplicates bigint;
begin
  perform private.stage_c_assert_admin();
  if p_id is null then raise exception 'Identificador inválido'; end if;

  select * into s from private.site_suggestions where id=p_id;
  if not found then raise exception 'Sugerencia inexistente'; end if;

  select count(*) into v_duplicates
  from private.suggestion_token_uses t
  where t.suggestion_id=s.id and t.result_code='accepted' and t.was_duplicate;

  select count(*) into v_history_total
  from private.suggestion_moderation_history h
  where h.suggestion_id=s.id;

  select coalesce(jsonb_agg(to_jsonb(h) order by h.id desc),'[]'::jsonb)
  into v_history
  from(
    select id,actor_id,occurred_at,operation,previous_status,new_status,
      previous_revision,new_revision,changed_fields,reason
    from private.suggestion_moderation_history
    where suggestion_id=s.id
    order by id desc
    limit 100
  ) h;

  return jsonb_build_object(
    'id',s.id,
    'category',s.category,
    'subject',s.subject,
    'description',s.description,
    'contact',s.contact,
    'status',s.status,
    'private_notes',s.private_notes,
    'revision',s.revision,
    'archived_at',s.archived_at,
    'deleted_at',s.deleted_at,
    'created_at',s.created_at,
    'updated_at',s.updated_at,
    'recent_duplicate_count',v_duplicates,
    'history_total',v_history_total,
    'history',v_history
  );
end;
$$;

create or replace function private.admin_update_suggestion(
  p_id uuid,
  p_status text,
  p_private_notes text,
  p_expected_revision integer,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  s private.site_suggestions;
  v_previous private.site_suggestions;
  v_notes text;
  v_reason text;
  v_changed_fields text[]:=array[]::text[];
begin
  perform private.stage_c_assert_admin();
  if p_id is null or coalesce(p_expected_revision,0)<1 then
    raise exception 'Identificador o revisión inválidos';
  end if;
  if p_status not in('new','reviewing','accepted','resolved','dismissed') then
    raise exception 'Estado inválido';
  end if;

  v_notes:=private.stage_c_safe_text(p_private_notes,4000,false);
  v_reason:=nullif(private.stage_c_safe_text(p_reason,1000,false),'');

  select * into s
  from private.site_suggestions
  where id=p_id
  for update;
  if not found then raise exception 'Sugerencia inexistente'; end if;

  if s.revision<>p_expected_revision then
    return jsonb_build_object(
      'ok',false,'status','conflict','error','stale_revision',
      'current',jsonb_build_object(
        'id',s.id,'status',s.status,'revision',s.revision,
        'archived_at',s.archived_at,'deleted_at',s.deleted_at,'updated_at',s.updated_at
      )
    );
  end if;
  if s.deleted_at is not null then
    raise exception 'La sugerencia está eliminada lógicamente';
  end if;
  if not private.stage_c_suggestion_transition_allowed(s.status,p_status) then
    raise exception 'Transición de estado no permitida';
  end if;
  if p_status<>s.status and p_status in('resolved','dismissed') and v_reason is null then
    raise exception 'El motivo es obligatorio para cerrar una sugerencia';
  end if;

  if p_status=s.status and v_notes=s.private_notes then
    return jsonb_build_object(
      'ok',true,'status','unchanged','changed',false,
      'suggestion',jsonb_build_object(
        'id',s.id,'status',s.status,'revision',s.revision,
        'archived_at',s.archived_at,'deleted_at',s.deleted_at,'updated_at',s.updated_at
      )
    );
  end if;

  v_previous:=s;
  if p_status<>s.status then v_changed_fields:=array_append(v_changed_fields,'status'); end if;
  if v_notes<>s.private_notes then v_changed_fields:=array_append(v_changed_fields,'private_notes'); end if;

  update private.site_suggestions
  set status=p_status,
      private_notes=v_notes,
      revision=revision+1,
      updated_at=clock_timestamp(),
      updated_by=auth.uid()
  where id=p_id and revision=p_expected_revision
  returning * into s;
  if not found then
    raise exception 'Conflicto de revisión' using errcode='40001';
  end if;

  insert into private.suggestion_moderation_history(
    suggestion_id,actor_id,operation,previous_status,new_status,
    previous_revision,new_revision,changed_fields,reason
  ) values(
    s.id,auth.uid(),'update',v_previous.status,s.status,
    v_previous.revision,s.revision,v_changed_fields,v_reason
  );

  return jsonb_build_object(
    'ok',true,'status','updated','changed',true,
    'suggestion',jsonb_build_object(
      'id',s.id,'status',s.status,'revision',s.revision,
      'archived_at',s.archived_at,'deleted_at',s.deleted_at,'updated_at',s.updated_at
    )
  );
end;
$$;

create or replace function private.admin_set_suggestion_lifecycle(
  p_id uuid,
  p_action text,
  p_expected_revision integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  s private.site_suggestions;
  v_previous private.site_suggestions;
  v_action text:=lower(coalesce(p_action,''));
  v_reason text;
  v_changed_fields text[]:=array[]::text[];
  v_effective boolean:=true;
begin
  perform private.stage_c_assert_admin();
  if p_id is null or coalesce(p_expected_revision,0)<1 then
    raise exception 'Identificador o revisión inválidos';
  end if;
  if v_action not in('archive','unarchive','soft_delete','restore') then
    raise exception 'Acción de ciclo de vida inválida';
  end if;
  v_reason:=nullif(private.stage_c_safe_text(p_reason,1000,false),'');

  select * into s
  from private.site_suggestions
  where id=p_id
  for update;
  if not found then raise exception 'Sugerencia inexistente'; end if;

  if s.revision<>p_expected_revision then
    return jsonb_build_object(
      'ok',false,'status','conflict','error','stale_revision',
      'current',jsonb_build_object(
        'id',s.id,'status',s.status,'revision',s.revision,
        'archived_at',s.archived_at,'deleted_at',s.deleted_at,'updated_at',s.updated_at
      )
    );
  end if;

  if v_action in('archive','unarchive') and s.deleted_at is not null then
    raise exception 'La sugerencia eliminada debe restaurarse antes de cambiar su archivo';
  end if;

  v_effective:=case v_action
    when 'archive' then s.archived_at is null
    when 'unarchive' then s.archived_at is not null
    when 'soft_delete' then s.deleted_at is null
    when 'restore' then s.deleted_at is not null
  end;

  if not v_effective then
    return jsonb_build_object(
      'ok',true,'status','unchanged','changed',false,
      'suggestion',jsonb_build_object(
        'id',s.id,'status',s.status,'revision',s.revision,
        'archived_at',s.archived_at,'deleted_at',s.deleted_at,'updated_at',s.updated_at
      )
    );
  end if;
  if v_reason is null then
    raise exception 'El motivo es obligatorio para esta operación';
  end if;

  v_previous:=s;
  if v_action in('archive','unarchive') then
    v_changed_fields:=array['archived_at'];
  else
    v_changed_fields:=array['deleted_at'];
  end if;

  update private.site_suggestions
  set archived_at=case
        when v_action='archive' then clock_timestamp()
        when v_action='unarchive' then null
        else archived_at
      end,
      deleted_at=case
        when v_action='soft_delete' then clock_timestamp()
        when v_action='restore' then null
        else deleted_at
      end,
      revision=revision+1,
      updated_at=clock_timestamp(),
      updated_by=auth.uid()
  where id=p_id and revision=p_expected_revision
  returning * into s;
  if not found then
    raise exception 'Conflicto de revisión' using errcode='40001';
  end if;

  insert into private.suggestion_moderation_history(
    suggestion_id,actor_id,operation,previous_status,new_status,
    previous_revision,new_revision,changed_fields,reason
  ) values(
    s.id,auth.uid(),v_action,v_previous.status,s.status,
    v_previous.revision,s.revision,v_changed_fields,v_reason
  );

  return jsonb_build_object(
    'ok',true,'status','updated','changed',true,
    'suggestion',jsonb_build_object(
      'id',s.id,'status',s.status,'revision',s.revision,
      'archived_at',s.archived_at,'deleted_at',s.deleted_at,'updated_at',s.updated_at
    )
  );
end;
$$;

create or replace function private.cleanup_suggestion_protection()
returns void
language sql
security definer
set search_path=''
as $$
  delete from private.suggestion_token_uses where expires_at<now();
  delete from private.suggestion_rate_limits
    where updated_at<now()-interval '2 days'
      and coalesce(blocked_until,'-infinity')<now();
$$;

do $$
declare signature regprocedure;
begin
  foreach signature in array array[
      'private.stage_c_prevent_suggestion_history_mutation()'::regprocedure,
      'private.stage_c_suggestion_transition_allowed(text,text)'::regprocedure,
      'private.admin_list_suggestions(integer,integer,text,text,text,text,text)'::regprocedure,
      'private.admin_get_suggestion(uuid)'::regprocedure,
      'private.admin_update_suggestion(uuid,text,text,integer,text)'::regprocedure,
      'private.admin_set_suggestion_lifecycle(uuid,text,integer,text)'::regprocedure,
      'private.cleanup_suggestion_protection()'::regprocedure
    ] loop
      execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
  end loop;
end $$;

comment on function private.admin_update_suggestion(uuid,text,text,integer,text)
  is 'cubica_stage_c:20261024233029';

do $$
declare signature regprocedure;
begin
  if obj_description(
      to_regprocedure('private.admin_update_suggestion(uuid,text,text,integer,text)')::oid,
      'pg_proc'
    ) is distinct from 'cubica_stage_c:20261024233029' then
    raise exception 'stage_c_20261024233029_missing_sentinel';
  end if;
  if not exists(
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='private' and c.relname='suggestion_moderation_history'
      and c.relrowsecurity and c.relforcerowsecurity
  ) then
    raise exception 'stage_c_20261024233029_history_not_protected';
  end if;
  if exists(
    select 1 from information_schema.role_table_grants
    where table_schema='private'
      and table_name in('site_suggestions','suggestion_moderation_history')
      and grantee in('PUBLIC','anon','authenticated','service_role')
  ) then
    raise exception 'stage_c_20261024233029_direct_table_grant';
  end if;
  foreach signature in array array[
      'private.stage_c_prevent_suggestion_history_mutation()'::regprocedure,
      'private.stage_c_suggestion_transition_allowed(text,text)'::regprocedure,
      'private.admin_list_suggestions(integer,integer,text,text,text,text,text)'::regprocedure,
      'private.admin_get_suggestion(uuid)'::regprocedure,
      'private.admin_update_suggestion(uuid,text,text,integer,text)'::regprocedure,
      'private.admin_set_suggestion_lifecycle(uuid,text,integer,text)'::regprocedure,
      'private.cleanup_suggestion_protection()'::regprocedure
    ] loop
      if signature is null then
        raise exception 'stage_c_20261024233029_missing_function';
      end if;
      if has_function_privilege('anon',signature,'execute')
          or has_function_privilege('authenticated',signature,'execute')
          or has_function_privilege('service_role',signature,'execute') then
        raise exception 'stage_c_20261024233029_premature_execute:%',signature;
      end if;
      if exists(
        select 1 from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        where p.oid=signature::oid and acl.grantee=0 and acl.privilege_type='EXECUTE'
      ) then
        raise exception 'stage_c_20261024233029_public_execute:%',signature;
      end if;
      if exists(
        select 1 from pg_proc p
        where p.oid=signature::oid
          and not exists(
            select 1 from unnest(coalesce(p.proconfig,array[]::text[])) setting
            where setting='search_path=""'
          )
      ) then
        raise exception 'stage_c_20261024233029_unrestricted_search_path:%',signature;
      end if;
  end loop;
end $$;
