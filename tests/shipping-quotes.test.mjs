import test from "node:test";
import assert from "node:assert/strict";
import { collectProviderRates, normalizeRates, productionProviders, selectCheapestRate } from "../supabase/functions/shipping-quotes/providers.js";
import { createHandler, createBackendClient, normalizeQuoteRequest, newQuoteToken, publicQuote, rateKey } from "../supabase/functions/shipping-quotes/worker.js";

const requestId = "10000000-0000-4000-8000-000000000001";
const quoteId = "20000000-0000-4000-8000-000000000002";
const userId = "30000000-0000-4000-8000-000000000003";
const token = "a".repeat(64);
const body = () => ({ request_id: requestId, items: [{ product_id: "p_buho", qty: 2, color: "Blanco" }],
  address: { recipient: "Prueba descartable", phone: "1122334455", street: "Prueba", number: "123", city: "CABA", province: "CABA", postal_code: "1406" }, guest_token: token });
const req = (payload = body(), headers = {}, method = "POST") => new Request("https://example.supabase.co/functions/v1/shipping-quotes", {
  method, headers: { "content-type": "application/json", origin: "https://cubica3d.ar", ...headers },
  ...(method === "POST" ? { body: typeof payload === "string" ? payload : JSON.stringify(payload) } : {}),
});
const provider = (quote) => ({ configuration: () => ({ ready: true }), quote });
const settings = [{ code: "correo_argentino", enabled: true, margin_percent: 10 }, { code: "andreani", enabled: true, margin_percent: 8 }, { code: "oca", enabled: true, margin_percent: 12 }];
const future = "2099-01-01T00:00:00Z";
const rate = (base = 7500, service = "domicilio") => ({ service_code: service, label: "A domicilio", base_price_ars: base, valid_until: future });

function handlerSetup({ prepared, finalized, adapters, getUser } = {}) {
  const calls = [];
  const client = {
    getUser: getUser || (async () => ({ user: { id: userId }, error: null })),
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === "prepare_delivery_quote") return { data: prepared || { quote_id: quoteId, status: "preparing", providers: settings, expires_at: future }, error: null };
      return { data: finalized || { quote_id: quoteId, status: "unavailable", expires_at: future }, error: null };
    },
  };
  const env = name => ({ SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test-server-key", SUPABASE_ANON_KEY: "test-anon-key" })[name];
  return { calls, client, handler: createHandler({ env, adapters, createClient: () => client }) };
}

test("production providers never generate a price or call an external API without commercial activation", async () => {
  let fetched = false;
  const result = await collectProviderRates({ providers: settings }, { fetchImpl: async () => { fetched = true; throw Error("Should not run"); } });
  assert.deepEqual(result.rates, []);
  assert.equal(fetched, false);
  assert.equal(result.provider_results.length, 3);
  for (const outcome of result.provider_results) {
    assert.equal(outcome.status, "not_configured");
    assert.ok(outcome.missing_configuration.length >= 3);
  }
  assert.equal(Object.keys(productionProviders).length, 3);
});

test("disabled providers are not invoked even when an adapter is installed", async () => {
  const result = await collectProviderRates({ providers: [{ code: "oca", enabled: false }] }, { adapters: { oca: provider(() => assert.fail("Disabled provider called")) } });
  assert.equal(result.provider_results[0].status, "disabled");
});

test("a failed carrier does not discard another carrier's real valid rates", async () => {
  const result = await collectProviderRates({ providers: settings }, { adapters: {
    correo_argentino: provider(async () => [rate()]), andreani: provider(async () => { throw Error("Private error with credentials"); }),
  } });
  assert.equal(result.rates.length, 1);
  assert.equal(result.rates[0].code, "correo_argentino");
  assert.equal(result.provider_results[1].reason_code, "provider_request_failed");
  assert.equal(result.provider_results[2].reason_code, "adapter_not_installed");
  assert.ok(!JSON.stringify(result).includes("credentials"));
});

test("carrier timeout is bounded and aborts its pending fetch", async () => {
  let signal;
  const result = await collectProviderRates({ providers: [settings[0]] }, { timeoutMs: 10, adapters: {
    correo_argentino: provider(async (_, options) => { signal = options.signal; return new Promise(() => {}); }),
  } });
  assert.equal(result.provider_results[0].status, "timeout");
  assert.equal(signal.aborted, true);
  assert.deepEqual(result.rates, []);
});

test("only complete nonexpired ARS rates are admitted; duplicates and private fields are removed", () => {
  const rates = normalizeRates("oca", [
    { ...rate(), api_key: "secret", recipient: { phone: "private" } }, rate(7900),
    rate(NaN, "nan"), rate(-1, "negative"), rate(1.234, "fractional"),
    null, { ...rate(1, "null"), base_price_ars: null }, rate(0, "free"),
    { ...rate(8500, "expired"), valid_until: "2020-01-01" }, { ...rate(), service_code: "" },
  ]);
  assert.equal(rates.length, 1);
  assert.deepEqual(Object.keys(rates[0]).sort(), ["base_price_ars", "code", "label", "service_code", "valid_until"].sort());
});

test("empty/error responses never produce a fictional zero-cost shipping quote", async () => {
  const result = await collectProviderRates({ providers: [settings[0]] }, { adapters: { correo_argentino: provider(async () => ({ error: "no coverage" })) } });
  assert.equal(result.provider_results[0].status, "unavailable");
  assert.deepEqual(result.rates, []);
});

test("cheapest provider is selected after individual margins and common packaging", () => {
  const result = selectCheapestRate([
    { ...rate(7500), code: "correo_argentino" }, { ...rate(7900), code: "andreani" },
  ], settings, 1000);
  assert.equal(result.code, "correo_argentino");
  assert.equal(result.margin_amount_ars, 750);
  assert.equal(result.final_price_ars, 9250);
});

test("selection cannot use base price alone, and rounds the margin to cents as SQL does", () => {
  const result = selectCheapestRate([{ ...rate(100), code: "correo_argentino" }, { ...rate(102.01), code: "andreani" }], [
    { code: "correo_argentino", enabled: true, margin_percent: 20 }, { code: "andreani", enabled: true, margin_percent: 5 },
  ], 1.15);
  assert.equal(result.code, "andreani");
  assert.equal(result.margin_amount_ars, 5.1);
  assert.equal(result.final_price_ars, 108.26);
  assert.equal(selectCheapestRate([], settings, 10), null);
  assert.throws(() => selectCheapestRate([], settings, -1));
});

test("browser prices, carrier URLs, stock, package sizes and user IDs are not forwarded to SQL", () => {
  const malicious = body();
  Object.assign(malicious, { user_id: userId, price: 1, provider: "free", origin: "private", package: { weight_g: 1 }, margin_percent: -100 });
  Object.assign(malicious.items[0], { price: 0, stock: 9000, weight_g: 1, recipe: [] });
  const normalized = normalizeQuoteRequest(malicious);
  assert.deepEqual(Object.keys(normalized).sort(), ["request_id", "items", "address", "guest_token"].sort());
  assert.deepEqual(normalized.items, [{ product_id: "p_buho", qty: 2, color: "Blanco" }]);
});

test("invalid quantities, request IDs and short guest capabilities are rejected", () => {
  for (const qty of [0, -1, 1.2, 1001, Infinity]) assert.throws(() => normalizeQuoteRequest({ ...body(), items: [{ product_id: "p", qty }] }));
  assert.throws(() => normalizeQuoteRequest({ ...body(), request_id: "guessable" }));
  assert.throws(() => normalizeQuoteRequest({ ...body(), guest_token: "a" }));
  assert.throws(() => normalizeQuoteRequest({ ...body(), address: [] }));
});

test("capabilities have 256 random bits and rate hashes never contain the IP or service key", async () => {
  const a = newQuoteToken(), b = newQuoteToken();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b);
  const key = await rateKey(req(body(), { "x-forwarded-for": "spoofed-first, 192.0.2.1" }), "private-salt");
  const other = await rateKey(req(body(), { "x-forwarded-for": "different-first, 192.0.2.1" }), "private-salt");
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(key, other);
});

