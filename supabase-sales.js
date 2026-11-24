/* Cúbica + Supabase
   Etapa 4: presupuestos, pedidos y ventas centralizados.
*/
(function(){
  const client=window.cubicaSupabase;
  if(!client) return;

  let salesLoading=false;
  let salesReady=false;

  function setBadge(text,mode="ok"){
    if(typeof updateServerBadge==="function") updateServerBadge(text,mode);
  }

  function adminAccessAllowed(){
    return session?.role==="admin"&&window.cubicaAdminMfaAccessAllowed?.()===true;
  }

  function remoteOrderToLocal(row){
    return {
      id:String(row.id),
      orderNumber:row.order_number||"",
      clientOrderId:row.client_order_id||"",
      date:row.created_at,
      customerName:row.customer_name,
      customerEmail:row.customer_email,
      userId:row.user_id||"",
      phone:row.phone||"",
      payment:row.payment||"",
      notes:row.notes||"",
      total:Number(row.total)||0,
      status:row.status||"Pendiente",
      origin:row.origin||"store",
      quoteId:row.quote_id||null,
      quoteVersion:row.quote_version||null,
      commercialStatus:row.commercial_status||"store_checkout",
      lifecycleVersion:Number(row.lifecycle_version)||0,
      productionStartedAt:row.production_started_at||null,
      username:row.username||"guest",
      supplyPlan:row.supply_plan||{products:[],supplies:[]},
      internalEmailSent:!!row.internal_email_sent,
      customerEmailSent:!!row.customer_email_sent,
      emailErrors:row.email_errors||[],
      delivery:row.delivery||null,
      serverSaved:true,
      items:(row.order_items||[]).map(i=>({
        itemId:i.id,
        productId:i.product_id||"",
        name:i.name,
        color:i.color||"",
        qty:Number(i.qty)||0,
        price:Number(i.unit_price)||0
      }))
    };
  }

  async function fetchRemoteSales(){
    const {data:orderRows,error:orderErr}=await client.rpc("get_admin_orders");
    if(orderErr) throw orderErr;
    return {orderRows:orderRows||[]};
  }

  // Preserve historical browser records for explicit review; never import them.
  function preserveLegacyOrders(){
    const local=read(STORAGE.orders,[]);
    const pending=Array.isArray(local)?local.filter(o=>!o.serverSaved):[];
    if(!pending.length)return;
    const key=STORAGE.orders+".legacy-unreviewed", archived=read(key,[]);
    if(!Array.isArray(archived))throw new Error("Revisá el archivo local de pedidos antes de continuar.");
    const seen=new Set(archived.map(o=>JSON.stringify(o)));
    writeLocal(key,[...archived,...pending.filter(o=>!seen.has(JSON.stringify(o)))]);
  }

  async function loadSalesFromSupabase(){
    if(!adminAccessAllowed() || salesLoading) return;
    salesLoading=true;
    try{
      setBadge("Datos: Supabase…","pending");

      preserveLegacyOrders();
      const remote=await fetchRemoteSales();

      orders=remote.orderRows.map(remoteOrderToLocal);
      writeLocal(STORAGE.orders,orders);
      salesReady=true;

      if(session?.role==="admin"){
        renderOrders();
        renderAnalytics();
      }
      setBadge("Datos: Supabase","ok");

    }catch(err){
      console.error("Ventas/presupuestos Supabase",err);
      setBadge("Supabase: ventas sin sincronizar","error");
    }finally{
      salesLoading=false;
    }
  }
  window.loadCubicaSalesFromSupabase=loadSalesFromSupabase;

  async function loadCustomerOrdersFromSupabase(){
    if(session?.role!=="customer" || salesLoading) return;
    salesLoading=true;
    try{
      preserveLegacyOrders();
      const {data,error}=await client.rpc("get_customer_orders");
      if(error) throw error;

      orders=(data||[]).map(remoteOrderToLocal);
      writeLocal(STORAGE.orders,orders);
      salesReady=true;
      renderOrders();
    }catch(err){
      console.error("Pedidos del cliente",err);
      const msg=String(err?.message||"");
      if(/permission|policy|row-level|42501/i.test(msg)){
        toast("Falta activar el acceso seguro a tus pedidos en Supabase.");
      }
    }finally{
      salesLoading=false;
    }
  }
  window.loadCubicaCustomerOrdersFromSupabase=loadCustomerOrdersFromSupabase;

  async function markOrderSupabase(id){
    const o=orders.find(x=>String(x.id)===String(id));
    if(!o || !adminAccessAllowed()) return;
    await window.openOrderManagement(o.id);
  }
  window.markOrder=markOrderSupabase;

  async function submitOrderSupabase(e){
    e.preventDefault();
    if(window.cubicaCommercial)return window.cubicaCommercial.submit(e);
    toast("No se pudo cargar el checkout. Recargá la página antes de confirmar.");
  }

  window.addEventListener("cubica:auth-ready",async(e)=>{
    if(e.detail?.role==="admin"&&e.detail?.mfa?.accessAllowed===true) await loadSalesFromSupabase();
    if(e.detail?.role==="customer"){
      if(typeof window.cubicaClaimCustomerGuestOrders==="function")await window.cubicaClaimCustomerGuestOrders();
      await loadCustomerOrdersFromSupabase();
    }
    if(!e.detail?.role){
      preserveLegacyOrders();
      orders=[];
      writeLocal(STORAGE.orders,orders);
    }
  });

  document.addEventListener("DOMContentLoaded",()=>{
    const checkout=$("checkout-form");
    if(checkout) checkout.onsubmit=submitOrderSupabase;

  });
})();
