-- CÚBICA 3D — Etapa C, bloque 3B-1 v3: campaña activa.

-- Devuelve exactamente private.site_campaigns y omite ocurrencias anuales
-- cuyas fechas no existan en el año correspondiente (por ejemplo, 29/02).
-- Migración cerrada: no concede EXECUTE a roles de Data API.

do $$
begin
  if obj_description(to_regprocedure('private.stage_c_assert_admin()')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171210' then
    raise exception 'stage_c_171218_missing_prerequisite:private.stage_c_assert_admin()';
  end if;
end $$;

create or replace function private.stage_c_active_campaign(p_at timestamptz default now())
returns private.site_campaigns language sql stable security definer set search_path='' as $$
  with local_now as(
    select p_at at time zone 'America/Argentina/Buenos_Aires' v
  ), annual_seeds as(
    select c campaign,n.v local_value,
      make_date(y.start_year,c.annual_start_month,1)+(c.annual_start_day-1)+c.annual_start_time local_start,
      make_date(
        y.start_year+case when
          (c.annual_start_month,c.annual_start_day,c.annual_start_time)>=(c.annual_end_month,c.annual_end_day,c.annual_end_time)
          then 1 else 0 end,
        c.annual_end_month,1
      )+(c.annual_end_day-1)+c.annual_end_time local_end
    from private.site_campaigns c
    cross join local_now n
    cross join lateral generate_series(extract(year from n.v)::int-1,extract(year from n.v)::int) y(start_year)
    where c.state='published' and c.deleted_at is null and c.recurrence_mode='annual'
  ), annual_active as(
    select s.campaign,(s.local_start at time zone 'America/Argentina/Buenos_Aires') effective_start
    from annual_seeds s
    where extract(month from s.local_start)::int=(s.campaign).annual_start_month
      and extract(month from s.local_end)::int=(s.campaign).annual_end_month
      and s.local_start<s.local_end
      and s.local_value>=s.local_start and s.local_value<s.local_end
  ), candidates as(
    select c campaign,
      case
        when c.recurrence_mode='none' then c.starts_at
        else (select max(o.starts_at) from private.site_campaign_occurrences o
              where o.campaign_id=c.id and p_at>=o.starts_at and p_at<o.ends_at)
      end effective_start
    from private.site_campaigns c
    where c.state='published' and c.deleted_at is null and (
      (c.recurrence_mode='none' and p_at>=c.starts_at and p_at<c.ends_at)
      or (c.recurrence_mode='custom' and exists(
        select 1 from private.site_campaign_occurrences o
        where o.campaign_id=c.id and p_at>=o.starts_at and p_at<o.ends_at
      ))
    )
    union all
    select a.campaign,a.effective_start from annual_active a
  )
  select
    (c.campaign).id,
    (c.campaign).name,
    (c.campaign).description,
    (c.campaign).state,
    (c.campaign).priority,
    (c.campaign).recurrence_mode,
    (c.campaign).starts_at,
    (c.campaign).ends_at,
    (c.campaign).annual_start_month,
    (c.campaign).annual_start_day,
    (c.campaign).annual_start_time,
    (c.campaign).annual_end_month,
    (c.campaign).annual_end_day,
    (c.campaign).annual_end_time,
    (c.campaign).theme,
    (c.campaign).apply_email_theme,
    (c.campaign).email_theme_key,
    (c.campaign).version,
    (c.campaign).created_at,
    (c.campaign).created_by,
    (c.campaign).updated_at,
    (c.campaign).updated_by,
    (c.campaign).published_at,
    (c.campaign).published_by,
    (c.campaign).deleted_at,
    (c.campaign).deleted_by
  from candidates c
  order by (c.campaign).priority desc,c.effective_start desc,(c.campaign).published_at desc,(c.campaign).id asc
  limit 1;
$$;

do $$
declare signature regprocedure;
begin
  foreach signature in array array[
      'private.stage_c_active_campaign(timestamptz)'::regprocedure
    ] loop
      execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
    end loop;
end $$;

comment on function private.stage_c_active_campaign(timestamptz) is 'cubica_stage_c:20261018171218';

do $$
declare signature regprocedure;
begin
  if obj_description(to_regprocedure('private.stage_c_active_campaign(timestamptz)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171218' then
    raise exception 'stage_c_171218_missing_sentinel';
  end if;
  foreach signature in array array[
      'private.stage_c_active_campaign(timestamptz)'::regprocedure
    ] loop
      if signature is null then raise exception 'stage_c_171218_missing_function'; end if;
      if pg_get_function_result(signature::oid) is distinct from 'private.site_campaigns' then
        raise exception 'stage_c_171218_wrong_return_type:%',pg_get_function_result(signature::oid);
      end if;
      if has_function_privilege('anon',signature,'execute')
        or has_function_privilege('authenticated',signature,'execute')
        or has_function_privilege('service_role',signature,'execute') then
        raise exception 'stage_c_171218_premature_execute:%',signature;
      end if;
      if exists(
        select 1 from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        where p.oid=signature::oid and acl.grantee=0 and acl.privilege_type='EXECUTE'
      ) then raise exception 'stage_c_171218_public_execute:%',signature; end if;
      if exists(
        select 1 from pg_proc p where p.oid=signature::oid
        and not exists(select 1 from unnest(coalesce(p.proconfig,array[]::text[])) setting where setting like 'search_path=%')
      ) then raise exception 'stage_c_171218_unrestricted_search_path:%',signature; end if;
      if (select not p.prosecdef from pg_proc p where p.oid=signature::oid) is distinct from false then
        raise exception 'stage_c_171218_wrong_security_mode:%',signature;
      end if;
    end loop;
end $$;

