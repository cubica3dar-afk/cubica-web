-- CÚBICA 3D — Etapa C, bloque 3B-2 v2: próximo cambio de campaña.

-- Omite ocurrencias anuales con límites inexistentes y busca hasta ocho años,
-- cubriendo el salto máximo entre 29 de febrero válidos del calendario gregoriano.
-- Migración cerrada: no concede EXECUTE a roles de Data API.

do $$
begin
  if obj_description(to_regprocedure('private.stage_c_active_campaign(timestamptz)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171218' then
    raise exception 'stage_c_171223_missing_prerequisite:private.stage_c_active_campaign(timestamptz)';
  end if;
end $$;

create or replace function private.stage_c_next_change(p_at timestamptz default now())
returns timestamptz language sql stable security definer set search_path='' as $$
  with local_now as(
    select p_at at time zone 'America/Argentina/Buenos_Aires' v
  ), annual_seeds as(
    select c campaign,
      make_date(y.start_year,c.annual_start_month,1)+(c.annual_start_day-1)+c.annual_start_time local_start,
      make_date(
        y.start_year+case when
          (c.annual_start_month,c.annual_start_day,c.annual_start_time)>=(c.annual_end_month,c.annual_end_day,c.annual_end_time)
          then 1 else 0 end,
        c.annual_end_month,1
      )+(c.annual_end_day-1)+c.annual_end_time local_end
    from private.site_campaigns c
    cross join local_now n
    cross join lateral generate_series(extract(year from n.v)::int-1,extract(year from n.v)::int+8) y(start_year)
    where c.state='published' and c.deleted_at is null and c.recurrence_mode='annual'
  ), annual_valid as(
    select s.local_start,s.local_end
    from annual_seeds s
    where extract(month from s.local_start)::int=(s.campaign).annual_start_month
      and extract(month from s.local_end)::int=(s.campaign).annual_end_month
      and s.local_start<s.local_end
  )
  select min(x) from(
    select starts_at x from private.site_campaigns where state='published' and deleted_at is null and recurrence_mode='none' and starts_at>p_at
    union all select ends_at from private.site_campaigns where state='published' and deleted_at is null and recurrence_mode='none' and ends_at>p_at
    union all select o.starts_at from private.site_campaign_occurrences o join private.site_campaigns c on c.id=o.campaign_id where c.state='published' and c.deleted_at is null and o.starts_at>p_at
    union all select o.ends_at from private.site_campaign_occurrences o join private.site_campaigns c on c.id=o.campaign_id where c.state='published' and c.deleted_at is null and o.ends_at>p_at
    union all select a.local_start at time zone 'America/Argentina/Buenos_Aires' from annual_valid a where (a.local_start at time zone 'America/Argentina/Buenos_Aires')>p_at
    union all select a.local_end at time zone 'America/Argentina/Buenos_Aires' from annual_valid a where (a.local_end at time zone 'America/Argentina/Buenos_Aires')>p_at
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

comment on function private.stage_c_next_change(timestamptz) is 'cubica_stage_c:20261018171223';

do $$
declare signature regprocedure;
begin
  if obj_description(to_regprocedure('private.stage_c_next_change(timestamptz)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171223' then
    raise exception 'stage_c_171223_missing_sentinel';
  end if;
  foreach signature in array array[
      'private.stage_c_next_change(timestamptz)'::regprocedure
    ] loop
      if signature is null then raise exception 'stage_c_171223_missing_function'; end if;
      if pg_get_function_result(signature::oid) is distinct from 'timestamp with time zone' then
        raise exception 'stage_c_171223_wrong_return_type:%',pg_get_function_result(signature::oid);
      end if;
      if has_function_privilege('anon',signature,'execute')
        or has_function_privilege('authenticated',signature,'execute')
        or has_function_privilege('service_role',signature,'execute') then
        raise exception 'stage_c_171223_premature_execute:%',signature;
      end if;
      if exists(
        select 1 from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        where p.oid=signature::oid and acl.grantee=0 and acl.privilege_type='EXECUTE'
      ) then raise exception 'stage_c_171223_public_execute:%',signature; end if;
      if exists(
        select 1 from pg_proc p where p.oid=signature::oid
        and not exists(select 1 from unnest(coalesce(p.proconfig,array[]::text[])) setting where setting like 'search_path=%')
      ) then raise exception 'stage_c_171223_unrestricted_search_path:%',signature; end if;
      if (select not p.prosecdef from pg_proc p where p.oid=signature::oid) is distinct from false then
        raise exception 'stage_c_171223_wrong_security_mode:%',signature;
      end if;
    end loop;
end $$;

