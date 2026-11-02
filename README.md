# Cockpit AR Conseil

Tableau de bord de mes activités : une vue d'ensemble et un dashboard par activité.

| Activité | Adresse |
|---|---|
| Vue d'ensemble | `/` |
| Palomano | `/#palomano` |
| Evoa Courtage | `/#evoa-courtage` |
| Harnes Volley | `/#harnes-volley` |
| Camp Rouzier Maréchal | `/#camp-rouzier-marechal` |

Le site est fait de fichiers statiques (HTML, CSS, JavaScript), sans installation ni compilation.

## Accès protégé

Le dépôt et le site sont publics, mais **les données sont chiffrées** dans `data/coffre.json`
(PBKDF2-SHA256 + AES-GCM 256). Sans l'identifiant et le mot de passe, ce fichier est illisible.
Le déchiffrement se fait dans le navigateur au moment de la connexion. Rien n'est envoyé à un serveur.

- L'identifiant et le mot de passe **ne sont écrits nulle part dans le dépôt**. Garde-les dans ton gestionnaire de mots de passe.
- « Rester connecté sur cet appareil » garde la clé dans le navigateur jusqu'à « Se déconnecter ».
- Changer le mot de passe déconnecte tous les appareils.
- Mot de passe perdu = données illisibles. Il faudra alors refaire le coffre (voir plus bas).

## Mettre le site en ligne (une seule fois)

1. **Settings → Pages** du dépôt.
2. *Source* : **Deploy from a branch**, branche **main**, dossier **/ (root)**, puis **Save**.
3. Après 1 à 2 minutes, l'adresse s'affiche en haut de la page (du type `https://ar-conseil.github.io/cockpit/`).

Avec un compte GitHub gratuit, Pages ne marche que si le dépôt est **public** (Settings → General → Change visibility).
Les données restent protégées par le chiffrement. Ne mets jamais de fichier de données non chiffré dans le dépôt.

## Mettre à jour les chiffres

Le plus simple : ouvre une session Claude Code (claude.ai/code) sur ce dépôt et demande par exemple
« mets à jour le dashboard Evoa Courtage avec HubSpot » ou « ajoute une tâche à Harnes Volley ».
Claude ouvre le coffre, modifie, le referme et publie. Le site se met à jour en 1 à 2 minutes.

Pour ne pas avoir à redonner le mot de passe à chaque session, ajoute dans les réglages de ton
environnement cloud Claude les variables `COCKPIT_IDENTIFIANT` et `COCKPIT_MOT_DE_PASSE`.

À la main, sur un ordinateur avec Node.js :

```bash
node outils/coffre.mjs ouvrir     # déchiffre vers .donnees/ (jamais publié, ignoré par git)
# … modifier les fichiers .donnees/*.json …
node outils/coffre.mjs fermer     # rechiffre vers data/coffre.json, puis commit + push
```

Changer l'identifiant ou le mot de passe :

```bash
node outils/coffre.mjs ouvrir
COCKPIT_NOUVEL_IDENTIFIANT=… COCKPIT_NOUVEAU_MOT_DE_PASSE=… node outils/coffre.mjs changer
```

## Format d'un fichier d'activité (dans `.donnees/`)

```json
{
  "id": "palomano",                  // = nom du fichier, sert d'adresse (#palomano)
  "nom": "Palomano",
  "description": "Une phrase sous le titre.",
  "couleur": "#3fb8a6",              // couleur de repère de l'activité
  "miseAJour": "2026-11-02",
  "exemple": true,                   // passe à false (ou supprime) quand les chiffres sont réels
  "sources": ["Qonto", "Gmail"],
  "kpis": [
    { "label": "CA facturé (mois)", "valeur": 18450, "unite": "€",
      "precedent": 16200,            // optionnel : affiche l'évolution en %
      "objectif": 22000,             // optionnel : affiche une jauge
      "detail": "texte libre",       // optionnel
      "alerte": true }               // optionnel : met la tuile en orange
  ],
  "serie": { "titre": "CA par mois", "unite": "€",
             "points": [ { "label": "oct.", "valeur": 16200 } ] },
  "pipeline": [ { "etape": "Lead", "nombre": 9 } ],      // optionnel
  "taches": [ { "titre": "…", "echeance": "2026-11-05",
                "priorite": "haute|moyenne|basse",
                "statut": "a-faire|en-cours|bloque|fait" } ],
  "agenda": [ { "date": "2026-11-04T10:00", "titre": "…" } ],
  "liens": [ { "label": "Qonto", "url": "https://app.qonto.com" } ],
  "notes": "Texte libre."
}
```

Les commentaires `//` ci-dessus sont des explications : ils ne doivent pas apparaître dans les vrais fichiers JSON.

**Ajouter une activité** : crée `.donnees/mon-activite.json` sur ce modèle, ajoute `"mon-activite"` dans `.donnees/activites.json`, puis `fermer`.

## Tester sur un ordinateur

```bash
python3 -m http.server 8000
```

puis ouvrir http://localhost:8000 (un double-clic sur `index.html` ne suffit pas : le navigateur bloque la lecture du coffre).
