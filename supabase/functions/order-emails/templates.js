export const MISSING_RECIPE = "Receta no cargada. No es posible calcular automáticamente los insumos necesarios para este producto.";
const SITE = "https://cubica3d.ar";
export const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);
const money = value => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(Number(value));
const quantity = value => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 4 }).format(Number(value));
const text = value => String(value ?? "");
const label = item => `${text(item.name)}${item.color ? ` · ${item.color}` : ""}`;
const displayDate = value => new Intl.DateTimeFormat("es-AR", {
  dateStyle: "short", timeStyle: "short", timeZone: "America/Argentina/Buenos_Aires",
}).format(new Date(value));
const title = order => String(order.order_number || order.id).replace(/[\r\n]/g, " ");
const frame = (heading, body) => `<!doctype html><html lang="es"><head><meta charset="utf-8"></head><body style="margin:0;background:#f4f4f4;color:#222;font-family:Arial,sans-serif"><main style="max-width:720px;margin:24px auto;padding:28px;background:white;border-radius:12px"><p style="color:#555;font-weight:bold">CÚBICA · Impresión 3D</p><h1 style="font-size:24px">${escapeHtml(heading)}</h1>${body}<hr><p style="font-size:12px;color:#555">Cúbica · <a href="${SITE}">cubica3d.ar</a></p></main></body></html>`;

function itemRows(items) {
  return items.map(item => `<tr><td style="padding:8px;border-bottom:1px solid #ddd">${escapeHtml(label(item))}</td><td style="padding:8px">${quantity(item.qty)}</td><td style="padding:8px">${escapeHtml(money(item.unit_price))}</td><td style="padding:8px">${escapeHtml(money(Number(item.qty) * Number(item.unit_price)))}</td></tr>`).join("");
}
const itemTable = items => `<table style="width:100%;border-collapse:collapse"><thead><tr><th align="left">Producto / variante</th><th>Cantidad</th><th>Precio</th><th>Subtotal</th></tr></thead><tbody>${itemRows(items)}</tbody></table>`;
const itemText = items => items.map(item => `- ${label(item)} × ${quantity(item.qty)} · ${money(item.unit_price)} por unidad · ${money(Number(item.qty) * Number(item.unit_price))}`).join("\n");

// Lista explícita de campos comerciales: el cliente jamás recibe el plan interno.
export function customerEmail(order, items, from) {
  const heading = `Recibimos tu pedido ${title(order)}`;
  return {
    from, to: [order.customer_email], reply_to: "contacto@cubica3d.ar",
    subject: `Cúbica · Pedido ${title(order)} recibido`,
    html: frame(heading, `<p>Hola ${escapeHtml(order.customer_name)}, gracias por elegir Cúbica.</p><p>Tu pedido quedó registrado. Nos pondremos en contacto para coordinar los próximos pasos.</p>${itemTable(items)}<p><strong>Total: ${escapeHtml(money(order.total))}</strong></p><p>Método de pago: ${escapeHtml(order.payment)}</p><p><a href="${SITE}">Ver mis pedidos en Cúbica</a></p><p>Ingresá con el email de esta compra y abrí «Mi cuenta → Mis pedidos». Si compraste como invitado, podés crear una cuenta con el mismo email.</p><p>Este correo confirma la recepción del pedido; no es una confirmación de pago.</p>`),
    text: `${heading}\n\nHola ${order.customer_name}, gracias por elegir Cúbica. Tu pedido quedó registrado. Nos pondremos en contacto para coordinar los próximos pasos.\n\n${itemText(items)}\n\nTotal: ${money(order.total)}\nMétodo de pago: ${order.payment}\n\nVer mis pedidos: ${SITE}\nIngresá con el email de esta compra y abrí Mi cuenta → Mis pedidos. Si compraste como invitado, podés crear una cuenta con el mismo email.\n\nEste correo confirma la recepción del pedido; no es una confirmación de pago.`,
  };
}

