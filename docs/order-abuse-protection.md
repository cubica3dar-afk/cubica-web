# Order abuse protection and Turnstile rollout

Status on 14 October 2026: **production widget configured, legacy route still
open**. The service-only order path, atomic rate limits, Edge Function, frontend
widget integration, activation script and rollback are deployed. The production
Site Key is public in `github-config.js`; the legacy `create_delivery_order`
grant remains open until the real widget and a controlled order are verified.

Do not claim Turnstile protection is active before completing the activation
checklist below.

## Public surface audit

| Route | Callers now | Risk | Existing/prepared protection |
|---|---|---|---|
| `create_delivery_order` | `anon`, `authenticated` | Direct order and email abuse while staged | Server prices, quote/pickup validation and idempotency exist. Activation revokes this route after the Edge path is verified. |
| `create_public_order` | none of `anon`/`authenticated` | Legacy checkout bypass | Already revoked; only internal transactional code reaches it. |
| `create-order` Edge Function | public HTTP | Intended protected checkout | Fails closed until secret exists; validates Turnstile, Auth, hostname/action, size and request shape; calls service-only RPC. |
| `lookup_verified_delivery_order` / `create_verified_delivery_order` | `service_role` only | Privileged order creation | Edge-only service credentials, exact replay binding, advisory lock, rate limits and existing transaction. |
| `shipping-quotes` Edge Function | guests and authenticated users | Quote/provider abuse | CORS, request validation, verified Auth, guest capability, hashed network key and SQL rate limiting. Commercial carrier adapters remain disabled. |
| `prepare_delivery_quote` / `finalize_delivery_quote` | `service_role` only | Forged quote snapshots | Edge-only; browser prices, user IDs and costs are ignored. |
| Email outbox worker RPCs | `service_role` only | Email spam/retries | Leases, idempotency, worker secret/service role and unique order/kind rows. Rejected orders create no outbox row. |
| Order lifecycle/admin RPCs | authenticated admin | Unauthorized commercial changes | `private.is_admin()` requires role plus AAL2; customers fail. |
| `track_public_event` | `anon`, `authenticated` | Telemetry noise | Allowlisted events and metadata limits exist. Further abuse controls are recommended separately; no commercial state or email is created. |
| Community writes/reactions | `authenticated` | Comment/reaction spam | Auth-derived user, uniqueness, content constraints and RLS. Per-user rate limiting is recommended as a later Community-specific block. |

The direct-order vulnerability remains intentionally open only during this staged
window. `tests/order-protection-activation.sql` proves that the activation script
closes the legacy public/private wrapper and leaves only the service-only RPC.

## Turnstile behavior

The checkout renders one Managed widget only for final order confirmation when
`turnstileSiteKey` is configured. The browser sends its token to `create-order`.
The Edge Function calls Cloudflare Siteverify and requires:

- `success = true`;
- hostname `cubica3d.ar` or `www.cubica3d.ar`;
- action `create_order`;
- a challenge timestamp within the token lifetime;
- an unexpired, single-use token.

The secret never appears in GitHub Pages, request JSON, responses or logs. Test
keys are accepted only when `TURNSTILE_ALLOW_TEST_KEYS=true`; production
deployment rejects Cloudflare dummy secrets by default.

The Edge Function also accepts a narrow `verification_only` probe containing
only a Turnstile token and UUID. It performs the same real Siteverify checks and
returns before Auth, rate limits, order RPCs, stock or email. A successful probe
therefore proves the widget, production secret, explicit private
`ORDER_RATE_LIMIT_SALT`, hostname and action without creating a sale.

Before Siteverify, the Edge Function performs a service-only exact replay lookup.
A retry for an order that was already committed returns that result without using
another Turnstile token, changing stock or enqueueing email again. A new request
must pass Siteverify before any order RPC runs. Provider failures fail closed.

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

## Production activation checklist

1. In Cloudflare, create a Turnstile widget named **Cúbica · Confirmar pedido**,
   mode **Managed**, hostname `cubica3d.ar` (and `www.cubica3d.ar` only if used).
2. Copy the public Site Key. Store the Secret Key in Supabase Edge Function
   secrets as `TURNSTILE_SECRET_KEY`; never paste it into chat or GitHub.
3. Add a random private `ORDER_RATE_LIMIT_SALT` secret. Optional limit variables:
   `ORDER_AUTH_10M_LIMIT`, `ORDER_AUTH_HOURLY_LIMIT`,
   `ORDER_GUEST_10M_LIMIT`, `ORDER_GUEST_HOURLY_LIMIT`,
   `ORDER_IP_10M_LIMIT`, `ORDER_IP_HOURLY_LIMIT`.
4. Keep `TURNSTILE_EXPECTED_ACTION=create_order` and
   `TURNSTILE_EXPECTED_HOSTNAMES=cubica3d.ar,www.cubica3d.ar`.
5. Set the public Site Key in `github-config.js` and deploy. Confirm the real
   widget produces a token and Siteverify accepts it.
6. Test one authorized noncommercial order only with Diego's explicit approval,
   or use a controlled rollback transaction where possible. Confirm the existing
   order, two initial outbox entries and idempotent replay.
7. Apply `supabase/activation/order_protection_enforcement.sql` immediately after
   the protected checkout succeeds.
8. Verify direct REST calls to `create_delivery_order`, its private implementation
   and `create_public_order` fail, while `create-order` succeeds.
9. Run all browser and SQL regressions and watch Edge/database logs for fixed safe
   error codes only.

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

