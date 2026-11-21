// Messagerie de l'application AR CONSEIL : toutes les boîtes d'Antonin dans un seul logiciel (Gmail perso, Camp, Palomano, Harnes).
// Session du cockpit uniquement (c'est Antonin qui lit, range et envoie).
//  POST { action: "lister", boite: "<adresse>" | "tout", suite? } -> { mails: [{ boite, nom, id, de, a, objet, date, extrait, lu, important, pieces }], suites }
//  POST { action: "ranger", boite, id, quoi: "lu" | "non_lu" | "archiver" | "corbeille" } -> { ok }   (jamais d'effacement définitif)
//  POST { action: "envoyer", boite, a, cc?, objet, texte, repondre_a? } -> { ok }   envoyé depuis cette boîte, avec sa signature
//    (Gmail : API ; Outlook : Graph, droit Mail.Send ; Harnes : SMTP IONOS, copie rangée dans les Envoyés). Envoi seulement sur clic.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { jetonAcces, type Compte } from "../_partage/fournisseurs.ts";
import { connexionImap, enTete } from "../_partage/mails.ts";
import { rangerMail } from "../_partage/ranger.ts";
import { messageHtml } from "../_partage/reponses.ts";
import { base64Lignes, enteteUtf8, envoyerSmtp } from "../_partage/smtp.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: { ...cors, "Content-Type": "application/json" } });
const NOMS: Record<string, string> = { "arouzier@gmail.com": "Gmail", "camprouziermarechal@gmail.com": "Camp", "a.rouzier@evoa-courtage.fr": "Evoa",
  "antonin.rouzier@harnes-volleyball.fr": "Harnes" };
const nom = (email: string) => NOMS[email.toLowerCase()] ?? (/palomano/i.test(email) ? "Palomano" : email.split("@")[0]);
const PAGE = 30, PAGE_TOUT = 20;
const IONOS = () => ({ email: (Deno.env.get("IONOS_EMAIL") ?? "").toLowerCase(), mdp: Deno.env.get("IONOS_MOT_DE_PASSE") ?? "",
  hote: Deno.env.get("IONOS_IMAP") || "imap.ionos.fr" });
const entites = (t: string) => t.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

