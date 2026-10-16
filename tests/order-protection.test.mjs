import test from "node:test";
import assert from "node:assert/strict";
import { createBackendClient, createHandler, normalizeOrderRequest, verifyTurnstile } from "../supabase/functions/create-order/worker.js";

const requestId="b6deef29-dcf3-4b7a-8b67-6d993e85d955";
const guestToken="a".repeat(64);
const testSecret="1x0000000000000000000000000000000AA";
const baseBody=()=>({
  client_order_id:requestId,customer_name:"Cliente",customer_email:"cliente@example.invalid",phone:"1112345678",
  payment:"Transferencia",notes:"",items:[{product_id:"product-1",qty:2,color:"Blanco"}],
  delivery:{mode:"pickup",request_id:requestId,quote_token:guestToken},turnstile_token:"XXXX.DUMMY.TOKEN.XXXX",
});
const validSiteverify=()=>({success:true,challenge_ts:new Date().toISOString(),hostname:"cubica3d.ar",action:"create_order","error-codes":[]});

test("el cliente RPC acepta una respuesta void sin convertir el éxito en error",async()=>{
  const client=createBackendClient("https://project.supabase.co","service-secret",async()=>new Response(null,{status:204}));
  assert.deepEqual(await client.rpc("consume_turnstile_token",{}),{data:null,error:null});
});

