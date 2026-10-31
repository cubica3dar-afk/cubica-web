-- Recuperación no destructiva de 4C v2.
-- Retira la superficie ejecutable y conserva todas las frases existentes.

do $$
declare signature regprocedure:=to_regprocedure(
  'private.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean)'
);
begin
  if signature is not null then
    execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
  end if;
end $$;

drop function if exists private.admin_upsert_welcome_phrase(bigint,uuid,text,boolean,integer,integer,boolean);

alter table if exists private.site_welcome_phrases enable row level security;
revoke all on private.site_welcome_phrases from public,anon,authenticated,service_role;
