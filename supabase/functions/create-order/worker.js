const MAX_BODY_BYTES=48*1024;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GUEST_TOKEN=/^[0-9a-f]{64}$/;
const TEST_SECRETS=new Set([
  "1x0000000000000000000000000000000AA",
  "2x0000000000000000000000000000000AA",
  "3x0000000000000000000000000000000AA",
]);

export class OrderError extends Error{
  constructor(code,status=400,retryAfter=0){super(code);this.code=code;this.status=status;this.retryAfter=retryAfter;}
}

async function readJson(request){
  const length=Number(request.headers.get("content-length")||0);
  if(length>MAX_BODY_BYTES)throw new OrderError("request_too_large",413);
  if(!request.body)throw new OrderError("invalid_request");
  const reader=request.body.getReader(),chunks=[];let total=0;
  try{
    while(true){
      const {value,done}=await reader.read();if(done)break;
      total+=value.byteLength;if(total>MAX_BODY_BYTES){await reader.cancel();throw new OrderError("request_too_large",413);}chunks.push(value);
    }
    const bytes=new Uint8Array(total);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    return JSON.parse(new TextDecoder().decode(bytes));
  }catch(error){if(error instanceof OrderError)throw error;throw new OrderError("invalid_json");}
  finally{reader.releaseLock();}
}

const text=(value,max)=>String(value??"").trim().slice(0,max);

export function normalizeOrderRequest(body){
  if(!body||typeof body!=="object"||Array.isArray(body))throw new OrderError("invalid_request");
  const delivery=body.delivery;
  if(!delivery||typeof delivery!=="object"||Array.isArray(delivery))throw new OrderError("invalid_delivery");
  const requestId=text(delivery.request_id,40),clientId=text(body.client_order_id,160),mode=delivery.mode;
  if(!UUID.test(requestId)||clientId!==requestId||!["pickup","shipping"].includes(mode)||!GUEST_TOKEN.test(delivery.quote_token||""))throw new OrderError("invalid_request");
  if(!Array.isArray(body.items)||body.items.length<1||body.items.length>50)throw new OrderError("invalid_items");
  const items=body.items.map(item=>{
    const product=text(item?.product_id,100),color=text(item?.color,120),qty=Number(item?.qty);
    if(!product||!Number.isSafeInteger(qty)||qty<1||qty>100)throw new OrderError("invalid_items");
    return {product_id:product,qty,color};
  });
  const normalizedDelivery={mode,request_id:requestId,quote_token:delivery.quote_token};
  if(mode==="shipping"){
    if(!UUID.test(delivery.quote_id||"")||!delivery.address||typeof delivery.address!=="object"||Array.isArray(delivery.address))throw new OrderError("invalid_delivery");
    const fields=["recipient","phone","street","number","floor","apartment","city","province","postal_code","instructions"];
    normalizedDelivery.quote_id=delivery.quote_id;
    normalizedDelivery.address=Object.fromEntries(fields.map(field=>[field,text(delivery.address[field],field==="instructions"?500:200)]));
  }
  const token=text(body.turnstile_token,2048);
  if(!token)throw new OrderError("turnstile_required",400);
  return {
    token,requestId,guestToken:delivery.quote_token,
    rpc:{
      p_client_order_id:clientId,p_customer_name:text(body.customer_name,120),
      p_customer_email:text(body.customer_email,180).toLowerCase(),p_phone:text(body.phone,80),
      p_payment:text(body.payment,40),p_notes:String(body.notes??"").slice(0,1500),
      p_items:items,p_delivery:normalizedDelivery,
    }
  };
}

function normalizeVerificationRequest(body){
  if(!body||typeof body!=="object"||Array.isArray(body)||body.verification_only!==true)throw new OrderError("invalid_request");
  const token=text(body.turnstile_token,2048),requestId=text(body.client_order_id,40);
  if(!token)throw new OrderError("turnstile_required",400);
  if(!UUID.test(requestId))throw new OrderError("invalid_request");
  return {token,requestId};
}

