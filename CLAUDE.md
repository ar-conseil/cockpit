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
  plus Factures & compta, Banque & administratif, Newsletters, Notifications), laissés non lus ; les publicités (envoi de masse
  seulement) vont à la corbeille. Jamais d'envoi ni d'effacement définitif. Droits nécessaires :
  gmail.modify / Mail.ReadWrite (colonne `comptes_agenda.droits`, bouton « Autoriser le tri » dans Réglages › Boîtes mail) ; IONOS par IMAP.
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
`outils/wispr-victor.py` (service launchd `fr.arconseil.wispr-victor`, installé par `outils/wispr-installer.sh`, lancé par Antonin) écoute le guetteur
du presse-papiers `outils/presse-papiers-victor` (Swift, compilé par l'installeur : Wispr colle les dictées par le presse-papiers, et le compte Evoa
ne garde pas l'historique), et lit aussi en lecture seule
l'historique local de Wispr Flow (`~/Library/Application Support/Wispr Flow/flow.sqlite`, table History) toutes les 2 s. Une dictée qui commence
par « Victor » part à `assistant` (en-tête x-cle-wispr = secret CLE_WISPR, copie locale ~/.cockpit/cle-wispr) ; réponse en notification macOS.
Les autres dictées ne quittent pas le Mac. Avec la clé, `assistant` appelle `mail` / `chercher-mails` avec la clé de synchro.

## Wispr Flow en ligne (notes vocales, sans le Mac)
Page Agendas › Wispr Flow : OAuth PKCE (`wispr-connexion`, client décrit par `wispr/client.json` publié sur GitHub Pages, comme le connecteur
du logiciel Evoa). `wispr-veille` (cron `wispr`, chaque minute) lit les nouvelles notes sur le serveur MCP de Wispr (search_meetings,
get_meeting) ; une note qui commence par « Victor » (après « Speaker 1: ») part à `assistant` (x-cle-wispr). Notes vues : `wispr_vues`.
Le relais du Mac ne traite plus que les dictées (presse-papiers, historique). Le logiciel Evoa ignore les notes « Victor » (app/wispr.py, pour_victor).

## Notifications du téléphone (Web Push)
L'appli `victor/` (installée sur l'écran d'accueil) s'abonne avec la cloche « Notifications » (service worker `victor/sw.js`, table `push_abonnements`).
Clés VAPID : secrets VAPID_PUBLIQUE / VAPID_PRIVEE posés par `outils/notifications-cles.sh` (lancé par Antonin). Envoi : `_partage/notifier.ts`
(npm:web-push) ; `assistant` notifie à la fin de chaque demande venue de Wispr Flow. Fonction `notifications` : GET clé publique, POST test.

## Evoalys (logiciel du cabinet Evoa) <-> cockpit
`sync-evoalys` (cron `evoalys`, toutes les 5 min) : tâches d'Antonin dans Evoalys (GET {EVOALYS_URL}/cockpit/taches, en-tête X-Cle-Cockpit =
secret EVOALYS_CLE ; côté Evoalys : app/cockpit.py, variable COCKPIT_CLE) -> taches (projet evoa-courtage, colonne externe « evoalys:<id> »,
lien vers Evoalys). Cochées dans les deux sens (externe_fait = état au dernier passage). Tâches Evoa créées dans le cockpit -> Evoalys.
Clé : outils/evoalys-cle.sh (Supabase + presse-papiers pour Scaleway). Invités de rendez-vous : agenda-ecrire route Harnes vers invitation-harnes.

## Tri des boîtes : 14 jours en réception (depuis le 20 novembre 2026)
Antonin veut voir tous ses mails récents dans la boîte de réception. `trier-mails` ne sort donc plus les mails de la réception au
classement : il les marque lus et les étiquette (libellé Gmail, catégorie Outlook ; rien de visible sur IONOS), note `en_reception` et
`ranger_le` (réception + 14 jours) dans `tri_mails`, puis les range dans leur dossier au passage qui suit ce délai (`archiver` ; un mail
qu'Antonin a déjà déplacé ou supprimé n'est pas touché). Les publicités partent toujours à la corbeille tout de suite.
Références du journal stables d'un dossier à l'autre : identifiants immuables Outlook, Message-ID pour IONOS.
`{ restaurer: true, jours }` remet en réception ce que Victor a rangé (fait le 20/11 sur 30 jours : 1 254 mails).

