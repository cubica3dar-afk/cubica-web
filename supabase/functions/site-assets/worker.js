const TYPES={
  "image/png":"png","image/jpeg":"jpg","image/webp":"webp"
};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class AssetError extends Error{constructor(code,status=400){super(code);this.code=code;this.status=status;}}
export function inspectImage(bytes,mime){
  if(!(bytes instanceof Uint8Array)||bytes.length<24||bytes.length>8388608||!TYPES[mime])throw new AssetError("invalid_image");
  let width=0,height=0,valid=false;
  if(mime==="image/png"&&bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71){
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);width=view.getUint32(16);height=view.getUint32(20);valid=true;
  }else if(mime==="image/webp"&&String.fromCharCode(...bytes.slice(0,4))==="RIFF"&&String.fromCharCode(...bytes.slice(8,12))==="WEBP"){
    const kind=String.fromCharCode(...bytes.slice(12,16));
    if(kind==="VP8X"&&bytes.length>=30){width=1+bytes[24]+(bytes[25]<<8)+(bytes[26]<<16);height=1+bytes[27]+(bytes[28]<<8)+(bytes[29]<<16);valid=true;}
    else if(kind==="VP8 "&&bytes.length>=30&&bytes[23]===157&&bytes[24]===1&&bytes[25]===42){width=((bytes[27]<<8)+bytes[26])&0x3fff;height=((bytes[29]<<8)+bytes[28])&0x3fff;valid=true;}
    else if(kind==="VP8L"&&bytes.length>=25&&bytes[20]===47){width=1+bytes[21]+((bytes[22]&63)<<8);height=1+(bytes[22]>>6)+(bytes[23]<<2)+((bytes[24]&15)<<10);valid=true;}
  }else if(mime==="image/jpeg"&&bytes[0]===255&&bytes[1]===216){
    let i=2;while(i+9<bytes.length){if(bytes[i]!==255){i++;continue;}const marker=bytes[i+1],len=(bytes[i+2]<<8)+bytes[i+3];if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){height=(bytes[i+5]<<8)+bytes[i+6];width=(bytes[i+7]<<8)+bytes[i+8];valid=true;break;}if(len<2)break;i+=2+len;}
  }
  if(!valid||width<1||height<1||width>8192||height>8192)throw new AssetError("invalid_image_dimensions");
  return {mime,extension:TYPES[mime],width,height,size:bytes.length};
}
async function fingerprint(kind,label,mime,bytes){
  const prefix=new TextEncoder().encode(`${kind}\0${label}\0${mime}\0`),input=new Uint8Array(prefix.length+bytes.length);input.set(prefix);input.set(bytes,prefix.length);
  const digest=[...new Uint8Array(await crypto.subtle.digest("SHA-256",input))].map(value=>value.toString(16).padStart(2,"0")).join("");
  const value=digest.slice(0,32).split("");value[12]="4";value[16]=((parseInt(value[16],16)&3)|8).toString(16);const compact=value.join("");
  return `${compact.slice(0,8)}-${compact.slice(8,12)}-${compact.slice(12,16)}-${compact.slice(16,20)}-${compact.slice(20)}`;
}
function configuredAsset(configuration,path){return (Array.isArray(configuration?.assets)?configuration.assets:[]).find(asset=>asset?.storage_path===path&&!asset?.retired_at)||null;}
function runtimeKey(env,setName,...legacyNames){
  try{
    const parsed=JSON.parse(env(setName)||"{}");
    const value=Object.values(parsed).find(item=>typeof item==="string"&&item);
    if(value)return value;
  }catch{}
  return legacyNames.map(name=>env(name)).find(Boolean)||"";
}
export function createHandler({env,fetchImpl=fetch}={}){
  return async request=>{
    const origin=request.headers.get("origin"),allowed=new Set(["https://cubica3d.ar","https://www.cubica3d.ar"]),headers={"Content-Type":"application/json","Cache-Control":"no-store",Vary:"Origin"};
    if(origin&&allowed.has(origin))headers["Access-Control-Allow-Origin"]=origin;
    if(origin&&!allowed.has(origin))return Response.json({error:"origin_not_allowed"},{status:403,headers});
    if(request.method==="OPTIONS")return new Response(null,{status:204,headers:{...headers,"Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"authorization, apikey, content-type"}});
    if(request.method!=="POST")return Response.json({error:"method_not_allowed"},{status:405,headers});
    const url=env("SUPABASE_URL")?.replace(/\/$/,""),service=runtimeKey(env,"SUPABASE_SECRET_KEYS","SUPABASE_SERVICE_ROLE_KEY"),authorization=request.headers.get("authorization")||"";
    if(!url||!service)return Response.json({error:"asset_service_not_configured"},{status:503,headers});
    const bearer=authorization.match(/^Bearer\s+(.+)$/i)?.[1];if(!bearer)return Response.json({error:"authentication_required"},{status:401,headers});
    try{
      const auth=await fetchImpl(`${url}/auth/v1/user`,{headers:{apikey:service,Authorization:`Bearer ${bearer}`}});if(!auth.ok)throw new AssetError("authentication_required",401);
      const adminConfiguration=async()=>{const response=await fetchImpl(`${url}/rest/v1/rpc/admin_get_site_configuration`,{method:"POST",headers:{apikey:service,Authorization:`Bearer ${bearer}`,"Content-Type":"application/json"},body:"{}"});if(!response.ok)throw new AssetError("admin_mfa_required",403);return response.json();};
      let configuration=await adminConfiguration();
      const form=await request.formData(),file=form.get("file"),requestId=String(form.get("request_id")||""),kind=String(form.get("kind")||""),label=String(form.get("label")||"").trim();
      if(!(file instanceof File)||!UUID.test(requestId)||!["logo","banner","background","campaign"].includes(kind)||!label||label.length>120)throw new AssetError("invalid_request");
      const bytes=new Uint8Array(await file.arrayBuffer()),info=inspectImage(bytes,file.type),fileId=await fingerprint(kind,label,info.mime,bytes),path=`${requestId}/${fileId}.${info.extension}`;
      const existing=configuredAsset(configuration,path);if(existing)return Response.json({asset:existing,idempotent:true},{status:200,headers});
      const upload=await fetchImpl(`${url}/storage/v1/object/site-assets/${path}`,{method:"POST",headers:{apikey:service,Authorization:`Bearer ${service}`,"Content-Type":info.mime,"x-upsert":"true"},body:bytes});if(!upload.ok)throw new AssetError("upload_failed",503);
      let register;
      try{register=await fetchImpl(`${url}/rest/v1/rpc/admin_register_site_asset`,{method:"POST",headers:{apikey:service,Authorization:`Bearer ${bearer}`,"Content-Type":"application/json"},body:JSON.stringify({p_kind:kind,p_label:label,p_storage_path:path,p_mime_type:info.mime,p_byte_size:info.size,p_width:info.width,p_height:info.height})});}
      catch{throw new AssetError("registration_pending",503);}
      if(!register.ok){
        try{configuration=await adminConfiguration();const reconciled=configuredAsset(configuration,path);if(reconciled)return Response.json({asset:reconciled,idempotent:true},{status:200,headers});}catch(error){if(error instanceof AssetError&&error.code==="admin_mfa_required")throw error;throw new AssetError("registration_pending",503);}
        if(register.status>=500)throw new AssetError("registration_pending",503);
        const cleanup=await fetchImpl(`${url}/storage/v1/object/site-assets/${path}`,{method:"DELETE",headers:{apikey:service,Authorization:`Bearer ${service}`}}).catch(()=>null);
        if(!cleanup?.ok)throw new AssetError("asset_cleanup_failed",503);
        throw new AssetError("registration_failed",register.status===403?403:400);
      }
      return Response.json({asset:await register.json()},{status:201,headers});
    }catch(error){const known=error instanceof AssetError;return Response.json({error:known?error.code:"asset_upload_failed"},{status:known?error.status:503,headers});}
  };
}
