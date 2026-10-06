/* Cúbica + Supabase
   Etapa 2: autenticación real + catálogo online.
   Productos/categorías/colores se leen desde Supabase.
   El administrador puede migrar el catálogo local actual una sola vez.
*/
(function(){
  const cfg = window.CUBICA_CONFIG || {};
  const url = cfg.supabaseUrl;
  const key = cfg.supabasePublishableKey;
  if(!url || !key || !window.supabase){
    console.warn("Supabase no está configurado.");
    return;
  }

  const client = window.supabase.createClient(url, key);
  window.cubicaSupabase = client;

  let catalogLoadedFromSupabase = false;
  let catalogSyncTimer = null;
  let catalogSyncing = false;
  let catalogLoadInProgress = false;

  function setDataBadge(text, mode="ok"){
    if(typeof updateServerBadge === "function") updateServerBadge(text, mode);
  }

  async function profileFor(user){
    if(!user) return null;
    const { data, error } = await client
      .from("profiles")
      .select("id,email,display_name,role")
      .eq("id", user.id)
      .maybeSingle();

    if(error){
      console.error("No se pudo leer el perfil:", error);
      return { id:user.id, email:user.email || "", display_name:user.email || "", role:"customer" };
    }
    return data || { id:user.id, email:user.email || "", display_name:user.email || "", role:"customer" };
  }

  async function applySupabaseSession(sbSession, showToast=false){
    if(!sbSession?.user){
      session = null;
      localStorage.removeItem(STORAGE.session);
      renderApp();
      window.dispatchEvent(new CustomEvent("cubica:auth-ready",{detail:{role:null}}));
      return;
    }

    const profile = await profileFor(sbSession.user);
    session = {
      username: profile?.display_name || sbSession.user.email || "usuario",
      email: sbSession.user.email || profile?.email || "",
      role: profile?.role === "admin" ? "admin" : "customer",
      supabaseUserId: sbSession.user.id,
      avatarUrl: sbSession.user.user_metadata?.avatar_url || "",
      avatarPath: sbSession.user.user_metadata?.avatar_path || ""
    };
    writeLocal(STORAGE.session, session);
    renderApp();
    window.dispatchEvent(new CustomEvent("cubica:auth-ready",{detail:{role:session.role}}));
    if(showToast) toast(session.role === "admin" ? "Sesión de administrador iniciada" : "Sesión iniciada");
  }

  function remoteProductToLocal(row, colorsByProduct, mediaByProduct, previousById){
    const previous = previousById.get(row.id) || {};
    const remoteMedia = mediaByProduct.get(row.id) || [];
    return normalizeProduct({
      id: row.id,
      name: row.name,
      category: row.category || "",
      description: row.description || "",
      price: Number(row.price) || 0,
      stock: Number(row.stock) || 0,
      colorMode: row.color_mode === "multiple" ? "multiple" : "single",
      active: row.active !== false,
      colors: (colorsByProduct.get(row.id) || []).map(c=>({name:c.name,hex:c.hex})),
      // Las recetas se migran en la próxima etapa. Mientras tanto conservamos
      // la receta local si existe en este navegador y el ID coincide.
      recipe: Array.isArray(previous.recipe) ? previous.recipe : [],
      // Si todavía no hay medios en Supabase, conservamos temporalmente los locales.
      media: remoteMedia.length ? remoteMedia : (Array.isArray(previous.media) ? previous.media : [])
    });
  }

  async function loadCatalogFromSupabase(){
    if(catalogLoadInProgress) return;
    catalogLoadInProgress = true;
    try{
      setDataBadge("Datos: Supabase…","pending");

      const { data: rows, error: productError } = await client
        .from("products")
        .select("id,name,category,description,price,stock,color_mode,active")
        .eq("active", true)
        .order("created_at", { ascending:true });

      if(productError) throw productError;

      if(!rows?.length){
        catalogLoadedFromSupabase = false;
        setDataBadge("Supabase: catálogo pendiente","warn");

        if(session?.role === "admin" && !sessionStorage.getItem("cubica_catalog_migration_prompted")){
          sessionStorage.setItem("cubica_catalog_migration_prompted","1");
          setTimeout(async()=>{
            if(!confirm("La base de productos de Supabase está vacía. ¿Migrar ahora el catálogo actual de este navegador a Supabase?")) return;
            try{
              await migrateProductsToSupabase();
            }catch(err){
              console.error(err);
              toast("No se pudo migrar el catálogo: "+(err.message||"error desconocido"));
            }
          },300);
        }
        return;
      }

      const ids = rows.map(r=>r.id);
      const previousById = new Map((products||[]).map(p=>[p.id,p]));

      const [{data:colors,error:colorError},{data:media,error:mediaError}] = await Promise.all([
        client.from("product_colors").select("product_id,name,hex,sort_order").in("product_id",ids).order("sort_order"),
        client.from("product_media").select("product_id,media_type,storage_path,public_url,file_name,sort_order").in("product_id",ids).order("sort_order")
      ]);
      if(colorError) throw colorError;
      if(mediaError) throw mediaError;

      const colorsByProduct = new Map();
      for(const c of colors||[]){
        if(!colorsByProduct.has(c.product_id)) colorsByProduct.set(c.product_id,[]);
        colorsByProduct.get(c.product_id).push(c);
      }

      const mediaByProduct = new Map();
      for(const m of media||[]){
        if(!m.public_url) continue;
        if(!mediaByProduct.has(m.product_id)) mediaByProduct.set(m.product_id,[]);
        const storagePath=m.storage_path||"";
        const socialMatch=storagePath.match(/^external\/social\/(youtube|instagram|tiktok)\//);
        mediaByProduct.get(m.product_id).push({
          id:"remote-"+m.product_id+"-"+m.sort_order,
          type:socialMatch?"social":m.media_type,
          src:m.public_url,
          name:m.file_name||"",
          storagePath,
          source:socialMatch?"social":storagePath.startsWith("external/")?"url":"storage",
          provider:socialMatch?socialMatch[1]:""
        });
      }

      products = rows.map(r=>remoteProductToLocal(r,colorsByProduct,mediaByProduct,previousById));
      writeLocal(STORAGE.products,products);
      catalogLoadedFromSupabase = true;
      setDataBadge("Datos: Supabase","ok");
      renderProducts();
      if(session?.role==="admin") renderFinishedStock();
    }catch(err){
      console.error("Catálogo Supabase",err);
      catalogLoadedFromSupabase = false;
      setDataBadge("Supabase: sin conexión","error");
    }finally{
      catalogLoadInProgress = false;
    }
  }

  function productRows(list){
    return list.map(p=>({
      id:String(p.id),
      name:String(p.name||""),
      category:p.category||null,
      description:String(p.description||""),
      price:Number(p.price)||0,
      stock:Math.max(0,Math.trunc(Number(p.stock)||0)),
      color_mode:p.colorMode==="multiple"?"multiple":"single",
      active:p.active!==false
    }));
  }

  async function ensureProductCategories(list){
    const names=[...new Set(list.map(p=>String(p.category||"").trim()).filter(Boolean))];
    if(!names.length) return;
    const payload=names.map((name,i)=>({name,sort_order:(i+1)*10,active:true}));
    const {error}=await client.from("product_categories").upsert(payload,{onConflict:"name"});
    if(error) throw error;
  }

  function isManagedProductMediaPath(path){
    return typeof path==="string" && path.startsWith("products/");
  }

  async function removeStoragePaths(paths){
    const unique=[...new Set((paths||[]).filter(isManagedProductMediaPath))];
    if(!unique.length) return;
    const {error}=await client.storage.from("product-media").remove(unique);
    if(error) throw error;
  }

  async function syncProductChildren(list){
    for(const p of list){
      let r=await client.from("product_colors").delete().eq("product_id",String(p.id));
      if(r.error) throw r.error;
      const colors=(Array.isArray(p.colors)?p.colors:[])
        .filter(c=>c?.name)
        .map((c,i)=>({product_id:String(p.id),name:String(c.name),hex:/^#[0-9a-f]{6}$/i.test(c.hex||"")?c.hex:"#ffffff",sort_order:i}));
      if(colors.length){
        r=await client.from("product_colors").insert(colors);
        if(r.error) throw r.error;
      }

      // Cada medio puede venir de Supabase Storage o de una URL externa.
      // Si se quitó un archivo gestionado por Storage, borramos también el archivo físico
      // después de actualizar correctamente las referencias en la base.
      const {data:previousMedia,error:previousMediaError}=await client
        .from("product_media")
        .select("storage_path")
        .eq("product_id",String(p.id));
      if(previousMediaError) throw previousMediaError;

      const media=(Array.isArray(p.media)?p.media:[])
        .filter(m=>m?.src && !String(m.src).startsWith("data:"))
        .map((m,i)=>({
          product_id:String(p.id),
          // La tabla mantiene media_type image/video; los embeds sociales se distinguen por storage_path.
          media_type:(m.type==="video"||m.type==="social")?"video":"image",
          storage_path:String(
            m.storagePath ||
            (m.type==="social" && m.provider
              ? `external/social/${m.provider}/${p.id}-${i}`
              : `external/${p.id}/${i}`)
          ),
          public_url:String(m.src),
          file_name:String(m.name||""),
          sort_order:i
        }));

      r=await client.from("product_media").delete().eq("product_id",String(p.id));
      if(r.error) throw r.error;
      if(media.length){
        r=await client.from("product_media").insert(media);
        if(r.error) throw r.error;
      }

      const keepPaths=new Set(media.map(m=>m.storage_path).filter(isManagedProductMediaPath));
      const orphanPaths=(previousMedia||[])
        .map(m=>m.storage_path)
        .filter(path=>isManagedProductMediaPath(path) && !keepPaths.has(path));
      await removeStoragePaths(orphanPaths);
    }
  }

  async function saveProductsToSupabase(list,{removeMissing=true}={}){
    if(session?.role!=="admin") return;
    if(catalogSyncing) return;
    catalogSyncing=true;
    try{
      await ensureProductCategories(list);

      if(removeMissing){
        const {data:existing,error}=await client.from("products").select("id");
        if(error) throw error;
        const keep=new Set(list.map(p=>String(p.id)));
        const remove=(existing||[]).map(x=>x.id).filter(id=>!keep.has(String(id)));
        if(remove.length){
          const {data:removedMedia,error:removedMediaError}=await client
            .from("product_media")
            .select("storage_path")
            .in("product_id",remove);
          if(removedMediaError) throw removedMediaError;

          const d=await client.from("products").delete().in("id",remove);
          if(d.error) throw d.error;

          await removeStoragePaths((removedMedia||[]).map(m=>m.storage_path));
        }
      }

      const rows=productRows(list);
      if(rows.length){
        const {error}=await client.from("products").upsert(rows,{onConflict:"id"});
        if(error) throw error;
      }
      await syncProductChildren(list);
      catalogLoadedFromSupabase=true;
      setDataBadge("Datos: Supabase","ok");
    }finally{
      catalogSyncing=false;
    }
  }

  window.loadCubicaCatalogFromSupabase=loadCatalogFromSupabase;

  async function uploadProductMedia(file,type){
    if(session?.role!=="admin") throw new Error("Solo el administrador puede subir archivos.");
    if(!file) throw new Error("Archivo inválido.");

    const allowedImage=["image/jpeg","image/png","image/webp"];
    const allowedVideo=["video/mp4","video/webm"];
    const allowed=type==="video"?allowedVideo:allowedImage;
    const max=type==="video"?8*1024*1024:5*1024*1024;

    if(!allowed.includes(file.type)) throw new Error("Formato de archivo no permitido.");
    if(file.size>max) throw new Error(`${file.name} supera el límite de ${Math.round(max/1024/1024)} MB.`);

    const ext=(file.name.split(".").pop()|| (type==="video"?"mp4":"jpg")).toLowerCase().replace(/[^a-z0-9]/g,"");
    const token=(globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2)).replace(/-/g,"");
    const path=`products/${session.supabaseUserId||"admin"}/${Date.now()}-${token}.${ext}`;

    const {error}=await client.storage.from("product-media").upload(path,file,{
      cacheControl:"3600",
      upsert:false,
      contentType:file.type
    });
    if(error) throw error;

    const {data}=client.storage.from("product-media").getPublicUrl(path);
    if(!data?.publicUrl) throw new Error("No se pudo obtener la URL pública del archivo.");

    return {
      id:"m"+Date.now().toString(36)+Math.random().toString(36).slice(2,7),
      type:type==="video"?"video":"image",
      src:data.publicUrl,
      name:file.name,
      storagePath:path,
      source:"storage"
    };
  }
  window.cubicaUploadProductMedia=uploadProductMedia;

  async function uploadProfileAvatar(file){
    if(session?.role!=="admin") throw new Error("Solo el administrador puede cambiar la foto de perfil.");
    if(!file) throw new Error("Archivo inválido.");
    const allowed=["image/jpeg","image/png","image/webp"];
    if(!allowed.includes(file.type)) throw new Error("Usá una imagen JPG, PNG o WEBP.");
    if(file.size>3*1024*1024) throw new Error("La foto de perfil no puede superar 3 MB.");

    const ext=(file.name.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"");
    const token=(globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2)).replace(/-/g,"");
    const path=`profiles/${session.supabaseUserId}/avatar-${Date.now()}-${token}.${ext}`;
    const oldPath=session.avatarPath||"";

    const {error:uploadError}=await client.storage.from("product-media").upload(path,file,{
      cacheControl:"3600",
      upsert:false,
      contentType:file.type
    });
    if(uploadError) throw uploadError;

    const {data:publicData}=client.storage.from("product-media").getPublicUrl(path);
    const publicUrl=publicData?.publicUrl;
    if(!publicUrl){
      await client.storage.from("product-media").remove([path]).catch(()=>{});
      throw new Error("No se pudo obtener la URL de la foto.");
    }

    const {data:updateData,error:updateError}=await client.auth.updateUser({
      data:{avatar_url:publicUrl,avatar_path:path}
    });
    if(updateError){
      await client.storage.from("product-media").remove([path]).catch(()=>{});
      throw updateError;
    }

    if(oldPath && oldPath!==path && oldPath.startsWith("profiles/")){
      const {error:removeError}=await client.storage.from("product-media").remove([oldPath]);
      if(removeError) console.warn("No se pudo borrar el avatar anterior:",removeError);
    }

    session.avatarUrl=publicUrl;
    session.avatarPath=path;
    writeLocal(STORAGE.session,session);
    return {publicUrl,path,user:updateData?.user||null};
  }
  window.cubicaUploadProfileAvatar=uploadProfileAvatar;

  async function migrateProductsToSupabase(){
    if(session?.role!=="admin") throw new Error("Solo el administrador puede migrar productos.");
    if(!Array.isArray(products)||!products.length) throw new Error("No hay productos locales para migrar.");
    setDataBadge("Supabase: migrando…","pending");
    await saveProductsToSupabase(products,{removeMissing:false});
    await loadCatalogFromSupabase();
    toast("Catálogo migrado a Supabase correctamente.");
  }
  window.migrateCubicaProductsToSupabase=migrateProductsToSupabase;

  // Cada cambio de productos hecho desde el panel admin se replica a Supabase.
  window.cubicaOnLocalWrite = function(key,value){
    if(key!==STORAGE.products || session?.role!=="admin") return;
    clearTimeout(catalogSyncTimer);
    catalogSyncTimer=setTimeout(async()=>{
      try{
        await saveProductsToSupabase(value,{removeMissing:true});
      }catch(err){
        console.error("Sincronización de productos",err);
        setDataBadge("Supabase: sin sincronizar","error");
        toast("El cambio quedó local, pero no pudo sincronizarse con Supabase.");
      }
    },500);
  };

  document.addEventListener("DOMContentLoaded", async () => {
    const form = $("login-form");
    if(form){
      form.onsubmit = async (e) => {
        e.preventDefault();
        const email = $("login-user").value.trim();
        const password = $("login-password").value;
        const btn = e.submitter || form.querySelector('button[type="submit"]');
        const old = btn?.textContent || "Iniciar sesión";
        if(btn){ btn.disabled=true; btn.textContent="Ingresando…"; }

        try{
          const {data,error}=await client.auth.signInWithPassword({email,password});
          if(error) throw error;
          await applySupabaseSession(data.session,true);
          await loadCatalogFromSupabase();
          showSection("store");
        }catch(err){
          console.error(err);
          toast(err?.message==="Invalid login credentials"?"Email o contraseña incorrectos.":"No se pudo iniciar sesión.");
        }finally{
          if(btn){btn.disabled=false;btn.textContent=old;}
        }
      };
    }

    const logout=$("logout-btn");
    if(logout){
      logout.onclick=async()=>{
        await client.auth.signOut();
        session=null;
        localStorage.removeItem(STORAGE.session);
        renderApp();
        showSection("store");
        toast("Sesión cerrada");
      };
    }

    const {data}=await client.auth.getSession();
    await applySupabaseSession(data.session,false);
    await loadCatalogFromSupabase();

    client.auth.onAuthStateChange(async(_event,newSession)=>{
      await applySupabaseSession(newSession,false);
      // Al recuperar la sesión al volver a una pestaña no se cambia la sección activa.
      if(newSession?.user && !catalogLoadedFromSupabase) await loadCatalogFromSupabase();
    });
  });
})();
