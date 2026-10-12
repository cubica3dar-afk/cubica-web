import { createHandler } from "./worker.js";

// Deployed with verify_jwt=false because guest checkout is supported.
// The handler verifies an actual user token whenever one is supplied.
Deno.serve(createHandler({ env: name => Deno.env.get(name) }));

