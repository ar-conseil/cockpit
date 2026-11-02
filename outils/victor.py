#!/usr/bin/env python3
"""Victor, l'assistant du matin du cockpit (lancé par la routine planifiée du Mac).

  python3 outils/victor.py contexte           JSON du jour : agenda, tâches ouvertes, projets, mails déjà traités
  python3 outils/victor.py publier note.json  enregistre le briefing et les tâches proposées, place les créneaux ORIAS

Accès lus dans ~/.cockpit/ (supabase.env, cle-synchro) : rien de secret dans le dépôt.
Format de note.json :
  { "resume": "…", "priorites": [{ "titre", "activite_id", "pourquoi" }],
    "mails": [{ "boite", "de", "objet", "resume", "action" }],
    "propositions": [{ "cle", "titre", "activite_id", "notes", "echeance", "priorite", "source": { "boite", "de", "objet", "recu_le" } }] }
"""
import json, os, sys, urllib.request
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

PARIS = ZoneInfo("Europe/Paris")
PRIVE = os.path.expanduser("~/.cockpit")
ORIAS_MINUTES, DEBUT_JOURNEE, FIN_JOURNEE, MARGE = 120, 8 * 60, 19 * 60, 10  # minutes


def env():
    v = {}
    for ligne in open(os.path.join(PRIVE, "supabase.env")):
        if "=" in ligne and not ligne.startswith("#"):
            k, _, val = ligne.strip().partition("=")
            v[k] = val.strip().strip('"')
    return v


E = env()
REF, JETON = E["SUPABASE_PROJECT_REF"], E["SUPABASE_ACCESS_TOKEN"]


def sql(requete):
    req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{REF}/database/query", method="POST",
                                 data=json.dumps({"query": requete}).encode(),
                                 headers={"Authorization": "Bearer " + JETON, "Content-Type": "application/json", "User-Agent": "cockpit-victor"})
    return json.load(urllib.request.urlopen(req, timeout=60))


def litteral(valeur):
    """Valeur JSON en littéral SQL sûr (guillemets dollar avec une étiquette absente du texte)."""
    texte = json.dumps(valeur, ensure_ascii=False)
    etiquette = "v"
    while f"${etiquette}$" in texte:
        etiquette += "x"
    return f"${etiquette}${texte}${etiquette}$"


def contexte():
    r = sql("""
      with j as (select (now() at time zone 'Europe/Paris')::date as d)
      select json_build_object(
        'aujourdhui', (select d from j),
        'maintenant', to_char(now() at time zone 'Europe/Paris', 'YYYY-MM-DD"T"HH24:MI'),
        'projets', (select json_agg(json_build_object('id', id, 'nom', nom, 'mots_cles', mots_cles) order by ordre) from activites),
        'agenda', (select coalesce(json_agg(json_build_object(
            'titre', e.titre, 'debut', to_char(e.debut at time zone 'Europe/Paris', 'YYYY-MM-DD"T"HH24:MI'),
            'fin', to_char(e.fin at time zone 'Europe/Paris', 'YYYY-MM-DD"T"HH24:MI'), 'journee', e.journee,
            'projet', coalesce(e.activite_forcee, e.activite_id), 'lieu', e.lieu) order by e.debut), '[]')
          from evenements e join agendas g on g.id = e.agenda_id, j
          where g.actif and not e.annule and e.fin > (j.d::timestamp at time zone 'Europe/Paris')
            and e.debut < ((j.d + 2)::timestamp at time zone 'Europe/Paris')),
        'taches', (select coalesce(json_agg(json_build_object('titre', t.titre, 'projet', t.activite_id, 'echeance', t.echeance,
            'priorite', t.priorite, 'statut', t.statut) order by t.echeance nulls last), '[]')
          from taches t, j where t.statut <> 'fait' and (t.echeance is null or t.echeance <= j.d + 7)),
        'cles_deja_traitees', (select coalesce(json_agg(cle), '[]') from propositions where cree_le > now() - interval '45 days'),
        'propositions_en_attente', (select count(*) from propositions where statut = 'proposee'),
        'derniere_lecture', (select max(mise_a_jour) from briefings)
      ) as c""")
    print(json.dumps(r[0]["c"], ensure_ascii=False, indent=1))


def minutes(dt):
    return dt.hour * 60 + dt.minute


