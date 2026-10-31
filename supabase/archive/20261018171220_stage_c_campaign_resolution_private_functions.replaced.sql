-- CÚBICA 3D — Etapa C, bloque 3B/9: resolución privada de campañas.

-- Supabase aplica cada archivo como una transacción independiente.

-- Ninguna función recibe EXECUTE desde roles de API en este bloque.

create or replace function private.stage_c_active_campaign(p_at timestamptz default now())
returns private.site_campaigns language sql stable security definer set search_path='' as $$
  with local_now as(select p_at at time zone 'America/Argentina/Buenos_Aires' v), candidates as(
    select c.*,
      case
        when c.recurrence_mode='none' then c.starts_at
        when c.recurrence_mode='custom' then (select max(o.starts_at) from private.site_campaign_occurrences o where o.campaign_id=c.id and p_at>=o.starts_at and p_at<o.ends_at)
        else (
          case when (c.annual_start_month,c.annual_start_day,c.annual_start_time)>(c.annual_end_month,c.annual_end_day,c.annual_end_time)
            and n.v < make_date(extract(year from n.v)::int,c.annual_end_month,c.annual_end_day)+c.annual_end_time
          then make_date(extract(year from n.v)::int-1,c.annual_start_month,c.annual_start_day)+c.annual_start_time
          else make_date(extract(year from n.v)::int,c.annual_start_month,c.annual_start_day)+c.annual_start_time end
        ) at time zone 'America/Argentina/Buenos_Aires'
      end effective_start
    from private.site_campaigns c,local_now n
    where c.state='published' and c.deleted_at is null and (
      (c.recurrence_mode='none' and p_at>=c.starts_at and p_at<c.ends_at)
      or (c.recurrence_mode='custom' and exists(select 1 from private.site_campaign_occurrences o where o.campaign_id=c.id and p_at>=o.starts_at and p_at<o.ends_at))
      or (c.recurrence_mode='annual' and (
        case
          when make_date(extract(year from n.v)::int,c.annual_start_month,c.annual_start_day)+c.annual_start_time
               < make_date(extract(year from n.v)::int,c.annual_end_month,c.annual_end_day)+c.annual_end_time
          then n.v >= make_date(extract(year from n.v)::int,c.annual_start_month,c.annual_start_day)+c.annual_start_time
           and n.v < make_date(extract(year from n.v)::int,c.annual_end_month,c.annual_end_day)+c.annual_end_time
          else n.v >= make_date(extract(year from n.v)::int,c.annual_start_month,c.annual_start_day)+c.annual_start_time
            or n.v < make_date(extract(year from n.v)::int,c.annual_end_month,c.annual_end_day)+c.annual_end_time
        end
      ))
    )
  ) select c from candidates c order by priority desc,effective_start desc,published_at desc,id asc limit 1;
$$;

create or replace function private.stage_c_next_change(p_at timestamptz default now())
returns timestamptz language sql stable security definer set search_path='' as $$
  select min(x) from(
    select starts_at x from private.site_campaigns where state='published' and deleted_at is null and recurrence_mode='none' and starts_at>p_at
    union all select ends_at from private.site_campaigns where state='published' and deleted_at is null and recurrence_mode='none' and ends_at>p_at
    union all select starts_at from private.site_campaign_occurrences o join private.site_campaigns c on c.id=o.campaign_id where c.state='published' and c.deleted_at is null and starts_at>p_at
    union all select ends_at from private.site_campaign_occurrences o join private.site_campaigns c on c.id=o.campaign_id where c.state='published' and c.deleted_at is null and ends_at>p_at
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
      'private.stage_c_active_campaign(timestamptz)'::regprocedure,
      'private.stage_c_next_change(timestamptz)'::regprocedure
    ] loop
      execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
    end loop;
end $$;

comment on function private.stage_c_active_campaign(timestamptz) is 'cubica_stage_c:20261018171220';

do $$
begin
  if obj_description(to_regprocedure('private.stage_c_assert_admin()')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171210' then
    raise exception 'stage_c_171220_missing_prerequisite:private.stage_c_assert_admin()';
  end if;
end $$;

do $$
declare signature regprocedure;
begin
  if obj_description(to_regprocedure('private.stage_c_active_campaign(timestamptz)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171220' then
    raise exception 'stage_c_171220_missing_sentinel';
  end if;
  foreach signature in array array[
      'private.stage_c_active_campaign(timestamptz)'::regprocedure,
      'private.stage_c_next_change(timestamptz)'::regprocedure
    ] loop
      if signature is null then
        raise exception 'stage_c_171220_missing_function';
      end if;
      if has_function_privilege('anon',signature,'execute')
        or has_function_privilege('authenticated',signature,'execute')
        or has_function_privilege('service_role',signature,'execute') then
        raise exception 'stage_c_171220_premature_execute:%',signature;
      end if;
      if exists(
        select 1
        from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        where p.oid=signature::oid and acl.grantee=0 and acl.privilege_type='EXECUTE'
      ) then
        raise exception 'stage_c_171220_public_execute:%',signature;
      end if;
      if exists(
        select 1 from pg_proc p where p.oid=signature::oid
          and not exists(select 1 from unnest(coalesce(p.proconfig,array[]::text[])) setting where setting like 'search_path=%')
      ) then
        raise exception 'stage_c_171220_unrestricted_search_path:%',signature;
      end if;
      if (select p.prosecdef from pg_proc p where p.oid=signature::oid)
        is distinct from (signature=any(array['private.stage_c_active_campaign(timestamptz)'::regprocedure,'private.stage_c_next_change(timestamptz)'::regprocedure]::regprocedure[])) then
        raise exception 'stage_c_171220_wrong_security_mode:%',signature;
      end if;
    end loop;
end $$;

