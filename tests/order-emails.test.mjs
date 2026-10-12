import test from "node:test";
import assert from "node:assert/strict";
import { calculateProductionPlan } from "../supabase/functions/order-emails/plan.js";
import { customerEmail, internalEmail, MISSING_RECIPE } from "../supabase/functions/order-emails/templates.js";
import { createHandler, createRpcClient, DeliveryError, processDelivery, runWorker, sendWithResend } from "../supabase/functions/order-emails/worker.js";

const order = {
  id: "00000000-0000-4000-8000-000000000001", order_number: "CUB-20261011-000001",
  created_at: "2026-10-11T21:00:00Z", customer_name: "Cliente <script>alert(1)</script>",
  customer_email: "buyer@example.test", phone: "123", payment: "Transferencia", notes: "<img src=x onerror=alert(1)>",
  total: 5000, status: "Pendiente", customer_email_sent: false, internal_email_sent: false,
  supply_plan: { frontend_forged_stock: 999999 }, internal_cost: "PRIVATE_COST_SENTINEL",
};
const items = [
  { id: 1, product_id: "p1", name: "Maceta <b>", color: "Rojo & azul", qty: 2, unit_price: 1000 },
  { id: 2, product_id: "p2", name: "Soporte", color: "", qty: 3, unit_price: 1000 },
];
const recipes = [
  { product_id: "p1", supply_id: "s1", qty_per_unit: 100 },
  { product_id: "p2", supply_id: "s1", qty_per_unit: 150 },
];
const supplies = [{ id: "s1", name: "PRIVATE_SUPPLY_SENTINEL", qty: 500, unit: "gramos", active: true }];
const snapshot = () => structuredClone({ order, items, recipes, supplies });
const from = "Cúbica <contacto@cubica3d.ar>";
const job = kind => ({ order_id: order.id, kind, lock_token: "lease", attempts: 1, payload: null });

test("shared supply shortage uses the entire order and marks both products", () => {
  const plan = calculateProductionPlan(items, recipes, supplies);
  assert.equal(plan.supplies[0].required, 650);
  assert.equal(plan.supplies[0].missing, 150);
  assert.equal(plan.supplies[0].enough, false);
  assert.deepEqual(plan.products.map(p => p.availability), ["insufficient", "insufficient"]);
});

test("variants aggregate quantities; availability is exact at the boundary", () => {
  const plan = calculateProductionPlan([
    { ...items[0], qty: 1 }, { ...items[0], id: 3, color: "Azul", qty: 2 },
  ], [{ product_id: "p1", supply_id: "s1", qty_per_unit: "0.1000" }], [{ ...supplies[0], qty: "0.3000" }]);
  assert.equal(plan.products[0].ordered, 3);
  assert.equal(plan.supplies[0].required, 0.3);
  assert.equal(plan.supplies[0].missing, 0);
  assert.equal(plan.products[0].availability, "available");
});

test("missing recipe differs from shortage; deleted products are explicit", () => {
  const plan = calculateProductionPlan([...items, { ...items[0], id: 4, product_id: null, name: "Eliminado" }], [], supplies);
  assert.equal(plan.supplies.length, 0);
  assert(plan.products.every(p => p.availability === "recipe_missing"));
  const email = internalEmail(order, items, plan, from);
  assert(email.text.includes(MISSING_RECIPE));
  assert(!email.text.includes("Insumos insuficientes"));
});

test("missing inventory is unknown and inactive inventory is unavailable", () => {
  const unknown = calculateProductionPlan(items, recipes, []);
  assert.equal(unknown.supplies[0].missing, null);
  assert.equal(unknown.products[0].availability, "unknown");
  const inactive = calculateProductionPlan(items, recipes, [{ ...supplies[0], qty: 1000, active: false }]);
  assert.equal(inactive.supplies[0].stock, 1000);
  assert.equal(inactive.supplies[0].available, 0);
  assert.equal(inactive.supplies[0].missing, 650);
});

test("invalid stored quantities fail explicitly", () => {
  assert.throws(() => calculateProductionPlan([{ ...items[0], qty: -1 }], recipes, supplies));
  assert.throws(() => calculateProductionPlan(items, [{ ...recipes[0], qty_per_unit: 0 }], supplies));
});

