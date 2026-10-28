-- CÚBICA 3D — Etapa C, bloque 6 v3: valores iniciales privados y conservadores.
--
-- Esta migración agrega únicamente valores ausentes. No publica contenido,
-- no activa campañas o frases y no reemplaza personalizaciones existentes.

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('cubica:stage-c:safe-defaults:v3',0)
);

do $$
declare
  v_signature text;
  v_expected text;
  v_actual text;
  v_oid oid;
begin
  for v_signature,v_expected in
    select * from (values
      ('private.stage_c_assert_admin()','cubica_stage_c:20261018171210'),
      ('private.stage_c_active_campaign(timestamptz)','cubica_stage_c:20261018171218'),
      ('private.stage_c_next_change(timestamptz)','cubica_stage_c:20261018171223'),
      ('private.get_site_experience(timestamptz)','cubica_stage_c:20261018171231'),
      ('private.admin_get_site_configuration()','cubica_stage_c:20261018171232'),
      ('private.admin_register_site_asset(text,text,text,text,bigint,integer,integer)','cubica_stage_c:20261018171249'),
      ('private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer,uuid)','cubica_stage_c:20261018171254'),
      ('private.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean)','cubica_stage_c:20261018171255'),
      ('private.admin_restore_faq(bigint,integer)','cubica_stage_c:20261018171256'),
      ('private.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)','cubica_stage_c:20261018171258'),
      ('private.admin_update_suggestion(uuid,text,text,integer,text)','cubica_stage_c:20261024233029')
    ) as expected(signature,sentinel)
  loop
    v_oid:=pg_catalog.to_regprocedure(v_signature)::oid;
    if v_oid is null then
      raise exception 'stage_c_171402_missing_function:%',v_signature;
    end if;
    v_actual:=pg_catalog.obj_description(v_oid,'pg_proc');
    if v_actual is distinct from v_expected then
      raise exception 'stage_c_171402_wrong_sentinel:%:expected=%:actual=%',
        v_signature,v_expected,coalesce(v_actual,'<null>');
    end if;
  end loop;

  if pg_catalog.to_regprocedure('private.admin_upsert_faq(bigint,text,text,boolean,integer,integer,boolean)') is null then
    raise exception 'stage_c_171402_missing_function:private.admin_upsert_faq(bigint,text,text,boolean,integer,integer,boolean)';
  end if;

  if pg_catalog.obj_description(pg_catalog.to_regclass('private.site_campaigns')::oid,'pg_class')
       is distinct from 'cubica_stage_c:20261018171000' then
    raise exception 'stage_c_171402_wrong_sentinel:private.site_campaigns';
  end if;
  if pg_catalog.obj_description(pg_catalog.to_regclass('private.site_suggestions')::oid,'pg_class')
       is distinct from 'cubica_stage_c:20261018171100' then
    raise exception 'stage_c_171402_wrong_sentinel:private.site_suggestions';
  end if;
end $$;

do $$
declare
  v_table text;
  v_signature text;
  v_oid oid;
