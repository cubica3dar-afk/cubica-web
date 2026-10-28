-- Solo lectura: verificación posterior del bloque 6 v3.
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
), matched as (
  select d.phrase,p.id,p.active,p.deleted_at
  from defaults d
  left join private.site_welcome_phrases p
    on p.campaign_id is null
   and lower(btrim(p.phrase))=lower(btrim(d.phrase))
), tables as (
  select c.relname,c.relrowsecurity,
    has_table_privilege('anon',c.oid,'select,insert,update,delete') anon_access,
    has_table_privilege('authenticated',c.oid,'select,insert,update,delete') authenticated_access,
    has_table_privilege('service_role',c.oid,'select,insert,update,delete') service_access
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='private' and c.relname=any(array[
    'site_assets','site_appearance_versions','site_campaigns','site_campaign_occurrences',
    'site_welcome_phrases','site_campaign_idempotency','site_content_pages','site_content_versions',
    'site_faq_items','site_suggestions','suggestion_token_uses','suggestion_rate_limits',
    'suggestion_moderation_history'
  ])
)
select jsonb_build_object(
  'version','20261018171402',
  'sentinel',obj_description('private.site_content_pages'::regclass,'pg_class'),
  'sentinel_ok',obj_description('private.site_content_pages'::regclass,'pg_class')='cubica_stage_c:20261018171402',
  'required_pages_ok',(select count(*)=4 from private.site_content_pages where slug=any(array['about','contact','terms','community'])),
  'appearance_exists',exists(select 1 from private.site_appearance_versions),
  'default_phrase_matches',(select count(id) from matched),
  'default_phrases_active',(select count(*) from matched where active and deleted_at is null),
  'defaults_not_automatically_public',(select count(*)=0 from matched where active and deleted_at is null),
  'stage_c_tables',(select count(*) from tables),
  'rls_acl_ok',(select count(*)=13 and bool_and(relrowsecurity and not anon_access and not authenticated_access and not service_access) from tables),
  'premature_public_wrappers',(
    select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in(
      'get_site_experience','get_site_configuration','upsert_site_appearance',
      'upsert_site_campaign','upsert_welcome_phrase','upsert_site_content',
      'upsert_faq','submit_site_suggestion'
    )
  )
) as result;
