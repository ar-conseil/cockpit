// Lecture d'un mail depuis le cockpit (clic sur un « mail à traiter » du point de Victor), pour la session de l'utilisateur connecté.
//  POST { boite: "lille@palomano.com", id: "outlook:…" | "gmail:…" | "ionos:<Message-ID>" }
//  -> { boite, de, a, cc, date, objet, texte, pieces: [noms], lien }   (lien : le mail dans Gmail ou Outlook sur le web)
// Lecture seule : rien n'est marqué lu, déplacé ni stocké. Le texte est rendu en texte brut dans le cockpit (jamais de HTML du mail).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { jetonAcces, type Compte } from "../_partage/fournisseurs.ts";
import { base64, connexionImap, decoder, enTete, lireFetch } from "../_partage/mails.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: { ...cors, "Content-Type": "application/json" } });
const TEXTE_MAX = 40000;

// HTML -> texte en gardant les paragraphes (le texte brut du mail est préféré quand il existe)
const entites = (t: string) => t.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const htmlEnTexte = (h: string) => entites(h.replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
  .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d|blockquote|table)>/gi, "\n").replace(/<li[^>]*>/gi, "• ").replace(/<[^>]+>/g, ""));
const propre = (t: string) => t.replace(/\r/g, "").replace(/[ \t ]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, TEXTE_MAX);

async function appel(jeton: string, url: string, entetes: Record<string, string> = {}) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${jeton}`, ...entetes } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j?.error?.message || `HTTP ${r.status}`), { status: r.status });
  return j;
}

// deno-lint-ignore no-explicit-any
function partiesGmail(p: any, acc: { texte: string; html: string; pieces: string[] }) {
  if (!p) return acc;
  const donnees = (d: string) => decoder(base64(d.replace(/-/g, "+").replace(/_/g, "/")), /charset="?([^";]+)/i.exec(p.headers?.find((h: { name: string }) => /content-type/i.test(h.name))?.value ?? "")?.[1] ?? "utf-8");
  if (p.filename) acc.pieces.push(p.filename);
  else if (p.mimeType === "text/plain" && p.body?.data && !acc.texte) acc.texte = donnees(p.body.data);
  else if (p.mimeType === "text/html" && p.body?.data && !acc.html) acc.html = donnees(p.body.data);
  for (const x of p.parts ?? []) partiesGmail(x, acc);
  return acc;
}

// deno-lint-ignore no-explicit-any
async function gmail(db: any, c: Compte, id: string) {
  const jeton = await jetonAcces(db, c);
  const d = await appel(jeton, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`);
  const h = (n: string) => (d.payload?.headers ?? []).find((x: { name: string }) => x.name.toLowerCase() === n)?.value ?? "";
  const p = partiesGmail(d.payload, { texte: "", html: "", pieces: [] });
  return { de: h("from"), a: h("to"), cc: h("cc"), date: new Date(+d.internalDate).toISOString(), objet: h("subject"),
    texte: propre(p.texte || htmlEnTexte(p.html) || d.snippet || ""), pieces: p.pieces,
    lien: `https://mail.google.com/mail/u/${encodeURIComponent(c.email)}/#all/${d.threadId}` };
}

// deno-lint-ignore no-explicit-any
async function outlook(db: any, c: Compte, id: string) {
  const jeton = await jetonAcces(db, c);
  const pref = { Prefer: 'outlook.body-content-type="text", IdType="ImmutableId"' };
  const m = await appel(jeton, `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(id)}` +
    `?$select=subject,from,toRecipients,ccRecipients,receivedDateTime,body,webLink,hasAttachments`, pref);
  // deno-lint-ignore no-explicit-any
  const adr = (l: any[]) => (l ?? []).map((x) => x.emailAddress?.name ? `${x.emailAddress.name} <${x.emailAddress.address}>` : x.emailAddress?.address).join(", ");
  const pieces = m.hasAttachments
    // deno-lint-ignore no-explicit-any
    ? ((await appel(jeton, `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(id)}/attachments?$select=name,isInline`, pref).catch(() => ({}))).value ?? []).filter((x: any) => !x.isInline).map((x: any) => x.name)
    : [];
  return { de: adr([m.from]), a: adr(m.toRecipients), cc: adr(m.ccRecipients), date: m.receivedDateTime, objet: m.subject ?? "",
    texte: propre(m.body?.content ?? ""), pieces, lien: m.webLink ?? "https://outlook.office.com/mail/" };
}

