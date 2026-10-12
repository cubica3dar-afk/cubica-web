const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const kpis={innerHTML:''};
const context={session:{role:'admin'},products:[],supplies:[],window:{},document:{querySelectorAll:()=>[]},
 $:id=>id==='analytics-kpis'?kpis:null,money:n=>String(n),todayKey:value=>new Date(value).toISOString().slice(0,10),
 orders:['Pendiente','Confirmado','En producción','Preparado','Entregado','Cancelado'].map((status,i)=>({id:String(i),date:new Date().toISOString(),status,total:100,items:[],customerName:'Fixture',customerEmail:'fixture@example.test'})),
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/analytics-ui.js'),'utf8'),context);
vm.runInContext('analyticsRange="all";renderAnalyticsLineChart=()=>{};renderWeeklyTimeChart=()=>{};renderAnalytics();',context);
assert.match(kpis.innerHTML,/<span>Pendientes<\/span><strong>4<\/strong>/);
assert.match(kpis.innerHTML,/<span>Pedidos<\/span><strong>5<\/strong>/);
assert.match(kpis.innerHTML,/<span>Facturación<\/span><strong>500<\/strong>/);
console.log('PASS: Analytics counts all four open stages, retains delivered revenue, and excludes cancellation.');
