-- CÚBICA 3D — Contención no destructiva de 5B v2.
-- Conserva sugerencias, contadores e idempotencia; solamente cierra ejecución.

do $$
declare signature regprocedure;
begin
  foreach signature in array array[
    to_regprocedure('public.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)'),
    to_regprocedure('private.submit_protected_suggestion(text,text,text,text,text,text,text,text,uuid,uuid)'),
    to_regprocedure('private.stage_c_apply_suggestion_limit(text,text,integer,timestamptz)')
  ] loop
    if signature is not null then
      execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
    end if;
  end loop;
end $$;

alter table if exists private.site_suggestions enable row level security;
alter table if exists private.suggestion_token_uses enable row level security;
alter table if exists private.suggestion_rate_limits enable row level security;

revoke all on private.site_suggestions,private.suggestion_token_uses,
  private.suggestion_rate_limits from public,anon,authenticated,service_role;
