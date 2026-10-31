-- CÚBICA 3D — Etapa C, bloque 5B: protección y persistencia de sugerencias.

-- Migración cerrada: no concede EXECUTE a roles de Data API.

do $$
begin
  if obj_description(to_regprocedure('private.stage_c_assert_admin()')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171210' then
    raise exception 'stage_c_171302_missing_prerequisite:private.stage_c_assert_admin()';
  end if;
end $$;

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

do $$
declare signature regprocedure;
begin
  foreach signature in array array[
      'private.consume_suggestion_protection(text,text,uuid)'::regprocedure,
      'private.submit_public_suggestion(text,text,text,text,uuid,uuid)'::regprocedure
    ] loop
      execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
    end loop;
end $$;

comment on function private.submit_public_suggestion(text,text,text,text,uuid,uuid) is 'cubica_stage_c:20261018171302';

do $$
declare signature regprocedure;
begin
  if obj_description(to_regprocedure('private.submit_public_suggestion(text,text,text,text,uuid,uuid)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171302' then
    raise exception 'stage_c_171302_missing_sentinel';
  end if;
  foreach signature in array array[
      'private.consume_suggestion_protection(text,text,uuid)'::regprocedure,
      'private.submit_public_suggestion(text,text,text,text,uuid,uuid)'::regprocedure
    ] loop
      if signature is null then raise exception 'stage_c_171302_missing_function'; end if;
      if has_function_privilege('anon',signature,'execute')
        or has_function_privilege('authenticated',signature,'execute')
        or has_function_privilege('service_role',signature,'execute') then
        raise exception 'stage_c_171302_premature_execute:%',signature;
      end if;
      if exists(
        select 1 from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        where p.oid=signature::oid and acl.grantee=0 and acl.privilege_type='EXECUTE'
      ) then raise exception 'stage_c_171302_public_execute:%',signature; end if;
      if exists(
        select 1 from pg_proc p where p.oid=signature::oid
        and not exists(select 1 from unnest(coalesce(p.proconfig,array[]::text[])) setting where setting like 'search_path=%')
      ) then raise exception 'stage_c_171302_unrestricted_search_path:%',signature; end if;
      if (select not p.prosecdef from pg_proc p where p.oid=signature::oid) is distinct from (false) then
        raise exception 'stage_c_171302_wrong_security_mode:%',signature;
      end if;
    end loop;
end $$;
