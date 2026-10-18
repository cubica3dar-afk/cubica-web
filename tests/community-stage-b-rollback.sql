-- Ejecutar únicamente después de autorización explícita. Todos los fixtures se revierten.
begin;
do $$
declare
  customer_id uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid(); admin_id uuid:=gen_random_uuid();
  product_id text:='community-stage-b-'||gen_random_uuid(); root_id bigint; reply_id bigint;
  product_category text;
  term_id bigint; term_two_id bigint; term_three_id bigint; result jsonb; before_log bigint; i integer;
begin
  insert into auth.users(id,aud,role,email,raw_user_meta_data,email_confirmed_at) values
    (customer_id,'authenticated','authenticated',customer_id::text||'@example.invalid','{}',now()),
    (other_id,'authenticated','authenticated',other_id::text||'@example.invalid','{}',now()),
    (admin_id,'authenticated','authenticated',admin_id::text||'@example.invalid','{}',now());
  update public.profiles set role='admin' where id=admin_id;
  select name into product_category
  from public.product_categories
  where active
  order by sort_order,name
  limit 1;
  if product_category is null then raise exception 'QA: no active product category available';end if;
  insert into public.products(id,name,category,price,stock,published,active)
  values(product_id,'Community Stage B QA',product_category,100,20,true,true);

  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claim.sub',customer_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',customer_id,'role','authenticated','aal','aal1')::text,true);
  root_id:=public.create_community_comment(product_id,'Comentario base',gen_random_uuid());
  reply_id:=public.create_community_comment(product_id,'Respuesta base',gen_random_uuid(),root_id);

  -- Un cliente y un administrador en AAL1 no acceden a operaciones administrativas.
  begin perform public.get_admin_community_comments();raise exception 'Customer read admin moderation';
  exception when insufficient_privilege then null;end;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated','aal','aal1')::text,true);
  begin perform public.get_admin_community_comments();raise exception 'AAL1 read admin moderation';
  exception when insufficient_privilege then null;end;
  begin perform public.admin_set_community_user_block(customer_id,true,'Prueba AAL1');raise exception 'AAL1 blocked user';
  exception when insufficient_privilege then null;end;

  -- Todas las operaciones siguientes usan un administrador AAL2 de prueba.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated','aal','aal2')::text,true);
  result:=public.get_admin_community_history(1,10);
  before_log:=(result->>'total')::bigint;
  result:=public.admin_set_community_user_block(customer_id,true,'Prueba de restricción QA');
  if not (result->>'changed')::boolean then raise exception 'Block did not change';end if;

  perform set_config('request.jwt.claim.sub',customer_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',customer_id,'role','authenticated','aal','aal1')::text,true);
  if not (public.get_product_community(product_id)->>'participation_restricted')::boolean then raise exception 'Public restriction state missing';end if;
  begin perform public.create_community_comment(product_id,'No permitido',gen_random_uuid());raise exception 'Blocked create';exception when insufficient_privilege then null;end;
  begin perform public.edit_community_comment(root_id,'No permitido');raise exception 'Blocked edit';exception when insufficient_privilege then null;end;
  begin perform public.set_product_reaction(product_id,1);raise exception 'Blocked reaction';exception when insufficient_privilege then null;end;
  begin perform public.set_comment_like(reply_id,true);raise exception 'Blocked like';exception when insufficient_privilege then null;end;
  if not exists(select 1 from public.profiles where id=customer_id) then raise exception 'Community block affected profile/Auth';end if;

  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated','aal','aal2')::text,true);
  perform public.admin_set_community_user_block(customer_id,false,'Fin de prueba de restricción');
  result:=public.get_admin_community_users(1,10,'Fin de prueba','unblocked','recent');
  if (result->>'total')::integer<>1 or (result->>'page_size')::integer<>10 then raise exception 'User filters or pagination';end if;

  -- Normalización, palabra completa y variantes frecuentes.
  result:=public.admin_manage_community_term('create',null,'spam',true,true,'Regla QA palabra completa');
  term_id:=(result->'item'->>'id')::bigint;
  result:=public.admin_manage_community_term('create',null,'basura',true,true,'Regla QA normalización');
  term_two_id:=(result->'item'->>'id')::bigint;
  result:=public.admin_manage_community_term('create',null,'camión',true,true,'Regla QA tildes');
  term_three_id:=(result->'item'->>'id')::bigint;
  perform set_config('request.jwt.claim.sub',customer_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',customer_id,'role','authenticated','aal','aal1')::text,true);
  perform public.create_community_comment(product_id,'La palabra spammer no es coincidencia completa',gen_random_uuid());
  begin perform public.create_community_comment(product_id,'Esto es SPAM',gen_random_uuid());raise exception 'Whole-word forbidden term accepted';exception when data_exception then null;end;
  begin perform public.create_community_comment(product_id,'Esto es B4SURA',gen_random_uuid());raise exception 'Leet forbidden term accepted';exception when data_exception then null;end;
  begin perform public.create_community_comment(product_id,'Esto dice CAMION',gen_random_uuid());raise exception 'Accent/case forbidden term accepted';exception when data_exception then null;end;

  -- Enlaces se rechazan tanto en creación como en edición.
  begin perform public.create_community_comment(product_id,'Visitá https://example.invalid',gen_random_uuid());raise exception 'Protocol link accepted';exception when data_exception then null;end;
  begin perform public.create_community_comment(product_id,'Visitá example.com',gen_random_uuid());raise exception 'Bare domain accepted';exception when data_exception then null;end;
  begin perform public.edit_community_comment(reply_id,'www.example.com');raise exception 'Link edit accepted';exception when data_exception then null;end;

  -- Paginación combinable en 10/25/50 y filtros administrativos.
  for i in 1..12 loop
    perform public.create_community_comment(product_id,'Comentario de paginación '||i,gen_random_uuid());
  end loop;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated','aal','aal2')::text,true);
  result:=public.get_admin_community_terms(1,25,'cam','active','oldest');
  if (result->>'total')::integer<>1 or (result->>'page_size')::integer<>25 then raise exception 'Term filters or pagination';end if;
  result:=public.get_admin_community_comments(1,10,'paginación','published','oldest');
  if jsonb_array_length(result->'items')<>10 or (result->>'total')::integer<>12 then raise exception 'Comment pagination 10';end if;
  result:=public.get_admin_community_comments(1,25,'paginación','published','recent');
  if jsonb_array_length(result->'items')<>12 then raise exception 'Comment pagination 25';end if;
  result:=public.get_admin_community_comments(1,50,'sin coincidencias','all','recent');
  if (result->>'total')::integer<>0 then raise exception 'Combined search/filter';end if;

  -- Ocultar, restaurar y eliminar son idempotentes y generan auditoría.
  perform public.admin_moderate_community_comment(root_id,'hide','Ocultar para prueba QA');
  if jsonb_array_length(public.get_product_community(product_id,null,null,20)->'comments')<>13 then raise exception 'Hidden root or reply visibility count';end if;
  perform public.admin_moderate_community_comment(root_id,'restore','Restaurar para prueba QA');
  perform public.admin_moderate_community_comment(root_id,'delete','Eliminar administrativamente para prueba QA');
  result:=public.admin_moderate_community_comment(root_id,'delete','Reintento idempotente QA');
  if (result->>'changed')::boolean then raise exception 'Admin delete repeated';end if;
  begin perform public.admin_moderate_community_comment(root_id,'restore','Restauración indebida');raise exception 'Admin-deleted restored';exception when others then if sqlerrm='Admin-deleted restored' then raise;end if;end;
  begin perform public.get_product_community(product_id,root_id);raise exception 'Admin-deleted thread public';exception when others then if sqlerrm='Admin-deleted thread public' then raise;end if;end;
  if exists(select 1 from jsonb_array_elements(public.get_product_performance(30)->'products') p where p->>'product_id'=product_id and (p->>'comments')::integer<>13) then raise exception 'Invisible reply counted in metrics';end if;

  -- Configuración y ciclo de vida de reglas quedan auditados.
  perform public.admin_manage_community_term('set_active',term_id,null,true,false,'Desactivar regla QA');
  perform public.admin_manage_community_term('update',term_id,'spam actualizado',true,true,'Editar regla QA');
  perform public.admin_manage_community_term('delete',term_id,null,true,true,'Eliminar regla QA');
  perform public.admin_manage_community_term('delete',term_two_id,null,true,true,'Eliminar segunda regla QA');
  perform public.admin_manage_community_term('delete',term_three_id,null,true,true,'Eliminar tercera regla QA');
  perform public.admin_set_community_link_blocking(false,'Desactivar enlaces para prueba QA');
  perform public.admin_set_community_link_blocking(true,'Restaurar bloqueo de enlaces QA');
  result:=public.get_admin_community_history(1,50,'QA','all','recent');
  if (result->>'total')::integer<8 then raise exception 'Moderation history incomplete';end if;
  result:=public.get_admin_community_history(1,10);
  if (result->>'total')::bigint<=before_log then raise exception 'No audit records';end if;

  -- Likes y dislikes conservan sus filas y los dislikes siguen siendo solo administrativos.
  perform set_config('request.jwt.claim.sub',customer_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',customer_id,'role','authenticated','aal','aal1')::text,true);
  perform public.set_product_reaction(product_id,1);
  perform set_config('request.jwt.claim.sub',other_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',other_id,'role','authenticated','aal','aal1')::text,true);
  perform public.set_product_reaction(product_id,-1);
  if public.get_product_community(product_id) ? 'dislikes' then raise exception 'Public dislike total exposed';end if;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated','aal','aal2')::text,true);
  select value into result from jsonb_array_elements(public.get_product_performance(30)->'products') where value->>'product_id'=product_id;
  if (result->>'likes')::integer<>1 or (result->>'dislikes')::integer<>1 then raise exception 'Reaction metrics changed';end if;

  -- Defensa en profundidad: tablas privadas sin lectura/escritura directa.
  if has_table_privilege('anon','private.community_user_restrictions','SELECT')
    or has_table_privilege('authenticated','private.community_user_restrictions','SELECT')
    or has_table_privilege('authenticated','private.community_forbidden_terms','INSERT')
    or has_table_privilege('authenticated','private.community_moderation_log','SELECT') then
    raise exception 'Private moderation table exposed';
  end if;
  if has_function_privilege('anon','public.get_admin_community_comments(integer,integer,text,text,text)','EXECUTE') then
    raise exception 'Anonymous admin RPC privilege';
  end if;
  perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','{}',true);perform set_config('role','anon',true);
  perform public.get_product_community(product_id);
  begin perform public.get_admin_community_history();raise exception 'Anon audit read';exception when insufficient_privilege then null;end;
  begin perform public.create_community_comment(product_id,'Anónimo',gen_random_uuid());raise exception 'Anon comment';exception when insufficient_privilege then null;end;
end;
$$;
rollback;

