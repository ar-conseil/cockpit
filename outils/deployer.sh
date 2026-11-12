#!/bin/zsh
# Met à jour le cockpit sur Supabase, avec le seul jeton d'accès (API d'administration ; pas de mot de passe de base).
# Accès lus dans ~/.cockpit/ (jamais dans le dépôt) : supabase.env (jeton, projet), agendas.env (iCal), oauth.env (Google, Microsoft).
#   outils/deployer.sh                                   schéma, réglages, fonctions, cron, agendas iCal, config.js
#   outils/deployer.sh --depart <dossier-taches-ancien>  + REMPLACE projets, tâches, clients, factures et semaine type
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source ~/.cockpit/supabase.env; set +a
: "${SUPABASE_ACCESS_TOKEN:?jeton manquant dans ~/.cockpit/supabase.env}" "${SUPABASE_PROJECT_REF:?identifiant du projet manquant}"
SB=(npx --yes supabase@2.122.0)
API="https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF"
PRIVE=$(mktemp -d ~/.cockpit/tmp.XXXX); trap 'rm -rf "$PRIVE"' EXIT

sql() { # fichier SQL -> exécuté sur la base par l'API d'administration
  python3 -I -c 'import json,sys; print(json.dumps({"query": open(sys.argv[1]).read()}))' "$1" > "$PRIVE/corps.json"
  local code; code=$(curl -s -o "$PRIVE/reponse.json" -w '%{http_code}' -X POST "$API/database/query" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" --data-binary @"$PRIVE/corps.json")
  [[ "$code" == 2* ]] || { print "   ERREUR $code : $(head -c 600 "$PRIVE/reponse.json")"; exit 1; }
}

echo "1. Tables et droits (migrations rejouables : à n'appliquer qu'une fois chacune)"
for m in supabase/migrations/*.sql; do
  if grep -qx "$(basename "$m")" ~/.cockpit/migrations-appliquees 2>/dev/null; then echo "   déjà appliquée : $(basename "$m")"; continue; fi
  sql "$m" && basename "$m" >> ~/.cockpit/migrations-appliquees && echo "   appliquée : $(basename "$m")"
done

echo "2. Réglages de connexion (inscriptions fermées, adresse du site)"
curl -s -o /dev/null -X PATCH "$API/config/auth" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"disable_signup":true,"site_url":"https://ar-conseil.github.io/cockpit/","uri_allow_list":"https://ar-conseil.github.io/cockpit/,http://localhost:8770/","password_min_length":10}'

echo "3. Fonctions serveur et leurs secrets"
[ -f ~/.cockpit/cle-synchro ] || (openssl rand -hex 24 > ~/.cockpit/cle-synchro && chmod 600 ~/.cockpit/cle-synchro)
CLE=$(cat ~/.cockpit/cle-synchro)
printf 'CLE_SYNCHRO=%s\nSITE_URL=https://ar-conseil.github.io/cockpit/\n' "$CLE" > "$PRIVE/secrets.env"
[ -f ~/.cockpit/oauth.env ] && grep -E '^(GOOGLE|MS)_CLIENT_(ID|SECRET)=.+' ~/.cockpit/oauth.env >> "$PRIVE/secrets.env" || true
[ -f ~/.cockpit/hubspot-token ] && printf 'HUBSPOT_TOKEN=%s\n' "$(cat ~/.cockpit/hubspot-token)" >> "$PRIVE/secrets.env"
[ -f ~/.cockpit/camp-cle ] && printf 'CAMP_CLE=%s\n' "$(cat ~/.cockpit/camp-cle)" >> "$PRIVE/secrets.env"
"${SB[@]}" secrets set --project-ref "$SUPABASE_PROJECT_REF" --env-file "$PRIVE/secrets.env" >/dev/null
for f in sync-agendas agenda-connexion agenda-ecrire sync-harnes sync-camp lire-mails sync-tiime victor trier-mails ajouter-tache reponses mail chercher-mails assistant wispr-connexion wispr-veille invitation-harnes signatures; do
  "${SB[@]}" functions deploy "$f" --project-ref "$SUPABASE_PROJECT_REF" --no-verify-jwt --use-api >/dev/null && echo "   $f déployée"
done

if [[ "${1:-}" == "--depart" ]]; then
  echo "4. Données de départ (remplace les données existantes)"
  node outils/donnees-depart.mjs "${2:-}" --sql > "$PRIVE/depart.sql"
  sql "$PRIVE/depart.sql"
fi

echo "5. Agendas iCal (lecture seule)"
node --input-type=module - "$PRIVE/agendas.sql" <<'JS'
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
const f = homedir() + "/.cockpit/agendas.env";
const env = existsSync(f) ? Object.fromEntries(readFileSync(f, "utf8").split("\n")
  .filter((l) => /^AGENDA_\w+=\S/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()])) : {};
const NOMS = {
  AGENDA_GOOGLE_PERSO: ["Google – perso (iCal)", null], AGENDA_GOOGLE_FAMILLE: ["Google – Famille (iCal)", "perso"],
  AGENDA_GOOGLE_PALOMANO: ["Google – Palomano (iCal)", "palomano"], AGENDA_OUTLOOK_PALOMANO: ["Outlook – Palomano (iCal)", "palomano"],
  AGENDA_OUTLOOK_EVOA: ["Outlook – Evoa (iCal)", "evoa-courtage"], AGENDA_HARNES: ["Harnes Volley (iCal)", "harnes-volley"], AGENDA_CAMP: ["Camp Rouzier Maréchal (iCal)", "camp-rouzier-marechal"],
};
const q = (s) => s == null ? "null" : "'" + String(s).replace(/'/g, "''") + "'";
const lignes = Object.entries(env).filter(([k]) => NOMS[k]).map(([k, url]) =>
  `insert into public.agendas (nom, activite_id, ics_url) select ${q(NOMS[k][0])}, ${q(NOMS[k][1])}, ${q(url)}
   where not exists (select 1 from public.agendas where nom = ${q(NOMS[k][0])});
   update public.agendas set ics_url = ${q(url)} where nom = ${q(NOMS[k][0])};`);
writeFileSync(process.argv[2], lignes.join("\n") || "select 1;");
console.log("   " + lignes.length + " agenda(s) iCal");
JS
sql "$PRIVE/agendas.sql"

echo "6. Synchronisation automatique chaque minute"
cat > "$PRIVE/cron.sql" <<SQL
select vault.create_secret('$CLE', 'cle_synchro') where not exists (select 1 from vault.secrets where name = 'cle_synchro');
select cron.unschedule('sync-agendas') where exists (select 1 from cron.job where jobname = 'sync-agendas');
select cron.schedule('sync-agendas', '* * * * *', \$\$
  select net.http_post(
    url := 'https://$SUPABASE_PROJECT_REF.supabase.co/functions/v1/sync-agendas',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cle-synchro', (select decrypted_secret from vault.decrypted_secrets where name = 'cle_synchro')),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
\$\$);
-- Harnes (HubSpot, Billetweb) et Camp (suivi des inscriptions) : tous les quarts d'heure
select cron.unschedule(j) from unnest(array['sync-harnes', 'sync-camp']) j where exists (select 1 from cron.job where jobname = j);
select cron.schedule(j, '*/15 * * * *', format(\$f\$ select net.http_post(url := 'https://$SUPABASE_PROJECT_REF.supabase.co/functions/v1/%s',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cle-synchro', (select decrypted_secret from vault.decrypted_secrets where name = 'cle_synchro')),
    body := '{}'::jsonb, timeout_milliseconds := 60000) \$f\$, j)) from unnest(array['sync-harnes', 'sync-camp']) j;
