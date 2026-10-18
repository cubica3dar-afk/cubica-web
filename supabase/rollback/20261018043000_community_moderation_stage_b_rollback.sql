-- Recuperación no destructiva de la Etapa B.
-- Preserva comentarios, reacciones, restricciones, reglas y auditoría. El
-- frontend anterior vuelve a funcionar porque sus RPC permanecen disponibles.

begin;

-- Retira solamente los nuevos puntos administrativos del Data API.
revoke all on function
  public.get_admin_community_comments(integer,integer,text,text,text),
  public.admin_moderate_community_comment(bigint,text,text),
  public.get_admin_community_users(integer,integer,text,text,text),
  public.admin_set_community_user_block(uuid,boolean,text),
  public.get_admin_community_terms(integer,integer,text,text,text),
  public.admin_manage_community_term(text,bigint,text,boolean,boolean,text),
  public.get_admin_community_settings(),
  public.admin_set_community_link_blocking(boolean,text),
  public.get_admin_community_history(integer,integer,text,text,text)
from public,anon,authenticated,service_role;

revoke all on function
  private.get_admin_community_comments(integer,integer,text,text,text),
  private.admin_moderate_community_comment(bigint,text,text),
  private.get_admin_community_users(integer,integer,text,text,text),
  private.admin_set_community_user_block(uuid,boolean,text),
  private.get_admin_community_terms(integer,integer,text,text,text),
  private.admin_manage_community_term(text,bigint,text,boolean,boolean,text),
  private.get_admin_community_settings(),
  private.admin_set_community_link_blocking(boolean,text),
  private.get_admin_community_history(integer,integer,text,text,text)
from public,anon,authenticated,service_role;

-- Neutraliza las nuevas restricciones de escritura sin alterar sus registros.
-- Esto permite recuperar el comportamiento de Community v1 mientras se analiza
-- una regresión, conservando la evidencia para una reaplicación posterior.
create or replace function private.community_participation_blocked(p_user_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select false;
$$;

create or replace function private.validate_community_body(p_body text)
returns text language plpgsql stable security definer set search_path='' as $$
declare v_body text:=btrim(coalesce(p_body,''));
begin
  if char_length(v_body) not between 1 and 2000 or v_body !~ '[^[:space:]]' then
    raise exception 'Escribí entre 1 y 2000 caracteres';
  end if;
  return v_body;
end;
$$;

revoke all on function private.community_participation_blocked(uuid),
  private.validate_community_body(text) from public,anon,authenticated,service_role;

comment on function private.community_participation_blocked(uuid) is
  'Rollback Etapa B: restricciones preservadas pero temporalmente neutralizadas.';
comment on function private.validate_community_body(text) is
  'Rollback Etapa B: conserva únicamente validación histórica de longitud.';

commit;

-- Luego de ejecutar este archivo se debe publicar el frontend del commit previo.
-- Las tablas y columnas de Etapa B no se eliminan para evitar pérdida irreversible.

