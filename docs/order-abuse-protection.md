# Order abuse protection and Turnstile rollout

Status on 16 October 2026: **mandatory protection active in production**. The
checkout fails closed, calls only the `create-order` Edge Function and requires
a valid Cloudflare Turnstile token. Migration `20261016150753
order_protection_enforcement` revoked every browser-callable legacy order
creation route. The service-only order path, atomic rate limits, replay ledger,
rollback and cleanup jobs remain deployed.

## Public surface audit

| Route | Callers now | Risk | Existing/prepared protection |
|---|---|---|---|
| `create_delivery_order` | no browser role | Historical direct order and email bypass | `anon` and `authenticated` are revoked on both public and private wrappers. The compatibility function remains available only for transactional regression fixtures. |
| `create_public_order` | none of `anon`/`authenticated` | Legacy checkout bypass | Already revoked; only internal transactional code reaches it. |
| `create-order` Edge Function | public HTTP | Intended protected checkout | Fails closed until secrets exist; validates Turnstile, Auth, hostname/action, size and request shape; reserves a salted token hash atomically; calls service-only RPC. |
| `lookup_verified_delivery_order` / `create_verified_delivery_order` | `service_role` only | Privileged order creation | Edge-only service credentials, exact replay binding, advisory lock, rate limits and existing transaction. |
| `shipping-quotes` Edge Function | guests and authenticated users | Quote/provider abuse | CORS, request validation, verified Auth, guest capability, hashed network key and SQL rate limiting. Commercial carrier adapters remain disabled. |
| `prepare_delivery_quote` / `finalize_delivery_quote` | `service_role` only | Forged quote snapshots | Edge-only; browser prices, user IDs and costs are ignored. |
| Email outbox worker RPCs | `service_role` only | Email spam/retries | Leases, idempotency, worker secret/service role and unique order/kind rows. Rejected orders create no outbox row. |
| Order lifecycle/admin RPCs | authenticated admin | Unauthorized commercial changes | `private.is_admin()` requires role plus AAL2; customers fail. |
| `track_public_event` | `anon`, `authenticated` | Telemetry noise | Allowlisted events and metadata limits exist. Further abuse controls are recommended separately; no commercial state or email is created. |
| Community writes/reactions | `authenticated` | Comment/reaction spam | Auth-derived user, uniqueness, content constraints and RLS. Per-user rate limiting is recommended as a later Community-specific block. |

`tests/order-protection.sql`, `tests/order-protection-activation.sql` and the
production HTTP smoke tests prove that the legacy public/private wrapper is
closed and only the three service RPCs remain callable by `service_role`.

## Turnstile behavior

The checkout renders one Managed widget only for final order confirmation when
`turnstileSiteKey` is configured. The browser sends its token to `create-order`.
The Edge Function calls Cloudflare Siteverify and requires:

- `success = true`;
- hostname `cubica3d.ar` or `www.cubica3d.ar`;
- action `create_order`;
- a challenge timestamp within the token lifetime;
- an unexpired token;
- a new salted token hash in the private transactional replay ledger.

The secret never appears in GitHub Pages, request JSON, responses or logs. Test
keys are accepted only when `TURNSTILE_ALLOW_TEST_KEYS=true`; production
deployment rejects Cloudflare dummy secrets by default.

During production diagnosis, Cloudflare accepted the same token twice even
without an idempotency key. The cause remains unconfirmed. A temporary
`verification_only` probe demonstrated the behavior without creating a sale and
was removed after the test so production exposes no diagnostic endpoint.

After successful Siteverify validation, `create-order` derives a salted SHA-256
hash from the token and calls the service-only `consume_turnstile_token` RPC.
The primary key on `private.turnstile_token_uses` allows exactly one request to
reserve a token, including concurrent requests. The raw token and Cloudflare
secret are never stored. Rows expire after 15 minutes and `pg_cron` removes
expired hashes every 15 minutes.

Before Siteverify, the Edge Function performs a service-only exact replay lookup.
A retry for an order that was already committed returns that result without using
another Turnstile token, changing stock or enqueueing email again. A new request
must pass Siteverify and reserve its token hash before the order creation RPC
runs. Provider, database and replay failures fail closed.

## Rate limiting

