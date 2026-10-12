import { collectProviderRates } from "./providers.js";

const MAX_BODY_BYTES = 32768;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-f]{64}$/;
const ALLOWED_STATUSES = new Set(["quoted", "unavailable", "needs_configuration", "preparing", "expired"]);

export class QuoteError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

export function createBackendClient(url, serviceKey, fetchImpl = fetch) {
  const base = url.replace(/\/$/, "");
  return {
    async getUser(token) {
      try {
        const response = await fetchImpl(`${base}/auth/v1/user`, {
          headers: { apikey: serviceKey, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(7000),
        });
        if (!response.ok) return { user: null, error: true };
        const user = await response.json();
        return { user: UUID.test(user?.id || "") ? user : null, error: !UUID.test(user?.id || "") };
      } catch { return { user: null, error: true }; }
    },
    async rpc(name, args) {
      try {
        const response = await fetchImpl(`${base}/rest/v1/rpc/${name}`, {
          method: "POST", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(args), signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) {
          let code = "database_error";
          // Only expose our fixed validation codes; never SQL/provider payloads.
          try {
            const error = await response.json();
            if (/^delivery_[a-z_]+$/.test(error.message || "")) code = error.message;
            else if (error.message === "Demasiadas cotizaciones. Esperá unos minutos.") code = "delivery_rate_limit";
            else if (error.message === "Cotización no disponible") code = "delivery_quote_unavailable";
            else if (error.code === "22023" || error.code === "22P02") code = "delivery_invalid_request";
          } catch { /* Keep the generic safe error. */ }
          return { data: null, error: { code } };
        }
        return { data: await response.json(), error: null };
      } catch { return { data: null, error: { code: "database_unavailable" } }; }
    },
  };
}

async function callRpc(client, name, args) {
  const result = await client.rpc(name, args);
  if (result.error) {
    const code = result.error.code || "database_error";
    const status = code.includes("rate_limit") ? 429 : code.startsWith("delivery_") ? 400 : 503;
    throw new QuoteError(code, status);
  }
  return result.data;
}

async function readJson(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY_BYTES) throw new QuoteError("request_too_large", 413);
  if (!request.body) throw new QuoteError("invalid_request");
  const reader = request.body.getReader(), chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) { await reader.cancel(); throw new QuoteError("request_too_large", 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error instanceof QuoteError) throw error;
    throw new QuoteError("invalid_json");
  } finally { reader.releaseLock(); }
}

export function normalizeQuoteRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || !UUID.test(body.request_id || "") ||
      !Array.isArray(body.items) || !body.items.length || body.items.length > 50 ||
      !body.address || typeof body.address !== "object" || Array.isArray(body.address)) throw new QuoteError("invalid_request");
  const items = body.items.map(item => {
    const product = String(item?.product_id || "").trim();
    const qty = Number(item?.qty);
    const color = String(item?.color || "").trim();
    if (!product || product.length > 100 || !Number.isSafeInteger(qty) || qty < 1 || qty > 100 || color.length > 120) throw new QuoteError("invalid_items");
    return { product_id: product, qty, color };
  });
  const fields = ["recipient", "phone", "street", "number", "floor", "apartment", "city", "province", "postal_code", "instructions"];
  const address = {};
  for (const field of fields) {
    const value = body.address[field];
    if (value != null && typeof value !== "string" && typeof value !== "number") throw new QuoteError("invalid_address");
    address[field] = String(value ?? "").trim();
    if (address[field].length > (field === "instructions" ? 500 : 200)) throw new QuoteError("invalid_address");
  }
  if (body.guest_token != null && !TOKEN.test(body.guest_token)) throw new QuoteError("invalid_quote_token");
  // Prices, dimensions, margins, costs, user IDs, carrier URLs, and selected
  // providers are intentionally excluded. SQL recomputes authoritative inputs.
  return { request_id: body.request_id, items, address, guest_token: body.guest_token || null };
}

export function newQuoteToken(cryptoImpl = crypto) {
  return [...cryptoImpl.getRandomValues(new Uint8Array(32))].map(x => x.toString(16).padStart(2, "0")).join("");
}

