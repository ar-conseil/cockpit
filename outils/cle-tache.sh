#!/bin/bash
# Clé personnelle du Raccourci iPhone « Tâche pour Victor » (fonction ajouter-tache) : tirée au hasard, posée dans les
# secrets chiffrés de Supabase (CLE_TACHE), affichée UNE fois et copiée dans le presse-papiers (collable sur l'iPhone
# grâce au presse-papiers universel), puis effacée. Rien n'est écrit dans un fichier.
# Relancer le script remplace la clé : l'ancienne ne marche plus (à faire si le téléphone est perdu).
set -euo pipefail
set -a; . ~/.cockpit/supabase.env; set +a

CLE=$(python3 -I -c 'import secrets; print(secrets.token_urlsafe(24))')
CLE_TACHE="$CLE" python3 -I - <<'PY'
import json, os, urllib.request
req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{os.environ['SUPABASE_PROJECT_REF']}/secrets", method="POST",
  data=json.dumps([{"name": "CLE_TACHE", "value": os.environ["CLE_TACHE"]}]).encode(),
  headers={"Authorization": "Bearer " + os.environ["SUPABASE_ACCESS_TOKEN"], "Content-Type": "application/json", "User-Agent": "cockpit"})
urllib.request.urlopen(req)
PY

printf '%s' "$CLE" | pbcopy
echo "Nouvelle clé enregistrée (l'ancienne ne marche plus). À coller dans le raccourci, en-tête x-cle-tache :"
echo
echo "    $CLE"
echo
echo "Elle est aussi dans le presse-papiers : sur l'iPhone (même compte Apple, Bluetooth et Wi-Fi allumés), « Coller » la colle."
read -r -p "Appuyer sur Entrée une fois collée : l'écran et le presse-papiers seront effacés. "
printf '' | pbcopy
unset CLE
clear
echo "Clé effacée de l'écran et du presse-papiers. Elle ne sera plus affichée : en cas de perte, relancer outils/cle-tache.sh."
