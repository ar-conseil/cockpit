// Mails récents des boîtes connectées pour Victor (comptes_agenda.usage = « mail », plus la boîte IONOS de Harnes
// par IMAP avec les secrets IONOS_EMAIL / IONOS_MOT_DE_PASSE), en lecture (EXAMINE, BODY.PEEK : rien n'est marqué lu ; le rangement est fait par trier-mails).
//  POST { depuis: ISO } avec l'en-tête x-cle-synchro -> { boites: [{ email, fournisseur, mails: [{ id, de, a, objet, recu_le, texte }], erreur? }] }
// Rien n'est stocké : les mails ne font que passer vers la routine du Mac, qui en tire le briefing.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { jetonAcces, type Compte } from "../_partage/fournisseurs.ts";
import { connexionImap, enTete, lireFetch, sansHtml } from "../_partage/mails.ts";

const CLE_SYNCHRO = Deno.env.get("CLE_SYNCHRO") ?? "";
const MAX = 80, TEXTE = 2500;
const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: { "Content-Type": "application/json" } });
const b64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));
const court = (t: string) => t.replace(/\s+/g, " ").trim().slice(0, TEXTE);

async function appel(jeton: string, url: string, entetes: Record<string, string> = {}) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${jeton}`, ...entetes } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || j?.error_description || `HTTP ${r.status}`);
  return j;
}

// deno-lint-ignore no-explicit-any
function texteGmail(partie: any): string {
  if (!partie) return "";
  if (partie.mimeType === "text/plain" && partie.body?.data) return b64(partie.body.data);
  for (const p of partie.parts ?? []) { const t = texteGmail(p); if (t) return t; }
  if (partie.mimeType === "text/html" && partie.body?.data) return sansHtml(b64(partie.body.data));
  return "";
}

async function gmail(jeton: string, depuis: Date) {
  const q = `in:inbox after:${Math.floor(depuis.getTime() / 1000)} -category:promotions -category:social`;
  const liste = await appel(jeton, `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${MAX}&q=${encodeURIComponent(q)}`);
  const mails = [];
  for (const m of liste.messages ?? []) {
    const d = await appel(jeton, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`);
    const h = (n: string) => (d.payload?.headers ?? []).find((x: { name: string }) => x.name.toLowerCase() === n)?.value ?? "";
    mails.push({ id: `gmail:${m.id}`, de: h("from"), a: h("to"), objet: h("subject"), recu_le: new Date(+d.internalDate).toISOString(),
      texte: court(texteGmail(d.payload) || d.snippet || "") });
  }
  return mails;
}

async function outlook(jeton: string, depuis: Date) {
  const url = `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=${MAX}&$orderby=receivedDateTime desc` +
    `&$filter=receivedDateTime ge ${depuis.toISOString()}&$select=id,subject,from,toRecipients,receivedDateTime,body`;
  const r = await appel(jeton, url, { Prefer: 'outlook.body-content-type="text"' });
  // deno-lint-ignore no-explicit-any
  return (r.value ?? []).map((m: any) => ({
    id: `outlook:${m.id}`, de: m.from?.emailAddress ? `${m.from.emailAddress.name ?? ""} <${m.from.emailAddress.address ?? ""}>` : "",
    // deno-lint-ignore no-explicit-any
    a: (m.toRecipients ?? []).map((x: any) => x.emailAddress?.address).join(", "), objet: m.subject ?? "", recu_le: m.receivedDateTime,
    texte: court(m.body?.content ?? ""),
  }));
}

// IONOS : EXAMINE (lecture seule) et BODY.PEEK, rien n'est marqué lu.
async function imap(hote: string, utilisateur: string, motDePasse: string, depuis: Date) {
  const { cmd, fermer } = await connexionImap(hote, utilisateur, motDePasse);
  try {
    await cmd("EXAMINE INBOX");
    const mois = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][depuis.getUTCMonth()];
    const uids = (/\* SEARCH([\d ]*)/.exec(await cmd(`UID SEARCH SINCE ${depuis.getUTCDate()}-${mois}-${depuis.getUTCFullYear()}`))?.[1] ?? "")
      .trim().split(/\s+/).filter(Boolean).slice(-MAX);
    const mails = [];
    for (const uid of uids) {
      const { recu, h, texte } = lireFetch(await cmd(`UID FETCH ${uid} (INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT CONTENT-TYPE CONTENT-TRANSFER-ENCODING)] BODY.PEEK[TEXT]<0.12000>)`));
      if (recu < depuis) continue;
      mails.push({ id: `ionos:${uid}`, de: enTete(h["from"] ?? ""), a: enTete(h["to"] ?? ""), objet: enTete(h["subject"] ?? ""), recu_le: recu.toISOString(),
        texte: court(texte) });
    }
    return mails.reverse();
  } finally { await fermer(); }
}

Deno.serve(async (req) => {
  if (!(CLE_SYNCHRO && req.headers.get("x-cle-synchro") === CLE_SYNCHRO)) return json({ erreur: "non autorisé" }, 401);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const corps = await req.json().catch(() => ({}));
  const depuis = new Date(Math.max(Date.parse(corps.depuis ?? "") || 0, Date.now() - 72 * 3600e3));
  const { data: comptes } = await db.from("comptes_agenda").select("*").eq("usage", "mail");
  const boites = [];
  for (const c of (comptes ?? []) as Compte[]) {
    try {
      const jeton = await jetonAcces(db, c);
      boites.push({ email: c.email, fournisseur: c.fournisseur, mails: c.fournisseur === "google" ? await gmail(jeton, depuis) : await outlook(jeton, depuis) });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await db.from("comptes_agenda").update({ derniere_erreur: message.slice(0, 300) }).eq("id", c.id);
      boites.push({ email: c.email, fournisseur: c.fournisseur, mails: [], erreur: message });
    }
  }
  const ionos = { email: Deno.env.get("IONOS_EMAIL") ?? "", mdp: Deno.env.get("IONOS_MOT_DE_PASSE") ?? "" };
  if (ionos.email && ionos.mdp) {
    try { boites.push({ email: ionos.email, fournisseur: "ionos", mails: await imap(Deno.env.get("IONOS_IMAP") || "imap.ionos.fr", ionos.email, ionos.mdp, depuis) }); }
    catch (e) { boites.push({ email: ionos.email, fournisseur: "ionos", mails: [], erreur: e instanceof Error ? e.message : String(e) }); }
  }
  return json({ depuis: depuis.toISOString(), boites });
});