test("customer template cannot leak internal fields; HTML is escaped", () => {
  const email = customerEmail(order, items, from);
  const content = JSON.stringify(email);
  for (const forbidden of ["PRIVATE_COST_SENTINEL", "PRIVATE_SUPPLY_SENTINEL", "frontend_forged_stock", "stock", "insumos"]) {
    assert(!content.includes(forbidden), forbidden);
  }
  assert(email.html.includes("&lt;script&gt;"));
  assert(!email.html.includes("<script>"));
  assert(email.text.includes(order.order_number));
  assert(email.text.includes("Rojo & azul"));
  assert(email.text.includes("Transferencia"));
  assert(email.text.includes("https://cubica3d.ar"));
});

test("internal template has actual aggregate requirements, available stock, and shortage", () => {
  const plan = calculateProductionPlan(items, recipes, supplies);
  const email = internalEmail(order, items, plan, from);
  assert.deepEqual(email.to, ["pedidos@cubica3d.ar"]);
  assert(email.text.includes("se necesita 650 gramos; disponible 500; falta 150"));
  assert(email.html.includes("&lt;img"));
  assert(!email.html.includes("<img src=x"));
  assert(email.text.includes("sin descontar productos terminados"));
  assert(email.text.includes("Cuenta: Invitado"));
});

function fakeClient(snapshotValue = snapshot()) {
  const calls = [];
  const client = { rpc: async (name, args) => {
    calls.push({ name, args });
    if (name === "get_order_email_snapshot") return { data: snapshotValue };
    if (name === "prepare_order_email_delivery") return { data: args.p_payload };
    if (name === "finish_order_email_delivery") return { data: null };
    throw new Error(`Unexpected RPC ${name}`);
  }};
  return { client, calls };
}

test("payload is persisted before provider send; identity matches recipient kind", async () => {
  const { client, calls } = fakeClient();
  let sent;
  const result = await processDelivery(client, job("internal"), { from, send: async (payload, key) => {
    assert.equal(calls.at(-1).name, "prepare_order_email_delivery");
    sent = { payload, key };
    return "resend-id";
  }});
  assert.equal(result, "sent");
  assert.equal(sent.key, `cubica-order/${order.id}/internal/v1`);
  assert(!sent.payload.text.includes("frontend_forged_stock"));
  assert.equal(calls.at(-1).args.p_sent, true);
  assert.equal(calls.at(-1).args.p_provider_id, "resend-id");
});

test("retry uses exactly the stored payload even if prices and inventory changed", async () => {
  const stored = customerEmail(order, items, from);
  const { client, calls } = fakeClient({ order: { ...order, total: 999999 }, items: [] });
  let received;
  await processDelivery(client, { ...job("customer"), payload: stored }, { from, send: async payload => {
    received = payload; return "resend-id";
  }});
  assert.deepEqual(received, stored);
  assert(!calls.some(call => call.name === "get_order_email_snapshot"));
});

test("successful existing flag avoids provider resend", async () => {
  const stored = snapshot(); stored.order.customer_email_sent = true;
  const { client, calls } = fakeClient(stored);
  const result = await processDelivery(client, job("customer"), { from, send: () => { throw new Error("Must not send"); } });
  assert.equal(result, "already_sent");
  assert.equal(calls.at(-1).args.p_sent, true);
});

test("provider failures record only safe codes and keep the saved order untouched", async () => {
  const { client, calls } = fakeClient();
  const result = await processDelivery(client, job("customer"), { from, send: async () => { throw new DeliveryError("resend_http_503"); } });
  assert.equal(result, "retry");
  assert.equal(calls.at(-1).args.p_sent, false);
  assert.equal(calls.at(-1).args.p_error, "resend_http_503");
  assert.deepEqual(calls.map(call => call.name), ["get_order_email_snapshot", "prepare_order_email_delivery", "finish_order_email_delivery"]);
});

test("one permanent recipient failure does not prevent the other email", async () => {
  const { client, calls } = fakeClient();
  const baseRpc = client.rpc;
  client.rpc = async (name, args) => name === "claim_order_email_deliveries"
    ? { data: [job("customer"), job("internal")] } : baseRpc(name, args);
  const result = await runWorker(client, { from, pause: async () => {}, send: async payload => {
    if (payload.to[0] === order.customer_email) throw new DeliveryError("resend_http_422", false);
    return "internal-id";
  }});
  assert.equal(result.failed, 1); assert.equal(result.sent, 1);
  const finishes = calls.filter(call => call.name === "finish_order_email_delivery");
  assert.equal(finishes[0].args.p_retryable, false);
  assert.equal(finishes[1].args.p_kind, "internal");
});

