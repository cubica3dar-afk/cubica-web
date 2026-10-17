import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createHandler} from "./worker.js";
Deno.serve(createHandler({env:(name)=>Deno.env.get(name)||""}));

