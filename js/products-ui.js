/* CÚBICA 3D — productos: ficha pública y administración de terminados. */

let finishedPageSize=[10,25,50].includes(Number(localStorage.getItem("cubica_finished_page_size")))?Number(localStorage.getItem("cubica_finished_page_size")):10;
let finishedPage=1;
let finishedSortMode=localStorage.getItem("cubica_finished_sort")||"manual";
let finishedColors=[];
let finishedRecipe=[];
let finishedMedia=[];
let detailProductId=null;
let detailMediaIndex=0;
let detailSelectedColor="";
let detailSelectedColors=[];
let detailQuantity=1;
let detailPageActive=false;
let detailPurchaseBusy=false;
let detailPurchaseVersion=0;
let detailHistoryNavigation=false;

function finishedCategoryRows(){
  const rows=(Array.isArray(productCategories)?productCategories:[]).map((category,index)=>({
    name:String(category?.name??category??"").trim(),
    sortOrder:Number(category?.sortOrder??category?.sort_order)||((index+1)*10),
    active:category?.active!==false
  })).filter(category=>category.name);
  const known=new Set(rows.map(category=>category.name.toLocaleLowerCase("es")));
  for(const name of products.map(product=>String(product.category||"").trim()).filter(Boolean)){
    if(known.has(name.toLocaleLowerCase("es")))continue;
    rows.push({name,sortOrder:(rows.length+1)*10,active:false,legacy:true});
    known.add(name.toLocaleLowerCase("es"));
  }
  return rows.sort((a,b)=>a.sortOrder-b.sortOrder||a.name.localeCompare(b.name,"es",{sensitivity:"base"}));
}
function finishedCategories({activeOnly=false}={}){
  return finishedCategoryRows().filter(category=>!activeOnly||category.active).map(category=>category.name);
}
function normalizeProduct(p){
  p.colors=Array.isArray(p.colors)?p.colors:[];
  p.colorMode=p.colorMode==="multiple"?"multiple":"single";
  p.recipe=Array.isArray(p.recipe)?p.recipe:[];
  p.media=Array.isArray(p.media)?p.media:[];
  p.description=typeof p.description==="string"?p.description:"";
  p.sortOrder=Number(p.sortOrder??p.sort_order)||0;
  p.active=p.active!==false;
  p.published=p.published!==false;
  p.createdAt=p.createdAt||p.created_at||"";
  p.updatedAt=p.updatedAt||p.updated_at||"";
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
  const stable=(a,b)=>byText(a.id,b.id);
  if(mode==="category")return copy.sort((a,b)=>byText(a.category,b.category)||byText(a.name,b.name)||stable(a,b));
  if(mode==="name")return copy.sort((a,b)=>byText(a.name,b.name)||stable(a,b));
  if(mode==="name-desc")return copy.sort((a,b)=>byText(b.name,a.name)||stable(a,b));
  if(mode==="stock-desc")return copy.sort((a,b)=>(Number(b.stock)||0)-(Number(a.stock)||0)||byText(a.name,b.name)||stable(a,b));
  if(mode==="stock-asc")return copy.sort((a,b)=>(Number(a.stock)||0)-(Number(b.stock)||0)||byText(a.name,b.name)||stable(a,b));
  if(mode==="price-desc")return copy.sort((a,b)=>(Number(b.price)||0)-(Number(a.price)||0)||byText(a.name,b.name)||stable(a,b));
  if(mode==="price-asc")return copy.sort((a,b)=>(Number(a.price)||0)-(Number(b.price)||0)||byText(a.name,b.name)||stable(a,b));
  if(mode==="date-desc")return copy.sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||""))||stable(a,b));
  if(mode==="date-asc")return copy.sort((a,b)=>String(a.createdAt||"").localeCompare(String(b.createdAt||""))||stable(a,b));
  return copy.sort((a,b)=>(Number(a.sortOrder)||0)-(Number(b.sortOrder)||0)||byText(a.name,b.name)||stable(a,b));
}
function setFinishedPageSize(size){const next=Number(size);if(![10,25,50].includes(next))return;finishedPageSize=next;finishedPage=1;localStorage.setItem("cubica_finished_page_size",String(next));renderFinishedStock();}
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
  const publication=$('finished-publication-filter')?.value||'all';
  const activeState=$('finished-active-filter')?.value||'all';

  const sortSelect=$("finished-sort");
  if(sortSelect){
    sortSelect.value=[...sortSelect.options].some(o=>o.value===finishedSortMode)?finishedSortMode:"manual";
    finishedSortMode=sortSelect.value;
  }

  const filtered=products.filter(p=>{
    const hay=[p.name,p.category,p.description].join(' ').toLowerCase();
    const publicationMatch=publication==='all'||(publication==='published'?p.published===true:p.published!==true);
    const activeMatch=activeState==='all'||(activeState==='active'?p.active!==false:p.active===false);
    return (cat==='all'||p.category===cat)&&publicationMatch&&activeMatch&&(!search||hay.includes(search));
  });
  const ordered=sortedFinishedForView(filtered,finishedSortMode);
  const canManualReorder=finishedSortMode==="manual" && !search && cat==="all"&&publication==="all"&&activeState==="all";

  const totalPages=Math.max(1,Math.ceil(ordered.length/finishedPageSize));
  finishedPage=Math.min(Math.max(1,finishedPage),totalPages);
  const pageStart=(finishedPage-1)*finishedPageSize;
  const pageItems=ordered.slice(pageStart,pageStart+finishedPageSize);

  const hint=$("finished-sort-hint");
  if(hint){
    hint.textContent=finishedSortMode==="manual"
      ? (canManualReorder?"Usá ↑ y ↓ para definir el orden personalizado. Se guarda en Supabase.":"Quitá la búsqueda y el filtro de categoría para reordenar manualmente.")
      : "Este orden es solo una vista. Elegí “Orden personalizado” para guardar tu propio orden.";
  }

  $('finished-stock-table').innerHTML=`<table><thead><tr><th class="finished-order-col">Orden</th><th>Producto</th><th>Estado</th><th>Categoría</th><th>Color(es)</th><th>Precio</th><th>Stock</th><th>Capacidad por insumos</th><th>Valor stock</th><th></th></tr></thead><tbody>
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
      <td><div class="status-stack"><span class="status-pill ${p.published?'is-published':'is-hidden'}">${p.published?'Publicado':'Oculto'}</span><span class="status-pill ${p.active?'is-active':'is-inactive'}">${p.active?'Activo':'Inactivo'}</span></div></td>
      <td>${escapeHtml(p.category)}</td><td><div class="mini-colors">${colors}</div></td><td><input type="number" min="0" value="${p.price}" onchange="updateProduct('${p.id}','price',this.value)"></td>
      <td><input type="number" min="0" value="${p.stock}" onchange="updateProduct('${p.id}','stock',this.value)"></td><td>${capacity}</td><td>${money(p.price*p.stock)}</td>
      <td class="table-actions"><button class="btn ghost" onclick="toggleProductPublication('${p.id}')">${p.published?'Ocultar':'Publicar'}</button><button class="btn ghost" onclick="editProduct('${p.id}')">Editar</button><button class="btn ghost" onclick="deleteProduct('${p.id}')">Eliminar</button></td>
    </tr>`;
  }).join(''):`<tr><td colspan="10" class="empty-table">No se encontraron productos terminados con esos filtros.</td></tr>`}</tbody></table>`;

  renderPagination("finished-pagination",{
    page:finishedPage,
    totalPages,
    totalItems:ordered.length,
    pageSize:finishedPageSize,
    setter:"setFinishedPage",
    pageSizeSetter:"setFinishedPageSize"
  });
}
function toggleProductPublication(id){const p=products.find(x=>x.id===id);if(!p)return;p.published=!p.published;write(STORAGE.products,products);renderFinishedStock();renderProducts();toast(p.published?"Producto publicado":"Producto ocultado");}
function updateProduct(id,key,val){const p=products.find(x=>x.id===id);if(!p)return;p[key]=key==="price"||key==="stock"?Number(val):val;write(STORAGE.products,products);renderFinishedStock();renderProducts()}
function deleteProduct(id){if(!confirm("¿Eliminar este producto?"))return;products=products.filter(p=>p.id!==id);write(STORAGE.products,products);renderFinishedStock();renderProducts()}
function renderFinishedCategorySelect(selected="",{allowInactiveSelected=false}={}){
  const select=$("finished-category");
  if(!select)return;
  const cats=finishedCategories({activeOnly:true});
  const selectedRow=finishedCategoryRows().find(category=>category.name===selected);
  if(allowInactiveSelected&&selectedRow&&!selectedRow.active&&!cats.includes(selected))cats.push(selected);
  select.innerHTML=cats.length
    ?cats.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}${!finishedCategoryRows().find(category=>category.name===c)?.active?" (inactiva · categoría actual)":""}</option>`).join("")
    :'<option value="">No hay categorías activas</option>';
  select.value=cats.includes(selected)?selected:(cats[0]||"");
  select.disabled=cats.length===0;
  const warning=$("finished-category-warning");
  if(warning){
    warning.textContent=cats.length?"":"Creá o activá una categoría antes de guardar el producto.";
    warning.classList.toggle("hidden",cats.length>0);
  }
}
function finishedCategoryAssignmentAllowed(category,productId=""){
  const row=finishedCategoryRows().find(item=>item.name===category);
  const original=productId?products.find(product=>product.id===productId):null;
  return Boolean(category&&(row?.active===true||(original&&original.category===category)));
}
function renderFinishedCategoryManager(){
  const list=$("finished-category-list");if(!list)return;
  const rows=finishedCategoryRows();
  list.innerHTML=rows.map((category,index)=>{
    const encoded=encodeURIComponent(category.name),count=products.filter(product=>product.category===category.name).length;
    return `<div class="finished-category-row ${category.active?"":"is-inactive"}">
      <input id="finished-category-name-${index}" value="${escapeHtml(category.name)}" maxlength="40" aria-label="Nombre de la categoría ${escapeHtml(category.name)}">
      <button class="btn secondary" type="button" onclick="renameFinishedCategory('${encoded}',${index})">Renombrar</button>
      <button class="btn ghost" type="button" onclick="toggleFinishedCategory('${encoded}',${category.active?"false":"true"})">${category.active?"Desactivar":"Activar"}</button>
      <button class="btn danger finished-category-delete" type="button" onclick="openFinishedCategoryDelete('${encoded}')">Eliminar</button>
      <span class="finished-category-meta">${count} producto${count===1?"":"s"} · ${category.active?"Disponible para asignar":"No disponible para productos nuevos"}</span>
    </div>`;
  }).join("")||'<div class="inline-empty">Todavía no hay categorías.</div>';
}
function normalizedFinishedCategoryName(value){return String(value||"").trim().replace(/\s+/g," ");}
async function manageFinishedCategory(action,name,{newName=null,active=null}={}){
  if(session?.role!=="admin"||window.cubicaAdminMfaAccessAllowed?.()!==true)return toast("Verificá tu segundo factor para administrar categorías.");
  const cleanName=normalizedFinishedCategoryName(name),cleanNew=newName===null?null:normalizedFinishedCategoryName(newName);
  if(!cleanName||(cleanNew!==null&&!cleanNew))return toast("La categoría necesita un nombre.");
  if((cleanNew||cleanName).length>40)return toast("El nombre puede tener hasta 40 caracteres.");
  try{
    if(typeof window.cubicaManageProductCategory==="function"){
      await window.cubicaManageProductCategory(action,cleanName,{newName:cleanNew,active});
    }else if(action==="create"){
      if(finishedCategoryRows().some(category=>category.name.toLocaleLowerCase("es")===cleanName.toLocaleLowerCase("es")))throw new Error("Esa categoría ya existe.");
      productCategories.push({name:cleanName,sortOrder:(productCategories.length+1)*10,active:true});
    }else if(action==="rename"){
      const row=productCategories.find(category=>category.name===cleanName);if(row)row.name=cleanNew;
      products.forEach(product=>{if(product.category===cleanName)product.category=cleanNew;});
    }else if(action==="set_active"){
      const row=productCategories.find(category=>category.name===cleanName);if(row)row.active=active===true;
    }else if(action==="delete"){
      const associated=products.filter(product=>product.category===cleanName);
      if(associated.length){
        const target=finishedCategoryRows().find(category=>category.name===cleanNew&&category.active&&category.name!==cleanName);
        if(!target)throw new Error("Seleccioná una categoría de destino activa.");
        associated.forEach(product=>product.category=target.name);
      }
      productCategories=productCategories.filter(category=>category.name!==cleanName);
    }
    writeLocal(STORAGE.productCategories,productCategories);
    renderFinishedCategoryManager();renderFinishedStock();renderFinishedCategorySelect();renderProducts();
    toast(action==="create"?"Categoría creada.":action==="rename"?"Categoría renombrada.":action==="delete"?"Categoría eliminada.":active?"Categoría activada.":"Categoría desactivada.");
  }catch(error){console.error("Categorías de terminados",error);toast(error.message||"No se pudo actualizar la categoría.");}
}
async function createFinishedCategory(name){return manageFinishedCategory("create",name);}
async function renameFinishedCategory(encoded,index){const current=decodeURIComponent(encoded),next=$("finished-category-name-"+index)?.value||"";if(normalizedFinishedCategoryName(next)===current)return toast("El nombre no cambió.");return manageFinishedCategory("rename",current,{newName:next});}
async function toggleFinishedCategory(encoded,active){return manageFinishedCategory("set_active",decodeURIComponent(encoded),{active:active===true});}
let finishedCategoryDeleteState=null;
async function openFinishedCategoryDelete(encoded){
  if(session?.role!=="admin"||window.cubicaAdminMfaAccessAllowed?.()!==true)return toast("Verificá tu segundo factor para administrar categorías.");
  const name=decodeURIComponent(encoded);
  try{
    const preview=typeof window.cubicaPreviewProductCategoryDelete==="function"
      ?await window.cubicaPreviewProductCategoryDelete(name)
      :{name,product_count:products.filter(product=>product.category===name).length};
    const count=Number(preview?.product_count)||0;
    finishedCategoryDeleteState={name:preview?.name||name,count};
    $("finished-category-delete-name").textContent=finishedCategoryDeleteState.name;
    $("finished-category-delete-count").textContent=String(count);
    $("finished-category-delete-confirm").textContent=count>0?"Reasignar y eliminar":"Eliminar categoría";
    const explanation=$("finished-category-delete-explanation"),destinationWrap=$("finished-category-delete-destination-wrap"),destination=$("finished-category-delete-destination");
    if(count===0){
      explanation.textContent=`La categoría “${finishedCategoryDeleteState.name}” no tiene productos asociados. Confirmá para eliminarla.`;
      destinationWrap.classList.add("hidden");
      destination.innerHTML="";
    }else{
      explanation.textContent=`Esta categoría tiene ${count} producto${count===1?"":"s"} asociado${count===1?"":"s"}. Para eliminarla, primero seleccioná la categoría a la que querés trasladarlo${count===1?"":"s"}.`;
      const targets=finishedCategoryRows().filter(category=>category.active&&category.name!==finishedCategoryDeleteState.name);
      destination.innerHTML='<option value="">Seleccionar categoría de destino…</option>'+targets.map(category=>`<option value="${escapeHtml(category.name)}">${escapeHtml(category.name)}</option>`).join("");
      destinationWrap.classList.remove("hidden");
      if(!targets.length)explanation.textContent+=" Primero creá o activá otra categoría de destino.";
    }
    openModal("finished-category-delete-modal");
  }catch(error){console.error("Vista previa de eliminación",error);toast(error.message||"No se pudo comprobar la categoría.");}
}
async function confirmFinishedCategoryDelete(){
  if(!finishedCategoryDeleteState)return;
  const {name,count}=finishedCategoryDeleteState;
  const target=count>0?$("finished-category-delete-destination").value:null;
  if(count>0&&!target)return toast("Seleccioná una categoría de destino activa.");
  const button=$("finished-category-delete-confirm");if(button)button.disabled=true;
  try{
    await manageFinishedCategory("delete",name,{newName:target});
    finishedCategoryDeleteState=null;
    closeModal("finished-category-delete-modal");
  }finally{if(button)button.disabled=false;}
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
    return `<div class="recipe-row"><select onchange="updateFinishedRecipe(${i},'supplyId',this.value)"><option value="">Seleccionar insumo...</option>${options}</select><input type="number" min="0.0001" step="0.0001" value="${r.qty}" onchange="updateFinishedRecipe(${i},'qty',this.value)" placeholder="Cantidad/u"><span class="recipe-stock">${supply?`Por producto: <strong>${Number(r.qty)||0} ${escapeHtml(unit)}</strong> · Stock: <strong>${Number(supply.qty)||0} ${escapeHtml(supplyUnitLabel(supply.unit,supply.qty))}</strong> · ${max===null?'—':`hasta ${max} u.`}`:"Sin seleccionar"}</span><button type="button" class="btn ghost" onclick="removeFinishedRecipe(${i})">×</button></div>`;
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
function productUrl(id){
  const url=new URL(location.href);
  url.searchParams.delete("view");
  if(id)url.searchParams.set("product",id);else url.searchParams.delete("product");
  return url;
}
function recoveryOwnsNavigation(){
  return window.cubicaAuthCallbackBlocked||window.cubicaPasswordRecoveryActive||new URLSearchParams(location.hash.slice(1)).get("type")==="recovery";
}
function productPageState(kind){
  const messages={loading:["Cargando producto…","Estamos buscando los detalles de este producto."],error:["No pudimos cargar el producto","Revisá tu conexión y volvé a intentar."],missing:["Producto no encontrado","Este producto ya no está disponible. Podés encontrar otras opciones en el catálogo."]};
  const [title,message]=messages[kind];
  $("product-detail-content").innerHTML=`<div class="product-page-state" role="${kind==="loading"?"status":"alert"}"><h1 tabindex="-1">${title}</h1><p class="muted">${message}</p>${kind==="error"?'<button class="btn secondary" type="button" onclick="location.reload()">Reintentar</button>':""}</div>`;
  $("product-community")?.classList.add("hidden");
}
function openProductDetail(id,options={}){
  if(recoveryOwnsNavigation())return false;
  const p=window.cubicaCatalogEmpty?null:products.find(x=>String(x.id)===String(id)&&x.active!==false&&x.published!==false);
  const waitingForServer=window.CUBICA_CONFIG?.mode==='supabase'&&window.cubicaCatalogState!=='ready';
  const repeated=detailPageActive&&String(detailProductId)===String(id)&&!!p&&!waitingForServer;
  detailPageActive=true;
  $("welcome-view")?.classList.add("hidden");
  if(options.history!=="none"){
    const url=productUrl(id);
    if(url.href!==location.href)window.history.pushState({cubicaView:"product"},"",url.href);
  }
  detailProductId=id;
  showSection("product");
  if(!p||waitingForServer){
    productPageState(window.cubicaCatalogState==="error"?"error":window.cubicaCatalogState==="ready"?"missing":"loading");
    return true;
  }
  if(repeated)return true;
  normalizeProduct(p);detailProductId=p.id;detailMediaIndex=0;detailQuantity=1;detailPurchaseBusy=false;detailPurchaseVersion++;
  detailSelectedColor=p.colors?.[0]?.name||'';detailSelectedColors=p.colors?.length?[p.colors[0].name]:[];
  renderProductDetail();$("product-community")?.classList.remove("hidden");
  window.dispatchEvent(new CustomEvent("cubica:product-open",{detail:{productId:p.id}}));
  if(typeof window.cubicaTrackEvent==="function")window.cubicaTrackEvent("product_view",p.id,{name:p.name,category:p.category});
  $("product-detail-content")?.querySelector("h1")?.focus({preventScroll:true});
  $("section-product")?.scrollIntoView({block:"start"});
  return true;
}
function renderProductDetail(){
  const p=products.find(x=>x.id===detailProductId);if(!p)return;normalizeProduct(p);
  const media=p.media?.length?p.media:[{type:'placeholder'}]; if(detailMediaIndex>=media.length)detailMediaIndex=0; const m=media[detailMediaIndex];
  const social=m.type==='social'?socialEmbedInfo(m.src):null;
  const viewer=m.type==='image'
    ?`<img src="${escapeHtml(m.src)}" alt="${escapeHtml(p.name)}" decoding="async">`
    :m.type==='video'
      ?`<video src="${escapeHtml(m.src)}" controls playsinline preload="metadata"></video>`
      :m.type==='social'&&social
        ?`<iframe class="social-embed social-${social.provider}" src="${escapeHtml(social.embedUrl)}" title="${escapeHtml(social.label)} — ${escapeHtml(p.name)}" loading="lazy" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`
        :`<div class="product-detail-placeholder">${iconFor(p.category)}</div>`;
  const thumbs=media.map((x,i)=>{
    const sx=x.type==='social'?socialEmbedInfo(x.src):null;
    const content=x.type==='image'
      ?`<img src="${escapeHtml(x.src)}" alt="" loading="lazy" decoding="async">`
      :x.type==='social'
        ?`<span class="social-thumb" title="${escapeHtml(sx?.label||'Video social')}">${socialProviderIcon(sx?.provider||x.provider)}</span>`
        :`<span>▶</span>`;
    return `<button id="detail-media-${i}" type="button" class="detail-thumb ${i===detailMediaIndex?'active':''}" aria-label="Ver ${x.type==='image'?'imagen':'video'} ${i+1}" aria-pressed="${i===detailMediaIndex}" onclick="setProductMedia(${i})">${content}</button>`;
  }).join('');
  let colors='';
  if(p.colors?.length){
    if(p.colorMode==='multiple'){
      colors=`<div class="detail-colors"><strong>Colores (podés elegir más de uno)</strong><div>${p.colors.map((c,i)=>`<button id="detail-color-${i}" type="button" class="detail-color ${detailSelectedColors.includes(c.name)?'selected':''}" aria-pressed="${detailSelectedColors.includes(c.name)}" onclick="toggleProductColor(${escapeHtml(JSON.stringify(c.name))})"><span style="--color-dot:${escapeHtml(c.hex||'#fff')}"></span>${escapeHtml(c.name)}</button>`).join('')}</div><small class="muted">Seleccionados: ${escapeHtml(detailSelectedColors.join(' + ')||'ninguno')}</small></div>`;
    } else {
      colors=`<div class="detail-colors"><strong>Color</strong><div>${p.colors.map((c,i)=>`<button id="detail-color-${i}" type="button" class="detail-color ${detailSelectedColor===c.name?'selected':''}" aria-pressed="${detailSelectedColor===c.name}" onclick="selectProductColor(${escapeHtml(JSON.stringify(c.name))})"><span style="--color-dot:${escapeHtml(c.hex||'#fff')}"></span>${escapeHtml(c.name)}</button>`).join('')}</div></div>`;
    }
  }
  $('product-detail-content').innerHTML=`<div class="product-detail-grid"><div class="product-page-gallery"><div class="detail-viewer">${viewer}${media.length>1?`<button type="button" class="detail-arrow left" aria-label="Medio anterior" onclick="changeProductMedia(-1)">‹</button><button type="button" class="detail-arrow right" aria-label="Medio siguiente" onclick="changeProductMedia(1)">›</button>`:''}</div><div class="detail-thumbs" aria-label="Galería del producto">${thumbs}</div></div><div class="product-detail-info"><p class="eyebrow">${escapeHtml(p.category)}</p><h1 tabindex="-1">${escapeHtml(p.name)}</h1><div class="detail-price">${money(p.price)}</div><div class="detail-stock">${p.stock>0?'Disponible para entrega inmediata · También se fabrica a pedido':'Se fabrica a pedido'}</div><div class="detail-description">${escapeHtml(p.description||'Producto de Cúbica. Consultanos si necesitás más información.').replace(/\n/g,'<br>')}</div>${colors}<div class="detail-buy"><label for="detail-qty">Cantidad<input id="detail-qty" type="number" min="1" max="100" step="1" inputmode="numeric" value="${escapeHtml(detailQuantity)}" oninput="setProductQuantity(this.value)"></label><div class="product-purchase-actions"><button id="product-buy-now" class="btn primary" type="button" onclick="buyProductNow()" ${detailPurchaseBusy?'disabled':''}>Comprar ahora</button><button id="product-add-cart" class="btn secondary" type="button" onclick="addDetailToCart()" ${detailPurchaseBusy?'disabled':''}>Agregar al carrito</button></div></div><p id="product-purchase-feedback" role="status" aria-live="polite"></p></div></div>`;
}
function setProductMedia(i){detailMediaIndex=i;renderProductDetail();$("detail-media-"+detailMediaIndex)?.focus({preventScroll:true});}
function changeProductMedia(delta){const p=products.find(x=>x.id===detailProductId);const len=p?.media?.length||1;setProductMedia((detailMediaIndex+delta+len)%len);}
function setProductQuantity(value){detailQuantity=value;}
function selectProductColor(color){const p=products.find(x=>x.id===detailProductId);if(!p?.colors.some(c=>c.name===color))return;detailSelectedColor=color;detailSelectedColors=[color];renderProductDetail();$("detail-color-"+p.colors.findIndex(c=>c.name===color))?.focus({preventScroll:true});}
function toggleProductColor(color){const p=products.find(x=>x.id===detailProductId);if(!p?.colors.some(c=>c.name===color))return;if(detailSelectedColors.includes(color))detailSelectedColors=detailSelectedColors.filter(c=>c!==color);else detailSelectedColors.push(color);detailSelectedColor=detailSelectedColors[0]||'';renderProductDetail();$("detail-color-"+p.colors.findIndex(c=>c.name===color))?.focus({preventScroll:true});}
function addDetailToCart(checkout=false){
  if(detailPurchaseBusy||recoveryOwnsNavigation())return false;
  const p=products.find(x=>x.id===detailProductId&&x.active!==false&&x.published!==false);if(!p)return false;
  const feedback=$("product-purchase-feedback"),q=Number($("detail-qty")?.value??detailQuantity);
  const selected=p.colorMode==='multiple'?detailSelectedColors:[detailSelectedColor];
  let error=!Number.isSafeInteger(q)||q<1||q>100?'Elegí una cantidad entera entre 1 y 100.':null;
  if(p.colors?.length&&(!selected.length||selected.some(name=>!p.colors.some(c=>c.name===name))))error='Elegí al menos un color disponible.';
  if(error){if(feedback)feedback.textContent=error;toast(error);return false;}
  detailPurchaseBusy=true;const version=++detailPurchaseVersion;
  for(const id of ['product-buy-now','product-add-cart'])if($(id))$(id).disabled=true;
  const added=addToCart(p.id,q,p.colors?.length?selected.join(' + '):'');
  if(added&&feedback)feedback.textContent=`${q===1?'Producto agregado':`${q} unidades agregadas`} al carrito.`;
  if(!added&&feedback)feedback.textContent='Revisá el carrito: el máximo es 100 unidades por variante.';
  if(added&&checkout){showSection('cart');$("checkout-btn")?.click();}
  // A single burst of taps represents one purchase action and one analytics event.
  setTimeout(()=>{if(version!==detailPurchaseVersion)return;detailPurchaseBusy=false;for(const id of ['product-buy-now','product-add-cart'])if($(id))$(id).disabled=false;},650);
  return added;
}
function buyProductNow(){return addDetailToCart(true);}
function backToProductCatalog(){showSection('store');$("section-store")?.scrollIntoView({block:"start"});}
window.cubicaProductNavigation=section=>{
  if(section==='product')return;
  const wasActive=detailPageActive;detailPageActive=false;
  if(section==='login'&&sessionStorage.getItem('cubica_auth_product'))return;
  if(wasActive&&!detailHistoryNavigation&&new URLSearchParams(location.search).has('product'))window.history.pushState({cubicaView:section},'',productUrl(null).href);
};
window.cubicaProductPageActive=()=>detailPageActive;
window.addEventListener('popstate',event=>{
  if(recoveryOwnsNavigation())return;

  const params=new URLSearchParams(location.search),id=params.get('product');
  detailHistoryNavigation=true;
  try{
    if(['checkout','cart'].includes(params.get('view'))){detailPageActive=false;window.cubicaOpenCheckoutLink?.();return;}
    if(params.get('view')==='orders'){detailPageActive=false;window.cubicaOpenOrdersLink?.();return;}
    if(id){detailPageActive=false;openProductDetail(id,{history:'none'});}
    else if(event?.state?.cubicaView&&['store','cart','orders','profile','delivery','budget','analytics','community','stock-finished','stock-supplies','login'].includes(event.state.cubicaView)){showSection(event.state.cubicaView);}
    else if(detailPageActive){showSection('store');}
  }finally{detailHistoryNavigation=false;}
});
window.addEventListener('cubica:catalog-ready',()=>{
  if(!detailPageActive)return;const id=detailProductId;
  // A pending route has no details until the server catalog finishes loading.
  if(!$("product-detail-content")?.querySelector('.product-detail-grid'))detailPageActive=false;
  openProductDetail(id,{history:'none'});
});
window.addEventListener('cubica:catalog-error',()=>{if(detailPageActive)productPageState('error');});

function resetFinishedProductForm(){
  $("finished-id").value="";$("finished-modal-title").textContent="Nuevo producto terminado";$("finished-submit").textContent="Agregar producto";
  $("finished-form").reset();renderFinishedCategorySelect();
  finishedColors=[];finishedRecipe=[];finishedMedia=[];$("finished-multi-color").checked=false;$("finished-active").checked=true;$("finished-published").checked=false;renderFinishedColors();renderFinishedRecipe();renderFinishedMedia();
}
function editProduct(id){
  const p=products.find(x=>x.id===id);if(!p)return;normalizeProduct(p);
  $("finished-id").value=p.id;$("finished-modal-title").textContent="Editar producto terminado";$("finished-submit").textContent="Guardar cambios";
  $("finished-name").value=p.name;$("finished-price").value=p.price;$("finished-qty").value=p.stock;$("finished-description").value=p.description||"";
  $("finished-active").checked=p.active!==false;$("finished-published").checked=p.published===true;
  renderFinishedCategorySelect(p.category,{allowInactiveSelected:true});finishedColors=p.colors.map(c=>({...c}));$("finished-multi-color").checked=p.colorMode==="multiple";finishedRecipe=p.recipe.map(r=>({...r}));finishedMedia=p.media.map(m=>({...m}));
  renderFinishedColors();renderFinishedRecipe();renderFinishedMedia();openModal("finished-modal");
}
function saveFinishedProduct(e){
  e.preventDefault();
  const name=$("finished-name").value.trim(),category=$("finished-category").value,price=Number($("finished-price").value),stock=Number($("finished-qty").value),description=$("finished-description").value.trim(),colorMode=$("finished-multi-color").checked?"multiple":"single",active=$("finished-active").checked,published=$("finished-published").checked;
  if(!name)return toast("El producto necesita un nombre.");
  const recipe=finishedRecipe.filter(r=>r.supplyId && Number(r.qty)>0).map(r=>({supplyId:r.supplyId,qty:Number(r.qty)}));
  const id=$("finished-id").value;
  if(!finishedCategoryAssignmentAllowed(category,id))return toast(id?"Elegí una categoría activa o conservá la categoría histórica del producto.":"Creá o activá una categoría antes de guardar el producto.");
  if(id){
    const p=products.find(x=>x.id===id);if(!p)return;Object.assign(p,{name,category,price,stock,description,colorMode,active,published,colors:finishedColors.map(c=>({...c})),recipe,media:finishedMedia.map(m=>({...m}))});toast("Producto actualizado");
  }else{
    products.push({id:uid("p"),name,category,price,stock,description,colorMode,active,published,colors:finishedColors.map(c=>({...c})),recipe,media:finishedMedia.map(m=>({...m})),sortOrder:Math.max(0,...products.map(x=>Number(x.sortOrder)||0))+10,createdAt:new Date().toISOString()});toast(published?"Producto agregado y publicado":"Producto agregado como oculto");
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
window.setFinishedPageSize=setFinishedPageSize;
window.toggleProductPublication=toggleProductPublication;
window.moveFinishedProduct=moveFinishedProduct;
window.createFinishedCategory=createFinishedCategory;
window.renameFinishedCategory=renameFinishedCategory;
window.toggleFinishedCategory=toggleFinishedCategory;
window.openFinishedCategoryDelete=openFinishedCategoryDelete;
window.confirmFinishedCategoryDelete=confirmFinishedCategoryDelete;
window.renderFinishedCategoryManager=renderFinishedCategoryManager;
window.openProductDetail=openProductDetail;
window.setProductMedia=setProductMedia;
window.changeProductMedia=changeProductMedia;
window.selectProductColor=selectProductColor;
window.toggleProductColor=toggleProductColor;
window.setProductQuantity=setProductQuantity;
window.addDetailToCart=addDetailToCart;
window.buyProductNow=buyProductNow;
window.backToProductCatalog=backToProductCatalog;
window.cubicaFinishedCategoryInternals={finishedCategoryRows,finishedCategories,normalizedFinishedCategoryName,renderFinishedCategorySelect,finishedCategoryAssignmentAllowed};