export function internalEmail(order, items, plan, from) {
  const statuses = { available: "Disponible para el pedido completo", insufficient: "Insumos insuficientes para el pedido completo", unknown: "Inventario incompleto: requiere revisión" };
  const productsHtml = plan.products.map(product => `<li><strong>${escapeHtml(product.name)} × ${quantity(product.ordered)}</strong><br>${product.recipeStatus === "missing" ? escapeHtml(MISSING_RECIPE) : escapeHtml(statuses[product.availability])}</li>`).join("");
  const suppliesHtml = plan.supplies.map(row => `<tr><td style="padding:8px">${escapeHtml(row.name)}${row.inactive ? " (inactivo)" : ""}<br><small>${escapeHtml(row.products.map(product => `${product.name} × ${product.qty}`).join("; "))}</small></td><td>${quantity(row.required)} ${escapeHtml(row.unit)}</td><td>${row.available === null ? "Sin dato" : `${quantity(row.available)} ${escapeHtml(row.unit)}`}${row.inactive ? `<br><small>Stock físico: ${quantity(row.stock)}</small>` : ""}</td><td>${row.missing === null ? "No calculable" : `${quantity(row.missing)} ${escapeHtml(row.unit)}`}</td><td>${row.enough === null ? "Inventario no disponible" : row.enough ? "Disponible" : "Faltante"}</td></tr>`).join("");
  const details = `Fecha: ${displayDate(order.created_at)}\nCliente: ${order.customer_name}\nEmail: ${order.customer_email}\nTeléfono: ${order.phone || "No informado"}\nMétodo de pago: ${order.payment}\nEstado: ${order.status}\nTotal: ${money(order.total)}\nObservaciones: ${order.notes || "Sin observaciones"}\nID: ${order.id}\nReferencia cliente: ${order.client_order_id || "Sin referencia"}\nCuenta: ${order.user_id || "Invitado"}\nUsuario: ${order.username || "guest"}`;
  const productsText = plan.products.map(product => `- ${product.name} × ${quantity(product.ordered)}: ${product.recipeStatus === "missing" ? MISSING_RECIPE : statuses[product.availability]}`).join("\n");
  const suppliesText = plan.supplies.map(row => `- ${row.name}${row.inactive ? " (inactivo)" : ""}: se necesita ${quantity(row.required)} ${row.unit}; disponible ${row.available === null ? "sin dato" : quantity(row.available)}; falta ${row.missing === null ? "no calculable" : quantity(row.missing)}. ${row.enough === null ? "Inventario no disponible" : row.enough ? "Disponible" : "Faltante"}. Usado por: ${row.products.map(product => `${product.name} × ${product.qty}`).join("; ")}${row.inactive ? `. Stock físico: ${quantity(row.stock)}` : ""}`).join("\n");
  const heading = `Nuevo pedido ${title(order)}`;
  return {
    from, to: ["pedidos@cubica3d.ar"], reply_to: "contacto@cubica3d.ar",
    subject: `Cúbica · Nuevo pedido ${title(order)}`,
    html: frame(heading, `<p style="white-space:pre-wrap">${escapeHtml(details)}</p>${itemTable(items)}<h2>Plan de producción</h2><p>Consumo para la totalidad de las unidades compradas, sin descontar productos terminados. La disponibilidad usa el consumo agregado del pedido y el inventario al preparar este correo; no reserva ni descuenta insumos.</p><ul>${productsHtml}</ul>${plan.supplies.length ? `<table style="width:100%;border-collapse:collapse"><thead><tr><th>Insumo</th><th>Necesario</th><th>Disponible</th><th>Falta</th><th>Estado</th></tr></thead><tbody>${suppliesHtml}</tbody></table>` : ""}<p>Los faltantes de insumos y las recetas ausentes no bloquean la compra. Revisá y coordiná la producción.</p>`),
    text: `${heading}\n\n${details}\n\n${itemText(items)}\n\nPlan de producción\nConsumo para la totalidad de las unidades compradas, sin descontar productos terminados. Disponibilidad agregada al preparar el correo; no reserva ni descuenta insumos.\n\n${productsText}\n\n${suppliesText}\n\nLos faltantes de insumos y las recetas ausentes no bloquean la compra.`,
  };
}
