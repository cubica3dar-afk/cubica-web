-- CÚBICA 3D — Etapa C, bloque 5B v2: protección y persistencia atómica de sugerencias.

-- Migración cerrada: no crea wrappers públicos ni concede EXECUTE a roles de API.
-- Los rechazos esperados se devuelven como JSON para que el estado de bloqueo pueda
-- confirmarse. Los errores técnicos usan excepciones y revierten toda la operación.

do $$
begin
  if obj_description(to_regprocedure('private.stage_c_assert_admin()')::oid,'pg_proc')
      is distinct from 'cubica_stage_c:20261018171210' then
    raise exception 'stage_c_171257_missing_prerequisite:private.stage_c_assert_admin()';
  end if;
  if obj_description(to_regclass('private.site_suggestions'),'pg_class')
      is distinct from 'cubica_stage_c:20261018171100' then
    raise exception 'stage_c_171257_missing_prerequisite:private.site_suggestions';
  end if;
end $$;

alter table private.suggestion_rate_limits
  add column if not exists scope text,
  add column if not exists updated_at timestamptz;

update private.suggestion_rate_limits
set scope=coalesce(scope,'legacy'),updated_at=coalesce(updated_at,window_started_at)
where scope is null or updated_at is null;

alter table private.suggestion_rate_limits
  alter column scope set default 'legacy',
  alter column scope set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

do $$ begin
  if not exists(
    select 1 from pg_constraint
    where conrelid='private.suggestion_rate_limits'::regclass
      and conname='suggestion_rate_limits_scope_check'
  ) then
    alter table private.suggestion_rate_limits
      add constraint suggestion_rate_limits_scope_check
      check(scope in ('legacy','user','guest','network'));
  end if;
  if not exists(
    select 1 from pg_constraint
    where conrelid='private.suggestion_rate_limits'::regclass
      and conname='suggestion_rate_limits_hash_check'
  ) then
    alter table private.suggestion_rate_limits
      add constraint suggestion_rate_limits_hash_check
      check(identity_hash ~ '^[0-9a-f]{64}$');
  end if;
end $$;

alter table private.suggestion_token_uses
  add column if not exists request_id uuid,
  add column if not exists actor_kind text,
  add column if not exists actor_hash text,
  add column if not exists network_hash text,
  add column if not exists payload_hash text,
  add column if not exists result_code text,
  add column if not exists suggestion_id uuid references private.site_suggestions(id) on delete set null,
  add column if not exists retry_after_seconds integer;

do $$ begin
  if not exists(
    select 1 from pg_constraint
    where conrelid='private.suggestion_token_uses'::regclass
      and conname='suggestion_token_uses_actor_kind_check'
  ) then
    alter table private.suggestion_token_uses
      add constraint suggestion_token_uses_actor_kind_check
      check(actor_kind is null or actor_kind in ('user','guest'));
  end if;
  if not exists(
    select 1 from pg_constraint
    where conrelid='private.suggestion_token_uses'::regclass
      and conname='suggestion_token_uses_result_check'
  ) then
    alter table private.suggestion_token_uses
      add constraint suggestion_token_uses_result_check
      check(result_code is null or result_code in ('processing','accepted','rate_limited'));
  end if;
  if not exists(
    select 1 from pg_constraint
    where conrelid='private.suggestion_token_uses'::regclass
      and conname='suggestion_token_uses_retry_check'
  ) then
    alter table private.suggestion_token_uses
      add constraint suggestion_token_uses_retry_check
      check(retry_after_seconds is null or retry_after_seconds between 0 and 3600);
  end if;
  if not exists(
    select 1 from pg_constraint
    where conrelid='private.suggestion_token_uses'::regclass
      and conname='suggestion_token_uses_metadata_check'
  ) then
    alter table private.suggestion_token_uses
      add constraint suggestion_token_uses_metadata_check check(
        result_code is null or (
          request_id is not null
          and actor_kind is not null
          and actor_hash ~ '^[0-9a-f]{64}$'
          and network_hash ~ '^[0-9a-f]{64}$'
          and payload_hash ~ '^[0-9a-f]{64}$'
          and ((result_code='accepted' and suggestion_id is not null)
            or (result_code in ('processing','rate_limited') and suggestion_id is null))
        )
      );
  end if;
  if not exists(
    select 1 from pg_constraint
    where conrelid='private.suggestion_token_uses'::regclass
      and conname='suggestion_token_uses_token_hash_check'
  ) then
    alter table private.suggestion_token_uses
      add constraint suggestion_token_uses_token_hash_check
      check(token_hash ~ '^[0-9a-f]{64}$');
  end if;
