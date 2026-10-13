# Administrative TOTP MFA

Native Supabase TOTP MFA is mandatory for Cúbica administrators. Customers keep
their existing Google/email experience and never receive an administrative
challenge.

## Authorization model

Administrator identity still comes exclusively from `public.profiles.role`.
`private.is_admin()` remains the central authorization function used by the
administrative RPCs, RLS policies and the `product-media` Storage policies.
It now also requires the Supabase-issued JWT claim `aal = aal2` when
`private.admin_mfa_enforcement_enabled()` returns true.

The enforcement switch returns true. It was enabled in a separate migration only
after the owner enrolled and tested a primary and backup TOTP factor and gave
explicit approval. Browser flags cannot enable, disable or bypass the backend
rule.

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

## Active access flow

1. Email/password or Google establishes an AAL1 session.
2. The app reads the filtered MFA gate status and routes the administrator to the
   TOTP challenge.
3. While AAL2 is pending, navigation is limited to the TOTP challenge or signing
   out. Administrative inventory, sales and analytics requests are not started.
4. Either verified authenticator can be selected.
5. Supabase verifies the code and issues an AAL2 session. The app then loads the
   administrative data automatically.
6. Only then do the administrative RPCs, RLS and Storage policies authorize the
   administrator.

If the status RPC is unavailable or returns an invalid response, the browser
keeps the administrator at the challenge instead of assuming access. The data
badge distinguishes this state and `MFA pendiente` from loading, connectivity,
authorization and internal query errors.

The activation migration is
`20261013153000_admin_mfa_enforcement_on.sql`. The prepared emergency script is
`supabase/rollback/admin_mfa_enforcement_off.sql`. It changes only the protected
switch to false and preserves the enrolled factors. Run it only through protected
project-owner database access after an access incident, and restore enforcement
after the incident is resolved.

Do not edit deployed migrations in place. Any future activation or rollback must
remain a separate, auditable database change.