begin
  foreach v_table in array array[
    'site_assets','site_appearance_versions','site_campaigns','site_campaign_occurrences',
    'site_welcome_phrases','site_campaign_idempotency','site_content_pages','site_content_versions','site_faq_items',
    'site_suggestions','suggestion_token_uses','suggestion_rate_limits',
    'suggestion_moderation_history'
  ] loop
    if pg_catalog.to_regclass('private.'||v_table) is null then
      raise exception 'stage_c_171402_missing_table:private.%',v_table;
    end if;
    if not exists(
      select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='private' and c.relname=v_table and c.relrowsecurity
    ) then
      raise exception 'stage_c_171402_rls_disabled:private.%',v_table;
    end if;
    if pg_catalog.has_table_privilege('anon','private.'||v_table,'select,insert,update,delete')
      or pg_catalog.has_table_privilege('authenticated','private.'||v_table,'select,insert,update,delete')
      or pg_catalog.has_table_privilege('service_role','private.'||v_table,'select,insert,update,delete') then
      raise exception 'stage_c_171402_unexpected_table_grant:private.%',v_table;
    end if;
  end loop;

  foreach v_signature in array array[
    'private.stage_c_assert_admin()',
    'private.stage_c_active_campaign(timestamptz)',
    'private.stage_c_next_change(timestamptz)',
    'private.get_site_experience(timestamptz)',
    'private.admin_get_site_configuration()',
    'private.admin_register_site_asset(text,text,text,text,bigint,integer,integer)',
    'private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer,uuid)',
    'private.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean)',
    'private.admin_upsert_faq(bigint,text,text,boolean,integer,integer,boolean)',
    'private.admin_restore_faq(bigint,integer)',
    'private.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)',
    'private.admin_update_suggestion(uuid,text,text,integer,text)'
  ] loop
    v_oid:=pg_catalog.to_regprocedure(v_signature)::oid;
    if v_oid is null then
      raise exception 'stage_c_171402_missing_function:%',v_signature;
    end if;
    if pg_catalog.has_function_privilege('public',v_oid,'execute')
      or pg_catalog.has_function_privilege('anon',v_oid,'execute')
      or pg_catalog.has_function_privilege('authenticated',v_oid,'execute')
      or pg_catalog.has_function_privilege('service_role',v_oid,'execute') then
      raise exception 'stage_c_171402_unexpected_function_grant:%',v_signature;
    end if;
    if not exists(
      select 1 from pg_catalog.pg_proc p
      where p.oid=v_oid and p.prosecdef
        and 'search_path=""'=any(coalesce(p.proconfig,array[]::text[]))
    ) then
      raise exception 'stage_c_171402_unsafe_function:%',v_signature;
    end if;
  end loop;

  v_signature:='private.stage_c_validate_theme(jsonb)';
  v_oid:=pg_catalog.to_regprocedure(v_signature)::oid;
  if v_oid is null then
    raise exception 'stage_c_171402_missing_function:%',v_signature;
  end if;
  if pg_catalog.has_function_privilege('public',v_oid,'execute')
    or pg_catalog.has_function_privilege('anon',v_oid,'execute')
    or pg_catalog.has_function_privilege('authenticated',v_oid,'execute')
    or pg_catalog.has_function_privilege('service_role',v_oid,'execute')
    or not exists(
      select 1 from pg_catalog.pg_proc p
      where p.oid=v_oid and 'search_path=""'=any(coalesce(p.proconfig,array[]::text[]))
    ) then
    raise exception 'stage_c_171402_unsafe_function:%',v_signature;
  end if;

  if exists(
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'get_site_experience','get_site_configuration','upsert_site_appearance',
        'upsert_site_campaign','upsert_welcome_phrase','upsert_site_content',
        'upsert_faq','submit_site_suggestion'
      )
  ) then
    raise exception 'stage_c_171402_public_wrapper_present';
  end if;
end $$;

insert into private.site_content_pages(slug,label) values
  ('about','Sobre Cúbica'),
  ('contact','Contacto'),
  ('terms','Términos y condiciones'),
  ('community','Normas de Comunidad')
on conflict(slug) do nothing;

insert into private.site_appearance_versions(state,version,config)
select
  'draft',
  1,
  private.stage_c_validate_theme(pg_catalog.jsonb_build_object(
    'colors',pg_catalog.jsonb_build_object(
      'background','#17172b','panel','#20213a','panelAlt','#282a46',
      'text','#f7f7fb','muted','#a7a9c0','accent','#ffffff'
    ),
    'hero',pg_catalog.jsonb_build_object(
      'title','Objetos únicos, impresos en 3D.',
      'subtitle','Diseños listos para acompañar tus espacios y tus ideas.'
    ),
    'assets',pg_catalog.jsonb_build_object('logo',null,'banner',null,'background',null)
  ))
where not exists(select 1 from private.site_appearance_versions);

