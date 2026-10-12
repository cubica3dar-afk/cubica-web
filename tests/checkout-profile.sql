-- Discardable Auth/profile fixtures; everything remains uncommitted and rolls back.
begin;
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid();
 email_a text:='buyer-details-qa-'||a::text||'@example.invalid';
 email_b text:='buyer-details-qa-'||b::text||'@example.invalid';
 nickname text; result jsonb; count_before bigint;
begin
 select count(*) into count_before from private.buyer_details;
 insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
 values(a,'authenticated','authenticated',email_a,'{"provider":"email","providers":["email"]}','{"full_name":"Fixture public nickname A"}'),
 (b,'authenticated','authenticated',email_b,'{"provider":"email","providers":["email"]}','{"full_name":"Fixture public nickname B"}');
 select display_name into nickname from public.profiles where id=a;

 if not (select relrowsecurity from pg_class where oid='private.buyer_details'::regclass) then raise exception 'Buyer details RLS missing'; end if;
 if exists(select 1 from information_schema.role_table_grants where table_schema='private' and table_name='buyer_details' and grantee in ('PUBLIC','anon','authenticated','service_role')) then raise exception 'Private details direct access'; end if;
 if exists(select 1 from information_schema.columns where table_schema='private' and table_name='buyer_details' and column_name='email') then raise exception 'Auth email unnecessarily duplicated'; end if;
 if has_function_privilege('anon','public.get_my_buyer_details()','EXECUTE') or has_function_privilege('anon','public.save_my_buyer_details(text,text,text)','EXECUTE') then raise exception 'Buyer details anonymous access'; end if;
 if (select prosecdef from pg_proc where oid='public.get_my_buyer_details()'::regprocedure) or (select prosecdef from pg_proc where oid='public.save_my_buyer_details(text,text,text)'::regprocedure) then raise exception 'Public RPC must be invoker'; end if;
 if (select proargnames from pg_proc where oid='public.save_my_buyer_details(text,text,text)'::regprocedure)<>array['p_first_name','p_last_name','p_phone']::text[] then raise exception 'Save RPC permits unexpected spoof parameters'; end if;

 perform set_config('request.jwt.claim.sub',a::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
 perform set_config('role','authenticated',true);
 result:=public.get_my_buyer_details();
 if result->>'user_id'<>a::text or result->>'first_name'<>'' or result->>'last_name'<>'' or result->>'phone'<>'' or result->>'email'<>email_a then raise exception 'Incomplete new profile/Auth email'; end if;
 result:=public.save_my_buyer_details('  Diego  ','  Pérez  ','+54 9 11 1234 5678');
 if result->>'first_name'<>'Diego' or result->>'last_name'<>'Pérez' or result->>'phone'<>'+54 9 11 1234 5678' or result->>'email'<>email_a then raise exception 'Trim/save private contact'; end if;
 begin perform count(*) from private.buyer_details; raise exception 'Customer read table directly'; exception when insufficient_privilege then null; end;
 begin perform public.save_my_buyer_details('Diego','Pérez','123'); raise exception 'Accepted invalid short phone'; exception when invalid_parameter_value then null; end;
 begin perform public.save_my_buyer_details('Diego','Pérez',repeat('1',16)); raise exception 'Accepted invalid long phone'; exception when invalid_parameter_value then null; end;
 begin perform public.save_my_buyer_details(repeat('A',61),'',''); raise exception 'Accepted long first name'; exception when invalid_parameter_value then null; end;
 begin perform public.save_my_buyer_details('',repeat('A',61),''); raise exception 'Accepted long last name'; exception when invalid_parameter_value then null; end;
 begin perform public.save_my_buyer_details(E'Diego\n','Pérez',''); raise exception 'Accepted control character'; exception when invalid_parameter_value then null; end;
 result:=public.save_my_buyer_details(null,null,null);
 if result->>'first_name'<>'' or result->>'last_name'<>'' or result->>'phone'<>'' then raise exception 'Incomplete nullable values'; end if;
 perform public.save_my_buyer_details('Diego','Pérez','1122334455');

 -- A second user receives only their own details, with no selector for another account.
 perform set_config('request.jwt.claim.sub',b::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated')::text,true);
 result:=public.get_my_buyer_details();
 if result->>'user_id'<>b::text or result->>'email'<>email_b or result->>'first_name'<>'' then raise exception 'Cross-account data leaked'; end if;
 perform public.save_my_buyer_details('Otra','Persona','1199887766');
 perform set_config('request.jwt.claim.sub',a::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
 result:=public.get_my_buyer_details();
 if result->>'first_name'<>'Diego' or result->>'phone'<>'1122334455' then raise exception 'Second account changed first account'; end if;

 -- Authenticating the role without an actual owner cannot read or write.
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
 begin perform public.get_my_buyer_details(); raise exception 'Missing uid read private contact'; exception when insufficient_privilege then null; end;
 begin perform public.save_my_buyer_details('Spoof','','11223344'); raise exception 'Missing uid wrote contact'; exception when insufficient_privilege then null; end;
 perform set_config('role','anon',true);
 begin perform public.get_my_buyer_details(); raise exception 'Anonymous read details'; exception when insufficient_privilege then null; end;
 begin perform public.save_my_buyer_details('Spoof','','11223344'); raise exception 'Anonymous saved details'; exception when insufficient_privilege then null; end;

 perform set_config('role','none',true);
 if (select display_name from public.profiles where id=a) is distinct from nickname then raise exception 'Private contact changed public community nickname'; end if;
 if (select count(*) from private.buyer_details)<>count_before+2 then raise exception 'Personal saves duplicated rows'; end if;
 -- Email is read live from Auth, never from saved contact values.
 update auth.users set email='buyer-details-changed-'||a::text||'@example.invalid' where id=a;
 perform set_config('request.jwt.claim.sub',a::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
 perform set_config('role','authenticated',true);
 if public.get_my_buyer_details()->>'email'<>'buyer-details-changed-'||a::text||'@example.invalid' then raise exception 'Contact email disconnected from Auth'; end if;
 perform set_config('role','none',true);
end; $$;
rollback;

