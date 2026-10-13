# Checkout and Auth security hardening — 2026-10-12

Migration: `20261012211533_audit_checkout_permissions_and_verified_claims.sql`.

## Changes

- The browser uses `create_delivery_order`. Direct API execution of the legacy
  `create_public_order(text,text,text,text,text,text,jsonb)` implementation is revoked.
  The private delivery wrapper still invokes it under its owner, preserving server-side
  prices, stock handling, order persistence and the initial email outbox.
- Guest-order claims require the canonical, confirmed email in Auth to match the
  current JWT, and reject anonymous, deleted or currently banned identities. This
  prevents an old JWT email from linking another email's orders after an email change.
- Public execution of the Auth-profile and RLS event-trigger functions is revoked.
  Existing triggers remain installed and were exercised by the rollback fixtures.
- Unused TRUNCATE, REFERENCES, TRIGGER and MAINTAIN privileges are removed from
  16 explicitly named application tables for PUBLIC, anon, authenticated and service_role.
  Existing DML privileges, column grants and RLS policies are unchanged.
- No tables, order data, worker secrets or Edge Functions are replaced.

## Auth settings outside SQL migrations

The deployed Auth minimum password length is 8, matching the existing signup/reset UI.
Site URL is `https://cubica3d.ar/`. The existing three explicit redirect entries remain.
Recovery redirects to `?view=reset` now preserve that destination instead of falling
back to the former GitHub Pages Site URL. No password, subscription or session was changed.

## Validation

From the repository root:

```sh
node --test --test-isolation=none tests/*.test.cjs tests/*.test.mjs
```

147 automated tests pass, including mocked email-provider errors, safe email content,
checkout retries, Auth navigation, shipping availability, profile autofill and analytics.

Execute each SQL file separately in an isolated connection:

- `tests/security-audit.sql`: grants, RLS, canonical-email claims, administrative guards,
  private-address isolation, price tampering, legacy denial and outbox creation.
- `tests/checkout-profile.sql`
- `tests/delivery-backend.sql`
- `tests/order-lifecycle.sql`
- `tests/community-rollback.sql`

All five end in ROLLBACK. The suites create their own Auth identities and only fixture
orders/products. Delivery settings are changed transactionally and restored by rollback.
PostgreSQL sequence values can advance despite rollback; never rewind live sequences.
The delivery-retention scenario rolls back its deletion and must not be run without
the surrounding transaction.

Optional explicit production API checks:

```sh
node tests/security-http.mjs
```

This performs ten non-business-mutating requests using only the public project key:
anonymous table/RPC access denials, private-schema exclusion, worker authentication,
Auth provider settings and a deliberately invalid recovery link. It neither requests
an email nor creates an account/order. It may create normal platform access logs.

Production checks also confirmed a separately approved guest pickup order, two initial
provider sends, no BOM consumption, and cancellation with an explicitly authorized,
traceable restoration of its single finished-stock unit. No payment or physical shipment
was initiated. Existing commercial orders were not edited.

## Intentional permissions

Public invoker wrappers and their private definer implementations remain in place.
Authenticated EXECUTE on an admin RPC does not grant admin access: those functions
validate `auth.uid()` and `private.is_admin()` before returning data or changing state.
Customer order fields remain allowlisted, internal status columns are denied, private
tables remain outside the REST schemas, and server workers retain their service-only RPCs.

Five private tables intentionally use default-deny RLS without policies, with access
through reviewed functions. Do not add broad policies to silence the Advisor.
`track_public_event` intentionally accepts anonymous telemetry; commercial order totals
are computed from persisted orders, not untrusted purchase events.

No UI redesign or commercial feature is included in this change.

