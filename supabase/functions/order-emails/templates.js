export const MISSING_RECIPE = "Receta no cargada. No es posible calcular automáticamente los insumos necesarios para este producto.";
const SITE = "https://cubica3d.ar";
const ORDERS_URL = SITE+"/?view=orders";
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
const COLORS = { ink: "#222235", secondary: "#666678", line: "#e8e6ec", soft: "#f5f4f8", navy: "#20213a", accent: "#7256d8" };
const logo = `<img src="${SITE}/assets/logo.jpg" width="52" height="52" alt="Cúbica" style="display:block;border:0;border-radius:10px;">`;
const sectionTitle = value => `<h2 style="font-size:17px;line-height:1.4;margin:26px 0 12px;color:${COLORS.ink};">${escapeHtml(value)}</h2>`;
const paragraph = value => `<p style="font-size:14px;line-height:1.7;margin:0 0 16px;color:${COLORS.secondary};">${value}</p>`;

// Tablas de presentación e inline styles para clientes de correo, incluido Outlook.
function frame({ colored, heading, header, body, footer }) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(heading)}</title><style>@media only screen and (max-width:480px){.email-inset{padding-left:20px!important;padding-right:20px!important}.email-heading{font-size:28px!important}.email-fact{display:block!important;width:100%!important;padding-bottom:12px!important}.email-total{font-size:25px!important}}</style></head><body style="margin:0;padding:0;background:#f3f2f6;color:${COLORS.ink};font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:24px 12px;"><!--[if mso]><table role="presentation" width="620" cellpadding="0" cellspacing="0"><tr><td><![endif]--><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:620px;background:#ffffff;border:1px solid ${COLORS.line};border-radius:${colored ? 18 : 0}px;overflow:hidden;"><tr><td>${header}</td></tr><tr><td class="email-inset" style="padding:26px 34px 32px;">${body}</td></tr><tr><td class="email-inset" style="padding:24px 34px;background:${COLORS.soft};text-align:center;font-size:12px;line-height:1.7;color:${COLORS.secondary};">${footer}</td></tr></table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`;
}

function brandHeader(order, colored) {
  const foreground = colored ? "#ffffff" : COLORS.ink;
  const secondary = colored ? "#c3c2d7" : COLORS.secondary;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${colored ? COLORS.navy : "#ffffff"};color:${foreground};${colored ? `border-bottom:6px solid ${COLORS.accent};` : ""}"><tr><td class="email-inset" style="padding:28px 34px 20px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="66" style="vertical-align:middle;">${logo}</td><td style="vertical-align:middle;"><p style="font-size:22px;line-height:1.2;letter-spacing:4px;font-weight:bold;margin:0;color:${foreground};">CÚBICA</p><p style="font-size:12px;line-height:1.5;margin:5px 0 0;color:${secondary};">${colored ? "Impresión 3D" : "Gestión de pedidos"}</p></td></tr></table></td></tr><tr><td class="email-inset" style="padding:0 34px 28px;"><p style="font-size:11px;line-height:1.6;letter-spacing:1.5px;margin:8px 0 14px;color:${colored ? "#d6cffe" : COLORS.secondary};">${colored ? "TU IDEA YA ESTÁ EN MARCHA" : "NUEVO PEDIDO"} · ${escapeHtml(title(order))}</p><h1 class="email-heading" style="font-size:34px;line-height:1.14;letter-spacing:-.8px;margin:0 0 16px;color:${foreground};">${colored ? "Un nuevo objeto.<br>Un lugar en tu mundo." : "Preparar el próximo<br>pedido."}</h1>${colored ? `<p style="font-size:14px;line-height:1.7;margin:0;color:#d0cfe0;">Gracias por tu pedido, ${escapeHtml(order.customer_name)}.</p>` : `<p style="font-size:13px;line-height:1.7;margin:0;color:${secondary};">${escapeHtml(displayDate(order.created_at))}</p>`}</td></tr></table>`;
}

