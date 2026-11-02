# Cockpit AR Conseil

Tableau de bord de mes activités : une vue d'ensemble et un dashboard par activité.

| Activité | Page | Fichier de données |
|---|---|---|
| Vue d'ensemble | `#` | `data/activites.json` (liste et ordre des activités) |
| Palomano | `#palomano` | `data/palomano.json` |
| Evoa Courtage | `#evoa-courtage` | `data/evoa-courtage.json` |
| Harnes Volley | `#harnes-volley` | `data/harnes-volley.json` |
| Camp Rouzier Maréchal | `#camp-rouzier-marechal` | `data/camp-rouzier-marechal.json` |

Le site est fait de fichiers statiques (HTML, CSS, JavaScript), sans installation ni compilation.
Tout se modifie directement sur github.com.

## Mettre le site en ligne (une seule fois)

1. **Settings → Pages** du dépôt.
2. *Source* : **Deploy from a branch**, branche **main**, dossier **/ (root)**, puis **Save**.
3. Après 1 à 2 minutes, l'adresse s'affiche en haut de la page (du type `https://ar-conseil.github.io/cockpit/`).

> ⚠️ Un site GitHub Pages est **public** : toute personne qui a l'adresse voit les chiffres.
> Avec un compte GitHub gratuit, Pages ne marche que si le dépôt est public.
> Ne mets pas dans `data/` d'informations que tu ne veux pas rendre visibles.

## Mettre à jour les chiffres

- **Depuis le site** : sur la page d'une activité, bouton **« Modifier les données »**. Il ouvre le fichier sur GitHub ;
  modifie, puis **Commit changes**. Le site se met à jour en 1 à 2 minutes.
- **Avec Claude** : ouvre une session Claude Code sur ce dépôt et demande par exemple
  « mets à jour le dashboard Evoa Courtage avec HubSpot » ou « actualise la trésorerie Palomano depuis Qonto ».

## Format d'un fichier d'activité

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

**Ajouter une activité** : crée `data/mon-activite.json` sur ce modèle, puis ajoute `"mon-activite"` dans `data/activites.json`.

## Tester sur un ordinateur

```bash
python3 -m http.server 8000
```

puis ouvrir http://localhost:8000 (un double-clic sur `index.html` ne suffit pas : le navigateur bloque la lecture des fichiers de données).
