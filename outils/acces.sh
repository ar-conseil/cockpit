#!/bin/zsh
# Assistant de saisie des accès du cockpit. Les valeurs collées ne s'affichent pas et restent sur ce Mac,
# dans ~/.cockpit/ (hors du dépôt). Entrée sans rien coller = garder la valeur actuelle.
set -u
mkdir -p ~/.cockpit && chmod 700 ~/.cockpit

typeset -A VAL
lire() { # fichier
  [[ -f "$1" ]] || return
  while IFS= read -r ligne; do
    [[ "$ligne" == \#* || "$ligne" != *=* ]] && continue
    VAL[${ligne%%=*}]="${ligne#*=}"
  done < "$1"
}
lire ~/.cockpit/supabase.env
lire ~/.cockpit/agendas.env
lire ~/.cockpit/oauth.env

demander() { # cle question secret(oui/non)
  local actuel="${VAL[$1]:-}" etat saisie
  [[ -n "$actuel" ]] && etat="déjà rempli" || etat="vide"
  print -n "\n$2\n  ($etat) > "
  if [[ "$3" == oui ]]; then read -rs saisie; print; else read -r saisie; fi
  saisie="${saisie//[[:space:]]/}"
  [[ -n "$saisie" ]] && VAL[$1]="$saisie" && print "  ✓ enregistré"
}

print "=== Supabase ==="
demander SUPABASE_PROJECT_REF "Identifiant du projet (dans l'adresse : supabase.com/dashboard/project/XXXXXXXX)" non
demander SUPABASE_ACCESS_TOKEN "Jeton d'accès (Account preferences > Access Tokens, commence par sbp_)" oui
demander SUPABASE_DB_PASSWORD "Mot de passe de la base (choisi à la création du projet)" oui

print "\n=== Agendas : adresse iCal secrète (Entrée pour passer) ==="
demander AGENDA_GOOGLE_PERSO "Google, agenda principal (Paramètres > Intégrer l'agenda > Adresse secrète au format iCal)" oui
demander AGENDA_GOOGLE_FAMILLE "Google, agenda Famille" oui
demander AGENDA_GOOGLE_PALOMANO "Google, agenda Palomano" oui
demander AGENDA_OUTLOOK_PALOMANO "Outlook Palomano (Calendriers partagés > Publier > lien ICS)" oui
demander AGENDA_OUTLOOK_EVOA "Outlook Evoa (lien ICS)" oui
demander AGENDA_HARNES "Agenda Harnes Volley, s'il existe" oui
demander AGENDA_CAMP "Agenda Camp Rouzier Maréchal, s'il existe" oui

print "\n=== Connexion Google et Microsoft (pour modifier vos rendez-vous depuis le cockpit ; Entrée pour passer) ==="
demander GOOGLE_CLIENT_ID "Google : ID client OAuth (se termine par .apps.googleusercontent.com)" non
demander GOOGLE_CLIENT_SECRET "Google : code secret du client (commence par GOCSPX-)" oui
demander MS_CLIENT_ID "Microsoft : ID d'application (client), du type 1a2b3c4d-…" non
demander MS_CLIENT_SECRET "Microsoft : valeur du secret client" oui

umask 077
{
  print "# Accès Supabase du COCKPIT (compte perso). Fichier PRIVÉ, jamais sur GitHub. Rempli par outils/acces.sh"
  for k in SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_REF SUPABASE_DB_PASSWORD; do print "$k=${VAL[$k]:-}"; done
} > ~/.cockpit/supabase.env
{
  print "# Adresses iCal SECRÈTES. Fichier PRIVÉ, jamais sur GitHub. Rempli par outils/acces.sh"
  for k in AGENDA_GOOGLE_PERSO AGENDA_GOOGLE_FAMILLE AGENDA_GOOGLE_PALOMANO AGENDA_OUTLOOK_PALOMANO AGENDA_OUTLOOK_EVOA AGENDA_HARNES AGENDA_CAMP; do print "$k=${VAL[$k]:-}"; done
} > ~/.cockpit/agendas.env
{
  print "# Accès OAuth Google et Microsoft du cockpit. Fichier PRIVÉ, jamais sur GitHub. Rempli par outils/acces.sh"
  for k in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET MS_CLIENT_ID MS_CLIENT_SECRET; do print "$k=${VAL[$k]:-}"; done
} > ~/.cockpit/oauth.env
chmod 600 ~/.cockpit/*.env

print "\n=== Bilan ==="
for k in SUPABASE_PROJECT_REF SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD AGENDA_GOOGLE_PERSO AGENDA_GOOGLE_FAMILLE AGENDA_GOOGLE_PALOMANO AGENDA_OUTLOOK_PALOMANO AGENDA_OUTLOOK_EVOA AGENDA_HARNES AGENDA_CAMP GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET MS_CLIENT_ID MS_CLIENT_SECRET; do
  [[ -n "${VAL[$k]:-}" ]] && print "  ✓ $k" || print "  · $k (vide)"
done
print "\nC'est enregistré. Vous pouvez revenir dans Claude et écrire « c'est fait »."
