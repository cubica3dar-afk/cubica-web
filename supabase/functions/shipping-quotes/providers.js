// No production mocks or scraped prices. A new official adapter implements
// configuration(env) and quote(snapshot, { fetchImpl, signal }).
// These providers remain unavailable until commercial access and the live
// request/response contracts have been validated with the business account.
const definitions = {
  correo_argentino: {
    label: "Correo Argentino",
    requirements: ["MiCorreo: acceso comercial/API habilitado", "MiCorreo: usuario y contraseña API", "MiCorreo: customerId", "Validación de tarifas y cobertura con la cuenta real"],
  },
  andreani: {
    label: "Andreani",
    requirements: ["Andreani: cuenta comercial y contrato habilitado", "Andreani: credenciales QA y producción", "Andreani: contrato de cotización vigente y respuesta validada"],
  },
  oca: {
    label: "OCA",
    requirements: ["OCA: cuenta e-Pak/CUIT y operativa para entrega a domicilio", "OCA: contrato y respuesta XML de tarifa validados", "OCA: confirmación de impuestos y cobertura"],
  },
};

export const productionProviders = Object.freeze(Object.fromEntries(
  Object.entries(definitions).map(([code, definition]) => [code, Object.freeze({
    code,
    configuration: () => ({ ready: false, reason_code: "commercial_access_pending", missing_configuration: definition.requirements }),
    // A disabled integration cannot manufacture a successful response.
    quote: async () => { throw new Error("provider_not_configured"); },
  })]),
));

export const providerNames = Object.freeze(Object.fromEntries(Object.entries(definitions).map(([code, definition]) => [code, definition.label])));

export function normalizeRates(code, rates, now = Date.now()) {
  if (!Array.isArray(rates) || rates.length > 30) return [];
  const unique = new Set();
  return rates.flatMap(rate => {
    if (!rate || typeof rate !== "object" || Array.isArray(rate)) return [];
    const price = Number(rate.base_price_ars);
    const service = String(rate.service_code || "").trim();
    const label = String(rate.label || "").trim();
    const expiry = rate.valid_until == null ? null : Date.parse(rate.valid_until);
    if (rate.base_price_ars == null || rate.base_price_ars === "" || !Number.isFinite(price) || price <= 0 || price > 10000000 ||
        Math.abs(price * 100 - Math.round(price * 100)) > 0.00001 ||
        !service || service.length > 100 || !label || label.length > 150 ||
        (expiry != null && (!Number.isFinite(expiry) || expiry <= now)) || unique.has(service)) return [];
    unique.add(service);
    // Drop all unapproved carrier fields (credentials, addresses, raw responses).
    return [{ code, service_code: service, label, base_price_ars: price,
      valid_until: expiry == null ? null : new Date(expiry).toISOString() }];
  });
}

export async function collectProviderRates(snapshot, { adapters = productionProviders, env = () => undefined, fetchImpl = fetch, timeoutMs = 8000, now = Date.now() } = {}) {
  const settings = Array.isArray(snapshot.providers) ? snapshot.providers.slice(0, 10) : [];
  const outcomes = await Promise.all(settings.map(async setting => {
    const code = String(setting.code || "");
    const result = { code, status: "disabled", reason_code: "provider_disabled", missing_configuration: [], rate_count: 0 };
    if (!setting.enabled) return { result, rates: [] };
    const adapter = adapters[code];
    if (!adapter) return { result: { ...result, status: "not_configured", reason_code: "adapter_not_installed" }, rates: [] };
    let configuration;
    try { configuration = adapter.configuration(env); } catch { configuration = { ready: false }; }
    if (!configuration?.ready) return { result: { ...result, status: "not_configured", reason_code: configuration?.reason_code || "provider_not_configured",
      missing_configuration: Array.isArray(configuration?.missing_configuration) ? configuration.missing_configuration.slice(0, 10).map(x => String(x).slice(0, 200)) : [] }, rates: [] };
    const controller = new AbortController();
    let timer;
    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); const error = new Error("provider_timeout"); error.name = "TimeoutError"; reject(error); }, timeoutMs);
      });
      const response = await Promise.race([adapter.quote(snapshot, { fetchImpl, signal: controller.signal }), timeout]);
      const rates = normalizeRates(code, response, now);
      return { result: { ...result, status: rates.length ? "ok" : "unavailable", reason_code: rates.length ? "quoted" : "no_valid_rates", rate_count: rates.length }, rates };
    } catch (error) {
      const timeout = error?.name === "TimeoutError" || error?.name === "AbortError";
      return { result: { ...result, status: timeout ? "timeout" : "error", reason_code: timeout ? "provider_timeout" : "provider_request_failed" }, rates: [] };
    } finally { clearTimeout(timer); }
  }));
  return { rates: outcomes.flatMap(x => x.rates), provider_results: outcomes.map(x => x.result) };
}

// Reference calculation for adapter tests. Production selection is performed
// again in the transactional SQL finalizer, using its own stored settings.
export function selectCheapestRate(rates, settings, packagingCostArs) {
  const packaging = Number(packagingCostArs);
  if (!Number.isFinite(packaging) || packaging < 0) throw new Error("invalid_packaging_cost");
  const byCode = new Map(settings.filter(x => x.enabled).map(x => [x.code, x]));
  const candidates = rates.flatMap(rate => {
    const setting = byCode.get(rate.code);
    const margin = Number(setting?.margin_percent);
    const base = Number(rate.base_price_ars);
    if (!setting || !Number.isFinite(margin) || margin < 0 || margin > 100 || !Number.isFinite(base) || base < 0) return [];
    const baseCents = Math.round(base * 100), packagingCents = Math.round(packaging * 100);
    const marginCents = Math.round(baseCents * margin / 100);
    return [{ ...rate, margin_percent: margin, margin_amount_ars: marginCents / 100,
      packaging_cost_ars: packagingCents / 100, final_price_ars: (baseCents + marginCents + packagingCents) / 100 }];
  });
  candidates.sort((a, b) => a.final_price_ars - b.final_price_ars || a.code.localeCompare(b.code) || a.service_code.localeCompare(b.service_code));
  return candidates[0] || null;
}