async function appel(jeton: string, url: string, init: RequestInit = {}, entetes: Record<string, string> = {}) {
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json", ...entetes } });
  const t = await r.text();
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status} ${t.slice(0, 200)}`), { status: r.status });
  return t ? JSON.parse(t) : {};
}

// ---------- Lister la boîte de réception ----------
async function listerGmail(c: Compte, jeton: string, suite: string, n: number) {
  const api = "https://gmail.googleapis.com/gmail/v1/users/me";
  const l = await appel(jeton, `${api}/messages?labelIds=INBOX&maxResults=${n}${suite ? `&pageToken=${encodeURIComponent(suite)}` : ""}`);
  const ids = (l.messages ?? []).map((m: any) => m.id) as string[];
  const mails: any[] = [];
  for (let i = 0; i < ids.length; i += 10) {
    mails.push(...await Promise.all(ids.slice(i, i + 10).map(async (id) => {
      const d = await appel(jeton, `${api}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject`);
      const h = (k: string) => (d.payload?.headers ?? []).find((x: any) => x.name.toLowerCase() === k)?.value ?? "";
      const labels: string[] = d.labelIds ?? [];
      return { boite: c.email, nom: nom(c.email), id: `gmail:${id}`, fil: d.threadId, de: h("from"), a: h("to"), objet: h("subject"),
        date: new Date(+d.internalDate).toISOString(), extrait: entites(d.snippet ?? ""), lu: !labels.includes("UNREAD"),
        important: labels.includes("STARRED"), pieces: (d.payload?.mimeType ?? "").includes("mixed") };
    })));
  }
  return { mails, suite: l.nextPageToken ?? null };
}

async function listerOutlook(c: Compte, jeton: string, suite: string, n: number) {
  const saut = +suite || 0;
  const r = await appel(jeton, `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=${n}&$skip=${saut}&$orderby=receivedDateTime desc` +
    `&$select=id,subject,from,toRecipients,receivedDateTime,bodyPreview,isRead,flag,hasAttachments`, {}, { Prefer: 'IdType="ImmutableId"' });
  const mails = (r.value ?? []).map((m: any) => ({ boite: c.email, nom: nom(c.email), id: `outlook:${m.id}`,
    de: m.from?.emailAddress ? `${m.from.emailAddress.name ?? ""} <${m.from.emailAddress.address ?? ""}>` : "",
    a: (m.toRecipients ?? []).map((x: any) => x.emailAddress?.address).join(", "), objet: m.subject ?? "", date: m.receivedDateTime,
    extrait: (m.bodyPreview ?? "").replace(/\s+/g, " ").slice(0, 220), lu: !!m.isRead, important: m.flag?.flagStatus === "flagged", pieces: !!m.hasAttachments }));
  return { mails, suite: mails.length === n ? String(saut + n) : null };
}

async function listerIonos(suite: string, n: number) {
  const { email, mdp, hote } = IONOS();
  const { cmd, fermer } = await connexionImap(hote, email, mdp);
  try {
    await cmd("EXAMINE INBOX");
    const tous = (/\* SEARCH([\d ]*)/.exec(await cmd("UID SEARCH ALL"))?.[1] ?? "").trim().split(/\s+/).filter(Boolean).reverse();
    const saut = +suite || 0, uids = tous.slice(saut, saut + n);
    const mails: any[] = [];
    if (uids.length) {
      const rep = await cmd(`UID FETCH ${uids.join(",")} (UID FLAGS INTERNALDATE BODYSTRUCTURE BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT MESSAGE-ID)])`);
      for (const bloc of rep.split(/\r\n(?=\* \d+ FETCH )/)) {
        const uid = /\bUID (\d+)/.exec(bloc)?.[1];
        if (!uid) continue;
        const date = /INTERNALDATE "([^"]+)"/.exec(bloc)?.[1], drapeaux = /FLAGS \(([^)]*)\)/.exec(bloc)?.[1] ?? "";
        const i = bloc.indexOf("HEADER.FIELDS"), debut = bloc.indexOf("}\r\n", i) + 3;
        const h: Record<string, string> = {};
        for (const l of bloc.slice(debut).replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) { const k = l.indexOf(":"); if (k > 0) h[l.slice(0, k).trim().toLowerCase()] = l.slice(k + 1).trim(); }
        const mid = (h["message-id"] ?? "").replace(/^<|>$/g, "");
        mails.push({ boite: email, nom: nom(email), id: mid ? `ionos:${mid}` : `ionos:${uid}`, de: enTete(h["from"] ?? ""), a: enTete(h["to"] ?? ""),
          objet: enTete(h["subject"] ?? ""), date: date ? new Date(date.replace(/^(\d+)-(\w+)-(\d+) /, "$2 $1 $3 ")).toISOString() : null, extrait: "",
          lu: /\\Seen/.test(drapeaux), important: /\\Flagged/.test(drapeaux), pieces: /"attachment"/i.test(bloc) });
      }
      mails.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    }
    return { mails, suite: saut + n < tous.length ? String(saut + n) : null };
  } finally { await fermer(); }
}

// ---------- Envoyer ----------
const adresses = (t: string) => String(t ?? "").split(/[,;]/).map((x) => x.trim()).filter((x) => /@/.test(x));
const b64url = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function mime(de: string, a: string[], cc: string[], objet: string, texte: string, html: string | null, enReponse?: { messageId: string; references: string }) {
  const f = "ar-" + crypto.randomUUID();
  return [`From: ${enteteUtf8("Antonin Rouzier")} <${de}>`, `To: ${a.join(", ")}`, ...(cc.length ? [`Cc: ${cc.join(", ")}`] : []),
    `Subject: ${enteteUtf8(objet)}`, `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`, `Message-ID: <${crypto.randomUUID()}@${de.split("@")[1]}>`,
    ...(enReponse?.messageId ? [`In-Reply-To: ${enReponse.messageId}`, `References: ${[enReponse.references, enReponse.messageId].filter(Boolean).join(" ")}`] : []),
    "MIME-Version: 1.0",
    ...(html ? [`Content-Type: multipart/alternative; boundary="${f}"`, "", `--${f}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "",
      base64Lignes(texte), `--${f}`, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", base64Lignes(html), `--${f}--`, ""]
      : ["Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", base64Lignes(texte)])].join("\r\n");
}

