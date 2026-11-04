-- Victor en ligne : la fonction serveur « victor » lit le contexte et l'agenda du jour par ces deux fonctions
-- (mêmes requêtes que outils/victor.py, réservées au rôle service).
create or replace function public.victor_contexte() returns json language sql stable as $$
  with j as (select (now() at time zone 'Europe/Paris')::date as d)
  select json_build_object(
    'aujourdhui', (select d from j),
    'maintenant', to_char(now() at time zone 'Europe/Paris', 'YYYY-MM-DD"T"HH24:MI'),
    'projets', (select json_agg(json_build_object('id', id, 'nom', nom, 'mots_cles', mots_cles) order by ordre) from activites),
    'agenda', (select coalesce(json_agg(json_build_object(
        'titre', e.titre, 'debut', to_char(e.debut at time zone 'Europe/Paris', 'YYYY-MM-DD"T"HH24:MI'),
        'fin', to_char(e.fin at time zone 'Europe/Paris', 'YYYY-MM-DD"T"HH24:MI'), 'journee', e.journee,
        'projet', coalesce(e.activite_forcee, e.activite_id), 'lieu', e.lieu) order by e.debut), '[]')
      from evenements e join agendas g on g.id = e.agenda_id, j
      where g.actif and not e.annule and e.fin > (j.d::timestamp at time zone 'Europe/Paris')
        and e.debut < ((j.d + 2)::timestamp at time zone 'Europe/Paris')),
    'taches', (select coalesce(json_agg(json_build_object('titre', t.titre, 'projet', t.activite_id, 'echeance', t.echeance,
        'priorite', t.priorite, 'statut', t.statut) order by t.echeance nulls last), '[]')
      from taches t, j where t.statut <> 'fait' and (t.echeance is null or t.echeance <= j.d + 7)),
    'cles_deja_traitees', (select coalesce(json_agg(cle), '[]') from propositions where cree_le > now() - interval '45 days'),
    'derniere_lecture', (select max(mise_a_jour) from briefings),
    'deja_publie_aujourdhui', (select exists(select 1 from briefings b, j where b.jour = j.d))
  )
$$;

-- Rendez-vous du jour (heure de Paris), hors séjours de plusieurs jours
create or replace function public.victor_evenements(j date)
returns table (titre text, d text, f text, dj date, fj date, journee boolean, projet text) language sql stable as $$
  select e.titre, to_char(e.debut at time zone 'Europe/Paris', 'HH24:MI'), to_char(e.fin at time zone 'Europe/Paris', 'HH24:MI'),
         (e.debut at time zone 'Europe/Paris')::date, (e.fin at time zone 'Europe/Paris')::date, e.journee, coalesce(e.activite_forcee, e.activite_id)
  from evenements e join agendas g on g.id = e.agenda_id
  where g.actif and not e.annule and e.fin - e.debut < interval '10 hours'
    and e.fin > (j::timestamp at time zone 'Europe/Paris') and e.debut < ((j + 1)::timestamp at time zone 'Europe/Paris')
  order by e.journee desc, e.debut
$$;

revoke all on function public.victor_contexte() from public, anon, authenticated;
revoke all on function public.victor_evenements(date) from public, anon, authenticated;
grant execute on function public.victor_contexte() to service_role;
grant execute on function public.victor_evenements(date) to service_role;
