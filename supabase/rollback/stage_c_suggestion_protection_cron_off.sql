-- Recuperación específica y no destructiva: desactiva únicamente el job de
-- Cúbica. No toca sugerencias, hashes, funciones ni otros jobs.
do $block$
declare v_job_id bigint;
begin
  if to_regclass('cron.job') is null then return; end if;
  select jobid into v_job_id
  from cron.job
  where jobname='cubica-stage-c-suggestion-protection-cleanup';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
end
$block$;
