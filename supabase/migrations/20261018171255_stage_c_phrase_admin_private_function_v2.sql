-- CÚBICA 3D — Etapa C, bloque 4C v2: administración consistente de frases.
--
-- Migración cerrada. No concede EXECUTE a roles de Data API.
-- El orden de locks es campaña(s) por UUID -> frase.

do $$
begin
  if obj_description(to_regprocedure('private.stage_c_assert_admin()')::oid,'pg_proc')
      is distinct from 'cubica_stage_c:20261018171210' then
    raise exception 'stage_c_171255_missing_prerequisite:private.stage_c_assert_admin()';
  end if;
  if obj_description(to_regprocedure('private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer,uuid)')::oid,'pg_proc')
      is distinct from 'cubica_stage_c:20261018171254' then
    raise exception 'stage_c_171255_missing_prerequisite:private.admin_upsert_site_campaign(...)';
  end if;
  if to_regprocedure('private.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean)') is not null then
    raise exception 'stage_c_171255_old_4c_function_present';
  end if;
end $$;

create function private.admin_upsert_welcome_phrase(
  p_id bigint,
  p_campaign_id uuid,
  p_phrase text,
  p_active boolean,
  p_sort_order integer,
  p_expected_version integer,
  p_delete boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  phrase_row private.site_welcome_phrases;
  initial_campaign_id uuid;
  target_deleted_at timestamptz;
  checked_phrase text;
  checked_active boolean;
  checked_sort_order integer;
begin
  perform private.stage_c_assert_admin();

  if p_delete is null then
    raise exception 'La acción sobre la frase es inválida' using errcode='22023';
  end if;

  if p_id is null then
    if p_delete then
      raise exception 'No se puede eliminar una frase que todavía no existe' using errcode='22023';
    end if;
    if coalesce(p_expected_version,0)<>0 then
      raise exception 'La versión inicial de la frase es inválida' using errcode='22023';
    end if;

    -- La campaña se bloquea antes de insertar la frase. Una eliminación
    -- concurrente debe esperar y luego retirará también esta nueva frase.
    if p_campaign_id is not null then
      select c.deleted_at into target_deleted_at
      from private.site_campaigns c
      where c.id=p_campaign_id
      for share;
      if not found then
        raise exception 'La campaña no existe' using errcode='23503';
      end if;
      if target_deleted_at is not null then
        raise exception 'La campaña fue retirada y no puede recibir frases' using errcode='55000';
      end if;
    end if;

    checked_phrase:=private.stage_c_safe_text(p_phrase,500,true);
    checked_active:=coalesce(p_active,true);
    checked_sort_order:=coalesce(p_sort_order,0);

    insert into private.site_welcome_phrases(
      campaign_id,phrase,active,sort_order,created_by,updated_by
    ) values(
      p_campaign_id,checked_phrase,checked_active,checked_sort_order,auth.uid(),auth.uid()
    ) returning * into phrase_row;
  else
    if p_expected_version is null or p_expected_version<=0 then
      raise exception 'La versión esperada de la frase es obligatoria' using errcode='22023';
    end if;

    -- Esta lectura no bloquea. Solo permite conocer las campañas que deben
    -- bloquearse antes de adquirir el lock de la frase.
    select w.campaign_id into initial_campaign_id
    from private.site_welcome_phrases w
    where w.id=p_id;
    if not found then
      raise exception 'La frase cambió o no existe' using errcode='40001';
    end if;

    -- La PK elimina duplicados; ORDER BY fija un orden estable cuando hay
    -- campaña anterior y campaña destino distintas.
    perform c.id
    from private.site_campaigns c
    where c.id=initial_campaign_id or c.id=p_campaign_id
    order by c.id
    for share;

    if not p_delete and p_campaign_id is not null then
      select c.deleted_at into target_deleted_at
      from private.site_campaigns c
      where c.id=p_campaign_id;
      if not found then
        raise exception 'La campaña no existe' using errcode='23503';
      end if;
      if target_deleted_at is not null then
        raise exception 'La campaña fue retirada y no puede recibir frases' using errcode='55000';
      end if;
    end if;

    select * into phrase_row
    from private.site_welcome_phrases w
    where w.id=p_id
    for update;
    if not found
      or phrase_row.version<>p_expected_version
      or phrase_row.campaign_id is distinct from initial_campaign_id then
      raise exception 'La frase cambió o no existe' using errcode='40001';
    end if;

    if p_delete and p_campaign_id is distinct from phrase_row.campaign_id then
      raise exception 'No se puede reasignar una frase mientras se elimina' using errcode='22023';
    end if;

    checked_phrase:=private.stage_c_safe_text(p_phrase,500,true);
    checked_active:=coalesce(p_active,phrase_row.active);
    checked_sort_order:=coalesce(p_sort_order,phrase_row.sort_order);

    -- Una edición idéntica con la revisión vigente es un no-op. Esto evita
    -- versiones nuevas y fechas de modificación sin un cambio real.
    if phrase_row.campaign_id is not distinct from p_campaign_id
      and phrase_row.phrase=checked_phrase
      and phrase_row.active=checked_active
      and phrase_row.sort_order=checked_sort_order
      and ((p_delete and phrase_row.deleted_at is not null)
        or (not p_delete and phrase_row.deleted_at is null)) then
      return to_jsonb(phrase_row)-'created_by'-'updated_by';
    end if;

    update private.site_welcome_phrases set
      campaign_id=p_campaign_id,
      phrase=checked_phrase,
      active=checked_active,
      sort_order=checked_sort_order,
      deleted_at=case when p_delete then coalesce(deleted_at,now()) else null end,
      version=version+1,
      updated_at=now(),
      updated_by=auth.uid()
    where id=p_id
    returning * into phrase_row;
  end if;

  return to_jsonb(phrase_row)-'created_by'-'updated_by';
exception
  when unique_violation then
    raise exception 'Ya existe una frase igual para este destino' using errcode='23505';
end;
$$;

revoke all on function private.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean)
  from public,anon,authenticated,service_role;

comment on function private.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean)
  is 'cubica_stage_c:20261018171255';

do $$
declare signature regprocedure:=
  'private.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean)'::regprocedure;
begin
  if obj_description(signature::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171255' then
    raise exception 'stage_c_171255_missing_sentinel';
  end if;
  if has_function_privilege('anon',signature,'execute')
    or has_function_privilege('authenticated',signature,'execute')
    or has_function_privilege('service_role',signature,'execute') then
    raise exception 'stage_c_171255_premature_execute:%',signature;
  end if;
  if exists(
    select 1 from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    where p.oid=signature::oid and acl.grantee=0 and acl.privilege_type='EXECUTE'
  ) then
    raise exception 'stage_c_171255_public_execute:%',signature;
  end if;
  if not exists(
    select 1 from pg_proc p
    cross join lateral unnest(coalesce(p.proconfig,array[]::text[])) setting
    where p.oid=signature::oid and setting='search_path=""'
  ) then
    raise exception 'stage_c_171255_unrestricted_search_path:%',signature;
  end if;
  if (select p.prosecdef from pg_proc p where p.oid=signature::oid) is distinct from true then
    raise exception 'stage_c_171255_wrong_security_mode:%',signature;
  end if;
end $$;
