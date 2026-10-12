-- Personal purchase details are private; community display_name stays unchanged.
create table private.buyer_details (
 user_id uuid primary key references auth.users(id) on delete cascade,
 first_name text not null default '',
 last_name text not null default '',
 phone text not null default '',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint buyer_details_name_lengths check (char_length(first_name)<=60 and char_length(last_name)<=60),
 constraint buyer_details_phone_length check (char_length(phone)<=40),
 constraint buyer_details_phone_digits check (phone='' or char_length(regexp_replace(phone,'[^0-9]','','g')) between 8 and 15)
);
alter table private.buyer_details enable row level security;
revoke all on table private.buyer_details from public,anon,authenticated,service_role;

create function private.get_my_buyer_details()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare uid uuid:=auth.uid(); result jsonb;
begin
 if uid is null then raise exception 'Sesión requerida' using errcode='42501'; end if;
 select jsonb_build_object('user_id',u.id,'first_name',coalesce(b.first_name,''),
  'last_name',coalesce(b.last_name,''),'phone',coalesce(b.phone,''),'email',coalesce(u.email,''))
 into result from auth.users u left join private.buyer_details b on b.user_id=u.id where u.id=uid;
 if result is null then raise exception 'Sesión no disponible' using errcode='42501'; end if;
 return result;
end; $$;

create function private.save_my_buyer_details(p_first_name text default '',p_last_name text default '',p_phone text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); first_value text:=btrim(coalesce(p_first_name,''));
 last_value text:=btrim(coalesce(p_last_name,'')); phone_value text:=btrim(coalesce(p_phone,''));
begin
 if uid is null then raise exception 'Sesión requerida' using errcode='42501'; end if;
 if char_length(first_value)>60 or char_length(last_value)>60 then
  raise exception 'El nombre y el apellido admiten hasta 60 caracteres.' using errcode='22023';
 end if;
 if char_length(phone_value)>40 or (phone_value<>'' and char_length(regexp_replace(phone_value,'[^0-9]','','g')) not between 8 and 15) then
  raise exception 'Ingresá un teléfono válido de 8 a 15 números.' using errcode='22023';
 end if;
 if first_value ~ '[[:cntrl:]]' or last_value ~ '[[:cntrl:]]' or phone_value ~ '[[:cntrl:]]' then
  raise exception 'Los datos personales no admiten caracteres de control.' using errcode='22023';
 end if;
 insert into private.buyer_details(user_id,first_name,last_name,phone)
 values(uid,first_value,last_value,phone_value)
 on conflict(user_id) do update set first_name=excluded.first_name,last_name=excluded.last_name,
  phone=excluded.phone,updated_at=now();
 return private.get_my_buyer_details();
end; $$;

create function public.get_my_buyer_details()
returns jsonb language sql stable security invoker set search_path='' as $$ select private.get_my_buyer_details(); $$;
create function public.save_my_buyer_details(p_first_name text default '',p_last_name text default '',p_phone text default '')
returns jsonb language sql security invoker set search_path='' as $$ select private.save_my_buyer_details(p_first_name,p_last_name,p_phone); $$;

revoke all on function private.get_my_buyer_details(),private.save_my_buyer_details(text,text,text),
 public.get_my_buyer_details(),public.save_my_buyer_details(text,text,text) from public,anon,authenticated,service_role;
grant execute on function private.get_my_buyer_details(),private.save_my_buyer_details(text,text,text),
 public.get_my_buyer_details(),public.save_my_buyer_details(text,text,text) to authenticated;