test("public payload is allowlisted and hides all cost components, origin, margin and carrier diagnostics", () => {
  const result = publicQuote({ quote_id: quoteId, status: "quoted", final_price_ars: 9250, service_label: "A domicilio", expires_at: future,
    base_price_ars: 7500, margin_percent: 10, packaging_cost_ars: 1000, origin: { street: "Privada" }, provider_results: [{ raw: "secret" }], address: body().address }, token);
  assert.deepEqual(result, { quote_id: quoteId, quote_token: token, status: "quoted", price: 9250, service_label: "A domicilio", expires_at: future });
  assert.throws(() => publicQuote({ status: "quoted", price: NaN, expires_at: future }, token));
});

test("guest quote uses service-only RPCs and never trusts a supplied user ID", async () => {
  const setup = handlerSetup();
  const response = await setup.handler(req({ ...body(), user_id: userId }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "unavailable");
  assert.equal(setup.calls.length, 2);
  assert.equal(setup.calls[0].name, "prepare_delivery_quote");
  assert.equal(setup.calls[0].args.p_user_id, null);
  assert.equal(setup.calls[1].name, "finalize_delivery_quote");
  assert.deepEqual(setup.calls[1].args.p_rates, []);
});

test("signed-in user ownership comes exclusively from a verified Auth response", async () => {
  let received;
  const setup = handlerSetup({ getUser: async auth => { received = auth; return { user: { id: userId }, error: null }; } });
  await setup.handler(req(body(), { authorization: "Bearer actual-user-token", apikey: "public-project-key" }));
  assert.equal(received, "actual-user-token");
  assert.equal(setup.calls[0].args.p_user_id, userId);
});

test("invalid or expired Auth token is rejected, without silently becoming a guest", async () => {
  const setup = handlerSetup({ getUser: async () => ({ user: null, error: true }) });
  const response = await setup.handler(req(body(), { authorization: "Bearer expired-user-token" }));
  assert.equal(response.status, 401);
  assert.deepEqual(setup.calls, []);
});

test("the publishable key is treated as project identity, not customer identity", async () => {
  const setup = handlerSetup({ getUser: async () => assert.fail("Public project key must not be validated as a user") });
  const response = await setup.handler(req(body(), { authorization: "Bearer public-key", apikey: "public-key" }));
  assert.equal(response.status, 200);
  assert.equal(setup.calls[0].args.p_user_id, null);
});

test("new guest capability is returned when no token was supplied", async () => {
  const setup = handlerSetup();
  const request = body(); delete request.guest_token;
  const response = await setup.handler(req(request));
  const result = await response.json();
  assert.match(result.quote_token, /^[0-9a-f]{64}$/);
  assert.equal(setup.calls[0].args.p_guest_token, result.quote_token);
});

test("missing logistics configuration short-circuits carrier processing and does not expose missing product costs", async () => {
  const setup = handlerSetup({ prepared: { quote_id: quoteId, status: "needs_configuration", missing: ["product weight"], admin_private: "hidden" } });
  const response = await setup.handler(req());
  const result = await response.json();
  assert.equal(result.status, "needs_configuration");
  assert.equal(setup.calls.length, 1);
  assert.equal(result.admin_private, undefined);
  assert.equal(result.missing, undefined);
});

test("already finalized quote is returned without running carriers or creating duplicate RPC finalizations", async () => {
  const setup = handlerSetup({ prepared: { quote_id: quoteId, status: "quoted", price: 9250, expires_at: future } });
  const response = await setup.handler(req());
  assert.equal((await response.json()).price, 9250);
  assert.equal(setup.calls.length, 1);
});

test("an expired prepared or quoted snapshot cannot be presented as an accepted price or call a carrier", async () => {
  for (const status of ["quoted", "preparing"]) {
    const setup = handlerSetup({ prepared: { quote_id: quoteId, status, price: 9250, expires_at: "2020-01-01T00:00:00Z", providers: settings },
      adapters: { correo_argentino: provider(() => assert.fail("Expired quote contacted a carrier")) } });
    const result = await (await setup.handler(req())).json();
    assert.equal(result.status, "expired");
    assert.equal(result.price, undefined);
    assert.equal(setup.calls.length, 1);
  }
});

test("incomplete server configuration cannot fall back to fake quotes or write a local order", async () => {
  const handler = createHandler({ env: () => undefined, createClient: () => assert.fail("Missing configuration created backend client") });
  const response = await handler(req());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "shipping_server_not_configured" });
});

