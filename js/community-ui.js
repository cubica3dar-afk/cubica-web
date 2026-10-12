/* Community v1: safe RPC projections, desired-state reactions and bounded pagination. */
(function(){
  let productId=null,data=null,generation=0,busy=false,replyTo=null,editing=null;
  let moderationCursor=null,moderationGeneration=0,performanceGeneration=0,performanceRows=[];
  const pendingKey="cubica_auth_product";
  let linkProduct=new URLSearchParams(location.search).get("product")||sessionStorage.getItem(pendingKey);
  const html=escapeHtml;
  const count=n=>new Intl.NumberFormat("es-AR").format(Number(n)||0);
  const percent=n=>n===null||n===undefined?"—":new Intl.NumberFormat("es-AR",{maximumFractionDigits:1}).format(Number(n))+" %";
  const previousRedirect=window.cubicaAuthRedirectUrl;
  window.cubicaAuthRedirectUrl=()=>{
    const url=new URL(previousRedirect?previousRedirect():location.origin+location.pathname);
    if(linkProduct&&url.searchParams.get("view")!=="orders")url.searchParams.set("product",linkProduct);
    return url.href;
  };
  window.cubicaOpenProductLink=()=>{
    if(!linkProduct||window.cubicaPasswordRecoveryActive||new URLSearchParams(location.hash.slice(1)).get("type")==="recovery"||new URLSearchParams(location.search).get("view")==="orders"||sessionStorage.getItem("cubica_auth_destination")==="orders")return false;
    if(!products.some(p=>p.id===linkProduct))return false;
    if(sessionStorage.getItem(pendingKey)&&!session)return false;
    $("welcome-view")?.classList.add("hidden");
    const id=linkProduct;linkProduct=null;sessionStorage.removeItem(pendingKey);
    showSection("store");openProductDetail(id);return true;
  };
  const previousNavigate=window.cubicaNavigateAfterSignIn;
  window.cubicaNavigateAfterSignIn=()=>{if(!window.cubicaOpenProductLink())previousNavigate();};

  function authenticated(){
    if(session?.supabaseUserId)return true;
    linkProduct=productId;sessionStorage.setItem(pendingKey,productId);
    closeModal("product-detail-modal");$("welcome-view")?.classList.add("hidden");showSection("login");
    window.dispatchEvent(new CustomEvent("cubica:auth-request"));
    toast("Iniciá sesión para participar. Después volverás a este producto.");return false;
  }
  async function rpc(name,args){
    const client=window.cubicaSupabase;if(!client)throw new Error("La comunidad no está disponible en este momento.");
    const result=await client.rpc(name,args);if(result.error)throw result.error;return result.data;
  }
  function commentHtml(c){
    return `<article class="community-comment" data-comment-id="${c.id}"><div class="community-author">${c.author?.avatar?`<img src="${html(c.author.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:""}<strong>${html(c.deleted?"Comentario eliminado":c.author?.name||"Cliente de Cúbica")}</strong>${c.verified_purchase?'<span class="community-verified">✓ Compra verificada</span>':""}</div>
      <small class="muted">${html(formatDate(c.created_at))}${c.edited_at?" · editado":""}</small>
      <p class="community-body">${html(c.deleted?"El contenido de este comentario fue eliminado.":c.body)}</p>
      ${c.deleted?"":`<div class="community-actions"><button class="btn ghost ${c.my_like?"selected":""}" data-community-action="comment-like" data-id="${c.id}" aria-pressed="${!!c.my_like}">👍 ${count(c.likes)}</button>${c.parent_id===null?`<button class="btn ghost" data-community-action="reply" data-id="${c.id}">Responder</button>`:""}${c.is_owner?`${c.can_edit?`<button class="btn ghost" data-community-action="edit" data-id="${c.id}">Editar</button>`:""}<button class="btn ghost" data-community-action="delete" data-id="${c.id}">Eliminar</button>`:""}</div>`}
      ${c.parent_id===null&&c.reply_count?`<button class="community-replies-toggle btn ghost" data-community-action="replies" data-id="${c.id}">Ver respuestas (${count(c.reply_count)})</button><div class="community-replies" data-replies="${c.id}"></div>`:""}</article>`;
  }
  function render(){
    const host=$("product-community");if(!host||!data)return;
    const draft=$("community-body")?.value||"",oldReply=replyTo,oldEdit=editing;
    host.innerHTML=`<div class="community-heading"><h3>Comunidad</h3><span>👍 ${count(data.product_likes)}</span></div>
      <div class="community-actions"><button class="btn ghost ${data.my_reaction===1?"selected":""}" data-community-action="product-like" aria-pressed="${data.my_reaction===1}">👍 Me gusta</button><button class="btn ghost ${data.my_reaction===-1?"selected":""}" data-community-action="product-dislike" aria-pressed="${data.my_reaction===-1}">👎 No me gusta</button></div>
      <h3>Opiniones</h3><div id="community-comments">${data.comments.map(commentHtml).join("")||'<p class="muted">Todavía no hay opiniones. Podés compartir la tuya.</p>'}</div>
      ${data.has_more?'<button class="btn ghost" data-community-action="more">Ver más opiniones</button>':""}
      ${session?.supabaseUserId?'<form id="community-form"><label id="community-compose-label" for="community-body">Escribir una opinión</label><textarea id="community-body" maxlength="2000" rows="3" required placeholder="Compartí tu opinión sobre este producto…"></textarea><div class="community-actions"><button class="btn primary" type="submit">Publicar opinión</button><button class="btn ghost hidden" type="button" id="community-compose-cancel">Cancelar</button></div></form>':'<p class="muted">Iniciá sesión para compartir tu opinión.</p><button class="btn primary" data-community-action="login">Iniciar sesión para opinar</button>'}<p id="community-message" role="status" aria-live="polite"></p>`;
    host.onclick=action;
    if($("community-form"))$("community-form").onsubmit=submit;
    if($("community-compose-cancel"))$("community-compose-cancel").onclick=resetComposer;
    replyTo=oldReply;editing=oldEdit;if($("community-body"))$("community-body").value=draft;
    if(replyTo||editing){$("community-compose-label").textContent=editing?"Editar opinión":"Responder al comentario";$("community-compose-cancel").classList.remove("hidden");}
  }
  function resetComposer(){replyTo=null;editing=null;$("community-form").reset();$("community-compose-label").textContent="Escribir una opinión";$("community-compose-cancel").classList.add("hidden");}
  function findComment(id){return data.comments.find(c=>String(c.id)===String(id))||Array.from($("product-community").querySelectorAll("[data-replies]")).flatMap(el=>el._comments||[]).find(c=>String(c.id)===String(id));}
  async function load(id){
    const version=++generation;productId=id;data=null;replyTo=null;editing=null;
    $("product-community").innerHTML='<p class="muted" role="status">Cargando comunidad…</p>';
    try{const result=await rpc("get_product_community",{p_product_id:id});if(version!==generation)return;data=result;render();}
    catch(error){if(version===generation)$("product-community").textContent=error.message||"No se pudo cargar la comunidad.";}
  }
  function lock(value){busy=value;for(const button of $("product-community").querySelectorAll("button,textarea"))button.disabled=value;}
  async function action(event){
    const button=event.target.closest("[data-community-action]");if(!button||busy||!data)return;
    const kind=button.dataset.communityAction,id=button.dataset.id,comment=findComment(id);
    if(!["more","replies"].includes(kind)&&!authenticated())return;
    if(kind==="reply"||kind==="edit"){
      replyTo=kind==="reply"?Number(id):null;editing=kind==="edit"?Number(id):null;
      $("community-compose-label").textContent=editing?"Editar opinión":"Responder al comentario";
      $("community-body").value=editing?comment.body:"";$("community-compose-cancel").classList.remove("hidden");$("community-body").focus();return;
    }
    if(kind==="delete"&&!confirm("¿Eliminar el contenido de este comentario? Si tiene respuestas, se conservará el hilo."))return;
    const version=generation;lock(true);
    try{
      if(kind.startsWith("product-")){
        const value=kind==="product-like"?1:-1;
        const result=await rpc("set_product_reaction",{p_product_id:productId,p_reaction:data.my_reaction===value?0:value});
        if(version!==generation)return;Object.assign(data,result);render();
      }else if(kind==="comment-like"){
        const result=await rpc("set_comment_like",{p_comment_id:Number(id),p_liked:!comment.my_like});if(version!==generation)return;Object.assign(comment,result);
        button.textContent=`👍 ${count(comment.likes)}`;button.classList.toggle("selected",comment.my_like);button.setAttribute("aria-pressed",String(comment.my_like));
      }else if(kind==="delete"){
        await rpc("delete_community_comment",{p_comment_id:Number(id)});if(version!==generation)return;await load(productId);
      }else if(kind==="more"){
        const result=await rpc("get_product_community",{p_product_id:productId,p_before_id:data.next_cursor});if(version!==generation)return;
        data.comments.push(...result.comments);data.has_more=result.has_more;data.next_cursor=result.next_cursor;render();
      }else if(kind==="replies"){
        const container=$("product-community").querySelector(`[data-replies="${id}"]`);
        const result=await rpc("get_product_community",{p_product_id:productId,p_parent_id:Number(id),p_before_id:container._cursor||null});if(version!==generation)return;
        container._comments=[...(container._comments||[]),...result.comments];container._cursor=result.next_cursor;
        container.innerHTML=container._comments.map(commentHtml).join("");button.classList.toggle("hidden",!result.has_more);button.textContent="Ver más respuestas";
      }
    }catch(error){if(version===generation)$("community-message").textContent=error.message||"No se pudo guardar.";}
    finally{lock(false);}
  }
  async function submit(event){
    event.preventDefault();if(busy||!authenticated())return;
    const body=$("community-body").value.trim();if(!body)return;
    const version=generation;const id=productId;lock(true);
    const form=event.currentTarget;
    // Retain request id on retry; change it only when the submitted body/parent changes.
    const signature=JSON.stringify([id,replyTo,body]);
    if(form.dataset.signature!==signature){form.dataset.signature=signature;form.dataset.requestId=crypto.randomUUID();}
    try{
      if(editing)await rpc("edit_community_comment",{p_comment_id:editing,p_body:body});
      else await rpc("create_community_comment",{p_product_id:id,p_body:body,p_parent_id:replyTo,p_request_id:form.dataset.requestId});
      if(version!==generation)return;const wasEditing=!!editing;await load(id);toast(wasEditing?"Opinión actualizada.":"Comentario publicado.");
    }catch(error){if(version===generation)$("community-message").textContent=error.message||"No se pudo publicar.";}
    finally{lock(false);}
  }
  window.addEventListener("cubica:product-open",event=>load(event.detail.productId));
  window.addEventListener("cubica:auth-ready",()=>{
    if(productId&&!$("product-detail-modal").classList.contains("hidden"))load(productId);
    if(session?.role!=="admin"){$("community-moderation-list").textContent="";$("product-performance-table").textContent="";performanceRows=[];moderationGeneration++;performanceGeneration++;}
  });

  window.loadCommunityModeration=async more=>{
    if(session?.role!=="admin")return;
    const version=++moderationGeneration;
    try{
      const result=await rpc("get_community_moderation",{p_before_id:more?moderationCursor:null});if(version!==moderationGeneration||session?.role!=="admin")return;
      moderationCursor=result.next_cursor;
      const markup=result.comments.map(c=>`<article class="community-moderation-card"><strong>${html(c.product_name)} · ${html(c.author.name)}</strong><p class="muted">${html(formatDate(c.created_at))} · ${c.parent_id?"Respuesta":"Opinión"} · ${c.status==="hidden"?"Oculto":"Publicado"}${c.deleted_at?" · Eliminado":""}</p><p class="community-body">${html(c.body)}</p><button class="btn ghost" data-moderate-id="${c.id}" data-moderate-status="${c.status==="published"?"hidden":"published"}">${c.status==="published"?"Ocultar":"Restaurar visibilidad"}</button></article>`).join("");
      const host=$("community-moderation-list");if(more)host.insertAdjacentHTML("beforeend",markup);else host.innerHTML=markup||"<p>Sin comentarios.</p>";
      $("community-moderation-more").classList.toggle("hidden",!result.has_more);
    }catch(error){toast(error.message||"No se pudo cargar la moderación.");}
  };
  window.loadProductPerformance=async()=>{
    if(session?.role!=="admin")return;
    const version=++performanceGeneration;$("product-performance-status").textContent="Cargando…";
    try{
      const days=$("product-performance-period").value;
      const result=await rpc("get_product_performance",{p_days:days==="all"?null:Number(days)});if(version!==performanceGeneration||session?.role!=="admin")return;
      performanceRows=result.products;renderPerformance();$("product-performance-status").textContent="";
    }catch(error){if(version===performanceGeneration)$("product-performance-status").textContent=error.message||"No se pudo cargar el rendimiento.";}
  };
  function renderPerformance(){
    if(session?.role!=="admin")return;
    const metric=$("product-performance-sort").value;
    const rows=[...performanceRows].sort((a,b)=>metric==="name"?a.name.localeCompare(b.name):(Number(b[metric])||0)-(Number(a[metric])||0));
    $("product-performance-table").innerHTML=`<table><thead><tr>${["Producto","Vistas","Sesiones","👍","👎 Interno","Comentarios","Carritos","Pedidos","Unidades","Facturación","Vista → carrito","Vista → pedido","Positivas"].map(s=>`<th>${s}</th>`).join("")}</tr></thead><tbody>${rows.map(p=>`<tr><td><strong>${html(p.name)}</strong>${p.active?"":'<small class="muted">Inactivo</small>'}</td>${[p.views,p.view_sessions,p.likes,p.dislikes,p.comments,p.carts,p.orders,p.units].map(n=>`<td>${count(n)}</td>`).join("")}<td>${money(p.revenue)}</td><td>${percent(p.view_to_cart)}</td><td>${percent(p.view_to_order)}</td><td>${percent(p.positive_ratio)}</td></tr>`).join("")||'<tr><td colspan="13">Sin productos.</td></tr>'}</tbody></table>`;
  }
  document.addEventListener("DOMContentLoaded",()=>{
    $("community-moderation-more").onclick=()=>window.loadCommunityModeration(true);
    $("community-moderation-list").onclick=async event=>{
      const button=event.target.closest("[data-moderate-id]");if(!button||session?.role!=="admin")return;
      button.disabled=true;try{await rpc("moderate_community_comment",{p_comment_id:Number(button.dataset.moderateId),p_status:button.dataset.moderateStatus});await window.loadCommunityModeration(false);}catch(error){toast(error.message);}finally{button.disabled=false;}
    };
    $("product-performance-period").onchange=window.loadProductPerformance;
    $("product-performance-sort").onchange=renderPerformance;
  });
})();
