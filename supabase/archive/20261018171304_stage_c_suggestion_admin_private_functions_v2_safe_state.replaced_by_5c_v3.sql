-- Contención no destructiva de 5C v2. Conserva sugerencias y ledger.
do $$
declare signature regprocedure;
begin
  foreach signature in array array[
    to_regprocedure('private.admin_list_suggestions(integer,integer,text,text,text,text)'),
    to_regprocedure('private.admin_update_suggestion(uuid,text,text)'),
    to_regprocedure('private.cleanup_suggestion_protection()')
  ] loop
    if signature is not null then
      execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
    end if;
  end loop;
end $$;

alter table if exists private.site_suggestions enable row level security;
alter table if exists private.suggestion_token_uses enable row level security;
alter table if exists private.suggestion_rate_limits enable row level security;

