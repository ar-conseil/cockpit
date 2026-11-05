-- Bilan du tri des boîtes pour le cockpit (sans charger tout le journal) : nombre par dossier depuis une date,
-- mails importants récents et dernières publicités mises à la corbeille.
create or replace function public.tri_resume(depuis timestamptz) returns json language sql stable security invoker as $$
  select json_build_object(
    'total', (select count(*) from tri_mails where trie_le >= depuis),
    'par_dossier', (select coalesce(json_agg(x order by x.n desc), '[]') from
      (select dossier, count(*) n from tri_mails where trie_le >= depuis group by dossier) x),
    'importants', (select coalesce(json_agg(x order by x.recu_le desc), '[]') from
      (select boite, de, objet, resume, dossier, recu_le from tri_mails
       where trie_le >= depuis and important and recu_le > now() - interval '14 days' order by recu_le desc limit 30) x),
    'importants_total', (select count(*) from tri_mails where trie_le >= depuis and important),
    'corbeille', (select coalesce(json_agg(x order by x.recu_le desc), '[]') from
      (select boite, de, objet, recu_le from tri_mails where trie_le >= depuis and dossier = 'Corbeille' order by recu_le desc limit 40) x)
  )
$$;
revoke all on function public.tri_resume(timestamptz) from public, anon;
grant execute on function public.tri_resume(timestamptz) to authenticated;
