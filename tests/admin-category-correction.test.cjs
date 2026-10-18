const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const source=read("js/products-ui.js");
const bridge=read("supabase-bridge.js");
const html=read("index.html");
const css=read("styles.css");
const budgetSource=read("js/budget-ui.js");
const migration=read("supabase/migrations/20261017231500_product_category_safe_deletion.sql");
const rollback=read("supabase/rollback/20261017231500_product_category_safe_deletion_rollback.sql");

const elements={
  "finished-category":{innerHTML:"",value:"",disabled:false},
  "finished-category-warning":{textContent:"",classList:{hidden:true,toggle(_name,state){this.hidden=state;}}}
};
const storage={getItem:()=>null,setItem:()=>{}};
const context={
  window:{addEventListener:()=>{},location:{href:"https://cubica3d.ar/"}},globalThis:null,localStorage:storage,
  productCategories:[{name:"Activa",sortOrder:10,active:true},{name:"Inactiva actual",sortOrder:20,active:false},{name:"Inactiva ajena",sortOrder:30,active:false}],
  products:[{id:"existing",category:"Inactiva actual"},{id:"legacy",category:"Categoría histórica"}],
  DEFAULT_FINISHED_CATEGORIES:[],session:null,escapeHtml:value=>String(value??""),$:id=>elements[id]||null,toast:()=>{},writeLocal:()=>{},STORAGE:{},uid:()=>"x",console,URL,FileReader:function(){},history:{replaceState:()=>{},pushState:()=>{}},location:{href:"https://cubica3d.ar/",search:"",pathname:"/"},document:{title:"",querySelector:()=>null}
};
context.globalThis=context;
vm.createContext(context);vm.runInContext(source,context);
const api=context.window.cubicaFinishedCategoryInternals;

assert.deepEqual(Array.from(api.finishedCategories({activeOnly:true})),["Activa"],"Una categoría inactiva o histórica no puede ofrecerse al crear");
assert.equal(api.finishedCategoryAssignmentAllowed("Activa",""),true);
assert.equal(api.finishedCategoryAssignmentAllowed("Inactiva actual",""),false,"Un producto nuevo no puede usar una inactiva");
assert.equal(api.finishedCategoryAssignmentAllowed("Inactiva actual","existing"),true,"El producto puede conservar su categoría histórica");
assert.equal(api.finishedCategoryAssignmentAllowed("Inactiva ajena","existing"),false,"No puede cambiarse a otra inactiva");
assert.equal(api.finishedCategoryAssignmentAllowed("Categoría histórica","legacy"),true,"Una categoría histórica solo puede mantenerse en su producto");

api.renderFinishedCategorySelect();
assert.match(elements["finished-category"].innerHTML,/>Activa</);
assert.doesNotMatch(elements["finished-category"].innerHTML,/Inactiva/);
assert.equal(elements["finished-category"].disabled,false);

api.renderFinishedCategorySelect("Inactiva actual",{allowInactiveSelected:true});
assert.match(elements["finished-category"].innerHTML,/Inactiva actual \(inactiva · categoría actual\)/);
assert.doesNotMatch(elements["finished-category"].innerHTML,/Inactiva ajena/);
assert.equal(elements["finished-category"].value,"Inactiva actual");

context.productCategories.forEach(category=>category.active=false);
api.renderFinishedCategorySelect();
assert.equal(elements["finished-category"].disabled,true);
assert.match(elements["finished-category-warning"].textContent,/Creá o activá/);

for(const id of ["finished-category-delete-modal","finished-category-delete-name","finished-category-delete-count","finished-category-delete-destination","finished-category-delete-confirm"]){
  assert.match(html,new RegExp(`id="${id}"`),`Falta ${id}`);
}
for(const id of ["budget-product-conversion-modal","budget-product-conversion-name","budget-product-conversion-category","budget-product-conversion-confirm"]){
  assert.match(html,new RegExp(`id="${id}"`),`Falta ${id}`);
}
assert.match(source,/cubicaPreviewProductCategoryDelete/);
assert.match(source,/Reasignar y eliminar/);
assert.match(css,/\.btn\.danger/);
assert.match(css,/@media\(max-width:600px\)[\s\S]*?category-delete-actions/);

assert.match(bridge,/rpc\("get_admin_product_category_delete_preview"/);
assert.doesNotMatch(bridge,/upsert\(payload,\{onConflict:"name",ignoreDuplicates:true\}\)/,"Guardar productos no debe crear categorías implícitamente");
assert.match(migration,/products_validate_category_assignment/);
assert.match(migration,/new\.category is distinct from old\.category/);
assert.match(migration,/v_rename_cascade[\s\S]*current_setting\('cubica\.category_rename_from'/);
assert.match(migration,/v_rename_cascade := coalesce\(/,"Una marca ausente debe evaluarse como falsa y no habilitar categorías inactivas");
assert.match(migration,/current_setting\('cubica\.category_rename_to'/);
assert.match(migration,/v_rename_cascade[\s\S]*private\.is_admin\(\)/,"La excepción de cascada exige un admin AAL2");
assert.match(migration,/set_config\('cubica\.category_rename_from', v_category\.name, true\)/);
assert.match(migration,/set_config\('cubica\.category_rename_to', v_new_name, true\)/);
assert.match(migration,/v_action = 'delete'/);
assert.match(migration,/update public\.products set category = v_target\.name/);
assert.match(migration,/pg_advisory_xact_lock\(/);
assert.match(migration,/pg_advisory_xact_lock_shared\(/);
assert.match(migration,/not private\.is_admin\(\)/);
assert.match(migration,/revoke all on function public\.manage_admin_product_category[\s\S]*from public, anon, service_role/);
assert.match(migration,/create or replace function public\.convert_admin_quote_to_product/);
assert.match(migration,/where c\.name = btrim\(coalesce\(p_category, ''\)\) and c\.active/);
assert.doesNotMatch(migration,/values\([^\n]*nullif\(p_category/);
assert.match(budgetSource,/p_category:category/);
assert.doesNotMatch(budgetSource,/p_category:null/);
assert.match(rollback,/drop trigger if exists products_validate_category_assignment/);
assert.match(rollback,/drop function if exists public\.get_admin_product_category_delete_preview/);
assert.match(rollback,/create or replace function public\.convert_admin_quote_to_product/);

console.log("admin-category-correction.test.cjs: OK");
