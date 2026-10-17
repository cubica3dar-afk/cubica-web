import test from "node:test";
import assert from "node:assert/strict";
import {processDelivery} from "../supabase/functions/budget-emails/worker.js";

const versionId="11111111-1111-4111-8111-111111111111";
const snapshot={quote:{customer_name:"Cliente",customer_email:"cliente@example.invalid",customer_phone:"111",customer_reference:"REF"},version:{id:versionId,quote_id:"22222222-2222-4222-8222-222222222222",version:1,quote_number:"PRE-20261017-0001",issued_at:"2026-10-17T12:00:00Z",commercial_snapshot:{quote_number:"PRE-20261017-0001",title:"Pieza",customer_name:"Cliente",valid_until:"2026-11-01",total:1000,items:[{position:1,title:"Pieza",description:"Detalle",quantity:1,material:"PLA",color:"",unit_price:1000,line_total:1000,customer_notes:""}]},snapshot:{commercial:{quote_number:"PRE-20261017-0001",title:"Pieza",customer_name:"Cliente",valid_until:"2026-11-01",total:1000,items:[{position:1,title:"Pieza",description:"Detalle",quantity:1,material:"PLA",color:"",unit_price:1000,line_total:1000,customer_notes:""}]},items:[{title:"Pieza",quantity:1,material:{name:"PLA",weight_g:20},supplies:[],calculation:{material_cost:200,electricity_cost:20,machine_cost:300,failure_cost:52,production_margin_pct:50,supplies_margin_pct:50,unit_price:1000,line_total:1000}}],internal_notes:"privado"}}};

test("worker guarda payload estable, adjunta PDF y envía solo al correo interno",async()=>{
 const calls=[],requests=[];let prepared;
 const client={rpc:async(name,args)=>{calls.push([name,args]);if(name==="get_quote_email_snapshot")return {data:snapshot,error:null};if(name==="prepare_quote_email_delivery"){prepared=args.p_payload;return {data:prepared,error:null};}if(name==="finish_quote_email_delivery")return {data:null,error:null};throw new Error(name);}};
 const fetchImpl=async(url,init)=>{requests.push([url,init]);if(String(url).includes("/storage/"))return new Response("{}",{status:200});return Response.json({id:"email_1"});};
 const result=await processDelivery(client,{version_id:versionId,lock_token:"33333333-3333-4333-8333-333333333333",payload:null},{url:"https://example.supabase.co",serviceKey:"service",resendKey:"resend",from:"Cúbica Presupuestos <presupuestos@cubica3d.ar>",fetchImpl});
 assert.equal(result,"sent");assert.deepEqual(prepared.to,["pedidos@cubica3d.ar"]);assert.equal(prepared.attachments,undefined);
 const resend=requests.find(([url])=>url==="https://api.resend.com/emails");const body=JSON.parse(resend[1].body);assert.equal(body.attachments.length,1);assert.match(body.attachments[0].content,/^[A-Za-z0-9+/=]+$/);assert.equal(resend[1].headers["Idempotency-Key"],`cubica-budget/${versionId}/internal/v1`);assert.ok(!body.to.includes("cliente@example.invalid"));
 const finish=calls.find(([name])=>name==="finish_quote_email_delivery")[1];assert.equal(finish.p_sent,true);
});

test("reintento reutiliza payload sin preparar otro contenido",async()=>{
 let prepares=0;const client={rpc:async(name,args)=>{if(name==="get_quote_email_snapshot")return {data:snapshot,error:null};if(name==="prepare_quote_email_delivery"){prepares++;return {data:args.p_payload,error:null};}if(name==="finish_quote_email_delivery")return {data:null,error:null};}};
 const fetchImpl=async(url)=>String(url).includes("/storage/")?new Response("{}",{status:409}):Response.json({id:"email_1"});
 const stored={from:"Cúbica Presupuestos <presupuestos@cubica3d.ar>",to:["pedidos@cubica3d.ar"],subject:"estable",html:"<p>estable</p>",text:"estable"};
 assert.equal(await processDelivery(client,{version_id:versionId,lock_token:"33333333-3333-4333-8333-333333333333",payload:stored},{url:"https://example.supabase.co",serviceKey:"service",resendKey:"resend",from:"x",fetchImpl}),"sent");assert.equal(prepares,0);
});

