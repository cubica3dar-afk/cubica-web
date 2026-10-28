const MAX_BODY_BYTES=16*1024;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CATEGORIES=new Set(["funcionalidad","visual","error","compra","otro"]);

export class SuggestionError extends Error{
  constructor(code,status=400,retryAfter=0){super(code);this.code=code;this.status=status;this.retryAfter=retryAfter;}
}
async function readJson(request){
  const length=Number(request.headers.get("content-length")||0);
  if(length>MAX_BODY_BYTES)throw new SuggestionError("request_too_large",413);
  const text=await request.text();
  if(new TextEncoder().encode(text).length>MAX_BODY_BYTES)throw new SuggestionError("request_too_large",413);
  try{return JSON.parse(text);}catch{throw new SuggestionError("invalid_json");}
}
const clean=(value,max)=>String(value??"").trim().slice(0,max);
export function normalizeSuggestion(body){
  if(!body||typeof body!=="object"||Array.isArray(body))throw new SuggestionError("invalid_request");
  const requestId=clean(body.request_id,40),category=clean(body.category,30),subject=clean(body.subject,160),description=clean(body.description,3000),contact=clean(body.contact,320),token=clean(body.turnstile_token,2048);
  if(!UUID.test(requestId)||!CATEGORIES.has(category)||subject.length<3||description.length<10||!token)throw new SuggestionError("invalid_request");
  return {requestId,category,subject,description,contact,token};
}

async function sha256(value){
  const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
function runtimeKeySet(env,setName,...legacyNames){
  let values=[];
  try{values=Object.values(JSON.parse(env(setName)||"{}"));}catch{}
  return [...new Set([...values,...legacyNames.map(name=>env(name))].filter(value=>typeof value==="string"&&value))];
}
export function decodeRateLimitSalt(value){
  const encoded=String(value||"").trim();
  if(!encoded||!/^[A-Za-z0-9_-]+$/.test(encoded)||encoded.length%4===1)return null;
  try{
    const padded=(encoded.replace(/-/g,"+").replace(/_/g,"/")+"===".slice((encoded.length+3)%4));
    const bytes=Uint8Array.from(atob(padded),char=>char.charCodeAt(0));
    return bytes.length>=32?bytes:null;
  }catch{return null;}
}
function verificationUuid(hex){
  const value=hex.slice(0,32).split("");value[12]="4";value[16]=((parseInt(value[16],16)&3)|8).toString(16);
  const compact=value.join("");return `${compact.slice(0,8)}-${compact.slice(8,12)}-${compact.slice(12,16)}-${compact.slice(16,20)}-${compact.slice(20)}`;
}
function address(request){
  const forwarded=(request.headers.get("x-forwarded-for")||"").split(",")[0].trim();
  const value=clean(request.headers.get("cf-connecting-ip")||forwarded,100);
  const ipv4=/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)&&value.split(".").every(part=>Number(part)<=255);
  const ipv6=value.includes(":")&&/^[0-9a-f:.]+$/i.test(value);
  if(!ipv4&&!ipv6)throw new SuggestionError("network_identity_unavailable",503);
  return value;
}

async function verifyTurnstile(token,secret,remoteip,idempotencyKey,fetchImpl,now){
  const form=new URLSearchParams({secret,response:token,idempotency_key:idempotencyKey,remoteip});
  let response=null;
  for(let attempt=0;attempt<2;attempt++){
    try{
      response=await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:form,signal:AbortSignal.timeout(8000)});
      if(response.ok)break;
      if(response.status<500)throw new SuggestionError("turnstile_invalid");
    }catch(error){if(error instanceof SuggestionError)throw error;response=null;}
  }
  if(!response?.ok)throw new SuggestionError("turnstile_unavailable",503);
  const result=await response.json().catch(()=>null);
  if(!result?.success){
    const codes=Array.isArray(result?.["error-codes"])?result["error-codes"]:[];
    throw new SuggestionError(codes.includes("timeout-or-duplicate")?"turnstile_expired_or_used":"turnstile_invalid");
  }
  if(!new Set(["cubica3d.ar","www.cubica3d.ar"]).has(String(result.hostname||"").toLowerCase()))throw new SuggestionError("turnstile_hostname_mismatch",403);
  if(result.action!=="suggestion_submit")throw new SuggestionError("turnstile_action_mismatch",403);
  const challenged=Date.parse(result.challenge_ts);
  if(!Number.isFinite(challenged)||challenged>now()+60000||challenged<now()-330000)throw new SuggestionError("turnstile_expired_or_used");
}