test("provider retry policy includes 429/5xx/concurrent 409 but rejects payload conflicts", async () => {
  for (const [status, name, retryable] of [[429, "rate_limit", true], [503, "server_error", true],
    [409, "concurrent_idempotent_requests", true], [409, "invalid_idempotent_request", false], [422, "validation_error", false]]) {
    await assert.rejects(sendWithResend({}, "key", "test", async () => Response.json({ name }, { status })), error => {
      assert.equal(error.retryable, retryable); return true;
    });
  }
  await assert.rejects(sendWithResend({}, "key", "test", async () => { throw new Error("key-private"); }), /resend_network_error/);
});

test("provider receives stable idempotency header and requires message id", async () => {
  const payload = customerEmail(order, items, from);
  assert.equal(await sendWithResend(payload, "key", "test", async (url, options) => {
    assert.equal(url, "https://api.resend.com/emails");
    assert.equal(options.headers["Idempotency-Key"], "key");
    assert.deepEqual(JSON.parse(options.body), payload);
    return Response.json({ id: "provider-id" });
  }), "provider-id");
  await assert.rejects(sendWithResend(payload, "key", "test", async () => Response.json({})), /resend_missing_message_id/);
});

test("anonymous/client key cannot invoke worker; configuration failures claim nothing", async () => {
  const secret = "a".repeat(64);
  let touched = false;
  const handler = createHandler({ env: name => name === "ORDER_EMAIL_WORKER_SECRET" ? secret : null,
    createClient: () => { touched = true; } });
  assert.equal((await handler(new Request("https://example.test", { method: "POST", headers: { apikey: "sb_publishable_test" } }))).status, 401);
  assert.equal((await handler(new Request("https://example.test"))).status, 405);
  assert.equal((await handler(new Request("https://example.test", { method: "POST", headers: { "x-cubica-email-worker-secret": secret } }))).status, 503);
  assert.equal(touched, false);
});

test("long but incorrect worker secret cannot claim jobs", async () => {
  const calls = [], secret = "x".repeat(64);
  const environment = { SUPABASE_URL: "url", SUPABASE_SERVICE_ROLE_KEY: "service", RESEND_API_KEY: "resend", ORDER_EMAIL_FROM: from };
  const handler = createHandler({ env: name => environment[name], createClient: () => ({ rpc: async (name, args) => {
    calls.push({ name, args }); return { data: false };
  }}) });
  const response = await handler(new Request("https://example.test", { method: "POST", headers: { "x-cubica-email-worker-secret": secret } }));
  assert.equal(response.status, 401);
  assert.deepEqual(calls.map(call => call.name), ["validate_order_email_worker_secret"]);
});

test("native RPC adapter preserves boolean responses, privileged headers and empty success", async () => {
  const client = createRpcClient("https://project.example.test/", "server-key", {}, async (url, request) => {
    assert.equal(url, "https://project.example.test/rest/v1/rpc/validate_order_email_worker_secret");
    assert.equal(request.headers.apikey, "server-key");
    assert.equal(request.headers.Authorization, "Bearer server-key");
    assert.deepEqual(JSON.parse(request.body), { p_secret: "secret" });
    return Response.json(true);
  });
  assert.deepEqual(await client.rpc("validate_order_email_worker_secret", { p_secret: "secret" }), { data: true, error: null });
  const empty = createRpcClient("https://example.test", "key", {}, async () => new Response(null, { status: 204 }));
  assert.deepEqual(await empty.rpc("finish"), { data: null, error: null });
});

test("request body cannot supply an order, recipient, stock, or price", async () => {
  const secret = "b".repeat(64), calls = [];
  const environment = { ORDER_EMAIL_WORKER_SECRET: secret, SUPABASE_URL: "url", SUPABASE_SERVICE_ROLE_KEY: "test-service",
    RESEND_API_KEY: "test-resend", ORDER_EMAIL_FROM: from };
  const handler = createHandler({ env: name => environment[name], createClient: () => ({ rpc: async (name, args) => {
    calls.push({ name, args }); return { data: name === "validate_order_email_worker_secret" ? true : [] };
  }}), pause: async () => {} });
  const result = await handler(new Request("https://example.test", { method: "POST", headers: { "x-cubica-email-worker-secret": secret },
    body: JSON.stringify({ order_id: "forged", to: "attacker@example.test", stock: 999999, price: 1 }) }));
  assert.equal(result.status, 200);
  assert.deepEqual(calls, [{ name: "validate_order_email_worker_secret", args: { p_secret: secret } },
    { name: "claim_order_email_deliveries", args: { p_limit: 3 } }]);
});
