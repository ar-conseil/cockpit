#!/bin/bash
# Connexion automatique à Tiime pour le cockpit : e-mail et mot de passe Tiime tapés ici (le mot de passe ne s'affiche pas),
# envoyés directement dans les secrets chiffrés de Supabase (TIIME_EMAIL, TIIME_MOT_DE_PASSE). Rien n'est écrit dans un fichier.
set -euo pipefail
set -a; . ~/.cockpit/supabase.env; set +a

read -r -p "E-mail de connexion Tiime : " EMAIL
read -r -s -p "Mot de passe Tiime (il ne s'affiche pas) : " MDP; echo
[ -n "$EMAIL" ] && [ -n "$MDP" ] || { echo "E-mail ou mot de passe vide : rien n'est enregistré."; exit 1; }

TIIME_EMAIL="$EMAIL" TIIME_MDP="$MDP" python3 - <<'PY'
import json, os, urllib.request
req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{os.environ['SUPABASE_PROJECT_REF']}/secrets", method="POST",
  data=json.dumps([{"name": "TIIME_EMAIL", "value": os.environ["TIIME_EMAIL"]}, {"name": "TIIME_MOT_DE_PASSE", "value": os.environ["TIIME_MDP"]}]).encode(),
  headers={"Authorization": "Bearer " + os.environ["SUPABASE_ACCESS_TOKEN"], "Content-Type": "application/json", "User-Agent": "cockpit"})
urllib.request.urlopen(req)
PY
unset MDP
echo "Enregistré. Test de la connexion à Tiime (quelques secondes)…"
sleep 8
curl -s -X POST "https://$SUPABASE_PROJECT_REF.supabase.co/functions/v1/sync-tiime" -H "x-cle-synchro: $(cat ~/.cockpit/cle-synchro)" -d '{"apercu":true}' |
  python3 -c "import json,sys; d=json.load(sys.stdin); print('  ', d.get('erreur') or f\"Connexion réussie : {d['nombre']} factures lues dans Tiime.\")"
