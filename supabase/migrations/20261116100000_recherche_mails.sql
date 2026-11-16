-- Recherche de mails instantanée (page Rechercher un mail) : dans le journal du tri (tri_mails, objet + expéditeur + résumé),
-- sans accents ni majuscules, tous les mots dans n'importe quel ordre. Index trigrammes pour rester rapide sur ~65 000 mails.
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create or replace function public.norme_recherche(t text) returns text language sql immutable parallel safe
  set search_path = public, extensions as $$ select lower(extensions.unaccent('extensions.unaccent', coalesce(t, ''))) $$;
create index if not exists tri_mails_recherche on public.tri_mails using gin
  (public.norme_recherche(coalesce(objet, '') || ' ' || coalesce(de, '') || ' ' || coalesce(resume, '')) extensions.gin_trgm_ops);

create or replace function public.chercher_tri(q text, n int default 30)
returns table (boite text, message_id text, de text, objet text, recu_le timestamptz, dossier text, resume text)
language sql stable set search_path = public, extensions as $$
  with m as (select array_remove(regexp_split_to_array(trim(public.norme_recherche(q)), '\s+'), '') as mots)
  select t.boite, t.message_id, t.de, t.objet, t.recu_le, t.dossier, t.resume
  from public.tri_mails t, m
  where t.objet is not null and t.dossier <> 'Corbeille' and cardinality(m.mots) > 0
    and public.norme_recherche(coalesce(t.objet, '') || ' ' || coalesce(t.de, '') || ' ' || coalesce(t.resume, '')) like '%' || m.mots[1] || '%'
    and not exists (select 1 from unnest(m.mots[2:]) w
      where public.norme_recherche(coalesce(t.objet, '') || ' ' || coalesce(t.de, '') || ' ' || coalesce(t.resume, '')) not like '%' || w || '%')
  order by t.recu_le desc nulls last
  limit least(n, 60)
$$;
grant execute on function public.chercher_tri(text, int) to authenticated;