Counters are atomic PostgreSQL upserts in `private.order_rate_limits`. An
explicit `ORDER_RATE_LIMIT_SALT` is mandatory; the Edge Function fails closed
when it is absent. Keys are
salted SHA-256 hashes; raw IPs, emails, user IDs and guest tokens are not stored.
Expired rows are removed daily and retained for at most roughly two days after
their window.

Defaults, all configurable through Edge secrets:

| Scope | 10 minutes | 1 hour |
|---|---:|---:|
| Authenticated user | 5 | 12 |
| Guest capability | 4 | 8 |
| Shared network hash | 12 | 40 |

Identity and network limits are independent, so two legitimate buyers sharing an
IP do not share their user/guest allowance. A blocked request receives HTTP 429,
`Retry-After`, and no order, stock change or email. Idempotent replay is checked
before counters and does not consume quota.

## Production activation record

Completed on 16 October 2026:

1. Cloudflare widget **Cúbica - Confirmar pedido**, mode **Managed**, is published
   for `cubica3d.ar`.
2. The public Site Key is loaded from `github-config.js`; the Secret Key is stored
   privately as `TURNSTILE_SECRET_KEY` and never appears in code or responses.
3. The private `ORDER_RATE_LIMIT_SALT` secret is present. Optional limit variables:
   `ORDER_AUTH_10M_LIMIT`, `ORDER_AUTH_HOURLY_LIMIT`,
   `ORDER_GUEST_10M_LIMIT`, `ORDER_GUEST_HOURLY_LIMIT`,
   `ORDER_IP_10M_LIMIT`, `ORDER_IP_HOURLY_LIMIT`.
4. Expected values remain `TURNSTILE_EXPECTED_ACTION=create_order` and
   `TURNSTILE_EXPECTED_HOSTNAMES=cubica3d.ar,www.cubica3d.ar`.
5. Fresh production assets confirmed the mandatory widget module and
   `supabase-sales.js` contains no fallback RPC. The checkout displays
   **Verificación lista.** and Cloudflare challenge resources load.
6. The previously authorized QA order confirmed the protected Edge path,
   idempotency, two emails and inventory reconciliation. No order was created for
   final enforcement testing.
7. `supabase/activation/order_protection_enforcement.sql` was applied and recorded
   as migration `20261016150753`.
8. Direct REST calls to `create_delivery_order` and `create_public_order` now fail
   with permission denial. `create-order` remains active at version 10 and rejects
   missing, invalid and wrong-origin tokens before business data is touched.
9. Validation passed: 163 JavaScript tests, 11 rollback SQL suites, 10 production
   HTTP checks, mandatory live route checks and the emergency rollback simulation.

### Site Key verification discrepancy

An earlier automated review reported the Site Key missing because its browser
evaluation ran in an isolated JavaScript realm and could not see globals defined
by the page. That signal was not used to bypass the review. A fresh uncached
production fetch confirmed the Site Key in `github-config.js`, the expected
versioned checkout scripts and the absence of legacy RPC calls. A separate real
page inspection confirmed the checkout container, Cloudflare script and the
visible **Verificación lista.** state. Those independent checks resolved the
discrepancy before enforcement.

### Post-activation data reconciliation

- Orders: 15; email outbox rows: 17; inventory movements: 9.
- QA order `CUB-20261016-0200` remains `Cancelado`, never entered production and
  retains both sent email records.
- Polaroid Flor stock remains 5. Movements 251 and 289 preserve the traced 5 → 4
  reservation and 4 → 5 cancellation restitution.
- Turnstile replay ledger remains empty after rejection-only live checks. No new
  order, email, inventory movement or material consumption was created.

If `create-order` becomes unavailable after activation, the prepared emergency
script `supabase/rollback/order_protection_enforcement_off.sql` reopens only the
previous delivery wrapper. It preserves orders, factors and rate counters. Restore
the protected path promptly after the incident.

## Remaining scoped recommendations

- Analytics: add low-cost per-session/network sampling or counters for
  `track_public_event` without using Turnstile on page views.
- Community: add per-user write limits to comments and reactions; keep reads
  public and do not challenge every interaction.
- Auth: rely on Supabase Auth abuse controls and consider Turnstile only for
  registration/recovery after measuring actual abuse.

These recommendations are documented only; this block changes orders and email
abuse protection as requested.

