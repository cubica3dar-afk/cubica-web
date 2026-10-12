import { createHandler, createRpcClient } from "./worker.js";

Deno.serve(createHandler({ env: name => Deno.env.get(name), createClient: createRpcClient }));
