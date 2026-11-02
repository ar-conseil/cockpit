# Cockpit d'Antonin — consignes pour Claude

Site statique (GitHub Pages, dépôt PUBLIC ar-conseil/cockpit) : `index.html`, `assets/app.js`, `assets/style.css`.
Données dans **Supabase** (projet perso, un seul utilisateur, inscriptions fermées). Pas de build ; supabase-js en CDN.
Langue : français, sans émoticônes.

## Design (voulu par Antonin : un vrai site professionnel, surtout pas un « dashboard Claude » ; modèle assumé : Notion)
Coquille façon Notion : barre latérale fixe (espace, Nouvelle tâche, Rendez-vous, Aujourd'hui / Tâches / Agendas, puis
les projets avec leur icône de couleur), barre fine en haut avec fil d'Ariane ; sur téléphone la barre latérale glisse.
Fond blanc, barre latérale #f8f7f5, police **Geist** (titres 700 resserrés) et **Geist Mono** pour heures et montants.
En-tête de page : grande icône, titre, halo de la couleur du projet. Pas d'Instrument Serif ni de thème noir et or (refusés).
Aujourd'hui = en-tête (date, heure), calendrier du jour vertical en direct (ligne rouge, clic = nouveau RDV) à gauche,
« maintenant / ensuite » + « à faire » (tâches, retards, relances, factures) à droite, cartes projets en bas.
Page projet = en-tête, rubriques collées, tableau des tâches, frise du jour, agenda, clients, factures, chiffres, notes.
Tâches : colonnes Tâches / En cours / En révision / Terminé (statuts a-faire, en-cours, en-revision, fait), cartes
glissées à la souris ou au doigt (appui long) ; page « Tâches » (#taches, touche B) pour tous les projets, vue Liste en option.
Fluidité : seule la page change (transition de vue), le menu reste en place ; pas de flou d'arrière-plan (coûteux au défilement).

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
- Victor (assistant du matin) : routine planifiée de l'app Claude sur le Mac, chaque jour vers 6 h 30
  (~/.claude/scheduled-tasks/victor-point-du-matin). Elle lit Gmail (arouzier, + Camp/Evoa/Harnes transférés) et Outlook
  Palomano en LECTURE SEULE, puis `outils/victor.py publier` écrit `briefings` et `propositions` et place jusqu'à 2 h de
  « Formation ORIAS » (8 h – 19 h, en semaine) via agenda-ecrire (clé de synchro). Le site affiche « Le point de Victor »
  sur Aujourd'hui ; une proposition acceptée devient une tâche. Notes du jour dans ~/.cockpit/victor/ (jamais dans le dépôt).