const itemTable = (items, colored = false) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${items.map(item => {
  const initials = (String(item.name).match(/\p{L}[\p{L}\p{N}]*/gu) || []).slice(0, 2).map(word => word[0]).join("").toUpperCase();
  return `<tr>${colored ? `<td width="46" style="padding:16px 10px 16px 0;border-bottom:1px solid ${COLORS.line};vertical-align:middle;"><span style="display:block;text-align:center;padding:11px 0;font-size:11px;font-weight:bold;border-radius:7px;background:#ece8fa;color:#5b459e;">${escapeHtml(initials)}</span></td>` : ""}<td style="padding:16px 0;border-bottom:1px solid ${COLORS.line};vertical-align:top;"><strong style="font-size:14px;line-height:1.6;">${escapeHtml(item.name)}</strong><br><span style="font-size:12px;line-height:1.6;color:${COLORS.secondary};">${item.color ? `${escapeHtml(item.color)} · ` : ""}${quantity(item.qty)} ${Number(item.qty) === 1 ? "unidad" : "unidades"} × ${escapeHtml(money(item.unit_price))}</span></td><td align="right" style="padding:16px 0 16px 12px;border-bottom:1px solid ${COLORS.line};font-size:14px;line-height:1.6;font-weight:bold;vertical-align:top;white-space:nowrap;">${escapeHtml(money(Number(item.qty) * Number(item.unit_price)))}</td></tr>`;
}).join("")}</table>`;
const itemText = items => items.map(item => `- ${label(item)} × ${quantity(item.qty)} · ${money(item.unit_price)} por unidad · ${money(Number(item.qty) * Number(item.unit_price))}`).join("\n");

// Lista explícita de campos comerciales: el cliente jamás recibe el plan interno.

function deliveryText(order, internal=false){
 const d=order.delivery;if(!d?.mode)return "";
 const a=d.address||{}, pickup=d.mode==="pickup";
 const lines=[pickup?"Retiro personal coordinado":"Envío a domicilio",`Costo de entrega: ${money(d.charged_ars||0)}`];
 if(pickup)lines.push("Coordinaremos el punto y horario de retiro cuando el pedido esté preparado.");
 else lines.push(`Destinatario: ${text(a.recipient)}`,`Teléfono: ${text(a.phone)}`,`Dirección: ${text(a.street)} ${text(a.number)}${a.floor?` · Piso ${text(a.floor)}`:""}${a.apartment?` · Departamento ${text(a.apartment)}`:""}`,`${text(a.city)}, ${text(a.province)} · CP ${text(a.postal_code)}`,a.instructions?`Indicaciones: ${text(a.instructions)}`:"",`Servicio: ${text(d.snapshot?.service||d.service_label)}`);
 if(internal&&!pickup){const r=d.snapshot?.selected||{};lines.push(`Transportista: ${text(r.code)}`,`Tarifa original: ${money(r.base_price_ars||0)}`,`Margen: ${quantity(r.margin_percent||0)}% · ${money(r.margin_ars||0)}`,`Embalaje: ${money(r.packaging_cost_ars||0)}`,`Estado logístico: ${text(d.logistics_status)}`,`Costo real de despacho: ${d.actual_cost_ars==null?"Pendiente de registrar":money(d.actual_cost_ars)}`,`Seguimiento: ${text(d.tracking_code||"Pendiente")}`);}
 return lines.filter(Boolean).join("\n");
}
function deliveryHtml(order, internal=false){const value=deliveryText(order,internal);return value?sectionTitle("Entrega")+paragraph(escapeHtml(value).replace(/\n/g,"<br>")):"";}

export function customerEmail(order, items, from) {
  const heading = `Recibimos tu pedido ${title(order)}`;
  return {
    from, to: [order.customer_email], reply_to: "contacto@cubica3d.ar",
    subject: `Cúbica · Pedido ${title(order)} recibido`,
    html: frame({ colored: true, heading, header: brandHeader(order, true), body:
      `<p style="font-size:14px;line-height:1.6;margin:0 0 5px;color:#247246;font-weight:bold;">✓ Pedido recibido</p>${paragraph("Tu pedido ya está registrado. Nos pondremos en contacto para coordinar los próximos pasos.")}${deliveryHtml(order)}${sectionTitle("Esto elegiste")}${itemTable(items, true)}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px;background:${COLORS.soft};border-radius:10px;"><tr><td style="padding:18px 20px;font-size:13px;line-height:1.6;">Total del pedido<br><span style="font-size:12px;color:${COLORS.secondary};">Método de pago: ${escapeHtml(order.payment)}</span></td><td class="email-total" align="right" style="padding:18px 20px 18px 0;font-size:28px;font-weight:bold;white-space:nowrap;">${escapeHtml(money(order.total))}</td></tr></table><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;"><tr><td align="center" bgcolor="${COLORS.accent}" style="border-radius:10px;"><a href="${ORDERS_URL}" style="display:block;padding:15px 20px;color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;line-height:1.6;">Ver mis pedidos →</a></td></tr></table><p style="font-size:12px;line-height:1.7;margin:16px 0 0;color:${COLORS.secondary};">Si se te solicita, ingresá con el email de esta compra. Después verás tus pedidos. Si compraste como invitado, podés crear una cuenta con el mismo email.</p>`,
      footer: `<strong>Hecho para vos, impreso para quedarse.</strong><br><a href="${SITE}" style="color:${COLORS.secondary};text-decoration:none;">cubica3d.ar</a> · contacto@cubica3d.ar<p style="font-size:11px;margin:14px 0 0;">Este correo confirma la recepción del pedido; no es una confirmación de pago.</p>` }),
    text: `${heading}\n\nHola ${order.customer_name}, gracias por elegir Cúbica. Tu pedido quedó registrado. Nos pondremos en contacto para coordinar los próximos pasos.\n\n${itemText(items)}\n\n${deliveryText(order)}\n\nTotal: ${money(order.total)}\nMétodo de pago: ${order.payment}\n\nVer mis pedidos: ${ORDERS_URL}\nSi se te solicita, ingresá con el email de esta compra. Después verás tus pedidos. Si compraste como invitado, podés crear una cuenta con el mismo email.\n\nEste correo confirma la recepción del pedido; no es una confirmación de pago.`,
  };
}

export function readyEmail(order, items, from) {
  const heading = "Tu pedido está listo";
  const message = `Tu pedido ${title(order)} ya está preparado. Nos pondremos en contacto para coordinar la entrega o retiro.`;
  const header = `<div class="email-inset" style="padding:28px 34px;background:${COLORS.navy};border-bottom:6px solid ${COLORS.accent};color:#fff;">${logo}<p style="letter-spacing:4px;font-weight:bold;">CÚBICA</p><h1 class="email-heading" style="font-size:34px;line-height:1.2;">${heading}</h1></div>`;
  return {
    from, to:[order.customer_email], reply_to:"contacto@cubica3d.ar",
    subject:`Cúbica · Tu pedido ${title(order)} está listo`,
    html:frame({colored:true,heading,header,body:
      `${paragraph(`Hola ${escapeHtml(order.customer_name)}.`)}${paragraph(escapeHtml(message))}${itemTable(items,true)}${deliveryHtml(order)}<p style="margin:26px 0;"><a href="${ORDERS_URL}" style="display:block;padding:15px 20px;background:${COLORS.accent};color:#fff;text-decoration:none;border-radius:10px;text-align:center;font-weight:bold;">Ver mi pedido →</a></p>${paragraph("Ingresá con el email de tu compra para consultar el pedido.")}`,
      footer:`<strong>Gracias por elegir Cúbica.</strong><br>cubica3d.ar · contacto@cubica3d.ar`}),
    text:`${heading}\n\nHola ${order.customer_name}. ${message}\n\n${itemText(items)}\n\n${deliveryText(order)}\n\nVer mi pedido: ${ORDERS_URL}\nIngresá con el email de tu compra para consultar el pedido.`,
  };
}

export function internalEmail(order, items, plan, from) {
  const statuses = { available: "Disponible para el pedido completo", insufficient: "Insumos insuficientes para el pedido completo", unknown: "Inventario incompleto: requiere revisión" };
  const productsHtml = plan.products.map(product => `<li><strong>${escapeHtml(product.name)} × ${quantity(product.ordered)}</strong><br>${product.recipeStatus === "missing" ? escapeHtml(MISSING_RECIPE) : escapeHtml(statuses[product.availability])}</li>`).join("");
  const details = `Fecha: ${displayDate(order.created_at)}\nCliente: ${order.customer_name}\nEmail: ${order.customer_email}\nTeléfono: ${order.phone || "No informado"}\nMétodo de pago: ${order.payment}\nEstado: ${order.status}\nTotal: ${money(order.total)}\nObservaciones: ${order.notes || "Sin observaciones"}\nID: ${order.id}\nReferencia cliente: ${order.client_order_id || "Sin referencia"}\nCuenta: ${order.user_id || "Invitado"}\nUsuario: ${order.username || "guest"}`;
  const productsText = plan.products.map(product => `- ${product.name} × ${quantity(product.ordered)}: ${product.recipeStatus === "missing" ? MISSING_RECIPE : statuses[product.availability]}`).join("\n");
  const suppliesText = plan.supplies.map(row => `- ${row.name}${row.inactive ? " (inactivo)" : ""}: se necesita ${quantity(row.required)} ${row.unit}; disponible ${row.available === null ? "sin dato" : quantity(row.available)}; falta ${row.missing === null ? "no calculable" : quantity(row.missing)}. ${row.enough === null ? "Inventario no disponible" : row.enough ? "Disponible" : "Faltante"}. Usado por: ${row.products.map(product => `${product.name} × ${product.qty}`).join("; ")}${row.inactive ? `. Stock físico: ${quantity(row.stock)}` : ""}`).join("\n");
  const heading = `Nuevo pedido ${title(order)}`;
  return {
    from, to: ["pedidos@cubica3d.ar"], reply_to: "contacto@cubica3d.ar",
    subject: `Cúbica · Nuevo pedido ${title(order)}`,
    html: frame({ colored: false, heading, header: brandHeader(order, false), body:
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${COLORS.line};border-bottom:1px solid ${COLORS.line};"><tr><td class="email-fact" width="58%" style="padding:18px 12px 18px 0;vertical-align:top;font-size:14px;line-height:1.7;"><span style="font-size:12px;color:${COLORS.secondary};">Cliente</span><br><strong>${escapeHtml(order.customer_name)}</strong><br><span style="font-size:12px;overflow-wrap:anywhere;word-break:break-word;color:${COLORS.secondary};">${escapeHtml(order.customer_email)}<br>${escapeHtml(order.phone || "Teléfono no informado")}</span></td><td class="email-fact" style="padding:18px 0;vertical-align:top;font-size:14px;line-height:1.7;"><span style="font-size:12px;color:${COLORS.secondary};">Pago / total</span><br><strong>${escapeHtml(order.payment)} · ${escapeHtml(money(order.total))}</strong><br><span style="font-size:12px;color:${COLORS.secondary};">${escapeHtml(order.status)} · ${order.user_id ? "Cliente registrado" : "Compra como invitado"}</span></td></tr></table>${deliveryHtml(order,true)}${sectionTitle("Productos")}${itemTable(items)}${sectionTitle("Plan de producción")}${paragraph("Consumo para la totalidad de las unidades compradas, sin descontar productos terminados. Los insumos compartidos se suman antes de comparar el stock.")}<ul style="margin:0;padding-left:20px;font-size:13px;line-height:1.7;">${productsHtml}</ul>${plan.supplies.map(row => {
        const status = row.enough === null ? "Inventario no disponible" : row.enough ? "Disponible" : `Faltan ${quantity(row.missing)} ${escapeHtml(row.unit)}`;
        const statusColor = row.enough === true ? "#247246" : "#925617";
        const statusBg = row.enough === true ? "#e7f4ec" : "#fff1dd";
        return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;border-bottom:1px solid ${COLORS.line};"><tr><td style="padding:0 8px 8px 0;font-size:14px;font-weight:bold;vertical-align:top;">${escapeHtml(row.name)}${row.inactive ? " (inactivo)" : ""}</td><td align="right" style="padding:0 0 8px;vertical-align:top;"><span style="display:inline-block;background:${statusBg};color:${statusColor};padding:4px 8px;font-size:11px;line-height:1.5;border-radius:4px;font-weight:bold;">${status}</span></td></tr><tr><td colspan="2" style="padding-bottom:14px;font-size:12px;line-height:1.8;color:${COLORS.secondary};">Necesario <strong style="color:${COLORS.ink};">${quantity(row.required)} ${escapeHtml(row.unit)}</strong> · Disponible <strong style="color:${COLORS.ink};">${row.available === null ? "Sin dato" : `${quantity(row.available)} ${escapeHtml(row.unit)}`}</strong> · Falta <strong style="color:${COLORS.ink};">${row.missing === null ? "No calculable" : `${quantity(row.missing)} ${escapeHtml(row.unit)}`}</strong>${row.inactive ? `<br>Stock físico: ${quantity(row.stock)} ${escapeHtml(row.unit)}` : ""}<br>${escapeHtml(row.products.map(product => `${product.name} × ${product.qty}`).join(" + "))}</td></tr></table>`;
      }).join("")}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px;"><tr><td style="padding:16px 18px;background:${COLORS.soft};border-left:3px solid ${COLORS.ink};font-size:13px;line-height:1.7;"><strong>La compra está registrada</strong><br>Los faltantes de insumos y las recetas ausentes no bloquean la compra. Revisá y coordiná la producción.</td></tr></table><p style="font-size:12px;line-height:1.8;margin:18px 0 0;color:${COLORS.secondary};"><strong>Observaciones:</strong> ${escapeHtml(order.notes || "Sin observaciones").replace(/\r?\n/g, "<br>")}<br>Inventario consultado al preparar el correo; no reserva ni descuenta materiales.</p><p style="font-size:11px;line-height:1.7;margin:18px 0 0;color:${COLORS.secondary};word-break:break-word;">ID: ${escapeHtml(order.id)}<br>Referencia cliente: ${escapeHtml(order.client_order_id || "Sin referencia")}<br>Cuenta: ${escapeHtml(order.user_id || "Invitado")}<br>Usuario: ${escapeHtml(order.username || "guest")}</p>`,
      footer: `Correo interno de Cúbica<br><span style="font-size:11px;">Información de producción exclusiva del negocio.</span>` }),
    text: `${heading}\n\n${details}\n\n${deliveryText(order,true)}\n\n${itemText(items)}\n\nPlan de producción\nConsumo para la totalidad de las unidades compradas, sin descontar productos terminados. Disponibilidad agregada al preparar el correo; no reserva ni descuenta insumos.\n\n${productsText}\n\n${suppliesText}\n\nLos faltantes de insumos y las recetas ausentes no bloquean la compra.`,
  };
}