def creneaux_orias(jour, maintenant):
    """Trous de la journée (8 h – 19 h, en semaine) pour atteindre 2 h d'ORIAS, en complétant ce qui est déjà posé."""
    if jour.weekday() >= 5:
        return [], 0
    evs = sql(f"""
      select e.titre, to_char(e.debut at time zone 'Europe/Paris', 'HH24:MI') d, to_char(e.fin at time zone 'Europe/Paris', 'HH24:MI') f,
             (e.debut at time zone 'Europe/Paris')::date dj, (e.fin at time zone 'Europe/Paris')::date fj
      from evenements e join agendas g on g.id = e.agenda_id
      where g.actif and not e.annule and not e.journee and e.fin - e.debut < interval '10 hours'  -- pas les séjours de plusieurs jours
        and e.fin > ('{jour}'::timestamp at time zone 'Europe/Paris') and e.debut < (('{jour}'::date + 1)::timestamp at time zone 'Europe/Paris')""")
    occupe, deja = [], 0
    for e in evs:
        d = 0 if e["dj"] < str(jour) else int(e["d"][:2]) * 60 + int(e["d"][3:])
        f = 24 * 60 if e["fj"] > str(jour) else int(e["f"][:2]) * 60 + int(e["f"][3:])
        occupe.append((d, f))
        if "orias" in (e["titre"] or "").lower():
            deja += f - d
    reste = ORIAS_MINUTES - deja
    if reste <= 0:
        return [], deja
    depart = DEBUT_JOURNEE
    if maintenant.date() == jour:
        depart = max(depart, -(-(minutes(maintenant) + 5) // 15) * 15)  # quart d'heure suivant
    blocs, curseur = [], depart
    for d, f in sorted(occupe) + [(FIN_JOURNEE, FIN_JOURNEE)]:
        fin_trou = min(d - MARGE, FIN_JOURNEE)
        if fin_trou - curseur >= min(60, reste) and reste > 0:
            duree = min(reste, (fin_trou - curseur) // 15 * 15)
            if duree >= min(60, reste):
                blocs.append((curseur, curseur + duree)); reste -= duree
        curseur = max(curseur, f + MARGE)
        if curseur >= FIN_JOURNEE or reste <= 0:
            break
    return blocs, deja


def poser_orias(jour, blocs):
    ag = sql("""select g.id from agendas g join comptes_agenda c on c.id = g.compte_id
                where c.fournisseur = 'google' and g.externe_id = c.email and g.ecriture limit 1""")
    if not ag:
        print("Victor : pas d'agenda Google modifiable pour les créneaux ORIAS", file=sys.stderr)
        return []
    cle = open(os.path.join(PRIVE, "cle-synchro")).read().strip()
    poses = []
    for d, f in blocs:
        debut = datetime(jour.year, jour.month, jour.day, d // 60, d % 60, tzinfo=PARIS)
        fin = datetime(jour.year, jour.month, jour.day, f // 60, f % 60, tzinfo=PARIS)
        corps = {"action": "creer", "agenda_id": ag[0]["id"], "titre": "Formation ORIAS", "lieu": "Courtage Academy",
                 "debut": debut.isoformat(), "fin": fin.isoformat(), "journee": False, "activite_forcee": "evoa-courtage"}
        req = urllib.request.Request(f"https://{REF}.supabase.co/functions/v1/agenda-ecrire", method="POST", data=json.dumps(corps).encode(),
                                     headers={"x-cle-synchro": cle, "Content-Type": "application/json"})
        try:
            urllib.request.urlopen(req, timeout=60).read()
            poses.append((d, f))
        except Exception as e:
            print(f"Victor : créneau ORIAS non posé ({e})", file=sys.stderr)
    return poses


def publier(fichier):
    note = json.load(open(fichier))
    maintenant = datetime.now(PARIS)
    jour = maintenant.date()
    blocs, deja = creneaux_orias(jour, maintenant)
    poses = poser_orias(jour, blocs) if blocs else []
    orias = deja + sum(f - d for d, f in poses)

    # Emploi du temps du jour : rendez-vous (créneaux ORIAS compris) dans l'ordre
    evs = sql(f"""
      select e.titre, coalesce(e.activite_forcee, e.activite_id) projet, e.journee,
             to_char(e.debut at time zone 'Europe/Paris', 'HH24:MI') debut, to_char(e.fin at time zone 'Europe/Paris', 'HH24:MI') fin
      from evenements e join agendas g on g.id = e.agenda_id
      where g.actif and not e.annule and e.fin > ('{jour}'::timestamp at time zone 'Europe/Paris')
        and e.debut < (('{jour}'::date + 1)::timestamp at time zone 'Europe/Paris')
      order by e.journee desc, e.debut""")
    planning = [{"debut": "journée" if e["journee"] else e["debut"], "fin": "" if e["journee"] else e["fin"], "titre": e["titre"],
                 "type": "orias" if "orias" in (e["titre"] or "").lower() else "rdv", "activite_id": e["projet"]} for e in evs]

    projets = {p["id"] for p in sql("select id from activites")}
    def projet(x):
        return x if x in projets else None

    priorites = [{**p, "activite_id": projet(p.get("activite_id"))} for p in note.get("priorites", [])][:6]
    sql(f"""insert into briefings (jour, resume, priorites, mails, planning, orias_minutes, mise_a_jour)
            values ('{jour}', {litteral(note.get('resume', ''))}::json #>> '{{}}', {litteral(priorites)}::jsonb,
                    {litteral(note.get('mails', [])[:12])}::jsonb, {litteral(planning)}::jsonb, {orias}, now())
            on conflict (jour) do update set resume = excluded.resume, priorites = excluded.priorites, mails = excluded.mails,
              planning = excluded.planning, orias_minutes = excluded.orias_minutes, mise_a_jour = now()""")

    nouvelles = 0
    for p in note.get("propositions", []):
        if not p.get("cle") or not p.get("titre"):
            continue
        ligne = {"cle": p["cle"], "titre": p["titre"][:200], "activite_id": projet(p.get("activite_id")), "notes": p.get("notes"),
                 "echeance": p.get("echeance") or None, "priorite": p.get("priorite") if p.get("priorite") in ("haute", "moyenne", "basse") else "moyenne",
                 "source": p.get("source") or {}}
        r = sql(f"""insert into propositions (cle, titre, activite_id, notes, echeance, priorite, source)
                    select x.cle, x.titre, x.activite_id, x.notes, x.echeance, x.priorite, x.source
                    from jsonb_populate_record(null::propositions, {litteral(ligne)}::jsonb) x
                    on conflict (cle) do nothing returning id""")
        nouvelles += len(r)
    print(json.dumps({"ok": True, "jour": str(jour), "orias_minutes": orias, "creneaux_poses": [f"{d//60:02d}:{d%60:02d}-{f//60:02d}:{f%60:02d}" for d, f in poses],
                      "propositions_nouvelles": nouvelles, "mails": len(note.get("mails", []))}, ensure_ascii=False))


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "contexte":
        contexte()
    elif len(sys.argv) >= 3 and sys.argv[1] == "publier":
        publier(sys.argv[2])
    else:
        print(__doc__)
        sys.exit(1)
