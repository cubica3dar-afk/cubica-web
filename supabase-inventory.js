/* Sincronización de inventario y recetas con Supabase.
   Etapa 3: insumos, categorías de insumos y recetas.
*/
(function(){
  const client = window.cubicaSupabase;
  if(!client) return;

  let inventorySyncing=false;
  let inventoryTimer=null;
  let inventoryLoaded=false;

  function setBadge(text,mode="ok"){
    if(typeof updateServerBadge==="function") updateServerBadge(text,mode);
  }

  async function fetchSuppliesCompat(){
    // v2: marca + orden personalizado.
    let result=await client.from("supplies")
      .select("id,name,category,cost,qty,unit,material_type,brand,color_name,color_hex,sort_order,active")
      .eq("active",true)
      .order("sort_order",{ascending:true})
      .order("created_at",{ascending:true});

    if(result.error && /brand|sort_order|column .* does not exist/i.test(String(result.error.message||""))){
      // v1: material y color, todavía sin marca/orden.
      result=await client.from("supplies")
        .select("id,name,category,cost,qty,unit,material_type,color_name,color_hex,active")
        .eq("active",true)
        .order("created_at",{ascending:true});
    }

    if(result.error && /material_type|color_name|color_hex|column .* does not exist/i.test(String(result.error.message||""))){
      // Compatibilidad con el esquema inicial.
      result=await client.from("supplies")
        .select("id,name,category,cost,qty,unit,active")
        .eq("active",true)
        .order("created_at",{ascending:true});
    }
    return result;
  }

  async function loadInventoryFromSupabase(){
    if(session?.role!=="admin") return;
    try{
      const [{data:cats,error:catErr},{data:sup,error:supErr},{data:recipes,error:recErr}] = await Promise.all([
        client.from("supply_categories").select("name,sort_order,active").eq("active",true).order("sort_order"),
        fetchSuppliesCompat(),
        client.from("product_recipes").select("product_id,supply_id,qty_per_unit")
      ]);
      if(catErr) throw catErr;
      if(supErr) throw supErr;
      if(recErr) throw recErr;

      supplyCategories = (cats||[]).map(x=>x.name);
      supplies = (sup||[]).map((x,i)=>normalizeSupply({
        id:x.id,
        name:x.name,
        category:x.category||"Otros",
        cost:Number(x.cost)||0,
        qty:Number(x.qty)||0,
        unit:x.unit||"unidades",
        materialType:x.material_type||"",
        brand:x.brand||"",
        colorName:x.color_name||"",
        colorHex:x.color_hex||"#ffffff",
        sortOrder:Number(x.sort_order)||((i+1)*10)
      }));

      const recipesByProduct=new Map();
      for(const r of recipes||[]){
        if(!recipesByProduct.has(r.product_id)) recipesByProduct.set(r.product_id,[]);
        recipesByProduct.get(r.product_id).push({
          supplyId:r.supply_id,
          qty:Number(r.qty_per_unit)||0
        });
      }

      products = products.map(p=>normalizeProduct({
        ...p,
        recipe: recipesByProduct.get(p.id) || []
      }));

      writeLocal(STORAGE.supplyCategories,supplyCategories);
      writeLocal(STORAGE.supplies,supplies);
      writeLocal(STORAGE.products,products);
      inventoryLoaded=true;

      if(session?.role==="admin"){
        renderSupplies();
        renderFinishedStock();
        renderBudget();
      }
      setBadge("Datos: Supabase","ok");
    }catch(err){
      console.error("Inventario Supabase",err);
      setBadge("Supabase: inventario sin conexión","error");
    }
  }

  async function saveSupplyCategoriesToSupabase(list){
    const payload=[...new Set((list||[]).map(x=>String(x||"").trim()).filter(Boolean))]
      .map((name,i)=>({name,sort_order:(i+1)*10,active:true}));
    if(payload.length){
      const {error}=await client.from("supply_categories").upsert(payload,{onConflict:"name"});
      if(error) throw error;
    }
  }

  async function saveSuppliesToSupabase(list,{removeMissing=true}={}){
    const rows=(list||[]).map(raw=>{
      const s=normalizeSupply(raw);
      return {
        id:String(s.id),
        name:String(s.name||""),
        category:s.category||null,
        cost:Number(s.cost)||0,
        qty:Number(s.qty)||0,
        unit:String(s.unit||"unidades"),
        material_type:s.category==="Filamentos"?(s.materialType||null):null,
        brand:s.category==="Filamentos"?(s.brand||null):null,
        color_name:s.category==="Filamentos"?(s.colorName||null):null,
        color_hex:s.category==="Filamentos"?(s.colorHex||"#ffffff"):null,
        sort_order:Number(s.sortOrder)||0,
        active:s.active!==false
      };
    });

    if(removeMissing){
      const {data:existing,error}=await client.from("supplies").select("id");
      if(error) throw error;
      const keep=new Set(rows.map(r=>r.id));
      const remove=(existing||[]).map(x=>String(x.id)).filter(id=>!keep.has(id));
      if(remove.length){
        const d=await client.from("supplies").delete().in("id",remove);
        if(d.error) throw d.error;
      }
    }

    if(rows.length){
      let {error}=await client.from("supplies").upsert(rows,{onConflict:"id"});

      if(error && /brand|sort_order|column .* does not exist/i.test(String(error.message||""))){
        const v1Rows=rows.map(({brand,sort_order,...rest})=>rest);
        const retryV1=await client.from("supplies").upsert(v1Rows,{onConflict:"id"});
        error=retryV1.error;
      }

      if(error && /material_type|color_name|color_hex|column .* does not exist/i.test(String(error.message||""))){
        const legacyRows=rows.map(({material_type,brand,color_name,color_hex,sort_order,...rest})=>rest);
        const retryLegacy=await client.from("supplies").upsert(legacyRows,{onConflict:"id"});
        error=retryLegacy.error;
      }

      if(error) throw error;
    }
  }

  async function saveRecipesToSupabase(list){
    const productIds=(list||[]).map(p=>String(p.id));
    if(productIds.length){
      const d=await client.from("product_recipes").delete().in("product_id",productIds);
      if(d.error) throw d.error;
    }

    const rows=[];
    for(const p of list||[]){
      for(const r of (Array.isArray(p.recipe)?p.recipe:[])){
        const qty=Number(r.qty)||0;
        if(!r.supplyId || qty<=0) continue;
        rows.push({
          product_id:String(p.id),
          supply_id:String(r.supplyId),
          qty_per_unit:qty
        });
      }
    }
    if(rows.length){
      const {error}=await client.from("product_recipes").insert(rows);
      if(error) throw error;
    }
  }

  async function migrateInventoryToSupabase(){
    if(session?.role!=="admin") throw new Error("Solo el administrador puede migrar el inventario.");
    inventorySyncing=true;
    try{
      setBadge("Supabase: migrando inventario…","pending");
      await saveSupplyCategoriesToSupabase(supplyCategories);
      await saveSuppliesToSupabase(supplies,{removeMissing:false});
      await saveRecipesToSupabase(products);
      await loadInventoryFromSupabase();
      toast("Insumos y recetas migrados a Supabase correctamente.");
    }finally{
      inventorySyncing=false;
    }
  }
  window.migrateCubicaInventoryToSupabase=migrateInventoryToSupabase;

  async function syncInventoryNow(){
    if(session?.role!=="admin" || inventorySyncing) return;
    inventorySyncing=true;
    try{
      await saveSupplyCategoriesToSupabase(supplyCategories);
      await saveSuppliesToSupabase(supplies,{removeMissing:true});
      await saveRecipesToSupabase(products);
      inventoryLoaded=true;
      setBadge("Datos: Supabase","ok");
    }finally{
      inventorySyncing=false;
    }
  }

  const previousHook=window.cubicaOnLocalWrite;
  window.cubicaOnLocalWrite=function(key,value){
    if(typeof previousHook==="function") previousHook(key,value);
    if(session?.role!=="admin") return;
    if(![STORAGE.supplies,STORAGE.supplyCategories,STORAGE.products].includes(key)) return;
    clearTimeout(inventoryTimer);
    inventoryTimer=setTimeout(async()=>{
      try{
        await syncInventoryNow();
      }catch(err){
        console.error("Sincronización inventario",err);
        setBadge("Supabase: inventario sin sincronizar","error");
        toast("El cambio quedó local, pero no pudo sincronizarse con Supabase.");
      }
    },600);
  };

  async function inspectInventoryAndOfferMigration({forcePrompt=false}={}){
    if(session?.role!=="admin") return;
    try{
      const {data,error}=await client.from("supplies").select("id").limit(1);
      if(error) throw error;

      if(!data?.length){
        setBadge("Supabase: inventario pendiente","warn");
        const already=sessionStorage.getItem("cubica_inventory_migration_prompted");
        if(forcePrompt || !already){
          sessionStorage.setItem("cubica_inventory_migration_prompted","1");
          const ok=confirm("Supabase todavía no tiene insumos ni recetas. ¿Migrar ahora el inventario actual de este navegador?");
          if(ok) await migrateInventoryToSupabase();
        }
        return;
      }
      await loadInventoryFromSupabase();
      if(forcePrompt){
        toast("Supabase conectado: productos, insumos, recetas, ventas y presupuestos están centralizados.");
      }
    }catch(err){
      console.error("Revisión inventario Supabase",err);
      setBadge("Supabase: inventario sin conexión","error");
      toast("No se pudo revisar el inventario de Supabase.");
    }
  }

  window.addEventListener("cubica:auth-ready", async(e)=>{
    if(e.detail?.role!=="admin") return;
    // Espera un instante para que toda la app termine de inicializarse antes de preguntar.
    setTimeout(()=>inspectInventoryAndOfferMigration({forcePrompt:false}),500);
  });

  document.addEventListener("DOMContentLoaded",()=>{
    const badge=document.getElementById("server-sync-badge");
    if(badge){
      badge.onclick=async()=>{
        if(session?.role!=="admin"){
          toast("El estado de datos se gestiona desde Supabase.");
          return;
        }
        await inspectInventoryAndOfferMigration({forcePrompt:true});
      };
    }
  });
})();
