-- Contención no destructiva para la preferencia de bienvenida.
-- Conserva la fila y su auditoría, pero cierra todos los RPC nuevos.
-- El frontend falla de forma segura: entra directamente al catálogo.

do $$
declare
  signature regprocedure;
begin
  foreach signature in array array[
    to_regprocedure('private.get_welcome_screen_preference()'),
    to_regprocedure('private.admin_get_welcome_screen_preference()'),
    to_regprocedure('private.admin_set_welcome_screen_preference(boolean,integer)'),
    to_regprocedure('public.get_welcome_screen_preference()'),
    to_regprocedure('public.admin_get_welcome_screen_preference()'),
    to_regprocedure('public.admin_set_welcome_screen_preference(boolean,integer)')
  ] loop
    if signature is not null then
      execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
    end if;
  end loop;
end $$;

alter table if exists private.site_runtime_settings enable row level security;
revoke all on table private.site_runtime_settings from public,anon,authenticated,service_role;

