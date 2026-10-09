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
    return `<article class="product-card product-card-clickable" onclick="openProductDetail('${p.id}')">
      <div class="product-cover-wrap">${cover}${p.media.some(m=>m.type==="video"||m.type==="social")?'<span class="media-badge">▶ Video</span>':''}</div>
      <div class="product-meta">${escapeHtml(p.category)} · ${p.stock>0?`${p.stock} disponibles`:"Se fabrica a pedido"}</div>
      <h3>${escapeHtml(p.name)}</h3>
      <div class="price">${money(p.price)}</div>
      <div class="product-card-hint">Ver producto · fotos · colores · cantidad →</div>
    </article>`;
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
  const p=products.find(x=>x.id===id); if(!p)return;
  const input=$("qty-"+id); const q=Math.max(1,Number(qtyOverride ?? input?.value)||1);
  const color=colorOverride ?? (p.colors?.[0]?.name||"");
  const existing=cart.find(x=>x.productId===id && (x.color||"")===color); const next=(existing?.qty||0)+q;
  if(existing)existing.qty=next;else cart.push({productId:id,qty:q,color});
  write(STORAGE.cart,cart);
  if(typeof window.cubicaTrackEvent==="function")window.cubicaTrackEvent("add_to_cart",id,{qty:q,color,price:Number(p.price)||0});
  toast("Producto agregado al carrito");renderCart();updateCartBadge();
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
    return `<div class="cart-row"><div><strong>${escapeHtml(p.name)}</strong><div class="muted">${item.color?`Color: ${escapeHtml(item.color)} · `:""}${money(p.price)} c/u</div></div>
      <input type="number" min="1" value="${item.qty}" onchange="changeCart('${p.id}',this.value,'${escapeHtml(item.color||"")}')">
      <strong>${money(p.price*item.qty)}</strong><button class="btn ghost" onclick="removeCart('${p.id}','${escapeHtml(item.color||"")}')">×</button></div>`;
  }).join("");
  $("cart-count").textContent=count;$("cart-total").textContent=money(total);updateCartBadge();
}
function changeCart(id,q,color=""){const item=cart.find(x=>x.productId===id && (x.color||"")===color),p=products.find(x=>x.id===id);q=Math.max(1,Number(q)||1);if(item)item.qty=q;write(STORAGE.cart,cart);renderCart();updateCartBadge()}
function removeCart(id,color=""){cart=cart.filter(x=>!(x.productId===id && (x.color||"")===color));write(STORAGE.cart,cart);renderCart();updateCartBadge()}

window.addToCart=addToCart;
window.changeCart=changeCart;
window.removeCart=removeCart;
window.setProductPage=setProductPage;
