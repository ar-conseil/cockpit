#!/bin/bash
# Clé partagée entre le cockpit et Evoalys (synchronisation des tâches Evoa). À lancer une fois, par Antonin :
#  1. la clé est créée et envoyée dans les secrets de Supabase (EVOALYS_CLE), sans être écrite dans un fichier ;
#  2. elle est copiée dans le presse-papiers : la coller chez Scaleway comme variable secrète COCKPIT_CLE du conteneur Evoalys.
set -euo pipefail
set -a; . ~/.cockpit/supabase.env; set +a
CLE=$(openssl rand -hex 32)
CLE="$CLE" python3 - <<'PY'
import json, os, urllib.request
req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{os.environ['SUPABASE_PROJECT_REF']}/secrets", method="POST",
  data=json.dumps([{"name": "EVOALYS_CLE", "value": os.environ["CLE"]}, {"name": "EVOALYS_URL", "value": "https://app.evoalys.com"}]).encode(),
  headers={"Authorization": "Bearer " + os.environ["SUPABASE_ACCESS_TOKEN"], "Content-Type": "application/json", "User-Agent": "cockpit"})
urllib.request.urlopen(req)
PY
printf %s "$CLE" | pbcopy
unset CLE
cat <<'TXT'
Clé enregistrée côté cockpit, et copiée dans le presse-papiers.
Chez Scaleway : Serverless Containers › conteneur Evoalys › Variables d'environnement › Secrets :
  ajouter COCKPIT_CLE = (coller), puis déployer. Ensuite, vider le presse-papiers (copier autre chose).
TXT
