/* CÚBICA 3D — bootstrap de la interfaz.
   Los adaptadores Supabase se cargan después y reemplazan/añaden las acciones
   que necesitan persistencia remota (auth, pedidos, inventario y analytics).
*/

document.addEventListener("DOMContentLoaded",()=>{
  initData();
  updateDataBadge("Datos: conectando…","pending");
  renderWelcome();
  renderApp();
  if(window.cubicaAuthCallbackBlocked)$("welcome-view")?.classList.add("hidden");
  showSection("store");
  window.cubicaOpenCheckoutLink?.()||window.cubicaOpenOrdersLink?.()||window.cubicaOpenProductLink?.();

  $("enter-store-btn").onclick=()=>{
    $("welcome-view").classList.add("hidden");
    showSection("store");
    window.scrollTo({top:0,behavior:"smooth"});
  };

  $("cart-icon-btn").onclick=()=>showSection("cart");

  const brandHome=$("brand-home");
  if(brandHome){
    const goStore=()=>{
      showSection("store");
      window.scrollTo({top:0,behavior:"smooth"});
    };
    brandHome.addEventListener("click",goStore);
    brandHome.addEventListener("keydown",e=>{
      if(e.key==="Enter"||e.key===" "){
        e.preventDefault();
        goStore();
      }
    });
  }

  $("profile-btn")?.addEventListener("click",()=>session?openAccountSidebar():showSection("login"));
  $("account-sidebar-close")?.addEventListener("click",closeAccountSidebar);
  $("account-sidebar-overlay")?.addEventListener("click",closeAccountSidebar);
  document.querySelectorAll("[data-sidebar-section]").forEach(b=>b.addEventListener("click",()=>showSection(b.dataset.sidebarSection)));

  $("sidebar-avatar-button")?.addEventListener("click",()=>{
    if(session?.role==="admin"&&window.cubicaAdminMfaAccessAllowed?.()===true)$("profile-avatar-input")?.click();
  });

  $("profile-avatar-input")?.addEventListener("change",async e=>{
    const file=e.target.files?.[0];
    if(!file)return;
    if(typeof window.cubicaUploadProfileAvatar!=="function"){
      toast("La foto de perfil requiere Supabase.");
      e.target.value="";
      return;
    }
    try{
      toast("Subiendo foto de perfil…");
      const avatar=await window.cubicaUploadProfileAvatar(file);
      if(session){
        session.avatarUrl=avatar.publicUrl;
        session.avatarPath=avatar.path;
        writeLocal(STORAGE.session,session);
      }
      renderApp();
      renderAccountSidebar();
      toast("Foto de perfil actualizada.");
    }catch(err){
      console.error(err);
      toast(err.message||"No se pudo subir la foto de perfil.");
    }
    e.target.value="";
  });

  document.addEventListener("keydown",e=>{
    if(e.key==="Escape")closeAccountSidebar();
  });

  $("product-search").oninput=()=>{
    productPage=1;
    renderProducts();
  };
  $("product-category").onchange=()=>{
    productPage=1;
    renderProducts();
  };
  $("product-sort").value=productSortMode;
  $("product-sort").onchange=e=>{
    productSortMode=e.target.value;
    productPage=1;
    localStorage.setItem("cubica_product_sort",productSortMode);
    renderProducts();
  };

  $("finished-search").oninput=()=>{
    finishedPage=1;
    renderFinishedStock();
  };
  $("finished-category-filter").onchange=()=>{
    finishedPage=1;
    renderFinishedStock();
  };
  for(const id of ["finished-publication-filter","finished-active-filter"]){
    $(id).onchange=()=>{finishedPage=1;renderFinishedStock();};
  }
  $("finished-sort").value=finishedSortMode;
  $("finished-sort").onchange=e=>{
    finishedSortMode=e.target.value;
    finishedPage=1;
    localStorage.setItem("cubica_finished_sort",finishedSortMode);
    renderFinishedStock();
  };
  $("finished-images").addEventListener("change",e=>handleFinishedMediaInput(e.target,"image"));
  $("finished-videos").addEventListener("change",e=>handleFinishedMediaInput(e.target,"video"));
  $("add-finished-media-url")?.addEventListener("click",addFinishedMediaUrl);

  $("supply-search").oninput=()=>{
    supplyPage=1;
    renderSupplies();
  };
  $("supply-category-filter").onchange=()=>{
    supplyPage=1;
    renderSupplies();
  };
  for(const id of ["supply-brand-filter","supply-material-filter","supply-active-filter"]){
    $(id).onchange=()=>{supplyPage=1;renderSupplies();};
  }
  $("supply-sort").value=supplySortMode;
  $("supply-sort").onchange=e=>{
    supplySortMode=e.target.value;
    supplyPage=1;
    localStorage.setItem("cubica_supply_sort",supplySortMode);
    renderSupplies();
  };
  $("add-supply-category").onclick=()=>openModal("supply-category-modal");

  $("checkout-btn").onclick=()=>window.cubicaStartCheckout?.();

  document.querySelectorAll("[data-close-modal]").forEach(b=>b.onclick=()=>closeModal(b.dataset.closeModal));
  document.querySelectorAll("[data-open-modal]").forEach(b=>b.onclick=()=>{
    try{
      if(b.dataset.openModal==="finished-modal")resetFinishedProductForm();
      if(b.dataset.openModal==="supply-modal")resetSupplyForm();
      openModal(b.dataset.openModal);
    }catch(err){
      console.error("No se pudo abrir el modal",err);
      toast("No se pudo abrir el formulario. Recargá la página e intentá nuevamente.");
    }
  });

  $("finished-form").onsubmit=saveFinishedProduct;
  $("add-finished-color").onclick=addFinishedColor;
  $("add-finished-supply").onclick=addFinishedRecipeRow;

  $("supply-form").onsubmit=saveSupplyForm;
  $("supply-category").addEventListener("change",()=>updateSupplyFilamentFields({fromCategoryChange:true}));
  $("supply-unit").addEventListener("change",()=>updateSupplyFilamentFields());
  $("supply-material").addEventListener("change",()=>updateSupplyFilamentFields());
  $("supply-category-form").onsubmit=e=>{
    e.preventDefault();
    addSupplyCategory($("new-supply-category").value);
    e.target.reset();
    closeModal("supply-category-modal");
  };

  $("budget-form").addEventListener("input",calculateBudget);
  $("budget-form").addEventListener("change",calculateBudget);
  $("budget-form").onsubmit=e=>{
    e.preventDefault();
    calculateBudget();
    toast("Presupuesto calculado");
  };
  $("add-budget-supply").onclick=()=>{
    budgetRows.push({id:"",qty:1});
    renderBudgetSupplyRows();
    calculateBudget();
  };
  // Persistencia, emisión y copiado se enlazan en budget-ui.js.

  document.querySelectorAll(".period-tabs .tab[data-period]").forEach(t=>t.onclick=()=>{
    salesPeriod=t.dataset.period;
    document.querySelectorAll(".period-tabs .tab[data-period]").forEach(x=>x.classList.toggle("active",x===t));
    renderOrders();
  });

  document.querySelectorAll("[data-analytics-range]").forEach(t=>t.onclick=()=>{
    analyticsRange=t.dataset.analyticsRange;
    renderAnalytics();
  });
  document.querySelectorAll("[data-analytics-view]").forEach(t=>t.onclick=()=>{
    analyticsView=t.dataset.analyticsView;
    renderAnalytics();
  });

  initBudgetDefaults();
});
