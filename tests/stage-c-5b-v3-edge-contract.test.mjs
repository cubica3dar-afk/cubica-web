import assert from "node:assert/strict";
import {createHandler,decodeRateLimitSalt} from "../supabase/functions/submit-suggestion/worker.js";

const REQUEST_ID="018f0c2d-0ec4-7f88-8c8a-cd20274bb20a";
const USER_ID="018f0c2d-0ec4-7f88-8c8a-cd20274bb20b";
const NOW=Date.parse("2026-10-24T12:00:00Z");
const secrets={SUPABASE_URL:"https://example.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"service-secret",SUPABASE_ANON_KEY:"public-browser-key",TURNSTILE_SECRET_KEY:"turnstile-secret",SUGGESTION_RATE_LIMIT_SALT:"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"};
const env=name=>secrets[name];
const payload=(extra={})=>({request_id:REQUEST_ID,category:"funcionalidad",subject:"Nueva variante",description:"Me gustaría otro color disponible",turnstile_token:"valid-token",...extra});
const request=(body=payload(),headers={})=>new Request("https://edge.example/functions/v1/submit-suggestion",{method:"POST",headers:{origin:"https://cubica3d.ar","content-type":"application/json","cf-connecting-ip":"203.0.113.8","user-agent":"qa-browser",...headers},body:JSON.stringify(body)});
const validTurnstile=()=>Response.json({success:true,hostname:"cubica3d.ar",action:"suggestion_submit",challenge_ts:new Date(NOW).toISOString()});

assert.equal(decodeRateLimitSalt(secrets.SUGGESTION_RATE_LIMIT_SALT)?.length,32);
assert.equal(decodeRateLimitSalt("rate-secret-with-at-least-32-characters"),null,"el salt debe ser base64url canónico, no solo una cadena larga");

function mockBackend(result={status:"accepted",suggestion_id:USER_ID,idempotent:false,duplicate:false},{user=null,siteverify=validTurnstile}={}){
  const calls=[];
  const fetchImpl=async(url,options={})=>{
    const entry={url:String(url),options,body:String(options.body||"")};calls.push(entry);
    if(entry.url.includes("/auth/v1/user"))return user?Response.json({id:user}):Response.json({message:"bad token"},{status:401});
    if(entry.url.includes("siteverify"))return siteverify(entry);
    if(entry.url.includes("/rest/v1/rpc/submit_protected_suggestion"))return Response.json(result);
    throw new Error(`unexpected call ${entry.url}`);
  };
  return {calls,fetchImpl};
}

async function response(result,options={},headers={}){
  const mock=mockBackend(result,options);
  const value=await createHandler({env,fetchImpl:mock.fetchImpl,now:()=>NOW})(request(payload(),headers));
  return {value,calls:mock.calls,body:await value.clone().json()};
}

{
  const {value,calls,body}=await response();
  assert.equal(value.status,201);assert.deepEqual(body,{ok:true,id:USER_ID,idempotent:false,duplicate:false});
  assert.equal(calls.filter(x=>x.url.includes("siteverify")).length,1);
  assert.equal(calls.filter(x=>x.url.includes("submit_protected_suggestion")).length,1);
  assert.equal(calls.some(x=>/create[-_]?order|\/orders/i.test(x.url)),false);
  const verify=new URLSearchParams(calls.find(x=>x.url.includes("siteverify")).body);
  assert.equal(verify.get("response"),"valid-token");assert.equal(verify.get("remoteip"),"203.0.113.8");
  assert.notEqual(verify.get("idempotency_key"),REQUEST_ID);assert.match(verify.get("idempotency_key"),/^[0-9a-f-]{36}$/i);
  const rpc=JSON.parse(calls.find(x=>x.url.includes("submit_protected_suggestion")).body);
  assert.equal(rpc.p_actor_kind,"guest");assert.equal(rpc.p_verified_user_id,null);assert.equal(rpc.p_request_id,REQUEST_ID);
  for(const field of ["p_token_hash","p_network_hash","p_actor_hash"])assert.match(rpc[field],/^[0-9a-f]{64}$/);
  assert.equal(new Set([rpc.p_token_hash,rpc.p_network_hash,rpc.p_actor_hash]).size,3);
  assert.equal(JSON.stringify(rpc).includes("valid-token"),false);
  assert.equal(JSON.stringify(rpc).includes(secrets.SUGGESTION_RATE_LIMIT_SALT),false);
}

{
  const {value,calls}=await response(undefined,{}, {authorization:`Bearer ${secrets.SUPABASE_ANON_KEY}`});
  assert.equal(value.status,201);
  assert.equal(calls.some(x=>x.url.includes("/auth/v1/user")),false);
  const rpc=JSON.parse(calls.find(x=>x.url.includes("submit_protected_suggestion")).body);
  assert.equal(rpc.p_actor_kind,"guest");assert.equal(rpc.p_verified_user_id,null);
}

{
  const modern={
    SUPABASE_URL:secrets.SUPABASE_URL,
    SUPABASE_SECRET_KEYS:JSON.stringify({default:secrets.SUPABASE_SERVICE_ROLE_KEY}),
    SUPABASE_PUBLISHABLE_KEYS:JSON.stringify({default:secrets.SUPABASE_ANON_KEY}),
    TURNSTILE_SECRET_KEY:secrets.TURNSTILE_SECRET_KEY,
    SUGGESTION_RATE_LIMIT_SALT:secrets.SUGGESTION_RATE_LIMIT_SALT
  };
  const mock=mockBackend();
  const value=await createHandler({env:name=>modern[name],fetchImpl:mock.fetchImpl,now:()=>NOW})(request(payload(),{authorization:`Bearer ${secrets.SUPABASE_ANON_KEY}`}));
  assert.equal(value.status,201,"las variables administradas actuales de Supabase deben ser compatibles");
  assert.equal(mock.calls.some(x=>x.url.includes("/auth/v1/user")),false);
}

{
  const invalid={...secrets,SUGGESTION_RATE_LIMIT_SALT:"not-a-32-byte-salt"};
  const mock=mockBackend();
  const value=await createHandler({env:name=>invalid[name],fetchImpl:mock.fetchImpl,now:()=>NOW})(request());
  assert.equal(value.status,503);assert.deepEqual(await value.json(),{error:"suggestion_protection_not_configured"});
  assert.equal(mock.calls.length,0);
}

{
  const {value,calls}=await response(undefined,{user:USER_ID},{authorization:"Bearer valid-session"});
  assert.equal(value.status,201);const rpc=JSON.parse(calls.find(x=>x.url.includes("submit_protected_suggestion")).body);
  assert.equal(rpc.p_actor_kind,"user");assert.equal(rpc.p_verified_user_id,USER_ID);
}

{
  const mock=mockBackend(undefined,{user:null});
  const value=await createHandler({env,fetchImpl:mock.fetchImpl,now:()=>NOW})(request(payload(),{authorization:"Bearer invalid-session"}));
  assert.equal(value.status,401);assert.deepEqual(await value.json(),{error:"invalid_session"});
  assert.equal(mock.calls.some(x=>x.url.includes("siteverify")||x.url.includes("/rest/v1/rpc/")),false);
}

for(const [result,status,expected] of [
  [{status:"accepted",suggestion_id:USER_ID,idempotent:true,duplicate:false},200,{idempotent:true,duplicate:false}],
  [{status:"accepted",suggestion_id:USER_ID,idempotent:false,duplicate:true},200,{idempotent:false,duplicate:true}],
  [{status:"idempotency_conflict"},409,{error:"idempotency_conflict"}],
  [{status:"token_replayed"},409,{error:"turnstile_replayed"}],
  [{status:"rate_limited",retry_after_seconds:73},429,{error:"rate_limited"}]
]){
  const {value,body}=await response(result);
  assert.equal(value.status,status);
  if(status===200){assert.equal(body.idempotent,expected.idempotent);assert.equal(body.duplicate,expected.duplicate);}
  else assert.deepEqual(body,expected);
  if(status===429)assert.equal(value.headers.get("retry-after"),"73");
}

for(const [turnstile,status,error] of [
  [{success:false,"error-codes":["invalid-input-response"]},400,"turnstile_invalid"],
  [{success:false,"error-codes":["timeout-or-duplicate"]},400,"turnstile_expired_or_used"],
  [{success:true,hostname:"evil.example",action:"suggestion_submit",challenge_ts:new Date(NOW).toISOString()},403,"turnstile_hostname_mismatch"],
  [{success:true,hostname:"cubica3d.ar",action:"wrong",challenge_ts:new Date(NOW).toISOString()},403,"turnstile_action_mismatch"],
  [{success:true,hostname:"cubica3d.ar",action:"suggestion_submit",challenge_ts:new Date(NOW-331000).toISOString()},400,"turnstile_expired_or_used"]
]){
  const mock=mockBackend(undefined,{siteverify:()=>Response.json(turnstile)});
  const value=await createHandler({env,fetchImpl:mock.fetchImpl,now:()=>NOW})(request());
  assert.equal(value.status,status);assert.deepEqual(await value.json(),{error});
  assert.equal(mock.calls.some(x=>x.url.includes("/rest/v1/rpc/")),false);
}

{
  let attempts=0;const keys=[];
  const mock=mockBackend(undefined,{siteverify:entry=>{attempts++;keys.push(new URLSearchParams(entry.body).get("idempotency_key"));throw new Error("network");}});
  const value=await createHandler({env,fetchImpl:mock.fetchImpl,now:()=>NOW})(request());
  assert.equal(value.status,503);assert.deepEqual(await value.json(),{error:"turnstile_unavailable"});assert.equal(attempts,2);assert.equal(new Set(keys).size,1);
}

{
  const mock=mockBackend();const bad=request(payload());bad.headers.delete("cf-connecting-ip");
  const value=await createHandler({env,fetchImpl:mock.fetchImpl,now:()=>NOW})(bad);
  assert.equal(value.status,503);assert.deepEqual(await value.json(),{error:"network_identity_unavailable"});assert.equal(mock.calls.length,0);
}

{
  const mock=mockBackend();const original=mock.fetchImpl;
  mock.fetchImpl=async(url,options)=>String(url).includes("submit_protected_suggestion")?Response.json({message:"down"},{status:500}):original(url,options);
  const value=await createHandler({env,fetchImpl:mock.fetchImpl,now:()=>NOW})(request());
  assert.equal(value.status,503);assert.deepEqual(await value.json(),{error:"database_error"});
}

{
  let rpcAttempt=0;
  const accepted={status:"accepted",suggestion_id:USER_ID,idempotent:true,duplicate:false};
  const mock=mockBackend(accepted,{siteverify:validTurnstile});
  const original=mock.fetchImpl;
  mock.fetchImpl=async(url,options)=>{
    if(String(url).includes("submit_protected_suggestion")&&++rpcAttempt===1)throw new Error("response lost after commit");
    return original(url,options);
  };
  const handler=createHandler({env,fetchImpl:mock.fetchImpl,now:()=>NOW});
  const first=await handler(request(payload({turnstile_token:"first-valid-token"})));
  assert.equal(first.status,503);assert.deepEqual(await first.json(),{error:"suggestion_failed"});
  const second=await handler(request(payload({turnstile_token:"second-valid-token"})));
  assert.equal(second.status,200);assert.equal((await second.json()).idempotent,true,"un reintento con el mismo request_id debe reconciliar el commit ambiguo sin duplicar");
}

console.log("Contrato Edge 5B v3: escenarios de seguridad, compatibilidad e idempotencia superados; sin llamadas a producción.");
