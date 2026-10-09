/* CÚBICA 3D — interfaz de autenticación.
   UI para Google, email/contraseña, alta, verificación y recuperación.
   La lógica real de Auth vive en supabase-bridge.js.
*/
(function(){
  const views=["login","signup","forgot","reset"];

  function setFeedback(message,type="info"){
    const box=$("auth-feedback");
    if(!box)return;
    box.textContent=message||"";
    box.dataset.type=type;
    box.classList.toggle("hidden",!message);
  }

  function clearFeedback(){
    setFeedback("");
  }

  function showAuthView(name){
    const next=views.includes(name)?name:"login";
    views.forEach(v=>$("auth-view-"+v)?.classList.toggle("hidden",v!==next));
    clearFeedback();
    if(next!=="reset"){
      const form=$("reset-password-form");
      if(form)form.reset();
    }
  }

  function errorMessage(err,fallback="No se pudo completar la operación."){
    const msg=String(err?.message||"");
    if(/Invalid login credentials/i.test(msg))return "Email o contraseña incorrectos.";
    if(/Email not confirmed/i.test(msg))return "Primero confirmá tu email desde el correo que te enviamos.";
    if(/Password should be at least|password.*characters/i.test(msg))return "La contraseña no cumple con la longitud mínima.";
    if(/rate limit|too many requests|over_email_send_rate_limit/i.test(msg))return "Se enviaron demasiadas solicitudes. Esperá unos minutos e intentá nuevamente.";
    if(/Email address not authorized|email.*not authorized/i.test(msg))return "Supabase no puede enviar el correo a esa dirección con su servicio de email predeterminado. Configurá SMTP propio o probá temporalmente con un email autorizado del equipo.";
    if(/Error sending confirmation email|error sending.*email|smtp/i.test(msg))return "No se pudo enviar el correo de confirmación. Revisá la configuración SMTP de Supabase.";
    if(/signup.*disabled|Signups not allowed/i.test(msg))return "El registro por email todavía no está habilitado en Supabase.";
    if(/email.*invalid/i.test(msg))return "Revisá que el email sea válido.";
    return fallback;
  }

  function setButtonBusy(button,busy,busyText){
    if(!button)return ()=>{};
    const old=button.textContent;
    button.disabled=busy;
    if(busyText)button.textContent=busyText;
    return ()=>{
      button.disabled=false;
      button.textContent=old;
    };
  }

  window.addEventListener("cubica:password-recovery",()=>{
    showSection("login");
    showAuthView("reset");
    setFeedback("Enlace validado. Ahora elegí tu nueva contraseña.","success");
  });

  document.addEventListener("DOMContentLoaded",()=>{
    $("auth-open-signup")?.addEventListener("click",()=>{
      const email=$("login-user")?.value?.trim()||"";
      showAuthView("signup");
      if(email && $("signup-email"))$("signup-email").value=email;
    });

    $("auth-open-forgot")?.addEventListener("click",()=>{
      const email=$("login-user")?.value?.trim()||"";
      showAuthView("forgot");
      if(email && $("forgot-email"))$("forgot-email").value=email;
    });

    document.querySelectorAll(".auth-back-login").forEach(btn=>btn.addEventListener("click",()=>showAuthView("login")));

    const googleBtn=$("google-login-btn");
    if(googleBtn){
      googleBtn.addEventListener("click",async()=>{
        const oldHtml=googleBtn.innerHTML;
        googleBtn.disabled=true;
        googleBtn.classList.add("loading");
        clearFeedback();
        try{
          const span=googleBtn.querySelector("span");
          if(span)span.textContent="Abriendo Google…";
          if(typeof window.cubicaSignInWithGoogle!=="function")throw new Error("Google Auth no disponible");
          await window.cubicaSignInWithGoogle();
        }catch(err){
          console.error(err);
          googleBtn.innerHTML=oldHtml;
          googleBtn.disabled=false;
          googleBtn.classList.remove("loading");
          const msg=String(err?.message||"");
          setFeedback(/provider.*enabled|Unsupported provider/i.test(msg)
            ?"Google todavía no está habilitado en Supabase."
            :"No se pudo iniciar sesión con Google.","error");
        }
      });
    }

    $("login-form")?.addEventListener("submit",async e=>{
      e.preventDefault();
      const email=$("login-user").value.trim();
      const password=$("login-password").value;
      const btn=e.submitter||e.currentTarget.querySelector('button[type="submit"]');
      const done=setButtonBusy(btn,true,"Ingresando…");
      clearFeedback();
      try{
        if(typeof window.cubicaSignInWithEmail!=="function")throw new Error("Auth no disponible");
        await window.cubicaSignInWithEmail(email,password);
        showSection("store");
      }catch(err){
        console.error(err);
        setFeedback(errorMessage(err,"No se pudo iniciar sesión."),"error");
      }finally{
        done();
      }
    });

    $("signup-form")?.addEventListener("submit",async e=>{
      e.preventDefault();
      const name=$("signup-name").value.trim();
      const email=$("signup-email").value.trim();
      const password=$("signup-password").value;
      const repeat=$("signup-password-repeat").value;
      const btn=e.submitter||e.currentTarget.querySelector('button[type="submit"]');

      if(name.length<2)return setFeedback("Escribí un nombre válido.","error");
      if(password.length<8)return setFeedback("La contraseña debe tener al menos 8 caracteres.","error");
      if(password!==repeat)return setFeedback("Las contraseñas no coinciden.","error");

      const done=setButtonBusy(btn,true,"Creando cuenta…");
      clearFeedback();
      try{
        if(typeof window.cubicaSignUpWithEmail!=="function")throw new Error("Registro no disponible");
        const data=await window.cubicaSignUpWithEmail(name,email,password);
        if(data?.session){
          e.currentTarget.reset();
          showSection("store");
          toast("Cuenta creada correctamente.");
        }else{
          e.currentTarget.reset();
          showAuthView("login");
          if($("login-user"))$("login-user").value=email;
          setFeedback("Cuenta registrada. Revisá tu email y abrí el enlace de verificación. Si ese correo ya tenía una cuenta, usá “Crear / recuperar contraseña”.","success");
        }
      }catch(err){
        console.error(err);
        setFeedback(errorMessage(err,"No se pudo crear la cuenta."),"error");
      }finally{
        done();
      }
    });

    $("forgot-password-form")?.addEventListener("submit",async e=>{
      e.preventDefault();
      const email=$("forgot-email").value.trim();
      const btn=e.submitter||e.currentTarget.querySelector('button[type="submit"]');
      const done=setButtonBusy(btn,true,"Enviando…");
      clearFeedback();
      try{
        if(typeof window.cubicaSendPasswordReset!=="function")throw new Error("Recuperación no disponible");
        await window.cubicaSendPasswordReset(email);
        setFeedback("Si existe una cuenta para ese email, vas a recibir un enlace para crear una nueva contraseña. Revisá también Spam.","success");
      }catch(err){
        console.error(err);
        setFeedback(errorMessage(err,"No se pudo enviar el correo de recuperación."),"error");
      }finally{
        done();
      }
    });

    $("reset-password-form")?.addEventListener("submit",async e=>{
      e.preventDefault();
      const password=$("reset-password").value;
      const repeat=$("reset-password-repeat").value;
      const btn=e.submitter||e.currentTarget.querySelector('button[type="submit"]');

      if(password.length<8)return setFeedback("La contraseña debe tener al menos 8 caracteres.","error");
      if(password!==repeat)return setFeedback("Las contraseñas no coinciden.","error");

      const done=setButtonBusy(btn,true,"Guardando…");
      clearFeedback();
      try{
        if(typeof window.cubicaUpdatePassword!=="function")throw new Error("Cambio de contraseña no disponible");
        await window.cubicaUpdatePassword(password);
        if(typeof window.cubicaSignOut==="function")await window.cubicaSignOut();
        e.currentTarget.reset();
        showSection("login");
        showAuthView("login");
        setFeedback("Contraseña actualizada. Ya podés iniciar sesión con tu email y la nueva contraseña.","success");
      }catch(err){
        console.error(err);
        setFeedback(errorMessage(err,"No se pudo actualizar la contraseña. El enlace puede haber vencido."),"error");
      }finally{
        done();
      }
    });

    $("logout-btn")?.addEventListener("click",async()=>{
      try{
        if(typeof window.cubicaSignOut==="function")await window.cubicaSignOut();
        else{
          session=null;
          localStorage.removeItem(STORAGE.session);
          renderApp();
        }
        showSection("store");
        showAuthView("login");
        toast("Sesión cerrada");
      }catch(err){
        console.error(err);
        toast("No se pudo cerrar la sesión.");
      }
    });
  });
})();
