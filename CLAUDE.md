# Cockpit AR Conseil — consignes pour Claude

Site statique (GitHub Pages, dépôt PUBLIC) : `index.html`, `assets/style.css`, `assets/app.js`.
Données CHIFFRÉES dans `data/coffre.json`, accès par identifiant + mot de passe (outil : `outils/coffre.mjs`).
Pas de build, pas de dépendance. Langue : français. Charte : noir et or AR Conseil (Cinzel pour les titres).

## Mettre à jour les données
- Identifiants : variables d'environnement `COCKPIT_IDENTIFIANT` / `COCKPIT_MOT_DE_PASSE`, sinon les demander
  à l'utilisateur. Ne JAMAIS les écrire dans un fichier du dépôt, un commit ou un message de commit.
- Workflow : `node outils/coffre.mjs ouvrir` -> modifier `.donnees/<activite>.json` -> `node outils/coffre.mjs fermer`
  -> commit de `data/coffre.json` uniquement. `.donnees/` ne doit jamais être commité (il est dans .gitignore).
- Format des fichiers décrit dans README.md.
- Sources habituelles via les connecteurs : Qonto (trésorerie, factures, transactions), HubSpot (pipeline,
  leads, deals d'Evoa Courtage), Google Agenda (agenda), Gmail (relances), Google Drive (tableurs du club et du camp).
- Après une mise à jour : `miseAJour` = date du jour, `exemple` = false, `sources` = connecteurs réellement utilisés.
- Agenda : seulement les événements à venir, au format `AAAA-MM-JJTHH:MM`.
- Même chiffrées, rester sobre : pas d'IBAN, de numéros de sécurité sociale ni de détails de santé de clients.
- Valider le JSON avant `fermer` : `python3 -m json.tool .donnees/<fichier>.json`.

## Vérifier le rendu
`python3 -m http.server 8765` puis Playwright (préinstallé) sur http://localhost:8765/#<activite>,
en remplissant `#identifiant` et `#mot-de-passe` puis en cliquant sur le bouton « Se connecter ».
