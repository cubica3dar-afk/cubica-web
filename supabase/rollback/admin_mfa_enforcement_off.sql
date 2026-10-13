-- Emergency rollback for administrative MFA enforcement.
-- Run only through protected project-owner database access. This keeps all
-- enrolled TOTP factors intact and temporarily restores role-only admin access.

create or replace function private.admin_mfa_enforcement_enabled()
returns boolean
language sql
stable
set search_path = ''
as $$ select false; $$;

revoke all on function private.admin_mfa_enforcement_enabled()
  from public, anon, authenticated, service_role;

comment on function private.admin_mfa_enforcement_enabled() is
  'Emergency rollback applied: administrative AAL2 enforcement is temporarily disabled; enrolled factors remain intact.';

