-- Recuperación no destructiva de 5A v2.
-- Conserva tablas, índices, metadatos de publicación, FAQ e historial.
-- Cierra todas las funciones del bloque para que ningún rol de Data API las ejecute.

do $$
declare signature regprocedure;
begin
  foreach signature in array array[
      to_regprocedure('private.stage_c_normalize_faq_question(text)'),
      to_regprocedure('private.get_public_content_page(text)'),
      to_regprocedure('private.get_public_faq()'),
      to_regprocedure('private.stage_c_validate_content(jsonb)'),
      to_regprocedure('private.admin_save_content_draft(text,text,jsonb,integer)'),
      to_regprocedure('private.admin_publish_content_page(text,integer)'),
      to_regprocedure('private.admin_restore_content_version(text,integer,integer)'),
      to_regprocedure('private.admin_list_faq(boolean)'),
      to_regprocedure('private.admin_upsert_faq(bigint,text,text,boolean,integer,integer,boolean)'),
      to_regprocedure('private.admin_restore_faq(bigint,integer)')
    ] loop
      if signature is not null then
        execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
      end if;
    end loop;
end $$;

do $$
begin
  if exists(
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='private'
      and c.relname=any(array['site_content_pages','site_content_versions','site_faq_items'])
      and not c.relrowsecurity
  ) then raise exception 'stage_c_171256_recovery_rls_disabled'; end if;
end $$;
