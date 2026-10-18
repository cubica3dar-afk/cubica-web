-- Etapa B: moderación avanzada, bloqueos acotados a Comunidad y reglas de contenido.
-- Las tablas permanecen en private; el Data API solo expone RPC con proyecciones mínimas.

alter table private.community_comments
  add column if not exists deletion_kind text,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null,
  add column if not exists deletion_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'private.community_comments'::regclass
      and conname = 'community_comments_deletion_kind_check'
  ) then
    alter table private.community_comments
      add constraint community_comments_deletion_kind_check
      check (deletion_kind is null or deletion_kind in ('user','admin'));
  end if;
end;
$$;

create table if not exists private.community_user_restrictions(
  user_id uuid primary key references auth.users(id) on delete cascade,
  is_blocked boolean not null default true,
  reason text not null check(char_length(btrim(reason)) between 3 and 500),
  blocked_at timestamptz,
  blocked_by uuid references auth.users(id) on delete set null,
  unblocked_at timestamptz,
  unblocked_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table if not exists private.community_forbidden_terms(
  id bigint generated always as identity primary key,
  expression text not null check(char_length(btrim(expression)) between 2 and 120),
  normalized_expression text not null check(char_length(normalized_expression) between 2 and 120),
  whole_word boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  unique(normalized_expression,whole_word)
);

create table if not exists private.community_settings(
  singleton boolean primary key default true check(singleton),
  block_links boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into private.community_settings(singleton,block_links)
values(true,true) on conflict(singleton) do nothing;

create table if not exists private.community_moderation_log(
  id bigint generated always as identity primary key,
  action text not null check(action in (
    'comment_hidden','comment_restored','comment_deleted',
    'user_blocked','user_unblocked',
    'term_created','term_updated','term_enabled','term_disabled','term_deleted',
    'links_enabled','links_disabled'
  )),
  comment_id bigint references private.community_comments(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  term_id bigint references private.community_forbidden_terms(id) on delete set null,
  product_id text references public.products(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  reason text,
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists community_comments_admin_created
  on private.community_comments(created_at desc,id desc);
create index if not exists community_comments_admin_status
  on private.community_comments(status,deletion_kind,deleted_at,id desc);
create index if not exists community_user_restrictions_state
  on private.community_user_restrictions(is_blocked,updated_at desc);
create index if not exists community_forbidden_terms_state
  on private.community_forbidden_terms(active,updated_at desc);
create index if not exists community_moderation_log_page
  on private.community_moderation_log(created_at desc,id desc);
create index if not exists community_moderation_log_user
  on private.community_moderation_log(user_id,created_at desc) where user_id is not null;
create index if not exists community_moderation_log_comment
  on private.community_moderation_log(comment_id,created_at desc) where comment_id is not null;

alter table private.community_user_restrictions enable row level security;
alter table private.community_forbidden_terms enable row level security;
alter table private.community_settings enable row level security;
alter table private.community_moderation_log enable row level security;

drop policy if exists community_user_restrictions_deny on private.community_user_restrictions;
create policy community_user_restrictions_deny on private.community_user_restrictions
for all to anon,authenticated using(false) with check(false);
drop policy if exists community_forbidden_terms_deny on private.community_forbidden_terms;
create policy community_forbidden_terms_deny on private.community_forbidden_terms
for all to anon,authenticated using(false) with check(false);
drop policy if exists community_settings_deny on private.community_settings;
create policy community_settings_deny on private.community_settings
for all to anon,authenticated using(false) with check(false);
drop policy if exists community_moderation_log_deny on private.community_moderation_log;
create policy community_moderation_log_deny on private.community_moderation_log
for all to anon,authenticated using(false) with check(false);

revoke all on private.community_user_restrictions,private.community_forbidden_terms,
  private.community_settings,private.community_moderation_log from public,anon,authenticated;

create or replace function private.community_normalize_text(p_text text)
returns text language sql immutable set search_path='' as $$
  select btrim(regexp_replace(
    translate(
      lower(normalize(coalesce(p_text,''),NFKC)),
      'áàäâãåéèëêíìïîóòöôõúùüûñç@43015$!',
      'aaaaaaeeeeiiiiooooouuuuncaaeoissi'
    ),
    '[^[:alnum:]]+',' ','g'
  ));
$$;

create or replace function private.community_contains_link(p_text text)
returns boolean language sql immutable set search_path='' as $$
  select lower(normalize(coalesce(p_text,''),NFKC)) ~
    '(^|[^[:alnum:]_])((https?|hxxps?)://|www[.]|[[:alnum:]][[:alnum:]-]{0,62}[.][[:alpha:]]{2,24}([/:?#]|$))'
    or lower(coalesce(p_text,'')) ~ '(href|src)[[:space:]]*=';
$$;

create or replace function private.community_participation_blocked(p_user_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from private.community_user_restrictions r
    where r.user_id=p_user_id and r.is_blocked
  );
$$;

create or replace function private.assert_community_participation_allowed()
returns void language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null then
    raise exception 'Iniciá sesión' using errcode='42501';
  end if;
  if private.community_participation_blocked(auth.uid()) then
    raise exception 'Tu participación en Comunidad está restringida' using errcode='42501';
  end if;
end;
$$;

create or replace function private.validate_community_body(p_body text)
returns text language plpgsql stable security definer set search_path='' as $$
declare
  v_body text:=btrim(coalesce(p_body,''));
  v_normalized text;
  v_term private.community_forbidden_terms;
begin
  if char_length(v_body) not between 1 and 2000 or v_body !~ '[^[:space:]]' then
    raise exception 'Escribí entre 1 y 2000 caracteres';
  end if;
  if coalesce((select s.block_links from private.community_settings s where s.singleton),true)
    and private.community_contains_link(v_body) then
    raise exception 'No se permiten enlaces en Comunidad' using errcode='22023';
  end if;
  v_normalized:=private.community_normalize_text(v_body);
  for v_term in
    select * from private.community_forbidden_terms t where t.active order by t.id
  loop
    if (v_term.whole_word and position(' '||v_term.normalized_expression||' ' in ' '||v_normalized||' ')>0)
      or (not v_term.whole_word and position(v_term.normalized_expression in v_normalized)>0) then
      raise exception 'El contenido incluye una expresión no permitida' using errcode='22023';
    end if;
  end loop;
  return v_body;
end;
$$;

-- Todas las escrituras públicas pasan por la restricción y la validación del backend.
create or replace function private.create_community_comment(
  p_product_id text,p_body text,p_request_id uuid,p_parent_id bigint default null
) returns bigint language plpgsql security definer set search_path='' as $$
declare existing private.community_comments; new_id bigint; v_body text;
begin
  perform private.assert_community_participation_allowed();
  if p_request_id is null then raise exception 'Referencia de comentario inválida'; end if;
  v_body:=private.validate_community_body(p_body);
  if not exists(select 1 from public.products where id=p_product_id and active and published) then
    raise exception 'Producto no disponible';
  end if;
  insert into private.community_comments(product_id,user_id,parent_id,body,request_id)
  values(p_product_id,auth.uid(),p_parent_id,v_body,p_request_id)
  on conflict(user_id,request_id) do nothing returning id into new_id;
  if new_id is null then
    select * into existing from private.community_comments
    where user_id=auth.uid() and request_id=p_request_id;
    if existing.product_id<>p_product_id or existing.parent_id is distinct from p_parent_id then
      raise exception 'Referencia de comentario inválida';
    end if;
    new_id:=existing.id;
  end if;
  return new_id;
end;
$$;

create or replace function private.edit_community_comment(p_comment_id bigint,p_body text)
returns void language plpgsql security definer set search_path='' as $$
declare c private.community_comments; v_body text;
begin
  perform private.assert_community_participation_allowed();
  select * into c from private.community_comments where id=p_comment_id for update;
  if not found or c.user_id<>auth.uid() then
    raise exception 'Solo podés editar tus comentarios' using errcode='42501';
  end if;
  if c.status<>'published' or c.deleted_at is not null
    or exists(select 1 from private.community_comments where parent_id=c.id) then
    raise exception 'El comentario ya tiene respuestas, fue moderado o fue eliminado';
  end if;
  v_body:=private.validate_community_body(p_body);
  update private.community_comments
  set body=v_body,edited_at=case when body<>v_body then now() else edited_at end
  where id=c.id;
end;
$$;

create or replace function private.delete_community_comment(p_comment_id bigint)
returns void language plpgsql security definer set search_path='' as $$
declare c private.community_comments;
begin
  if auth.uid() is null then raise exception 'Iniciá sesión' using errcode='42501'; end if;
  select * into c from private.community_comments where id=p_comment_id for update;
  if not found or c.user_id<>auth.uid() then
    raise exception 'Solo podés eliminar tus comentarios' using errcode='42501';
  end if;
  if c.deletion_kind='admin' then
    raise exception 'El contenido fue retirado por moderación' using errcode='42501';
  end if;
  update private.community_comments
  set deleted_at=coalesce(deleted_at,now()),
      deletion_kind=coalesce(deletion_kind,'user'),
      deleted_by=coalesce(deleted_by,auth.uid())
  where id=c.id;
end;
$$;

create or replace function private.set_product_reaction(p_product_id text,p_reaction integer)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_community_participation_allowed();
  if p_reaction is null or p_reaction not in (-1,0,1) then raise exception 'Reacción inválida'; end if;
  if not exists(select 1 from public.products where id=p_product_id and active and published) then raise exception 'Producto no disponible'; end if;
  if p_reaction=0 then
    delete from private.product_reactions where product_id=p_product_id and user_id=auth.uid();
  else
    insert into private.product_reactions(product_id,user_id,reaction)
    values(p_product_id,auth.uid(),p_reaction)
    on conflict(product_id,user_id) do update
    set reaction=excluded.reaction,
        updated_at=case when private.product_reactions.reaction<>excluded.reaction then now() else private.product_reactions.updated_at end;
  end if;
  return jsonb_build_object(
    'product_likes',(select count(*) from private.product_reactions where product_id=p_product_id and reaction=1),
    'my_reaction',p_reaction
  );
end;
$$;

create or replace function private.set_comment_like(p_comment_id bigint,p_liked boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_community_participation_allowed();
  if p_liked is null or not private.community_comment_visible(p_comment_id) then raise exception 'Comentario no disponible'; end if;
  if p_liked then
    insert into private.comment_likes(comment_id,user_id) values(p_comment_id,auth.uid()) on conflict do nothing;
  else
    delete from private.comment_likes where comment_id=p_comment_id and user_id=auth.uid();
  end if;
  return jsonb_build_object(
    'likes',(select count(*) from private.comment_likes where comment_id=p_comment_id),
    'my_like',p_liked
  );
end;
$$;

create or replace function private.community_comment_visible(p_id bigint)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from private.community_comments c
    where c.id=p_id and c.status='published' and c.deleted_at is null
      and coalesce(c.deletion_kind,'')<>'admin'
      and (c.parent_id is null or exists(
        select 1 from private.community_comments p
        where p.id=c.parent_id and p.status='published' and coalesce(p.deletion_kind,'')<>'admin'
      ))
      and exists(select 1 from public.products p where p.id=c.product_id and p.active and p.published)
  );
$$;

create or replace function private.get_product_community(
  p_product_id text,p_parent_id bigint default null,p_before_id bigint default null,p_limit integer default 10
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare lim integer:=greatest(1,least(coalesce(p_limit,10),20)); result jsonb; restricted boolean:=false;
begin
  if not exists(select 1 from public.products where id=p_product_id and active and published) then raise exception 'Producto no disponible'; end if;
  if p_parent_id is not null and not exists(
    select 1 from private.community_comments
    where id=p_parent_id and product_id=p_product_id and parent_id is null
      and status='published' and coalesce(deletion_kind,'')<>'admin'
  ) then raise exception 'Comentario no disponible'; end if;
  if auth.uid() is not null then restricted:=private.community_participation_blocked(auth.uid()); end if;
  with selected as (
    select c.* from private.community_comments c
    where c.product_id=p_product_id and c.parent_id is not distinct from p_parent_id
      and c.status='published' and coalesce(c.deletion_kind,'')<>'admin'
      and (c.deleted_at is null or (
        c.parent_id is null and exists(
          select 1 from private.community_comments r
          where r.parent_id=c.id and r.status='published' and r.deleted_at is null
            and coalesce(r.deletion_kind,'')<>'admin'
        )
      ))
      and (p_before_id is null or c.id<p_before_id)
    order by c.id desc limit lim+1
  ), page as(select * from selected order by id desc limit lim),
  likes as(
    select l.comment_id,count(*) n,bool_or(l.user_id=auth.uid()) mine
    from private.comment_likes l join page c on c.id=l.comment_id group by l.comment_id
  ), replies as(
    select c.parent_id,count(*) n from private.community_comments c join page p on p.id=c.parent_id
    where c.status='published' and c.deleted_at is null and coalesce(c.deletion_kind,'')<>'admin'
    group by c.parent_id
  ), verified as(
    select distinct o.user_id from public.orders o join public.order_items i on i.order_id=o.id
    where o.origin='store' and o.status='Entregado' and i.product_id=p_product_id
      and o.user_id in(select user_id from page)
  )
  select jsonb_build_object(
    'comments',coalesce(jsonb_agg(jsonb_build_object(
      'id',c.id,'parent_id',c.parent_id,
      'body',case when c.deleted_at is null then c.body end,
      'deleted',c.deleted_at is not null,'created_at',c.created_at,'edited_at',c.edited_at,
      'author',case when c.deleted_at is null then private.community_identity(p.display_name,coalesce(u.raw_user_meta_data->>'avatar_url',u.raw_user_meta_data->>'picture')) end,
      'is_owner',c.deleted_at is null and c.user_id=auth.uid(),
      'verified_purchase',c.deleted_at is null and v.user_id is not null,
      'likes',case when c.deleted_at is null then coalesce(l.n,0) else 0 end,
      'my_like',c.deleted_at is null and coalesce(l.mine,false),
      'reply_count',coalesce(r.n,0),
      'can_edit',not restricted and c.deleted_at is null and c.status='published'
        and c.user_id=auth.uid() and not exists(select 1 from private.community_comments child where child.parent_id=c.id)
    ) order by c.id desc),'[]'::jsonb),
    'has_more',(select count(*)>lim from selected),
    'next_cursor',(select min(id) from page)
  ) into result
  from page c
  left join public.profiles p on p.id=c.user_id
  left join auth.users u on u.id=c.user_id
  left join likes l on l.comment_id=c.id
  left join replies r on r.parent_id=c.id
  left join verified v on v.user_id=c.user_id;
  return result||jsonb_build_object(
    'product_likes',(select count(*) from private.product_reactions where product_id=p_product_id and reaction=1),
    'my_reaction',coalesce((select reaction from private.product_reactions where product_id=p_product_id and user_id=auth.uid()),0),
    'participation_restricted',restricted
  );
end;
$$;

-- Conserva las definiciones comerciales existentes y cuenta solo contenido
-- realmente visible. Una respuesta cuyo comentario padre fue moderado no debe
-- permanecer en el total administrativo aunque su fila se preserve.
create or replace function private.get_product_performance(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare start_at timestamptz; result jsonb;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Solo administradores' using errcode='42501'; end if;
  if p_days is not null and p_days not in (7,30,90) then raise exception 'Período inválido'; end if;
  start_at:=case when p_days is not null then
    (date_trunc('day',now() at time zone 'America/Argentina/Buenos_Aires')-make_interval(days=>p_days-1))
      at time zone 'America/Argentina/Buenos_Aires' end;
  with events as(
    select product_id,
      count(*) filter(where event_name='product_view') views,
      count(distinct nullif(session_id,'')) filter(where event_name='product_view') sessions,
      count(*) filter(where event_name='add_to_cart') carts
    from public.analytics_events
    where (start_at is null or created_at>=start_at) and created_at<=now()
      and event_name in ('product_view','add_to_cart') group by product_id
  ), sales as(
    select i.product_id,count(distinct o.id) orders,sum(i.qty) units,sum(i.line_total) revenue
    from public.orders o join public.order_items i on i.order_id=o.id
    where o.origin='store' and o.status<>'Cancelado'
      and (start_at is null or o.created_at>=start_at) and o.created_at<=now()
    group by i.product_id
  ), reactions as(
    select product_id,count(*) filter(where reaction=1) likes,
      count(*) filter(where reaction=-1) dislikes
    from private.product_reactions group by product_id
  ), comments as(
    select c.product_id,count(*) n from private.community_comments c
    where private.community_comment_visible(c.id) group by c.product_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id',p.id,'name',p.name,'active',p.active,
    'views',coalesce(e.views,0),'view_sessions',coalesce(e.sessions,0),
    'likes',coalesce(r.likes,0),'dislikes',coalesce(r.dislikes,0),
    'comments',coalesce(c.n,0),'carts',coalesce(e.carts,0),
    'orders',coalesce(s.orders,0),'units',coalesce(s.units,0),'revenue',coalesce(s.revenue,0),
    'view_to_cart',case when e.views>0 then coalesce(e.carts,0)*100.0/e.views end,
    'view_to_order',case when e.views>0 then coalesce(s.orders,0)*100.0/e.views end,
    'positive_ratio',case when r.likes+r.dislikes>0 then r.likes*100.0/(r.likes+r.dislikes) end
  ) order by p.sort_order,p.name),'[]'::jsonb) into result
  from public.products p
  left join events e on e.product_id=p.id left join sales s on s.product_id=p.id
  left join reactions r on r.product_id=p.id left join comments c on c.product_id=p.id;
  return jsonb_build_object('products',result,'period_start',start_at,'period_end',now(),'community_scope','current');
end;
$$;

create or replace function private.get_admin_community_comments(
  p_page integer default 1,p_page_size integer default 25,p_search text default null,
  p_status text default 'all',p_sort text default 'recent'
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_page integer:=greatest(coalesce(p_page,1),1); v_size integer; v_search text:=btrim(coalesce(p_search,''));
  v_status text:=lower(coalesce(p_status,'all')); v_sort text:=lower(coalesce(p_sort,'recent')); v_total bigint; v_items jsonb;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Solo administradores con MFA' using errcode='42501'; end if;
  v_size:=case when p_page_size in(10,25,50) then p_page_size else 25 end;
  if v_status not in('all','published','hidden','deleted_admin','deleted_user') then raise exception 'Filtro inválido'; end if;
  if v_sort not in('recent','oldest') then raise exception 'Orden inválido'; end if;
  with filtered as(
    select c.id from private.community_comments c join public.products pr on pr.id=c.product_id
    left join public.profiles p on p.id=c.user_id
    where (v_search='' or c.body ilike '%'||v_search||'%' or pr.name ilike '%'||v_search||'%'
      or coalesce(p.display_name,'') ilike '%'||v_search||'%' or c.user_id::text ilike '%'||v_search||'%')
      and (v_status='all'
        or (v_status='published' and c.status='published' and c.deleted_at is null)
        or (v_status='hidden' and c.status='hidden' and c.deleted_at is null)
        or (v_status='deleted_admin' and c.deleted_at is not null and c.deletion_kind='admin')
        or (v_status='deleted_user' and c.deleted_at is not null and coalesce(c.deletion_kind,'user')='user'))
  ) select count(*) into v_total from filtered;
  with filtered as(
    select c.*,pr.name product_name,p.display_name,
      coalesce(r.is_blocked,false) author_blocked
    from private.community_comments c join public.products pr on pr.id=c.product_id
    left join public.profiles p on p.id=c.user_id
    left join private.community_user_restrictions r on r.user_id=c.user_id
    where (v_search='' or c.body ilike '%'||v_search||'%' or pr.name ilike '%'||v_search||'%'
      or coalesce(p.display_name,'') ilike '%'||v_search||'%' or c.user_id::text ilike '%'||v_search||'%')
      and (v_status='all'
        or (v_status='published' and c.status='published' and c.deleted_at is null)
        or (v_status='hidden' and c.status='hidden' and c.deleted_at is null)
        or (v_status='deleted_admin' and c.deleted_at is not null and c.deletion_kind='admin')
        or (v_status='deleted_user' and c.deleted_at is not null and coalesce(c.deletion_kind,'user')='user'))
  ), page as(
    select * from filtered
    order by case when v_sort='oldest' then created_at end asc,
      case when v_sort='recent' then created_at end desc,
      case when v_sort='oldest' then id end asc,id desc
    offset (v_page-1)*v_size limit v_size
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'product_id',product_id,'product_name',product_name,'parent_id',parent_id,
    'body',body,'status',status,'created_at',created_at,'edited_at',edited_at,
    'deleted_at',deleted_at,'deletion_kind',deletion_kind,'deletion_reason',deletion_reason,
    'user_id',user_id,'author_name',case when nullif(btrim(display_name),'') is null or display_name like '%@%' then 'Cliente de Cúbica' else left(display_name,80) end,
    'author_blocked',author_blocked
  ) order by case when v_sort='oldest' then created_at end asc,
    case when v_sort='recent' then created_at end desc,id desc),'[]'::jsonb)
  into v_items from page;
  return jsonb_build_object('items',v_items,'total',v_total,'page',v_page,'page_size',v_size,
    'total_pages',case when v_total=0 then 0 else ceil(v_total::numeric/v_size)::integer end);
end;
$$;

create or replace function private.admin_moderate_community_comment(
  p_comment_id bigint,p_action text,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.community_comments; v_action text:=lower(btrim(coalesce(p_action,'')));
  v_reason text:=btrim(coalesce(p_reason,'')); v_before jsonb; v_after jsonb;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Solo administradores con MFA' using errcode='42501'; end if;
  if v_action not in('hide','restore','delete') then raise exception 'Acción inválida'; end if;
  if char_length(v_reason) not between 3 and 500 then raise exception 'Indicá un motivo de 3 a 500 caracteres'; end if;
  select * into c from private.community_comments where id=p_comment_id for update;
  if not found then raise exception 'Comentario inexistente'; end if;
  v_before:=jsonb_build_object('status',c.status,'deleted_at',c.deleted_at,'deletion_kind',c.deletion_kind);
  if v_action='hide' then
    if c.deleted_at is not null then raise exception 'El comentario ya fue eliminado'; end if;
    if c.status='hidden' then return jsonb_build_object('changed',false,'id',c.id); end if;
    update private.community_comments set status='hidden',moderated_at=now(),moderated_by=auth.uid() where id=c.id;
  elsif v_action='restore' then
    if c.deleted_at is not null then raise exception 'Un comentario eliminado no puede restaurarse'; end if;
    if c.status='published' then return jsonb_build_object('changed',false,'id',c.id); end if;
    update private.community_comments set status='published',moderated_at=now(),moderated_by=auth.uid() where id=c.id;
  else
    if c.deletion_kind='admin' then return jsonb_build_object('changed',false,'id',c.id); end if;
    update private.community_comments set status='hidden',deleted_at=coalesce(deleted_at,now()),
      deletion_kind='admin',deleted_by=auth.uid(),deletion_reason=v_reason,
      moderated_at=now(),moderated_by=auth.uid() where id=c.id;
  end if;
  select jsonb_build_object('status',status,'deleted_at',deleted_at,'deletion_kind',deletion_kind)
  into v_after from private.community_comments where id=c.id;
  insert into private.community_moderation_log(action,comment_id,user_id,product_id,actor_id,reason,before_state,after_state)
  values(case v_action when 'hide' then 'comment_hidden' when 'restore' then 'comment_restored' else 'comment_deleted' end,
    c.id,c.user_id,c.product_id,auth.uid(),v_reason,v_before,v_after);
  return jsonb_build_object('changed',true,'id',c.id,'state',v_after);
end;
$$;

create or replace function private.admin_set_community_user_block(
  p_user_id uuid,p_blocked boolean,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_reason text:=btrim(coalesce(p_reason,'')); r private.community_user_restrictions; v_before jsonb;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Solo administradores con MFA' using errcode='42501'; end if;
  if p_user_id is null or p_blocked is null then raise exception 'Usuario o estado inválido'; end if;
  if p_user_id=auth.uid() or exists(select 1 from public.profiles where id=p_user_id and role='admin') then
    raise exception 'No se puede aplicar un bloqueo de Comunidad a un administrador';
  end if;
  if not exists(select 1 from auth.users where id=p_user_id and deleted_at is null) then raise exception 'Usuario inexistente'; end if;
  if char_length(v_reason) not between 3 and 500 then raise exception 'Indicá un motivo de 3 a 500 caracteres'; end if;
  select * into r from private.community_user_restrictions where user_id=p_user_id for update;
  if found and r.is_blocked=p_blocked then return jsonb_build_object('changed',false,'user_id',p_user_id,'is_blocked',p_blocked); end if;
  v_before:=jsonb_build_object('is_blocked',coalesce(r.is_blocked,false));
  insert into private.community_user_restrictions(
    user_id,is_blocked,reason,blocked_at,blocked_by,unblocked_at,unblocked_by,updated_at,updated_by
  ) values(
    p_user_id,p_blocked,v_reason,
    case when p_blocked then now() end,case when p_blocked then auth.uid() end,
    case when not p_blocked then now() end,case when not p_blocked then auth.uid() end,
    now(),auth.uid()
  ) on conflict(user_id) do update set
    is_blocked=excluded.is_blocked,reason=excluded.reason,
    blocked_at=case when excluded.is_blocked then now() else private.community_user_restrictions.blocked_at end,
    blocked_by=case when excluded.is_blocked then auth.uid() else private.community_user_restrictions.blocked_by end,
    unblocked_at=case when not excluded.is_blocked then now() else private.community_user_restrictions.unblocked_at end,
    unblocked_by=case when not excluded.is_blocked then auth.uid() else private.community_user_restrictions.unblocked_by end,
    updated_at=now(),updated_by=auth.uid();
  insert into private.community_moderation_log(action,user_id,actor_id,reason,before_state,after_state)
  values(case when p_blocked then 'user_blocked' else 'user_unblocked' end,p_user_id,auth.uid(),v_reason,v_before,
    jsonb_build_object('is_blocked',p_blocked));
  return jsonb_build_object('changed',true,'user_id',p_user_id,'is_blocked',p_blocked);
end;
$$;

create or replace function private.get_admin_community_users(
  p_page integer default 1,p_page_size integer default 25,p_search text default null,
  p_status text default 'all',p_sort text default 'recent'
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_page integer:=greatest(coalesce(p_page,1),1); v_size integer; v_search text:=btrim(coalesce(p_search,''));
  v_status text:=lower(coalesce(p_status,'all')); v_sort text:=lower(coalesce(p_sort,'recent')); v_total bigint; v_items jsonb;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Solo administradores con MFA' using errcode='42501'; end if;
  v_size:=case when p_page_size in(10,25,50) then p_page_size else 25 end;
  if v_status not in('all','blocked','unblocked') or v_sort not in('recent','oldest') then raise exception 'Filtro inválido'; end if;
  with filtered as(
    select r.* from private.community_user_restrictions r left join public.profiles p on p.id=r.user_id
    where (v_search='' or coalesce(p.display_name,'') ilike '%'||v_search||'%' or r.user_id::text ilike '%'||v_search||'%'
      or r.reason ilike '%'||v_search||'%')
      and (v_status='all' or (v_status='blocked' and r.is_blocked) or (v_status='unblocked' and not r.is_blocked))
  ) select count(*) into v_total from filtered;
  with filtered as(
    select r.*,p.display_name,ap.display_name actor_name
    from private.community_user_restrictions r
    left join public.profiles p on p.id=r.user_id
    left join public.profiles ap on ap.id=r.updated_by
    where (v_search='' or coalesce(p.display_name,'') ilike '%'||v_search||'%' or r.user_id::text ilike '%'||v_search||'%'
      or r.reason ilike '%'||v_search||'%')
      and (v_status='all' or (v_status='blocked' and r.is_blocked) or (v_status='unblocked' and not r.is_blocked))
  ), page as(
    select * from filtered order by case when v_sort='oldest' then updated_at end asc,
      case when v_sort='recent' then updated_at end desc,user_id
    offset (v_page-1)*v_size limit v_size
  ) select coalesce(jsonb_agg(jsonb_build_object(
    'user_id',user_id,'name',case when nullif(btrim(display_name),'') is null or display_name like '%@%' then 'Cliente de Cúbica' else left(display_name,80) end,
    'is_blocked',is_blocked,'reason',reason,'blocked_at',blocked_at,'unblocked_at',unblocked_at,
    'updated_at',updated_at,'actor_name',case when nullif(btrim(actor_name),'') is null or actor_name like '%@%' then 'Administrador' else left(actor_name,80) end
  ) order by case when v_sort='oldest' then updated_at end asc,
    case when v_sort='recent' then updated_at end desc,user_id),'[]'::jsonb) into v_items from page;
  return jsonb_build_object('items',v_items,'total',v_total,'page',v_page,'page_size',v_size,
    'total_pages',case when v_total=0 then 0 else ceil(v_total::numeric/v_size)::integer end);
end;
$$;

create or replace function private.admin_manage_community_term(
  p_action text,p_id bigint default null,p_expression text default null,
  p_whole_word boolean default true,p_active boolean default true,p_reason text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_action text:=lower(btrim(coalesce(p_action,''))); v_reason text:=btrim(coalesce(p_reason,''));
  v_expression text:=btrim(coalesce(p_expression,'')); v_normalized text; t private.community_forbidden_terms;
  v_before jsonb; v_after jsonb; v_log_action text;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Solo administradores con MFA' using errcode='42501'; end if;
  if v_action not in('create','update','set_active','delete') then raise exception 'Acción inválida'; end if;
  if char_length(v_reason) not between 3 and 500 then raise exception 'Indicá un motivo de 3 a 500 caracteres'; end if;
  if v_action in('create','update') then
    if char_length(v_expression) not between 2 and 120 then raise exception 'La expresión debe contener entre 2 y 120 caracteres'; end if;
    v_normalized:=private.community_normalize_text(v_expression);
    if char_length(v_normalized) not between 2 and 120 then raise exception 'La expresión no contiene texto utilizable'; end if;
  end if;
  if v_action='create' then
    insert into private.community_forbidden_terms(expression,normalized_expression,whole_word,active,created_by,updated_by)
    values(v_expression,v_normalized,coalesce(p_whole_word,true),coalesce(p_active,true),auth.uid(),auth.uid()) returning * into t;
    v_before:='{}'::jsonb;v_log_action:='term_created';
  else
    select * into t from private.community_forbidden_terms where id=p_id for update;
    if not found then raise exception 'Regla inexistente'; end if;
    v_before:=to_jsonb(t)-'created_by'-'updated_by';
    if v_action='update' then
      update private.community_forbidden_terms set expression=v_expression,normalized_expression=v_normalized,
        whole_word=coalesce(p_whole_word,true),active=coalesce(p_active,active),updated_at=now(),updated_by=auth.uid()
      where id=t.id returning * into t;v_log_action:='term_updated';
    elsif v_action='set_active' then
      if p_active is null then raise exception 'Falta indicar el estado'; end if;
      if t.active=p_active then return jsonb_build_object('changed',false,'id',t.id); end if;
      update private.community_forbidden_terms set active=p_active,updated_at=now(),updated_by=auth.uid()
      where id=t.id returning * into t;v_log_action:=case when p_active then 'term_enabled' else 'term_disabled' end;
    else
      delete from private.community_forbidden_terms where id=t.id;
      insert into private.community_moderation_log(action,term_id,actor_id,reason,before_state,after_state)
      values('term_deleted',null,auth.uid(),v_reason,v_before||jsonb_build_object('deleted_term_id',t.id),'{}'::jsonb);
      return jsonb_build_object('changed',true,'deleted',true,'id',t.id);
    end if;
  end if;
  v_after:=to_jsonb(t)-'created_by'-'updated_by';
  insert into private.community_moderation_log(action,term_id,actor_id,reason,before_state,after_state)
  values(v_log_action,t.id,auth.uid(),v_reason,v_before,v_after);
  return jsonb_build_object('changed',true,'item',v_after);
exception
  when unique_violation then
    raise exception 'Ya existe una regla equivalente';
end;
$$;

create or replace function private.get_admin_community_terms(
  p_page integer default 1,p_page_size integer default 25,p_search text default null,
  p_status text default 'all',p_sort text default 'recent'
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_page integer:=greatest(coalesce(p_page,1),1);v_size integer;v_search text:=btrim(coalesce(p_search,''));
  v_status text:=lower(coalesce(p_status,'all'));v_sort text:=lower(coalesce(p_sort,'recent'));v_total bigint;v_items jsonb;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Solo administradores con MFA' using errcode='42501'; end if;
  v_size:=case when p_page_size in(10,25,50) then p_page_size else 25 end;
  if v_status not in('all','active','inactive') or v_sort not in('recent','oldest') then raise exception 'Filtro inválido'; end if;
  select count(*) into v_total from private.community_forbidden_terms t
  where (v_search='' or t.expression ilike '%'||v_search||'%')
    and (v_status='all' or (v_status='active' and t.active) or (v_status='inactive' and not t.active));
  with page as(
    select * from private.community_forbidden_terms t
    where (v_search='' or t.expression ilike '%'||v_search||'%')
      and (v_status='all' or (v_status='active' and t.active) or (v_status='inactive' and not t.active))
    order by case when v_sort='oldest' then updated_at end asc,
      case when v_sort='recent' then updated_at end desc,id
    offset (v_page-1)*v_size limit v_size
  ) select coalesce(jsonb_agg((to_jsonb(page)-'created_by'-'updated_by')
    order by case when v_sort='oldest' then updated_at end asc,
      case when v_sort='recent' then updated_at end desc,id),'[]'::jsonb) into v_items from page;
  return jsonb_build_object('items',v_items,'total',v_total,'page',v_page,'page_size',v_size,
    'total_pages',case when v_total=0 then 0 else ceil(v_total::numeric/v_size)::integer end);
end;
$$;

create or replace function private.get_admin_community_settings()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Solo administradores con MFA' using errcode='42501'; end if;
  return coalesce((select jsonb_build_object('block_links',block_links,'updated_at',updated_at) from private.community_settings where singleton),
    jsonb_build_object('block_links',true,'updated_at',null));
end;
$$;

create or replace function private.admin_set_community_link_blocking(p_enabled boolean,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_reason text:=btrim(coalesce(p_reason,'')); v_before boolean; v_after jsonb;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Solo administradores con MFA' using errcode='42501'; end if;
  if p_enabled is null then raise exception 'Estado inválido'; end if;
  if char_length(v_reason) not between 3 and 500 then raise exception 'Indicá un motivo de 3 a 500 caracteres'; end if;
  select block_links into v_before from private.community_settings where singleton for update;
  if v_before is not distinct from p_enabled then return jsonb_build_object('changed',false,'block_links',p_enabled); end if;
  insert into private.community_settings(singleton,block_links,updated_at,updated_by)
  values(true,p_enabled,now(),auth.uid()) on conflict(singleton) do update
  set block_links=excluded.block_links,updated_at=now(),updated_by=auth.uid();
  v_after:=jsonb_build_object('block_links',p_enabled);
  insert into private.community_moderation_log(action,actor_id,reason,before_state,after_state)
  values(case when p_enabled then 'links_enabled' else 'links_disabled' end,auth.uid(),v_reason,
    jsonb_build_object('block_links',v_before),v_after);
  return v_after||jsonb_build_object('changed',true);
end;
$$;

create or replace function private.get_admin_community_history(
  p_page integer default 1,p_page_size integer default 25,p_search text default null,
  p_action text default 'all',p_sort text default 'recent'
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_page integer:=greatest(coalesce(p_page,1),1);v_size integer;v_search text:=btrim(coalesce(p_search,''));
  v_action text:=lower(coalesce(p_action,'all'));v_sort text:=lower(coalesce(p_sort,'recent'));v_total bigint;v_items jsonb;
begin
  if auth.uid() is null or not private.is_admin() then raise exception 'Solo administradores con MFA' using errcode='42501'; end if;
  v_size:=case when p_page_size in(10,25,50) then p_page_size else 25 end;
  if v_sort not in('recent','oldest') then raise exception 'Orden inválido'; end if;
  with filtered as(
    select l.id from private.community_moderation_log l left join public.products pr on pr.id=l.product_id
    left join public.profiles p on p.id=l.user_id
    where (v_action='all' or l.action=v_action)
      and (v_search='' or l.action ilike '%'||v_search||'%' or coalesce(l.reason,'') ilike '%'||v_search||'%'
        or coalesce(pr.name,'') ilike '%'||v_search||'%' or coalesce(p.display_name,'') ilike '%'||v_search||'%')
  ) select count(*) into v_total from filtered;
  with filtered as(
    select l.*,pr.name product_name,p.display_name user_name,a.display_name actor_name
    from private.community_moderation_log l left join public.products pr on pr.id=l.product_id
    left join public.profiles p on p.id=l.user_id left join public.profiles a on a.id=l.actor_id
    where (v_action='all' or l.action=v_action)
      and (v_search='' or l.action ilike '%'||v_search||'%' or coalesce(l.reason,'') ilike '%'||v_search||'%'
        or coalesce(pr.name,'') ilike '%'||v_search||'%' or coalesce(p.display_name,'') ilike '%'||v_search||'%')
  ), page as(
    select * from filtered order by case when v_sort='oldest' then created_at end asc,
      case when v_sort='recent' then created_at end desc,id desc
    offset (v_page-1)*v_size limit v_size
  ) select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'action',action,'comment_id',comment_id,'user_id',user_id,'term_id',term_id,
    'product_name',product_name,'user_name',case when user_name like '%@%' then null else user_name end,
    'actor_name',case when actor_name like '%@%' then null else actor_name end,
    'reason',reason,'before_state',before_state,'after_state',after_state,'created_at',created_at
  ) order by case when v_sort='oldest' then created_at end asc,
    case when v_sort='recent' then created_at end desc,id desc),'[]'::jsonb) into v_items from page;
  return jsonb_build_object('items',v_items,'total',v_total,'page',v_page,'page_size',v_size,
    'total_pages',case when v_total=0 then 0 else ceil(v_total::numeric/v_size)::integer end);
end;
$$;

-- El RPC heredado conserva compatibilidad, pero ya no permite moderar sin auditoría.
create or replace function private.moderate_community_comment(p_comment_id bigint,p_status text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_status not in('published','hidden') then raise exception 'Estado inválido'; end if;
  perform private.admin_moderate_community_comment(
    p_comment_id,case when p_status='published' then 'restore' else 'hide' end,'Acción administrativa'
  );
end;
$$;

-- Wrappers invoker: nombres estables para PostgREST; las funciones privadas
-- vuelven a validar identidad, rol y AAL2.
create or replace function public.get_admin_community_comments(
  p_page integer default 1,p_page_size integer default 25,p_search text default null,
  p_status text default 'all',p_sort text default 'recent')
returns jsonb language sql security invoker set search_path='' as $$
  select private.get_admin_community_comments(p_page,p_page_size,p_search,p_status,p_sort);
$$;
create or replace function public.admin_moderate_community_comment(
  p_comment_id bigint,p_action text,p_reason text)
returns jsonb language sql security invoker set search_path='' as $$
  select private.admin_moderate_community_comment(p_comment_id,p_action,p_reason);
$$;
create or replace function public.get_admin_community_users(
  p_page integer default 1,p_page_size integer default 25,p_search text default null,
  p_status text default 'all',p_sort text default 'recent')
returns jsonb language sql security invoker set search_path='' as $$
  select private.get_admin_community_users(p_page,p_page_size,p_search,p_status,p_sort);
$$;
create or replace function public.admin_set_community_user_block(
  p_user_id uuid,p_blocked boolean,p_reason text)
returns jsonb language sql security invoker set search_path='' as $$
  select private.admin_set_community_user_block(p_user_id,p_blocked,p_reason);
$$;
create or replace function public.get_admin_community_terms(
  p_page integer default 1,p_page_size integer default 25,p_search text default null,
  p_status text default 'all',p_sort text default 'recent')
returns jsonb language sql security invoker set search_path='' as $$
  select private.get_admin_community_terms(p_page,p_page_size,p_search,p_status,p_sort);
$$;
create or replace function public.admin_manage_community_term(
  p_action text,p_id bigint default null,p_expression text default null,
  p_whole_word boolean default true,p_active boolean default true,p_reason text default null)
returns jsonb language sql security invoker set search_path='' as $$
  select private.admin_manage_community_term(p_action,p_id,p_expression,p_whole_word,p_active,p_reason);
$$;
create or replace function public.get_admin_community_settings()
returns jsonb language sql security invoker set search_path='' as $$
  select private.get_admin_community_settings();
$$;
create or replace function public.admin_set_community_link_blocking(p_enabled boolean,p_reason text)
returns jsonb language sql security invoker set search_path='' as $$
  select private.admin_set_community_link_blocking(p_enabled,p_reason);
$$;
create or replace function public.get_admin_community_history(
  p_page integer default 1,p_page_size integer default 25,p_search text default null,
  p_action text default 'all',p_sort text default 'recent')
returns jsonb language sql security invoker set search_path='' as $$
  select private.get_admin_community_history(p_page,p_page_size,p_search,p_action,p_sort);
$$;

revoke all on function private.community_normalize_text(text),private.community_contains_link(text),
  private.community_participation_blocked(uuid),private.assert_community_participation_allowed(),
  private.validate_community_body(text) from public,anon,authenticated,service_role;

do $$
declare signature regprocedure;
begin
  foreach signature in array array[
    'private.get_admin_community_comments(integer,integer,text,text,text)'::regprocedure,
    'private.admin_moderate_community_comment(bigint,text,text)'::regprocedure,
    'private.get_admin_community_users(integer,integer,text,text,text)'::regprocedure,
    'private.admin_set_community_user_block(uuid,boolean,text)'::regprocedure,
    'private.get_admin_community_terms(integer,integer,text,text,text)'::regprocedure,
    'private.admin_manage_community_term(text,bigint,text,boolean,boolean,text)'::regprocedure,
    'private.get_admin_community_settings()'::regprocedure,
    'private.admin_set_community_link_blocking(boolean,text)'::regprocedure,
    'private.get_admin_community_history(integer,integer,text,text,text)'::regprocedure,
    'public.get_admin_community_comments(integer,integer,text,text,text)'::regprocedure,
    'public.admin_moderate_community_comment(bigint,text,text)'::regprocedure,
    'public.get_admin_community_users(integer,integer,text,text,text)'::regprocedure,
    'public.admin_set_community_user_block(uuid,boolean,text)'::regprocedure,
    'public.get_admin_community_terms(integer,integer,text,text,text)'::regprocedure,
    'public.admin_manage_community_term(text,bigint,text,boolean,boolean,text)'::regprocedure,
    'public.get_admin_community_settings()'::regprocedure,
    'public.admin_set_community_link_blocking(boolean,text)'::regprocedure,
    'public.get_admin_community_history(integer,integer,text,text,text)'::regprocedure
  ] loop
    execute 'revoke all on function '||signature||' from public,anon,service_role';
    execute 'grant execute on function '||signature||' to authenticated';
  end loop;
end;
$$;

comment on table private.community_moderation_log is 'Auditoría append-only de moderación; sin acceso directo desde Data API.';
comment on function private.assert_community_participation_allowed() is 'Impide toda escritura social a usuarios restringidos sin afectar Auth, compras, perfil ni pedidos.';
comment on function private.validate_community_body(text) is 'Valida longitud, enlaces y expresiones activas en backend; no modifica contenido histórico.';

