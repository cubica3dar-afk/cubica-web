import { createHandler } from "./worker.js";

// Guest checkout requires verify_jwt=false. The handler independently validates
// a real user token when supplied and never treats the publishable key as a user.
Deno.serve(createHandler({ env: name => Deno.env.get(name) }));