## Application AR CONSEIL (21 novembre 2026)
Le cockpit s'appelle AR CONSEIL et s'installe comme une application (manifest.webmanifest, sw.js à la racine : notifications, aucune
mise en cache ; bouton « Installer l'app » en bas de la barre latérale ; iPhone : Partager › Sur l'écran d'accueil).
Logo : A et R liés, chrome poli et barre de verre dégradée, rendu en 3D par three.js (outils/logo3d, assemblé en assets/ar-conseil-3d.js
par construire.sh) ; icônes PNG = captures de ce rendu (assets/marque/icone-*.png, via Chrome sans écran) ; scène animée sur la page
de connexion (image fixe si pas de 3D). Téléphone : barre d'onglets en bas (Aujourd'hui, Tâches, Mails, Victor, Plus).
Page Mails (#boite) : fonction `messagerie` (lister la réception de chaque boîte ou de toutes, ranger : lu, non lu, archiver, corbeille via
_partage/ranger.ts, envoyer depuis la bonne boîte avec sa signature HTML ; Outlook demande Mail.Send). Les mails restent hors d'Evoalys
(logiciel partagé avec l'équipe Evoa).

## Mails : messagerie complète (fonction `messagerie`, page `#boite`)
- Actions : `dossiers`, `lister` (dossier, q, suites), `lire` (HTML, images intégrées, pièces), `piece`, `ranger` (lu, non_lu, drapeau, sans_drapeau, archiver, corbeille, reception), `deplacer`, `brouillon_de`, `brouillon`, `envoyer` (mode nouveau / repondre / repondre_tous / transferer, cc, cci, pièces base64, brouillon_id).
- Gmail : identifiant de pièce = partId (les attachmentId changent à chaque lecture). Outlook : notre texte entre `#ar-conseil-texte` et `#ar-conseil-fin` pour qu'un brouillon de réponse ré-enregistré garde la citation ; pièces déjà présentes non rajoutées. Harnes : APPEND en littéral synchronisé (IONOS coupe au-delà de 4 Ko sinon), écritures IMAP/SMTP complètes en boucle.
- Écran : 3 volets dès 1240 px (colonne des dossiers à partir de 1560 px, liste déroulante en dessous), feuille de lecture sinon. Mail HTML dans un iframe sandbox sans script, images distantes bloquées jusqu'au clic. La feuille s'appelle `.lecteur-mail` (`.lecteur-boite` est déjà la pastille du lecteur).
- Mails dans chaque projet (rubrique `#<projet>/mails`) : `SOURCES_MAIL` dans app.js (boîte du projet + dossiers « Projets/… » de Gmail et Camp), retrouvés par leur nom. Evoa : pas de rubrique Mails, seulement le lien vers Evoalys (choix d'Antonin).
- Signatures modifiables (Réglages › Signatures, comme la page Signature d'Evoalys) : `signatures.infos` (nom, fonction, téléphone, photo, avis Google,
  marque, couleur, logo, lignes, mentions) ; le cockpit en tire `html` et `texte` à l'enregistrement (`signatureHtml`, `signatureTexte`).
  Modèles : `carte` (logo + filet couleur), `evoalys` (boîte Evoa : la carte d'Evoalys, photo en anneau `avatar` PNG), `image` (Palomano, image fixe).
  Photos et cartes en image déposées dans le stockage public `signatures` sous un nom unique (jamais remplacées).
- Signature AR CONSEIL sur la boîte Gmail perso (logo `assets/marque/signature-ar-conseil.png`) ; l'ancienne est gardée dans `~/.cockpit/signature-gmail-avant-ar-conseil.json`.
- Victor lit aussi la boîte Evoa (lecture seule, via le compte agenda Outlook qui a Mail.Read ; jamais triée ni rangée) : `lire-mails` prend les agendas Microsoft avec Mail.Read, et `jetonAcces` garde Mail.Read au renouvellement (repli sur les droits d'agenda si Microsoft refuse).
- Manifeste : `"id": "/cockpit/"` obligatoire. Chrome résout l'id par rapport à l'origine (ar-conseil.github.io) : avec `"./"`, AR CONSEIL et Studio Lili (même domaine) étaient une seule appli, et Studio Lili a « mis à jour » AR CONSEIL (22 novembre 2026).
- Fluidité (22 novembre 2026) : `chargerTout` ne lit qu'une fois à la fois et rend true si les données ont changé ; une relecture de fond (temps réel, 5 min, retour sur l'onglet après 1 min) ne redessine que si ça a changé, et jamais la messagerie ouverte (`dessinerFond`). Messagerie : listes gardées (`LISTES`, aussi dans localStorage `cockpit-mails-v1`), réceptions préchargées, mails préchargés au survol (`lecture`), Gmail lu en une seule vague.
- Tri des boîtes : depuis le 22 novembre 2026, Victor ne marque plus les mails comme lus (étiquette, dossier, drapeau seulement) ; seules les publicités jetées à la corbeille sont marquées lues.

## Réglages (`#reglages/<onglet>`, 22 novembre 2026)
- Page à onglets façon Evoalys, lien en bas du menu (touche « , ») : Général (thème auto / clair / sombre dans localStorage
  `cockpit.theme`, posé dès le `<head>` ; vue des tâches ; installer ; relire ; vider la mémoire de l'appareil ; déconnexion),
  Projets (nom, couleur, heures visées, description, mots-clés des rendez-vous, liens utiles, ordre du menu : table `activites`),
  Agendas (ex-page `#agendas`, l'ancienne adresse y renvoie), Boîtes mail et Signatures (sortis de Tri des boîtes), Victor (+ Wispr).
- Les retours de connexion (agenda-connexion, wispr-connexion) reviennent sur `#reglages/agendas`, `#reglages/boites`, `#reglages/victor`.
- Fiches de réglage : `form.fiche` pour que les relectures de fond n'écrasent pas une saisie non enregistrée.

## Mode congé (fonction `conge`, tables `conges` et `conge_reponses`)
- Bouton « Je suis en congé » sur le calendrier d'Aujourd'hui, bandeau pendant le congé (« Modifier », « Je suis de retour »).
- Une réponse d'absence par boîte, signée avec la signature de la boîte (`messageHtml`), programmée du premier jour 0 h au lendemain
  du dernier jour (Paris) : Gmail et Camp par la réponse d'absence de Gmail (droit gmail.settings.basic, reconnexion de la boîte) ;
  Outlook par les réponses automatiques (MailboxSettings.ReadWrite : accord de l'administrateur, jeton demandé à part par
  `jetonMicrosoft` sans toucher au jeton enregistré) ; Harnes (IONOS, sans réglage à distance) par la fonction elle-même
  (pg_cron `conge`, 10 min, seulement si un congé est en cours) : une réponse par expéditeur et par congé, jamais aux listes,
  robots, publicités ni réponses automatiques (en-têtes List-*, Auto-Submitted, Precedence…). Evoa : absence réglée dans Evoalys
  tant que l'administrateur d'Evoa n'a pas donné MailboxSettings au cockpit.
- Journée « Congé » posée par agenda-ecrire (clé de synchro) ; retirée si le congé est annulé avant de commencer, raccourcie à
  aujourd'hui en cas de retour anticipé. Un seul congé à la fois : modifier remplace le précédent.
- Droits de réponse d'absence ajoutés aux scopes de connexion des boîtes ; le renouvellement Outlook ne les demande que si la
  boîte les a reçus (`peutRegler`).

