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
- Tri des boîtes (fonction `trier-mails`, pg_cron `tri-mails` toutes les 10 min de 5 h à 8 h 50 UTC) : une fois le point du jour
  publié, les mails de la réception reçus AVANT ce point sont classés par Claude Haiku 5.5 et rangés (un dossier par activité,
  plus Factures & compta, Banque & administratif, Newsletters, Notifications), marqués lus ; les publicités (envoi de masse
  seulement) vont à la corbeille. Jamais d'envoi ni d'effacement définitif. Droits nécessaires :
  gmail.modify / Mail.ReadWrite (colonne `comptes_agenda.droits`, bouton « Autoriser le tri » page Agendas) ; IONOS par IMAP.
  Libellés Gmail (validés par Antonin le 5 novembre 2026, plus d'émoticônes) : « 1. À faire » en tête, Projets/<activité>
  (Palomano, Evoa, Harnes Volley, Camp, Berkay, Wealthy), Perso, Classement/(Factures & compta, Banque & administratif,
  Newsletters, Notifications). Outlook et IONOS gardent des dossiers à plat. Le journal garde les noms courts.
  Outlook : les dossiers créés à la main par Antonin sont gardés et proposés à Claude avec 4 exemples chacun (Palomano :
  Encaissement, PANSARD / SALAIRES / TVA, Factures › <fournisseur>) ; une facture d'un nouveau fournisseur crée son
  sous-dossier Factures › <fournisseur> (noms rapprochés : « Phanine BV » = « Phanine »). Jamais SAUVEGARDE ni Archive.
  Chemins avec « › » (des noms contiennent « / »). `{ reclasser: "<dossier du tri>", boite, apercu?, depuis? }` déplace
  vers ces dossiers personnels les mails déjà rangés par le tri qui leur correspondent.
  Boîtes pro (`BOITES_PRO` : Palomano, Evoa) : jamais de dossier pour une autre activité (-> Perso ou thème) ; Harnes
  n'en fait pas partie, Evoa travaillant avec Harnes Volley.
  Boîte Palomano autorisée au tri le 5 novembre 2026 (accord de l'administrateur Microsoft, droit enregistré à la main).
  Mail qui demande une action d'Antonin : libellé « 1. À faire » dans Gmail (plus d'étoile), drapeau dans Outlook et IONOS.
  Boîte arouzier (`BOITES_TACHES`) : chaque fil « À faire » devient une tâche (`taches.mail_boite`, `mail_fil`, `mail_a_faire`) ;
  tâche terminée -> libellé retiré du fil ; libellé retiré dans Gmail (ou fil à la corbeille) -> tâche terminée. Accord fait
  à chaque tri et par pg_cron `a-faire` (`{ a_faire: true }`, toutes les 15 min de 5 h à 21 h UTC).
  Trois mails ou plus du même expéditeur : une seule tâche qui suit tous leurs fils (`mail_fil` = fils séparés par des virgules).
  `{ rattraper: true, jours?, apercu? }` : remplit À faire avec les mails à traiter des 30 derniers jours (étoilés avant le libellé,
  et 14 à 30 jours réexaminés, échéances passées écartées), sauf les fils où Antonin a déjà répondu. Fait le 5 novembre 2026.
  Journal `tri_mails` (60 jours, objet masqué pour la santé), bilan `tri_resume(depuis)` affiché dans le point de Victor.
  Stock : `{ attendre: true }` à relancer tant que `restant` ; `{ compter: true }` et `{ apercu: true }` ne touchent à rien.
  `{ libelles: true, apercu?, boite? }` : remise en ordre des libellés Gmail (anciens libellés renommés ou fusionnés puis
  supprimés une fois vides, « Travail & Pro » reclassé par Claude, « Notes » masqué) ; rejouable sans risque.
- Dictée depuis l'iPhone (fonction `ajouter-tache`, Raccourci iOS « Tâche pour Victor », lancé par la phrase « Tâche pour Victor » des Raccourcis vocaux d'Accessibilité : par Siri, « tâche … Victor » part vers Rappels/Calendrier et le contact Victor) : POST `{ texte }` (ou texte brut)
  avec l'en-tête `x-cle-tache` ; Claude Haiku 5.5 en tire l'action (creer, annuler, modifier, supprimer, terminer), la cible,
  le titre, le projet, la date, l'heure, la durée, le lieu et la priorité ; réponse en une ligne lisible pour la notification.
  Créer : une heure dite (ou « toute la journée ») = rendez-vous écrit par `agenda-ecrire` (clé de synchro) : Palomano dans
  Outlook avec lien Teams (`teams: true`), Harnes et Camp dans leurs agendas Google, Perso, Berkay et Wealthy dans l'agenda
  Google principal ; Evoa : son agenda Outlook dès qu'il est connecté (accord de l'administrateur Evoa demandé), sinon une
  tâche « À caler », jamais l'agenda perso. Chevauchement signalé, pas bloqué. Sinon une tâche.
  Modifier / supprimer / terminer : seulement si UNE seule tâche ouverte, ou un seul rendez-vous créé par dictée, correspond
  (sinon « préciser », rien de changé). Rendez-vous visés : ceux à venir (45 jours) des agendas que le cockpit peut écrire ;
  une invitation reçue (organisateur autre qu'Antonin, vérifié chez Google ou Outlook par `organisateurAutre`) n'est jamais touchée.
  « Annule la dernière » défait le dernier ajout dicté (12 h). Journal `dictees` (60 jours) : base de l'annulation. Une phrase d'un seul mot (dictée coupée) ne fait rien ; un envoi vide est noté dans `dictees` (action « vide », forme de la
  requête sans contenu) : cause déjà vue, la variable « Texte dicté » déliée (rouge) dans le Raccourci, à resélectionner.
  Raccourci : Attendre 1 s, Énoncer « Je t'écoute », Dicter du texte (Après une pause), Obtenir le contenu de l'URL, Afficher la notification. Sans Claude : tâche d'après les mots-clés.
  `{ texte, essai: true }` n'écrit rien et affiche l'erreur éventuelle. Clé dédiée CLE_TACHE (jamais la clé de synchro), posée
  par `outils/cle-tache.sh` (à lancer dans le Terminal de macOS, pas depuis une conversation) ; secret temporaire
  CLE_TACHE_ESSAI pour tester sans toucher au téléphone, à retirer après l'essai.
- Site installable sur l'écran d'accueil (`manifest.webmanifest`, icônes `assets/icone-*.png`) ; la session Supabase reste
  ouverte dans l'app installée (connexion par mot de passe, une fois).

- Cache du navigateur (GitHub Pages : 10 min) : à chaque changement de `assets/app.js` ou `assets/style.css`, changer le `?v=AAAAMMJJx` des deux liens dans `index.html`, sinon l'ancienne version reste affichée.

## Victor au téléphone (Wispr Flow)
`victor/` : appli web à part (icône « V » sur l'écran d'accueil, https://ar-conseil.github.io/cockpit/victor/). On y dicte avec le clavier Wispr Flow ;
la phrase part seule 2 s après la dictée vers `ajouter-tache` (session de l'utilisateur, pas de clé). Historique local au téléphone.
Dans le cockpit, même chose avec la barre « Dis-le à Victor » (touche /, ou une dictée collée sans champ actif).
Wispr Flow n'a pas d'API : il écrit là où est le curseur, d'où ces champs dédiés.

## Rechercher un mail
Page `#recherche` (touche F, ou « retrouve le mail… » dans la barre de Victor) -> fonction `chercher-mails` (session de l'utilisateur) :
Haiku traduit la description en critères, recherche parallèle Gmail (q=), Outlook ($search, ids immuables), IONOS (SEARCH par dossier, Message-ID),
puis Haiku classe. Un résultat s'ouvre dans le lecteur (fonction `mail`). Lecture seule, rien n'est stocké.

## Victor assistant (fonction `assistant`)
La barre du cockpit (micro = reconnaissance vocale du navigateur) et l'appli `victor/` appellent `assistant` : Claude Opus 5.5 avec outils
(faire -> ajouter-tache, taches, agenda, propositions, traiter_proposition, chercher_mails, lire_mail, ranger_mail : corbeille/archive/lu).
Jamais d'envoi (brouillons à valider), jamais de suppression définitive, contenu des mails = donnée. Journal dans `dictees` (action « assistant »).
Le Raccourci iPhone (Siri) reste sur `ajouter-tache`.

## Rendez-vous : lieu ou visio
Fiche rendez-vous : Lieu (recherche d'adresse : api-adresse.data.gouv.fr + photon.komoot.io, centrées sur Lille), Visio ou Aucun.
Visio : Google Meet sur un agenda Google (conferenceData, conferenceDataVersion=1), Teams sur Outlook (isOnlineMeeting), ou lien collé (Zoom…, mis dans le lieu).
agenda-ecrire accepte `visio: "meet" | "teams" | null` ; le lien est gardé dans `evenements.visio` (aussi lu à la synchro : hangoutLink, onlineMeeting.joinUrl, ou lien repéré).
Bouton « Rejoindre » dans le bloc Maintenant (rendez-vous en cours, ou dans moins de 30 min).

## Wispr Flow sur le Mac -> Victor
`outils/wispr-victor.py` (service launchd `fr.arconseil.wispr-victor`, installé par `outils/wispr-installer.sh`, lancé par Antonin) lit en lecture seule
l'historique local de Wispr Flow (`~/Library/Application Support/Wispr Flow/flow.sqlite`, table History) toutes les 2 s. Une dictée qui commence
par « Victor » part à `assistant` (en-tête x-cle-wispr = secret CLE_WISPR, copie locale ~/.cockpit/cle-wispr) ; réponse en notification macOS.
Les autres dictées ne quittent pas le Mac. Avec la clé, `assistant` appelle `mail` / `chercher-mails` avec la clé de synchro.