with defaults(phrase,sort_order) as (values
  ('Hay cosas que comprás porque las necesitás. Y hay otras que elegís porque simplemente querés tenerlas. Bienvenido a Cúbica.',10),
  ('Que una impresión salga de una máquina no significa que sea una más. En Cúbica, cada objeto empieza con una idea y termina en tus manos.',20),
  ('A veces un pequeño objeto puede cambiar un rincón, acompañar un momento o simplemente sacarte una sonrisa. Gracias por pasar por Cúbica.',30),
  ('Elegiste algo hecho en 3D. Nosotros queremos que cuando llegue a tus manos se sienta mucho más que eso: que se sienta tuyo.',40),
  ('Detrás de cada producto de Cúbica hay tiempo, material y muchas decisiones. Pero lo más importante sucede cuando finalmente llega a vos.',50),
  ('No imprimimos solamente objetos. Le damos forma a ideas para que puedan encontrar un lugar en tu mundo. Bienvenido a Cúbica.',60),
  ('Tu próxima compra puede terminar en un estante, en un escritorio, en una habitación o convertirse en un regalo inolvidable. Descubrila en Cúbica.',70),
  ('Hay algo especial en recibir algo que fue creado para vos. Ojalá encuentres en Cúbica eso que estabas buscando sin saberlo.',80),
  ('Cada pieza tiene un origen: una idea. Y quizás hoy esa idea encuentre un lugar en tu casa. Bienvenido a Cúbica.',90),
  ('Gracias por elegir un emprendimiento que crea de a una pieza por vez. Esperamos que encuentres algo que realmente quieras llevarte.',100),
  ('Lo que hoy ves en pantalla, mañana puede estar en tus manos. Elegí, imaginá y dejá que Cúbica haga el resto.',110),
  ('Cúbica nace de transformar material en objetos con propósito. Ahora queremos transformar tu elección en algo que puedas disfrutar.',120)
)
insert into private.site_welcome_phrases(phrase,active,sort_order)
select d.phrase,false,d.sort_order
from defaults d
where not exists(
  select 1
  from private.site_welcome_phrases p
  where p.campaign_id is null
    and pg_catalog.lower(pg_catalog.btrim(p.phrase))=pg_catalog.lower(pg_catalog.btrim(d.phrase))
);

comment on table private.site_content_pages is 'cubica_stage_c:20261018171402';

do $$
declare
  v_slug text;
begin
  foreach v_slug in array array['about','contact','terms','community'] loop
    if not exists(select 1 from private.site_content_pages where slug=v_slug) then
      raise exception 'stage_c_171402_missing_required_page:%',v_slug;
    end if;
  end loop;

  if not exists(select 1 from private.site_appearance_versions) then
    raise exception 'stage_c_171402_missing_appearance';
  end if;

  if exists(
    with defaults(phrase) as (values
      ('Hay cosas que comprás porque las necesitás. Y hay otras que elegís porque simplemente querés tenerlas. Bienvenido a Cúbica.'),
      ('Que una impresión salga de una máquina no significa que sea una más. En Cúbica, cada objeto empieza con una idea y termina en tus manos.'),
      ('A veces un pequeño objeto puede cambiar un rincón, acompañar un momento o simplemente sacarte una sonrisa. Gracias por pasar por Cúbica.'),
      ('Elegiste algo hecho en 3D. Nosotros queremos que cuando llegue a tus manos se sienta mucho más que eso: que se sienta tuyo.'),
      ('Detrás de cada producto de Cúbica hay tiempo, material y muchas decisiones. Pero lo más importante sucede cuando finalmente llega a vos.'),
      ('No imprimimos solamente objetos. Le damos forma a ideas para que puedan encontrar un lugar en tu mundo. Bienvenido a Cúbica.'),
      ('Tu próxima compra puede terminar en un estante, en un escritorio, en una habitación o convertirse en un regalo inolvidable. Descubrila en Cúbica.'),
      ('Hay algo especial en recibir algo que fue creado para vos. Ojalá encuentres en Cúbica eso que estabas buscando sin saberlo.'),
      ('Cada pieza tiene un origen: una idea. Y quizás hoy esa idea encuentre un lugar en tu casa. Bienvenido a Cúbica.'),
      ('Gracias por elegir un emprendimiento que crea de a una pieza por vez. Esperamos que encuentres algo que realmente quieras llevarte.'),
      ('Lo que hoy ves en pantalla, mañana puede estar en tus manos. Elegí, imaginá y dejá que Cúbica haga el resto.'),
      ('Cúbica nace de transformar material en objetos con propósito. Ahora queremos transformar tu elección en algo que puedas disfrutar.')
    )
    select 1 from defaults d
    where not exists(
      select 1 from private.site_welcome_phrases p
      where p.campaign_id is null
        and pg_catalog.lower(pg_catalog.btrim(p.phrase))=pg_catalog.lower(pg_catalog.btrim(d.phrase))
    )
  ) then
    raise exception 'stage_c_171402_missing_default_phrase';
  end if;

  if pg_catalog.obj_description(pg_catalog.to_regclass('private.site_content_pages')::oid,'pg_class')
       is distinct from 'cubica_stage_c:20261018171402' then
    raise exception 'stage_c_171402_missing_sentinel';
  end if;
end $$;