export function createBackendClient(url,serviceKey,fetchImpl=fetch){
  const base=url.replace(/\/$/,"");
  return {
    async getUser(token){
      try{
        const response=await fetchImpl(`${base}/auth/v1/user`,{headers:{apikey:serviceKey,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(7000)});
        if(!response.ok)return {user:null,error:true};
        const user=await response.json();return {user:UUID.test(user?.id||"")?user:null,error:!UUID.test(user?.id||"")};
      }catch{return {user:null,error:true};}
    },
    async rpc(name,args){
      try{
        const response=await fetchImpl(`${base}/rest/v1/rpc/${name}`,{
          method:"POST",headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,"Content-Type":"application/json"},
          body:JSON.stringify(args),signal:AbortSignal.timeout(12000),
        });
        if(!response.ok){
          let code="database_error",retryAfter=0;
          try{
            const error=await response.json(),message=String(error.message||"");
            const limited=message.match(/^order_rate_limit:(\d+)$/);
            if(limited){code="order_rate_limit";retryAfter=Number(limited[1])||60;}
            else if(/^order_[a-z_]+$/.test(message))code=message;
            else if(error.code==="42501")code="order_not_available";
            else if(["22023","22P02","23514"].includes(error.code))code="invalid_order";
          }catch{/* return only a fixed safe code */}
          return {data:null,error:{code,retryAfter}};
        }
        return {data:await response.json(),error:null};
      }catch{return {data:null,error:{code:"database_unavailable",retryAfter:0}};}
    }
  };
}

async function callRpc(client,name,args){
  const result=await client.rpc(name,args);
  if(result.error){
    const status=result.error.code==="order_rate_limit"?429:result.error.code==="order_not_available"?403:503;
    throw new OrderError(result.error.code||"database_error",status,result.error.retryAfter||0);
  }
  return result.data;
}

export async function verifyTurnstile({token,secret,remoteip,idempotencyKey,expectedHostnames,expectedAction,fetchImpl=fetch,now=Date.now}){
  let response;
  try{
    const form=new URLSearchParams({secret,response:token,idempotency_key:idempotencyKey});
    if(remoteip&&remoteip!=="unknown")form.set("remoteip",remoteip);
    response=await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify",{
      method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:form,signal:AbortSignal.timeout(8000),
    });
  }catch{throw new OrderError("turnstile_unavailable",503);}
  if(!response.ok)throw new OrderError("turnstile_unavailable",503);
  let result;try{result=await response.json();}catch{throw new OrderError("turnstile_unavailable",503);}
  if(!result?.success){
    const codes=Array.isArray(result?.["error-codes"])?result["error-codes"]:[];
    throw new OrderError(codes.includes("timeout-or-duplicate")?"turnstile_expired_or_used":"turnstile_invalid",400);
  }
  if(!expectedHostnames.has(String(result.hostname||"").toLowerCase()))throw new OrderError("turnstile_hostname_mismatch",403);
  if(String(result.action||"")!==expectedAction)throw new OrderError("turnstile_action_mismatch",403);
  const challenged=Date.parse(result.challenge_ts);
  if(!Number.isFinite(challenged)||challenged>now()+60000||challenged<now()-330000)throw new OrderError("turnstile_expired_or_used",400);
  return true;
}