end $$;

create unique index if not exists suggestion_request_once
  on private.suggestion_token_uses(request_id)
  where request_id is not null;
create index if not exists suggestion_token_cleanup
  on private.suggestion_token_uses(expires_at);
create index if not exists suggestion_payload_lookup
  on private.suggestion_token_uses(actor_hash,payload_hash,used_at desc)
  where result_code='accepted';
create index if not exists suggestion_rate_limit_cleanup
  on private.suggestion_rate_limits(updated_at,blocked_until);

create or replace function private.stage_c_apply_suggestion_limit(
  p_identity_hash text,
  p_scope text,
  p_limit integer,
  p_now timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_row private.suggestion_rate_limits;
  v_retry integer:=0;
begin
  if p_identity_hash !~ '^[0-9a-f]{64}$'
      or p_scope not in ('user','guest','network')
      or p_limit not between 1 and 100
      or p_now is null then
    raise exception 'suggestion_protection_invalid';
  end if;

  insert into private.suggestion_rate_limits as current(
    identity_hash,scope,window_started_at,attempts,blocked_until,updated_at
  ) values(p_identity_hash,p_scope,p_now,1,null,p_now)
  on conflict(identity_hash) do update set
    window_started_at=case
      when current.blocked_until>p_now then current.window_started_at
      when current.window_started_at<=p_now-interval '1 hour' then p_now
      else current.window_started_at
    end,
    attempts=case
      when current.blocked_until>p_now then current.attempts
      when current.window_started_at<=p_now-interval '1 hour' then 1
      when current.attempts<p_limit then current.attempts+1
      else current.attempts
    end,
    blocked_until=case
      when current.blocked_until>p_now then current.blocked_until
      when current.window_started_at<=p_now-interval '1 hour' then null
      when current.attempts>=p_limit then p_now+interval '1 hour'
      else current.blocked_until
    end,
    updated_at=p_now
  where current.scope=excluded.scope
  returning * into v_row;

  if not found then
    raise exception 'suggestion_protection_scope_conflict';
  end if;

  if v_row.blocked_until>p_now then
    v_retry:=least(3600,greatest(1,ceil(extract(epoch from v_row.blocked_until-p_now))::integer));
    return jsonb_build_object('allowed',false,'code','rate_limited','retry_after_seconds',v_retry);
  end if;
  return jsonb_build_object('allowed',true,'code','allowed','retry_after_seconds',0);
end;
$$;

create or replace function private.submit_protected_suggestion(
  p_token_hash text,
  p_network_hash text,
  p_actor_hash text,
  p_actor_kind text,
  p_category text,
  p_subject text,
  p_description text,
  p_contact text,
  p_request_id uuid,
  p_verified_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_now timestamptz:=clock_timestamp();
  v_subject text;
  v_description text;
  v_contact text;
  v_payload_hash text;
  v_existing private.suggestion_token_uses;
  v_claimed text;
  v_actor_result jsonb;
  v_network_result jsonb;
  v_retry integer;
  v_suggestion_id uuid;
  v_actor_limit integer;
begin
  if auth.role()<>'service_role' then
    raise exception 'Ruta interna' using errcode='42501';
  end if;
  if p_token_hash !~ '^[0-9a-f]{64}$'
      or p_network_hash !~ '^[0-9a-f]{64}$'
      or p_actor_hash !~ '^[0-9a-f]{64}$'
      or p_network_hash=p_actor_hash
      or p_request_id is null then
    raise exception 'Protección inválida';
  end if;
  if p_actor_kind not in ('user','guest')
      or (p_actor_kind='user') is distinct from (p_verified_user_id is not null) then
    raise exception 'Identidad inválida';
  end if;
  if p_category not in ('funcionalidad','visual','error','compra','otro') then
    raise exception 'Categoría inválida';
  end if;

  v_subject:=private.stage_c_safe_text(p_subject,160,true);
  v_description:=private.stage_c_safe_text(p_description,3000,true);
  v_contact:=nullif(private.stage_c_safe_text(p_contact,320,false),'');
  if char_length(v_subject)<3 or char_length(v_description)<10 then
    raise exception 'Texto inválido';
  end if;
  if concat_ws(' ',v_subject,v_description,v_contact) ~ '[<>]'
      or concat_ws(' ',v_subject,v_description,v_contact) ~* '(javascript|vbscript|data)[[:space:]]*:' then
    raise exception 'El contenido incluye HTML o un enlace no permitido';
  end if;

  v_payload_hash:=encode(extensions.digest(
    convert_to(jsonb_build_object(
      'category',p_category,
      'subject',v_subject,
      'description',v_description,
      'contact',v_contact,
      'verified_user_id',p_verified_user_id
    )::text,'UTF8'),'sha256'
  ),'hex');

  select * into v_existing
  from private.suggestion_token_uses
  where request_id=p_request_id
  for update;

  if found then
    if v_existing.actor_kind is distinct from p_actor_kind
        or v_existing.actor_hash is distinct from p_actor_hash
        or v_existing.network_hash is distinct from p_network_hash
        or v_existing.payload_hash is distinct from v_payload_hash then
      return jsonb_build_object('status','idempotency_conflict');
    end if;
    if v_existing.result_code='accepted' and v_existing.suggestion_id is not null then
      return jsonb_build_object(
        'status','accepted','suggestion_id',v_existing.suggestion_id,'idempotent',true
      );
    end if;
    if v_existing.result_code='rate_limited' then
      return jsonb_build_object(
        'status','rate_limited',
        'retry_after_seconds',greatest(0,coalesce(v_existing.retry_after_seconds,0)),
        'idempotent',true
      );
    end if;
    raise exception 'suggestion_request_incomplete';
  end if;

  -- Serializa el mismo contenido por actor. La retención de 24 horas evita
  -- duplicados por reintentos con UUID diferentes sin bloquearlos para siempre.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_actor_hash||':'||v_payload_hash,0)
  );
  select * into v_existing
  from private.suggestion_token_uses
  where actor_hash=p_actor_hash
    and payload_hash=v_payload_hash
    and result_code='accepted'
    and suggestion_id is not null
    and used_at>=v_now-interval '24 hours'
  order by used_at desc
  limit 1;
  if found then
    return jsonb_build_object(
      'status','accepted','suggestion_id',v_existing.suggestion_id,
      'idempotent',false,'duplicate',true
    );
  end if;

  insert into private.suggestion_token_uses(
    token_hash,used_at,expires_at,request_id,actor_kind,actor_hash,network_hash,
    payload_hash,result_code,retry_after_seconds
  ) values(
    p_token_hash,v_now,v_now+interval '24 hours',p_request_id,p_actor_kind,
    p_actor_hash,p_network_hash,v_payload_hash,'processing',0
  )
  on conflict do nothing
  returning token_hash into v_claimed;

  if v_claimed is null then
    select * into v_existing
    from private.suggestion_token_uses
    where request_id=p_request_id
    for update;
    if found then
      if v_existing.actor_kind is distinct from p_actor_kind
          or v_existing.actor_hash is distinct from p_actor_hash
          or v_existing.network_hash is distinct from p_network_hash
          or v_existing.payload_hash is distinct from v_payload_hash then
        return jsonb_build_object('status','idempotency_conflict');
      end if;
      if v_existing.result_code='accepted' and v_existing.suggestion_id is not null then
        return jsonb_build_object(
          'status','accepted','suggestion_id',v_existing.suggestion_id,'idempotent',true
        );
      end if;
      if v_existing.result_code='rate_limited' then
        return jsonb_build_object(
          'status','rate_limited',
          'retry_after_seconds',greatest(0,coalesce(v_existing.retry_after_seconds,0)),
          'idempotent',true
        );
      end if;
      raise exception 'suggestion_request_incomplete';
    end if;
    return jsonb_build_object('status','token_replayed');
  end if;

  v_actor_limit:=case when p_actor_kind='user' then 5 else 3 end;
  v_actor_result:=private.stage_c_apply_suggestion_limit(
    p_actor_hash,p_actor_kind,v_actor_limit,v_now
  );
  if not coalesce((v_actor_result->>'allowed')::boolean,false) then
    v_retry:=(v_actor_result->>'retry_after_seconds')::integer;
    update private.suggestion_token_uses
    set result_code='rate_limited',retry_after_seconds=v_retry
    where token_hash=p_token_hash;
    return jsonb_build_object(
      'status','rate_limited','retry_after_seconds',v_retry,'idempotent',false
    );
  end if;

  v_network_result:=private.stage_c_apply_suggestion_limit(
    p_network_hash,'network',20,v_now
  );
  if not coalesce((v_network_result->>'allowed')::boolean,false) then
    v_retry:=(v_network_result->>'retry_after_seconds')::integer;
    update private.suggestion_token_uses
    set result_code='rate_limited',retry_after_seconds=v_retry
    where token_hash=p_token_hash;
    return jsonb_build_object(
      'status','rate_limited','retry_after_seconds',v_retry,'idempotent',false
    );
  end if;

  insert into private.site_suggestions(
    category,subject,description,contact,user_id,request_id
  ) values(
    p_category,v_subject,v_description,v_contact,p_verified_user_id,p_request_id
  ) returning id into v_suggestion_id;

  update private.suggestion_token_uses
  set result_code='accepted',suggestion_id=v_suggestion_id,retry_after_seconds=0
  where token_hash=p_token_hash;

  return jsonb_build_object(
    'status','accepted','suggestion_id',v_suggestion_id,'idempotent',false
  );
