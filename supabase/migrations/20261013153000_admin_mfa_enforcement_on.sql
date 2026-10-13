-- Stage D: require a Supabase-issued AAL2 session for every authorization path
-- that already converges on private.is_admin(). The administrator confirmed
-- two verified TOTP factors before this migration was applied.

create or replace function private.admin_mfa_enforcement_enabled()
returns boolean
language sql
stable
set search_path = ''
as $$ select true; $$;

revoke all on function private.admin_mfa_enforcement_enabled()
  from public, anon, authenticated, service_role;

comment on function private.admin_mfa_enforcement_enabled() is
  'Administrative AAL2 enforcement is active. Disable only through the protected rollback procedure after an access incident.';

