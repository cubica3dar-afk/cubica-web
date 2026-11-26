// Optional local browser QA. Existing Chrome, fresh profile, synthetic server only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const origin='http://127.0.0.1:4177';
const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
const health=await fetch(origin+'/health');assert.equal(health.status,200);
const source=await health.json();assert.equal(source.qa,true);assert.equal(source.externalConnections,false);
for(const [file,hash]of Object.entries(source.hashes))assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex'),hash,'Restart QA server: stale '+file);
const run=fs.mkdtempSync(path.join(root,'outputs/checkout-browser-'));
const report={source,checks:[],requests:[],errors:[],screenshots:[]};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const browser=spawn(chrome,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--disable-extensions','--metrics-recording-only','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',`--user-data-dir=${path.join(run,'profile')}`,'--remote-debugging-port=0','about:blank'],{windowsHide:true,stdio:'ignore'});
let ws;const awaiting=new Map();let sequence=0;
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{awaiting.delete(id);reject(Error('Timeout: '+method));},15000);awaiting.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
const until=async expression=>{for(let i=0;i<80;i++){if(await evaluate(expression))return;await wait(100);}throw Error('Condition timed out: '+expression);};
const check=async(name,fn)=>{await fn();report.checks.push(name);console.log('PASS '+name);};
const select=async(selector,value)=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const db=()=>evaluate("JSON.parse(sessionStorage.getItem('qa_checkout_synthetic_v1'))");
const reset=async()=>{await evaluate('sessionStorage.clear();location.reload()');await until("!!document.querySelector('#commercial-fields [name=mode]') && window.qaCalls.length>0");};
const pickup=async()=>{await select('#commercial-fields [name=mode]','pickup');await select('#commercial-fields [name=pickup_id]','11111111-1111-4111-8111-111111111111');};
const uber=async()=>{await select('#commercial-fields [name=mode]','uber');await evaluate(`for(const [k,v]of Object.entries({street:'CALLE SINTETICA QA',number:'123',neighborhood:'BARRIO QA',city:'LOCALIDAD QA',postal_code:'1000'}))document.querySelector('#commercial-fields [name='+k+']').value=v;document.querySelector('[name=caba]').checked=true;`);};
const shot=async(name,width)=>{await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<500});await wait(100);assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'Horizontal overflow at '+width);const metrics=await call('Page.getLayoutMetrics');const png=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width,height:metrics.cssContentSize.height,scale:1}});fs.writeFileSync(path.join(run,name+'.png'),Buffer.from(png.data,'base64'));report.screenshots.push(name+'.png');};
try{
 const portFile=path.join(run,'profile/DevToolsActivePort');for(let i=0;i<100&&!fs.existsSync(portFile);i++)await wait(100);assert.ok(fs.existsSync(portFile),'Chrome did not start');
 const port=Number(fs.readFileSync(portFile,'utf8').split('\n')[0]);assert.ok(port>0);
 const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();const target=targets.find(t=>t.type==='page'&&t.url==='about:blank');assert.ok(target);
 assert.equal(new URL(target.webSocketDebuggerUrl).hostname,'127.0.0.1');ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=awaiting.get(m.id);if(p){awaiting.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}return;}
  if(m.method==='Runtime.exceptionThrown')report.errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
  if(m.method==='Fetch.requestPaused'){const url=m.params.request.url;report.requests.push(url);call(url.startsWith(origin+'/')?'Fetch.continueRequest':'Fetch.failRequest',url.startsWith(origin+'/')?{requestId:m.params.requestId}:{requestId:m.params.requestId,errorReason:'BlockedByClient'}).catch(()=>{});}
 };
 await call('Runtime.enable');await call('Page.enable');await call('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
 await call('Page.navigate',{url:origin+'/'});await until("!!document.querySelector('#commercial-fields [name=mode]')");
 await check('real frontend renders transfer only and enabled public pickup points',async()=>{assert.deepEqual(await evaluate("[...document.querySelector('#payment-method').options].map(o=>o.value)"),['Transferencia']);assert.equal(await evaluate("document.querySelector('[name=pickup_id]').options.length"),2);assert.equal(await evaluate("document.getElementById('section-checkout').textContent.includes('UBICACION_PRIVADA_QA_789')"),false);});
 await pickup();await check('desktop and 390px pickup layout without horizontal overflow',async()=>{await shot('pickup-desktop',1280);await shot('pickup-mobile',390);});
 await check('delayed double click creates one simulated order; receipt survives reload',async()=>{await select('#qa-failure','delay');await click('#checkout-confirm-btn');await click('#checkout-confirm-btn');await until("!document.getElementById('commercial-receipt').hidden");assert.equal((await db()).records.length,1);assert.equal(await evaluate("qaCalls.filter(c=>c.name==='create-order SIMULADO').length"),1);assert.equal(await evaluate("document.getElementById('commercial-receipt').textContent.includes('UBICACION_PRIVADA_QA_789')"),false);await evaluate('location.reload()');await until("!!document.getElementById('commercial-receipt')&&!document.getElementById('commercial-receipt').hidden");assert.equal((await db()).records.length,1);assert.equal(await evaluate('cart.length'),0);await shot('receipt-mobile',390);});
 await reset();await uber();await check('desktop and 390px Uber form without horizontal overflow',async()=>{await shot('uber-desktop',1280);await shot('uber-mobile',390);});
 await check('20001 rejected before simulated write; 20000 accepted pending manual approval',async()=>{await select('#qa-cart','20001');await click('#checkout-confirm-btn');await until("document.getElementById('commercial-message').textContent.includes('20.000')");assert.equal((await db()).records.length,0);assert.equal(await evaluate("qaCalls.filter(c=>c.name==='create-order SIMULADO').length"),0);await select('#qa-cart','20000');await click('#checkout-confirm-btn');await until("!document.getElementById('commercial-receipt').hidden");assert.equal((await db()).records[0].receipt.commercial.uber_status,'pending_review');assert.equal((await db()).records[0].receipt.commercial.products_total,20000);assert.match(await evaluate("document.getElementById('commercial-receipt').textContent"),/Todavía no está confirmada/);});
 await reset();await pickup();await check('lost response reconciles by read without repeating creation',async()=>{await select('#qa-failure','lost');await click('#checkout-confirm-btn');await until("!document.getElementById('commercial-recovery').hidden");assert.equal((await db()).records.length,1);assert.equal(await evaluate('cart.length'),1);await evaluate('cubicaCommercial.recover()');await until("!document.getElementById('commercial-receipt').hidden");assert.equal((await db()).records.length,1);assert.equal(await evaluate("qaCalls.filter(c=>c.name==='create-order SIMULADO').length"),1);});
 await reset();await pickup();await check('failure before save retries the same synthetic identity',async()=>{await select('#qa-failure','before');await click('#checkout-confirm-btn');await until("!document.getElementById('commercial-recovery').hidden");assert.equal((await db()).records.length,0);await evaluate('cubicaCommercial.submit()');await until("!document.getElementById('commercial-receipt').hidden");const ids=await evaluate("qaCalls.filter(c=>c.name==='create-order SIMULADO').map(c=>c.params.client_order_id)");assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);assert.equal((await db()).records.length,1);});
 await check('simulated AAL1 cannot load administrative configuration',async()=>{await select('#qa-role','aal1');await click('#qa-config');await wait(100);assert.equal(await evaluate("qaCalls.filter(c=>c.name==='admin_checkout_settings').length"),0);});
 await check('no external page requests or uncaught JavaScript errors',async()=>{assert.deepEqual(report.requests.filter(url=>!url.startsWith(origin+'/')),[]);assert.deepEqual(report.errors,[]);});
 report.passed=true;console.log('BROWSER PASS '+report.checks.length+' checks; '+run);
}finally{
 fs.writeFileSync(path.join(run,'result.json'),JSON.stringify(report,null,2));
 if(ws?.readyState===WebSocket.OPEN){await call('Browser.close').catch(()=>{});ws.close();}
 else browser.kill();
}
