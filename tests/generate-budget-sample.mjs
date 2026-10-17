import fs from "node:fs";
import {generateCommercialPdf} from "../supabase/functions/budget-emails/pdf.js";
const items=Array.from({length:8},(_,i)=>({position:i+1,title:["Lámpara lunar personalizada","Cartel corpóreo","Soporte de escritorio"][i%3],description:"Fabricación a medida en impresión 3D con terminación cuidada y control de calidad.",quantity:i%2+1,material:"PLA premium",color:i%2?"Negro mate":"Blanco",unit_price:6500+i*750,line_total:(6500+i*750)*(i%2+1),customer_notes:i===0?"Incluye armado y presentación final.":""}));
const total=items.reduce((sum,item)=>sum+item.line_total,0);
const snapshot={version:{issued_at:"2026-10-17T12:00:00Z"},commercial:{quote_number:"PRE-20261017-0042",title:"Objetos personalizados para evento",customer_name:"Cliente de ejemplo",valid_until:"2026-11-01",items,total,manufacturing_time:"10 a 15 días hábiles desde la confirmación",payment_terms:"50% de anticipo y saldo contra entrega",delivery_terms:"Retiro coordinado en punto acordado",commercial_notes:"Los colores pueden variar levemente según la partida de material. Este documento es un presupuesto comercial y no una factura."}};
fs.mkdirSync(new URL("../output/pdf/",import.meta.url),{recursive:true});
fs.writeFileSync(new URL("../output/pdf/cubica-presupuesto-ejemplo.pdf",import.meta.url),generateCommercialPdf(snapshot));
console.log("output/pdf/cubica-presupuesto-ejemplo.pdf");
