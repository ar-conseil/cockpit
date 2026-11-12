#!/bin/bash
# Clés des notifications du téléphone (Web Push, VAPID) : créées ici et envoyées directement dans les secrets
# de Supabase (VAPID_PUBLIQUE, VAPID_PRIVEE). La clé privée n'est écrite dans aucun fichier. À lancer une fois, par Antonin.
set -euo pipefail
set -a; . ~/.cockpit/supabase.env; set +a
CLES=$(npx --yes web-push@3.6.7 generate-vapid-keys --json)
CLES="$CLES" python3 - <<'PY'
import json, os, urllib.request
k = json.loads(os.environ["CLES"])
req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{os.environ['SUPABASE_PROJECT_REF']}/secrets", method="POST",
  data=json.dumps([{"name": "VAPID_PUBLIQUE", "value": k["publicKey"]}, {"name": "VAPID_PRIVEE", "value": k["privateKey"]}]).encode(),
  headers={"Authorization": "Bearer " + os.environ["SUPABASE_ACCESS_TOKEN"], "Content-Type": "application/json", "User-Agent": "cockpit"})
urllib.request.urlopen(req)
PY
unset CLES
echo "Clés des notifications enregistrées. Ouvre l'appli Victor depuis l'écran d'accueil et touche « Notifications »."
