/* CÚBICA 3D — módulo UI de inventario de insumos.
   Extraído de script.js el 2026-10-09 para reducir acoplamiento.
   Usa el estado global de la aplicación (supplies, products, STORAGE, etc.).
*/

function renderSupplyCategoryControls(){
  const filter=$("supply-category-filter");
  if(filter){
    const current=filter.value;
    filter.innerHTML='<option value="all">Todas las categorías</option>'+supplyCategories.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    filter.value=supplyCategories.includes(current)?current:"all";
  }
  const select=$("supply-category");
  if(select){
    const selected=select.value;
    select.innerHTML=supplyCategories.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    select.value=supplyCategories.includes(selected)?selected:(supplyCategories.includes("Otros")?"Otros":(supplyCategories[0]||""));
  }
  const list=$("supply-category-list");
  if(list)list.innerHTML=supplyCategories.map(c=>{
    const count=supplies.filter(s=>s.category===c).length;
    const locked=DEFAULT_SUPPLY_CATEGORIES.includes(c);
    return `<div class="category-chip"><span>${escapeHtml(c)} <small>${count}</small></span><button class="category-delete ${locked?"disabled":""}" ${locked?"disabled":""} title="${locked?"Categoría base":"Eliminar categoría"}" onclick="deleteSupplyCategory('${escapeHtml(c)}')">×</button></div>`;
  }).join("");
}
function supplyDetailHtml(s){
  if(String(s.category||"").toLowerCase()!=="filamentos")return '<span class="muted">—</span>';
  const material=escapeHtml(s.materialType||"Sin material");
  const brand=s.brand?escapeHtml(s.brand):"Sin marca";
  const color=s.colorName?escapeHtml(s.colorName):escapeHtml(s.colorHex||"#ffffff");
  return `<div class="supply-filament-detail"><span class="supply-color-dot" style="--supply-color:${escapeHtml(s.colorHex||"#ffffff")}"></span><span><strong>${material} · ${brand}</strong><small>${color}</small></span></div>`;
}
function sortedSuppliesForView(list,mode=supplySortMode){
  const copy=[...(list||[])];
  const byText=(a,b)=>String(a||"").localeCompare(String(b||""),"es",{sensitivity:"base"});
  if(mode==="category")return copy.sort((a,b)=>byText(a.category,b.category)||byText(a.name,b.name));
  if(mode==="name")return copy.sort((a,b)=>byText(a.name,b.name));
  if(mode==="stock-desc")return copy.sort((a,b)=>(Number(b.qty)||0)-(Number(a.qty)||0)||byText(a.name,b.name));
  if(mode==="stock-asc")return copy.sort((a,b)=>(Number(a.qty)||0)-(Number(b.qty)||0)||byText(a.name,b.name));
  if(mode==="cost-desc")return copy.sort((a,b)=>(Number(b.cost)||0)-(Number(a.cost)||0)||byText(a.name,b.name));
  if(mode==="cost-asc")return copy.sort((a,b)=>(Number(a.cost)||0)-(Number(b.cost)||0)||byText(a.name,b.name));
  return copy.sort((a,b)=>(Number(a.sortOrder)||0)-(Number(b.sortOrder)||0)||byText(a.name,b.name));
}
function moveSupply(id,direction){
  if(supplySortMode!=="manual")return;
  const ordered=sortedSuppliesForView(supplies,"manual");
  const index=ordered.findIndex(x=>String(x.id)===String(id));
  const target=index+(direction<0?-1:1);
  if(index<0||target<0||target>=ordered.length)return;
  [ordered[index],ordered[target]]=[ordered[target],ordered[index]];
  ordered.forEach((item,i)=>item.sortOrder=(i+1)*10);
  supplies=ordered;
  write(STORAGE.supplies,supplies);
  renderSupplies();
}
function setSupplyPage(page){
  supplyPage=Math.max(1,Math.trunc(Number(page)||1));
  renderSupplies();
  const toolbar=$("section-stock-supplies")?.querySelector(".inventory-toolbar");
  toolbar?.scrollIntoView({behavior:"smooth",block:"start"});
}
function renderSupplies(){
  supplies=supplies.map(normalizeSupply);
  renderSupplyCategoryControls();

  const sortSelect=$("supply-sort");
  if(sortSelect){
    sortSelect.value=[...sortSelect.options].some(o=>o.value===supplySortMode)?supplySortMode:"manual";
    supplySortMode=sortSelect.value;
  }

  const search=(($("supply-search")?.value)||"").trim().toLowerCase();
  const cat=$("supply-category-filter")?.value||"all";
  const filtered=supplies.filter(s=>{
    const hay=[s.name,s.category,s.brand,s.materialType,s.colorName,s.colorHex].join(" ").toLowerCase();
    return (!search||hay.includes(search)) && (cat==="all"||s.category===cat);
  });
  const ordered=sortedSuppliesForView(filtered,supplySortMode);
  const canManualReorder=supplySortMode==="manual" && !search && cat==="all";

  const totalPages=Math.max(1,Math.ceil(ordered.length/SUPPLY_PAGE_SIZE));
  supplyPage=Math.min(Math.max(1,supplyPage),totalPages);
  const pageStart=(supplyPage-1)*SUPPLY_PAGE_SIZE;
  const pageItems=ordered.slice(pageStart,pageStart+SUPPLY_PAGE_SIZE);

  const hint=$("supply-sort-hint");
  if(hint){
    hint.textContent=supplySortMode==="manual"
      ? (canManualReorder?"Usá ↑ y ↓ para definir el orden personalizado. Se guarda en Supabase.":"Quitá la búsqueda y el filtro de categoría para reordenar manualmente.")
      : "Este orden es solo una vista. Elegí “Orden personalizado” para guardar tu propio orden.";
  }

  const total=supplies.reduce((a,s)=>a+supplyCostForQty(s,s.qty),0);
  const filteredTotal=filtered.reduce((a,s)=>a+supplyCostForQty(s,s.qty),0);
  $("stock-value-card").innerHTML=`<span>Valor acumulado en depósito</span><strong>${money(total)}</strong><span>${supplies.length} insumos registrados${filtered.length!==supplies.length?` · vista filtrada: ${money(filteredTotal)}`:""}</span>`;

  $("supplies-stock-table").innerHTML=`<table><thead><tr><th class="supply-order-col">Orden</th><th>Insumo</th><th>Categoría</th><th>Detalle</th><th>Costo</th><th>Cantidad</th><th>Valor</th><th></th></tr></thead><tbody>
  ${pageItems.length ? pageItems.map((item,rowIndex)=>{
    const globalIndex=pageStart+rowIndex;
    return `<tr>
      <td class="supply-order-cell">
        ${supplySortMode==="manual"?
          `<div class="supply-order-buttons"><button class="btn ghost supply-move" onclick="moveSupply('${item.id}',-1)" ${!canManualReorder||globalIndex===0?"disabled":""} title="Subir insumo">↑</button><button class="btn ghost supply-move" onclick="moveSupply('${item.id}',1)" ${!canManualReorder||globalIndex===ordered.length-1?"disabled":""} title="Bajar insumo">↓</button></div>`
          :`<span class="muted">${globalIndex+1}</span>`}
      </td>
      <td><strong>${escapeHtml(item.name)}</strong></td>
      <td>${escapeHtml(item.category)}</td>
      <td>${supplyDetailHtml(item)}</td>
      <td>${money(item.cost)} <small class="table-unit">${escapeHtml(supplyCostLabel(item))}</small></td>
      <td>${Number(item.qty).toLocaleString("es-AR",{maximumFractionDigits:2})} <small class="table-unit">${escapeHtml(supplyUnitLabel(item.unit,item.qty))}</small></td>
      <td>${money(supplyCostForQty(item,item.qty))}</td>
      <td class="table-actions"><button class="btn ghost" onclick="editSupply('${item.id}')">Editar</button><button class="btn ghost danger-button" onclick="deleteSupply('${item.id}')">Eliminar</button></td>
    </tr>`;
  }).join("") : `<tr><td colspan="8" class="empty-table">No se encontraron insumos con esos filtros.</td></tr>`}</tbody></table>`;

  renderPagination("supplies-pagination",{
    page:supplyPage,
    totalPages,
    totalItems:ordered.length,
    pageSize:SUPPLY_PAGE_SIZE,
    setter:"setSupplyPage"
  });
}
function updateSupply(id,key,val){
  const supply=supplies.find(x=>x.id===id);if(!supply)return;
  supply[key]=(key==="cost"||key==="qty")?Number(val):val;
  Object.assign(supply,normalizeSupply(supply));
  write(STORAGE.supplies,supplies);renderSupplies();renderBudget();
}
function resetSupplyForm(){
  const form=$("supply-form");if(!form)return;
  form.reset();
  $("supply-id").value="";
  $("supply-modal-title").textContent="Nuevo insumo";
  $("supply-submit").textContent="Agregar insumo";
  renderSupplyCategoryControls();
  $("supply-category").value=supplyCategories.includes("Otros")?"Otros":(supplyCategories[0]||"");
  $("supply-unit").value="unidades";
  $("supply-color").value="#ffffff";
  $("supply-color-name").value="";
  $("supply-material").value="PLA";
  $("supply-material-custom").value="";
  $("supply-brand").value="";
  updateSupplyFilamentFields();
}
function updateSupplyFilamentFields({fromCategoryChange=false}={}){
  const category=$("supply-category")?.value||"";
  const isFilament=category==="Filamentos";
  $("supply-filament-fields")?.classList.toggle("hidden",!isFilament);
  if(isFilament && fromCategoryChange && $("supply-unit")?.value==="unidades")$("supply-unit").value="gramos";
  const custom=$("supply-material")?.value==="__other";
  $("supply-material-custom-wrap")?.classList.toggle("hidden",!custom);
  const help=$("supply-cost-help");
  if(help){
    const unit=$("supply-unit")?.value||"unidades";
    help.textContent=isFilament&&unit==="gramos"
      ?"Para filamento medido en gramos, ingresá el precio por kilogramo."
      :`Costo por ${supplyUnitLabel(unit,1)}.`;
  }
}
function editSupply(id){
  const supply=supplies.find(x=>x.id===id);if(!supply)return;
  const s=normalizeSupply(supply);
  renderSupplyCategoryControls();
  $("supply-id").value=s.id;
  $("supply-modal-title").textContent="Editar insumo";
  $("supply-submit").textContent="Guardar cambios";
  $("supply-name").value=s.name||"";
  $("supply-category").value=s.category;
  $("supply-cost").value=s.cost;
  $("supply-qty").value=s.qty;
  $("supply-unit").value=s.unit;
  const standard=["PLA","ASA","PETG"];
  if(standard.includes(s.materialType)){
    $("supply-material").value=s.materialType;
    $("supply-material-custom").value="";
  }else{
    $("supply-material").value="__other";
    $("supply-material-custom").value=s.materialType||"";
  }
  $("supply-brand").value=s.brand||"";
  $("supply-color").value=s.colorHex||"#ffffff";
  $("supply-color-name").value=s.colorName||"";
  updateSupplyFilamentFields();
  openModal("supply-modal");
}
function saveSupplyForm(e){
  e.preventDefault();
  const id=$("supply-id").value;
  const category=$("supply-category").value;
  const isFilament=category==="Filamentos";
  let materialType="";
  if(isFilament){
    materialType=$("supply-material").value==="__other"?$("supply-material-custom").value.trim():$("supply-material").value;
    if(!materialType)return toast("Indicá el tipo de material del filamento.");
  }
  const data=normalizeSupply({
    id:id||uid("s"),
    name:$("supply-name").value.trim(),
    category,
    cost:Number($("supply-cost").value)||0,
    qty:Number($("supply-qty").value)||0,
    unit:$("supply-unit").value,
    materialType,
    brand:isFilament?$("supply-brand").value.trim():"",
    colorName:isFilament?$("supply-color-name").value.trim():"",
    colorHex:isFilament?$("supply-color").value:"#ffffff",
    sortOrder:id?(supplies.find(x=>x.id===id)?.sortOrder||0):(Math.max(0,...supplies.map(x=>Number(x.sortOrder)||0))+10)
  });
  if(!data.name)return toast("El insumo necesita un nombre.");
  if(id){
    const index=supplies.findIndex(x=>x.id===id);if(index<0)return;
    supplies[index]={...supplies[index],...data,id};
    toast("Insumo actualizado");
  }else{
    supplies.push(data);
    toast("Insumo agregado");
  }
  write(STORAGE.supplies,supplies);
  e.target.reset();
  closeModal("supply-modal");
  renderSupplies();renderBudget();renderFinishedRecipe();
}
function deleteSupply(id){
  if(!confirm("¿Eliminar este insumo?"))return;
  supplies=supplies.filter(s=>s.id!==id);
  write(STORAGE.supplies,supplies);renderSupplies();renderBudget();renderFinishedRecipe();
}
function addSupplyCategory(name){
  name=name.trim().replace(/\s+/g," ");
  if(!name)return toast("Escribí un nombre para la categoría.");
  if(supplyCategories.some(c=>c.toLowerCase()===name.toLowerCase()))return toast("Esa categoría ya existe.");
  supplyCategories.push(name);supplyCategories.sort((a,b)=>a.localeCompare(b,"es"));write(STORAGE.supplyCategories,supplyCategories);renderSupplyCategoryControls();$("supply-category").value=name;toast(`Categoría "${name}" creada.`);
}
function deleteSupplyCategory(name){
  if(DEFAULT_SUPPLY_CATEGORIES.includes(name))return toast("Las categorías base no se pueden eliminar.");
  const used=supplies.some(s=>s.category===name);
  if(used){
    if(!confirm(`La categoría "${name}" tiene insumos. Se moverán a "Otros". ¿Continuar?`))return;
    supplies=supplies.map(s=>s.category===name?{...s,category:"Otros"}:s);write(STORAGE.supplies,supplies);
  }
  supplyCategories=supplyCategories.filter(c=>c!==name);write(STORAGE.supplyCategories,supplyCategories);renderSupplies();renderBudget();toast(`Categoría "${name}" eliminada.`);
}

window.setSupplyPage=setSupplyPage;
window.updateSupply=updateSupply;
window.editSupply=editSupply;
window.moveSupply=moveSupply;
window.deleteSupply=deleteSupply;
window.deleteSupplyCategory=deleteSupplyCategory;
