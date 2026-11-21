#!/bin/sh
# Assemble la scène du logo et three.js en un seul fichier servi par le cockpit (assets/ar-conseil-3d.js).
# Une fois : npm install three@0.170.0 esbuild@0.24.2   (node_modules ne s'enregistre pas dans le dépôt)
cd "$(dirname "$0")" && npx esbuild logo3d.src.js --bundle --minify --format=iife --target=es2019 --legal-comments=none \
  --banner:js="/* Logo AR CONSEIL en 3D. Contient three.js r170, licence MIT, Copyright 2010-2024 three.js authors. Source : outils/logo3d. */" \
  --outfile=../../assets/ar-conseil-3d.js
