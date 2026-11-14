/* CÚBICA 3D — Etapa C: experiencia pública y configuración administrativa. */
(()=>{
  const $=id=>document.getElementById(id);
  const operationId=()=>window.crypto.randomUUID();
  const escapeHtml=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const DEFAULT_APPEARANCE={colors:{background:"#17172b",panel:"#20213a",panelAlt:"#282a46",text:"#f7f7fb",muted:"#a7a9c0",accent:"#ffffff"},hero:{title:"Objetos hechos para vos.",subtitle:"Explorá los productos disponibles, elegí cantidades y armá tu pedido."},assets:{logo:null,banner:null,background:null}};
  const stageCMode=()=>["admin","full"].includes(window.CUBICA_CONFIG?.stageCMode)?window.CUBICA_CONFIG.stageCMode:"off";
  const adminEnabled=()=>["admin","full"].includes(stageCMode());
  const publicEnabled=()=>stageCMode()==="full";
  const adminAccessAllowed=()=>{
    const current=typeof session==="undefined"?null:session;
    return adminEnabled()&&current?.role==="admin"&&window.cubicaAdminMfaAccessAllowed?.()===true;
  };
  window.cubicaStageCAdminEnabled=adminEnabled;
  window.cubicaStageCPublicEnabled=publicEnabled;
  const state={experience:null,admin:null,welcomePreference:{enabled:false,version:1},adminLoadSequence:0,welcomeLoadSequence:0,tab:"appearance",preview:"desktop",assetUploadRequestId:null,suggestionWidget:null,suggestionRequestId:null,suggestionSubmitting:false,refreshTimer:null,suggestionPage:1,suggestionLifecycle:"active",campaignPage:1,campaignSize:10,phrasePage:1,phraseSize:10,faqPage:1,faqSize:10,calendarCursor:null,campaignDraft:null,campaignOriginal:null,campaignCreateKey:null,campaignAttempt:null,campaignBusy:false,campaignEpoch:0,campaignActionKeys:{},campaignPreviewSequence:0,campaignMessage:""};
  const rpc=async(name,args={})=>{
    const client=window.cubicaSupabase;if(!client)throw new Error("Supabase no está disponible.");
    const {data,error}=await client.rpc(name,args);if(error)throw error;return data;
  };
  const deepMerge=(base,next)=>({
    colors:{...(base.colors||{}),...(next?.colors||{})},hero:{...(base.hero||{}),...(next?.hero||{})},assets:{...(base.assets||{}),...(next?.assets||{})}
  });
  const assetById=id=>state.admin?.assets?.find(asset=>asset.id===id&&!asset.retired_at);
  async function signedAssetUrls(paths={}){
    const client=window.cubicaSupabase;if(!client)return {};
    const entries=await Promise.all(Object.entries(paths).map(async([key,path])=>{
      if(!path)return [key,null];const {data,error}=await client.storage.from("site-assets").createSignedUrl(path,900);return [key,error?null:data?.signedUrl||null];
    }));return Object.fromEntries(entries);
  }
  const validHex=hex=>/^#[0-9a-f]{6}$/i.test(String(hex||"").trim());
  function luminance(hex){const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(x=>x<=.03928?x/12.92:((x+.055)/1.055)**2.4);return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];}
  function contrast(a,b){const l1=luminance(a),l2=luminance(b);return (Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);}
  function validateAppearance(value){
    for(const [key,color] of Object.entries(value.colors||{}))if(!validHex(color))throw new Error(`El color ${key} no es válido.`);
    if(contrast(value.colors.text,value.colors.background)<4.5)throw new Error("El contraste entre texto y fondo debe ser de al menos 4,5:1.");
    if(String(value.hero?.title||"").length>120||String(value.hero?.subtitle||"").length>300)throw new Error("El título o subtítulo supera el límite permitido.");
  }
  function setCssAppearance(appearance,urls={}){
    const value=deepMerge(DEFAULT_APPEARANCE,appearance||{}),root=document.documentElement;
    const vars={background:"--site-bg",panel:"--site-panel",panelAlt:"--site-panel-alt",text:"--site-text",muted:"--site-muted",accent:"--site-accent"};
    Object.entries(vars).forEach(([key,name])=>root.style.setProperty(name,value.colors[key]));
    const title=$("site-hero-title"),subtitle=$("site-hero-subtitle"),hero=$("store-hero");if(title)title.textContent=value.hero.title||DEFAULT_APPEARANCE.hero.title;if(subtitle)subtitle.textContent=value.hero.subtitle||DEFAULT_APPEARANCE.hero.subtitle;
    if(hero){hero.style.setProperty("--site-hero-image",urls.banner?`url("${urls.banner}")`:"none");hero.classList.toggle("has-site-banner",Boolean(urls.banner));}
    document.body.style.setProperty("--site-background-image",urls.background?`url("${urls.background}")`:"none");
    document.querySelectorAll('.brand img,.welcome-logo,.auth-logo').forEach(img=>{img.src=urls.logo||"assets/logo.jpg";});
  }
  function shouldBypassWelcome(){
    if(window.cubicaAuthCallbackBlocked||window.cubicaPasswordRecoveryActive)return true;
    const query=new URLSearchParams(location.search||""),hash=new URLSearchParams((location.hash||"").replace(/^#/,""));
    if(query.has("product")||query.has("view")||query.has("page")||query.has("code"))return true;
    if(["recovery","signup","magiclink","invite"].includes(hash.get("type"))||hash.has("error")||hash.has("access_token")||hash.has("refresh_token")||hash.has("code"))return true;
    const active=document.querySelector?.(".page-section:not(.hidden)");
    return Boolean(active&&active.id!=="section-store");
  }
  function setWelcomeVisible(visible){
    const welcome=$("welcome-view");if(!welcome)return;
    welcome.classList.toggle("hidden",!visible);
    welcome.setAttribute?.("aria-hidden",visible?"false":"true");
    if(visible)window.renderWelcome?.();
  }
  async function resolveWelcomePreference(){
    const request=++state.welcomeLoadSequence;
    setWelcomeVisible(false);
    if(!adminEnabled())return false;
    if(shouldBypassWelcome())return false;
    try{
      const enabled=await rpc("get_welcome_screen_preference");
      if(request!==state.welcomeLoadSequence||shouldBypassWelcome())return false;
      state.welcomePreference={...state.welcomePreference,enabled:enabled===true};
      setWelcomeVisible(enabled===true);
      return enabled===true;
    }catch(error){
      if(request===state.welcomeLoadSequence)setWelcomeVisible(false);
      console.warn("No se pudo leer la preferencia de bienvenida; se abre la tienda directamente.",error);
      return false;
    }
  }
  async function loadPublicExperience(){
    if(!publicEnabled())return false;
    try{
      const experience=await rpc("get_site_experience");state.experience=experience;
      const urls=await signedAssetUrls(experience?.asset_paths||{});setCssAppearance(experience?.appearance,urls);
      if(Array.isArray(experience?.welcome_phrases)&&experience.welcome_phrases.length){window.cubicaWelcomeMessages=experience.welcome_phrases;window.renderWelcome?.();}
      scheduleExperienceRefresh(experience?.next_change_at);
    }catch(error){console.warn("Configuración pública no disponible; se conserva la apariencia segura.",error);setCssAppearance(DEFAULT_APPEARANCE);}
  }
  function scheduleExperienceRefresh(next){
    clearTimeout(state.refreshTimer);const boundary=next?new Date(next).getTime()-Date.now()+1500:Infinity;const delay=Math.max(15000,Math.min(15*60*1000,boundary));state.refreshTimer=setTimeout(loadPublicExperience,Number.isFinite(delay)?delay:15*60*1000);
  }
  function renderMarkdown(value){
    const safe=escapeHtml(value).replace(/\[([^\]]{1,120})\]\((https:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,'<a href="$2" rel="noopener">$1</a>').replace(/\*\*([^*]{1,500})\*\*/g,"<strong>$1</strong>");
    return safe.split(/\n{2,}/).map(block=>{
      const lines=block.split("\n");if(lines.every(line=>/^[-*] /.test(line)))return `<ul>${lines.map(line=>`<li>${line.slice(2)}</li>`).join("")}</ul>`;
      const heading=lines[0].match(/^(#{1,3})\s+(.+)/);if(heading)return `<h${heading[1].length+1}>${heading[2]}</h${heading[1].length+1}>${lines.slice(1).length?`<p>${lines.slice(1).join("<br>")}</p>`:""}`;
      return `<p>${lines.join("<br>")}</p>`;
    }).join("");
  }
  async function openPublicPage(slug,{push=true}={}){
    if(!publicEnabled())return false;
    if(window.cubicaAuthCallbackBlocked||window.cubicaPasswordRecoveryActive)return;
    $("welcome-view")?.classList.add("hidden");
    if(slug==="faq"){showSection("faq");const list=$("public-faq-list");list.innerHTML='<div class="card"><p class="muted">Cargando preguntas…</p></div>';try{const items=await rpc("get_public_faq");list.innerHTML=items.length?items.map(item=>`<details class="public-faq-item card"><summary>${escapeHtml(item.question)}</summary><div>${renderMarkdown(item.answer)}</div></details>`).join(""):'<div class="card"><p class="muted">Todavía no hay preguntas publicadas.</p></div>';}catch{list.innerHTML='<div class="card"><p class="muted">No pudimos cargar las preguntas en este momento.</p></div>';}}
    else if(slug==="suggestions"){showSection("suggestions");await renderSuggestionTurnstile();}
    else{
      showSection("public-content");$("public-content-title").textContent="Cargando…";$("public-content-body").innerHTML="";$("public-content-contact").innerHTML="";
      try{const page=await rpc("get_public_content_page",{p_slug:slug});if(!page){$("public-content-title").textContent="Contenido aún no publicado";$("public-content-body").innerHTML='<p class="muted">Esta página todavía está siendo preparada.</p>';}
        else{$("public-content-title").textContent=page.title;$("public-content-body").innerHTML=renderMarkdown(page.content?.body||"");const contacts=[["Email",page.content?.email],["Teléfono",page.content?.phone],["Instagram",page.content?.instagram],["Dirección",page.content?.address],["Horarios",page.content?.hours],["Información comercial",page.content?.commercial]].filter(x=>x[1]);$("public-content-contact").innerHTML=contacts.map(([label,value])=>`<div><small>${label}</small><strong>${escapeHtml(value)}</strong></div>`).join("");}}
      catch{$("public-content-title").textContent="Información no disponible";$("public-content-body").innerHTML='<p class="muted">No pudimos cargar esta página en este momento.</p>';}
    }
    if(push){const url=new URL(location.href);url.searchParams.delete("product");url.searchParams.delete("view");url.searchParams.set("page",slug);history.pushState({page:slug},"",url);}
  }
  async function loadTurnstile(){
    if(window.turnstile)return window.turnstile;
    if(window.cubicaTurnstile?.load){await window.cubicaTurnstile.load();if(window.turnstile)return window.turnstile;}
    return new Promise((resolve,reject)=>{let script=document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]');if(!script){script=document.createElement("script");script.src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";script.async=true;script.defer=true;document.head.appendChild(script);}const started=Date.now(),timer=setInterval(()=>{if(window.turnstile){clearInterval(timer);resolve(window.turnstile);}else if(Date.now()-started>12000){clearInterval(timer);reject(new Error("No se pudo cargar Turnstile."));}},100);});
  }
  async function renderSuggestionTurnstile(){
    if(!publicEnabled())return;
    const host=$("suggestion-turnstile");if(!host||state.suggestionWidget!==null)return;
    try{const turnstile=await loadTurnstile();state.suggestionWidget=turnstile.render(host,{sitekey:window.CUBICA_CONFIG?.turnstileSiteKey,action:"suggestion_submit",theme:"dark"});}catch(error){$("suggestion-status").textContent=error.message;}
  }
  async function submitSuggestion(event){
    event.preventDefault();if(state.suggestionSubmitting)return;
    if(!publicEnabled())return;
    const form=event.currentTarget,status=$("suggestion-status"),turnstile=window.turnstile,token=state.suggestionWidget!==null?turnstile?.getResponse(state.suggestionWidget):"";if(!token){status.textContent="Completá la verificación anti-spam.";return;}
    state.suggestionRequestId ||= crypto.randomUUID();
    const body={request_id:state.suggestionRequestId,category:$("suggestion-category").value,subject:$("suggestion-subject").value.trim(),description:$("suggestion-description").value.trim(),contact:$("suggestion-contact").value.trim(),turnstile_token:token};status.textContent="Enviando…";state.suggestionSubmitting=true;form.querySelector('button[type="submit"]')?.setAttribute("disabled","");
    try{
      const {data,error}=await window.cubicaSupabase.functions.invoke("submit-suggestion",{body});
      let detail=data;if(error?.context?.json)try{detail=await error.context.json();}catch{}
      if(error||!detail?.ok){const code=detail?.error||"suggestion_failed",messages={idempotency_conflict:"Esta solicitud cambió mientras se enviaba. Revisá el contenido e intentá nuevamente.",turnstile_replayed:"La verificación ya fue utilizada. Completala nuevamente.",turnstile_expired_or_used:"La verificación venció o ya fue utilizada. Completala nuevamente.",turnstile_invalid:"No pudimos validar la verificación.",rate_limited:"Alcanzaste el límite temporal de sugerencias. Intentá más tarde.",invalid_session:"Tu sesión venció. Volvé a iniciar sesión o enviá la sugerencia como invitado.",network_identity_unavailable:"No pudimos validar el origen de la solicitud.",turnstile_unavailable:"La verificación no está disponible en este momento.",database_error:"No pudimos guardar la sugerencia en este momento."};if(code==="idempotency_conflict")state.suggestionRequestId=null;throw new Error(messages[code]||"No se pudo enviar la sugerencia.");}
      form.reset();state.suggestionRequestId=null;status.textContent=detail.idempotent||detail.duplicate?"Tu sugerencia ya había sido recibida.":"Gracias. Recibimos tu sugerencia.";turnstile.reset(state.suggestionWidget);
    }catch(error){status.textContent=error.message||"No se pudo enviar la sugerencia.";turnstile?.reset(state.suggestionWidget);}
    finally{state.suggestionSubmitting=false;form.querySelector('button[type="submit"]')?.removeAttribute("disabled");}
  }

  function tabs(){return `<div class="site-config-tabs" role="tablist">${[["appearance","Estética"],["campaigns","Campañas"],["content","Contenidos"],["suggestions","Sugerencias"],["email","Correos automáticos"]].map(([id,label])=>`<button type="button" class="${state.tab===id?"active":""}" data-site-tab="${id}">${label}</button>`).join("")}</div>`;}
  function appearanceForm(){
    const draft=deepMerge(DEFAULT_APPEARANCE,state.admin?.appearance?.config||{}),colors=draft.colors,assets=state.admin?.assets||[];
    const assetOptions=kind=>`<option value="">Usar recurso predeterminado</option>${assets.filter(a=>a.kind===kind&&!a.retired_at).map(a=>`<option value="${a.id}" ${draft.assets[kind]===a.id?"selected":""}>${escapeHtml(a.label)} · ${a.width}×${a.height}</option>`).join("")}`;
    const welcomeEnabled=state.welcomePreference?.enabled===true;
    return `<section class="card site-welcome-setting"><div><p class="eyebrow">INGRESO A LA WEB</p><h3>Mostrar pantalla de bienvenida</h3><p class="muted">Si está desactivada, visitantes y usuarios ingresan directamente al catálogo. Este ajuste no publica el borrador visual.</p></div><label class="site-switch-row" for="site-welcome-enabled"><input id="site-welcome-enabled" type="checkbox" role="switch" ${welcomeEnabled?"checked":""}><span class="site-switch-control" aria-hidden="true"></span><span><strong id="site-welcome-state">${welcomeEnabled?"Activada":"Desactivada"}</strong><small>Estado global actual</small></span></label><div class="site-config-actions"><button id="site-save-welcome" class="btn secondary" type="button">Guardar preferencia</button></div><p id="site-welcome-status" class="muted" role="status"></p></section><div class="site-config-grid"><form id="site-appearance-form" class="card site-config-form"><h3>Borrador visual</h3><p class="muted">Los cambios quedan en borrador hasta que elijas Publicar.</p><div class="site-color-grid">${[["background","Fondo"],["panel","Panel"],["panelAlt","Panel alternativo"],["text","Texto"],["muted","Texto secundario"],["accent","Acento"]].map(([key,label])=>`<label>${label}<span class="color-field"><input type="color" data-theme-color="${key}" value="${colors[key]}"><input value="${colors[key]}" maxlength="7" data-theme-hex="${key}"></span></label>`).join("")}</div><label>Título principal<input id="site-hero-title-input" maxlength="120" value="${escapeHtml(draft.hero.title)}"></label><label>Subtítulo<textarea id="site-hero-subtitle-input" maxlength="300" rows="3">${escapeHtml(draft.hero.subtitle)}</textarea></label>${[["logo","Logo"],["banner","Banner"],["background","Fondo fotográfico"]].map(([kind,label])=>`<label>${label}<select data-theme-asset="${kind}">${assetOptions(kind)}</select></label>`).join("")}<div id="site-contrast-status" class="site-contrast-status"></div><div class="site-config-actions"><button class="btn secondary" type="submit">Guardar borrador</button><button id="site-reset-appearance" class="btn ghost" type="button">Cancelar cambios</button><button id="site-original-appearance" class="btn ghost" type="button">Valores originales</button><button id="site-publish-appearance" class="btn primary" type="button">Publicar versión</button></div><p id="site-appearance-status" class="muted" role="status"></p></form><aside class="site-preview-wrap"><div class="site-preview-toolbar"><strong>Vista previa</strong><span><button type="button" data-preview-size="desktop" class="${state.preview==="desktop"?"active":""}">Escritorio</button><button type="button" data-preview-size="mobile" class="${state.preview==="mobile"?"active":""}">Móvil</button></span></div><div id="site-preview" class="site-preview ${state.preview}"><div class="site-preview-top"><span class="site-preview-logo">C</span><b>Cúbica</b></div><div class="site-preview-hero"><small>CÚBICA 3D</small><h2></h2><p></p></div><div class="site-preview-products"><i></i><i></i><i></i></div></div></aside></div><section class="card site-assets-panel"><div><h3>Biblioteca visual privada</h3><p class="muted">JPEG, PNG o WebP, hasta 8 MB. Los borradores no son públicos.</p></div><form id="site-asset-upload" class="site-asset-upload"><select id="site-asset-kind"><option value="logo">Logo</option><option value="banner">Banner</option><option value="background">Fondo</option><option value="campaign">Campaña</option></select><input id="site-asset-label" maxlength="120" placeholder="Nombre del recurso" required><input id="site-asset-file" type="file" accept="image/jpeg,image/png,image/webp" required><button class="btn secondary">Subir recurso</button></form><div class="site-asset-list">${assets.length?assets.map(a=>`<article><div><strong>${escapeHtml(a.label)}</strong><span>${a.kind} · ${a.width}×${a.height} · ${Math.ceil(a.byte_size/1024)} KB</span></div><div><em class="${a.retired_at?"muted":"good"}">${a.retired_at?"Retirado":a.public_since?"Publicado":"Privado"}</em>${!a.retired_at?`<button class="btn ghost" type="button" data-retire-asset="${a.id}">Retirar</button>`:""}</div></article>`).join(""):'<p class="muted">No hay recursos cargados.</p>'}</div></section>`;
  }
  function campaignStatus(c){const now=Date.now();if(c.state==="draft")return "Borrador";if(c.state==="disabled")return "Desactivada";if(c.recurrence_mode==="none"){if(new Date(c.starts_at).getTime()>now)return "Programada";if(new Date(c.ends_at).getTime()<=now)return "Finalizada";return "Activa";}return "Programada / recurrente";}
  // Civil dates in Buenos Aires, independent of the browser time zone.
  const CAMPAIGN_ZONE="America/Argentina/Buenos_Aires";
  const campaignDateFormat=new Intl.DateTimeFormat("sv-SE",{timeZone:CAMPAIGN_ZONE,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
  const padCampaign=value=>String(value).padStart(2,"0");
  function campaignLocal(value){
    if(value===null||value===undefined||value==="")return "";
    const p=Object.fromEntries(campaignDateFormat.formatToParts(new Date(value)).map(p=>[p.type,p.value]));
    return p.year+"-"+p.month+"-"+p.day+"T"+p.hour+":"+p.minute+":"+p.second;
  }
  function campaignCivil(value){
    const match=String(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?$/);
    if(!match)throw new Error("Usá una fecha válida con formato AAAA-MM-DDTHH:mm.");
    const [,y,m,d,h,n,s="0",fraction=""]=match,stamp=Date.UTC(+y,+m-1,+d,+h,+n,+s,Number(fraction)*1000),date=new Date(stamp);
    if(+y<1000||date.getUTCFullYear()!==+y||date.getUTCMonth()!==+m-1||date.getUTCDate()!==+d||+h>23||+n>59||+s>59)throw new Error("La fecha u hora no existe.");
    return {stamp,year:+y,month:+m,day:+d,time:h+":"+n+":"+s.padStart(2,"0")+fraction};
  }
  function localToIso(value){
    if(!value)return null;
    const {stamp}=campaignCivil(value);
    // Resolve the IANA offset (including historical DST), never the host offset.
    const milliseconds=((stamp%1000)+1000)%1000,whole=stamp-milliseconds;
    let instant=whole;
    for(let i=0;i<4;i++){
      const delta=whole-campaignCivil(campaignLocal(instant)).stamp;
      if(delta===0)return new Date(instant+milliseconds).toISOString();
      instant+=delta;
    }
    throw new Error("La hora no existe en Buenos Aires.");
  }
  function campaignMonth(){
    const [year,month]=(state.calendarCursor||campaignLocal(Date.now()).slice(0,7)).split("-").map(Number);
    return {year,month,first:year+"-"+padCampaign(month)+"-01",days:new Date(Date.UTC(year,month,0)).getUTCDate(),offset:(new Date(Date.UTC(year,month-1,1)).getUTCDay()+6)%7};
  }
  function moveCampaignMonth(amount){
    const {year,month}=campaignMonth(),next=new Date(Date.UTC(year,month-1+amount,1));
    state.calendarCursor=next.getUTCFullYear()+"-"+padCampaign(next.getUTCMonth()+1);
  }
  function nextCampaignDay(day){
    const date=new Date(day+"T12:00:00Z");date.setUTCDate(date.getUTCDate()+1);return date.toISOString().slice(0,10);
  }
  function campaignMonthRange(){
    const {year,month,first}=campaignMonth(),next=new Date(Date.UTC(year,month,1)).toISOString().slice(0,10);
    return [Date.parse(localToIso(first+"T00:00")),Date.parse(localToIso(next+"T00:00"))];
  }
  function campaignIntervals(c,from,to,occurrences=state.admin?.occurrences||[]){
    if(c.deleted_at)return [];
    let ranges=[];
    if(c.recurrence_mode==="none")ranges=[[Date.parse(c.starts_at),Date.parse(c.ends_at)]];
    if(c.recurrence_mode==="custom")ranges=occurrences.filter(o=>o.campaign_id===c.id).map(o=>[Date.parse(o.starts_at),Date.parse(o.ends_at)]);
    if(c.recurrence_mode==="annual"){
      const startKey=padCampaign(c.annual_start_month)+"-"+padCampaign(c.annual_start_day)+"T"+String(c.annual_start_time).replace(/(\.\d{3})\d+$/,"$1");
      const endKey=padCampaign(c.annual_end_month)+"-"+padCampaign(c.annual_end_day)+"T"+String(c.annual_end_time).replace(/(\.\d{3})\d+$/,"$1");
      const crossesYear=campaignCivil("2000-"+startKey).stamp>=campaignCivil("2000-"+endKey).stamp;
      // Mirror stage_c_active_campaign v3: previous/current-year seeds, >= crosses a year.
      for(let year=Number(campaignLocal(from).slice(0,4))-1;year<=Number(campaignLocal(to).slice(0,4));year++){
        try{ranges.push([Date.parse(localToIso(year+"-"+startKey)),Date.parse(localToIso((year+(crossesYear?1:0))+"-"+endKey))]);}
        catch{/* Invalid 29 February at either endpoint omits the entire occurrence. */}
      }
    }
    return ranges.filter(([start,end])=>Number.isFinite(start)&&start<end&&start<to&&end>from);
  }
  function monthCalendarV2(campaigns){
    const {year,month,first,days,offset}=campaignMonth(),[from,to]=campaignMonthRange();
    const entries=campaigns.filter(c=>!c.deleted_at).map(c=>({c,ranges:campaignIntervals(c,from,to)}));
    let cells="<span></span>".repeat(offset);
    for(let day=1;day<=days;day++){
      const iso=year+"-"+padCampaign(month)+"-"+padCampaign(day),start=Date.parse(localToIso(iso+"T00:00")),end=Date.parse(localToIso(nextCampaignDay(iso)+"T00:00"));
      const active=entries.filter(({ranges})=>ranges.some(([a,b])=>a<end&&b>start)).sort((a,b)=>b.c.priority-a.c.priority||a.c.id.localeCompare(b.c.id));
      const label=active.map(({c})=>c.name+" ("+campaignStatus(c)+")").join(", ");
      cells+='<button type="button" class="'+(active.length?"has-campaign":"")+'" data-calendar-date="'+iso+'" aria-label="'+escapeHtml(iso+(label?": "+label:""))+'" title="'+escapeHtml(label)+'"><b>'+day+"</b>"+active.slice(0,2).map(({c})=>"<small>"+escapeHtml(c.name)+" · "+campaignStatus(c)+"</small>").join("")+(active.length>2?"<small>+"+(active.length-2)+"</small>":"")+"</button>";
    }
    const title=new Date(first+"T12:00:00Z").toLocaleDateString("es-AR",{month:"long",year:"numeric",timeZone:CAMPAIGN_ZONE});
    return '<div class="campaign-calendar"><header><button class="btn ghost" type="button" aria-label="Mes anterior" data-calendar-move="-1">←</button><div><strong>'+title+'</strong><small>Horario de Buenos Aires · incluye borradores</small></div><button class="btn ghost" type="button" aria-label="Mes siguiente" data-calendar-move="1">→</button></header><div class="calendar-week"><b>L</b><b>M</b><b>X</b><b>J</b><b>V</b><b>S</b><b>D</b></div><div class="calendar-days">'+cells+"</div></div>";
  }
  function campaignList(){
    const list=(state.admin?.campaigns||[]).filter(c=>!c.deleted_at),pages=Math.max(1,Math.ceil(list.length/state.campaignSize));
    state.campaignPage=Math.max(1,Math.min(state.campaignPage,pages));
    const start=(state.campaignPage-1)*state.campaignSize,pageItems=list.slice(start,start+state.campaignSize);
    return `<section class="card"><div class="form-block-head"><div><h3>Campañas</h3><p class="muted">Una sola campaña publicada gana por prioridad; ante empate se usa el inicio efectivo, publicación más reciente e ID.</p></div><select id="campaign-page-size"><option ${state.campaignSize===10?"selected":""}>10</option><option ${state.campaignSize===25?"selected":""}>25</option><option ${state.campaignSize===50?"selected":""}>50</option></select></div><div class="site-admin-list">${pageItems.length?pageItems.map(c=>`<article><div><strong>${escapeHtml(c.name)}</strong><span>${campaignStatus(c)} · prioridad ${c.priority} · ${c.recurrence_mode} · v${c.version}</span></div><div><button class="btn ghost" data-edit-campaign="${c.id}" ${c.state==="published"?'disabled title="Duplicá o desactivá antes de editar"':""}>Editar</button><button class="btn ghost" data-duplicate-campaign="${c.id}">Duplicar</button><button class="btn ${c.state==="published"?"ghost":"primary"}" data-campaign-state="${c.id}" data-next-state="${c.state==="published"?"disabled":"published"}">${c.state==="published"?"Desactivar":"Publicar / programar"}</button><button class="btn ghost" data-delete-campaign="${c.id}" ${c.state==="published"?"disabled":""}>Retirar</button></div></article>`).join(""):'<p class="muted">No hay campañas.</p>'}</div><div class="pagination"><button class="btn ghost" data-campaign-page="${state.campaignPage-1}" ${state.campaignPage<=1?"disabled":""}>Anterior</button><span>${state.campaignPage} / ${pages}</span><button class="btn ghost" data-campaign-page="${state.campaignPage+1}" ${state.campaignPage>=pages?"disabled":""}>Siguiente</button></div></section>`;
  }
  function campaignsFormV2(){
    const list=state.admin?.campaigns||[],assets=state.admin?.assets?.filter(a=>!a.retired_at)||[];
    const assetOptions=kind=>`<option value="">Heredar diseño permanente</option>${assets.filter(a=>a.kind===kind||a.kind==="campaign").map(a=>`<option value="${a.id}">${escapeHtml(a.label)}</option>`).join("")}`;
    return `<div class="site-config-grid"><form id="site-campaign-form" class="card site-config-form"><input id="campaign-id" type="hidden"><input id="campaign-version" type="hidden" value="0"><h3>Campaña</h3><label>Nombre<input id="campaign-name" maxlength="120" required></label><label>Descripción interna<textarea id="campaign-description" maxlength="1000" rows="2"></textarea></label><div class="form-grid"><label>Prioridad<input id="campaign-priority" type="number" min="-1000" max="1000" step="1" value="0" required></label><label>Repetición<select id="campaign-recurrence"><option value="none">Evento único</option><option value="annual">Repetición anual</option><option value="custom">Fechas específicas por año</option></select></label><label>Inicio<input id="campaign-start" type="datetime-local" step="any" required></label><label>Fin exclusivo<input id="campaign-end" type="datetime-local" step="any" required></label></div><p id="campaign-leap-warning" class="site-contrast-status hidden" role="status">Esta campaña usa el 29 de febrero. Solo se ejecutará en años bisiestos; en los demás años se omitirá esa ocurrencia.</p><p id="campaign-annual-help" class="muted hidden">En repetición anual se usan mes, día y hora. Si el fin es anterior o igual al inicio, corresponde al año siguiente.</p><label id="campaign-occurrences-wrap" class="hidden">Fechas específicas (una por línea: inicio | fin exclusivo)<textarea id="campaign-occurrences" rows="4" placeholder="2027-10-16T00:00 | 2027-10-19T00:00"></textarea></label><div class="form-grid"><label>Acento<input id="campaign-accent" type="color" value="#ffffff"></label><label>Fondo especial<input id="campaign-background" type="color" value="#17172b"></label><label>Logo especial<select id="campaign-logo">${assetOptions("logo")}</select></label><label>Banner especial<select id="campaign-banner">${assetOptions("banner")}</select></label><label>Imagen de fondo<select id="campaign-background-asset">${assetOptions("background")}</select></label></div><div id="campaign-theme-preview" class="campaign-theme-preview"><img data-campaign-preview-logo alt="Logo seleccionado" hidden><img data-campaign-preview-banner alt="Banner seleccionado" hidden><small>VISTA PREVIA DE CAMPAÑA</small><strong>Cúbica 3D</strong><span>Los valores vacíos heredan el diseño permanente.</span></div><div id="campaign-overlap" class="site-contrast-status" role="status"></div><div class="site-config-actions"><button id="campaign-save" class="btn secondary" type="submit">Guardar borrador</button><button id="campaign-new" class="btn ghost" type="reset">Nueva campaña / limpiar</button></div><p id="campaign-save-status" class="muted" role="status"></p><p class="muted">Las fechas se interpretan en America/Argentina/Buenos_Aires. Los emails permanecen desactivados en esta etapa.</p></form><div id="campaign-calendar-host">${monthCalendarV2(list)}</div></div><div id="campaign-list-host">${campaignList()}</div>`;
  }
  function contentForm(){const pages=state.admin?.pages||[],faqs=state.admin?.faqs||[],phrases=state.admin?.phrases||[];return `<div class="site-config-grid"><form id="site-page-form" class="card site-config-form"><h3>Páginas públicas</h3><label>Página<select id="site-page-slug">${pages.map(p=>`<option value="${p.slug}">${escapeHtml(p.label)}</option>`).join("")}</select></label><label>Título<input id="site-page-title" maxlength="140"></label><label>Contenido<textarea id="site-page-body" maxlength="20000" rows="10" placeholder="Markdown simple; el HTML se rechaza"></textarea></label><input id="site-page-version" type="hidden" value="0"><div id="site-contact-fields" class="form-grid"></div><div class="site-config-actions"><button class="btn secondary">Guardar borrador</button><button id="site-publish-page" class="btn primary" type="button">Publicar página</button></div><p class="muted">Los textos legales quedan como borradores hasta que los publiques expresamente.</p></form><aside><div class="card"><h3>Vista previa privada</h3><div id="site-page-preview" class="public-rich-text"></div></div><div id="site-page-history" class="card site-version-history"></div></aside></div><section class="card"><div class="form-block-head"><div><h3>Preguntas frecuentes</h3><p class="muted">Buscá, ordená y administrá su visibilidad.</p></div><div class="site-list-tools"><input id="faq-search" type="search" placeholder="Buscar"><select id="faq-page-size"><option>10</option><option>25</option><option>50</option></select></div></div><form id="site-faq-form" class="site-inline-form"><input id="faq-id" type="hidden"><input id="faq-version" type="hidden" value="0"><input id="faq-question" maxlength="240" placeholder="Pregunta" required><textarea id="faq-answer" maxlength="3000" rows="2" placeholder="Respuesta" required></textarea><input id="faq-order" type="number" value="0" aria-label="Orden"><label class="checkbox-row"><input id="faq-active" type="checkbox" checked><span>Visible</span></label><button class="btn secondary">Guardar</button></form><div id="faq-admin-list" class="site-admin-list compact"></div><div id="faq-pagination" class="pagination"></div></section><section class="card"><div class="form-block-head"><div><h3>Frases de bienvenida</h3><p class="muted">Globales o asociadas a una campaña. Se conserva la selección aleatoria.</p></div><div class="site-list-tools"><input id="phrase-search" type="search" placeholder="Buscar"><select id="phrase-page-size"><option>10</option><option>25</option><option>50</option></select></div></div><form id="site-phrase-form" class="site-inline-form"><input id="phrase-id" type="hidden"><input id="phrase-version" type="hidden" value="0"><select id="phrase-campaign"><option value="">Global</option>${(state.admin?.campaigns||[]).map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}</select><input id="phrase-text" maxlength="500" placeholder="Nueva frase" required><input id="phrase-order" type="number" value="0" aria-label="Orden"><label class="checkbox-row"><input id="phrase-active" type="checkbox" checked><span>Activa</span></label><button class="btn secondary">Guardar</button></form><div id="phrase-admin-list" class="site-admin-list compact"></div><div id="phrase-pagination" class="pagination"></div></section>`;}
  function suggestionsAdmin(){return `<section class="card"><div class="site-suggestion-toolbar"><input id="admin-suggestion-search" type="search" placeholder="Buscar asunto o descripción"><select id="admin-suggestion-status"><option value="all">Todos</option><option value="new">Nuevos</option><option value="reviewing">En revisión</option><option value="resolved">Resueltos</option><option value="dismissed">Descartados</option></select><select id="admin-suggestion-size"><option>10</option><option selected>25</option><option>50</option></select><button id="admin-suggestion-load" class="btn secondary">Buscar</button></div><div id="admin-suggestion-list" class="site-admin-list"><p class="muted">Cargando sugerencias…</p></div><div id="admin-suggestion-pagination" class="pagination"></div></section>`;}
  function suggestionsAdminV2(){return `<section class="card"><div class="site-suggestion-toolbar"><input id="admin-suggestion-search" type="search" maxlength="120" placeholder="Buscar asunto o descripción"><select id="admin-suggestion-status"><option value="all">Todos los estados</option><option value="new">Nuevas</option><option value="reviewing">En revisión</option><option value="accepted">Aceptadas</option><option value="resolved">Resueltas</option><option value="dismissed">Descartadas</option></select><select id="admin-suggestion-category"><option value="all">Todos los tipos</option><option value="funcionalidad">Funcionalidad</option><option value="visual">Mejora visual</option><option value="error">Error</option><option value="compra">Experiencia de compra</option><option value="otro">Otro</option></select><select id="admin-suggestion-lifecycle"><option value="active">Activas</option><option value="archived">Archivadas</option><option value="deleted">Eliminadas</option><option value="all">Todas</option></select><select id="admin-suggestion-sort"><option value="recent">Más recientes</option><option value="oldest">Más antiguas</option><option value="updated">Actualizadas recientemente</option></select><select id="admin-suggestion-size"><option>10</option><option selected>25</option><option>50</option></select><button id="admin-suggestion-load" class="btn secondary">Buscar</button></div><div id="admin-suggestion-list" class="site-admin-list"><p class="muted">Cargando sugerencias…</p></div><div id="admin-suggestion-pagination" class="pagination"></div></section><section id="admin-suggestion-detail" class="card hidden"></section>`;}
  function emailPlaceholder(){return `<section class="card site-email-placeholder"><span aria-hidden="true">✉</span><div><p class="eyebrow">PREPARADO PARA EL FUTURO</p><h3>Temas de correos automáticos</h3><p class="muted">La estructura de campañas reserva esta integración, pero permanece desactivada. Esta etapa no modifica Resend, plantillas ni destinatarios.</p></div><button class="btn ghost" disabled>No disponible en Etapa C</button></section>`;}
  function renderAdmin(){
    captureCampaignForm();
    const host=$("site-configuration-app");if(!host)return;host.innerHTML=tabs()+`<div class="site-tab-panel">${state.tab==="appearance"?appearanceForm():state.tab==="campaigns"?campaignsFormV2():state.tab==="content"?contentForm():state.tab==="suggestions"?suggestionsAdminV2():emailPlaceholder()}</div>`;
    host.querySelectorAll("[data-site-tab]").forEach(button=>button.onclick=()=>{state.tab=button.dataset.siteTab;renderAdmin();if(state.tab==="suggestions")loadSuggestions();});
    if(state.tab==="appearance")bindAppearance();if(state.tab==="campaigns")bindCampaignsV2();if(state.tab==="content")bindContentV2();if(state.tab==="suggestions")bindSuggestions();
  }
  function clearAdminState(message="La configuración administrativa está protegida."){
    state.adminLoadSequence+=1;state.admin=null;state.assetUploadRequestId=null;
    state.campaignOwner=null;
    state.campaignEpoch++;state.campaignDraft=null;state.campaignOriginal=null;state.campaignCreateKey=null;state.campaignAttempt=null;state.campaignBusy=false;state.campaignActionKeys={};state.campaignMessage="";
    const host=$("site-configuration-app");if(host)host.innerHTML=`<div class="card"><p class="muted">${escapeHtml(message)}</p></div>`;
  }
  async function loadAdmin(){
    const host=$("site-configuration-app");if(!host)return false;
    if(!adminEnabled()){clearAdminState("La Etapa C permanece cerrada hasta completar su activación coordinada.");return false;}
    if(!adminAccessAllowed()){clearAdminState("Iniciá sesión como administrador y verificá tu segundo factor para abrir Configuración.");return false;}
    captureCampaignForm();const request=++state.adminLoadSequence;host.innerHTML='<div class="card"><p class="muted">Cargando configuración protegida…</p></div>';
    try{
      const [data,welcomePreference]=await Promise.all([
        rpc("admin_get_site_configuration"),
        rpc("admin_get_welcome_screen_preference")
      ]);
      if(request!==state.adminLoadSequence||!adminAccessAllowed())return false;
      state.admin=data;state.welcomePreference=welcomePreference;renderAdmin();return true;
    }catch(error){
      if(request!==state.adminLoadSequence||!adminAccessAllowed())return false;
      host.innerHTML=`<div class="card"><h3>No se pudo abrir Configuración</h3><p class="muted">${escapeHtml(error.message||"Verificá tu sesión y MFA.")}</p></div>`;return false;
    }
  }
  function collectAppearance(){const value=deepMerge(DEFAULT_APPEARANCE,state.admin?.appearance?.config||{});document.querySelectorAll("[data-theme-hex]").forEach(input=>value.colors[input.dataset.themeHex]=input.value.trim());value.hero={title:$("site-hero-title-input").value.trim(),subtitle:$("site-hero-subtitle-input").value.trim()};document.querySelectorAll("[data-theme-asset]").forEach(select=>value.assets[select.dataset.themeAsset]=select.value||null);return value;}
  function fillAppearanceForm(value,message=""){
    const draft=deepMerge(DEFAULT_APPEARANCE,value||{});
    document.querySelectorAll("[data-theme-hex]").forEach(input=>{const key=input.dataset.themeHex,color=draft.colors[key];input.value=color;const picker=document.querySelector(`[data-theme-color="${key}"]`);if(picker)picker.value=color;});
    $("site-hero-title-input").value=draft.hero.title;$("site-hero-subtitle-input").value=draft.hero.subtitle;
    document.querySelectorAll("[data-theme-asset]").forEach(select=>select.value=draft.assets[select.dataset.themeAsset]||"");
    updatePreview();const status=$("site-appearance-status");if(status)status.textContent=message;
  }
  function updatePreview(){
    const value=collectAppearance(),preview=$("site-preview");if(!preview)return;const colorsValid=Object.values(value.colors).every(validHex),status=$("site-contrast-status");
    if(colorsValid){preview.style.setProperty("--preview-bg",value.colors.background);preview.style.setProperty("--preview-panel",value.colors.panel);preview.style.setProperty("--preview-panel-alt",value.colors.panelAlt);preview.style.setProperty("--preview-text",value.colors.text);preview.style.setProperty("--preview-muted",value.colors.muted);preview.style.setProperty("--preview-accent",value.colors.accent);const ratio=contrast(value.colors.text,value.colors.background);status.textContent=`Contraste texto/fondo: ${ratio.toFixed(2)}:1 · ${ratio>=4.5?"Correcto":"Debe ser al menos 4,5:1"}`;status.className=`site-contrast-status ${ratio>=4.5?"good":"danger"}`;}
    else{status.textContent="Completá todos los colores con formato HEX #RRGGBB para calcular el contraste.";status.className="site-contrast-status danger";}
    preview.querySelector("h2").textContent=value.hero.title;preview.querySelector("p").textContent=value.hero.subtitle;
  }
  function bindAppearance(){
    document.querySelectorAll("[data-theme-color]").forEach(color=>color.oninput=()=>{const hex=document.querySelector(`[data-theme-hex="${color.dataset.themeColor}"]`);hex.value=color.value;updatePreview();});
    document.querySelectorAll("[data-theme-hex]").forEach(hex=>hex.oninput=()=>{const color=document.querySelector(`[data-theme-color="${hex.dataset.themeHex}"]`);if(validHex(hex.value)&&color)color.value=hex.value;updatePreview();});
    document.querySelectorAll("[data-theme-asset],#site-hero-title-input,#site-hero-subtitle-input").forEach(input=>input.oninput=updatePreview);
    document.querySelectorAll("[data-preview-size]").forEach(button=>button.onclick=()=>{state.preview=button.dataset.previewSize;document.querySelectorAll("[data-preview-size]").forEach(item=>item.classList.toggle("active",item===button));const preview=$("site-preview");preview.classList.toggle("desktop",state.preview==="desktop");preview.classList.toggle("mobile",state.preview==="mobile");});updatePreview();
    $("site-appearance-form").onsubmit=async event=>{event.preventDefault();const status=$("site-appearance-status");try{const config=collectAppearance();validateAppearance(config);status.textContent="Guardando…";state.admin.appearance=await rpc("admin_save_site_appearance_draft",{p_config:config,p_expected_version:state.admin.appearance?.version||1});status.textContent="Borrador guardado. La tienda pública no cambió.";}catch(error){status.textContent=error.message;}};
    const welcomeToggle=$("site-welcome-enabled"),welcomeState=$("site-welcome-state"),welcomeStatus=$("site-welcome-status"),welcomeSave=$("site-save-welcome");
    const renderWelcomeToggleState=()=>{const saved=state.welcomePreference?.enabled===true,pending=welcomeToggle.checked!==saved;welcomeState.textContent=`${welcomeToggle.checked?"Activada":"Desactivada"}${pending?" · sin guardar":""}`;};
    welcomeToggle.onchange=renderWelcomeToggleState;
    welcomeSave.onclick=async()=>{if(!adminAccessAllowed()){clearAdminState("Volvé a verificar MFA para cambiar la bienvenida.");return;}welcomeSave.disabled=true;welcomeStatus.textContent="Guardando…";try{const saved=await rpc("admin_set_welcome_screen_preference",{p_enabled:welcomeToggle.checked,p_expected_version:state.welcomePreference?.version||1});if(!adminAccessAllowed()){clearAdminState();return;}state.welcomePreference=saved;renderWelcomeToggleState();welcomeStatus.textContent=`Preferencia guardada. La bienvenida quedó ${saved.enabled?"activada":"desactivada"}.`;}catch(error){welcomeStatus.textContent=error.message||"No se pudo guardar la preferencia.";}finally{welcomeSave.disabled=false;}};
    $("site-publish-appearance").onclick=async()=>{const status=$("site-appearance-status");if(!confirm("¿Publicar este borrador visual? La apariencia de la tienda cambiará para todos los visitantes."))return;try{status.textContent="Publicando…";await rpc("admin_publish_site_appearance",{p_expected_version:state.admin.appearance.version});status.textContent="Versión publicada.";await loadPublicExperience();await loadAdmin();}catch(error){status.textContent=error.message;}};
    $("site-reset-appearance").onclick=()=>fillAppearanceForm(state.admin.appearance?.config||{},"Cambios locales descartados. Se restauró el borrador guardado.");
    $("site-original-appearance").onclick=()=>fillAppearanceForm(DEFAULT_APPEARANCE,"Valores originales cargados localmente. Guardá el borrador para persistirlos.");
    document.querySelectorAll("[data-retire-asset]").forEach(button=>button.onclick=async()=>{if(!confirm("¿Retirar este recurso? Si está en uso, Supabase rechazará la operación."))return;try{await rpc("admin_retire_site_asset",{p_id:button.dataset.retireAsset});await loadAdmin();}catch(error){toast(error.message);}});
    $("site-asset-upload").onsubmit=async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;try{state.assetUploadRequestId ||= operationId();const form=new FormData();form.set("request_id",state.assetUploadRequestId);form.set("kind",$("site-asset-kind").value);form.set("label",$("site-asset-label").value.trim());form.set("file",$("site-asset-file").files[0]);const {data,error}=await window.cubicaSupabase.functions.invoke("site-assets",{body:form});if(error||!data?.asset)throw new Error(data?.error==="registration_pending"?"La subida quedó pendiente de conciliación. Volvé a intentar sin cambiar el formulario.":"No se pudo subir el recurso.");state.assetUploadRequestId=null;await loadAdmin();}catch(error){$("site-appearance-status").textContent=error.message;}finally{button.disabled=false;}};
    $("site-asset-upload").addEventListener("input",()=>{state.assetUploadRequestId=null;});
  }
  const campaignFields=["id","version","name","description","priority","recurrence","start","end","occurrences","accent","background","logo","banner","background-asset"];
  function captureCampaignForm(){
    if(!$("site-campaign-form"))return;
    state.campaignDraft=Object.fromEntries(campaignFields.map(key=>[key,$("campaign-"+key).value]));
  }
  function fillCampaignForm(values){
    if(!values||!$("site-campaign-form"))return;
    campaignFields.forEach(key=>{$("campaign-"+key).value=values[key]??"";});
  }
  function campaignFormValues(c){
    const annual=side=>"2028-"+padCampaign(c["annual_"+side+"_month"])+"-"+padCampaign(c["annual_"+side+"_day"])+"T"+String(c["annual_"+side+"_time"]).replace(/(\.\d{3})\d+$/,"$1");
    return {id:c.id,version:String(c.version),name:c.name,description:c.description||"",priority:String(c.priority),recurrence:c.recurrence_mode,
      start:c.recurrence_mode==="annual"?annual("start"):campaignLocal(c.starts_at),
      end:c.recurrence_mode==="annual"?annual("end"):campaignLocal(c.ends_at),
      occurrences:(state.admin.occurrences||[]).filter(o=>o.campaign_id===c.id).map(o=>campaignLocal(o.starts_at)+" | "+campaignLocal(o.ends_at)).join("\n"),
      accent:c.theme?.colors?.accent||"#ffffff",background:c.theme?.colors?.background||"#17172b",
      logo:c.theme?.assets?.logo||"",banner:c.theme?.assets?.banner||"","background-asset":c.theme?.assets?.background||""};
  }
  function parseOccurrences(text){
    const lines=String(text||"").split("\n").map(x=>x.trim()).filter(Boolean);
    if(!lines.length)throw new Error("Agregá al menos una fecha específica.");
    const seen=new Set();
    return lines.map(line=>{
      const parts=line.split("|").map(x=>x.trim());
      if(parts.length!==2||!parts[0]||!parts[1])throw new Error("Cada fecha específica debe tener inicio | fin.");
      const starts_at=localToIso(parts[0]),ends_at=localToIso(parts[1]);
      if(starts_at>=ends_at)throw new Error("El fin debe ser posterior al inicio.");
      const key=starts_at+"|"+ends_at;if(seen.has(key))throw new Error("Hay una fecha específica duplicada.");seen.add(key);
      return {starts_at,ends_at};
    });
  }
  function campaignPayload(f,original=state.campaignOriginal){
    const mode=f.recurrence,priority=Number(f.priority);
    if(!f.name.trim()||f.name.length>120||f.description.length>1000)throw new Error("Completá el nombre (hasta 120 caracteres) y revisá la descripción (hasta 1000).");
    if(!String(f.priority).trim()||!Number.isInteger(priority)||Math.abs(priority)>1000||!["none","annual","custom"].includes(mode))throw new Error("Revisá la prioridad y la repetición.");
    if(!validHex(f.accent)||!validHex(f.background))throw new Error("Revisá los colores de la campaña.");
    if(f.id&&(!original||original.id!==f.id||original.state==="published"||state.admin?.campaigns?.find(c=>c.id===f.id)?.state==="published"))throw new Error("Duplicá o desactivá la campaña publicada antes de editarla.");
    if(!Number.isInteger(Number(f.version))||Number(f.version)<(f.id?1:0))throw new Error("Versión de campaña inválida.");
    let start=null,end=null,occurrences=[];
    if(mode!=="custom"){start=campaignCivil(f.start);end=campaignCivil(f.end);}
    if(mode==="none"&&start.stamp>=end.stamp)throw new Error("El fin debe ser posterior al inicio.");
    if(mode==="custom"){
      // Preserve full timestamp precision when an existing occurrence was not edited.
      const originalText=original?campaignFormValues(original).occurrences:null;
      occurrences=original&&f.occurrences===originalText?(state.admin.occurrences||[]).filter(o=>o.campaign_id===original.id).map(o=>({starts_at:o.starts_at,ends_at:o.ends_at})):parseOccurrences(f.occurrences);
      if(!occurrences.length)throw new Error("Agregá al menos una fecha específica.");
    }
    const theme=deepMerge({colors:{},hero:{},assets:{}},original?.theme||{});
    theme.colors={...theme.colors,accent:f.accent,background:f.background};
    theme.assets={...theme.assets,logo:f.logo||null,banner:f.banner||null,background:f["background-asset"]||null};
    // datetime-local normalizes :00 seconds away; compare civil values, not raw strings.
    const sameLocal=(a,b)=>Boolean(a&&b)&&campaignCivil(a).stamp===campaignCivil(b).stamp;
    const exactDate=(field,value)=>original&&sameLocal(value,campaignLocal(original[field]))?original[field]:localToIso(value);
    const exactTime=(side,value)=>original?.recurrence_mode==="annual"&&sameLocal(value,campaignFormValues(original)[side])?original["annual_"+side+"_time"]:campaignCivil(value).time;
    return {p_id:f.id||null,p_name:f.name,p_description:f.description,p_priority:priority,p_recurrence_mode:mode,
      p_starts_at:mode==="none"?exactDate("starts_at",f.start):null,p_ends_at:mode==="none"?exactDate("ends_at",f.end):null,
      p_annual_start_month:mode==="annual"?start.month:null,p_annual_start_day:mode==="annual"?start.day:null,p_annual_start_time:mode==="annual"?exactTime("start",f.start):null,
      p_annual_end_month:mode==="annual"?end.month:null,p_annual_end_day:mode==="annual"?end.day:null,p_annual_end_time:mode==="annual"?exactTime("end",f.end):null,
      p_theme:theme,p_occurrences:occurrences,p_expected_version:Number(f.version),p_request_id:null};
  }
  function updateCampaignFormState(){
    if(!$("site-campaign-form"))return;
    const custom=$("campaign-recurrence").value==="custom",annual=$("campaign-recurrence").value==="annual";
    $("campaign-occurrences-wrap").classList.toggle("hidden",!custom);
    $("campaign-occurrences").required=custom;$("campaign-occurrences").disabled=!custom||state.campaignBusy||Boolean(state.campaignAttempt);
    ["start","end"].forEach(key=>{const input=$("campaign-"+key);input.required=!custom;input.disabled=custom||state.campaignBusy||Boolean(state.campaignAttempt);});
    $("campaign-leap-warning").classList.toggle("hidden",!annual||!["start","end"].some(key=>$("campaign-"+key).value.slice(5,10)==="02-29"));
    $("campaign-annual-help").classList.toggle("hidden",!annual);
    campaignFields.filter(key=>!["start","end","occurrences"].includes(key)).forEach(key=>{$("campaign-"+key).disabled=state.campaignBusy||Boolean(state.campaignAttempt);});
    $("campaign-save").disabled=state.campaignBusy;
    $("campaign-new").disabled=state.campaignBusy||Boolean(state.campaignAttempt);
    $("campaign-save").textContent=state.campaignAttempt?"Reintentar el mismo guardado":"Guardar borrador";
    $("campaign-save-status").textContent=state.campaignBusy?"Procesando…":state.campaignAttempt?"Resultado sin confirmar. Reintentá el mismo guardado; se conserva su clave. No cierres ni recargues esta página.":state.campaignMessage||"";
  }
  function campaignOverlapNames(payload){
    const candidate=Object.fromEntries(Object.entries(payload).map(([key,value])=>[key.slice(2),value]));
    candidate.id=payload.p_id||"local";
    const [from,to]=campaignMonthRange(),ranges=campaignIntervals(candidate,from,to,payload.p_occurrences.map(o=>({...o,campaign_id:candidate.id})));
    return (state.admin?.campaigns||[]).filter(c=>c.id!==candidate.id&&c.state==="published"&&!c.deleted_at&&campaignIntervals(c,from,to).some(([a,b])=>ranges.some(([x,y])=>a<y&&b>x))).map(c=>c.name);
  }
  async function updateCampaignPreview(){
    const preview=$("campaign-theme-preview");if(!preview||!adminAccessAllowed())return;
    captureCampaignForm();const f=state.campaignDraft;
    preview.style.backgroundColor=f.background;preview.style.color=f.accent;preview.querySelector("strong").textContent=f.name||"Cúbica 3D";
    const overlap=$("campaign-overlap");
    try{const names=campaignOverlapNames(campaignPayload(f));overlap.textContent=(names.length?"Coincide con campañas publicadas: "+names.join(", "):"No se detectan coincidencias con campañas publicadas")+" (solo mes visible).";overlap.className="site-contrast-status "+(names.length?"danger":"good");}
    catch{overlap.textContent="Completá las fechas y el nombre para comparar el formulario con campañas publicadas en el mes visible.";overlap.className="site-contrast-status";}
    const selected={logo:f.logo,banner:f.banner,background:f["background-asset"]},key=JSON.stringify(selected);
    if(preview.dataset.assetKey===key)return;preview.dataset.assetKey=key;
    const sequence=++state.campaignPreviewSequence,epoch=state.campaignEpoch;
    preview.style.backgroundImage="none";
    ["logo","banner"].forEach(kind=>{const image=preview.querySelector("[data-campaign-preview-"+kind+"]");image.hidden=true;image.removeAttribute("src");});
    try{
      const urls=await signedAssetUrls(Object.fromEntries(Object.entries(selected).map(([kind,id])=>[kind,assetById(id)?.storage_path||null])));
      if(epoch!==state.campaignEpoch||sequence!==state.campaignPreviewSequence||!adminAccessAllowed()||$("campaign-theme-preview")!==preview)return;
      ["logo","banner"].forEach(kind=>{const image=preview.querySelector("[data-campaign-preview-"+kind+"]");if(urls[kind]){image.src=urls[kind];image.hidden=false;}});
      preview.style.backgroundImage=urls.background?'url('+JSON.stringify(urls.background)+')':"none";
      preview.querySelector("span").textContent=Object.entries(selected).some(([kind,id])=>id&&!urls[kind])?"No se pudo cargar algún recurso seleccionado.":"Vista privada de los recursos seleccionados; los vacíos heredan el diseño permanente.";
    }catch{if(sequence===state.campaignPreviewSequence&&$("campaign-theme-preview")===preview)preview.querySelector("span").textContent="No se pudieron cargar los recursos; reabrí la vista para reintentar.";}
  }
  function refreshCampaignNavigation(){
    if(!$("campaign-calendar-host"))return;
    $("campaign-calendar-host").innerHTML=monthCalendarV2(state.admin?.campaigns||[]);
    $("campaign-list-host").innerHTML=campaignList();
    bindCampaignNavigation();updateCampaignPreview();
  }
  function installCampaignResult(c,payload){
    if(!c?.id||!Number.isInteger(c.version)||!["draft","disabled","published"].includes(c.state))throw new Error("Respuesta de guardado sin confirmar.");
    state.admin.campaigns=[c,...(state.admin.campaigns||[]).filter(item=>item.id!==c.id)];
    if(payload)state.admin.occurrences=[...(state.admin.occurrences||[]).filter(o=>o.campaign_id!==c.id),...payload.p_occurrences.map(o=>({...o,campaign_id:c.id}))];
  }
  async function saveCampaign(event){
    event.preventDefault();if(!adminAccessAllowed()||state.campaignBusy)return;
    const epoch=state.campaignEpoch;
    try{
      captureCampaignForm();
      let payload;
      if(state.campaignAttempt)payload=state.campaignAttempt;
      else{
        payload=campaignPayload(state.campaignDraft);
        if(!payload.p_id){state.campaignCreateKey ||= operationId();payload.p_request_id=state.campaignCreateKey;}
        state.campaignAttempt=payload;
      }
      state.campaignBusy=true;updateCampaignFormState();
      const c=await rpc("admin_upsert_site_campaign",payload);
      if(epoch!==state.campaignEpoch||!adminAccessAllowed())return;
      installCampaignResult(c,payload);
      state.campaignAttempt=null;state.campaignCreateKey=null;state.campaignOriginal=c;
      state.campaignDraft=campaignFormValues(c);fillCampaignForm(state.campaignDraft);
      state.campaignMessage="Borrador guardado · versión "+c.version+".";
      refreshCampaignNavigation();
    }catch(error){
      if(epoch!==state.campaignEpoch||!adminAccessAllowed())return;
      // Known transactional rejection permits correction, but never advances expected_version.
      // Ambiguous network/server outcomes keep the immutable request and its UUID.
      if(/^(22|23|42501|40001|P0001)/.test(error.code||"")&&!/idempotencia/i.test(error.message||""))state.campaignAttempt=null;
      state.campaignMessage=error.message||"No se pudo confirmar el guardado.";toast(state.campaignMessage);
    }finally{if(epoch===state.campaignEpoch){state.campaignBusy=false;updateCampaignFormState();}}
  }
  function startCampaignEdit(c){
    if(!adminAccessAllowed()||state.campaignBusy||state.campaignAttempt||!c)return;
    if(c.state==="published"){toast("Duplicá o desactivá la campaña antes de editarla.");return;}
    if(state.campaignDraft?.name&&!confirm("¿Reemplazar el formulario con esta campaña? Se descartarán las ediciones locales."))return;
    state.campaignOriginal=c;state.campaignCreateKey=null;state.campaignMessage="";
    state.campaignDraft=campaignFormValues(c);fillCampaignForm(state.campaignDraft);updateCampaignFormState();updateCampaignPreview();$("campaign-name").focus();
  }
  async function campaignAction(kind,c,next){
    if(!adminAccessAllowed()||state.campaignBusy||state.campaignAttempt||!c)return;
    if(kind==="state"&&next==="published"&&!confirm("¿Publicar / programar esta campaña? Podría ser accesible públicamente mediante las RPC públicas, incluso mientras la Etapa C permanece en modo admin."))return;
    if(kind==="duplicate"&&!confirm("¿Crear una copia de esta campaña como un nuevo borrador?"))return;
    if(kind==="delete"&&(c.state==="published"||!confirm("¿Retirar la campaña “"+c.name+"”? Se conservará su auditoría y sus imágenes.")))return;
    const epoch=state.campaignEpoch,key=kind+":"+c.id+":"+c.version+":"+(next||"");
    const args={p_id:c.id,p_expected_version:c.version};
    if(kind!=="delete"){state.campaignActionKeys[key] ||= operationId();args.p_request_id=state.campaignActionKeys[key];}
    if(kind==="state")args.p_state=next;
    state.campaignBusy=true;updateCampaignFormState();
    try{
      const result=await rpc(kind==="state"?"admin_set_site_campaign_state":kind==="duplicate"?"admin_duplicate_site_campaign":"admin_delete_site_campaign",args);
      if(epoch!==state.campaignEpoch||!adminAccessAllowed())return;
      if(kind==="delete")state.admin.campaigns=state.admin.campaigns.filter(x=>x.id!==c.id);
      else installCampaignResult(result);
      // Fetch occurrences for a duplicated custom campaign; preserve the local editor on reload.
      delete state.campaignActionKeys[key];
      if(kind==="duplicate")await loadAdmin();else refreshCampaignNavigation();
    }catch(error){if(epoch===state.campaignEpoch&&adminAccessAllowed())toast(error.message);}
    finally{if(epoch===state.campaignEpoch){state.campaignBusy=false;updateCampaignFormState();}}
  }
  function bindCampaignNavigation(){
    document.querySelectorAll("[data-edit-campaign]").forEach(button=>button.onclick=()=>startCampaignEdit(state.admin.campaigns.find(c=>c.id===button.dataset.editCampaign)));
    document.querySelectorAll("[data-campaign-state]").forEach(button=>button.onclick=()=>campaignAction("state",state.admin.campaigns.find(c=>c.id===button.dataset.campaignState),button.dataset.nextState));
    document.querySelectorAll("[data-duplicate-campaign]").forEach(button=>button.onclick=()=>campaignAction("duplicate",state.admin.campaigns.find(c=>c.id===button.dataset.duplicateCampaign)));
    document.querySelectorAll("[data-delete-campaign]").forEach(button=>button.onclick=()=>campaignAction("delete",state.admin.campaigns.find(c=>c.id===button.dataset.deleteCampaign)));
    document.querySelectorAll("[data-calendar-move]").forEach(button=>button.onclick=()=>{moveCampaignMonth(Number(button.dataset.calendarMove));refreshCampaignNavigation();});
    document.querySelectorAll("[data-calendar-date]").forEach(button=>button.onclick=()=>{
      if(state.campaignBusy||state.campaignAttempt)return;
      const day=button.dataset.calendarDate,custom=$("campaign-recurrence").value==="custom";
      if(custom)$("campaign-occurrences").value+=($("campaign-occurrences").value?"\n":"")+day+"T00:00 | "+nextCampaignDay(day)+"T00:00";
      else{
        if(($("campaign-start").value||$("campaign-end").value)&&!confirm("¿Reemplazar las fechas del formulario por el día seleccionado?"))return;
        $("campaign-start").value=day+"T00:00";$("campaign-end").value=nextCampaignDay(day)+"T00:00";
      }
      updateCampaignFormState();updateCampaignPreview();
    });
    $("campaign-page-size").onchange=event=>{state.campaignSize=Number(event.target.value);state.campaignPage=1;refreshCampaignNavigation();};
    document.querySelectorAll("[data-campaign-page]").forEach(button=>button.onclick=()=>{if(button.disabled)return;state.campaignPage=Number(button.dataset.campaignPage);refreshCampaignNavigation();});
  }
  function bindCampaignsV2(){
    state.campaignOwner=typeof session!=="undefined"?session?.supabaseUserId:null;
    fillCampaignForm(state.campaignDraft);
    const form=$("site-campaign-form");
    form.onsubmit=saveCampaign;
    form.onreset=event=>{
      event.preventDefault();if(!adminAccessAllowed()||state.campaignBusy||state.campaignAttempt)return;
      if(state.campaignDraft?.name&&!confirm("¿Iniciar una nueva campaña? Se descartarán los cambios locales del formulario."))return;
      state.campaignOriginal=null;state.campaignCreateKey=null;state.campaignMessage="";
      state.campaignDraft={id:"",version:"0",name:"",description:"",priority:"0",recurrence:"none",start:"",end:"",occurrences:"",accent:"#ffffff",background:"#17172b",logo:"",banner:"","background-asset":""};
      fillCampaignForm(state.campaignDraft);updateCampaignFormState();updateCampaignPreview();
    };
    form.oninput=()=>{updateCampaignFormState();updateCampaignPreview();};
    form.onchange=form.oninput;
    updateCampaignFormState();updateCampaignPreview();bindCampaignNavigation();
  }
  function loadSelectedPage(){const page=state.admin.pages.find(p=>p.slug===$("site-page-slug").value),draft=page?.draft;$("site-page-title").value=draft?.title||"";$("site-page-body").value=draft?.content?.body||"";$("site-page-version").value=draft?.version||0;const contact=$("site-contact-fields");contact.innerHTML=page?.slug==="contact"?[["email","Email"],["phone","Teléfono"],["instagram","Instagram HTTPS"],["address","Dirección"]].map(([key,label])=>`<label>${label}<input data-contact-field="${key}" maxlength="500" value="${escapeHtml(draft?.content?.[key]||"")}"></label>`).join(""):"";}
  function bindContent(){
    $("site-page-slug").onchange=loadSelectedPage;loadSelectedPage();
    $("site-page-form").onsubmit=async event=>{event.preventDefault();const content={body:$("site-page-body").value};document.querySelectorAll("[data-contact-field]").forEach(input=>content[input.dataset.contactField]=input.value.trim());try{await rpc("admin_save_content_draft",{p_slug:$("site-page-slug").value,p_title:$("site-page-title").value,p_content:content,p_expected_version:Number($("site-page-version").value)});await loadAdmin();}catch(error){toast(error.message);}};
    $("site-publish-page").onclick=async()=>{try{await rpc("admin_publish_content_page",{p_slug:$("site-page-slug").value,p_expected_version:Number($("site-page-version").value)});await loadAdmin();}catch(error){toast(error.message);}};
    $("site-faq-form").onsubmit=async event=>{event.preventDefault();try{await rpc("admin_upsert_faq",{p_id:$("faq-id").value||null,p_question:$("faq-question").value,p_answer:$("faq-answer").value,p_active:$("faq-active").checked,p_sort_order:0,p_expected_version:Number($("faq-version").value),p_delete:false});await loadAdmin();}catch(error){toast(error.message);}};
    document.querySelectorAll("[data-edit-faq]").forEach(button=>button.onclick=()=>{const f=state.admin.faqs.find(x=>String(x.id)===button.dataset.editFaq);$("faq-id").value=f.id;$("faq-version").value=f.version;$("faq-question").value=f.question;$("faq-answer").value=f.answer;$("faq-active").checked=f.active;});
    $("site-phrase-form").onsubmit=async event=>{event.preventDefault();try{await rpc("admin_upsert_welcome_phrase",{p_id:$("phrase-id").value||null,p_campaign_id:$("phrase-campaign").value||null,p_phrase:$("phrase-text").value,p_active:true,p_sort_order:Number($("phrase-order").value),p_expected_version:Number($("phrase-version").value),p_delete:false});await loadAdmin();}catch(error){toast(error.message);}};
    document.querySelectorAll("[data-edit-phrase]").forEach(button=>button.onclick=()=>{const p=state.admin.phrases.find(x=>String(x.id)===button.dataset.editPhrase);$("phrase-id").value=p.id;$("phrase-version").value=p.version;$("phrase-campaign").value=p.campaign_id||"";$("phrase-text").value=p.phrase;$("phrase-order").value=p.sort_order;});
  }
  function renderPagePreviewAndHistory(){
    const page=state.admin.pages.find(p=>p.slug===$("site-page-slug").value),preview=$("site-page-preview"),history=$("site-page-history");preview.innerHTML=`<h2>${escapeHtml($("site-page-title").value||"Sin título")}</h2>${renderMarkdown($("site-page-body").value)}`;
    const versions=page?.history||[];history.innerHTML=`<h3>Historial publicado</h3>${versions.length?versions.map(v=>`<article><div><strong>Versión ${v.version}</strong><span>${v.published_at?new Date(v.published_at).toLocaleString("es-AR"):""}</span></div><button class="btn ghost" type="button" data-restore-page-version="${v.version}">Recuperar en borrador</button></article>`).join(""):'<p class="muted">Todavía no hay versiones publicadas.</p>'}`;
    history.querySelectorAll("[data-restore-page-version]").forEach(button=>button.onclick=async()=>{if(!confirm("¿Copiar esta versión al borrador actual? La página pública no cambiará."))return;try{await rpc("admin_restore_content_version",{p_slug:page.slug,p_version:Number(button.dataset.restorePageVersion),p_expected_draft_version:Number($("site-page-version").value)});await loadAdmin();}catch(error){toast(error.message);}});
  }
  function renderFaqAdmin(){
    const query=$("faq-search").value.trim().toLowerCase(),all=(state.admin.faqs||[]).filter(f=>!query||f.question.toLowerCase().includes(query)||f.answer.toLowerCase().includes(query)),start=(state.faqPage-1)*state.faqSize,items=all.slice(start,start+state.faqSize),pages=Math.max(1,Math.ceil(all.length/state.faqSize));$("faq-admin-list").innerHTML=items.map(f=>`<article><div><strong>${escapeHtml(f.question)}</strong><span>${f.active?"Visible":"Oculta"} · orden ${f.sort_order}</span></div><div><button class="btn ghost" data-edit-faq="${f.id}">Editar</button><button class="btn ghost" data-toggle-faq="${f.id}">${f.active?"Ocultar":"Activar"}</button><button class="btn ghost" data-delete-faq="${f.id}">Eliminar</button></div></article>`).join("")||'<p class="muted">Sin preguntas para este filtro.</p>';$("faq-pagination").innerHTML=`<button class="btn ghost" data-faq-page="${state.faqPage-1}" ${state.faqPage<=1?"disabled":""}>Anterior</button><span>${state.faqPage} / ${pages}</span><button class="btn ghost" data-faq-page="${state.faqPage+1}" ${state.faqPage>=pages?"disabled":""}>Siguiente</button>`;
    document.querySelectorAll("[data-edit-faq]").forEach(button=>button.onclick=()=>{const f=state.admin.faqs.find(x=>String(x.id)===button.dataset.editFaq);$("faq-id").value=f.id;$("faq-version").value=f.version;$("faq-question").value=f.question;$("faq-answer").value=f.answer;$("faq-active").checked=f.active;$("faq-order").value=f.sort_order;});
    const update=async(f,changes)=>{await rpc("admin_upsert_faq",{p_id:f.id,p_question:f.question,p_answer:f.answer,p_active:changes.active??f.active,p_sort_order:f.sort_order,p_expected_version:f.version,p_delete:changes.delete||false});await loadAdmin();};
    document.querySelectorAll("[data-toggle-faq]").forEach(button=>button.onclick=async()=>{const f=state.admin.faqs.find(x=>String(x.id)===button.dataset.toggleFaq);try{await update(f,{active:!f.active});}catch(error){toast(error.message);}});document.querySelectorAll("[data-delete-faq]").forEach(button=>button.onclick=async()=>{const f=state.admin.faqs.find(x=>String(x.id)===button.dataset.deleteFaq);if(!confirm(`¿Eliminar “${f.question}”?`))return;try{await update(f,{delete:true});}catch(error){toast(error.message);}});document.querySelectorAll("[data-faq-page]").forEach(button=>button.onclick=()=>{if(button.disabled)return;state.faqPage=Number(button.dataset.faqPage);renderFaqAdmin();});
  }
  function renderPhraseAdmin(){
    const query=$("phrase-search").value.trim().toLowerCase(),all=(state.admin.phrases||[]).filter(p=>!query||p.phrase.toLowerCase().includes(query)),start=(state.phrasePage-1)*state.phraseSize,items=all.slice(start,start+state.phraseSize),pages=Math.max(1,Math.ceil(all.length/state.phraseSize));$("phrase-admin-list").innerHTML=items.map(p=>`<article><div><strong>${escapeHtml(p.phrase)}</strong><span>${p.campaign_id?"Campaña":"Global"} · ${p.active?"Activa":"Inactiva"} · orden ${p.sort_order}</span></div><div><button class="btn ghost" data-edit-phrase="${p.id}">Editar</button><button class="btn ghost" data-toggle-phrase="${p.id}">${p.active?"Desactivar":"Activar"}</button><button class="btn ghost" data-delete-phrase="${p.id}">Eliminar</button></div></article>`).join("")||'<p class="muted">Sin frases para este filtro.</p>';$("phrase-pagination").innerHTML=`<button class="btn ghost" data-phrase-page="${state.phrasePage-1}" ${state.phrasePage<=1?"disabled":""}>Anterior</button><span>${state.phrasePage} / ${pages}</span><button class="btn ghost" data-phrase-page="${state.phrasePage+1}" ${state.phrasePage>=pages?"disabled":""}>Siguiente</button>`;
    document.querySelectorAll("[data-edit-phrase]").forEach(button=>button.onclick=()=>{const p=state.admin.phrases.find(x=>String(x.id)===button.dataset.editPhrase);$("phrase-id").value=p.id;$("phrase-version").value=p.version;$("phrase-campaign").value=p.campaign_id||"";$("phrase-text").value=p.phrase;$("phrase-order").value=p.sort_order;$("phrase-active").checked=p.active;});
    const update=async(p,changes)=>{await rpc("admin_upsert_welcome_phrase",{p_id:p.id,p_campaign_id:p.campaign_id,p_phrase:p.phrase,p_active:changes.active??p.active,p_sort_order:p.sort_order,p_expected_version:p.version,p_delete:changes.delete||false});await loadAdmin();};document.querySelectorAll("[data-toggle-phrase]").forEach(button=>button.onclick=async()=>{const p=state.admin.phrases.find(x=>String(x.id)===button.dataset.togglePhrase);try{await update(p,{active:!p.active});}catch(error){toast(error.message);}});document.querySelectorAll("[data-delete-phrase]").forEach(button=>button.onclick=async()=>{const p=state.admin.phrases.find(x=>String(x.id)===button.dataset.deletePhrase);if(!confirm("¿Eliminar esta frase?"))return;try{await update(p,{delete:true});}catch(error){toast(error.message);}});document.querySelectorAll("[data-phrase-page]").forEach(button=>button.onclick=()=>{if(button.disabled)return;state.phrasePage=Number(button.dataset.phrasePage);renderPhraseAdmin();});
  }
  function bindContentV2(){
    const loadPage=()=>{loadSelectedPage();const page=state.admin.pages.find(p=>p.slug===$("site-page-slug").value),draft=page?.draft;if(page?.slug==="contact")$("site-contact-fields").innerHTML=[["email","Email"],["phone","Teléfono"],["instagram","Instagram HTTPS"],["address","Dirección pública"],["hours","Horarios"],["commercial","Información comercial"]].map(([key,label])=>`<label>${label}<input data-contact-field="${key}" maxlength="500" value="${escapeHtml(draft?.content?.[key]||"")}"></label>`).join("");renderPagePreviewAndHistory();};
    $("site-page-slug").onchange=loadPage;loadPage();$("site-page-title").oninput=renderPagePreviewAndHistory;$("site-page-body").oninput=renderPagePreviewAndHistory;
    $("site-page-form").onsubmit=async event=>{event.preventDefault();const content={body:$("site-page-body").value};document.querySelectorAll("[data-contact-field]").forEach(input=>content[input.dataset.contactField]=input.value.trim());try{await rpc("admin_save_content_draft",{p_slug:$("site-page-slug").value,p_title:$("site-page-title").value,p_content:content,p_expected_version:Number($("site-page-version").value)});await loadAdmin();}catch(error){toast(error.message);}};$("site-publish-page").onclick=async()=>{if(!confirm("¿Publicar este contenido? Los visitantes lo verán inmediatamente."))return;try{await rpc("admin_publish_content_page",{p_slug:$("site-page-slug").value,p_expected_version:Number($("site-page-version").value)});await loadAdmin();}catch(error){toast(error.message);}};
    $("site-faq-form").onsubmit=async event=>{event.preventDefault();try{await rpc("admin_upsert_faq",{p_id:$("faq-id").value||null,p_question:$("faq-question").value,p_answer:$("faq-answer").value,p_active:$("faq-active").checked,p_sort_order:Number($("faq-order").value),p_expected_version:Number($("faq-version").value),p_delete:false});await loadAdmin();}catch(error){toast(error.message);}};$("faq-search").oninput=()=>{state.faqPage=1;renderFaqAdmin();};$("faq-page-size").value=String(state.faqSize);$("faq-page-size").onchange=e=>{state.faqSize=Number(e.target.value);state.faqPage=1;renderFaqAdmin();};renderFaqAdmin();
    $("site-phrase-form").onsubmit=async event=>{event.preventDefault();try{await rpc("admin_upsert_welcome_phrase",{p_id:$("phrase-id").value||null,p_campaign_id:$("phrase-campaign").value||null,p_phrase:$("phrase-text").value,p_active:$("phrase-active").checked,p_sort_order:Number($("phrase-order").value),p_expected_version:Number($("phrase-version").value),p_delete:false});await loadAdmin();}catch(error){toast(error.message);}};$("phrase-search").oninput=()=>{state.phrasePage=1;renderPhraseAdmin();};$("phrase-page-size").value=String(state.phraseSize);$("phrase-page-size").onchange=e=>{state.phraseSize=Number(e.target.value);state.phrasePage=1;renderPhraseAdmin();};renderPhraseAdmin();
  }
  function bindSuggestions(){$("admin-suggestion-load").onclick=()=>{state.suggestionPage=1;state.suggestionLifecycle=$("admin-suggestion-lifecycle").value;loadSuggestions();};$("admin-suggestion-lifecycle").value=state.suggestionLifecycle;loadSuggestions();}
  async function loadSuggestions(){const list=$("admin-suggestion-list");if(!list)return;list.innerHTML='<p class="muted">Cargando…</p>';try{const data=await rpc("admin_list_suggestions",{p_page:state.suggestionPage,p_page_size:Number($("admin-suggestion-size").value),p_search:$("admin-suggestion-search").value,p_status:$("admin-suggestion-status").value,p_category:$("admin-suggestion-category").value,p_sort:$("admin-suggestion-sort").value,p_lifecycle:state.suggestionLifecycle});list.innerHTML=data.items.length?data.items.map(s=>`<article class="site-suggestion-row"><div><strong>${escapeHtml(s.subject)}</strong><span>${escapeHtml(s.category)} · ${escapeHtml(s.status)} · revisión ${s.revision} · ${new Date(s.created_at).toLocaleString("es-AR")}</span>${s.recent_duplicate_count?`<small>${s.recent_duplicate_count} duplicado(s) reciente(s)</small>`:""}${s.archived_at?'<small>Archivada</small>':""}${s.deleted_at?'<small>Eliminada lógicamente</small>':""}</div><div><button class="btn secondary" type="button" data-open-suggestion="${s.id}">Ver detalle</button></div></article>`).join(""):'<p class="muted">No hay sugerencias para este filtro.</p>';list.querySelectorAll("[data-open-suggestion]").forEach(button=>button.onclick=()=>openSuggestionDetail(button.dataset.openSuggestion));const pages=Math.max(1,Math.ceil(data.total/data.page_size)),pager=$("admin-suggestion-pagination");pager.innerHTML=pages>1?`<button class="btn ghost" ${data.page<=1?"disabled":""} data-suggestion-page="${data.page-1}">Anterior</button><span>${data.page} / ${pages}</span><button class="btn ghost" ${data.page>=pages?"disabled":""} data-suggestion-page="${data.page+1}">Siguiente</button>`:"";pager.querySelectorAll("[data-suggestion-page]").forEach(button=>button.onclick=()=>{state.suggestionPage=Number(button.dataset.suggestionPage);loadSuggestions();});}catch(error){list.innerHTML=`<p class="muted">${escapeHtml(error.message)}</p>`;}}
  async function openSuggestionDetail(id){const host=$("admin-suggestion-detail");if(!host)return;host.classList.remove("hidden");host.innerHTML='<p class="muted">Cargando detalle…</p>';try{const s=await rpc("admin_get_suggestion",{p_id:id}),history=(s.history||[]).map(h=>`<li><strong>${escapeHtml(h.operation)}</strong> · revisión ${h.previous_revision} → ${h.new_revision} · ${new Date(h.occurred_at).toLocaleString("es-AR")}<span>${h.reason?escapeHtml(h.reason):"Sin motivo adicional"}</span></li>`).join("");host.innerHTML=`<div class="form-block-head"><div><h3>${escapeHtml(s.subject)}</h3><p class="muted">${escapeHtml(s.category)} · revisión ${s.revision}${s.recent_duplicate_count?` · ${s.recent_duplicate_count} duplicado(s) reciente(s)`:""}</p></div><button class="btn ghost" type="button" id="close-suggestion-detail">Cerrar</button></div><p>${escapeHtml(s.description)}</p>${s.contact?`<p><strong>Contacto:</strong> ${escapeHtml(s.contact)}</p>`:""}<div class="form-grid"><label>Estado<select id="suggestion-detail-status">${["new","reviewing","accepted","resolved","dismissed"].map(value=>`<option value="${value}" ${s.status===value?"selected":""}>${value}</option>`).join("")}</select></label><label>Motivo administrativo<input id="suggestion-detail-reason" maxlength="1000" placeholder="Obligatorio para cerrar, archivar, eliminar o restaurar"></label></div><label>Notas privadas<textarea id="suggestion-detail-notes" maxlength="4000" rows="4">${escapeHtml(s.private_notes)}</textarea></label><div class="site-config-actions"><button class="btn secondary" type="button" id="save-suggestion-detail">Guardar cambios</button>${s.deleted_at?'<button class="btn ghost" type="button" data-suggestion-lifecycle="restore">Restaurar</button>':`${s.archived_at?'<button class="btn ghost" type="button" data-suggestion-lifecycle="unarchive">Desarchivar</button>':'<button class="btn ghost" type="button" data-suggestion-lifecycle="archive">Archivar</button>'}<button class="btn ghost" type="button" data-suggestion-lifecycle="soft_delete">Eliminar lógicamente</button>`}</div><h4>Historial (${s.history_total})</h4><ol class="site-version-history">${history||'<li class="muted">Sin cambios administrativos.</li>'}</ol>`;$("close-suggestion-detail").onclick=()=>host.classList.add("hidden");$("save-suggestion-detail").onclick=async()=>{try{const result=await rpc("admin_update_suggestion",{p_id:s.id,p_status:$("suggestion-detail-status").value,p_private_notes:$("suggestion-detail-notes").value,p_expected_revision:s.revision,p_reason:$("suggestion-detail-reason").value});if(result.status==="conflict"){toast("La sugerencia cambió en otra sesión. Recargamos el estado actual.");await openSuggestionDetail(s.id);await loadSuggestions();return;}toast(result.status==="unchanged"?"No había cambios para guardar.":"Sugerencia actualizada.");await openSuggestionDetail(s.id);await loadSuggestions();}catch(error){toast(error.message);}};host.querySelectorAll("[data-suggestion-lifecycle]").forEach(button=>button.onclick=async()=>{try{const result=await rpc("admin_set_suggestion_lifecycle",{p_id:s.id,p_action:button.dataset.suggestionLifecycle,p_expected_revision:s.revision,p_reason:$("suggestion-detail-reason").value});if(result.status==="conflict"){toast("La sugerencia cambió en otra sesión. Recargamos el estado actual.");await openSuggestionDetail(s.id);await loadSuggestions();return;}toast(result.status==="unchanged"?"La sugerencia ya estaba en ese estado.":"Ciclo de vida actualizado.");await openSuggestionDetail(s.id);await loadSuggestions();}catch(error){toast(error.message);}});}catch(error){host.innerHTML=`<p class="muted">${escapeHtml(error.message)}</p>`;}}

  function applyStageCSurfaces(){
    // La disponibilidad del módulo nunca concede visibilidad administrativa.
    // renderApp/renderAccountSidebar son quienes pueden quitar .hidden después
    // de confirmar rol administrador y MFA AAL2.
    document.querySelectorAll('[data-stage-c="admin"]').forEach(element=>{if(!adminAccessAllowed())element.classList.add("hidden");});
    document.querySelectorAll('[data-stage-c="public"]').forEach(element=>element.classList.toggle("hidden",!publicEnabled()));
  }
  window.addEventListener("cubica:auth-ready",()=>{
    const section=$("section-configuration"),reload=adminAccessAllowed()&&section&&!section.classList.contains("hidden");
    // AAL2 token renewal for the same administrator must not discard an unresolved creation.
    const owner=typeof session!=="undefined"?session?.supabaseUserId:null;
    if(adminAccessAllowed()&&owner&&owner===state.campaignOwner&&state.campaignDraft){captureCampaignForm();applyStageCSurfaces();return;}
    clearAdminState();applyStageCSurfaces();
    if(reload)loadAdmin();
  });
  window.addEventListener("beforeunload",event=>{if(state.campaignAttempt){event.preventDefault();event.returnValue="";}});
  document.addEventListener("DOMContentLoaded",()=>{
    applyStageCSurfaces();
    resolveWelcomePreference();
    if(!publicEnabled())return;
    loadPublicExperience();
    document.querySelectorAll("[data-public-page]").forEach(button=>button.addEventListener("click",()=>openPublicPage(button.dataset.publicPage)));
    $("public-suggestion-form")?.addEventListener("submit",submitSuggestion);
    $("public-suggestion-form")?.addEventListener("input",()=>{if(!state.suggestionSubmitting)state.suggestionRequestId=null;});
    const page=new URLSearchParams(location.search).get("page");if(["about","contact","terms","community","faq","suggestions"].includes(page)&&!window.cubicaAuthCallbackBlocked&&!window.cubicaPasswordRecoveryActive)openPublicPage(page,{push:false});
    window.addEventListener("popstate",()=>{const current=new URLSearchParams(location.search).get("page");current?openPublicPage(current,{push:false}):showSection("store");});
  });
  window.cubicaSiteExperience={loadAdmin,loadPublicExperience,openPublicPage,validateAppearance,renderMarkdown,stageCMode,adminEnabled,publicEnabled,adminAccessAllowed,applyStageCSurfaces,resolveWelcomePreference,shouldBypassWelcome};
  if(window.__CUBICA_TEST__===true)window.cubicaSiteExperienceInternals={state,renderAdmin,clearAdminState,campaignPayload,campaignIntervals,campaignLocal,localToIso,campaignMonthRange,monthCalendarV2,moveCampaignMonth,campaignOverlapNames,bindCampaignsV2,saveCampaign,campaignAction,startCampaignEdit,captureCampaignForm,defaultAppearance:deepMerge(DEFAULT_APPEARANCE,{}),validHex,contrast,collectAppearance,fillAppearanceForm,updatePreview};
})();
