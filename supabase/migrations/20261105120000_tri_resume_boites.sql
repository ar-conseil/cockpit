-- Bilan du tri : ajoute le détail par boîte (rangés, jetés, importants) pour la page « Tri des boîtes ».
create or replace function public.tri_resume(depuis timestamptz) returns json language sql stable security invoker as $$
  select json_build_object(
    'total', (select count(*) from tri_mails where trie_le >= depuis),
    'par_dossier', (select coalesce(json_agg(x order by x.n desc), '[]') from
      (select dossier, count(*) n from tri_mails where trie_le >= depuis group by dossier) x),
    'par_boite', (select coalesce(json_agg(x order by x.n desc), '[]') from
      (select boite, count(*) n, count(*) filter (where dossier = 'Corbeille') jetes, count(*) filter (where important) importants,
              max(trie_le) dernier from tri_mails where trie_le >= depuis group by boite) x),
    'importants', (select coalesce(json_agg(x order by x.recu_le desc), '[]') from
      (select boite, de, objet, resume, dossier, recu_le from tri_mails
       where trie_le >= depuis and important and recu_le > now() - interval '14 days' order by recu_le desc limit 40) x),
    'importants_total', (select count(*) from tri_mails where trie_le >= depuis and important),
    'corbeille', (select coalesce(json_agg(x order by x.recu_le desc), '[]') from
      (select boite, de, objet, recu_le from tri_mails where trie_le >= depuis and dossier = 'Corbeille' order by recu_le desc limit 60) x)
  )
$$;
