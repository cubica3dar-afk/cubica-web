/* Full-page checkout: tab-scoped drafts, verified account ownership and shared cart. */
(function(){
  const draftKey="cubica_checkout_draft_v1";
  const authReturnKey="cubica_checkout_auth_destination";
  const fields=["customer-name","customer-last-name","customer-email","customer-phone","payment-method","customer-notes"];
  const get=id=>document.getElementById(id);
  const owner=()=>session?.supabaseUserId||"guest";
  const blocked=()=>window.cubicaAuthCallbackBlocked||window.cubicaPasswordRecoveryActive||new URLSearchParams(location.hash.slice(1)).get("type")==="recovery";
  const isCheckout=()=>!get("section-checkout")?.classList.contains("hidden");
  let identity=owner(),generation=0,restoring=false,navigatingHistory=false,active=false,loadedOwner=null,resolveUi;
  let checkoutAuthReturn=false,authVerificationObserved=false;
  try{
    const destination=new URLSearchParams(location.search);
    checkoutAuthReturn=sessionStorage.getItem(authReturnKey)==="checkout"&&!destination.has("product")&&!["cart","orders","reset"].includes(destination.get("view"));
  }catch{/* The same-page return still works without browser storage. */}
  const uiReady=new Promise(resolve=>{if(document.readyState!=="loading")resolve();else resolveUi=resolve;});
  window.cubicaCheckoutAuthReady=window.CUBICA_CONFIG?.mode!=="supabase";

  function rememberAuthReturn(value){
    checkoutAuthReturn=value;
    try{if(value)sessionStorage.setItem(authReturnKey,"checkout");else sessionStorage.removeItem(authReturnKey);}catch{/* Keep the destination in memory for email sign-in. */}
  }

  function safeDraft(){
    try{const raw=sessionStorage.getItem(draftKey);if(!raw)return null;const d=JSON.parse(raw);return d.version===1&&d.owner===owner()&&Date.now()-Number(d.saved_at)<24*60*60*1000?d:null;}catch{return null;}
  }
  function saveDraft(){
    if(restoring||!active||loadedOwner!==owner()||!window.cubicaCheckoutAuthReady||blocked())return;
    const buyer=Object.fromEntries(fields.map(id=>[id,String(get(id)?.value||"").slice(0,id==="customer-notes"?1500:180)]));
    try{sessionStorage.setItem(draftKey,JSON.stringify({version:1,owner:owner(),saved_at:Date.now(),buyer,buyer_edited:Object.fromEntries(fields.map(id=>[id,get(id)?.dataset.checkoutEdited==="true"])),delivery:window.cubicaDelivery?.exportDraft?.()}));}catch{/* The current form still works when browser storage is disabled. */}
  }
  function clearPersonal(){
    generation++;loadedOwner=null;
    for(const id of fields){const node=get(id);if(!node)continue;node.value=id==="payment-method"?"Efectivo":"";delete node.dataset.checkoutEdited;}
    window.cubicaBuyerProfile?.clear?.();
    window.cubicaDelivery?.reset?.();
  }
  function restoreDraft(){
    if(!window.cubicaCheckoutAuthReady||loadedOwner===owner())return;
    restoring=true;
    try{
      const d=safeDraft();
      if(d){
        for(const id of fields){const node=get(id);if(!node||!Object.hasOwn(d.buyer||{},id))continue;node.value=String(d.buyer[id]);if(d.buyer_edited?.[id])node.dataset.checkoutEdited="true";else delete node.dataset.checkoutEdited;}
        window.cubicaDelivery?.restoreDraft?.(d.delivery||{});
      }else sessionStorage.removeItem(draftKey);
      loadedOwner=owner();
    }finally{restoring=false;}
  }
  function validCart(){
    if(!cart?.length)return {valid:false,message:"Tu carrito está vacío. Elegí productos para continuar."};
    if(window.CUBICA_CONFIG?.mode==="supabase"&&window.cubicaCatalogState!=="ready")return {valid:false,message:window.cubicaCatalogState==="error"?"No pudimos comprobar los productos. Reintentá cuando vuelva la conexión.":"Estamos comprobando los productos de tu carrito…"};
    for(const item of cart){
      const p=products.find(p=>String(p.id)===String(item.productId)&&p.active!==false);
      if(!p||window.cubicaCatalogEmpty)return {valid:false,message:"Un producto del carrito ya no está disponible. Volvé al carrito para revisarlo."};
      if(!Number.isSafeInteger(Number(item.qty))||Number(item.qty)<1||Number(item.qty)>100)return {valid:false,message:"Revisá las cantidades del carrito antes de continuar."};
    }
    return {valid:true,message:""};
  }
  function renderSummary(){
    const box=get("checkout-summary-items");if(!box)return;
    const state=validCart();
    box.innerHTML=cart.map(item=>{
      const p=products.find(p=>String(p.id)===String(item.productId)),picture=p?.media?.find(m=>m.type==="image")?.src;
      return `<article class="checkout-summary-item">${picture?`<img class="checkout-summary-image" src="${escapeHtml(picture)}" alt="" loading="lazy">`:`<span class="checkout-summary-image" aria-hidden="true">◇</span>`}<div class="checkout-summary-item-body"><strong>${escapeHtml(p?.name||"Producto no disponible")}</strong><small>${escapeHtml(item.color||"")}${item.color?" · ":""}${Number(item.qty)} unidad${Number(item.qty)===1?"":"es"}</small></div><strong class="checkout-summary-item-price">${p?money(Number(p.price)*Number(item.qty)):"—"}</strong></article>`;
    }).join("")||'<p class="muted">Todavía no hay productos.</p>';
    const message=get("checkout-summary-message");if(message)message.textContent=state.message;
    const button=get("checkout-confirm-btn");if(button&&!button.dataset.submitting)button.disabled=!state.valid||(document.querySelector('input[name="delivery-mode"]:checked')?.value==="shipping"&&!window.cubicaDelivery?.hasValidQuote?.());
    window.cubicaDelivery?.refreshTotal?.();
  }
  async function fillCheckout(){
    if(!window.cubicaCheckoutAuthReady||blocked())return;
    const current=owner(),revision=++generation;
    if(resolveUi)await uiReady;
    if(current!==owner()||revision!==generation)return;
    restoreDraft();
    await window.cubicaBuyerProfile?.load?.();
    if(current!==owner()||revision!==generation)return;
    await window.cubicaBuyerProfile?.autofillCheckout?.();
    if(current!==owner()||revision!==generation)return;
    await window.cubicaDelivery?.refreshCheckout?.();
    if(current!==owner()||revision!==generation)return;
    renderSummary();saveDraft();
  }
  function checkoutUrl(section){
    const url=new URL(location.href);if(section!=="product")url.searchParams.delete("product");
    if(section==="checkout"||section==="cart")url.searchParams.set("view",section);
    else if(url.searchParams.get("view")==="checkout"||url.searchParams.get("view")==="cart")url.searchParams.delete("view");
    return url;
  }
  window.cubicaCheckoutNavigation=section=>{
    if(blocked())return;
    const wasActive=active;
    if(wasActive&&section!=="checkout")saveDraft();
    if(section==="login"&&(wasActive||checkoutAuthReturn))rememberAuthReturn(true);
    else if(section!=="store"||!resolveUi)rememberAuthReturn(false);
    active=section==="checkout";
    if(!navigatingHistory&&(section==="checkout"||wasActive)){
      const url=checkoutUrl(section);
      if(url.href!==location.href)history.pushState({cubicaView:section},"",url.href);
    }
    if(section==="checkout"){get("welcome-view")?.classList.add("hidden");renderSummary();fillCheckout();}
  };
  window.cubicaOpenCheckoutLink=()=>{
    if(blocked())return false;
    const requestedView=new URLSearchParams(location.search).get("view");
    const returningFromAuth=checkoutAuthReturn&&window.cubicaCheckoutAuthReady&&!!session?.supabaseUserId&&(!requestedView||requestedView==="checkout")&&!new URLSearchParams(location.search).has("product");
    const view=returningFromAuth?"checkout":requestedView;if(!["checkout","cart"].includes(view))return false;
    if(returningFromAuth&&requestedView!=="checkout")history.replaceState({cubicaView:"checkout"},"",checkoutUrl("checkout").href);
    if((view==="checkout"&&active||view==="cart"&&!active)&&get("section-"+view)&&!get("section-"+view).classList.contains("hidden"))return true;
    get("welcome-view")?.classList.add("hidden");navigatingHistory=true;
    try{showSection(view);}finally{navigatingHistory=false;}
    return true;
  };
  window.cubicaStartCheckout=()=>{
    if(blocked())return;
    if(!cart.length){showSection("cart");toast("El carrito está vacío.");return;}
    if(!active&&typeof window.cubicaTrackEvent==="function")window.cubicaTrackEvent("checkout_started",null,{items:cart.reduce((sum,i)=>sum+Number(i.qty||0),0)});
    showSection("checkout");get("checkout-page-title")?.focus({preventScroll:true});window.scrollTo({top:0,behavior:"smooth"});
  };
  window.cubicaCheckoutBuyerName=()=>[get("customer-name")?.value.trim(),get("customer-last-name")?.value.trim()].filter(Boolean).join(" ");
  window.cubicaValidateCheckout=()=>{
    const state=validCart();if(!state.valid)throw new Error(state.message);
    if(!get("customer-name")?.value.trim()||!get("customer-last-name")?.value.trim())throw new Error("Completá nombre y apellido del comprador.");
    if(window.cubicaCheckoutBuyerName().length>120)throw new Error("El nombre completo del comprador no debe superar 120 caracteres.");
  };
  window.cubicaCheckoutComplete=()=>{
    restoring=true;
    try{
      generation++;sessionStorage.removeItem(draftKey);loadedOwner=null;
      for(const id of fields){const node=get(id);if(node)delete node.dataset.checkoutEdited;}
      showSection(session?"orders":"cart");
    }finally{restoring=false;}
  };
  window.cubicaCheckout={saveDraft,restoreDraft,renderSummary,fillCheckout,validCart,clearPersonal};
  const previousRedirect=window.cubicaAuthRedirectUrl;
  window.cubicaAuthRedirectUrl=()=>{
    const url=new URL(previousRedirect?previousRedirect():location.origin+location.pathname);
    if(checkoutAuthReturn||active||new URLSearchParams(location.search).get("view")==="checkout"){url.searchParams.delete("product");url.searchParams.set("view","checkout");}
    return url.href;
  };
  const previousNavigate=window.cubicaNavigateAfterSignIn;
  window.cubicaNavigateAfterSignIn=()=>{
    if(blocked())return;
    if(checkoutAuthReturn||active||new URLSearchParams(location.search).get("view")==="checkout"){
      if(!window.cubicaOpenCheckoutLink())showSection("checkout");
      return;
    }
    previousNavigate?.();
  };
  window.addEventListener("popstate",()=>{
    if(blocked())return;
    if(window.cubicaOpenCheckoutLink())return;
    if(active&&!new URLSearchParams(location.search).has("product")&&new URLSearchParams(location.search).get("view")!=="orders"){
      navigatingHistory=true;try{showSection("store");}finally{navigatingHistory=false;}
    }
  });
  window.addEventListener("cubica:checkout-draft-change",()=>{saveDraft();renderSummary();});
  window.addEventListener("cubica:buyer-details",()=>{if(isCheckout()){renderSummary();saveDraft();}});
  window.addEventListener("cubica:auth-ready",()=>{
    window.cubicaCheckoutAuthReady=true;
    const next=owner();
    const verifiedDraft=!authVerificationObserved&&next!=="guest"?safeDraft():null;
    authVerificationObserved=true;
    if(next!==identity){restoring=true;try{if(!verifiedDraft)sessionStorage.removeItem(draftKey);clearPersonal();}finally{restoring=false;}}
    identity=next;
    if(!blocked()&&active)fillCheckout();
  });
  for(const event of ["cubica:catalog-ready","cubica:catalog-error"])window.addEventListener(event,()=>{if(isCheckout())renderSummary();});
  document.addEventListener("DOMContentLoaded",()=>{
    const total=get("delivery-checkout-total"),host=get("checkout-delivery-total-host");if(total&&host)host.appendChild(total);
    for(const id of fields){const input=get(id);if(!input)continue;for(const event of ["input","change"])input.addEventListener(event,()=>{input.dataset.checkoutEdited="true";saveDraft();renderSummary();});}
    get("checkout-back-cart")?.addEventListener("click",()=>{saveDraft();showSection("cart");});
    get("checkout-summary-cart")?.addEventListener("click",()=>{saveDraft();showSection("cart");});
    if(window.cubicaCheckoutAuthReady)restoreDraft();
    renderSummary();
    if(resolveUi){const resolve=resolveUi;resolveUi=null;resolve();}
  });
})();

