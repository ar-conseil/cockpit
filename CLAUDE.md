# Cockpit AR Conseil — consignes pour Claude

Site statique (GitHub Pages) : `index.html`, `assets/style.css`, `assets/app.js`, données dans `data/*.json`.
Pas de build, pas de dépendance. Langue : français. Charte : noir et or AR Conseil (Cinzel pour les titres).

## Mettre à jour les données
- Ne modifier que `data/<activite>.json` pour changer des chiffres. Format décrit dans README.md.
- Sources habituelles via les connecteurs : Qonto (trésorerie, factures, transactions), HubSpot (pipeline,
  leads, deals d'Evoa Courtage), Google Agenda (agenda), Gmail (relances), Google Drive (tableurs du club et du camp).
- Après une mise à jour : `miseAJour` = date du jour, `exemple` = false, `sources` = connecteurs réellement utilisés.
- Agenda : seulement les événements à venir, au format `AAAA-MM-JJTHH:MM`.
- Le site est PUBLIC : ne jamais écrire de données personnelles de clients (noms complets, emails, téléphones,
  IBAN, détails de santé). Utiliser des libellés génériques ou des initiales. Demander en cas de doute.
- Valider le JSON avant de pousser : `python3 -m json.tool data/<fichier>.json`.

## Vérifier le rendu
`python3 -m http.server 8765` puis Playwright (préinstallé) sur http://localhost:8765/#<activite>.
