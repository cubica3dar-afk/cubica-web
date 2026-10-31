-- CÚBICA 3D — Etapa C, bloque 3B-1 v2: campaña activa.

-- Reemplaza localmente a 20261018171221, que nunca fue aplicado y devolvía
-- un record anónimo de 27 campos para un tipo declarado de 26 campos.
-- Migración cerrada: no concede EXECUTE a roles de Data API.

do $$
begin
  if obj_description(to_regprocedure('private.stage_c_assert_admin()')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171210' then
    raise exception 'stage_c_171219_missing_prerequisite:private.stage_c_assert_admin()';
  end if;
end $$;

create or replace function private.stage_c_active_campaign(p_at timestamptz default now())
returns private.site_campaigns language sql stable security definer set search_path='' as $$
  with local_now as(select p_at at time zone 'America/Argentina/Buenos_Aires' v), candidates as(
    select c campaign,
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

comment on function private.stage_c_active_campaign(timestamptz) is 'cubica_stage_c:20261018171219';

do $$
declare signature regprocedure;
begin
  if obj_description(to_regprocedure('private.stage_c_active_campaign(timestamptz)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171219' then
    raise exception 'stage_c_171219_missing_sentinel';
  end if;
  foreach signature in array array[
      'private.stage_c_active_campaign(timestamptz)'::regprocedure
    ] loop
      if signature is null then raise exception 'stage_c_171219_missing_function'; end if;
      if pg_get_function_result(signature::oid) is distinct from 'private.site_campaigns' then
        raise exception 'stage_c_171219_wrong_return_type:%',pg_get_function_result(signature::oid);
      end if;
      if has_function_privilege('anon',signature,'execute')
        or has_function_privilege('authenticated',signature,'execute')
        or has_function_privilege('service_role',signature,'execute') then
        raise exception 'stage_c_171219_premature_execute:%',signature;
      end if;
      if exists(
        select 1 from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
        where p.oid=signature::oid and acl.grantee=0 and acl.privilege_type='EXECUTE'
      ) then raise exception 'stage_c_171219_public_execute:%',signature; end if;
      if exists(
        select 1 from pg_proc p where p.oid=signature::oid
        and not exists(select 1 from unnest(coalesce(p.proconfig,array[]::text[])) setting where setting like 'search_path=%')
      ) then raise exception 'stage_c_171219_unrestricted_search_path:%',signature; end if;
      if (select not p.prosecdef from pg_proc p where p.oid=signature::oid) is distinct from (false) then
        raise exception 'stage_c_171219_wrong_security_mode:%',signature;
      end if;
    end loop;
end $$;

