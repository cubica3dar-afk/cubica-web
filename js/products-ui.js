/* CÚBICA 3D — productos: ficha pública y administración de terminados. */

const FINISHED_PAGE_SIZE=12;
let finishedPage=1;
let finishedSortMode=localStorage.getItem("cubica_finished_sort")||"manual";
let finishedColors=[];
let finishedRecipe=[];
let finishedMedia=[];
let detailProductId=null;
let detailMediaIndex=0;
let detailSelectedColor="";
let detailSelectedColors=[];

function finishedCategories(){
  return [...new Set([...DEFAULT_FINISHED_CATEGORIES, ...products.map(p=>p.category).filter(Boolean)])].sort((a,b)=>a.localeCompare(b,"es"));
}
function normalizeProduct(p){
  p.colors=Array.isArray(p.colors)?p.colors:[];
  p.colorMode=p.colorMode==="multiple"?"multiple":"single";
  p.recipe=Array.isArray(p.recipe)?p.recipe:[];
  p.media=Array.isArray(p.media)?p.media:[];
  p.description=typeof p.description==="string"?p.description:"";
  p.sortOrder=Number(p.sortOrder??p.sort_order)||0;
  return p;
}
function productCapacity(recipe){
  if(!recipe?.length)return {capacity:null,bottlenecks:[]};
  const details=recipe.map(r=>{
    const supply=supplies.find(s=>s.id===r.supplyId);
    const perUnit=Number(r.qty)||0;
    const available=Number(supply?.qty)||0;
    const possible=perUnit>0?Math.floor(available/perUnit):Infinity;
    return {supply,perUnit,available,possible};
  }).filter(x=>x.supply && x.perUnit>0);
  if(!details.length)return {capacity:null,bottlenecks:[]};
  const capacity=Math.min(...details.map(x=>x.possible));
  return {capacity,bottlenecks:details.filter(x=>x.possible===capacity).map(x=>x.supply.name)};
}
function sortedFinishedForView(list,mode=finishedSortMode){
  const copy=[...(list||[])];
  const byText=(a,b)=>String(a||"").localeCompare(String(b||""),"es",{sensitivity:"base"});
  if(mode==="category")return copy.sort((a,b)=>byText(a.category,b.category)||byText(a.name,b.name));
  if(mode==="name")return copy.sort((a,b)=>byText(a.name,b.name));
  if(mode==="stock-desc")return copy.sort((a,b)=>(Number(b.stock)||0)-(Number(a.stock)||0)||byText(a.name,b.name));
  if(mode==="stock-asc")return copy.sort((a,b)=>(Number(a.stock)||0)-(Number(b.stock)||0)||byText(a.name,b.name));
  if(mode==="price-desc")return copy.sort((a,b)=>(Number(b.price)||0)-(Number(a.price)||0)||byText(a.name,b.name));
  if(mode==="price-asc")return copy.sort((a,b)=>(Number(a.price)||0)-(Number(b.price)||0)||byText(a.name,b.name));
  return copy.sort((a,b)=>(Number(a.sortOrder)||0)-(Number(b.sortOrder)||0)||byText(a.name,b.name));
}
function moveFinishedProduct(id,direction){
  if(finishedSortMode!=="manual")return;
  const ordered=sortedFinishedForView(products,"manual");
  const index=ordered.findIndex(x=>String(x.id)===String(id));
  const target=index+(direction<0?-1:1);
  if(index<0||target<0||target>=ordered.length)return;
  [ordered[index],ordered[target]]=[ordered[target],ordered[index]];
  ordered.forEach((item,i)=>item.sortOrder=(i+1)*10);
  write(STORAGE.products,products);
  renderFinishedStock();
}
function setFinishedPage(page){
  finishedPage=Math.max(1,Math.trunc(Number(page)||1));
  renderFinishedStock();
  const toolbar=$("section-stock-finished")?.querySelector(".inventory-toolbar");
  toolbar?.scrollIntoView({behavior:"smooth",block:"start"});
}
function renderFinishedStock(){
  products.forEach(normalizeProduct);
  const search=(($('finished-search')?.value)||'').trim().toLowerCase();

  const filter=$('finished-category-filter');
  if(filter){
    const current=filter.value;
    const cats=finishedCategories();
    filter.innerHTML='<option value="all">Todas las categorías</option>'+cats.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    filter.value=cats.includes(current)?current:'all';
  }
  const cat=filter?.value||'all';

  const sortSelect=$("finished-sort");
  if(sortSelect){
    sortSelect.value=[...sortSelect.options].some(o=>o.value===finishedSortMode)?finishedSortMode:"manual";
    finishedSortMode=sortSelect.value;
  }

  const filtered=products.filter(p=>{
    const hay=[p.name,p.category,p.description].join(' ').toLowerCase();
    return (cat==='all'||p.category===cat)&&(!search||hay.includes(search));
  });
  const ordered=sortedFinishedForView(filtered,finishedSortMode);
  const canManualReorder=finishedSortMode==="manual" && !search && cat==="all";

  const totalPages=Math.max(1,Math.ceil(ordered.length/FINISHED_PAGE_SIZE));
  finishedPage=Math.min(Math.max(1,finishedPage),totalPages);
  const pageStart=(finishedPage-1)*FINISHED_PAGE_SIZE;
  const pageItems=ordered.slice(pageStart,pageStart+FINISHED_PAGE_SIZE);

  const hint=$("finished-sort-hint");
  if(hint){
    hint.textContent=finishedSortMode==="manual"
      ? (canManualReorder?"Usá ↑ y ↓ para definir el orden personalizado. Se guarda en Supabase.":"Quitá la búsqueda y el filtro de categoría para reordenar manualmente.")
      : "Este orden es solo una vista. Elegí “Orden personalizado” para guardar tu propio orden.";
  }

  $('finished-stock-table').innerHTML=`<table><thead><tr><th class="finished-order-col">Orden</th><th>Producto</th><th>Categoría</th><th>Color(es)</th><th>Precio</th><th>Stock</th><th>Capacidad por insumos</th><th>Valor stock</th><th></th></tr></thead><tbody>
  ${pageItems.length?pageItems.map((p,rowIndex)=>{
    const globalIndex=pageStart+rowIndex;
    const cap=productCapacity(p.recipe);
    const colors=p.colors?.length?p.colors.map(c=>`<span class="mini-color" title="${escapeHtml(c.name||'Color')}" style="--mini-color:${escapeHtml(c.hex||'#fff')}"></span>`).join(''):`<span class="muted">—</span>`;
    const capacity=cap.capacity===null?`<span class="muted">Sin receta</span>`:`<span class="${cap.capacity===0?'stock-low':'stock-ok'}">${cap.capacity} u.</span><small class="capacity-note">${cap.bottlenecks.length?`Limita: ${escapeHtml(cap.bottlenecks.join(', '))}`:''}</small>`;
    const mediaCount=p.media?.length||0;
    return `<tr>
      <td class="finished-order-cell">
        ${finishedSortMode==="manual"
          ?`<div class="finished-order-buttons"><button class="btn ghost finished-move" onclick="moveFinishedProduct('${p.id}',-1)" ${!canManualReorder||globalIndex===0?"disabled":""} title="Subir producto">↑</button><button class="btn ghost finished-move" onclick="moveFinishedProduct('${p.id}',1)" ${!canManualReorder||globalIndex===ordered.length-1?"disabled":""} title="Bajar producto">↓</button></div>`
          :`<span class="muted">${globalIndex+1}</span>`}
      </td>
      <td><div class="finished-name-cell">${p.media?.find(m=>m.type==='image')?`<img src="${p.media.find(m=>m.type==='image').src}" alt="">`:''}<div><strong>${escapeHtml(p.name)}</strong><small class="capacity-note">${p.recipe?.length||0} insumo(s) · ${mediaCount} medio(s)</small></div></div></td>
      <td>${escapeHtml(p.category)}</td><td><div class="mini-colors">${colors}</div></td><td><input type="number" min="0" value="${p.price}" onchange="updateProduct('${p.id}','price',this.value)"></td>
      <td><input type="number" min="0" value="${p.stock}" onchange="updateProduct('${p.id}','stock',this.value)"></td><td>${capacity}</td><td>${money(p.price*p.stock)}</td>
      <td class="table-actions"><button class="btn ghost" onclick="editProduct('${p.id}')">Editar</button><button class="btn ghost" onclick="deleteProduct('${p.id}')">Eliminar</button></td>
    </tr>`;
  }).join(''):`<tr><td colspan="9" class="empty-table">No se encontraron productos terminados con esos filtros.</td></tr>`}</tbody></table>`;

  renderPagination("finished-pagination",{
    page:finishedPage,
    totalPages,
    totalItems:ordered.length,
    pageSize:FINISHED_PAGE_SIZE,
    setter:"setFinishedPage"
  });
}
function updateProduct(id,key,val){const p=products.find(x=>x.id===id);if(!p)return;p[key]=key==="price"||key==="stock"?Number(val):val;write(STORAGE.products,products);renderFinishedStock();renderProducts()}
function deleteProduct(id){if(!confirm("¿Eliminar este producto?"))return;products=products.filter(p=>p.id!==id);write(STORAGE.products,products);renderFinishedStock();renderProducts()}
function renderFinishedCategorySelect(selected=""){
  const select=$("finished-category");
  if(!select)return;
  const cats=finishedCategories();
  select.innerHTML=cats.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  select.value=cats.includes(selected)?selected:(cats[0]||"");
}
function renderFinishedColors(){
  const list=$("finished-colors-list"), empty=$("finished-colors-empty");
  list.innerHTML=finishedColors.map((c,i)=>`<div class="color-chip"><span class="color-dot" style="--color-dot:${escapeHtml(c.hex)}"></span><span>${escapeHtml(c.name)}</span><small>${escapeHtml(c.hex)}</small><button type="button" onclick="removeFinishedColor(${i})">×</button></div>`).join("");
  empty.classList.toggle("hidden",finishedColors.length>0);
}
function addFinishedColor(){
  const name=$("finished-color-name").value.trim();
  const hex=$("finished-color-hex").value||"#ffffff";
  if(!name)return toast("Escribí el nombre del color.");
  if(finishedColors.some(c=>c.name.toLowerCase()===name.toLowerCase()))return toast("Ese color ya está agregado.");
  finishedColors.push({name,hex});
  $("finished-color-name").value="";
  renderFinishedColors();
}
function removeFinishedColor(index){finishedColors.splice(index,1);renderFinishedColors()}
function renderFinishedRecipe(){
  const list=$("finished-recipe-list"),empty=$("finished-recipe-empty");
  if(!list||!empty)return;
  list.innerHTML=finishedRecipe.map((r,i)=>{
    const supply=supplies.find(s=>s.id===r.supplyId);
    const max=supply && Number(r.qty)>0?Math.floor((Number(supply.qty)||0)/Number(r.qty)):null;
    const unit=supply?supplyUnitLabel(supply.unit,r.qty):"";
    const options=supplies.map(s=>`<option value="${s.id}" ${String(s.id)===String(r.supplyId)?"selected":""}>${escapeHtml(s.name)} · stock ${Number(s.qty)||0} ${escapeHtml(supplyUnitLabel(s.unit,s.qty))}</option>`).join("");
    return `<div class="recipe-row"><select onchange="updateFinishedRecipe(${i},'supplyId',this.value)"><option value="">Seleccionar insumo...</option>${options}</select><input type="number" min="0.0001" step="0.01" value="${r.qty}" onchange="updateFinishedRecipe(${i},'qty',this.value)" placeholder="Cantidad/u"><span class="recipe-stock">${supply?`Por producto: <strong>${Number(r.qty)||0} ${escapeHtml(unit)}</strong> · Stock: <strong>${Number(supply.qty)||0} ${escapeHtml(supplyUnitLabel(supply.unit,supply.qty))}</strong> · ${max===null?'—':`hasta ${max} u.`}`:"Sin seleccionar"}</span><button type="button" class="btn ghost" onclick="removeFinishedRecipe(${i})">×</button></div>`;
  }).join("");
  empty.classList.toggle("hidden",finishedRecipe.length>0);
  updateFinishedCapacityPreview();
}
function updateFinishedRecipe(index,key,value){
  if(!finishedRecipe[index])return;
  finishedRecipe[index][key]=key==="qty"?Number(value):value;
  renderFinishedRecipe();
}
function removeFinishedRecipe(index){finishedRecipe.splice(index,1);renderFinishedRecipe()}
function addFinishedRecipeRow(){finishedRecipe.push({supplyId:"",qty:1});renderFinishedRecipe()}
function updateFinishedCapacityPreview(){
  const preview=$("finished-capacity-preview");
  if(!preview)return;
  const valid=finishedRecipe.filter(r=>r.supplyId && Number(r.qty)>0);
  if(!valid.length){preview.innerHTML=`<div><strong>Vista previa de producción</strong><span>Agregá los insumos necesarios por unidad para calcular cuántas unidades podés fabricar con el stock actual.</span></div>`;return;}
  const result=productCapacity(valid);
  const extra=result.bottlenecks.length?`<small>El límite actual lo determina: ${escapeHtml(result.bottlenecks.join(', '))}.</small>`:"";
  preview.innerHTML=`<div><strong>Podés fabricar aproximadamente ${result.capacity} unidad${result.capacity===1?'':'es'}</strong><span>Calculado con el stock disponible de cada insumo.</span>${extra}</div><strong class="capacity-number">${result.capacity}</strong>`;
}
async function fileToDataUrl(file, maxImageBytes=5*1024*1024, maxVideoBytes=8*1024*1024){
  const isVideo=file.type.startsWith('video/'); const max=isVideo?maxVideoBytes:maxImageBytes;
  if(file.size>max) throw new Error(`${file.name} supera el límite de ${Math.round(max/1024/1024)} MB.`);
  return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('No se pudo leer el archivo.'));r.readAsDataURL(file);});
}
function socialEmbedInfo(rawUrl){
  let u;
  try{u=new URL(rawUrl);}catch{return null;}
  const host=u.hostname.toLowerCase().replace(/^www\./,"").replace(/^m\./,"");
  const path=u.pathname.replace(/\/+$/,"");

  // YouTube: watch, youtu.be, Shorts y URLs embed.
  if(host==="youtube.com" || host==="youtu.be" || host==="youtube-nocookie.com"){
    let id="";
    if(host==="youtu.be") id=path.split("/").filter(Boolean)[0]||"";
    else if(path==="/watch") id=u.searchParams.get("v")||"";
    else {
      const m=path.match(/^\/(?:shorts|embed)\/([A-Za-z0-9_-]{6,})/);
      if(m) id=m[1];
    }
    if(/^[A-Za-z0-9_-]{6,}$/.test(id)){
      return {
        provider:"youtube",
        label:"YouTube",
        id,
        embedUrl:`https://www.youtube-nocookie.com/embed/${id}?rel=0`
      };
    }
  }

  // Instagram: reels, publicaciones y videos públicos.
  if(host==="instagram.com"){
    const m=path.match(/^\/(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i);
    if(m){
      const kind=m[1].toLowerCase()==="reels"?"reel":m[1].toLowerCase();
      const code=m[2];
      return {
        provider:"instagram",
        label:"Instagram",
        id:code,
        embedUrl:`https://www.instagram.com/${kind}/${code}/embed`
      };
    }
  }

  // TikTok: URL completa /@usuario/video/ID o player/v1/ID.
  if(host==="tiktok.com"){
    let id="";
    const full=path.match(/\/video\/(\d+)/);
    const player=path.match(/^\/player\/v1\/(\d+)/);
    if(full) id=full[1];
    else if(player) id=player[1];
    if(/^\d+$/.test(id)){
      return {
        provider:"tiktok",
        label:"TikTok",
        id,
        embedUrl:`https://www.tiktok.com/player/v1/${id}?controls=1&description=1`
      };
    }
  }

  return null;
}
function socialProviderIcon(provider){
  return provider==="youtube"?"▶":provider==="instagram"?"◎":provider==="tiktok"?"♪":"▶";
}
function videoLikeCount(){
  return finishedMedia.filter(m=>m.type==="video"||m.type==="social").length;
}
function renderFinishedMedia(){
  const box=$('finished-media-preview'); if(!box)return;
  box.innerHTML=finishedMedia.length?finishedMedia.map((m,i)=>{
    const social=m.type==='social'?socialEmbedInfo(m.src):null;
    const sourceLabel=m.type==='social'?(social?.label||m.provider||'Social'):m.source==='url'?'URL externa':m.source==='storage'?'Supabase':'Local';
    let preview='';
    if(m.type==='image'){
      preview=`<img src="${m.src}" alt="" loading="lazy" decoding="async">`;
    }else if(m.type==='social'){
      preview=`<div class="social-admin-preview"><span>${socialProviderIcon(social?.provider||m.provider)}</span><strong>${escapeHtml(social?.label||m.provider||'Video social')}</strong></div>`;
    }else{
      preview=`<video src="${m.src}" muted controls preload="metadata"></video>`;
    }
    const kindLabel=m.type==='image'?'Imagen':m.type==='social'?'Social':'Video';
    return `<div class="media-admin-card">${preview}<div><span>${kindLabel} ${i+1}<small>${escapeHtml(sourceLabel)}</small></span><button type="button" class="btn ghost" onclick="removeFinishedMedia(${i})">×</button></div></div>`;
  }).join(''):'<div class="inline-empty">Todavía no agregaste imágenes ni videos.</div>';
}
async function handleFinishedMediaInput(input,type){
  const files=[...input.files]; if(!files.length)return;
  const maxCount=type==='image'?6:2;
  const existing=type==='image'?finishedMedia.filter(m=>m.type==='image').length:videoLikeCount();
  if(existing+files.length>maxCount){toast(`Podés agregar hasta ${maxCount} ${type==='image'?'imágenes':'videos en total'}.`);input.value='';return;}
  try{
    for(const file of files){
      if(window.CUBICA_CONFIG?.mode==='supabase'){
        if(typeof window.cubicaUploadProductMedia!=='function') throw new Error('La subida a Supabase Storage todavía no está disponible.');
        toast(`Subiendo ${file.name}…`);
        const media=await window.cubicaUploadProductMedia(file,type);
        finishedMedia.push(media);
      }else{
        const src=await fileToDataUrl(file);
        finishedMedia.push({id:uid('m'),type,src,name:file.name,source:'local'});
      }
    }
    renderFinishedMedia();
  }catch(err){
    console.error(err);
    toast(err.message||'No se pudo subir el archivo.');
  }
  input.value='';
}
function addFinishedMediaUrl(){
  const input=$('finished-media-url');
  const selected=$('finished-media-url-type')?.value||'image';
  const value=(input?.value||'').trim();
  if(!value)return toast('Pegá una URL.');

  let parsed;
  try{parsed=new URL(value);}catch{return toast('La URL no es válida.');}
  if(!['http:','https:'].includes(parsed.protocol))return toast('La URL debe comenzar con http:// o https://');

  if(selected==='social'){
    const info=socialEmbedInfo(value);
    if(!info){
      if(/(^|\.)vm\.tiktok\.com$/i.test(parsed.hostname)) return toast('Para TikTok usá el enlace completo que contiene /video/ y su ID.');
      return toast('No pude reconocer ese enlace. Usá YouTube, Instagram Reel/Post o TikTok con URL pública.');
    }
    if(videoLikeCount()>=2)return toast('Podés agregar hasta 2 videos en total.');
    finishedMedia.push({
      id:uid('m'),
      type:'social',
      src:value,
      name:`${info.label} · video social`,
      storagePath:`external/social/${info.provider}/${info.id}`,
      source:'social',
      provider:info.provider
    });
    input.value='';
    renderFinishedMedia();
    toast(`${info.label} agregado al producto.`);
    return;
  }

  const type=selected==='video'?'video':'image';
  const maxCount=type==='image'?6:2;
  const existing=type==='image'?finishedMedia.filter(m=>m.type==='image').length:videoLikeCount();
  if(existing>=maxCount)return toast(`Podés agregar hasta ${maxCount} ${type==='image'?'imágenes':'videos en total'}.`);

  finishedMedia.push({
    id:uid('m'),
    type,
    src:value,
    name:type==='image'?'Imagen por URL':'Video por URL',
    storagePath:`external/${uid('u')}`,
    source:'url'
  });
  input.value='';
  renderFinishedMedia();
  toast(type==='image'?'Imagen por URL agregada.':'Video por URL agregado.');
}
function removeFinishedMedia(index){finishedMedia.splice(index,1);renderFinishedMedia()}
function openProductDetail(id){
  const p=products.find(x=>x.id===id);if(!p)return;
  normalizeProduct(p);detailProductId=id;detailMediaIndex=0;detailSelectedColor=p.colors?.[0]?.name||'';detailSelectedColors=p.colors?.length?[p.colors[0].name]:[];
  renderProductDetail();openModal('product-detail-modal');
  if(typeof window.cubicaTrackEvent==="function")window.cubicaTrackEvent("product_view",id,{name:p.name,category:p.category});
}
function renderProductDetail(){
  const p=products.find(x=>x.id===detailProductId);if(!p)return;normalizeProduct(p);
  const media=p.media?.length?p.media:[{type:'placeholder'}]; if(detailMediaIndex>=media.length)detailMediaIndex=0; const m=media[detailMediaIndex];
  const social=m.type==='social'?socialEmbedInfo(m.src):null;
  const viewer=m.type==='image'
    ?`<img src="${m.src}" alt="${escapeHtml(p.name)}" decoding="async">`
    :m.type==='video'
      ?`<video src="${m.src}" controls playsinline preload="metadata"></video>`
      :m.type==='social'&&social
        ?`<iframe class="social-embed social-${social.provider}" src="${escapeHtml(social.embedUrl)}" title="${escapeHtml(social.label)} — ${escapeHtml(p.name)}" loading="lazy" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`
        :`<div class="product-detail-placeholder">${iconFor(p.category)}</div>`;
  const thumbs=media.map((x,i)=>{
    const sx=x.type==='social'?socialEmbedInfo(x.src):null;
    const content=x.type==='image'
      ?`<img src="${x.src}" alt="" loading="lazy" decoding="async">`
      :x.type==='social'
        ?`<span class="social-thumb" title="${escapeHtml(sx?.label||'Video social')}">${socialProviderIcon(sx?.provider||x.provider)}</span>`
        :`<span>▶</span>`;
    return `<button class="detail-thumb ${i===detailMediaIndex?'active':''}" onclick="setProductMedia(${i})">${content}</button>`;
  }).join('');
  let colors='';
  if(p.colors?.length){
    if(p.colorMode==='multiple'){
      colors=`<div class="detail-colors"><strong>Colores (podés elegir más de uno)</strong><div>${p.colors.map(c=>`<button class="detail-color ${detailSelectedColors.includes(c.name)?'selected':''}" onclick="toggleProductColor('${escapeHtml(c.name)}')"><span style="--color-dot:${escapeHtml(c.hex||'#fff')}"></span>${escapeHtml(c.name)}</button>`).join('')}</div><small class="muted">Seleccionados: ${escapeHtml(detailSelectedColors.join(' + ')||'ninguno')}</small></div>`;
    } else {
      colors=`<div class="detail-colors"><strong>Color</strong><div>${p.colors.map(c=>`<button class="detail-color ${detailSelectedColor===c.name?'selected':''}" onclick="selectProductColor('${escapeHtml(c.name)}')"><span style="--color-dot:${escapeHtml(c.hex||'#fff')}"></span>${escapeHtml(c.name)}</button>`).join('')}</div></div>`;
    }
  }
  $('product-detail-content').innerHTML=`<div class="product-detail-grid"><div><div class="detail-viewer">${viewer}${media.length>1?`<button class="detail-arrow left" onclick="changeProductMedia(-1)">‹</button><button class="detail-arrow right" onclick="changeProductMedia(1)">›</button>`:''}</div><div class="detail-thumbs">${thumbs}</div></div><div class="product-detail-info"><p class="eyebrow">${escapeHtml(p.category)}</p><h2>${escapeHtml(p.name)}</h2><div class="detail-price">${money(p.price)}</div><div class="detail-stock">${p.stock>0?`${p.stock} disponibles para entrega inmediata · También podés pedir más unidades`:'Se fabrica a pedido'}</div><div class="detail-description">${escapeHtml(p.description||'Producto de Cúbica. Consultanos si necesitás más información.').replace(/\n/g,'<br>')}</div>${colors}<div class="detail-buy"><label>Cantidad<input id="detail-qty" type="number" min="1" value="1"></label><button class="btn primary" onclick="addDetailToCart()">Agregar al carrito</button></div></div></div>`;
}
function setProductMedia(i){detailMediaIndex=i;renderProductDetail()}
function changeProductMedia(delta){const p=products.find(x=>x.id===detailProductId);const len=p?.media?.length||1;detailMediaIndex=(detailMediaIndex+delta+len)%len;renderProductDetail()}
function selectProductColor(color){detailSelectedColor=color;detailSelectedColors=[color];renderProductDetail()}
function toggleProductColor(color){if(detailSelectedColors.includes(color))detailSelectedColors=detailSelectedColors.filter(c=>c!==color);else detailSelectedColors.push(color);detailSelectedColor=detailSelectedColors[0]||'';renderProductDetail()}
function addDetailToCart(){const p=products.find(x=>x.id===detailProductId);const q=Math.max(1,Number($('detail-qty').value)||1);let color=p.colorMode==='multiple'?detailSelectedColors.join(' + '):detailSelectedColor;if(p.colors?.length && !color)return toast('Elegí al menos un color.');addToCart(p.id,q,color);closeModal('product-detail-modal')}

function resetFinishedProductForm(){
  $("finished-id").value="";$("finished-modal-title").textContent="Nuevo producto terminado";$("finished-submit").textContent="Agregar producto";
  $("finished-form").reset();renderFinishedCategorySelect("Figuras");
  finishedColors=[];finishedRecipe=[];finishedMedia=[];$("finished-multi-color").checked=false;renderFinishedColors();renderFinishedRecipe();renderFinishedMedia();
}
function editProduct(id){
  const p=products.find(x=>x.id===id);if(!p)return;normalizeProduct(p);
  $("finished-id").value=p.id;$("finished-modal-title").textContent="Editar producto terminado";$("finished-submit").textContent="Guardar cambios";
  $("finished-name").value=p.name;$("finished-price").value=p.price;$("finished-qty").value=p.stock;$("finished-description").value=p.description||"";
  renderFinishedCategorySelect(p.category);finishedColors=p.colors.map(c=>({...c}));$("finished-multi-color").checked=p.colorMode==="multiple";finishedRecipe=p.recipe.map(r=>({...r}));finishedMedia=p.media.map(m=>({...m}));
  renderFinishedColors();renderFinishedRecipe();renderFinishedMedia();openModal("finished-modal");
}
function saveFinishedProduct(e){
  e.preventDefault();
  const name=$("finished-name").value.trim(),category=$("finished-category").value,price=Number($("finished-price").value),stock=Number($("finished-qty").value),description=$("finished-description").value.trim(),colorMode=$("finished-multi-color").checked?"multiple":"single";
  if(!name)return toast("El producto necesita un nombre.");
  const recipe=finishedRecipe.filter(r=>r.supplyId && Number(r.qty)>0).map(r=>({supplyId:r.supplyId,qty:Number(r.qty)}));
  const id=$("finished-id").value;
  if(id){
    const p=products.find(x=>x.id===id);if(!p)return;Object.assign(p,{name,category,price,stock,description,colorMode,colors:finishedColors.map(c=>({...c})),recipe,media:finishedMedia.map(m=>({...m}))});toast("Producto actualizado");
  }else{
    products.push({id:uid("p"),name,category,price,stock,description,colorMode,colors:finishedColors.map(c=>({...c})),recipe,media:finishedMedia.map(m=>({...m})),sortOrder:Math.max(0,...products.map(x=>Number(x.sortOrder)||0))+10});toast("Producto agregado");
  }
  write(STORAGE.products,products);e.target.reset();closeModal("finished-modal");renderFinishedStock();renderProducts();
}

window.updateProduct=updateProduct;
window.deleteProduct=deleteProduct;
window.editProduct=editProduct;
window.removeFinishedColor=removeFinishedColor;
window.updateFinishedRecipe=updateFinishedRecipe;
window.removeFinishedRecipe=removeFinishedRecipe;
window.setFinishedPage=setFinishedPage;
window.moveFinishedProduct=moveFinishedProduct;
window.openProductDetail=openProductDetail;
window.setProductMedia=setProductMedia;
window.changeProductMedia=changeProductMedia;
window.selectProductColor=selectProductColor;
window.toggleProductColor=toggleProductColor;
