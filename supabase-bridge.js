/* Cúbica + Supabase
   Etapa 1: autenticación real y detección de rol.
   El catálogo y la gestión siguen usando el comportamiento actual hasta completar la migración.
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
      return;
    }

    const profile = await profileFor(sbSession.user);
    session = {
      username: profile?.display_name || sbSession.user.email || "usuario",
      email: sbSession.user.email || profile?.email || "",
      role: profile?.role === "admin" ? "admin" : "customer",
      supabaseUserId: sbSession.user.id
    };
    writeLocal(STORAGE.session, session);
    renderApp();
    if(showToast) toast(session.role === "admin" ? "Sesión de administrador iniciada" : "Sesión iniciada");
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const form = $("login-form");
    if(form){
      form.onsubmit = async (e) => {
        e.preventDefault();
        const email = $("login-user").value.trim();
        const password = $("login-password").value;

        const btn = e.submitter || form.querySelector('button[type="submit"]');
        const old = btn?.textContent || "Iniciar sesión";
        if(btn){ btn.disabled = true; btn.textContent = "Ingresando…"; }

        try{
          const { data, error } = await client.auth.signInWithPassword({ email, password });
          if(error) throw error;
          await applySupabaseSession(data.session, true);
          showSection("store");
        }catch(err){
          console.error(err);
          toast(err?.message === "Invalid login credentials"
            ? "Email o contraseña incorrectos."
            : "No se pudo iniciar sesión.");
        }finally{
          if(btn){ btn.disabled = false; btn.textContent = old; }
        }
      };
    }

    const logout = $("logout-btn");
    if(logout){
      logout.onclick = async () => {
        await client.auth.signOut();
        session = null;
        localStorage.removeItem(STORAGE.session);
        renderApp();
        showSection("store");
        toast("Sesión cerrada");
      };
    }

    const { data } = await client.auth.getSession();
    await applySupabaseSession(data.session, false);

    client.auth.onAuthStateChange(async (_event, newSession) => {
      await applySupabaseSession(newSession, false);
    });
  });
})();
