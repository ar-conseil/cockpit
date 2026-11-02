# Cockpit d'Antonin — consignes pour Claude

Site statique (GitHub Pages, dépôt PUBLIC ar-conseil/cockpit) : `index.html`, `assets/app.js`, `assets/style.css`.
Données dans **Supabase** (projet perso, un seul utilisateur, inscriptions fermées). Pas de build ; supabase-js en CDN.
Langue : français, sans émoticônes.

## Design (voulu par Antonin : un vrai site professionnel, surtout pas un « dashboard Claude »)
Clair et net, façon outils SaaS haut de gamme : papier `#f3efe7`, panneaux blancs à bord fin (rayon 14 px),
police **Geist** (titres 600, resserrés) et **Geist Mono** pour heures et montants. Chaque projet porte sa couleur.
Pas d'Instrument Serif ni de thème noir et or (refusés).
Aujourd'hui = en-tête (date, heure), calendrier du jour vertical en direct (ligne rouge, clic = nouveau RDV) à gauche,
« maintenant / ensuite » + « à faire » (tâches, retards, relances, factures) à droite, cartes projets en bas.
Page projet = en-tête à la couleur du projet, frise du jour du projet, tâches + agenda, clients, factures, chiffres, notes.

## Où sont les choses
- Schéma : `supabase/migrations/` (activites, agendas, evenements, taches, clients, suivis, semaine_type).
- Synchro des agendas : Edge Function `supabase/functions/sync-agendas` (liens iCal secrets -> table evenements),
  toutes les 5 min par pg_cron et via le bouton « En direct ». Lecture iCal testable hors Supabase (`ical.ts`).
- Mise en route / mise à jour : `outils/deployer.sh` (lit `~/.cockpit/supabase.env` et `~/.cockpit/agendas.env`).
- Données de départ : `outils/donnees-depart.mjs` (depuis `.donnees/*.json`, jamais commité).

## Règles
- Jamais de secret dans le dépôt : jeton CLI, mot de passe de la base, adresses iCal et clé de synchro restent dans
  `~/.cockpit/`. Seule la clé publique « anon » va dans `assets/config.js`.
- Ne jamais lancer `supabase login` : le CLI du Mac est connecté au compte du club (hvb-app). Utiliser
  `SUPABASE_ACCESS_TOKEN` depuis `~/.cockpit/supabase.env`.
- `ics_url` n'est jamais lisible par le navigateur (droits par colonne) : ne pas l'ajouter aux `select` du site.
- Nouvelles tables : RLS + politique `to authenticated`, `grant` explicites (authenticated et service_role),
  et `alter publication supabase_realtime add table` si la page doit se mettre à jour en direct.
- Données sobres : pas d'IBAN, de numéros de sécurité sociale ni de détails de santé ; particuliers d'Evoa en initiales.
- Agents (à venir) : service_role côté serveur, écrire dans les mêmes tables (taches, suivis, activites.kpis).
