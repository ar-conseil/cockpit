// Signatures des boîtes mail (table signatures) : ajoutées par Victor à ce qu'il rédige depuis chaque boîte (brouillons, invitations).
//  POST { action: "releve" } (clé de synchro) -> fin des 4 derniers mails envoyés de chaque boîte (après retrait des citations),
//  pour en tirer la signature ; les signatures se corrigent ensuite dans le cockpit (page Tri des boîtes).
// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { jetonAcces, type Compte } from "../_partage/fournisseurs.ts";
import { connexionImap, lireFetch, sansHtml, base64, decoder } from "../_partage/mails.ts";

const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: { "Content-Type": "application/json" } });
const fin = (t: string) => {
  const sans = t.replace(/\r/g, "").split(/\n(?:Le .{5,120} a écrit ?:|On .{5,120} wrote:|-{2,} ?(?:Message d'origine|Original Message)|De ?: .+\n(?:Envoyé|Date) ?:|From: .+\n(?:Sent|Date):|_{8,})/)[0];
  return sans.split("\n").map((l) => l.trimEnd()).filter((l, i, a) => l || (a[i - 1] ?? "")).slice(-22).join("\n").trim();
};
async function appel(jeton: string, url: string, h: Record<string, string> = {}) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${jeton}`, ...h } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
function texteGmail(p: any): string {
  if (!p) return "";
  const d = (x: string) => decoder(base64(x.replace(/-/g, "+").replace(/_/g, "/")));
  if (p.mimeType === "text/plain" && p.body?.data) return d(p.body.data);
  for (const x of p.parts ?? []) { const t = texteGmail(x); if (t) return t; }
  if (p.mimeType === "text/html" && p.body?.data) return sansHtml(d(p.body.data).replace(/<br\s*\/?>|<\/(p|div|tr)>/gi, "\n"));
  return "";
}

Deno.serve(async (req) => {
  if (!(Deno.env.get("CLE_SYNCHRO") && req.headers.get("x-cle-synchro") === Deno.env.get("CLE_SYNCHRO"))) return json({ erreur: "non autorisé" }, 401);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: comptes } = await db.from("comptes_agenda").select("*").eq("usage", "mail");
  const sortie: Record<string, string[]> = {};
  for (const c of (comptes ?? []) as Compte[]) {
    try {
      const j = await jetonAcces(db, c);
      if (c.fournisseur === "google") {
        const l = await appel(j, "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=4&q=in%3Asent");
        sortie[c.email] = await Promise.all((l.messages ?? []).map(async (m: any) =>
          fin(texteGmail((await appel(j, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`)).payload))));
      } else {
        const l = await appel(j, "https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages?$top=4&$select=body&$orderby=sentDateTime desc",
          { Prefer: 'outlook.body-content-type="text"' });
        sortie[c.email] = (l.value ?? []).map((m: any) => fin(m.body?.content ?? ""));
      }
    } catch (e) { sortie[c.email] = [`erreur : ${e instanceof Error ? e.message : e}`]; }
  }
  const email = Deno.env.get("IONOS_EMAIL") ?? "";
  if (email) {
    try {
      const { cmd, cite, fermer } = await connexionImap(Deno.env.get("IONOS_IMAP") || "imap.ionos.fr", email, Deno.env.get("IONOS_MOT_DE_PASSE") ?? "");
      try {
        const liste = await cmd('LIST "" "*"');
        const m = /\* LIST \([^)]*\\Sent[^)]*\) (?:"[^"]*"|NIL) (?:"((?:[^"\\]|\\.)*)"|(\S+))/i.exec(liste);
        await cmd(`EXAMINE ${cite(m ? (m[1] ?? m[2]) : "Sent")}`);
        const uids = (/\* SEARCH([\d ]*)/.exec(await cmd("UID SEARCH ALL"))?.[1] ?? "").trim().split(/\s+/).filter(Boolean).slice(-4);
        sortie[email] = [];
        for (const u of uids) sortie[email].push(fin(lireFetch(await cmd(`UID FETCH ${u} (INTERNALDATE BODY.PEEK[HEADER.FIELDS (CONTENT-TYPE CONTENT-TRANSFER-ENCODING)] BODY.PEEK[TEXT]<0.20000>)`)).texte));
      } finally { await fermer(); }
    } catch (e) { sortie[email] = [`erreur : ${e instanceof Error ? e.message : e}`]; }
  }
  return json(sortie);
});