async function envoyer(db: any, b: any) {
  const boite = String(b.boite ?? "").toLowerCase(), a = adresses(b.a), cc = adresses(b.cc ?? "");
  const objet = String(b.objet ?? "").trim().slice(0, 300), corps = String(b.texte ?? "").trim().slice(0, 50000);
  if (!a.length) throw new Error("destinataire manquant");
  if (!corps) throw new Error("message vide");
  const { data: sig } = await db.from("signatures").select("texte").eq("boite", boite).maybeSingle();
  const texte = sig?.texte ? `${corps}\n\n${sig.texte.trim()}` : corps;
  const html = await messageHtml(db, boite, texte);
  const [genre, ...reste] = String(b.repondre_a ?? "").split(":"), origine = reste.join(":");

  if (boite === IONOS().email) {
    let enReponse;
    if (genre === "ionos" && origine && !/^\d+$/.test(origine)) enReponse = { messageId: `<${origine}>`, references: "" };
    const message = mime(boite, a, cc, objet, texte, html, enReponse);
    await envoyerSmtp(Deno.env.get("IONOS_SMTP") || "smtp.ionos.fr", boite, IONOS().mdp, boite, [...a, ...cc], message);
    try {   // copie dans les Envoyés
      const { cmd, cite, fermer } = await connexionImap(IONOS().hote, boite, IONOS().mdp);
      try {
        const m = /\* LIST \([^)]*\\Sent[^)]*\) (?:"[^"]*"|NIL) (?:"((?:[^"\\]|\\.)*)"|(\S+))/i.exec(await cmd('LIST "" "*"'));
        await cmd(`APPEND ${cite(m ? (m[1] ?? m[2]) : "Sent")} (\\Seen) {${new TextEncoder().encode(message).length}+}\r\n${message}`);
      } finally { await fermer(); }
    } catch (e) { console.error("messagerie : copie non rangée", e instanceof Error ? e.message : e); }
    return;
  }
  const { data: c } = await db.from("comptes_agenda").select("*").eq("usage", "mail").eq("email", boite).maybeSingle();
  if (!c) throw new Error("boîte non connectée");
  const jeton = await jetonAcces(db, c as Compte);
  if (c.fournisseur === "google") {
    const api = "https://gmail.googleapis.com/gmail/v1/users/me";
    let enReponse, fil;
    if (genre === "gmail" && origine) {
      const o = await appel(jeton, `${api}/messages/${origine}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References`);
      const h = (k: string) => (o.payload?.headers ?? []).find((x: any) => x.name.toLowerCase() === k)?.value ?? "";
      enReponse = { messageId: h("message-id"), references: h("references") }; fil = o.threadId;
    }
    await appel(jeton, `${api}/messages/send`, { method: "POST", body: JSON.stringify({ raw: b64url(mime(boite, a, cc, objet, texte, html, enReponse)), ...(fil ? { threadId: fil } : {}) }) });
    return;
  }
  // Outlook
  const g = "https://graph.microsoft.com/v1.0/me", pref = { Prefer: 'IdType="ImmutableId"' };
  const contenu = html ?? texte.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>");
  const dest = (l: string[]) => l.map((x) => ({ emailAddress: { address: x.replace(/^.*<([^>]+)>.*$/, "$1") } }));
  try {
    if (genre === "outlook" && origine) {
      const brouillon = await appel(jeton, `${g}/messages/${encodeURIComponent(origine)}/createReply`, { method: "POST", body: "{}" }, pref);
      const avant = String((await appel(jeton, `${g}/messages/${encodeURIComponent(brouillon.id)}?$select=body`, {}, pref)).body?.content ?? "");
      await appel(jeton, `${g}/messages/${encodeURIComponent(brouillon.id)}`, { method: "PATCH", body: JSON.stringify({
        subject: objet || undefined, toRecipients: dest(a), ccRecipients: dest(cc),
        body: { contentType: "html", content: /<body[^>]*>/i.test(avant) ? avant.replace(/<body[^>]*>/i, (x) => `${x}${contenu}<br>`) : `${contenu}<br>${avant}` } }) }, pref);
      await appel(jeton, `${g}/messages/${encodeURIComponent(brouillon.id)}/send`, { method: "POST" }, pref);
    } else {
      await appel(jeton, `${g}/sendMail`, { method: "POST", body: JSON.stringify({ saveToSentItems: true, message: {
        subject: objet, toRecipients: dest(a), ccRecipients: dest(cc), body: { contentType: "html", content: contenu } } }) });
    }
  } catch (e: any) {
    if (e?.status === 403) throw new Error("Outlook n'autorise pas encore l'envoi depuis le cockpit : bouton « Autoriser l'envoi » sur la page Tri des boîtes.");
    throw e;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: u } = await db.auth.getUser((req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  if (!u?.user) return json({ erreur: "non autorisé" }, 401);
  const b = await req.json().catch(() => ({}));
  try {
    if (b.action === "ranger") {
      if (!["lu", "non_lu", "archiver", "corbeille"].includes(b.quoi)) return json({ erreur: "action inconnue" }, 400);
      return json({ ok: true, resultat: await rangerMail(db, String(b.boite), String(b.id), String(b.quoi)) });
    }
    if (b.action === "envoyer") { await envoyer(db, b); return json({ ok: true }); }
    // lister
    const { data: comptes } = await db.from("comptes_agenda").select("*").eq("usage", "mail");
    const boites: { email: string; lire: (suite: string, n: number) => Promise<{ mails: any[]; suite: string | null }> }[] = [];
    for (const c of (comptes ?? []) as Compte[]) {
      boites.push({ email: c.email.toLowerCase(), lire: async (s, n) => {
        const j = await jetonAcces(db, c);
        return c.fournisseur === "google" ? listerGmail(c, j, s, n) : listerOutlook(c, j, s, n);
      } });
    }
    if (IONOS().email && IONOS().mdp) boites.push({ email: IONOS().email, lire: listerIonos });
    const voulue = String(b.boite ?? "tout").toLowerCase();
    const choisies = voulue === "tout" ? boites : boites.filter((x) => x.email === voulue);
    if (!choisies.length) return json({ erreur: "boîte inconnue" }, 404);
    const suites: Record<string, string | null> = b.suites ?? {};
    const erreurs: Record<string, string> = {}, sortie: Record<string, string | null> = {};
    const lots = await Promise.all(choisies.filter((x) => voulue !== "tout" || suites[x.email] !== null).map(async (x) => {
      try { const r = await x.lire(suites[x.email] ?? "", voulue === "tout" ? PAGE_TOUT : PAGE); sortie[x.email] = r.suite; return r.mails; }
      catch (e) { erreurs[x.email] = e instanceof Error ? e.message.slice(0, 200) : String(e); sortie[x.email] = null; return []; }
    }));
    const mails = lots.flat().sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
    return json({ mails, suites: sortie, erreurs, boites: boites.map((x) => ({ email: x.email, nom: nom(x.email) })) });
  } catch (e) {
    return json({ erreur: e instanceof Error ? e.message : String(e) }, 502);
  }
});
