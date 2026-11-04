#!/bin/bash
# Clé API Anthropic pour Victor en ligne : tapée ici (elle ne s'affiche pas), envoyée directement dans les secrets chiffrés
# de Supabase (ANTHROPIC_API_KEY). Rien n'est écrit dans un fichier.
set -euo pipefail
set -a; . ~/.cockpit/supabase.env; set +a

read -r -s -p "Clé API Anthropic (sk-ant-…, elle ne s'affiche pas) : " CLE; echo
[[ "$CLE" == sk-ant-* ]] || { echo "Ce n'est pas une clé Anthropic (elle commence par sk-ant-) : rien n'est enregistré."; exit 1; }

CLE_API="$CLE" python3 - <<'PY'
import json, os, urllib.request
req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{os.environ['SUPABASE_PROJECT_REF']}/secrets", method="POST",
  data=json.dumps([{"name": "ANTHROPIC_API_KEY", "value": os.environ["CLE_API"]}]).encode(),
  headers={"Authorization": "Bearer " + os.environ["SUPABASE_ACCESS_TOKEN"], "Content-Type": "application/json", "User-Agent": "cockpit"})
urllib.request.urlopen(req)
PY
unset CLE
echo "Enregistrée. Victor en ligne la prendra en compte dans quelques secondes."
