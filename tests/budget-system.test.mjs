import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {generateCommercialPdf} from "../supabase/functions/budget-emails/pdf.js";
import {internalBudgetEmail} from "../supabase/functions/budget-emails/templates.js";

const code=fs.readFileSync(new URL("../js/budget-ui.js",import.meta.url),"utf8");
const sandbox={window:{addEventListener(){}},globalThis:{crypto:{randomUUID:()=>"id"}},document:{addEventListener(){},querySelectorAll(){return[];}},sessionStorage:{},console,setTimeout,clearTimeout};sandbox.window.window=sandbox.window;vm.runInNewContext(code,sandbox);
const compute=sandbox.window.cubicaBudgetInternals.computeBudget;
const result=compute({weight:50,time:2,watts:150,kwh:130,machine:1500,failure:10,margin:50,suppliesMargin:50,materialPrice:18692,suppliesCost:0});
assert.equal(result.material,934.6);assert.equal(result.electricity,39);assert.equal(result.machineCost,3000);assert.ok(Math.abs(result.sale-6556.44)<0.001);
const snapshot={quote:{customer_name:"Ana",customer_email:"ana@example.invalid",customer_phone:"111",customer_reference:"REF"},version:{issued_at:"2026-10-17T12:00:00Z"},commercial:{quote_number:"PRE-20261017-0001",title:"Lámpara",customer_name:"Ana",valid_until:"2026-11-01",total:12000,manufacturing_time:"10 días hábiles",payment_terms:"50% de anticipo",delivery_terms:"Retiro coordinado",commercial_notes:"No es factura",items:[{position:1,title:"Lámpara personalizada",description:"Pieza decorativa impresa en 3D",quantity:2,material:"PLA blanco",color:"Blanco",unit_price:6000,line_total:12000,customer_notes:"Incluye terminación"}]},items:[{title:"Lámpara personalizada",quantity:2,material:{name:"PLA blanco",weight_g:50},description:"Pieza",supplies:[{name:"LED",quantity:2,unit:"unidades",unit_cost:100,cost:200}],calculation:{material_cost:935,electricity_cost:39,machine_cost:3000,failure_cost:417,production_margin_pct:50,supplies_margin_pct:50,unit_price:6000,line_total:12000}}],internal_notes:"Costo privado"};
const pdf=generateCommercialPdf(snapshot);assert.equal(Buffer.from(pdf.slice(0,8)).toString(),"%PDF-1.4");const printable=Buffer.from(pdf).toString("latin1");for(const forbidden of ["material_cost","machine_cost","Costo privado","Margen","Electricidad"])assert.ok(!printable.includes(forbidden));
const email=internalBudgetEmail(snapshot,"Cúbica Presupuestos <presupuestos@cubica3d.ar>");assert.deepEqual(email.to,["pedidos@cubica3d.ar"]);assert.ok(email.html.includes("Costo privado"));assert.ok(!JSON.stringify(email).includes("ana@example.invalid\"]"));
console.log("Budget formulas, commercial PDF privacy and internal recipient passed");

