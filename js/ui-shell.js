/* CÚBICA 3D — shell de interfaz: navegación, cuenta, secciones y paginación. */

const WELCOME_MESSAGES = [
  "Hay cosas que comprás porque las necesitás. Y hay otras que elegís porque simplemente querés tenerlas. Bienvenido a Cúbica.",
  "Que una impresión salga de una máquina no significa que sea una más. En Cúbica, cada objeto empieza con una idea y termina en tus manos.",
  "A veces un pequeño objeto puede cambiar un rincón, acompañar un momento o simplemente sacarte una sonrisa. Gracias por pasar por Cúbica.",
  "Elegiste algo hecho en 3D. Nosotros queremos que cuando llegue a tus manos se sienta mucho más que eso: que se sienta tuyo.",
  "Detrás de cada producto de Cúbica hay tiempo, material y muchas decisiones. Pero lo más importante sucede cuando finalmente llega a vos.",
  "No imprimimos solamente objetos. Le damos forma a ideas para que puedan encontrar un lugar en tu mundo. Bienvenido a Cúbica.",
  "Tu próxima compra puede terminar en un estante, en un escritorio, en una habitación o convertirse en un regalo inolvidable. Descubrila en Cúbica.",
  "Hay algo especial en recibir algo que fue creado para vos. Ojalá encuentres en Cúbica eso que estabas buscando sin saberlo.",
  "Cada pieza tiene un origen: una idea. Y quizás hoy esa idea encuentre un lugar en tu casa. Bienvenido a Cúbica.",
  "Gracias por elegir un emprendimiento que crea de a una pieza por vez. Esperamos que encuentres algo que realmente quieras llevarte.",
  "Lo que hoy ves en pantalla, mañana puede estar en tus manos. Elegí, imaginá y dejá que Cúbica haga el resto.",
  "Cúbica nace de transformar material en objetos con propósito. Ahora queremos transformar tu elección en algo que puedas disfrutar."
];

