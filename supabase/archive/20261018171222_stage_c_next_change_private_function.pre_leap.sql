-- CÚBICA 3D — Etapa C, bloque 3B-2: próximo cambio de campaña.

-- Migración cerrada: no concede EXECUTE a roles de Data API.

do $$
begin
  if obj_description(to_regprocedure('private.stage_c_active_campaign(timestamptz)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171219' then
    raise exception 'stage_c_171222_missing_prerequisite:private.stage_c_active_campaign(timestamptz)';
  end if;
end $$;

create or replace function private.stage_c_next_change(p_at timestamptz default now())
returns timestamptz language sql stable security definer set search_path='' as $$
  select min(x) from(
    select starts_at x from private.site_campaigns where state='published' and deleted_at is null and recurrence_mode='none' and starts_at>p_at
    union all select ends_at from private.site_campaigns where state='published' and deleted_at is null and recurrence_mode='none' and ends_at>p_at
    union all select o.starts_at from private.site_campaign_occurrences o join private.site_campaigns c on c.id=o.campaign_id where c.state='published' and c.deleted_at is null and o.starts_at>p_at
    union all select o.ends_at from private.site_campaign_occurrences o join private.site_campaigns c on c.id=o.campaign_id where c.state='published' and c.deleted_at is null and o.ends_at>p_at
    union all select (make_date(extract(year from (p_at at time zone 'America/Argentina/Buenos_Aires'))::int+y,c.annual_start_month,c.annual_start_day)+c.annual_start_time) at time zone 'America/Argentina/Buenos_Aires'
      from private.site_campaigns c cross join generate_series(0,1) y where c.state='published' and c.deleted_at is null and c.recurrence_mode='annual'
        and ((make_date(extract(year from (p_at at time zone 'America/Argentina/Buenos_Aires'))::int+y,c.annual_start_month,c.annual_start_day)+c.annual_start_time) at time zone 'America/Argentina/Buenos_Aires')>p_at
    union all select (make_date(extract(year from (p_at at time zone 'America/Argentina/Buenos_Aires'))::int+y,c.annual_end_month,c.annual_end_day)+c.annual_end_time) at time zone 'America/Argentina/Buenos_Aires'
      from private.site_campaigns c cross join generate_series(0,1) y where c.state='published' and c.deleted_at is null and c.recurrence_mode='annual'
        and ((make_date(extract(year from (p_at at time zone 'America/Argentina/Buenos_Aires'))::int+y,c.annual_end_month,c.annual_end_day)+c.annual_end_time) at time zone 'America/Argentina/Buenos_Aires')>p_at
  ) q;
$$;

do $$
declare signature regprocedure;
begin
  foreach signature in array array[
      'private.stage_c_next_change(timestamptz)'::regprocedure
    ] loop
      execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
    end loop;
end $$;

comment on function private.stage_c_next_change(timestamptz) is 'cubica_stage_c:20261018171222';

do $$
declare signature regprocedure;
begin
  if obj_description(to_regprocedure('private.stage_c_next_change(timestamptz)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171222' then
    raise exception 'stage_c_171222_missing_sentinel';
  end if;
  foreach signature in array array[
      'private.stage_c_next_change(timestamptz)'::regprocedure
    ] loop
      if signature is null then raise exception 'stage_c_171222_missing_function'; end if;
      if has_function_privilege('anon',signature,'execute')
        or has_function_privilege('authenticated',signature,'execute')
        or has_function_privilege('service_role',signature,'execute') then
        raise exception 'stage_c_171222_premature_execute:%',signature;
      end if;
      if exists(
        select 1 from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        where p.oid=signature::oid and acl.grantee=0 and acl.privilege_type='EXECUTE'
      ) then raise exception 'stage_c_171222_public_execute:%',signature; end if;
      if exists(
        select 1 from pg_proc p where p.oid=signature::oid
        and not exists(select 1 from unnest(coalesce(p.proconfig,array[]::text[])) setting where setting like 'search_path=%')
      ) then raise exception 'stage_c_171222_unrestricted_search_path:%',signature; end if;
      if (select not p.prosecdef from pg_proc p where p.oid=signature::oid) is distinct from (false) then
        raise exception 'stage_c_171222_wrong_security_mode:%',signature;
      end if;
    end loop;
end $$;
