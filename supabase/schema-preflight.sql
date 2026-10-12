-- Solo lectura. Ejecutar sobre el proyecto mymrbpwvghxmqqpzzdqk antes de migrar.
select table_name,column_name,data_type,is_nullable,column_default
from information_schema.columns
where table_schema='public' and table_name in ('orders','order_items','products','product_recipes','supplies')
order by table_name,ordinal_position;

select pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='create_public_order';

select schemaname,tablename,policyname,roles,cmd,qual,with_check
from pg_policies where tablename in ('orders','order_items','product_recipes','supplies');

select tgname,pg_get_triggerdef(oid) as definition
from pg_trigger where tgrelid='public.orders'::regclass and not tgisinternal;

select extname,extversion from pg_extension where extname in ('pg_cron','pg_net','supabase_vault');
