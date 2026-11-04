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
Page projet = présentation (#projet : couverture, logo, chiffres en cartes, grands boutons vers chaque rubrique, liens utiles)
et une page par rubrique (#projet/taches, /agenda, /clients, /recos, /factures, /chiffres, /notes) avec flèche retour,
mini-menu et sous-menu dans la barre latérale ; Échap revient à la présentation, ← → changent de rubrique. Pas de longue page à faire défiler.
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
- Victor en ligne (principal) : fonction serveur `victor` lancée par pg_cron toutes les demi-heures de 4 h à 7 h 30 UTC ;
  elle attend 6 h 25 (Paris), s'arrête si le briefing du jour existe, lit les boîtes par `lire-mails`, fait rédiger le point
  par l'API Claude (claude-opus-5-5, sortie structurée ; secret ANTHROPIC_API_KEY posé par `outils/claude-cle.sh`) et publie
  comme `victor.py` (SQL : `victor_contexte()`, `victor_evenements(date)`). Elle ne lit que les boîtes connectées au cockpit.
- Victor sur le Mac (secours) : routine planifiée de l'app Claude, 7 h 30 et 8 h 30, ne fait rien si le point est déjà publié
  (~/.claude/scheduled-tasks/victor-point-du-matin). Elle lit en LECTURE SEULE Gmail arouzier et Outlook Palomano
  (connecteurs Claude) et, via `outils/victor.py mails` -> fonction `lire-mails`, les boîtes connectées au cockpit
  (comptes_agenda.usage = 'mail' : Camp en Gmail, Evoa en Outlook) et IONOS Harnes en IMAP (secrets IONOS_*, posés par
  `outils/ionos.sh`, jamais dans un fichier). Pas de transfert de mails (refusé par Antonin). Ensuite puis `outils/victor.py publier` écrit `briefings` et `propositions` et place jusqu'à 2 h de
  « Formation ORIAS » (8 h – 19 h, en semaine) via agenda-ecrire (clé de synchro). Le site affiche « Le point de Victor »
  sur Aujourd'hui ; une proposition acceptée devient une tâche. Notes du jour dans ~/.cockpit/victor/ (jamais dans le dépôt).