-- Tiime (factures Berkay et Wealthy) : toutes les heures
select cron.unschedule('sync-tiime') where exists (select 1 from cron.job where jobname = 'sync-tiime');
select cron.schedule('sync-tiime', '7 * * * *', \$\$ select net.http_post(url := 'https://$SUPABASE_PROJECT_REF.supabase.co/functions/v1/sync-tiime',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cle-synchro', (select decrypted_secret from vault.decrypted_secrets where name = 'cle_synchro')),
    body := '{}'::jsonb, timeout_milliseconds := 60000) \$\$);
-- Victor (point du matin) : toutes les demi-heures de 4 h à 7 h 30 UTC ; la fonction attend 6 h 25 (Paris) et s'arrête si le point est publié
select cron.unschedule('victor') where exists (select 1 from cron.job where jobname = 'victor');
select cron.schedule('victor', '*/30 4-7 * * *', \$\$ select net.http_post(url := 'https://$SUPABASE_PROJECT_REF.supabase.co/functions/v1/victor',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cle-synchro', (select decrypted_secret from vault.decrypted_secrets where name = 'cle_synchro')),
    body := '{}'::jsonb, timeout_milliseconds := 60000) \$\$);
-- Tri des boîtes mail : toutes les 10 minutes de 5 h à 8 h 50 UTC ; la fonction attend le point de Victor du jour
select cron.unschedule('tri-mails') where exists (select 1 from cron.job where jobname = 'tri-mails');
select cron.schedule('tri-mails', '*/10 5-8 * * *', \$\$ select net.http_post(url := 'https://$SUPABASE_PROJECT_REF.supabase.co/functions/v1/trier-mails',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cle-synchro', (select decrypted_secret from vault.decrypted_secrets where name = 'cle_synchro')),
    body := '{}'::jsonb, timeout_milliseconds := 60000) \$\$);
