import { calculateProductionPlan } from "./plan.js";
import { customerEmail, internalEmail, readyEmail } from "./templates.js";

// El worker solo necesita RPC. REST nativo evita dependencias externas en runtime.
export function createRpcClient(url, serviceKey, _options, fetchImpl = fetch) {
  return { rpc: async (name, args = {}) => {
    try {
      const response = await fetchImpl(`${url.replace(/\/$/, "")}/rest/v1/rpc/${name}`, {
        method: "POST", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(args), signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) return { data: null, error: { message: `rpc_http_${response.status}` } };
      const body = await response.text();
      return { data: body ? JSON.parse(body) : null, error: null };
    } catch {
      return { data: null, error: { message: "rpc_transport_error" } };
    }
  }};
}

export class DeliveryError extends Error {
  constructor(code, retryable = true) {
    super(code);
    this.code = code;
    this.retryable = retryable;
  }
}

export async function sendWithResend(payload, idempotencyKey, apiKey, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(12000),
    });
  } catch {
    // Un timeout puede ocurrir después del envío: repetir siempre el mismo payload/key.
    throw new DeliveryError("resend_network_error");
  }
  let result;
  try { result = await response.json(); } catch { result = {}; }
  if (!response.ok) {
    const concurrent = response.status === 409 && result.name === "concurrent_idempotent_requests";
    throw new DeliveryError(`resend_http_${response.status}`, response.status === 429 || response.status >= 500 || concurrent);
  }
  if (!result.id) throw new DeliveryError("resend_missing_message_id");
  return result.id;
}

async function rpc(client, name, args = {}) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new DeliveryError(`database_${name}`);
  return data;
}

export async function processDelivery(client, job, options) {
  const identity = { p_order_id: job.order_id, p_kind: job.kind, p_lock_token: job.lock_token };
  try {
    let payload = job.payload;
    if (!payload) {
      const snapshot = await rpc(client, "get_order_email_snapshot", { p_order_id: job.order_id });
      if (!snapshot?.order || !snapshot.items?.length) throw new DeliveryError("order_snapshot_incomplete");
      if (snapshot.order[`${job.kind}_email_sent`]) {
        await rpc(client, "finish_order_email_delivery", { ...identity, p_sent: true, p_provider_id: null, p_error: null, p_retryable: false });
        return "already_sent";
      }
      if (job.kind === "customer") {
        payload = customerEmail(snapshot.order, snapshot.items, options.from);
      } else if (job.kind === "ready") {
        payload = readyEmail(snapshot.order, snapshot.items, options.from);
      } else if (job.kind === "internal") {
        const plan = calculateProductionPlan(snapshot.items, snapshot.recipes, snapshot.supplies);
        payload = internalEmail(snapshot.order, snapshot.items, plan, options.from);
      } else {
        throw new DeliveryError("invalid_delivery_kind", false);
      }
      payload = await rpc(client, "prepare_order_email_delivery", { ...identity, p_payload: payload });
      if (!payload) throw new DeliveryError("delivery_lease_lost");
    }
    const messageId = await options.send(payload, `cubica-order/${job.order_id}/${job.kind}/v1`);
    await rpc(client, "finish_order_email_delivery", { ...identity, p_sent: true, p_provider_id: messageId, p_error: null, p_retryable: false });
    return "sent";
  } catch (error) {
    const code = error instanceof DeliveryError ? error.code : "delivery_processing_error";
    const retryable = error instanceof DeliveryError ? error.retryable : true;
    // No registrar el payload ni la respuesta del proveedor: contienen datos del cliente.
    console.error(`order-email ${job.kind}: ${code}`);
    await rpc(client, "finish_order_email_delivery", { ...identity, p_sent: false, p_provider_id: null, p_error: code, p_retryable: retryable });
    return retryable ? "retry" : "failed";
  }
}

export async function runWorker(client, options) {
  const jobs = await rpc(client, "claim_order_email_deliveries", { p_limit: 3 });
  const results = { sent: 0, already_sent: 0, retry: 0, failed: 0 };
  for (const job of jobs || []) {
    const result = await processDelivery(client, job, options);
    results[result]++;
    // Resend suele limitar a 2 solicitudes/s; los 429 igualmente quedan en la cola.
    await (options.pause || (ms => new Promise(resolve => setTimeout(resolve, ms))))(600);
  }
  return results;
}

export function createHandler({ env, createClient, fetchImpl = fetch, pause }) {
  return async request => {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const secret = request.headers.get("x-cubica-email-worker-secret") || "";
    if (secret.length < 32 || secret.length > 256) {
      return new Response("Unauthorized", { status: 401 });
    }
    const url = env("SUPABASE_URL"), serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
    const resendKey = env("RESEND_API_KEY"), from = env("ORDER_EMAIL_FROM");
    if (!url || !serviceKey || !resendKey || !from) {
      console.error("order-email: missing_server_configuration");
      return Response.json({ error: "missing_server_configuration" }, { status: 503 });
    }
    try {
      const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
      // Vault genera y conserva el secreto. El RPC solo devuelve si coincide;
      // nunca extraer el valor ni trasladarlo al frontend o al repositorio.
      const valid = await rpc(client, "validate_order_email_worker_secret", { p_secret: secret });
      if (valid !== true) return new Response("Unauthorized", { status: 401 });
      const result = await runWorker(client, {
        from, pause, send: (payload, key) => sendWithResend(payload, key, resendKey, fetchImpl),
      });
      return Response.json(result);
    } catch {
      console.error("order-email: worker_failed");
      return Response.json({ error: "worker_failed" }, { status: 500 });
    }
  };
}
