alter table private.community_comments add constraint community_body_nonblank check(body ~ '[^[:space:]]');
create or replace function private.community_identity(p_name text,p_avatar text) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('name',case when nullif(btrim(p_name),'') is null or p_name like '%@%' then 'Cliente de Cúbica' else left(p_name,80) end,
 'avatar',case when char_length(p_avatar)<=2048 and p_avatar ~ '^https://(lh[0-9]+\.googleusercontent\.com/|mymrbpwvghxmqqpzzdqk\.supabase\.co/storage/v1/object/public/)'
 and p_avatar not like '%@%' and lower(p_avatar) not like '%\%40%' then p_avatar end);
$$;
