// Actual historical checkout migrations, not a production dump. No hosted URL accepted.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import net from 'node:net';
import pg from 'pg';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),bin=path.join(root,'outputs/pg17-qa/pgsql/bin');
const run=fs.mkdtempSync(path.join(root,'outputs/pg17-qa/upgrade-')),dataDir=path.join(run,'data'),password=randomBytes(32).toString('hex');
const read=f=>fs.readFileSync(path.join(root,f),'utf8'),migration='20261124145228_checkout_commercial_launch.sql';
const exe=(name,args)=>{const fd=fs.openSync(path.join(run,name+'.log'),'a');try{execFileSync(path.join(bin,name+'.exe'),args,{windowsHide:true,timeout:60000,stdio:['ignore',fd,fd]});}finally{fs.closeSync(fd);}};
const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
let started=false,db;const report={baseline:[],checks:[],platformMocks:['Auth claim reader','Storage tables','inert Vault and Cron; HTTP always rejected'],skipped:['20261012003405_cubica_order_email_scheduler_extensions.sql','20261012003936_cubica_order_email_activate_cron.sql']};
const admin=randomUUID(),customer=randomUUID(),other=randomUUID();
const scalar=async(sql,args=[])=>(await db.query(sql,args)).rows[0].v;
const auth=async(role,uid=null,aal='aal1')=>{await db.query('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[uid||'',JSON.stringify({sub:uid,role,aal,email:'synthetic@example.invalid'})]);if(role!=='owner')await db.query('set role '+({anon:'anon',authenticated:'authenticated',service_role:'service_role'}[role]||'invalid'));};
const check=async(name,fn)=>{await fn();report.checks.push(name);console.log('PASS '+name);};
try{
 const pw=path.join(run,'password');fs.writeFileSync(pw,password);exe('initdb',['-D',dataDir,'-U','upgrade_qa','--pwfile='+pw,'--auth=scram-sha-256','--encoding=UTF8','--locale=C']);fs.unlinkSync(pw);exe('pg_ctl',['-D',dataDir,'-l',path.join(run,'server.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);started=true;
 db=new pg.Client({host:'127.0.0.1',port,user:'upgrade_qa',password,database:'postgres'});await db.connect();
 report.server=(await db.query("select version(),host(inet_server_addr()) address,current_setting('data_directory') directory")).rows[0];assert.equal(report.server.address,'127.0.0.1');assert.equal(path.resolve(report.server.directory).toLowerCase(),dataDir.toLowerCase());assert.match(report.server.version,/PostgreSQL 17\./);
 await db.query(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
 create schema auth;create schema extensions;create schema storage;create schema vault;create schema cron;create schema net;
 create extension pgcrypto with schema extensions;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz,is_anonymous boolean default false,deleted_at timestamptz,banned_until timestamptz);
 create table auth.mfa_factors(id uuid primary key,user_id uuid,factor_type text,status text);
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),auth.jwt()->>'sub')::uuid$$;
 create function auth.role() returns text language sql stable as $$select coalesce(auth.jwt()->>'role','anon')$$;
 grant usage on schema auth to anon,authenticated,service_role;grant execute on all functions in schema auth to anon,authenticated,service_role;
 create function public.rls_auto_enable() returns event_trigger language plpgsql as $$begin return;end$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key,bucket_id text,name text,owner uuid,metadata jsonb);alter table storage.objects enable row level security;
 create table vault.secrets(id uuid primary key default gen_random_uuid(),name text unique,secret text,description text);
 create view vault.decrypted_secrets as select id,name,secret decrypted_secret from vault.secrets;
 create function vault.create_secret(new_secret text,new_name text,new_description text) returns uuid language sql as $$insert into vault.secrets(name,secret,description) values(new_name,new_secret,new_description) returning id$$;
 create table cron.job(jobid bigint generated always as identity primary key,jobname text unique,schedule text,command text);
 create function cron.schedule(job_name text,schedule text,command text) returns bigint language sql as $$insert into cron.job(jobname,schedule,command) values(job_name,schedule,command) returning jobid$$;
 create function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds integer default 1000) returns bigint language plpgsql as $$begin raise exception 'EXTERNAL_NETWORK_FORBIDDEN_IN_QA';end$$;
 `);
 await db.query(read('supabase_schema_current_v1.sql'));report.baseline.push('supabase_schema_current_v1.sql');
 // Consolidated documentation omits this historical constraint, explicitly dropped
 // by the first lifecycle migration. Restore its required empty-schema predecessor.
 await db.query("alter table public.orders add constraint orders_status_check check(status in ('Pendiente','Confirmado','Preparado','Entregado','Cancelado'))");
 report.platformMocks.push('orders_status_check predecessor omitted by consolidated schema documentation');
 // Dependency graph through budget conversion; Stage C is unrelated and not replayed.
 const predecessors=fs.readdirSync(path.join(root,'supabase/migrations')).filter(f=>f.endsWith('.sql')&&f<'20261017200000'&&!report.skipped.includes(f)).sort();
 for(const f of predecessors){console.log('BASE '+f);await db.query(read('supabase/migrations/'+f));report.baseline.push(f);}
 await db.query("insert into auth.users(id,email) values($1,'admin-qa@example.invalid'),($2,'buyer-qa@example.invalid'),($3,'other-qa@example.invalid')",[admin,customer,other]);await db.query("update public.profiles set role='admin' where id=$1",[admin]);
 await db.query("insert into public.products(id,name,price,stock,published) values('qa-upgrade','Synthetic upgrade product',10000,20,true)");
 const legacyArgs=()=>{const id=randomUUID();return[id,'QA Buyer','buyer-qa@example.invalid','1112345678','Efectivo','Synthetic legacy',[{product_id:'qa-upgrade',qty:1,color:''}],{mode:'pickup',request_id:id,quote_token:'b'.repeat(64)}];};
 const create=(args)=>scalar('select private.create_delivery_order($1,$2,$3,$4,$5,$6,$7,$8) v',args.map((v,i)=>i>=6?JSON.stringify(v):v));
 await auth('owner');const oldArgs=legacyArgs(),old=await create(oldArgs);
 const historical=async()=>{await auth('owner');return scalar(`select jsonb_build_object('orders',(select jsonb_agg(to_jsonb(o) order by id) from public.orders o),'items',(select jsonb_agg(to_jsonb(i) order by id) from public.order_items i),'delivery',(select jsonb_agg(to_jsonb(d) order by order_id) from private.order_deliveries d),'inventory',(select jsonb_agg(to_jsonb(i) order by id) from public.inventory_movements i),'stock',(select jsonb_agg(to_jsonb(p) order by id) from public.products p),'queue',(select jsonb_agg(to_jsonb(q) order by order_id,kind) from public.order_email_outbox q),'cron',(select jsonb_agg(to_jsonb(j) order by jobid) from cron.job j)) v`);};
 const before=await historical();
 await check('predecessor has real AAL2 enforcement and new API is absent',async()=>{assert.equal(await scalar('select private.admin_mfa_enforcement_enabled() v'),true);assert.equal(await scalar("select to_regprocedure('public.get_checkout_options()') v"),null);await auth('authenticated',admin,'aal1');assert.equal(await scalar('select private.is_admin() v'),false);await auth('owner');});
 const sql=read('supabase/migrations/'+migration);report.migration={file:migration,sha256:createHash('sha256').update(sql).digest('hex')};
 await check('migration fails atomically without MFA enforcement',async()=>{await db.query('create or replace function private.admin_mfa_enforcement_enabled() returns boolean language sql stable as $$select false$$');await assert.rejects(db.query(sql),/requires_aal2/);await db.query('rollback');assert.equal(await scalar("select to_regclass('private.checkout_settings') v"),null);await db.query(read('supabase/migrations/20261013153000_admin_mfa_enforcement_on.sql'));});
 await check('complete migration can roll back to the predecessor before reapplication',async()=>{await db.query(sql.replace(/commit;\s*$/,'rollback;'));assert.equal(await scalar("select to_regclass('private.checkout_settings') v"),null);assert.deepEqual(await historical(),before);});
 await check('migration updates actual predecessor without changing historical rows or stock',async()=>{await db.query(sql);assert.deepEqual(await historical(),before);assert.equal(await scalar('select count(*)::int v from private.order_commercial'),0);});
 await check('duplicate application aborts atomically without changing the upgraded schema',async()=>{await db.query('create database qa_replay template postgres');const second=new pg.Client({host:'127.0.0.1',port,user:'upgrade_qa',password,database:'qa_replay'});await second.connect();try{await assert.rejects(second.query(sql),/already exists/);await second.query('rollback');assert.equal((await second.query('select count(*)::int n from private.checkout_settings')).rows[0].n,1);}finally{await second.end();}});
 const newTables=['checkout_settings','pickup_points','order_commercial','checkout_audit'];
 await check('all new private tables have RLS and no direct browser privileges',async()=>{for(const table of newTables){assert.equal(await scalar('select relrowsecurity v from pg_class where oid=$1::regclass',['private.'+table]),true);for(const role of ['anon','authenticated'])assert.equal(await scalar("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') v",[role,'private.'+table]),false);}});
 await check('AAL1 admin and AAL2 non-admin cannot change settings; private tables stay inaccessible',async()=>{for(const [uid,aal]of[[admin,'aal1'],[customer,'aal2']]){await auth('authenticated',uid,aal);await assert.rejects(scalar('select public.admin_checkout_settings() v'),/AAL2/);await assert.rejects(scalar('select to_jsonb(s) v from private.checkout_settings s'),/permission denied/);}await auth('anon');assert.equal((await scalar('select public.get_checkout_options() v')).uber_enabled,false);await assert.rejects(scalar('select public.admin_checkout_settings() v'),/permission denied/);});
 const point=randomUUID();await auth('authenticated',admin,'aal2');
 await scalar("select public.admin_save_checkout_settings(1,$1,'QA only',true,true) v",[{cbu:'0'.repeat(22),holder:'QA SYNTHETIC',bank:'QA BANK'}]);await scalar('select public.admin_save_pickup_point($1,0,$2) v',[point,{name:'QA enabled',enabled:true,private_instructions:'PRIVATE_QA_LOCATION'}]);
 await check('anonymous options never reveal private instructions; direct legacy writes remain revoked',async()=>{await auth('anon');assert.ok(!JSON.stringify(await scalar('select public.get_checkout_options() v')).includes('PRIVATE_QA'));for(const sig of ['public.create_public_order(text,text,text,text,text,text,jsonb)','private.create_delivery_order(text,text,text,text,text,text,jsonb,jsonb)','private.create_delivery_order_prelaunch(text,text,text,text,text,text,jsonb,jsonb)'])assert.equal(await scalar("select has_function_privilege('anon',$1,'EXECUTE') v",[sig]),false);});
 await check('old exact cash request replays without reinterpretation; new old-client requests are rejected',async()=>{await auth('owner');assert.equal((await create(oldArgs)).order_id,old.order_id);const fresh=legacyArgs();await assert.rejects(create(fresh),/transfer_required/);fresh[4]='Transferencia';await assert.rejects(create(fresh),/pickup_unavailable/);fresh[7].mode='shipping';await assert.rejects(create(fresh),/delivery_disabled/);});
 await check('real service wrapper creates new guest order with server price and unchanged stock reservation contract',async()=>{await auth('service_role');const p=legacyArgs();p[4]='Transferencia';p[7].pickup_id=point;const r=await scalar('select public.create_verified_delivery_order($1,$2,$3,$4,$5,$6,$7,$8,null,$9) v',[...p.slice(0,6),JSON.stringify(p[6]),JSON.stringify(p[7]),JSON.stringify([{key:'guest:'+randomUUID().replaceAll('-','').repeat(2),limit:8,window_seconds:3600},{key:'ip:'+randomUUID().replaceAll('-','').repeat(2),limit:40,window_seconds:3600}])]);await auth('anon');const receipt=await scalar('select public.get_checkout_receipt($1,$2) v',[r.order_id,p[7].quote_token]);assert.equal(receipt.commercial.products_total,10000);assert.equal(receipt.commercial.products_credited,0);assert.equal(receipt.pickup_instructions,null);await assert.rejects(scalar('select public.get_checkout_receipt($1,$2) v',[r.order_id,'c'.repeat(64)]),/no disponible/);});
 await auth('owner');
 await check('all administrative entrypoints use locked search_path and no PUBLIC execute',async()=>{const rows=(await db.query("select p.oid::regprocedure::text signature,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('admin_checkout_settings','admin_save_checkout_settings','admin_save_pickup_point','admin_checkout_order_action')")).rows;assert.equal(rows.length,4);for(const row of rows){assert.equal(row.prosecdef,true);assert.ok(row.proconfig.some(c=>c.startsWith('search_path=')));assert.equal(await scalar("select has_function_privilege('anon',$1,'EXECUTE') v",[row.signature]),false);}});
 fs.writeFileSync(path.join(run,'result.json'),JSON.stringify(report,null,2));console.log('UPGRADE PASS '+report.checks.length+' checks; '+report.baseline.length+' predecessor files. '+run);
}finally{if(db)await db.end();if(started)exe('pg_ctl',['-D',dataDir,'-m','fast','-w','stop']);}
