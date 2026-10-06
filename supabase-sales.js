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

  function remoteOrderToLocal(row){
    return {
      id:String(row.id),
      orderNumber:row.order_number||"",
      clientOrderId:row.client_order_id||"",
      date:row.created_at,
      customerName:row.customer_name,
      customerEmail:row.customer_email,
      phone:row.phone||"",
      payment:row.payment||"",
      notes:row.notes||"",
      total:Number(row.total)||0,
      status:row.status||"Pendiente",
      username:row.username||"guest",
      supplyPlan:row.supply_plan||{products:[],supplies:[]},
      internalEmailSent:!!row.internal_email_sent,
      customerEmailSent:!!row.customer_email_sent,
      emailErrors:row.email_errors||[],
      serverSaved:true,
      items:(row.order_items||[]).map(i=>({
        productId:i.product_id||"",
        name:i.name,
        color:i.color||"",
        qty:Number(i.qty)||0,
        price:Number(i.unit_price)||0
      }))
    };
  }

  function remoteQuoteToLocal(row){
    return {
      id:String(row.id),
      date:row.created_at,
      title:row.title||"",
      data:row.data||{},
      summary:row.summary||""
    };
  }

  async function fetchRemoteSales(){
    const [{data:orderRows,error:orderErr},{data:quoteRows,error:quoteErr}]=await Promise.all([
      client.from("orders")
        .select("id,order_number,client_order_id,created_at,customer_name,customer_email,phone,payment,notes,total,status,username,supply_plan,internal_email_sent,customer_email_sent,email_errors,order_items(id,product_id,name,color,qty,unit_price,line_total)")
        .order("created_at",{ascending:false}),
      client.from("quotes")
        .select("id,created_at,title,data,summary,created_by")
        .order("created_at",{ascending:false})
    ]);
    if(orderErr) throw orderErr;
    if(quoteErr) throw quoteErr;
    return {orderRows:orderRows||[],quoteRows:quoteRows||[]};
  }

  async function migrateLocalOrders(localOrders,remoteRows){
    if(!Array.isArray(localOrders)||!localOrders.length) return 0;
    const remoteClientIds=new Set((remoteRows||[]).map(r=>String(r.client_order_id||"")).filter(Boolean));
    let migrated=0;

    for(const o of localOrders){
      const clientId=String(o.clientOrderId||o.id||"");
      if(clientId && remoteClientIds.has(clientId)) continue;
      if(!Array.isArray(o.items)||!o.items.length) continue;

      const payload={
        client_order_id:clientId||null,
        created_at:o.date||new Date().toISOString(),
        customer_name:String(o.customerName||"Cliente"),
        customer_email:String(o.customerEmail||"sin-email@local.invalid"),
        phone:String(o.phone||""),
        payment:String(o.payment||""),
        notes:String(o.notes||""),
        total:Number(o.total)||0,
        status:["Pendiente","Preparado","Entregado","Cancelado"].includes(o.status)?o.status:"Pendiente",
        username:String(o.username||"guest"),
        supply_plan:o.supplyPlan||{products:[],supplies:[]},
        internal_email_sent:!!o.internalEmailSent,
        customer_email_sent:!!o.customerEmailSent,
        email_errors:Array.isArray(o.emailErrors)?o.emailErrors:[]
      };

      const {data:created,error}=await client.from("orders").insert(payload).select("id,order_number").single();
      if(error) throw error;

      const itemRows=o.items.map(i=>({
        order_id:created.id,
        product_id:i.productId||null,
        name:String(i.name||"Producto"),
        color:String(i.color||""),
        qty:Math.max(1,Math.trunc(Number(i.qty)||1)),
        unit_price:Number(i.price)||0
      }));
      const {error:itemErr}=await client.from("order_items").insert(itemRows);
      if(itemErr){
        await client.from("orders").delete().eq("id",created.id);
        throw itemErr;
      }
      if(clientId) remoteClientIds.add(clientId);
      migrated++;
    }
    return migrated;
  }

  async function migrateLocalQuotes(localQuotes,remoteRows){
    if(!Array.isArray(localQuotes)||!localQuotes.length) return 0;
    const remoteIds=new Set((remoteRows||[]).map(r=>String(r.id)));
    const missing=localQuotes.filter(q=>q?.id && !remoteIds.has(String(q.id)));
    if(!missing.length) return 0;

    const rows=missing.map(q=>({
      id:String(q.id),
      created_at:q.date||new Date().toISOString(),
      title:q.title||null,
      data:q.data||{},
      summary:String(q.summary||""),
      created_by:session?.supabaseUserId||null
    }));
    const {error}=await client.from("quotes").insert(rows);
    if(error) throw error;
    return rows.length;
  }

  async function loadSalesFromSupabase({migrateLocal=true}={}){
    if(session?.role!=="admin" || salesLoading) return;
    salesLoading=true;
    try{
      setBadge("Datos: Supabase…","pending");

      const localOrders=read(STORAGE.orders,[]);
      const localQuotes=read(STORAGE.quotes,[]);
      let remote=await fetchRemoteSales();

      let migratedOrders=0,migratedQuotes=0;
      if(migrateLocal){
        migratedOrders=await migrateLocalOrders(localOrders,remote.orderRows);
        migratedQuotes=await migrateLocalQuotes(localQuotes,remote.quoteRows);
        if(migratedOrders||migratedQuotes) remote=await fetchRemoteSales();
      }

      orders=remote.orderRows.map(remoteOrderToLocal);
      const quotes=remote.quoteRows.map(remoteQuoteToLocal);
      writeLocal(STORAGE.orders,orders);
      writeLocal(STORAGE.quotes,quotes);
      salesReady=true;

      if(session?.role==="admin"){
        renderOrders();
        renderAnalytics();
      }
      setBadge("Datos: Supabase","ok");

      if(migratedOrders||migratedQuotes){
        toast(`Supabase: migrados ${migratedOrders} pedido(s) y ${migratedQuotes} presupuesto(s).`);
      }
    }catch(err){
      console.error("Ventas/presupuestos Supabase",err);
      setBadge("Supabase: ventas sin sincronizar","error");
    }finally{
      salesLoading=false;
    }
  }
  window.loadCubicaSalesFromSupabase=loadSalesFromSupabase;

  async function saveBudgetSupabase(){
    const b=window.lastBudget;
    if(!b) return;
    if(session?.role!=="admin"){
      toast("Iniciá sesión como administrador para guardar presupuestos.");
      return;
    }

    const q={
      id:uid("q"),
      date:new Date().toISOString(),
      data:b,
      summary:budgetSummary()
    };

    try{
      const {error}=await client.from("quotes").insert({
        id:q.id,
        created_at:q.date,
        title:null,
        data:q.data,
        summary:q.summary,
        created_by:session.supabaseUserId||null
      });
      if(error) throw error;

      const qs=read(STORAGE.quotes,[]);
      qs.push(q);
      writeLocal(STORAGE.quotes,qs);
      toast("Presupuesto guardado en Supabase.");
    }catch(err){
      console.error(err);
      toast("No se pudo guardar el presupuesto en Supabase.");
    }
  }

  async function markOrderSupabase(id){
    const o=orders.find(x=>String(x.id)===String(id));
    if(!o || session?.role!=="admin") return;
    const next=o.status==="Preparado"?"Pendiente":"Preparado";
    try{
      const {error}=await client.from("orders").update({status:next}).eq("id",o.id);
      if(error) throw error;
      o.status=next;
      writeLocal(STORAGE.orders,orders);
      renderOrders();
      renderAnalytics();
      toast(`Pedido ${o.orderNumber||""}: ${next}.`);
    }catch(err){
      console.error(err);
      toast("No se pudo actualizar el pedido.");
    }
  }
  window.markOrder=markOrderSupabase;

  function localFallbackOrder(draftOrder,items){
    const order={...draftOrder,id:draftOrder.id,orderNumber:"LOCAL-"+Date.now(),serverSaved:false};
    items.forEach(i=>{
      const p=products.find(x=>x.id===i.productId);
      if(p) p.stock=Math.max(0,(Number(p.stock)||0)-i.qty);
    });
    orders.push(order);
    writeLocal(STORAGE.orders,orders);
    writeLocal(STORAGE.products,products);
    return order;
  }

  async function submitOrderSupabase(e){
    e.preventDefault();
    if(!cart.length) return toast("El carrito está vacío.");

    const submitBtn=e.submitter||e.target.querySelector('button[type="submit"]');
    const originalText=submitBtn?.textContent||"Confirmar pedido";
    if(submitBtn){submitBtn.disabled=true;submitBtn.textContent="Enviando pedido…";}

    try{
      const name=$("customer-name").value.trim();
      const email=$("customer-email").value.trim();
      const phone=$("customer-phone").value.trim();
      if(!name||!email) throw new Error("Completá nombre y email.");

      let total=0;
      const items=[];
      const rpcItems=[];
      for(const c of cart){
        const p=products.find(x=>x.id===c.productId);
        if(!p) throw new Error("Uno de los productos ya no está disponible.");
        const qty=Math.max(1,Math.trunc(Number(c.qty)||1));
        items.push({productId:p.id,name:p.name,qty,price:p.price,color:c.color||""});
        rpcItems.push({product_id:p.id,qty,color:c.color||""});
        total+=p.price*qty;
      }

      const draftOrder={
        id:uid("ord"),
        date:new Date().toISOString(),
        customerName:name,
        customerEmail:email,
        phone,
        payment:$("payment-method").value,
        notes:$("customer-notes").value,
        items,
        total,
        status:"Pendiente",
        username:"guest",
        supplyPlan:calculateOrderSupplyPlan(items)
      };

      const {data,error}=await client.rpc("create_public_order",{
        p_client_order_id:draftOrder.id,
        p_customer_name:name,
        p_customer_email:email,
        p_phone:phone,
        p_payment:draftOrder.payment,
        p_notes:draftOrder.notes,
        p_items:rpcItems
      });

      if(error){
        const missing=/create_public_order|Could not find the function|PGRST202/i.test(String(error.message||"")+" "+String(error.code||""));
        if(missing){
          localFallbackOrder(draftOrder,items);
          cart=[];writeLocal(STORAGE.cart,cart);
          closeModal("checkout-modal");renderProducts();renderCart();
          toast("Pedido guardado localmente. Falta activar la función de pedidos online en Supabase.");
          e.target.reset();
          return;
        }
        throw error;
      }

      const result=data||{};
      const order={
        ...draftOrder,
        id:String(result.order_id||draftOrder.id),
        clientOrderId:draftOrder.id,
        orderNumber:result.order_number||"",
        total:Number(result.total ?? total),
        serverSaved:true
      };
      orders.push(order);
      writeLocal(STORAGE.orders,orders);
      cart=[];writeLocal(STORAGE.cart,cart);
      closeModal("checkout-modal");
      renderCart();

      if(typeof window.loadCubicaCatalogFromSupabase==="function"){
        await window.loadCubicaCatalogFromSupabase();
      }else{
        renderProducts();
      }
      if(session?.role==="admin") await loadSalesFromSupabase({migrateLocal:false});

      if(typeof window.cubicaTrackEvent==="function"){
        window.cubicaTrackEvent("purchase",null,{
          order_number:order.orderNumber||"",
          total:Number(order.total)||0,
          units:items.reduce((sum,item)=>sum+(Number(item.qty)||0),0)
        });
      }
      toast(`${order.orderNumber||"Pedido registrado"}: pedido guardado en Cúbica.`);
      e.target.reset();
    }catch(err){
      console.error("Pedido Supabase",err);
      toast(err.message||"No se pudo registrar el pedido.");
    }finally{
      if(submitBtn){submitBtn.disabled=false;submitBtn.textContent=originalText;}
    }
  }

  window.addEventListener("cubica:auth-ready",async(e)=>{
    if(e.detail?.role==="admin") await loadSalesFromSupabase({migrateLocal:true});
  });

  document.addEventListener("DOMContentLoaded",()=>{
    const checkout=$("checkout-form");
    if(checkout) checkout.onsubmit=submitOrderSupabase;

    const save=$("save-budget");
    if(save) save.onclick=saveBudgetSupabase;
  });
})();