#!/bin/bash
# Boîte IONOS de Harnes pour Victor : le mot de passe est tapé ici (sans s'afficher) et part directement
# dans les secrets chiffrés de Supabase (IONOS_EMAIL, IONOS_MOT_DE_PASSE). Il n'est écrit dans aucun fichier.
set -euo pipefail
set -a; . ~/.cockpit/supabase.env; set +a

read -r -p "Adresse IONOS [antonin.rouzier@harnes-volleyball.fr] : " EMAIL
EMAIL=${EMAIL:-antonin.rouzier@harnes-volleyball.fr}
read -r -s -p "Mot de passe de cette boîte (il ne s'affiche pas) : " MDP; echo
[ -n "$MDP" ] || { echo "Mot de passe vide : rien n'est enregistré."; exit 1; }

IONOS_EMAIL="$EMAIL" IONOS_MDP="$MDP" python3 - <<'PY'
import json, os, urllib.request
req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{os.environ['SUPABASE_PROJECT_REF']}/secrets", method="POST",
  data=json.dumps([{"name": "IONOS_EMAIL", "value": os.environ["IONOS_EMAIL"]}, {"name": "IONOS_MOT_DE_PASSE", "value": os.environ["IONOS_MDP"]}]).encode(),
  headers={"Authorization": "Bearer " + os.environ["SUPABASE_ACCESS_TOKEN"], "Content-Type": "application/json", "User-Agent": "cockpit"})
urllib.request.urlopen(req)
PY
unset MDP
echo "Enregistré. Test de lecture de la boîte (quelques secondes)…"
sleep 8
curl -s -X POST "https://$SUPABASE_PROJECT_REF.supabase.co/functions/v1/lire-mails" -H "x-cle-synchro: $(cat ~/.cockpit/cle-synchro)" -d '{}' |
  python3 -c "import json,sys; d=json.load(sys.stdin); [print('  ', b['email'], '->', b.get('erreur') or f\"{len(b['mails'])} mail(s) lus\") for b in d['boites'] if b['fournisseur']=='ionos']"
