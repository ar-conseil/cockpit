// Ranger un mail (Gmail, Outlook, IONOS) : corbeille (récupérable 30 jours), archiver (sort de la réception), lu, non_lu.
// Utilisé par l'agent Victor (assistant) et la messagerie du cockpit. Jamais de suppression définitive.
import { jetonAcces, type Compte } from "./fournisseurs.ts";
import { connexionImap } from "./mails.ts";

export async function appel(jeton: string, url: string, init: RequestInit = {}) {
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} ${t.slice(0, 160)}`);
  return t ? JSON.parse(t) : {};
}

// deno-lint-ignore no-explicit-any
export async function rangerMail(db: any, boite: string, id: string, action: string) {
  const [genre, ...reste] = id.split(":"), mid = reste.join(":");
  if (genre === "ionos") {
    const { cmd, cite, fermer } = await connexionImap(Deno.env.get("IONOS_IMAP") || "imap.ionos.fr", Deno.env.get("IONOS_EMAIL") ?? "", Deno.env.get("IONOS_MOT_DE_PASSE") ?? "");
    try {
      const lignes = [...(await cmd('LIST "" "*"')).matchAll(/^\* LIST \(([^)]*)\) (?:"[^"]*"|NIL) (?:"((?:[^"\\]|\\.)*)"|(\S+))\r?$/gm)]
        .map((x) => ({ attr: x[1], nom: (x[2] ?? x[3]).replace(/\\(.)/g, "$1") })).filter((x) => !/\\Noselect/i.test(x.attr));
      const corbeille = lignes.find((x) => /\\Trash/i.test(x.attr))?.nom ?? lignes.find((x) => /trash|corbeille|papierkorb/i.test(x.nom))?.nom;
      const archive = lignes.find((x) => /\\Archive/i.test(x.attr))?.nom ?? lignes.find((x) => /archiv/i.test(x.nom))?.nom;
      for (const d of lignes.map((x) => x.nom)) {
        await cmd(`SELECT ${cite(d)}`);
        const uid = /\* SEARCH ?(\d+)?/.exec(await cmd(`UID SEARCH HEADER Message-ID ${cite("<" + mid + ">")}`))?.[1];
        if (!uid) continue;
        if (action === "lu" || action === "non_lu") { await cmd(`UID STORE ${uid} ${action === "lu" ? "+" : "-"}FLAGS.SILENT (\\Seen)`); return "fait"; }
        const cible = action === "corbeille" ? corbeille : archive;
        if (!cible) throw new Error(`dossier ${action === "corbeille" ? "Corbeille" : "Archives"} introuvable sur IONOS`);
        if (d === cible) return "déjà fait";
        try { await cmd(`UID MOVE ${uid} ${cite(cible)}`); } catch {
          await cmd(`UID COPY ${uid} ${cite(cible)}`); await cmd(`UID STORE ${uid} +FLAGS.SILENT (\\Deleted)`); await cmd(`UID EXPUNGE ${uid}`);
        }
        return "fait";
      }
      throw new Error("mail introuvable dans la boîte Harnes");
    } finally { await fermer(); }
  }
  const { data: c } = await db.from("comptes_agenda").select("*").eq("usage", "mail").eq("email", boite).maybeSingle();
  if (!c) throw new Error("boîte non connectée");
  const jeton = await jetonAcces(db, c as Compte);
  if (genre === "gmail") {
    const u = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(mid)}`;
    if (action === "corbeille") await appel(jeton, `${u}/trash`, { method: "POST" });
    else await appel(jeton, `${u}/modify`, { method: "POST", body: JSON.stringify(
      action === "archiver" ? { removeLabelIds: ["INBOX"] } : action === "lu" ? { removeLabelIds: ["UNREAD"] } : { addLabelIds: ["UNREAD"] }) });
    return "fait";
  }
  const u = `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(mid)}`, pref = { Prefer: 'IdType="ImmutableId"' };
  if (action === "corbeille" || action === "archiver")
    await appel(jeton, `${u}/move`, { method: "POST", headers: pref, body: JSON.stringify({ destinationId: action === "corbeille" ? "deleteditems" : "archive" }) });
  else await appel(jeton, u, { method: "PATCH", headers: pref, body: JSON.stringify({ isRead: action === "lu" }) });
  return "fait";
}
