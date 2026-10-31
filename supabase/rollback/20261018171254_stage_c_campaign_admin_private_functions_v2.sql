-- Recuperación no destructiva de 4B v2.
-- Revoca y elimina las funciones ejecutables, pero conserva la tabla privada
-- de idempotencia para no borrar auditoría creada legítimamente.

do $$
declare signature regprocedure;
begin
  foreach signature in array array[
      to_regprocedure('private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer,uuid)'),
      to_regprocedure('private.admin_set_site_campaign_state(uuid,text,integer,uuid)'),
      to_regprocedure('private.admin_duplicate_site_campaign(uuid,integer,uuid)'),
      to_regprocedure('private.admin_delete_site_campaign(uuid,integer)'),
      to_regprocedure('private.stage_c_begin_campaign_operation(text,uuid,jsonb)'),
      to_regprocedure('private.stage_c_complete_campaign_operation(text,uuid,jsonb,uuid,jsonb)')
    ] loop
      if signature is not null then
        execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
      end if;
  end loop;
end $$;

drop function if exists private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer,uuid);
drop function if exists private.admin_set_site_campaign_state(uuid,text,integer,uuid);
drop function if exists private.admin_duplicate_site_campaign(uuid,integer,uuid);
drop function if exists private.admin_delete_site_campaign(uuid,integer);
drop function if exists private.stage_c_complete_campaign_operation(text,uuid,jsonb,uuid,jsonb);
drop function if exists private.stage_c_begin_campaign_operation(text,uuid,jsonb);

alter table if exists private.site_campaign_idempotency enable row level security;
revoke all on private.site_campaign_idempotency from public,anon,authenticated,service_role;
comment on table private.site_campaign_idempotency is
  'cubica_stage_c:20261018171254:rollback-retained-private-audit';
