-- Cover foreign keys introduced or reused by the budget system.
create index if not exists quote_conversions_version_idx on public.quote_conversions(version_id);
create index if not exists quote_conversions_actor_idx on public.quote_conversions(actor_id) where actor_id is not null;
create index if not exists quote_status_history_actor_idx on public.quote_status_history(actor_id) where actor_id is not null;
create index if not exists quote_versions_created_by_idx on public.quote_versions(created_by) where created_by is not null;
create index if not exists quotes_created_by_idx on public.quotes(created_by) where created_by is not null;
create index if not exists quotes_updated_by_idx on public.quotes(updated_by) where updated_by is not null;
create index if not exists quotes_converted_order_idx on public.quotes(converted_order_id) where converted_order_id is not null;
create index if not exists quotes_converted_product_idx on public.quotes(converted_product_id) where converted_product_id is not null;
