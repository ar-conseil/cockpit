#!/usr/bin/env python3
# Relais Wispr Flow -> Victor, sur le Mac d'Antonin (lancé par launchd, voir outils/wispr-installer.sh).
# Deux sources : le guetteur du presse-papiers (outils/presse-papiers-victor, Wispr colle chaque dictée par le presse-papiers ;
# indispensable avec un compte qui ne garde pas l'historique, comme celui d'Evoa), et l'historique local de Wispr Flow (lecture seule).
# Une dictée qui commence par « Victor »
# (« Victor, ajoute… », « Hey Victor … ») est envoyée à l'agent du cockpit (fonction assistant, clé ~/.cockpit/cle-wispr),
# et sa réponse s'affiche en notification macOS. Rien d'autre n'est lu ni envoyé : les autres dictées restent sur le Mac.
# Journal minimal (heure, statut, sans le texte) dans ~/.cockpit/wispr-victor.log.
import json, os, re, sqlite3, subprocess, threading, time, urllib.request, urllib.error
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


GUETTEUR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "presse-papiers-victor")
recents = {}  # phrase normalisée -> heure : la même dictée vue par les deux sources n'est envoyée qu'une fois
verrou = threading.Lock()


def traiter(texte):
    m = APPEL.match(texte or "")
    if not m:
        return
    phrase = texte[m.end():].strip()
    if len(phrase) < 3:
        return
    cle_n = re.sub(r"\W+", " ", phrase.lower()).strip()
    with verrou:
        maintenant = time.time()
        for k in [k for k, t in recents.items() if maintenant - t > 120]:
            del recents[k]
        if cle_n in recents:
            return
        recents[cle_n] = maintenant
    notifier("Victor", "Je m'en occupe…")
    ok, reponse = envoyer(phrase)
    noter(f"demande transmise : {'ok' if ok else 'échec'}")
    notifier("Victor" if ok else "Victor : non traité", reponse)


def guetter_presse_papiers():
    while True:
        if not os.path.exists(GUETTEUR):
            noter("guetteur du presse-papiers absent : relancer outils/wispr-installer.sh")
            return
        try:
            p = subprocess.Popen([GUETTEUR], stdout=subprocess.PIPE, text=True)
            noter("guetteur du presse-papiers démarré")
            for ligne in p.stdout:
                try:
                    texte = json.loads(ligne).get("texte", "")
                except ValueError:
                    continue
                threading.Thread(target=traiter, args=(texte,), daemon=True).start()
        except Exception as e:
            noter(f"guetteur : {type(e).__name__} {e}")
        time.sleep(5)


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
    threading.Thread(target=guetter_presse_papiers, daemon=True).start()
    while True:
        try:
            for ident, horodatage, texte in lire_depuis(depuis):
                if ident in vus:
                    continue
                vus.add(ident)
                depuis = horodatage
                with open(ETAT, "w") as f:
                    f.write(depuis)
                traiter(texte)
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