// IONOS : le mail est cherché par son Message-ID dans tous les dossiers (la réception d'abord), en lecture seule (EXAMINE, BODY.PEEK).
async function ionos(id: string) {
  const { cmd, cite, fermer } = await connexionImap(Deno.env.get("IONOS_IMAP") || "imap.ionos.fr", Deno.env.get("IONOS_EMAIL") ?? "", Deno.env.get("IONOS_MOT_DE_PASSE") ?? "");
  try {
    const dossiers = [...(await cmd('LIST "" "*"')).matchAll(/^\* LIST \(([^)]*)\) (?:"[^"]*"|NIL) (?:"((?:[^"\\]|\\.)*)"|(\S+))\r?$/gm)]
      .filter((x) => !/\\Noselect/i.test(x[1])).map((x) => (x[2] ?? x[3]).replace(/\\(.)/g, "$1"))
      .sort((a, b) => (b.toUpperCase() === "INBOX" ? 1 : 0) - (a.toUpperCase() === "INBOX" ? 1 : 0));
    const recherche = /^\d+$/.test(id) ? null : `UID SEARCH HEADER Message-ID ${cite("<" + id + ">")}`;
    for (const d of dossiers) {
      await cmd(`EXAMINE ${cite(d)}`);
      const uid = recherche ? /\* SEARCH ?(\d+)?/.exec(await cmd(recherche))?.[1] : (d.toUpperCase() === "INBOX" ? id : undefined);
      if (!uid) continue;
      const { recu, h, texte } = lireFetch(await cmd(`UID FETCH ${uid} (INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM TO CC SUBJECT CONTENT-TYPE CONTENT-TRANSFER-ENCODING)] BODY.PEEK[TEXT]<0.80000>)`));
      return { de: enTete(h["from"] ?? ""), a: enTete(h["to"] ?? ""), cc: enTete(h["cc"] ?? ""), date: recu.toISOString(), objet: enTete(h["subject"] ?? ""),
        texte: propre(texte), pieces: [], lien: "https://mail.ionos.fr/", dossier: d };
    }
    return null;
  } finally { await fermer(); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  // Session du cockpit, ou appel interne de l'assistant (clé de synchro)
  const interne = !!Deno.env.get("CLE_SYNCHRO") && req.headers.get("x-cle-synchro") === Deno.env.get("CLE_SYNCHRO");
  if (!interne) {
    const { data: u } = await db.auth.getUser((req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
    if (!u?.user) return json({ erreur: "non autorisé" }, 401);
  }
  const b = await req.json().catch(() => ({}));
  const [genre, ...reste] = String(b.id ?? "").split(":"), id = reste.join(":"), boite = String(b.boite ?? "");
  if (!id || !boite) return json({ erreur: "mail non précisé" }, 400);
  try {
    if (genre === "ionos") {
      const m = await ionos(id);
      return m ? json({ boite, ...m }) : json({ erreur: "Ce mail n'est plus dans la boîte (supprimé ?)." }, 404);
    }
    const { data: c } = await db.from("comptes_agenda").select("*").eq("usage", "mail").eq("email", boite).maybeSingle();
    if (!c) return json({ erreur: "Boîte non connectée au cockpit." }, 404);
    // jetonAcces enregistre le jeton renouvelé : on lui passe le client de service
    const compte = c as Compte, lire = genre === "gmail" ? gmail : outlook;
    const m = await lire(db, compte, id).catch(async (e: { status?: number }) => {
      if (e?.status !== 404 && e?.status !== 400) throw e;
      return null;
    });
    return m ? json({ boite, ...m }) : json({ erreur: "Ce mail a été déplacé ou supprimé depuis le point de Victor.",
      lien: genre === "gmail" ? `https://mail.google.com/mail/u/${encodeURIComponent(boite)}/` : "https://outlook.office.com/mail/" }, 404);
  } catch (e) {
    return json({ erreur: e instanceof Error ? e.message : String(e) }, 502);
  }
});
