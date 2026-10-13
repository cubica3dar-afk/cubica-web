-- Stage A-C: prepare native Supabase TOTP MFA for administrators.
-- Enforcement intentionally remains OFF until the existing administrator has
-- enrolled and personally tested a primary and backup factor.

create or replace function private.admin_mfa_enforcement_enabled()
returns boolean
language sql
stable
set search_path = ''
as $$ select false; $$;

create or replace function private.is_admin_role()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  );
$$;

-- All existing administrative RPCs, RLS policies and Storage policies already
-- converge on private.is_admin(). Once the separate activation migration makes
-- admin_mfa_enforcement_enabled() return true, an authenticated administrator
-- must also carry a Supabase-issued aal2 claim.
create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin_role()
    and (
      not private.admin_mfa_enforcement_enabled()
      or coalesce((select auth.jwt()->>'aal'), 'aal1') = 'aal2'
    );
$$;

create or replace function private.admin_mfa_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_is_admin boolean := private.is_admin_role();
  v_enforced boolean := private.admin_mfa_enforcement_enabled();
  v_aal text := coalesce((select auth.jwt()->>'aal'), 'aal1');
  v_verified integer := 0;
begin
  if auth.uid() is null or not v_is_admin then
    return jsonb_build_object('is_admin', false);
  end if;

  select count(*)::integer
    into v_verified
  from auth.mfa_factors as f
  where f.user_id = (select auth.uid())
    and f.factor_type = 'totp'
    and f.status = 'verified';

  return jsonb_build_object(
    'is_admin', true,
    'enforcement_enabled', v_enforced,
    'current_level', v_aal,
    'verified_factor_count', v_verified,
    'access_allowed', (not v_enforced or v_aal = 'aal2')
  );
end;
$$;

create or replace function public.get_admin_mfa_status()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.admin_mfa_status(); $$;

revoke all on function private.admin_mfa_enforcement_enabled() from public, anon, authenticated, service_role;
revoke all on function private.is_admin_role() from public, anon, authenticated, service_role;
revoke all on function private.is_admin() from public, anon, authenticated, service_role;
revoke all on function private.admin_mfa_status() from public, anon, authenticated, service_role;
revoke all on function public.get_admin_mfa_status() from public, anon, authenticated, service_role;

grant execute on function private.is_admin() to authenticated;
grant execute on function private.admin_mfa_status() to authenticated;
grant execute on function public.get_admin_mfa_status() to authenticated;

comment on function private.admin_mfa_enforcement_enabled() is
  'Staged switch for administrative AAL2 enforcement. Keep false until owner enrollment and recovery validation are complete.';
comment on function private.is_admin() is
  'Central administrative authorization: role plus AAL2 when the staged MFA switch is enabled.';
comment on function public.get_admin_mfa_status() is
  'Returns only the current authenticated administrator MFA gate status; it does not expose factors or secrets.';

