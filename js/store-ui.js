/* CÚBICA 3D — tienda y carrito público. */

const PRODUCT_PAGE_SIZE=12;
let productPage=1;

function setProductPage(page){
  productPage=Math.max(1,Math.trunc(Number(page)||1));
  renderProducts();
  const head=$("section-store")?.querySelector(".section-head");
  head?.scrollIntoView({behavior:"smooth",block:"start"});
}
function renderProducts(){
  const search=($("product-search").value||"").trim().toLowerCase();
  const cats=[...new Set(products.map(p=>p.category).filter(Boolean))];
  const select=$("product-category");const current=select.value;
  select.innerHTML='<option value="all">Todas las categorías</option>'+cats.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  select.value=cats.includes(current)?current:"all";
  const cat=select.value;
  const list=products.filter(p=>{
    normalizeProduct(p);
    const hay=[p.name,p.category,p.description].join(" ").toLowerCase();
    return (cat==="all"||p.category===cat)&&(!search||hay.includes(search));
  });

  const totalPages=Math.max(1,Math.ceil(list.length/PRODUCT_PAGE_SIZE));
  productPage=Math.min(Math.max(1,productPage),totalPages);
  const start=(productPage-1)*PRODUCT_PAGE_SIZE;
  const pageItems=list.slice(start,start+PRODUCT_PAGE_SIZE);

  $("product-grid").innerHTML=pageItems.map(p=>{
    const firstImage=p.media.find(m=>m.type==="image");
    const cover=firstImage?`<img class="product-cover" src="${firstImage.src}" alt="${escapeHtml(p.name)}" loading="lazy" decoding="async">`:`<div class="product-icon">${iconFor(p.category)}</div>`;
    return `<a class="product-card product-card-clickable" href="?product=${encodeURIComponent(p.id)}" onclick="if(!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey&&event.button===0){event.preventDefault();openProductDetail(${escapeHtml(JSON.stringify(p.id))})}">
      <div class="product-cover-wrap">${cover}${p.media.some(m=>m.type==="video"||m.type==="social")?'<span class="media-badge">▶ Video</span>':''}</div>
      <div class="product-meta">${escapeHtml(p.category)} · ${p.stock>0?`${p.stock} disponibles`:"Se fabrica a pedido"}</div>
      <h3>${escapeHtml(p.name)}</h3>
      <div class="price">${money(p.price)}</div>
      <div class="product-card-hint">Ver producto · fotos · colores · cantidad →</div>
    </a>`;
  }).join("") || '<div class="card" style="padding:25px">No hay productos que coincidan.</div>';

  renderPagination("product-pagination",{
    page:productPage,
    totalPages,
    totalItems:list.length,
    pageSize:PRODUCT_PAGE_SIZE,
    setter:"setProductPage"
  });
}
function iconFor(cat){return cat==="Veladores"?"◉":cat==="Figuras"?"♟":cat==="Decoración"?"◇":"▣"}
function addToCart(id, qtyOverride=null, colorOverride=null){
  const p=products.find(x=>x.id===id); if(!p||p.active===false)return false;
  const input=$("qty-"+id); const q=Number(qtyOverride ?? input?.value ?? 1);
  if(!Number.isSafeInteger(q)||q<1||q>100){toast("Elegí una cantidad entera entre 1 y 100.");return false;}
  const color=colorOverride ?? (p.colors?.[0]?.name||"");
  const existing=cart.find(x=>x.productId===id && (x.color||"")===color); const next=(Number(existing?.qty)||0)+q;
  if(!Number.isSafeInteger(next)||next>100){toast("El máximo es 100 unidades por variante en el carrito.");return false;}
  if(existing)existing.qty=next;else cart.push({productId:id,qty:q,color});
  write(STORAGE.cart,cart);window.cubicaDelivery?.invalidate("Los productos cambiaron. Calculá nuevamente el envío.");
  if(typeof window.cubicaTrackEvent==="function"){
    try{window.cubicaTrackEvent("add_to_cart",id,{qty:q,color,price:Number(p.price)||0});}catch(error){console.warn("No se pudo registrar la acción del carrito",error);}
  }
  toast("Producto agregado al carrito");renderCart();updateCartBadge();
  return true;
}
function updateCartBadge(){
  const badge=$("cart-badge");
  if(!badge)return;
  const count=cart.reduce((sum,item)=>sum+(Number(item.qty)||0),0);
  badge.textContent=count>99?"99+":String(count);
  badge.classList.toggle("hidden",count<=0);
}
function renderCart(){
  const box=$("cart-items");
  if(!cart.length){box.innerHTML='<div class="muted">Tu carrito está vacío.</div>';$("cart-count").textContent="0";$("cart-total").textContent=money(0);updateCartBadge();return}
  let total=0,count=0;
  box.innerHTML=cart.map(item=>{
    const p=products.find(x=>x.id===item.productId);if(!p)return "";
    total+=p.price*item.qty;count+=item.qty;
    const idArg=escapeHtml(JSON.stringify(p.id)),colorArg=escapeHtml(JSON.stringify(item.color||""));
    return `<div class="cart-row"><div><strong>${escapeHtml(p.name)}</strong><div class="muted">${item.color?`Color: ${escapeHtml(item.color)} · `:""}${money(p.price)} c/u</div></div>
      <input type="number" min="1" max="100" step="1" aria-label="Cantidad de ${escapeHtml(p.name)}" value="${item.qty}" onchange="changeCart(${idArg},this.value,${colorArg})">
      <strong>${money(p.price*item.qty)}</strong><button class="btn ghost" aria-label="Quitar ${escapeHtml(p.name)} del carrito" onclick="removeCart(${idArg},${colorArg})">×</button></div>`;
  }).join("");
  $("cart-count").textContent=count;$("cart-total").textContent=money(total);updateCartBadge();
}
function changeCart(id,q,color=""){const item=cart.find(x=>x.productId===id && (x.color||"")===color);q=Number(q);if(!Number.isSafeInteger(q)||q<1||q>100){toast("Elegí una cantidad entera entre 1 y 100.");renderCart();return;}if(item)item.qty=q;write(STORAGE.cart,cart);window.cubicaDelivery?.invalidate("Los productos cambiaron. Calculá nuevamente el envío.");renderCart();updateCartBadge()}
function removeCart(id,color=""){cart=cart.filter(x=>!(x.productId===id && (x.color||"")===color));write(STORAGE.cart,cart);window.cubicaDelivery?.invalidate("Los productos cambiaron. Calculá nuevamente el envío.");renderCart();updateCartBadge()}

window.addToCart=addToCart;
window.changeCart=changeCart;
window.removeCart=removeCart;
window.setProductPage=setProductPage;