export async function hashKey(prefix,value,salt,cryptoImpl=crypto){
  const digest=await cryptoImpl.subtle.digest("SHA-256",new TextEncoder().encode(`${salt}:${prefix}:${value}`));
  return `${prefix}:`+[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");
}

export function remoteAddress(request){
  const cloudflare=request.headers.get("cf-connecting-ip")?.trim();
  if(cloudflare)return cloudflare.slice(0,100);
  const forwarded=request.headers.get("x-forwarded-for")||"";
  return forwarded.split(",").at(-1)?.trim().slice(0,100)||"unknown";
}

const positiveInt=(value,fallback,min,max)=>{const number=Number(value);return Number.isInteger(number)&&number>=min&&number<=max?number:fallback;};

export function createHandler({env,createClient=createBackendClient,fetchImpl=fetch,cryptoImpl=crypto,now=Date.now}={}){
  return async request=>{
    const origin=request.headers.get("origin");
    const origins=new Set(["https://cubica3d.ar","https://www.cubica3d.ar",...String(env("ORDER_ALLOWED_ORIGINS")||"").split(",").map(x=>x.trim()).filter(Boolean)]);
    const headers={"Content-Type":"application/json","Cache-Control":"no-store",Vary:"Origin"};
    if(origin&&origins.has(origin))headers["Access-Control-Allow-Origin"]=origin;
    if(origin&&!origins.has(origin))return Response.json({error:"origin_not_allowed"},{status:403,headers});
    if(request.method==="OPTIONS")return new Response(null,{status:204,headers:{...headers,"Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"authorization, apikey, x-client-info, content-type"}});
    if(request.method!=="POST")return Response.json({error:"method_not_allowed"},{status:405,headers});

    const url=env("SUPABASE_URL"),serviceKey=env("SUPABASE_SERVICE_ROLE_KEY"),secret=env("TURNSTILE_SECRET_KEY"),salt=env("ORDER_RATE_LIMIT_SALT");
    if(!url||!serviceKey||!secret||!salt||TEST_SECRETS.has(secret)&&env("TURNSTILE_ALLOW_TEST_KEYS")!=="true"){
      return Response.json({error:"order_protection_not_configured"},{status:503,headers});
    }
    try{
      const body=await readJson(request);
      if(body?.verification_only===true){
        const verification=normalizeVerificationRequest(body);
        await verifyTurnstile({
          token:verification.token,secret,remoteip:remoteAddress(request),idempotencyKey:verification.requestId,
          expectedHostnames:new Set(String(env("TURNSTILE_EXPECTED_HOSTNAMES")||"cubica3d.ar,www.cubica3d.ar").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean)),
          expectedAction:env("TURNSTILE_EXPECTED_ACTION")||"create_order",fetchImpl,now,
        });
        return Response.json({ok:true,verified:true,configuration_ready:true},{headers});
      }
      const order=normalizeOrderRequest(body);
      const client=createClient(url,serviceKey,fetchImpl);
      const authorization=request.headers.get("authorization")||"",bearer=authorization.match(/^Bearer\s+(.+)$/i)?.[1]||"";
      if(authorization&&!bearer)throw new OrderError("invalid_authentication",401);
      let userId=null;
      if(bearer&&bearer!==request.headers.get("apikey")&&bearer!==env("SUPABASE_ANON_KEY")){
        const {user,error}=await client.getUser(bearer);
        if(error||!user)throw new OrderError("invalid_authentication",401);
        userId=user.id;
      }
      const identity={...order.rpc,p_user_id:userId};
      const existing=await callRpc(client,"lookup_verified_delivery_order",identity);
      if(existing)return Response.json(existing,{headers});

      const address=remoteAddress(request);
      try{
        await verifyTurnstile({
          token:order.token,secret,remoteip:address,idempotencyKey:order.requestId,
          expectedHostnames:new Set(String(env("TURNSTILE_EXPECTED_HOSTNAMES")||"cubica3d.ar,www.cubica3d.ar").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean)),
          expectedAction:env("TURNSTILE_EXPECTED_ACTION")||"create_order",fetchImpl,now,
        });
      }catch(error){
        if(error instanceof OrderError&&error.code==="turnstile_expired_or_used"){
          const replay=await callRpc(client,"lookup_verified_delivery_order",identity);
          if(replay)return Response.json(replay,{headers});
        }
        throw error;
      }

      const identityPrefix=userId?"auth":"guest",identityValue=userId||order.guestToken;
      const limits=[
        {key:await hashKey(identityPrefix,identityValue,salt,cryptoImpl),limit:positiveInt(env(userId?"ORDER_AUTH_10M_LIMIT":"ORDER_GUEST_10M_LIMIT"),userId?5:4,1,100),window_seconds:600},
        {key:await hashKey(identityPrefix,identityValue,salt,cryptoImpl),limit:positiveInt(env(userId?"ORDER_AUTH_HOURLY_LIMIT":"ORDER_GUEST_HOURLY_LIMIT"),userId?12:8,1,500),window_seconds:3600},
        {key:await hashKey("ip",address,salt,cryptoImpl),limit:positiveInt(env("ORDER_IP_10M_LIMIT"),12,1,500),window_seconds:600},
        {key:await hashKey("ip",address,salt,cryptoImpl),limit:positiveInt(env("ORDER_IP_HOURLY_LIMIT"),40,1,1000),window_seconds:3600},
      ];
      const created=await callRpc(client,"create_verified_delivery_order",{...identity,p_rate_limits:limits});
      return Response.json(created,{status:201,headers});
    }catch(error){
      const known=error instanceof OrderError,response={error:known?error.code:"order_creation_failed"};
      if(known&&error.retryAfter>0){response.retry_after=error.retryAfter;headers["Retry-After"]=String(error.retryAfter);}
      return Response.json(response,{status:known?error.status:503,headers});
    }
  };
}

