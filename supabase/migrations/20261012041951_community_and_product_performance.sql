-- Community data has no direct Data API access. Public projections omit emails/dislikes.
create table private.community_comments(
 id bigint generated always as identity primary key,
 product_id text not null references public.products(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 parent_id bigint references private.community_comments(id) on delete restrict,
 body text not null check(char_length(btrim(body)) between 1 and 2000),
 status text not null default 'published' check(status in ('published','hidden')),
 created_at timestamptz not null default now(),edited_at timestamptz,deleted_at timestamptz,
 moderated_at timestamptz,moderated_by uuid,
 request_id uuid not null,unique(user_id,request_id)
);
create table private.product_reactions(
 product_id text not null references public.products(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 reaction smallint not null check(reaction in (-1,1)),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 primary key(product_id,user_id)
);
create table private.comment_likes(
 comment_id bigint not null references private.community_comments(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),primary key(comment_id,user_id)
);
create index community_comments_page on private.community_comments(product_id,parent_id,id desc);
create index community_comments_parent on private.community_comments(parent_id);
create index community_comments_author on private.community_comments(user_id,created_at);
create index product_reactions_user on private.product_reactions(user_id);
create index comment_likes_user on private.comment_likes(user_id);
create index order_items_product_order on public.order_items(product_id,order_id);
alter table private.community_comments enable row level security;
alter table private.product_reactions enable row level security;
alter table private.comment_likes enable row level security;
create policy community_private_deny on private.community_comments for all to anon,authenticated using(false) with check(false);
create policy reactions_private_deny on private.product_reactions for all to anon,authenticated using(false) with check(false);
create policy likes_private_deny on private.comment_likes for all to anon,authenticated using(false) with check(false);
revoke all on private.community_comments,private.product_reactions,private.comment_likes from public,anon,authenticated;

create function private.community_reply_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare parent private.community_comments;
begin
 if new.parent_id is not null then
  select * into parent from private.community_comments where id=new.parent_id for update;
  if not found or parent.parent_id is not null or parent.product_id<>new.product_id then raise exception 'Solo se permite responder a un comentario del mismo producto'; end if;
  if tg_op='INSERT' and (parent.deleted_at is not null or parent.status<>'published') then raise exception 'El comentario no admite nuevas respuestas'; end if;
 end if;
 return new;
end;
$$;
create trigger community_reply_guard before insert or update of parent_id,product_id on private.community_comments for each row execute function private.community_reply_guard();

create function private.community_comment_visible(p_id bigint) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.community_comments c where c.id=p_id and c.status='published' and c.deleted_at is null
 and (c.parent_id is null or exists(select 1 from private.community_comments p where p.id=c.parent_id and p.status='published'))
 and exists(select 1 from public.products p where p.id=c.product_id and p.active));
$$;

create function private.community_identity(p_name text,p_avatar text) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('name',case when nullif(btrim(p_name),'') is null or p_name like '%@%' then 'Cliente de Cúbica' else left(p_name,80) end,
 'avatar',case when p_avatar ~ '^https://(lh[0-9]+\.googleusercontent\.com/|mymrbpwvghxmqqpzzdqk\.supabase\.co/storage/v1/object/public/)'
 and p_avatar not like '%@%' and lower(p_avatar) not like '%\%40%' then p_avatar end);
$$;

create function private.get_product_community(p_product_id text,p_parent_id bigint default null,p_before_id bigint default null,p_limit integer default 10)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare lim integer:=greatest(1,least(coalesce(p_limit,10),20)); result jsonb;
begin
 if not exists(select 1 from public.products where id=p_product_id and active) then raise exception 'Producto no disponible'; end if;
 if p_parent_id is not null and not exists(select 1 from private.community_comments where id=p_parent_id and product_id=p_product_id and parent_id is null and status='published') then raise exception 'Comentario no disponible'; end if;
 with selected as (
  select c.* from private.community_comments c where c.product_id=p_product_id and c.parent_id is not distinct from p_parent_id
   and c.status='published' and (c.deleted_at is null or (c.parent_id is null and exists(select 1 from private.community_comments r where r.parent_id=c.id and r.status='published' and r.deleted_at is null)))
   and (p_before_id is null or c.id<p_before_id) order by c.id desc limit lim+1
 ), page as (select * from selected order by id desc limit lim),
 likes as (select l.comment_id,count(*) n,bool_or(l.user_id=auth.uid()) mine from private.comment_likes l join page c on c.id=l.comment_id group by l.comment_id),
 replies as (select c.parent_id,count(*) n from private.community_comments c join page p on p.id=c.parent_id where c.status='published' and c.deleted_at is null group by c.parent_id),
 verified as (select distinct o.user_id from public.orders o join public.order_items i on i.order_id=o.id where o.status='Entregado' and i.product_id=p_product_id and o.user_id in(select user_id from page))
 select jsonb_build_object('comments',coalesce(jsonb_agg(jsonb_build_object('id',c.id,'parent_id',c.parent_id,
   'body',case when c.deleted_at is null then c.body end,'deleted',c.deleted_at is not null,'created_at',c.created_at,'edited_at',c.edited_at,
   'author',case when c.deleted_at is null then private.community_identity(p.display_name,coalesce(u.raw_user_meta_data->>'avatar_url',u.raw_user_meta_data->>'picture')) end,
   'is_owner',c.deleted_at is null and c.user_id=auth.uid(),'verified_purchase',c.deleted_at is null and v.user_id is not null,
   'likes',case when c.deleted_at is null then coalesce(l.n,0) else 0 end,'my_like',c.deleted_at is null and coalesce(l.mine,false),
   'reply_count',coalesce(r.n,0),'can_edit',c.deleted_at is null and c.user_id=auth.uid() and not exists(select 1 from private.community_comments child where child.parent_id=c.id)
  ) order by c.id desc),'[]'::jsonb),'has_more',(select count(*)>lim from selected),'next_cursor',(select min(id) from page))
 into result from page c left join public.profiles p on p.id=c.user_id left join auth.users u on u.id=c.user_id
 left join likes l on l.comment_id=c.id left join replies r on r.parent_id=c.id left join verified v on v.user_id=c.user_id;
 return result||jsonb_build_object('product_likes',(select count(*) from private.product_reactions where product_id=p_product_id and reaction=1),
  'my_reaction',coalesce((select reaction from private.product_reactions where product_id=p_product_id and user_id=auth.uid()),0));
end;
$$;

create function private.set_product_reaction(p_product_id text,p_reaction integer) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Iniciá sesión' using errcode='42501'; end if;
 if p_reaction is null or p_reaction not in (-1,0,1) then raise exception 'Reacción inválida'; end if;
 if not exists(select 1 from public.products where id=p_product_id and active) then raise exception 'Producto no disponible'; end if;
 if p_reaction=0 then delete from private.product_reactions where product_id=p_product_id and user_id=auth.uid();
 else insert into private.product_reactions(product_id,user_id,reaction) values(p_product_id,auth.uid(),p_reaction)
  on conflict(product_id,user_id) do update set reaction=excluded.reaction,updated_at=case when private.product_reactions.reaction<>excluded.reaction then now() else private.product_reactions.updated_at end; end if;
 return jsonb_build_object('product_likes',(select count(*) from private.product_reactions where product_id=p_product_id and reaction=1),'my_reaction',p_reaction);
end;
$$;

create function private.create_community_comment(p_product_id text,p_body text,p_request_id uuid,p_parent_id bigint default null)
returns bigint language plpgsql security definer set search_path='' as $$
declare existing private.community_comments; new_id bigint;
begin
 if auth.uid() is null then raise exception 'Iniciá sesión' using errcode='42501'; end if;
 if p_request_id is null or char_length(btrim(coalesce(p_body,''))) not between 1 and 2000 then raise exception 'Escribí entre 1 y 2000 caracteres'; end if;
 if not exists(select 1 from public.products where id=p_product_id and active) then raise exception 'Producto no disponible'; end if;
 insert into private.community_comments(product_id,user_id,parent_id,body,request_id) values(p_product_id,auth.uid(),p_parent_id,btrim(p_body),p_request_id)
 on conflict(user_id,request_id) do nothing returning id into new_id;
 if new_id is null then
  select * into existing from private.community_comments where user_id=auth.uid() and request_id=p_request_id;
  if existing.product_id<>p_product_id or existing.parent_id is distinct from p_parent_id then raise exception 'Referencia de comentario inválida'; end if;
  new_id:=existing.id;
 end if;
 return new_id;
end;
$$;

create function private.edit_community_comment(p_comment_id bigint,p_body text) returns void language plpgsql security definer set search_path='' as $$
declare c private.community_comments;
begin
 if auth.uid() is null then raise exception 'Iniciá sesión' using errcode='42501'; end if;
 select * into c from private.community_comments where id=p_comment_id for update;
 if not found or c.user_id<>auth.uid() then raise exception 'Solo podés editar tus comentarios' using errcode='42501'; end if;
 if c.deleted_at is not null or exists(select 1 from private.community_comments where parent_id=c.id) then raise exception 'El comentario ya tiene respuestas o fue eliminado'; end if;
 if char_length(btrim(coalesce(p_body,''))) not between 1 and 2000 then raise exception 'Escribí entre 1 y 2000 caracteres'; end if;
 update private.community_comments set body=btrim(p_body),edited_at=case when body<>btrim(p_body) then now() else edited_at end where id=c.id;
end;
$$;
create function private.delete_community_comment(p_comment_id bigint) returns void language plpgsql security definer set search_path='' as $$
declare c private.community_comments;
begin
 if auth.uid() is null then raise exception 'Iniciá sesión' using errcode='42501'; end if;
 select * into c from private.community_comments where id=p_comment_id for update;
 if not found or (c.user_id<>auth.uid() and not private.is_admin()) then raise exception 'Solo podés eliminar tus comentarios' using errcode='42501'; end if;
 update private.community_comments set deleted_at=coalesce(deleted_at,now()) where id=c.id;
end;
$$;
create function private.set_comment_like(p_comment_id bigint,p_liked boolean) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Iniciá sesión' using errcode='42501'; end if;
 if p_liked is null or not private.community_comment_visible(p_comment_id) then raise exception 'Comentario no disponible'; end if;
 if p_liked then insert into private.comment_likes(comment_id,user_id) values(p_comment_id,auth.uid()) on conflict do nothing;
 else delete from private.comment_likes where comment_id=p_comment_id and user_id=auth.uid(); end if;
 return jsonb_build_object('likes',(select count(*) from private.comment_likes where comment_id=p_comment_id),'my_like',p_liked);
end;
$$;
create function private.moderate_community_comment(p_comment_id bigint,p_status text) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
 if p_status is null or p_status not in ('published','hidden') then raise exception 'Estado inválido'; end if;
 update private.community_comments set status=p_status,moderated_at=now(),moderated_by=auth.uid() where id=p_comment_id;
 if not found then raise exception 'Comentario inexistente'; end if;
end;
$$;
create function private.get_community_moderation(p_before_id bigint default null,p_limit integer default 20) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare lim integer:=greatest(1,least(coalesce(p_limit,20),50)); result jsonb;
begin
 if auth.uid() is null or not private.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
 with selected as(select * from private.community_comments where p_before_id is null or id<p_before_id order by id desc limit lim+1),page as(select * from selected order by id desc limit lim)
 select jsonb_build_object('comments',coalesce(jsonb_agg(jsonb_build_object('id',c.id,'product_id',c.product_id,'product_name',pr.name,'parent_id',c.parent_id,
 'body',c.body,'status',c.status,'deleted_at',c.deleted_at,'created_at',c.created_at,'edited_at',c.edited_at,
 'author',private.community_identity(p.display_name,coalesce(u.raw_user_meta_data->>'avatar_url',u.raw_user_meta_data->>'picture'))) order by c.id desc),'[]'::jsonb),
 'has_more',(select count(*)>lim from selected),'next_cursor',(select min(id) from page)) into result from page c join public.products pr on pr.id=c.product_id
 left join public.profiles p on p.id=c.user_id left join auth.users u on u.id=c.user_id;
 return result;
end;
$$;

create function private.get_product_performance(p_days integer default 30) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare start_at timestamptz; result jsonb;
begin
 if auth.uid() is null or not private.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
 if p_days is not null and p_days not in (7,30,90) then raise exception 'Período inválido'; end if;
 -- Match dashboard calendar days in Argentina, ending at now().
 start_at:=case when p_days is not null then (date_trunc('day',now() at time zone 'America/Argentina/Buenos_Aires')-make_interval(days=>p_days-1)) at time zone 'America/Argentina/Buenos_Aires' end;
 with events as(select product_id,count(*) filter(where event_name='product_view') views,
  count(distinct nullif(session_id,'')) filter(where event_name='product_view') sessions,
  count(*) filter(where event_name='add_to_cart') carts
  from public.analytics_events where (start_at is null or created_at>=start_at) and created_at<=now()
    and event_name in ('product_view','add_to_cart') group by product_id),
 sales as(select i.product_id,count(distinct o.id) orders,sum(i.qty) units,sum(i.line_total) revenue
  from public.orders o join public.order_items i on i.order_id=o.id where o.status<>'Cancelado' and (start_at is null or o.created_at>=start_at) and o.created_at<=now() group by i.product_id),
 reactions as(select product_id,count(*) filter(where reaction=1) likes,count(*) filter(where reaction=-1) dislikes from private.product_reactions group by product_id),
 comments as(select c.product_id,count(*) n from private.community_comments c where c.status='published' and c.deleted_at is null
  and (c.parent_id is null or exists(select 1 from private.community_comments p where p.id=c.parent_id and p.status='published')) group by c.product_id)
 select coalesce(jsonb_agg(jsonb_build_object('product_id',p.id,'name',p.name,'active',p.active,'views',coalesce(e.views,0),'view_sessions',coalesce(e.sessions,0),
  'likes',coalesce(r.likes,0),'dislikes',coalesce(r.dislikes,0),'comments',coalesce(c.n,0),'carts',coalesce(e.carts,0),
  'orders',coalesce(s.orders,0),'units',coalesce(s.units,0),'revenue',coalesce(s.revenue,0),
  'view_to_cart',case when e.views>0 then coalesce(e.carts,0)*100.0/e.views end,
  'view_to_order',case when e.views>0 then coalesce(s.orders,0)*100.0/e.views end,
  'positive_ratio',case when r.likes+r.dislikes>0 then r.likes*100.0/(r.likes+r.dislikes) end) order by p.sort_order,p.name),'[]'::jsonb)
 into result from public.products p left join events e on e.product_id=p.id left join sales s on s.product_id=p.id left join reactions r on r.product_id=p.id left join comments c on c.product_id=p.id;
 return jsonb_build_object('products',result,'period_start',start_at,'period_end',now(),'community_scope','current');
end;
$$;

-- Expose only named RPC wrappers. Private tables never get caller privileges.
grant usage on schema private to anon,authenticated;
revoke all on function private.community_reply_guard(),private.community_comment_visible(bigint),private.community_identity(text,text) from public,anon,authenticated;
do $$
declare sig text; name text; args text; call_args text; ret text; defaults text;
begin
 for name,args,call_args,ret,defaults in values
  ('get_product_community','p_product_id text,p_parent_id bigint,p_before_id bigint,p_limit integer','p_product_id,p_parent_id,p_before_id,p_limit','jsonb','p_product_id text,p_parent_id bigint default null,p_before_id bigint default null,p_limit integer default 10'),
  ('set_product_reaction','p_product_id text,p_reaction integer','p_product_id,p_reaction','jsonb',null),
  ('create_community_comment','p_product_id text,p_body text,p_request_id uuid,p_parent_id bigint','p_product_id,p_body,p_request_id,p_parent_id','bigint','p_product_id text,p_body text,p_request_id uuid,p_parent_id bigint default null'),
  ('edit_community_comment','p_comment_id bigint,p_body text','p_comment_id,p_body','void',null),
  ('delete_community_comment','p_comment_id bigint','p_comment_id','void',null),
  ('set_comment_like','p_comment_id bigint,p_liked boolean','p_comment_id,p_liked','jsonb',null),
  ('moderate_community_comment','p_comment_id bigint,p_status text','p_comment_id,p_status','void',null),
  ('get_community_moderation','p_before_id bigint,p_limit integer','p_before_id,p_limit','jsonb','p_before_id bigint default null,p_limit integer default 20'),
  ('get_product_performance','p_days integer','p_days','jsonb','p_days integer default 30')
 loop
  execute format('create function public.%I(%s) returns %s language sql security invoker set search_path='''' as %L',name,coalesce(defaults,args),ret,'select private.'||name||'('||call_args||');');
  sig:=(select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname=name);
  execute 'revoke all on function '||sig||' from public,anon,authenticated';
  execute 'grant execute on function '||sig||' to authenticated';
  sig:=(select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=name);
  execute 'revoke all on function '||sig||' from public,anon';
  execute 'grant execute on function '||sig||' to authenticated';
 end loop;
end;
$$;
grant execute on function private.get_product_community(text,bigint,bigint,integer),public.get_product_community(text,bigint,bigint,integer) to anon;
