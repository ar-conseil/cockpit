-- Invités d'un rendez-vous (adresses invitées depuis le cockpit) et carnet d'adresses tiré des mails triés (autocomplétion).
alter table public.evenements add column if not exists invites text[];

create or replace function public.contacts_mail(q text, n int default 8)
returns table (nom text, email text, mails bigint)
language sql stable set search_path = public, extensions as $$
  with c as (
    select trim(both ' "' from coalesce(substring(de from '^(.*?)\s*<'), '')) as nom,
           lower(coalesce(substring(de from '<([^>]+)>'), de)) as email
    from public.tri_mails
    where de is not null and public.norme_recherche(de) like '%' || public.norme_recherche(q) || '%'
  )
  select max(nom), email, count(*) from c
  where email like '%@%.%' and email !~ '(no-?reply|notification|mailer|bounce|newsletter|info@|news@|marketing)'
  group by email order by count(*) desc limit least(n, 20)
$$;
grant execute on function public.contacts_mail(text, int) to authenticated;
-- Autocomplétion rapide des contacts (index trigrammes sur l'expéditeur)
create index if not exists tri_mails_de on public.tri_mails using gin (public.norme_recherche(de) extensions.gin_trgm_ops);
