alter table private.community_comments add constraint community_parent_not_self check(parent_id is null or parent_id<>id);
create or replace function private.community_reply_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare parent private.community_comments;
begin
 if tg_op='UPDATE' and (new.parent_id is distinct from old.parent_id or new.product_id is distinct from old.product_id or new.user_id is distinct from old.user_id) then
  raise exception 'La autoría y la relación del comentario son inmutables';
 end if;
 if new.parent_id is not null then
  select * into parent from private.community_comments where id=new.parent_id for update;
  if not found or parent.parent_id is not null or parent.product_id<>new.product_id then raise exception 'Solo se permite responder a un comentario del mismo producto'; end if;
  if tg_op='INSERT' and (parent.deleted_at is not null or parent.status<>'published') then raise exception 'El comentario no admite nuevas respuestas'; end if;
 end if;
 return new;
end;
$$;
drop trigger community_reply_guard on private.community_comments;
create trigger community_reply_guard before insert or update of parent_id,product_id,user_id on private.community_comments for each row execute function private.community_reply_guard();
