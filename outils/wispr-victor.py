#!/usr/bin/env python3
# Relais Wispr Flow -> Victor, sur le Mac d'Antonin (lancé par launchd, voir outils/wispr-installer.sh).
# Toutes les 2 secondes, lit (en lecture seule) l'historique local de Wispr Flow ; une dictée qui commence par « Victor »
# (« Victor, ajoute… », « Hey Victor … ») est envoyée à l'agent du cockpit (fonction assistant, clé ~/.cockpit/cle-wispr),
# et sa réponse s'affiche en notification macOS. Rien d'autre n'est lu ni envoyé : les autres dictées restent sur le Mac.
# Journal minimal (heure, statut, sans le texte) dans ~/.cockpit/wispr-victor.log.
import json, os, re, sqlite3, subprocess, time, urllib.request, urllib.error
from datetime import datetime, timezone

BASE = os.path.expanduser("~/Library/Application Support/Wispr Flow/flow.sqlite")
ETAT = os.path.expanduser("~/.cockpit/wispr-victor.etat")
JOURNAL = os.path.expanduser("~/.cockpit/wispr-victor.log")
URL = "https://piuqaqjdegkwwhlwputf.supabase.co/functions/v1/assistant"
APPEL = re.compile(r"^\s*(?:(?:hey|hé|eh|ok|okay|dis|allo|allô)[\s,]+)?victor\b[\s,.:;!?-]*", re.I)


def noter(msg):
    with open(JOURNAL, "a") as f:
        f.write(f"{datetime.now():%Y-%m-%d %H:%M:%S} {msg}\n")


def notifier(titre, texte):
    t = texte.replace("\\", "\\\\").replace('"', '\\"')[:230]
    subprocess.run(["osascript", "-e", f'display notification "{t}" with title "{titre}" sound name "Glass"'], check=False)


def cle():
    with open(os.path.expanduser("~/.cockpit/cle-wispr")) as f:
        return f.read().strip()


def envoyer(phrase):
    req = urllib.request.Request(URL, method="POST", data=json.dumps({"texte": phrase, "source": "wispr"}).encode(),
                                 headers={"Content-Type": "application/json", "x-cle-wispr": cle(), "User-Agent": "cockpit-wispr"})
    try:
        with urllib.request.urlopen(req, timeout=140) as r:
            return True, json.loads(r.read()).get("texte", "C'est fait.")
    except urllib.error.HTTPError as e:
        try:
            return False, json.loads(e.read()).get("texte") or f"refusé (HTTP {e.code})"
        except Exception:
            return False, f"refusé (HTTP {e.code})"
    except Exception as e:
        return False, f"cockpit injoignable ({type(e).__name__})"


def lire_depuis(depuis):
    con = sqlite3.connect(f"file:{BASE}?mode=ro", uri=True, timeout=2)
    try:
        return con.execute(
            "select transcriptEntityId, timestamp, coalesce(nullif(formattedText,''), asrText) from History "
            "where timestamp > ? and coalesce(nullif(formattedText,''), asrText) is not null order by timestamp", (depuis,)).fetchall()
    finally:
        con.close()


def main():
    if os.path.exists(ETAT):
        depuis = open(ETAT).read().strip()
    else:  # premier lancement : seules les dictées à venir comptent
        depuis = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.000 +00:00")
    vus = set()
    noter("relais démarré")
    while True:
        try:
            for ident, horodatage, texte in lire_depuis(depuis):
                if ident in vus:
                    continue
                vus.add(ident)
                depuis = horodatage
                with open(ETAT, "w") as f:
                    f.write(depuis)
                m = APPEL.match(texte or "")
                if not m:
                    continue
                phrase = texte[m.end():].strip()
                if len(phrase) < 3:
                    continue
                notifier("Victor", "Je m'en occupe…")
                ok, reponse = envoyer(phrase)
                noter(f"demande transmise : {'ok' if ok else 'échec'}")
                notifier("Victor" if ok else "Victor : non traité", reponse)
            if len(vus) > 500:
                vus = set(list(vus)[-200:])
        except sqlite3.Error as e:
            noter(f"lecture Wispr impossible : {e}")
            time.sleep(10)
        except Exception as e:
            noter(f"erreur : {type(e).__name__} {e}")
        time.sleep(2)


if __name__ == "__main__":
    main()
