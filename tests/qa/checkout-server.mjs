// Static, loopback-only QA. Allowlisted frontend files; no backend, proxy or secrets.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const port=4177;
const files=['styles.css','styles-delivery.css','styles-checkout.css','css/checkout-commercial.css','js/checkout-commercial.js','js/checkout-commercial-admin.js','tests/qa/checkout-mock.js'];
const sources=Object.fromEntries(files.map(f=>['/'+f,fs.readFileSync(path.join(root,f))]));
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const checkout=index.slice(index.indexOf('<section id="section-checkout"'),index.indexOf('<section id="section-store"')).replace('page-section hidden','page-section');
const hashes=Object.fromEntries(files.map(f=>[f,createHash('sha256').update(sources['/'+f]).digest('hex')]));
hashes['index.html']=createHash('sha256').update(index).digest('hex');
const page=`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>QA checkout — local y sintético</title>${files.filter(f=>f.endsWith('.css')).map(f=>`<link rel="stylesheet" href="/${f}">`).join('')}<style>body{margin:0}main{max-width:1180px;margin:auto;padding:16px}.qa-controls{border:2px solid #eab308;padding:16px;margin-bottom:20px}.qa-controls label{display:block;margin:8px 0}.qa-controls select{max-width:100%;width:100%}.qa-controls button{margin:4px}#qa-log{white-space:pre-wrap;overflow-wrap:anywhere;max-height:200px;overflow:auto;font-size:12px}#qa-status{color:#facc15}.qa-admin{margin-top:24px}</style></head><body><main><aside class="qa-controls"><h1>QA LOCAL — datos sintéticos</h1><p>Auth, Turnstile, RPC y pedidos simulados en esta pestaña. Conexiones externas bloqueadas. No se envían compras a Supabase.</p><label>Sesión simulada<select id="qa-role"><option value="guest">Invitado</option><option value="customer">Cliente sintético</option><option value="admin">Administrador AAL2 simulado</option><option value="aal1">Administrador AAL1 simulado (sin permisos)</option></select></label><label>Productos (precio simulado de servidor)<select id="qa-cart"><option value="19999">Total $19.999</option><option value="20000">Total $20.000</option><option value="20001">Total $20.001</option></select></label><label>Próxima creación o escritura simulada<select id="qa-failure"><option value="normal">Normal</option><option value="delay">Demora 2,5 segundos (doble clic)</option><option value="lost">Guardar y perder respuesta</option><option value="before">Fallo de red antes de guardar</option><option value="conflict">Conflicto de versión</option></select></label><button type="button" class="btn secondary" id="qa-reset">Restablecer datos sintéticos</button><button type="button" class="btn ghost" id="qa-config">Configuración administrativa simulada</button><button type="button" class="btn ghost" id="qa-order">Administrar último pedido simulado</button><button type="button" class="btn ghost" id="qa-ready">Marcar último pedido preparado (simulado)</button><p>Recargar conserva el pedido sintético y su comprobante; Restablecer borra exclusivamente el estado de esta QA. Uber habilitado solo en la simulación para poder probarlo.</p><p id="qa-status" role="status"></p><details><summary>Registro de RPC / Edge simuladas</summary><pre id="qa-log"></pre></details></aside>${checkout}<section class="qa-admin commercial-panel"><div id="delivery-admin-content"></div><div id="order-delivery-panel"></div></section></main><script src="/tests/qa/checkout-mock.js"></script><script src="/js/checkout-commercial.js"></script><script src="/js/checkout-commercial-admin.js"></script></body></html>`;
const server=http.createServer((req,res)=>{
 if(req.headers.host!==`127.0.0.1:${port}`){res.writeHead(403);return res.end('Loopback QA only');}
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src data:; font-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'");
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
 const url=new URL(req.url,`http://127.0.0.1:${port}`),file=sources[url.pathname];
 if(url.pathname==='/health'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({qa:true,externalConnections:false,hashes}));}
 if(url.pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(page);}
 if(file){res.setHeader('Content-Type',url.pathname.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8');return res.end(file);}
 res.writeHead(404);res.end();
});
server.listen(port,'127.0.0.1',()=>console.log(`QA local http://127.0.0.1:${port}/ (snapshot loaded; restart after code changes)`));
