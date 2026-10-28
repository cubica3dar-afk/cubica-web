do $$ begin
  if (select count(*) from private.site_content_pages)<>4 then raise exception 'content page seeds'; end if;
  if exists(select 1 from private.site_content_versions) then raise exception 'content published automatically'; end if;
  if (select count(*) from private.site_appearance_versions where state='draft')<>1 or exists(select 1 from private.site_appearance_versions where state='published') then raise exception 'appearance seed'; end if;
  if exists(select 1 from private.site_campaigns) or exists(select 1 from private.site_faq_items) or exists(select 1 from private.site_suggestions) then raise exception 'fake public data'; end if;
end $$;