function navItems(){
  // La barra superior queda deliberadamente limpia. La gestión vive en el panel lateral.
  return [["store","Tienda"]];
}
function setupNav(){
  const nav=$("main-nav"); if(!nav)return;
  nav.innerHTML="";
  navItems().forEach(([id,label])=>{
    const b=document.createElement("button");
    b.textContent=label;b.dataset.section=id;b.onclick=()=>showSection(id);nav.appendChild(b);
  });
  updateCartBadge();
}
function openAccountSidebar(){
  if(!session){showSection("login");return;}
  const sidebar=$("account-sidebar"), overlay=$("account-sidebar-overlay");
  if(!sidebar||!overlay)return;
  renderAccountSidebar();
  sidebar.classList.add("open");
  sidebar.setAttribute("aria-hidden","false");
  overlay.classList.remove("hidden");
  requestAnimationFrame(()=>overlay.classList.add("visible"));
  document.body.classList.add("sidebar-open");
}
function closeAccountSidebar(){
  const sidebar=$("account-sidebar"), overlay=$("account-sidebar-overlay");
  if(!sidebar||!overlay)return;
  sidebar.classList.remove("open");
  sidebar.setAttribute("aria-hidden","true");
  overlay.classList.remove("visible");
  setTimeout(()=>{if(!sidebar.classList.contains("open"))overlay.classList.add("hidden");},180);
  document.body.classList.remove("sidebar-open");
}
function renderAccountSidebar(){
  const name=$("sidebar-user-name"), role=$("sidebar-user-role"), email=$("sidebar-user-email");
  if(name)name.textContent=session?.username||"Visitante";
  if(role)role.textContent=session?(session.role==="admin"?"Administrador":"Cliente"):"Sin sesión iniciada";
  if(email)email.textContent=session?.email||"";
  const img=$("sidebar-avatar-img"), fallback=$("sidebar-avatar-fallback");
  if(img&&fallback){
    if(session?.avatarUrl){img.src=session.avatarUrl;img.classList.remove("hidden");fallback.classList.add("hidden");}
    else{img.removeAttribute("src");img.classList.add("hidden");fallback.classList.remove("hidden");}
  }
  document.querySelectorAll(".account-sidebar .admin-only").forEach(el=>el.classList.toggle("hidden",session?.role!=="admin"));
  document.querySelectorAll(".account-sidebar .customer-only").forEach(el=>el.classList.toggle("hidden",session?.role!=="customer"));
  document.querySelectorAll(".account-sidebar .session-only").forEach(el=>el.classList.toggle("hidden",!session));
  const ordersLabel=$("sidebar-orders-label");
  if(ordersLabel)ordersLabel.textContent=session?.role==="admin"?"Ventas / Pedidos":"Mis pedidos";
  const editBadge=$("avatar-edit-badge");
  if(editBadge)editBadge.classList.toggle("hidden",session?.role!=="admin");
}
function showSection(id){
  const requested=id;
  const section=$("section-"+id);
  if(!section)return;
  if(id==="orders" && !session){
    toast("Iniciá sesión para consultar tus pedidos.");
    id="login";
  }
  if(["stock-finished","stock-supplies","budget","analytics"].includes(id) && session?.role!=="admin"){
    toast("Esta sección es exclusiva del administrador.");
    id="login";
  }
  if(id==="profile" && session?.role!=="customer"){
    id=session?"store":"login";
  }
  document.querySelectorAll(".page-section").forEach(sec=>sec.classList.add("hidden"));
  $("section-"+id).classList.remove("hidden");
  document.querySelectorAll(".nav button").forEach(b=>b.classList.toggle("active",b.dataset.section===id));
  document.querySelectorAll("[data-sidebar-section]").forEach(b=>b.classList.toggle("active",b.dataset.sidebarSection===id));
  closeAccountSidebar();
  if(id==="store") renderProducts(); if(id==="cart") renderCart(); if(id==="orders") renderOrders();
  if(id==="profile") renderCustomerProfile();
  if(id==="stock-finished") renderFinishedStock(); if(id==="stock-supplies") renderSupplies();
  if(id==="budget") renderBudget(); if(id==="analytics") renderAnalytics();
  if(requested==="store" && typeof window.cubicaTrackEvent==="function") window.cubicaTrackEvent("page_view",null,{section:"store"});
}
function renderWelcome(){
  const message=$("welcome-message");
  if(message){
    let index=Math.floor(Math.random()*WELCOME_MESSAGES.length);
    const previous=Number(sessionStorage.getItem("cubica_welcome_index"));
    if(WELCOME_MESSAGES.length>1 && index===previous) index=(index+1)%WELCOME_MESSAGES.length;
    sessionStorage.setItem("cubica_welcome_index",index);
    message.textContent=WELCOME_MESSAGES[index];
  }
}
function renderCustomerProfile(){
  if(session?.role!=="customer")return;
  const name=$("profile-page-name"),email=$("profile-page-email"),provider=$("profile-page-provider");
  if(name)name.textContent=session.username||"Cliente";
  if(email)email.textContent=session.email||"";
  if(provider)provider.textContent=session.authProvider==="google"?"Google":"Cuenta Cúbica";
  const img=$("profile-page-avatar"),fallback=$("profile-page-avatar-fallback");
  if(img&&fallback){
    if(session.avatarUrl){
      img.src=session.avatarUrl;
      img.classList.remove("hidden");
      fallback.classList.add("hidden");
    }else{
      img.removeAttribute("src");
      img.classList.add("hidden");
      fallback.classList.remove("hidden");
    }
  }
}
function renderApp(){
  $("app").classList.remove("hidden");
  const logout=$("logout-btn"); if(logout)logout.classList.toggle("hidden",!session);

  const topImg=$("profile-avatar-top"), topFallback=$("profile-icon-fallback"), profileBtn=$("profile-btn");
  if(profileBtn)profileBtn.title=session?(session.role==="admin"?"Administrador":"Mi cuenta"):"Ingresar";
  if(topImg&&topFallback){
    if(session?.avatarUrl){topImg.src=session.avatarUrl;topImg.classList.remove("hidden");topFallback.classList.add("hidden");}
    else{topImg.removeAttribute("src");topImg.classList.add("hidden");topFallback.classList.remove("hidden");}
  }

  // No quitar .hidden de las secciones de página al refrescar la sesión.
  document.querySelectorAll(".admin-only").forEach(el=>{
    if(el.closest?.("#account-sidebar")) return;
    if(el.classList.contains("page-section")){
      if(session?.role!=="admin") el.classList.add("hidden");
    }else{
      el.classList.toggle("hidden",session?.role!=="admin");
    }
  });
  document.querySelectorAll(".customer-only").forEach(el=>{
    if(el.closest?.("#account-sidebar")) return;
    if(el.classList.contains("page-section")){
      if(session?.role!=="customer") el.classList.add("hidden");
    }else{
      el.classList.toggle("hidden",session?.role!=="customer");
    }
  });

  renderAccountSidebar();
  renderCustomerProfile();
  setupNav();
  renderProducts();
  renderCart();
}
function paginationNumbers(totalPages,currentPage){
  if(totalPages<=7)return Array.from({length:totalPages},(_,i)=>i+1);
  const pages=[1];
  const start=Math.max(2,currentPage-1);
  const end=Math.min(totalPages-1,currentPage+1);
  if(start>2)pages.push("…");
  for(let p=start;p<=end;p++)pages.push(p);
  if(end<totalPages-1)pages.push("…");
  pages.push(totalPages);
  return pages;
}
function renderPagination(id,{page,totalPages,totalItems,pageSize,setter}){
  const box=$(id);if(!box)return;
  if(totalItems<=pageSize || totalItems===0){
    box.classList.add("hidden");
    box.innerHTML="";
    return;
  }
  const start=(page-1)*pageSize+1;
  const end=Math.min(totalItems,page*pageSize);
  const pages=paginationNumbers(totalPages,page);
  box.classList.remove("hidden");
  box.innerHTML=`
    <div class="pagination-summary">Mostrando <strong>${start}–${end}</strong> de <strong>${totalItems}</strong></div>
    <div class="pagination-controls">
      <button class="pagination-btn pagination-arrow" type="button" onclick="${setter}(${page-1})" ${page<=1?"disabled":""} aria-label="Página anterior">‹</button>
      ${pages.map(p=>p==="…"
        ? '<span class="pagination-ellipsis">…</span>'
        : `<button class="pagination-btn ${p===page?"active":""}" type="button" onclick="${setter}(${p})" ${p===page?'aria-current="page"':""}>${p}</button>`
      ).join("")}
      <button class="pagination-btn pagination-arrow" type="button" onclick="${setter}(${page+1})" ${page>=totalPages?"disabled":""} aria-label="Página siguiente">›</button>
    </div>`;
}

function openModal(id){
  $(id)?.classList.remove("hidden");
}

function closeModal(id){
  $(id)?.classList.add("hidden");
}
