begin;
do $$
declare a uuid; b uuid; admin_id uuid; pid text:='community-qa-'||gen_random_uuid(); root_id bigint; reply_id bigint; extra_id bigint; out jsonb; stats jsonb; oid uuid; v integer; request uuid:=gen_random_uuid(); cursor_id bigint;
begin
 select id into admin_id from public.profiles where role='admin' limit 1;
 select id into a from public.profiles where role='customer' order by id limit 1;
 select id into b from public.profiles where role='customer' and id<>a order by id limit 1;
 if a is null or b is null or admin_id is null then raise exception 'Need existing customer/customer/admin for rollback fixtures'; end if;
 insert into public.products(id,name,price,stock) values(pid,'Community fixture',100,100),(pid||'-empty','Sin actividad fixture',100,1);
 perform set_config('request.jwt.claim.sub',a::text,true);
 perform set_config('role','authenticated',true);
 root_id:=public.create_community_comment(pid,'Opinión original',request);
 if public.create_community_comment(pid,'Opinión original',request)<>root_id then raise exception 'Comment retry duplicated';end if;
 begin perform public.create_community_comment(pid,'   ',gen_random_uuid());raise exception 'Empty body accepted';exception when others then if sqlerrm='Empty body accepted' then raise;end if;end;
 begin perform public.create_community_comment(pid,E'\n\t\r',gen_random_uuid());raise exception 'Whitespace body accepted';exception when others then if sqlerrm='Whitespace body accepted' then raise;end if;end;
 perform public.edit_community_comment(root_id,'Opinión editada');
 if public.set_product_reaction(pid,1)->>'product_likes'<>'1' then raise exception 'Like'; end if;
 perform public.set_product_reaction(pid,1);
 if public.set_product_reaction(pid,-1)->>'product_likes'<>'0' then raise exception 'Like to dislike'; end if;
 if public.get_product_community(pid) ? 'dislikes' then raise exception 'Public dislikes exposed'; end if;
 perform public.set_product_reaction(pid,1);
 perform public.set_product_reaction(pid,0);
 perform public.set_comment_like(root_id,true);
 perform public.set_comment_like(root_id,true);
 out:=public.get_product_community(pid);
 if (out->'comments'->0->>'likes')::integer<>1 or (out->'comments'->0->>'verified_purchase')::boolean then raise exception 'Like duplicate or false badge'; end if;
 perform public.set_comment_like(root_id,false);
 perform set_config('request.jwt.claim.sub',b::text,true);
 begin perform public.edit_community_comment(root_id,'Spoof');raise exception 'Spoof edit accepted';exception when insufficient_privilege then null;end;
 begin perform public.delete_community_comment(root_id);raise exception 'Spoof delete accepted';exception when insufficient_privilege then null;end;
 reply_id:=public.create_community_comment(pid,'Primera respuesta',gen_random_uuid(),root_id);
 begin perform public.create_community_comment(pid,'Segundo nivel',gen_random_uuid(),reply_id);raise exception 'Nested reply accepted';exception when others then if sqlerrm='Nested reply accepted' then raise;end if;end;
 perform set_config('request.jwt.claim.sub',a::text,true);
 begin perform public.edit_community_comment(root_id,'Contexto cambiado');raise exception 'Edit with replies accepted';exception when others then if sqlerrm='Edit with replies accepted' then raise;end if;end;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 perform public.moderate_community_comment(root_id,'hidden');
 if jsonb_array_length(public.get_product_community(pid)->'comments')<>0 then raise exception 'Hidden root public';end if;
 begin perform public.get_product_community(pid,root_id);raise exception 'Hidden thread endpoint';exception when others then if sqlerrm='Hidden thread endpoint' then raise;end if;end;
 perform public.moderate_community_comment(root_id,'published');
 perform set_config('request.jwt.claim.sub',a::text,true);
 perform public.delete_community_comment(root_id);
 out:=public.get_product_community(pid);
 if out->'comments'->0->>'body' is not null or (out->'comments'->0->>'reply_count')::int<>1 then raise exception 'Deleted thread lost or leaked';end if;
 if jsonb_array_length(public.get_product_community(pid,root_id)->'comments')<>1 then raise exception 'Deleted root lost replies';end if;
 perform set_config('request.jwt.claim.sub',b::text,true);
 out:=public.get_product_community(pid,root_id);
 if (out->'comments'->0->>'verified_purchase')::boolean then raise exception 'No-order badge';end if;
 perform set_config('request.jwt.claim.sub',a::text,true);
 extra_id:=public.create_community_comment(pid,'Compra real verificada',gen_random_uuid());
 perform set_config('role','none',true);
 insert into public.orders(user_id,customer_name,customer_email,status,total,created_at) values(a,'Fixture','fixture@example.invalid','Preparado',100,now()-interval '1 day') returning id into oid;
 insert into public.order_items(order_id,product_id,name,qty,unit_price) values(oid,pid,'Fixture',1,100);
 out:=public.get_product_community(pid);
 if (out->'comments'->0->>'verified_purchase')::boolean then raise exception 'Prepared badge';end if;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 perform public.change_order_status(oid,'Entregado',0);
 out:=public.get_product_community(pid);
 if not (out->'comments'->0->>'verified_purchase')::boolean then raise exception 'Missing delivered badge';end if;
 out:=public.get_product_community(pid,null,null,1);
 if not (out->>'has_more')::boolean or jsonb_array_length(out->'comments')<>1 then raise exception 'Pagination size';end if;
 cursor_id:=(out->>'next_cursor')::bigint;
 out:=public.get_product_community(pid,null,cursor_id,1);
 if jsonb_array_length(out->'comments')<>1 or (out->'comments'->0->>'id')::bigint>=cursor_id then raise exception 'Pagination overlap';end if;
 insert into public.order_items(order_id,product_id,name,qty,unit_price) values(oid,pid,'Otra variante',2,100),(oid,pid||'-empty','Otro producto',1,100);
 insert into public.orders(user_id,customer_name,customer_email,status,total,created_at) values(b,'Fixture','fixture@example.invalid','Cancelado',1000,now()-interval '1 day') returning id into oid;
 insert into public.order_items(order_id,product_id,name,qty,unit_price) values(oid,pid,'Cancelado',10,100);
 insert into public.analytics_events(event_name,product_id,session_id,created_at) values
 ('product_view',pid,'fixture-session',now()-interval '1 day'),('product_view',pid,'fixture-session',now()-interval '1 day'),
 ('product_view',pid,'fixture-session-2',now()-interval '10 days'),('product_view',pid,'fixture-session-3',now()-interval '35 days'),
 ('product_view',pid,'fixture-session-4',now()-interval '95 days'),('add_to_cart',pid,'fixture-session',now()-interval '1 day'),
 ('purchase',pid,'fixture-session',now()-interval '1 day'),('purchase',pid,'fixture-session',now()-interval '1 day');
 perform set_config('request.jwt.claim.sub',a::text,true);perform public.set_product_reaction(pid,-1);
 perform set_config('request.jwt.claim.sub',b::text,true);perform public.set_product_reaction(pid,1);
 begin perform public.get_product_performance(7);raise exception 'Customer analytics';exception when insufficient_privilege then null;end;
 begin perform public.get_community_moderation();raise exception 'Customer moderation';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 stats:=public.get_product_performance(7);
 select value into out from jsonb_array_elements(stats->'products') where value->>'product_id'=pid;
 if (out->>'views')::int<>2 or (out->>'view_sessions')::int<>1 or (out->>'carts')::int<>1 or (out->>'orders')::int<>1
  or (out->>'units')::int<>3 or (out->>'revenue')::numeric<>300 or (out->>'likes')::int<>1 or (out->>'dislikes')::int<>1
  or (out->>'view_to_order')::numeric<>50 or (out->>'positive_ratio')::numeric<>50 then raise exception 'Product metrics %',out;end if;
 for v in select unnest(array[30,90]) loop
  stats:=public.get_product_performance(v);
  select value into out from jsonb_array_elements(stats->'products') where value->>'product_id'=pid;
  if (out->>'views')::int<>(case when v=30 then 3 else 4 end) then raise exception 'Period';end if;
 end loop;
 stats:=public.get_product_performance(null);
 select value into out from jsonb_array_elements(stats->'products') where value->>'product_id'=pid;
 if (out->>'views')::int<>5 then raise exception 'All period';end if;
 select value into out from jsonb_array_elements(stats->'products') where value->>'product_id'=pid||'-empty';
 if out->>'view_to_order' is not null or (out->>'orders')::int<>1 then raise exception 'Zero view ratio/multi product';end if;
 -- Historical guest orders use the actual existing claim RPC; no email is returned.
 insert into public.orders(customer_name,customer_email,status,total,created_at) values('Fixture',(select email from auth.users where id=b),'Entregado',100,now()-interval '100 days') returning id into oid;
 insert into public.order_items(order_id,product_id,name,qty,unit_price) values(oid,pid,'Fixture histórica',1,100);
 perform set_config('request.jwt.claim.sub',b::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',b,'email',(select email from auth.users where id=b),'role','authenticated')::text,true);
 perform public.claim_my_guest_orders();
 out:=public.get_product_community(pid,root_id);
 if not (out->'comments'->0->>'verified_purchase')::boolean then raise exception 'Historical claimed badge';end if;
 if exists(select 1 from jsonb_array_elements(out->'comments') c where c ? 'email' or c ? 'user_id' or c ? 'order_id' or c->'author' ? 'email') then raise exception 'Private identity/order fields';end if;
 perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','{}',true);perform set_config('role','anon',true);
 out:=public.get_product_community(pid);
 if out ? 'dislikes' or out->>'my_reaction'<>'0' or out->>'product_likes'<>'1' then raise exception 'Public aggregate';end if;
 if has_table_privilege('anon','private.product_reactions','SELECT') or has_table_privilege('authenticated','private.product_reactions','SELECT')
  or has_table_privilege('anon','private.community_comments','SELECT') then raise exception 'Private REST readable';end if;
 begin perform public.create_community_comment(pid,'Anon',gen_random_uuid());raise exception 'Anonymous comment';exception when insufficient_privilege then null;end;
 begin perform public.set_product_reaction(pid,-1);raise exception 'Anonymous reaction';exception when insufficient_privilege then null;end;
 perform set_config('role','none',true);
 if private.community_identity('user@example.invalid','javascript:alert(1)')<>jsonb_build_object('name','Cliente de Cúbica','avatar',null) then raise exception 'Email/avatar exposure';end if;
 begin update private.community_comments set user_id=b where id=extra_id;raise exception 'Changed author';exception when others then if sqlerrm='Changed author' then raise;end if;end;
 delete from public.products where id=pid;
end;
$$;
rollback;
