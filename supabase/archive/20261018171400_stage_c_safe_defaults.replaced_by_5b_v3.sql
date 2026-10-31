-- CÚBICA 3D — Etapa C, bloque 6/7: valores iniciales privados.

-- No publica campañas, FAQ, páginas legales ni apariencia.

do $$
begin
  if obj_description(to_regprocedure('private.get_site_experience(timestamptz)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171231' then
    raise exception 'stage_c_171400_missing_prerequisite:private.get_site_experience(timestamptz)';
  end if;
  if obj_description(to_regprocedure('private.admin_get_site_configuration()')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171232' then
    raise exception 'stage_c_171400_missing_prerequisite:private.admin_get_site_configuration()';
  end if;
  if obj_description(to_regprocedure('private.admin_register_site_asset(text,text,text,text,bigint,integer,integer)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171251' then
    raise exception 'stage_c_171400_missing_prerequisite:private.admin_register_site_asset(text,text,text,text,bigint,integer,integer)';
  end if;
  if obj_description(to_regprocedure('private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171252' then
    raise exception 'stage_c_171400_missing_prerequisite:private.admin_upsert_site_campaign(uuid,text,text,integer,text,timestamptz,timestamptz,integer,integer,time,integer,integer,time,jsonb,jsonb,integer)';
  end if;
  if obj_description(to_regprocedure('private.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171253' then
    raise exception 'stage_c_171400_missing_prerequisite:private.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean)';
  end if;
  if obj_description(to_regprocedure('private.admin_upsert_faq(bigint,text,text,boolean,integer,integer,boolean)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171301' then
    raise exception 'stage_c_171400_missing_prerequisite:private.admin_upsert_faq(bigint,text,text,boolean,integer,integer,boolean)';
  end if;
  if obj_description(to_regprocedure('private.submit_public_suggestion(text,text,text,text,uuid,uuid)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171302' then
    raise exception 'stage_c_171400_missing_prerequisite:private.submit_public_suggestion(text,text,text,text,uuid,uuid)';
  end if;
  if obj_description(to_regprocedure('private.admin_update_suggestion(uuid,text,text)')::oid,'pg_proc') is distinct from 'cubica_stage_c:20261018171303' then
    raise exception 'stage_c_171400_missing_prerequisite:private.admin_update_suggestion(uuid,text,text)';
  end if;
end $$;

insert into private.site_content_pages(slug,label) values
 ('about','Sobre Cúbica'),('contact','Contacto'),('terms','Términos y condiciones'),('community','Normas de Comunidad')
on conflict(slug) do update set label=excluded.label;

insert into private.site_appearance_versions(state,version,config)
select 'draft',1,jsonb_build_object(
  'colors',jsonb_build_object('background','#17172b','panel','#20213a','panelAlt','#282a46','text','#f7f7fb','muted','#a7a9c0','accent','#ffffff'),
  'hero',jsonb_build_object('title','Objetos únicos, impresos en 3D.','subtitle','Diseños listos para acompañar tus espacios y tus ideas.'),
  'assets',jsonb_build_object('logo',null,'banner',null,'background',null)
)
where not exists(select 1 from private.site_appearance_versions);

insert into private.site_welcome_phrases(phrase,sort_order) values
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
on conflict do nothing;

comment on table private.site_content_pages is 'cubica_stage_c:20261018171400';

do $$ begin
    if (select count(*) from private.site_content_pages)<>4 then raise exception 'stage_c_171400_pages'; end if;
    if exists(select 1 from private.site_content_versions) then raise exception 'stage_c_171400_content_published'; end if;
    if (select count(*) from private.site_appearance_versions where state='draft')<>1 or exists(select 1 from private.site_appearance_versions where state='published') then raise exception 'stage_c_171400_appearance'; end if;
    if exists(select 1 from private.site_campaigns) or exists(select 1 from private.site_faq_items) or exists(select 1 from private.site_suggestions) then raise exception 'stage_c_171400_fake_public_data'; end if;
    if (select count(*) from private.site_welcome_phrases where campaign_id is null and active and deleted_at is null)<12 then raise exception 'stage_c_171400_phrases'; end if;
  end $$;