function backend(url,key,fetchImpl){
  const base=url.replace(/\/$/,"");
  async function rpc(name,args){
    const response=await fetchImpl(`${base}/rest/v1/rpc/${name}`,{method:"POST",headers:{apikey:key,Authorization:`Bearer ${key}`,"Content-Type":"application/json"},body:JSON.stringify(args),signal:AbortSignal.timeout(10000)});
    if(!response.ok){const detail=await response.json().catch(()=>({})),message=String(detail.message||"");if(message.includes("suggestion_rate_limit"))throw new SuggestionError("rate_limited",429,3600);throw new SuggestionError(detail.code==="23505"?"already_submitted":"database_error",detail.code==="23505"?409:503);}
    const value=await response.text();return value?JSON.parse(value):null;
  }
  async function user(token){
    if(!token)return null;
    const response=await fetchImpl(`${base}/auth/v1/user`,{headers:{apikey:key,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(7000)});
    if(!response.ok)throw new SuggestionError("invalid_session",401);
    const value=await response.json();if(!UUID.test(value?.id||""))throw new SuggestionError("invalid_session",401);return value.id;
  }
  return {rpc,user};
}

function publicBrowserCredential(token,publicKeys){
  if(!token)return true;
  return publicKeys.includes(token);
}

export function createHandler({env,fetchImpl=fetch,now=Date.now}={}){
  return async request=>{
    const origin=request.headers.get("origin"),allowed=new Set(["https://cubica3d.ar","https://www.cubica3d.ar"]);
    const headers={"Content-Type":"application/json","Cache-Control":"no-store",Vary:"Origin"};
    if(origin&&allowed.has(origin))headers["Access-Control-Allow-Origin"]=origin;
    if(origin&&!allowed.has(origin))return Response.json({error:"origin_not_allowed"},{status:403,headers});
    if(request.method==="OPTIONS")return new Response(null,{status:204,headers:{...headers,"Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"authorization, apikey, content-type"}});
    if(request.method!=="POST")return Response.json({error:"method_not_allowed"},{status:405,headers});
    const url=env("SUPABASE_URL"),key=runtimeKeySet(env,"SUPABASE_SECRET_KEYS","SUPABASE_SERVICE_ROLE_KEY")[0]||"",publicKeys=runtimeKeySet(env,"SUPABASE_PUBLISHABLE_KEYS","SUPABASE_ANON_KEY","SUPABASE_PUBLISHABLE_KEY"),secret=env("TURNSTILE_SECRET_KEY"),salt=env("SUGGESTION_RATE_LIMIT_SALT");
    if(!url||!key||!secret||!decodeRateLimitSalt(salt))return Response.json({error:"suggestion_protection_not_configured"},{status:503,headers});
    try{
      const value=normalizeSuggestion(await readJson(request)),remote=address(request),api=backend(url,key,fetchImpl);
      const bearer=(request.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1]||"";
      const userId=publicBrowserCredential(bearer,publicKeys)?null:await api.user(bearer);
      const tokenHash=await sha256(`${salt}:suggestion-token:${value.token}`);
      const networkHash=await sha256(`${salt}:suggestion-network:${remote}`);
      const actorKind=userId?"user":"guest";
      const actorSource=userId||`${remote}:${clean(request.headers.get("user-agent")||"unknown",300)}`;
      const actorHash=await sha256(`${salt}:suggestion-actor:${actorKind}:${actorSource}`);
      const idempotencyKey=verificationUuid(await sha256(`${salt}:suggestion-siteverify:${value.requestId}:${tokenHash}`));
      await verifyTurnstile(value.token,secret,remote,idempotencyKey,fetchImpl,now);
      const result=await api.rpc("submit_protected_suggestion",{
        p_token_hash:tokenHash,p_network_hash:networkHash,p_actor_hash:actorHash,p_actor_kind:actorKind,
        p_category:value.category,p_subject:value.subject,p_description:value.description,p_contact:value.contact||null,
        p_request_id:value.requestId,p_verified_user_id:userId
      });
      if(result?.status==="accepted")return Response.json({ok:true,id:result.suggestion_id,idempotent:result.idempotent===true,duplicate:result.duplicate===true},{status:result.idempotent||result.duplicate?200:201,headers});
      if(result?.status==="idempotency_conflict")throw new SuggestionError("idempotency_conflict",409);
      if(result?.status==="token_replayed")throw new SuggestionError("turnstile_replayed",409);
      if(result?.status==="rate_limited")throw new SuggestionError("rate_limited",429,Number(result.retry_after_seconds)||3600);
      throw new SuggestionError("database_error",503);
    }catch(error){
      const known=error instanceof SuggestionError,responseHeaders={...headers};
      if(known&&error.retryAfter>0)responseHeaders["Retry-After"]=String(error.retryAfter);
      return Response.json({error:known?error.code:"suggestion_failed"},{status:known?error.status:503,headers:responseHeaders});
    }
  };
}