test("valid carriers pass only normalized rates to the SQL finalizer, which owns final pricing", async () => {
  const setup = handlerSetup({ adapters: { correo_argentino: provider(async () => [{ ...rate(), private_response: "secret" }]) },
    finalized: { quote_id: quoteId, status: "quoted", final_price_ars: 9250, service_label: "Envío", expires_at: future } });
  const response = await setup.handler(req());
  const result = await response.json();
  assert.equal(result.price, 9250);
  assert.equal(setup.calls[1].args.p_rates.length, 1);
  assert.equal(setup.calls[1].args.p_rates[0].private_response, undefined);
  assert.equal(result.provider_results, undefined);
});

test("CORS permits production origin and blocks other browser origins before database access", async () => {
  const setup = handlerSetup();
  const denied = await setup.handler(req(body(), { origin: "https://evil.example" }));
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
  assert.deepEqual(setup.calls, []);
  const preflight = await setup.handler(req(null, {}, "OPTIONS"));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "https://cubica3d.ar");
  assert.equal(preflight.headers.get("cache-control"), "no-store");
});

test("invalid JSON, oversized bodies and unsupported methods never reach SQL", async () => {
  const setup = handlerSetup();
  assert.equal((await setup.handler(req("{invalid"))).status, 400);
  assert.equal((await setup.handler(req("x".repeat(32769)))).status, 413);
  assert.equal((await setup.handler(req(null, {}, "GET"))).status, 405);
  assert.deepEqual(setup.calls, []);
});

test("rate limit failures retain 429 and database errors do not leak SQL or private data", async () => {
  const setup = handlerSetup();
  setup.client.rpc = async () => ({ data: null, error: { code: "delivery_rate_limit" } });
  assert.equal((await setup.handler(req())).status, 429);
  setup.client.rpc = async () => { throw Error("SQL with private destination and service_key"); };
  const response = await setup.handler(req());
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "shipping_quote_failed" });
});

test("backend client verifies user remotely and keeps service credentials out of JSON results", async () => {
  const fetched = [];
  const client = createBackendClient("https://example.supabase.co", "private-server-key", async (url, options) => {
    fetched.push({ url, options });
    if (url.includes("/auth/v1/user")) return Response.json({ id: userId });
    return Response.json({ quote_id: quoteId, status: "unavailable" });
  });
  assert.equal((await client.getUser("user-token")).user.id, userId);
  const result = await client.rpc("prepare_delivery_quote", { p_items: [] });
  assert.equal(result.data.quote_id, quoteId);
  assert.equal(fetched[0].options.headers.Authorization, "Bearer user-token");
  assert.equal(fetched[1].options.headers.Authorization, "Bearer private-server-key");
  assert.ok(!JSON.stringify(result).includes("private-server-key"));
});