-- Mails « À faire » : tâche terminée -> libellé retiré, libellé retiré -> tâche terminée ; toutes les 15 minutes de 5 h à 21 h UTC
select cron.unschedule('a-faire') where exists (select 1 from cron.job where jobname = 'a-faire');
select cron.schedule('a-faire', '*/15 5-21 * * *', \$\$ select net.http_post(url := 'https://$SUPABASE_PROJECT_REF.supabase.co/functions/v1/trier-mails',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cle-synchro', (select decrypted_secret from vault.decrypted_secrets where name = 'cle_synchro')),
    body := '{"a_faire": true}'::jsonb, timeout_milliseconds := 60000) \$\$);
-- Wispr Flow -> Victor : notes vocales « Victor, … » lues chaque minute sur le serveur de Wispr (sans le Mac)
select cron.unschedule('wispr') where exists (select 1 from cron.job where jobname = 'wispr');
select cron.schedule('wispr', '* * * * *', \$\$ select net.http_post(url := 'https://$SUPABASE_PROJECT_REF.supabase.co/functions/v1/wispr-veille',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cle-synchro', (select decrypted_secret from vault.decrypted_secrets where name = 'cle_synchro')),
    body := '{}'::jsonb, timeout_milliseconds := 60000) \$\$);
select cron.unschedule('menage-evenements') where exists (select 1 from cron.job where jobname = 'menage-evenements');
select cron.schedule('menage-evenements', '17 3 * * *', \$\$ delete from public.evenements where fin < now() - interval '90 days' \$\$);
SQL
sql "$PRIVE/cron.sql"

echo "7. Clé publique du site (assets/config.js)"
ANON=$(curl -s "$API/api-keys" -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" | python3 -I -c 'import json,sys; k=json.load(sys.stdin); print([x for x in k if x.get("name")=="anon"][0]["api_key"])')
cat > assets/config.js <<JS
/* Adresse du projet Supabase et clé publique (« anon »). Cette clé est faite pour être publique :
   sans connexion, la base ne renvoie rien (règles RLS). Ne jamais mettre ici la clé service_role. */
window.COCKPIT_CONFIG = {
  url: "https://$SUPABASE_PROJECT_REF.supabase.co",
  cle: "$ANON"
};
JS

echo "8. Première synchronisation"
curl -s -X POST "https://$SUPABASE_PROJECT_REF.supabase.co/functions/v1/sync-agendas" -H "x-cle-synchro: $CLE" -H "Content-Type: application/json" -d '{}' \
  | python3 -I -c 'import json,sys; r=json.load(sys.stdin); [print("   " + b["agenda"] + " : " + ("ERREUR " + b["erreur"] if "erreur" in b else str(b["evenements"]) + " rendez-vous")) for b in r.get("bilan", [])]'
echo "Terminé."