function setup({siteverify=validSiteverify(),existing=null,createError=null,user=null,allowTest=true,replayLedger=new Set()}={}){
  const calls=[];
  const client={
    getUser:async()=>user?{user,error:false}:{user:null,error:true},
    rpc:async(name,args)=>{
      calls.push({name,args});
      if(name==="lookup_verified_delivery_order")return {data:existing,error:null};
      if(name==="consume_turnstile_token"){
        if(replayLedger.has(args.p_token_hash))return {data:null,error:{code:"order_turnstile_replayed",retryAfter:0}};
        replayLedger.add(args.p_token_hash);return {data:null,error:null};
      }
      if(name==="create_verified_delivery_order"&&createError)return {data:null,error:createError};
      return {data:{ok:true,order_id:"b6fe635b-67bd-4f54-bf81-afedaf9a180c",order_number:"CUB-1042",total:2000},error:null};
    },
  };
  const envValues={SUPABASE_URL:"https://project.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"service-secret",SUPABASE_ANON_KEY:"publishable",TURNSTILE_SECRET_KEY:testSecret,TURNSTILE_ALLOW_TEST_KEYS:allowTest?"true":"",TURNSTILE_EXPECTED_HOSTNAMES:"cubica3d.ar",TURNSTILE_EXPECTED_ACTION:"create_order",ORDER_RATE_LIMIT_SALT:"rate-salt"};
  let siteverifyCalls=0;
  const fetchImpl=async(url)=>{assert.match(String(url),/siteverify/);siteverifyCalls++;return new Response(JSON.stringify(siteverify),{status:200,headers:{"content-type":"application/json"}});};
  const handler=createHandler({env:name=>envValues[name],createClient:()=>client,fetchImpl});
  const send=(body=baseBody(),headers={})=>handler(new Request("https://project.supabase.co/functions/v1/create-order",{method:"POST",headers:{origin:"https://cubica3d.ar",apikey:"publishable",authorization:"Bearer publishable","content-type":"application/json",...headers},body:JSON.stringify(body)}));
  return {send,calls,siteverifyCalls:()=>siteverifyCalls};
}

test("la protección exige una sal privada explícita",async()=>{
  const s=setup();
  const originalSend=s.send;
  const envValues={SUPABASE_URL:"https://project.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"service-secret",SUPABASE_ANON_KEY:"publishable",TURNSTILE_SECRET_KEY:testSecret,TURNSTILE_ALLOW_TEST_KEYS:"true",TURNSTILE_EXPECTED_HOSTNAMES:"cubica3d.ar",TURNSTILE_EXPECTED_ACTION:"create_order",ORDER_RATE_LIMIT_SALT:""};
  const handler=createHandler({env:name=>envValues[name],createClient:()=>({}),fetchImpl:async()=>{throw new Error("must not call Siteverify");}});
  const response=await handler(new Request("https://project.supabase.co/functions/v1/create-order",{method:"POST",headers:{origin:"https://cubica3d.ar","content-type":"application/json"},body:JSON.stringify(baseBody())}));
  assert.equal(response.status,503);assert.equal((await response.json()).error,"order_protection_not_configured");assert.equal(typeof originalSend,"function");
});

test("pedido invitado válido verifica Siteverify y usa solamente la RPC de servicio",async()=>{
  const s=setup(),response=await s.send();assert.equal(response.status,201);assert.equal(s.siteverifyCalls(),1);
  assert.deepEqual(s.calls.map(x=>x.name),["lookup_verified_delivery_order","consume_turnstile_token","create_verified_delivery_order"]);
  const created=s.calls[2].args;assert.equal(created.p_user_id,null);assert.equal(created.p_items[0].price,undefined);assert.equal(created.p_rate_limits.length,4);
  assert(created.p_rate_limits.every(x=>/^(guest|ip):[0-9a-f]{64}$/.test(x.key)));assert(!JSON.stringify(created.p_rate_limits).includes(guestToken));
});

test("pedido autenticado deriva el usuario del Auth API",async()=>{
  const user={id:"0acb1b4d-a367-4363-8bdc-e0030893968b"},s=setup({user});
  const response=await s.send(baseBody(),{authorization:"Bearer real-user-jwt"});assert.equal(response.status,201);assert.equal(s.calls[2].args.p_user_id,user.id);
  assert(s.calls[2].args.p_rate_limits.some(x=>x.key.startsWith("auth:")));
});

test("reintento idempotente recupera el pedido antes de gastar otro token",async()=>{
  const existing={ok:true,order_id:"b6fe635b-67bd-4f54-bf81-afedaf9a180c",order_number:"CUB-1042",total:2000,idempotent_replay:true};
  const s=setup({existing}),response=await s.send();assert.equal(response.status,200);assert.deepEqual(await response.json(),existing);assert.equal(s.siteverifyCalls(),0);assert.equal(s.calls.length,1);
});

test("token ausente, inválido, vencido, hostname y action incorrectos nunca crean pedido",async()=>{
  const missing=baseBody();delete missing.turnstile_token;let s=setup();let response=await s.send(missing);assert.equal(response.status,400);assert.equal(s.calls.length,0);
  for(const result of [
    {success:false,"error-codes":["invalid-input-response"]},
    {...validSiteverify(),challenge_ts:new Date(Date.now()-6*60*1000).toISOString()},
    {...validSiteverify(),hostname:"attacker.invalid"},
    {...validSiteverify(),action:"comment"},
  ]){
    s=setup({siteverify:result});response=await s.send();assert([400,403].includes(response.status));assert.equal(s.calls.filter(x=>x.name==="create_verified_delivery_order").length,0);
  }
});

test("token reutilizado vuelve a consultar idempotencia y no genera emails falsos",async()=>{
  const s=setup({siteverify:{success:false,"error-codes":["timeout-or-duplicate"]}}),response=await s.send();
  assert.equal(response.status,400);assert.equal((await response.json()).error,"turnstile_expired_or_used");assert.deepEqual(s.calls.map(x=>x.name),["lookup_verified_delivery_order","lookup_verified_delivery_order"]);
});

test("la barrera local rechaza el mismo token en otro pedido aunque Siteverify lo acepte",async()=>{
  const s=setup(),first=baseBody(),second=baseBody();
  second.client_order_id="11111111-1111-4111-8111-111111111111";
  second.delivery={...second.delivery,request_id:second.client_order_id,quote_token:"b".repeat(64)};
  let response=await s.send(first);assert.equal(response.status,201);
  response=await s.send(second);assert.equal(response.status,400);assert.equal((await response.json()).error,"order_turnstile_replayed");
  assert.equal(s.siteverifyCalls(),2);assert.equal(s.calls.filter(x=>x.name==="create_verified_delivery_order").length,1);
  const reservation=s.calls.find(x=>x.name==="consume_turnstile_token");
  assert.match(reservation.args.p_token_hash,/^turnstile:[0-9a-f]{64}$/);
  assert(!JSON.stringify(reservation.args).includes("XXXX.DUMMY.TOKEN.XXXX"));
});

test("dos pedidos concurrentes con el mismo token crean como máximo uno",async()=>{
  const s=setup(),first=baseBody(),second=baseBody();
  second.client_order_id="22222222-2222-4222-8222-222222222222";
  second.delivery={...second.delivery,request_id:second.client_order_id,quote_token:"b".repeat(64)};
  const responses=await Promise.all([s.send(first),s.send(second)]),statuses=responses.map(x=>x.status).sort();
  assert.deepEqual(statuses,[201,400]);
  assert.equal(s.calls.filter(x=>x.name==="create_verified_delivery_order").length,1);
});

test("límite devuelve 429 y Retry-After sin intentar otra creación",async()=>{
  const s=setup({createError:{code:"order_rate_limit",retryAfter:93}}),response=await s.send();assert.equal(response.status,429);assert.equal(response.headers.get("retry-after"),"93");assert.equal((await response.json()).retry_after,93);
});

test("dos compradores detrás de una IP comparten solo el límite de red",async()=>{
  const a=setup(),b=setup();await a.send(baseBody(),{"cf-connecting-ip":"203.0.113.8"});
  const changed=baseBody();changed.delivery.quote_token="b".repeat(64);changed.turnstile_token="SECOND.DUMMY.TOKEN";await b.send(changed,{"cf-connecting-ip":"203.0.113.8"});
  const aKeys=a.calls[2].args.p_rate_limits,bKeys=b.calls[2].args.p_rate_limits;
  assert.notEqual(aKeys[0].key,bKeys[0].key);assert.equal(aKeys[2].key,bKeys[2].key);
});

test("fallo de Cloudflare no desactiva protección y claves de prueba no se habilitan por accidente",async()=>{
  const unavailable=await verifyTurnstile({token:"x",secret:testSecret,remoteip:"unknown",idempotencyKey:requestId,expectedHostnames:new Set(["cubica3d.ar"]),expectedAction:"create_order",fetchImpl:async()=>{throw new Error("network")}}).catch(x=>x);
  assert.equal(unavailable.code,"turnstile_unavailable");
  const s=setup({allowTest:false}),response=await s.send();assert.equal(response.status,503);assert.equal((await response.json()).error,"order_protection_not_configured");assert.equal(s.siteverifyCalls(),0);
});

test("normalización excluye precios, user_id y campos privados",()=>{
  const body=baseBody();body.items[0].price=1;body.user_id="spoof";body.delivery.actual_cost_ars=0;
  const normalized=normalizeOrderRequest(body);assert.equal(normalized.rpc.p_items[0].price,undefined);assert.equal(normalized.rpc.p_user_id,undefined);assert.equal(normalized.rpc.p_delivery.actual_cost_ars,undefined);
});
