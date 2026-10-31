-- QA transaccional para ejecutar únicamente después de una autorización de producción.
-- Requiere identidad QA controlada; finaliza siempre en ROLLBACK.
begin;

do $$
begin
  if not exists(select 1 from pg_tables where schemaname='private' and tablename='site_campaigns') then raise exception 'Falta site_campaigns'; end if;
  if exists(select 1 from storage.buckets where id='site-assets' and public) then raise exception 'site-assets debe ser privado'; end if;
  if exists(select 1 from pg_tables t where t.schemaname='private' and t.tablename like 'site_%' and not t.rowsecurity) then raise exception 'Hay tablas de Etapa C sin RLS'; end if;
end $$;

insert into private.site_campaigns(name,description,state,priority,recurrence_mode,starts_at,ends_at,theme)
values
 ('QA C prioridad baja','ROLLBACK','published',10,'none',now()-interval '1 hour',now()+interval '1 hour','{"colors":{"accent":"#ff0000"}}'),
 ('QA C prioridad alta','ROLLBACK','published',20,'none',now()-interval '1 hour',now()+interval '1 hour','{"colors":{"accent":"#00ff00"}}');

do $$
begin
  if (private.stage_c_active_campaign(now())).name<>'QA C prioridad alta' then raise exception 'Desempate de campañas incorrecto'; end if;
  begin
    perform private.stage_c_validate_theme('{"colors":{"background":"#ffffff","text":"#eeeeee"}}');
    raise exception 'Se aceptó contraste insuficiente';
  exception when others then
    if sqlerrm='Se aceptó contraste insuficiente' then raise; end if;
  end;
  begin
    perform private.stage_c_validate_content('{"body":"<script>alert(1)</script>"}');
    raise exception 'Se aceptó contenido ejecutable';
  exception when others then
    if sqlerrm='Se aceptó contenido ejecutable' then raise; end if;
  end;
end $$;

insert into private.site_suggestions(category,subject,description,request_id)
values('funcionalidad','QA Etapa C','Registro descartable para comprobar paginación',extensions.gen_random_uuid());

rollback;

