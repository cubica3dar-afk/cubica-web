// Read-only checks against the files actually served by GitHub Pages.
import assert from "node:assert/strict";

const nonce=Date.now();
const load=async path=>{
  const response=await fetch(`https://cubica3d.ar/${path}${path.includes("?")?"&":"?"}qa=${nonce}`,{signal:AbortSignal.timeout(15000)});
  assert.equal(response.status,200,path);
  return response.text();
};

const [index,config,sales,turnstile]=await Promise.all([
  load("index.html"),load("github-config.js"),load("supabase-sales.js"),load("js/turnstile-ui.js")
]);
assert.match(index,/supabase-sales\.js\?v=catalog-admin1/);
assert.match(index,/js\/store-ui\.js\?v=catalog-admin1/);
assert.match(index,/js\/products-ui\.js\?v=catalog-admin1/);
assert.match(index,/js\/inventory-ui\.js\?v=catalog-admin1/);
assert.match(index,/turnstile-ui\.js\?v=order-protection10/);
assert.match(config,/turnstileSiteKey:\s*"0x4AAAAAAFWyP3cVMucw34_n"/);
assert.doesNotMatch(sales,/\.rpc\(["']create_delivery_order["']/);
assert.doesNotMatch(sales,/\.rpc\(["']create_public_order["']/);
assert.match(sales,/cubicaTurnstile\.createOrder/);
assert.match(turnstile,/Turnstile is mandatory/);
console.log("PASS production assets: Site Key present, mandatory Edge checkout loaded, no legacy RPC fallback.");

