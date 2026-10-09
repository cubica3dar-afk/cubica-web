/* CÚBICA 3D — calculadora y gestión visual de presupuestos. */

function renderBudget(){
  const mat=$("budget-material");const current=mat.value;
  mat.innerHTML=supplies.filter(s=>s.category.toLowerCase().startsWith("filamento")).map(s=>`<option value="${s.cost}">${escapeHtml(s.name)}${s.materialType?` · ${escapeHtml(s.materialType)}`:""} — ${money(s.cost)}${s.unit==="gramos"?"/kg":` ${escapeHtml(supplyCostLabel(s))}`}</option>`).join("");
  if(current)mat.value=current;
  renderBudgetSupplyRows();
  calculateBudget();
}
function renderBudgetSupplyRows(){
  const rows=window.budgetRows||[];$("budget-supplies").innerHTML=rows.map((r,i)=>`
    <div class="budget-supply-row"><select onchange="budgetRows[${i}].id=this.value;updateBudgetRow(${i})">
      <option value="">Sin insumo</option>${supplies.filter(s=>!s.category.toLowerCase().startsWith("filamento")).map(s=>`<option value="${s.id}" ${r.id===s.id?"selected":""}>${escapeHtml(s.name)} (${money(s.cost)})</option>`).join("")}</select>
      <input type="number" min="0" step="0.01" value="${r.qty}" onchange="budgetRows[${i}].qty=Number(this.value);calculateBudget()" placeholder="Cant.">
      <input class="row-cost" readonly value="${money(getSupplyCost(r.id)*r.qty)}">
      <button type="button" class="btn ghost" onclick="removeBudgetRow(${i})">×</button></div>`).join("");
}
window.budgetRows=[];
function getSupplyCost(id){return supplies.find(s=>s.id===id)?.cost||0}
function updateBudgetRow(){renderBudgetSupplyRows();calculateBudget()}
function removeBudgetRow(i){budgetRows.splice(i,1);renderBudgetSupplyRows();calculateBudget()}
function calculateBudget(){
  const weight=Number($("budget-weight").value)||0,time=Number($("budget-time").value)||0,watts=Number($("budget-watts").value)||0;
  const kwh=Number($("budget-kwh").value)||0,machine=Number($("budget-machine").value)||0,failure=(Number($("budget-failure").value)||0)/100,margin=(Number($("budget-margin").value)||0)/100;
  const suppliesMargin=(Number($("budget-supplies-margin")?.value)||0)/100;
  const materialPrice=Number($("budget-material").value)||0;
  const material=weight/1000*materialPrice,electricity=watts/1000*time*kwh,machineCost=time*machine;
  const suppliesCost=budgetRows.reduce((a,r)=>a+getSupplyCost(r.id)*r.qty,0);

  // El margen general ya no se aplica a los insumos adicionales.
  // La reserva de fallos se reparte proporcionalmente entre producción e insumos
  // para que cada grupo reciba luego su propio margen.
  const productionCost=material+electricity+machineCost;
  const subtotal=productionCost+suppliesCost;
  const fail=subtotal*failure;
  const productionFail=subtotal>0?fail*(productionCost/subtotal):0;
  const suppliesFail=subtotal>0?fail*(suppliesCost/subtotal):0;
  const productionTotal=productionCost+productionFail;
  const suppliesTotal=suppliesCost+suppliesFail;
  const productionSale=productionTotal*(1+margin);
  const suppliesSale=suppliesTotal*(1+suppliesMargin);
  const total=subtotal+fail;
  const sale=productionSale+suppliesSale;

  window.lastBudget={weight,time,materialPrice,material,electricity,machineCost,suppliesCost,productionCost,subtotal,fail,productionFail,suppliesFail,productionTotal,suppliesTotal,margin,suppliesMargin,productionSale,suppliesSale,total,sale};
  $("budget-result").innerHTML=`<h3>Resultado</h3>
    <div class="cost-line"><span>Material (${weight} g)</span><strong>${money(material)}</strong></div>
    <div class="cost-line"><span>Electricidad</span><strong>${money(electricity)}</strong></div>
    <div class="cost-line"><span>Costo máquina</span><strong>${money(machineCost)}</strong></div>
    <div class="cost-line"><span>Insumos adicionales · costo</span><strong>${money(suppliesCost)}</strong></div>
    <div class="cost-line"><span>Subtotal</span><strong>${money(subtotal)}</strong></div>
    <div class="cost-line"><span>Reserva por fallos</span><strong>${money(fail)}</strong></div>
    <div class="cost-line"><span>Costo total</span><strong>${money(total)}</strong></div>
    <div class="cost-line"><span>Producción + margen ${(margin*100).toFixed(0)}%</span><strong>${money(productionSale)}</strong></div>
    <div class="cost-line"><span>Insumos + margen ${(suppliesMargin*100).toFixed(0)}%</span><strong>${money(suppliesSale)}</strong></div>
    <div class="sale-price"><span>Precio de venta</span><strong>${money(sale)}</strong></div>`;
}

function budgetSummary(){const b=window.lastBudget;return `CÚBICA — PRESUPUESTO\nFilamento: ${b.weight} g\nMaterial: ${money(b.material)}\nElectricidad: ${money(b.electricity)}\nMáquina: ${money(b.machineCost)}\nInsumos: ${money(b.suppliesCost)}\nFallos: ${money(b.fail)}\nCosto total: ${money(b.total)}\nMargen general: ${b.margin*100}%\nMargen insumos: ${b.suppliesMargin*100}%\nPrecio de venta: ${money(b.sale)}`}
function saveBudget(){const b=window.lastBudget;if(!b)return;const qs=read(STORAGE.quotes,[]);qs.push({id:uid("q"),date:new Date().toISOString(),data:b,summary:budgetSummary()});write(STORAGE.quotes,qs);toast("Presupuesto guardado")}
async function copyBudget(){await navigator.clipboard.writeText(budgetSummary());toast("Resumen copiado")}

function initBudgetDefaults(){
  if(!window.budgetRows.length)window.budgetRows=[{id:"",qty:1}];
}

window.removeBudgetRow=removeBudgetRow;
window.updateBudgetRow=updateBudgetRow;