export async function rateKey(request, salt, cryptoImpl = crypto) {
  // The final proxy hop is used rather than a client-supplied first XFF entry.
  // With no trusted proxy address all such requests share the unknown bucket.
  const forwarded = request.headers.get("x-forwarded-for") || "";
  const address = forwarded.split(",").at(-1)?.trim().slice(0, 100) || "unknown";
  const digest = await cryptoImpl.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${address}`));
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
}

export function publicQuote(data, token) {
  let status = ALLOWED_STATUSES.has(data?.status) ? data.status : "unavailable";
  const expires = data?.expires_at ? Date.parse(data.expires_at) : null;
  if ((status === "quoted" || status === "preparing") && (!Number.isFinite(expires) || expires <= Date.now())) status = "expired";
  const result = { quote_id: data?.quote_id || null, quote_token: token, status,
    expires_at: typeof data?.expires_at === "string" ? data.expires_at : null };
  if (status === "quoted") {
    const price = Number(data?.price ?? data?.final_price_ars);
    if (!Number.isFinite(price) || price < 0) throw new QuoteError("invalid_quote_response", 503);
    result.price = price;
    result.service_label = typeof data?.service_label === "string" ? data.service_label.slice(0, 160) : "Envío a domicilio";
  }
  const messages = {
    unavailable: "No hay una tarifa de envío disponible. Podés reintentar o elegir retiro coordinado.",
    needs_configuration: "Este pedido todavía no tiene envío habilitado. Podés elegir retiro coordinado.",
    preparing: "La cotización está en curso. Intentá nuevamente en unos segundos.",
    expired: "La cotización venció. Volvé a cotizar antes de confirmar.",
  };
  if (messages[status]) result.message = messages[status];
  return result;
}

export function createHandler({ env, createClient = createBackendClient, fetchImpl = fetch, adapters, cryptoImpl = crypto } = {}) {
  return async request => {
    const origin = request.headers.get("origin");
    const origins = new Set(["https://cubica3d.ar", "https://www.cubica3d.ar", ...String(env("SHIPPING_ALLOWED_ORIGINS") || "").split(",").map(x => x.trim()).filter(Boolean)]);
    const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", Vary: "Origin" };
    if (origin && origins.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
    if (origin && !origins.has(origin)) return Response.json({ error: "origin_not_allowed" }, { status: 403, headers });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...headers,
      "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type" } });
    if (request.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405, headers });
    const url = env("SUPABASE_URL"), serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return Response.json({ error: "shipping_server_not_configured" }, { status: 503, headers });
    try {
      const body = normalizeQuoteRequest(await readJson(request));
      const client = createClient(url, serviceKey, fetchImpl);
      const authorization = request.headers.get("authorization") || "";
      const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || "";
      let userId = null;
      if (authorization && !bearer) throw new QuoteError("invalid_authentication", 401);
      // Publishable/anon key identifies the project, never the customer.
      if (bearer && bearer !== request.headers.get("apikey") && bearer !== env("SUPABASE_ANON_KEY")) {
        const { user, error } = await client.getUser(bearer);
        if (error || !user || !UUID.test(user.id)) throw new QuoteError("invalid_authentication", 401);
        userId = user.id;
      }
      const token = body.guest_token || newQuoteToken(cryptoImpl);
      const identity = { p_user_id: userId, p_guest_token: token };
      const prepared = await callRpc(client, "prepare_delivery_quote", {
        ...identity, p_items: body.items, p_address: body.address, p_request_id: body.request_id,
        p_rate_key: await rateKey(request, env("SHIPPING_RATE_LIMIT_SALT") || serviceKey, cryptoImpl),
      });
      if (prepared?.status !== "preparing" || (Number.isFinite(Date.parse(prepared.expires_at)) && Date.parse(prepared.expires_at) <= Date.now())) {
        return Response.json(publicQuote(prepared, token), { headers });
      }
      if (!UUID.test(prepared?.quote_id || "")) throw new QuoteError("invalid_quote_response", 503);
      const collected = await collectProviderRates(prepared, { adapters, env, fetchImpl });
      const finalized = await callRpc(client, "finalize_delivery_quote", {
        ...identity, p_quote_id: prepared.quote_id, p_rates: collected.rates, p_provider_results: collected.provider_results,
      });
      return Response.json(publicQuote(finalized, token), { headers });
    } catch (error) {
      const known = error instanceof QuoteError;
      // Do not log destinations, tokens, SQL messages, carrier responses or keys.
      return Response.json({ error: known ? error.code : "shipping_quote_failed" }, { status: known ? error.status : 503, headers });
    }
  };
}

