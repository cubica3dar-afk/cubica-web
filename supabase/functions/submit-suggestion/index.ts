import { createHandler } from "./worker.js";

// Invitados y usuarios autenticados comparten la ruta. La función verifica
// Turnstile y deriva la identidad del JWT; nunca acepta user_id del navegador.
Deno.serve(createHandler({env:name=>Deno.env.get(name)}));