end;
$$;

do $$
declare signature regprocedure;
begin
  foreach signature in array array[
    'private.stage_c_apply_suggestion_limit(text,text,integer,timestamptz)'::regprocedure,
    'private.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)'::regprocedure
  ] loop
    execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
  end loop;
end $$;

comment on function private.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)
  is 'cubica_stage_c:20261018171257';

do $$
declare signature regprocedure;
begin
  if obj_description(
      to_regprocedure('private.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)')::oid,
      'pg_proc'
    ) is distinct from 'cubica_stage_c:20261018171257' then
    raise exception 'stage_c_171257_missing_sentinel';
  end if;
  foreach signature in array array[
    'private.stage_c_apply_suggestion_limit(text,text,integer,timestamptz)'::regprocedure,
    'private.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)'::regprocedure
  ] loop
    if signature is null then raise exception 'stage_c_171257_missing_function'; end if;
    if has_function_privilege('anon',signature,'execute')
        or has_function_privilege('authenticated',signature,'execute')
        or has_function_privilege('service_role',signature,'execute') then
      raise exception 'stage_c_171257_premature_execute:%',signature;
    end if;
    if exists(
      select 1 from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      where p.oid=signature::oid and acl.grantee=0 and acl.privilege_type='EXECUTE'
    ) then raise exception 'stage_c_171257_public_execute:%',signature; end if;
    if exists(
      select 1 from pg_proc p where p.oid=signature::oid
      and not exists(
        select 1 from unnest(coalesce(p.proconfig,array[]::text[])) setting
        where setting like 'search_path=%'
      )
    ) then raise exception 'stage_c_171257_unrestricted_search_path:%',signature; end if;
  end loop;
  if not (select prosecdef from pg_proc where oid=
      'private.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)'::regprocedure) then
    raise exception 'stage_c_171257_submit_not_definer';
  end if;
  if (select prosecdef from pg_proc where oid=
      'private.stage_c_apply_suggestion_limit(text,text,integer,timestamptz)'::regprocedure) then
    raise exception 'stage_c_171257_helper_not_invoker';
  end if;
  if exists(
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='private'
      and c.relname in ('site_suggestions','suggestion_token_uses','suggestion_rate_limits')
      and not c.relrowsecurity
  ) then raise exception 'stage_c_171257_rls_disabled'; end if;
end $$;
