# Administrative TOTP MFA

This release prepares native Supabase TOTP MFA for Cúbica administrators. The
mandatory backend gate is deliberately staged **off**. Customers keep their
existing Google/email experience and never receive an administrative challenge.

## Authorization model

Administrator identity still comes exclusively from `public.profiles.role`.
`private.is_admin()` remains the central authorization function used by the
administrative RPCs, RLS policies and the `product-media` Storage policies.
It now also requires the Supabase-issued JWT claim `aal = aal2` when
`private.admin_mfa_enforcement_enabled()` returns true.

The staged switch currently returns false. It must only be changed in a separate
migration after the owner has enrolled and tested both a primary and backup TOTP
factor and has explicitly approved activation. Browser flags cannot enable or
bypass the backend rule.

The status RPC is available at AAL1 only so the signed-in administrator can be
sent to the challenge. It exposes the enforcement state, current AAL and a count
of verified factors for that same account. It never returns QR data, TOTP secrets,
codes or factor identifiers.

Service-role email and shipping workers retain their existing secret and role
checks. They are non-interactive and do not use the administrator gate.

## Enrollment and recovery

From **Mi perfil → Seguridad de la cuenta**, enroll the primary authenticator,
scan the temporary QR and enter its six-digit code. The QR and manual secret are
kept only in page memory. Enrolling verifies the factor through Supabase Auth and
promotes the current session to AAL2.

Before enabling enforcement, add a second verified TOTP factor as a backup. Use a
different device/application or keep its secret in a secure location separate
from the primary device. Supabase Auth does not currently provide recovery codes.

If one device is lost, sign in with the backup and replace the missing factor.
If every project-user factor is lost, recovery requires an operator who still has
separately protected Supabase project-owner access to delete the lost factor with
the server-only Admin Auth MFA API. That operation logs out active sessions. Never
put the service-role key or an administrative factor-deletion endpoint in the
browser.

## Activation checklist

1. Enroll the primary factor and confirm the success state.
2. Enroll and verify a backup factor.
3. Sign out and test a fresh Google or email/password sign-in plus TOTP challenge.
4. Confirm access to orders, inventory, Community, Analytics and delivery settings.
5. Confirm the documented backup-factor recovery path.
6. Obtain Diego's explicit approval.
7. Apply a new migration that changes only
   `private.admin_mfa_enforcement_enabled()` to `select true`.
8. Run `tests/admin-mfa.sql`, the full regression suite and direct API denial tests.

Do not edit the staging migration in place after deployment; activation must be a
new, auditable migration.

