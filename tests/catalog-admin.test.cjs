const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('catalog pagination, filters and publication controls are wired',()=>{
  const html=read('index.html');
  const store=read('js/store-ui.js');
  const products=read('js/products-ui.js');
  const supplies=read('js/inventory-ui.js');
  const init=read('js/app-init.js');
  for(const id of ['product-sort','finished-publication-filter','finished-active-filter','supply-brand-filter','supply-material-filter','supply-active-filter','finished-published','finished-active','supply-active'])assert.match(html,new RegExp('id="'+id+'"'));
  for(const source of [store,products,supplies])assert.match(source,/\[10,25,50\]/);
  assert.match(store,/p\.active!==false&&p\.published!==false/);
  assert.match(products,/finished-published"\)\.checked=false/);
  assert.match(products,/toggleProductPublication/);
  assert.match(supplies,/s\.brand===brand/);
  assert.match(supplies,/s\.materialType===material/);
  assert.match(init,/productPage=1/);
  assert.match(init,/finishedPage=1/);
  assert.match(init,/supplyPage=1/);
});

test('public rendering excludes hidden products and reports filtered totals',()=>{
  const nodes={
    'product-search':{value:''},
    'product-category':{value:'all',innerHTML:''},
    'product-grid':{innerHTML:''},
    'product-pagination':{classList:{add(){},remove(){}},innerHTML:''},
    'section-store':{querySelector(){return null}}
  };
  const calls=[];
  const context={
    console,window:{},localStorage:{getItem(){return null},setItem(){}},
    products:[
      {id:'b',name:'Beta',category:'Figuras',description:'',price:200,stock:1,active:true,published:true,sortOrder:20,media:[]},
      {id:'a',name:'Alfa',category:'Figuras',description:'',price:100,stock:1,active:true,published:true,sortOrder:10,media:[]},
      {id:'secret',name:'Secreto',category:'Figuras',description:'',price:1,stock:1,active:true,published:false,sortOrder:0,media:[]}
    ],
    cart:[],STORAGE:{cart:'cart'},$:id=>nodes[id],escapeHtml:String,iconFor:()=>'',money:v=>String(v),
    normalizeProduct:p=>p,renderPagination:(id,data)=>calls.push(data),write(){},toast(){},updateCartBadge(){},
    CustomEvent:class{},setTimeout,clearTimeout
  };
  vm.createContext(context);
  vm.runInContext(read('js/store-ui.js'),context);
  context.renderProducts();
  assert.match(nodes['product-grid'].innerHTML,/Alfa/);
  assert.match(nodes['product-grid'].innerHTML,/Beta/);
  assert.doesNotMatch(nodes['product-grid'].innerHTML,/Secreto/);
  assert.equal(calls.at(-1).totalItems,2);
  assert.equal(calls.at(-1).pageSize,10);
  context.setProductPageSize(25);
  assert.equal(calls.at(-1).pageSize,25);
});

test('hidden cart items are explicit and block checkout',()=>{
  const nodes={
    'cart-items':{innerHTML:''},'cart-count':{textContent:''},'cart-total':{textContent:''},
    'cart-badge':{textContent:'',classList:{toggle(){}}},'checkout-btn':{disabled:false,title:''}
  };
  const context={
    console,window:{},localStorage:{getItem(){return null},setItem(){}},
    products:[{id:'hidden',name:'Oculto',price:100,active:true,published:false}],
    cart:[{productId:'hidden',qty:1,color:''}],STORAGE:{cart:'cart'},$:id=>nodes[id],escapeHtml:String,money:v=>String(v),
    renderPagination(){},write(){},toast(){},normalizeProduct:p=>p,setTimeout,clearTimeout
  };
  vm.createContext(context);
  vm.runInContext(read('js/store-ui.js'),context);
  context.renderCart();
  assert.match(nodes['cart-items'].innerHTML,/Producto no disponible/);
  assert.equal(nodes['checkout-btn'].disabled,true);
});

test('Supabase and checkout enforce publication beyond the UI',()=>{
  const migration=read('supabase/migrations/20261016173000_product_publication_and_catalog_admin.sql');
  const bridge=read('supabase-bridge.js');
  const checkout=read('js/checkout-ui.js');
  const sales=read('supabase-sales.js');
  assert.match(migration,/using \(active=true and published=true\)/);
  assert.match(migration,/p\.active=true and p\.published=true for update/g);
  assert.match(migration,/and active and published/);
  assert.match(migration,/private\.is_admin\(\)/);
  assert.match(bridge,/published:p\.published===true/);
  assert.match(checkout,/p\.published!==false/);
  assert.match(sales,/x\.published!==false/);
});

