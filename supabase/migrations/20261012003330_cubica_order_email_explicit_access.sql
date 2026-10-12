create policy order_email_outbox_no_client_access on public.order_email_outbox for all to anon,authenticated using(false) with check(false);
revoke delete on public.order_email_outbox from service_role;
