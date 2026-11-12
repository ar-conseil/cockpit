#!/bin/bash
# Branche Wispr Flow sur Victor, sur ce Mac (à lancer une fois, par Antonin) :
#  1. crée la clé du relais (~/.cockpit/cle-wispr, jamais affichée) et l'envoie dans les secrets de Supabase (CLE_WISPR) ;
#  2. installe le relais outils/wispr-victor.py comme service de session (launchd), relancé à chaque ouverture de session.
# Désinstaller : launchctl bootout gui/$(id -u)/fr.arconseil.wispr-victor && rm ~/Library/LaunchAgents/fr.arconseil.wispr-victor.plist
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ~/.cockpit/supabase.env; set +a
umask 077
[ -s ~/.cockpit/cle-wispr ] || openssl rand -hex 24 > ~/.cockpit/cle-wispr
python3 - <<'PY'
import json, os, urllib.request
cle = open(os.path.expanduser("~/.cockpit/cle-wispr")).read().strip()
req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{os.environ['SUPABASE_PROJECT_REF']}/secrets", method="POST",
  data=json.dumps([{"name": "CLE_WISPR", "value": cle}]).encode(),
  headers={"Authorization": "Bearer " + os.environ["SUPABASE_ACCESS_TOKEN"], "Content-Type": "application/json", "User-Agent": "cockpit"})
urllib.request.urlopen(req)
PY
echo "Clé du relais enregistrée."

# Guetteur du presse-papiers (Wispr colle les dictées par le presse-papiers)
swiftc -O -o outils/presse-papiers-victor outils/presse-papiers-victor.swift
echo "Guetteur du presse-papiers compilé."

PLIST=~/Library/LaunchAgents/fr.arconseil.wispr-victor.plist
mkdir -p ~/Library/LaunchAgents
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>fr.arconseil.wispr-victor</string>
  <key>ProgramArguments</key><array><string>/usr/bin/python3</string><string>$PWD/outils/wispr-victor.py</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardErrorPath</key><string>$HOME/.cockpit/wispr-victor.err</string>
</dict></plist>
EOF
launchctl bootout "gui/$(id -u)/fr.arconseil.wispr-victor" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Relais Wispr -> Victor installé. Dis « Victor, … » dans Wispr Flow : la réponse s'affiche en notification."
