const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../styles-checkout.css'),'utf8');

// Only inspect document structure; visual dimensions are verified in the browser.
function structure(source){
  const root={tag:'#document',attrs:{},children:[],parent:null,order:0};
  const stack=[root],nodes=[],ids=new Map();
  const voidTags=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  const cleaned=source.replace(/<!--[\s\S]*?-->/g,'').replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'');
  for(const match of cleaned.matchAll(/<\/?([a-z][\w:-]*)\b([^>]*)>/gi)){
    const tag=match[1].toLowerCase();
    if(match[0].startsWith('</')){
      const index=stack.findLastIndex(node=>node.tag===tag);if(index>0)stack.length=index;
      continue;
    }
    const attrs={};
    for(const attr of match[2].matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))attrs[attr[1].toLowerCase()]=attr[2]??attr[3]??attr[4]??'';
    const node={tag,attrs,parent:stack.at(-1),children:[],order:match.index};
    node.parent.children.push(node);nodes.push(node);
    if(attrs.id){if(!ids.has(attrs.id))ids.set(attrs.id,[]);ids.get(attrs.id).push(node);}
    if(!voidTags.has(tag)&&!match[0].endsWith('/>'))stack.push(node);
  }
  return {nodes,ids};
}
const doc=structure(html);
function one(id){const nodes=doc.ids.get(id)||[];assert.equal(nodes.length,1,`${id} must identify exactly one element`);return nodes[0];}
function within(node,ancestor){for(let parent=node.parent;parent;parent=parent.parent)if(parent===ancestor)return true;return false;}
function classNames(node){return (node.attrs.class||'').split(/\s+/);}

test('checkout is a named page inside the existing main, with no previous modal',()=>{
  const section=one('section-checkout');assert.equal(section.tag,'section');assert(classNames(section).includes('page-section'));
  assert(!classNames(section).includes('modal'));assert.notEqual(section.attrs.role,'dialog');assert.equal(doc.ids.has('checkout-modal'),false);
  assert.equal(doc.nodes.filter(node=>node.tag==='main'&&within(section,node)).length,1,'no nested main landmark');
  const heading=one(section.attrs['aria-labelledby']);assert.equal(heading.tag,'h1');assert(within(heading,section));
  assert.equal(heading.attrs.tabindex,'-1','route can focus the page heading without adding a tab stop');
});

test('summary follows buyer form in source order, preserving mobile reading order',()=>{
  const section=one('section-checkout'),layout=one('checkout-layout'),form=one('checkout-form');
  assert(within(layout,section));assert(within(form,layout));
  const summary=doc.nodes.find(node=>node.tag==='aside'&&within(node,layout));assert(summary,'order summary is a complementary landmark');
  const title=one(summary.attrs['aria-labelledby']);assert.equal(title.tag,'h2');assert(within(title,summary));
  assert(summary.order>form.order,'summary must follow form rather than rely on a CSS reorder');
  for(const id of ['checkout-summary-items','checkout-delivery-total-host','checkout-summary-message'])assert(within(one(id),summary),`${id} belongs to summary`);
  assert.equal(one('checkout-summary-message').attrs['aria-live'],'polite');
});

test('confirmation outside the form participates in native form validation',()=>{
  const form=one('checkout-form'),button=one('checkout-confirm-btn');
  assert.equal(form.tag,'form');assert.equal(button.tag,'button');assert.equal(button.attrs.type,'submit');assert.equal(button.attrs.form,'checkout-form');
  assert(!within(button,form),'desktop summary action remains associated with buyer form');
  const submits=doc.nodes.filter(node=>(node.tag==='button'&&(node.attrs.type||'submit')==='submit'||node.tag==='input'&&node.attrs.type==='submit')&&(within(node,form)||node.attrs.form==='checkout-form'));
  assert.equal(submits.length,1,'only one confirmation control exists');assert.equal(form.attrs.novalidate,undefined);
});

test('buyer fields expose labels and browser autocomplete without a duplicate email field',()=>{
  const form=one('checkout-form');
  const inputs=doc.nodes.filter(node=>node.tag==='input'&&within(node,form)&&node.attrs.type!=='hidden');
  for(const token of ['given-name','family-name','email','tel']){
    const input=inputs.find(node=>(node.attrs.autocomplete||'').split(/\s+/).includes(token));assert(input,`missing ${token} autocomplete`);
    assert(doc.nodes.some(node=>node.tag==='label'&&(node.attrs.for===input.attrs.id||within(input,node))),`${token} input has no accessible label`);
  }
  assert.equal(inputs.filter(node=>node.attrs.type==='email').length,1,'Auth email is reused once');
});

test('checkout stylesheet follows shared delivery styles and avoids an internal scroll viewport',()=>{
  const links=doc.nodes.filter(node=>node.tag==='link'&&node.attrs.rel==='stylesheet');
  const shared=links.findIndex(node=>(node.attrs.href||'').startsWith('styles-delivery.css'));
  const checkout=links.findIndex(node=>(node.attrs.href||'').startsWith('styles-checkout.css'));
  assert(checkout>shared&&shared>=0,'checkout adaptations must follow shared delivery rules');
  assert(!/overflow(?:-y)?\s*:\s*(?:auto|scroll)/i.test(css),'checkout uses document scroll');
  assert(!/max-height\s*:/i.test(css),'form and summary are not capped by a modal height');
  assert(!/position\s*:\s*fixed/i.test(css),'checkout is part of page flow');
});

