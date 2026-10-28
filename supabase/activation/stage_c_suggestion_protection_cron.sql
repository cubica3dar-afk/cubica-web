-- PREPARADO, NO EJECUTADO.
-- Programa únicamente la limpieza de hashes temporales ya implementada en
-- private.cleanup_suggestion_protection(). No elimina sugerencias ni contacto.

do $block$
declare
  v_job_id bigint;
  v_schedule text;
  v_command text;
begin
  if not exists(select 1 from pg_extension where extname='pg_cron') then
    raise exception 'stage_c_cleanup_requires_pg_cron';
  end if;
  if to_regprocedure('private.cleanup_suggestion_protection()') is null then
    raise exception 'stage_c_cleanup_function_missing';
  end if;

  select jobid,schedule,command
    into v_job_id,v_schedule,v_command
  from cron.job
  where jobname='cubica-stage-c-suggestion-protection-cleanup';

  if v_job_id is not null then
    if v_schedule is distinct from '17 * * * *'
       or btrim(v_command) is distinct from 'select private.cleanup_suggestion_protection();' then
      raise exception 'stage_c_cleanup_job_conflict';
    end if;
    return;
  end if;

  perform cron.schedule(
    'cubica-stage-c-suggestion-protection-cleanup',
    '17 * * * *',
    'select private.cleanup_suggestion_protection();'
  );
end
$block$;

select jobid,jobname,schedule,command,active
from cron.job
where jobname='cubica-stage-c-suggestion-protection-cleanup';
