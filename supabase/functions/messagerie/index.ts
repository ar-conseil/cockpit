// Messagerie de l'application AR CONSEIL : une vraie boîte mail (comme Outlook) pour toutes les boîtes d'Antonin
// (Gmail perso, Camp, Palomano, Harnes). Session du cockpit uniquement : c'est Antonin qui lit, range et envoie.
//  { action: "dossiers", boite }                         -> dossiers (réception, envoyés, brouillons, corbeille, indésirables, siens)
//  { action: "lister", boite | "tout", dossier?, q?, suites? } -> mails du dossier (recherche avec q)
//  { action: "lire", boite, id, dossier? }               -> en-têtes, texte, HTML, pièces jointes (images intégrées comprises)
//  { action: "piece", boite, id, piece, dossier? }       -> une pièce jointe (base64)
//  { action: "ranger", boite, id, quoi, dossier? }       -> lu | non_lu | drapeau | sans_drapeau | archiver | corbeille | reception
//  { action: "deplacer", boite, id, vers, dossier? }     -> vers un autre dossier (identifiant donné par « dossiers »)
//  { action: "envoyer" | "brouillon", boite, mode, origine?, a, cc?, cci?, objet, texte, pieces?, brouillon_id? }
//       mode : nouveau | repondre | repondre_tous | transferer ; pièces : [{ nom, type, contenu (base64) }] ; signature de la boîte ajoutée.
//       Envoi seulement sur clic d'Antonin. Rien n'est jamais effacé définitivement (corbeille, récupérable).
// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { jetonAcces, type Compte } from "../_partage/fournisseurs.ts";
import { connexionImap, enTete } from "../_partage/mails.ts";
import { analyser } from "../_partage/mime.ts";
import { messageHtml } from "../_partage/reponses.ts";
import { enteteUtf8, envoyerSmtp } from "../_partage/smtp.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: { ...cors, "Content-Type": "application/json" } });
const NOMS: Record<string, string> = { "arouzier@gmail.com": "Gmail", "camprouziermarechal@gmail.com": "Camp", "a.rouzier@evoa-courtage.fr": "Evoa",
  "antonin.rouzier@harnes-volleyball.fr": "Harnes" };
const nom = (email: string) => NOMS[email.toLowerCase()] ?? (/palomano/i.test(email) ? "Palomano" : email.split("@")[0]);
const PAGE = 30, PAGE_TOUT = 20, IMAGE_MAX = 400_000;
const IONOS = () => ({ email: (Deno.env.get("IONOS_EMAIL") ?? "").toLowerCase(), mdp: Deno.env.get("IONOS_MOT_DE_PASSE") ?? "",
  hote: Deno.env.get("IONOS_IMAP") || "imap.ionos.fr" });
const entites = (t: string) => t.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const b64 = (o: Uint8Array) => { let s = ""; for (let i = 0; i < o.length; i += 0x8000) s += String.fromCharCode(...o.subarray(i, i + 0x8000)); return btoa(s); };
const deB64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const b64url = (o: Uint8Array) => b64(o).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const lignes76 = (s: string) => s.replace(/.{1,76}/g, "$&\r\n").trim();
const echapper = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const adresses = (t: unknown) => String(t ?? "").split(/[,;]/).map((x) => x.trim()).filter((x) => /@/.test(x));
const nue = (x: string) => (/<([^>]+)>/.exec(x)?.[1] ?? x).trim().toLowerCase();

class ErreurHttp extends Error { constructor(m: string, public status: number) { super(m); } }
async function appel(jeton: string, url: string, init: RequestInit = {}, entetes: Record<string, string> = {}) {
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json", ...entetes } });
  const t = await r.text();
  if (!r.ok) throw new ErreurHttp(`HTTP ${r.status} ${t.slice(0, 200)}`, r.status);
  return t ? JSON.parse(t) : {};
}

// ---------- Message MIME (Gmail et Harnes) : texte, HTML, pièces jointes ----------
type PieceJointe = { nom: string; type: string; octets: Uint8Array };
function mime(o: { de: string; a: string[]; cc: string[]; objet: string; texte: string; html: string | null; pieces: PieceJointe[];
  enReponse?: { messageId: string; references: string } | null }) {
  const id = crypto.randomUUID(), alt = "alt-" + id, mix = "mix-" + id;
  const enc = (t: string) => lignes76(b64(new TextEncoder().encode(t)));
  const corps = o.html
    ? [`Content-Type: multipart/alternative; boundary="${alt}"`, "", `--${alt}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "",
      enc(o.texte), `--${alt}`, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", enc(o.html), `--${alt}--`]
    : ["Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", enc(o.texte)];
  const tete = [`From: ${enteteUtf8("Antonin Rouzier")} <${o.de}>`, `To: ${o.a.join(", ")}`, ...(o.cc.length ? [`Cc: ${o.cc.join(", ")}`] : []),
    `Subject: ${enteteUtf8(o.objet)}`, `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`, `Message-ID: <${id}@${o.de.split("@")[1]}>`,
    ...(o.enReponse?.messageId ? [`In-Reply-To: ${o.enReponse.messageId}`, `References: ${[o.enReponse.references, o.enReponse.messageId].filter(Boolean).join(" ")}`] : []),
    "MIME-Version: 1.0"];
  if (!o.pieces.length) return [...tete, ...corps, ""].join("\r\n");
  return [...tete, `Content-Type: multipart/mixed; boundary="${mix}"`, "", `--${mix}`, ...corps, "",
    ...o.pieces.flatMap((p) => [`--${mix}`, `Content-Type: ${p.type || "application/octet-stream"}; name="${enteteUtf8(p.nom)}"`,
      `Content-Disposition: attachment; filename="${enteteUtf8(p.nom)}"`, "Content-Transfer-Encoding: base64", "", lignes76(b64(p.octets))]),
    `--${mix}--`, ""].join("\r\n");
}
// Citation du message d'origine, sous la réponse (Gmail et Harnes ; Outlook la met lui-même)
function citer(o: { de: string; date: string; texte: string; html: string; objet: string; a: string }, mode: string) {
  const quand = o.date ? new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", dateStyle: "full", timeStyle: "short" }).format(new Date(o.date)) : "";
  if (mode === "transferer") {
    const t = `\n\n---------- Message transféré ----------\nDe : ${o.de}\nDate : ${quand}\nObjet : ${o.objet}\nÀ : ${o.a}\n\n${o.texte}`;
    const h = `<br><div style="border-top:1px solid #ccc;padding-top:8px;color:#555">---------- Message transféré ----------<br>De : ${echapper(o.de)}<br>Date : ${quand}<br>Objet : ${echapper(o.objet)}<br>À : ${echapper(o.a)}</div><br>${o.html || echapper(o.texte).replace(/\n/g, "<br>")}`;
    return { t, h };
  }
  const t = `\n\nLe ${quand}, ${o.de} a écrit :\n${o.texte.split("\n").map((l) => "> " + l).join("\n")}`;
  const h = `<br><div style="color:#555">Le ${quand}, ${echapper(o.de)} a écrit :</div><blockquote style="margin:0 0 0 .8ex;border-left:2px solid #ccc;padding-left:1ex">${o.html || echapper(o.texte).replace(/\n/g, "<br>")}</blockquote>`;
  return { t, h };
}

// ---------- Gmail ----------
function gmail(c: Compte, jeton: string) {
  const api = "https://gmail.googleapis.com/gmail/v1/users/me";
  const g = (chemin: string, init?: RequestInit) => appel(jeton, api + chemin, init);
  const SYSTEME: Record<string, [string, string]> = { INBOX: ["reception", "Boîte de réception"], STARRED: ["etoile", "Suivis"], SENT: ["envoyes", "Envoyés"],
    DRAFT: ["brouillons", "Brouillons"], SPAM: ["indesirables", "Courrier indésirable"], TRASH: ["corbeille", "Corbeille"] };
  const parties = (p: any, acc: any, chemin = "0") => {
    if (!p) return acc;
    const h = (k: string) => (p.headers ?? []).find((x: any) => x.name.toLowerCase() === k)?.value ?? "";
    const cid = h("content-id").replace(/^<|>$/g, "") || null;
    if (p.filename || p.body?.attachmentId && !/^text\//.test(p.mimeType)) {
      acc.pieces.push({ id: p.partId || chemin, piece: p.body?.attachmentId ?? null, nom: p.filename || `image-${acc.pieces.length + 1}`, type: p.mimeType, taille: p.body?.size ?? 0, cid,
        donnees: p.body?.data ?? null });
    } else if (p.mimeType === "text/plain" && p.body?.data && !acc.texte) acc.texte = new TextDecoder().decode(deB64(p.body.data));
    else if (p.mimeType === "text/html" && p.body?.data && !acc.html) acc.html = new TextDecoder().decode(deB64(p.body.data));
    (p.parts ?? []).forEach((x: any, i: number) => parties(x, acc, `${chemin}.${i}`));
    return acc;
  };
  const lireBrut = async (id: string) => {
    const d = await g(`/messages/${id}?format=full`);
    const h = (k: string) => (d.payload?.headers ?? []).find((x: any) => x.name.toLowerCase() === k)?.value ?? "";
    const p = parties(d.payload, { texte: "", html: "", pieces: [] });
    return { d, h, p };
  };
  return {
    async dossiers() {
      const l = (await g("/labels")).labels ?? [];
      const voulus = l.filter((x: any) => SYSTEME[x.id] || x.type === "user");
      const infos = await Promise.all(voulus.map((x: any) => g(`/labels/${x.id}`).catch(() => x)));
      return infos.map((x: any) => ({ id: x.id, nom: SYSTEME[x.id]?.[1] ?? x.name, type: SYSTEME[x.id]?.[0] ?? "perso",
        non_lus: x.id === "DRAFT" || x.id === "SENT" ? 0 : x.messagesUnread ?? 0, total: x.messagesTotal ?? 0 }))
        .sort((a: any, b: any) => (Object.keys(SYSTEME).indexOf(a.id) + 1 || 99) - (Object.keys(SYSTEME).indexOf(b.id) + 1 || 99) || a.nom.localeCompare(b.nom, "fr"));
    },
    async lister(dossier: string, q: string, suite: string, n: number) {
      const etiquette = dossier || "INBOX";
      const l = await g(`/messages?maxResults=${n}${q ? `&q=${encodeURIComponent(q)}` : ""}${q && !dossier ? "" : `&labelIds=${encodeURIComponent(etiquette)}`}${suite ? `&pageToken=${encodeURIComponent(suite)}` : ""}`);
      const ids = (l.messages ?? []).map((m: any) => m.id) as string[];
      const mails: any[] = [];
      for (let i = 0; i < ids.length; i += 10) mails.push(...await Promise.all(ids.slice(i, i + 10).map(async (id) => {
        const d = await g(`/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject`);
        const h = (k: string) => (d.payload?.headers ?? []).find((x: any) => x.name.toLowerCase() === k)?.value ?? "";
        const lab: string[] = d.labelIds ?? [];
        return { boite: c.email, nom: nom(c.email), id: `gmail:${id}`, dossier: etiquette, de: h("from"), a: h("to"), objet: h("subject"),
          date: new Date(+d.internalDate).toISOString(), extrait: entites(d.snippet ?? ""), lu: !lab.includes("UNREAD"), important: lab.includes("STARRED"),
          brouillon: lab.includes("DRAFT"), pieces: /mixed/.test(d.payload?.mimeType ?? "") };
      })));
      return { mails, suite: l.nextPageToken ?? null };
    },
    async lire(id: string) {
      const { d, h, p } = await lireBrut(id);
      const images: Record<string, string> = {};
      for (const x of p.pieces.filter((x: any) => x.cid && x.taille < IMAGE_MAX && /^image\//.test(x.type))) {
        const data = x.donnees ?? (await g(`/messages/${id}/attachments/${x.piece}`).catch(() => ({}))).data;
        if (data) images[x.cid] = `data:${x.type};base64,${data.replace(/-/g, "+").replace(/_/g, "/")}`;
      }
      const lab: string[] = d.labelIds ?? [];
      return { de: h("from"), a: h("to"), cc: h("cc"), date: new Date(+d.internalDate).toISOString(), objet: h("subject"), texte: p.texte, html: p.html,
        messageId: h("message-id"), references: h("references"), fil: d.threadId, brouillon: lab.includes("DRAFT"), lu: !lab.includes("UNREAD"),
        important: lab.includes("STARRED"), images, lien: `https://mail.google.com/mail/u/${encodeURIComponent(c.email)}/#all/${d.threadId}`,
        pieces: p.pieces.filter((x: any) => !(x.cid && images[x.cid] && p.html.includes("cid:" + x.cid))).map((x: any) => ({ id: x.id, nom: x.nom, type: x.type, taille: x.taille })) };
    },
    async piece(id: string, piece: string) {
      const { p } = await lireBrut(id);
      const x = p.pieces.find((y: any) => y.id === piece);
      if (!x) throw new Error("pièce jointe introuvable");
      const data = x.donnees ?? (await g(`/messages/${id}/attachments/${x.piece}`)).data;
      return { nom: x.nom, type: x.type, contenu: data.replace(/-/g, "+").replace(/_/g, "/") };
    },
    async ranger(id: string, quoi: string) {
      const mod = (ajout: string[], retrait: string[]) => g(`/messages/${id}/modify`, { method: "POST", body: JSON.stringify({ addLabelIds: ajout, removeLabelIds: retrait }) });
      if (quoi === "corbeille") return g(`/messages/${id}/trash`, { method: "POST" });
      if (quoi === "reception") { const d = await g(`/messages/${id}?format=minimal`); if ((d.labelIds ?? []).includes("TRASH")) await g(`/messages/${id}/untrash`, { method: "POST" }); return mod(["INBOX"], ["SPAM"]); }
      return quoi === "lu" ? mod([], ["UNREAD"]) : quoi === "non_lu" ? mod(["UNREAD"], []) : quoi === "drapeau" ? mod(["STARRED"], [])
        : quoi === "sans_drapeau" ? mod([], ["STARRED"]) : mod([], ["INBOX"]);
    },
    async deplacer(id: string, vers: string, depuis: string) {
      if (vers === "TRASH") return g(`/messages/${id}/trash`, { method: "POST" });
      const retrait = ["INBOX", ...(depuis && !["INBOX", "STARRED", "SENT", "DRAFT", "SPAM", "TRASH"].includes(depuis) ? [depuis] : [])].filter((x) => x !== vers);
      return g(`/messages/${id}/modify`, { method: "POST", body: JSON.stringify({ addLabelIds: [vers], removeLabelIds: retrait }) });
    },
    async origine(id: string) {
      const { d, h, p } = await lireBrut(id);
      const pieces: PieceJointe[] = [];
      for (const x of p.pieces.filter((y: any) => !y.cid || y.nom.includes("."))) {
        const data = x.donnees ?? (await g(`/messages/${id}/attachments/${x.piece}`)).data;
        pieces.push({ nom: x.nom, type: x.type, octets: deB64(data) });
      }
      return { de: h("from"), a: h("to"), cc: h("cc"), date: new Date(+d.internalDate).toISOString(), objet: h("subject"), texte: p.texte || "", html: p.html || "",
        messageId: h("message-id"), references: h("references"), fil: d.threadId, pieces };
    },
    async ecrire(raw: string, fil: string | null, envoyer: boolean, brouillonId: string | null) {
      const message = { raw: b64url(new TextEncoder().encode(raw)), ...(fil ? { threadId: fil } : {}) };
      if (envoyer) {
        await g("/messages/send", { method: "POST", body: JSON.stringify(message) });
        if (brouillonId) await g(`/drafts/${brouillonId}`, { method: "DELETE" }).catch(() => null);   // le brouillon vient de partir
        return null;
      }
      const r = brouillonId ? await g(`/drafts/${brouillonId}`, { method: "PUT", body: JSON.stringify({ message }) })
        : await g("/drafts", { method: "POST", body: JSON.stringify({ message }) });
      return r.id as string;
    },
    async brouillonDe(id: string) {   // identifiant du brouillon Gmail d'un message du dossier Brouillons
      const l = await g(`/drafts?maxResults=100`);
      return (l.drafts ?? []).find((x: any) => x.message?.id === id)?.id ?? null;
    },
  };
}

// ---------- Outlook (Microsoft Graph) ----------
function outlook(c: Compte, jeton: string) {
  const api = "https://graph.microsoft.com/v1.0/me", pref = { Prefer: 'IdType="ImmutableId"' };
  const o = (chemin: string, init?: RequestInit, entetes: Record<string, string> = {}) => appel(jeton, api + chemin, init, { ...pref, ...entetes });
  const CONNUS: Record<string, string> = { inbox: "reception", sentitems: "envoyes", drafts: "brouillons", deleteditems: "corbeille", junkemail: "indesirables", archive: "archive" };
  const dest = (l: string[]) => l.map((x) => ({ emailAddress: { address: nue(x) } }));
  return {
    async dossiers() {
      const ids: Record<string, string> = {};
      for (const k of Object.keys(CONNUS)) { try { ids[(await o(`/mailFolders/${k}?$select=id`)).id] = k; } catch { /* absent */ } }
      const PARNOM: Record<string, string> = { brouillons: "drafts", drafts: "drafts", "éléments supprimés": "deleteditems", "deleted items": "deleteditems",
        "éléments envoyés": "sentitems", "sent items": "sentitems", "courrier indésirable": "junkemail", "junk email": "junkemail", "boîte de réception": "inbox", inbox: "inbox", archive: "archive" };
      const sortie: any[] = [];
      const parcourir = async (url: string, parent: string) => {
        for (const f of (await o(url)).value ?? []) {
          const chemin = parent ? `${parent} › ${f.displayName}` : f.displayName;
          const connu = ids[f.id] ?? (!parent && !Object.values(ids).includes(PARNOM[f.displayName.toLowerCase()]) ? PARNOM[f.displayName.toLowerCase()] : undefined);
          if (/^(conversation history|historique des conversations|outbox|boîte d'envoi|rss|flux rss|sync issues|problèmes de synchronisation)/i.test(f.displayName)) continue;
          sortie.push({ id: f.id, nom: connu ? ({ reception: "Boîte de réception", envoyes: "Envoyés", brouillons: "Brouillons", corbeille: "Corbeille",
            indesirables: "Courrier indésirable", archive: "Archive" } as any)[CONNUS[connu]] : chemin, type: connu ? CONNUS[connu] : "perso",
            non_lus: connu === "drafts" || connu === "sentitems" ? 0 : f.unreadItemCount ?? 0, total: f.totalItemCount ?? 0 });
          if (f.childFolderCount) await parcourir(`/mailFolders/${f.id}/childFolders?$top=100&$select=id,displayName,unreadItemCount,totalItemCount,childFolderCount`, chemin);
        }
      };
      await parcourir("/mailFolders?$top=100&$select=id,displayName,unreadItemCount,totalItemCount,childFolderCount", "");
      const ordre = ["reception", "envoyes", "brouillons", "archive", "indesirables", "corbeille"];
      return sortie.sort((a, b) => (ordre.indexOf(a.type) + 1 || 99) - (ordre.indexOf(b.type) + 1 || 99) || a.nom.localeCompare(b.nom, "fr"));
    },
    async lister(dossier: string, q: string, suite: string, n: number) {
      const saut = +suite || 0, base = `/mailFolders/${dossier || "inbox"}/messages?$top=${n}&$select=id,subject,from,toRecipients,receivedDateTime,bodyPreview,isRead,flag,hasAttachments,isDraft`;
      const r = q ? await o(`${base}&$search=${encodeURIComponent(`"${q.replace(/"/g, "")}"`)}${suite ? `&$skiptoken=${encodeURIComponent(suite)}` : ""}`)
        : await o(`${base}&$skip=${saut}&$orderby=receivedDateTime desc`);
      const mails = (r.value ?? []).map((m: any) => ({ boite: c.email, nom: nom(c.email), id: `outlook:${m.id}`, dossier: dossier || "inbox",
        de: m.from?.emailAddress ? `${m.from.emailAddress.name ?? ""} <${m.from.emailAddress.address ?? ""}>` : "",
        a: (m.toRecipients ?? []).map((x: any) => x.emailAddress?.address).join(", "), objet: m.subject ?? "", date: m.receivedDateTime,
        extrait: (m.bodyPreview ?? "").replace(/\s+/g, " ").slice(0, 220), lu: !!m.isRead, important: m.flag?.flagStatus === "flagged", pieces: !!m.hasAttachments,
        brouillon: !!m.isDraft }));
      const suivant = q ? (/\$skiptoken=([^&]+)/.exec(r["@odata.nextLink"] ?? "")?.[1] ?? null) : mails.length === n ? String(saut + n) : null;
      return { mails, suite: suivant ? decodeURIComponent(suivant) : null };
    },
    async lire(id: string) {
      const m = await o(`/messages/${encodeURIComponent(id)}?$select=subject,from,toRecipients,ccRecipients,receivedDateTime,body,isRead,flag,isDraft,webLink,internetMessageId,hasAttachments`);
      const adr = (l: any[]) => (l ?? []).filter(Boolean).map((x) => x.emailAddress?.name ? `${x.emailAddress.name} <${x.emailAddress.address}>` : x.emailAddress?.address).join(", ");
      const images: Record<string, string> = {}, pieces: any[] = [];
      if (m.hasAttachments || /cid:/i.test(m.body?.content ?? "")) {
        const l = (await o(`/messages/${encodeURIComponent(id)}/attachments?$select=id,name,contentType,size,isInline`).catch(() => ({}))).value ?? [];
        for (const x of l) {
          if (x.isInline && x.size < IMAGE_MAX && /^image\//.test(x.contentType ?? "")) {
            const a = await o(`/messages/${encodeURIComponent(id)}/attachments/${x.id}`).catch(() => null);
            const cid = String(a?.contentId ?? "").replace(/^<|>$/g, "");
            if (cid && (m.body?.content ?? "").includes("cid:" + cid)) { images[cid] = `data:${x.contentType};base64,${a.contentBytes}`; continue; }
          }
          pieces.push({ id: x.id, nom: x.name, type: x.contentType, taille: x.size });
        }
      }
      const html = m.body?.contentType === "html" ? m.body.content : "", texte = m.body?.contentType === "text" ? m.body.content : "";
      return { de: adr([m.from]), a: adr(m.toRecipients), cc: adr(m.ccRecipients), date: m.receivedDateTime, objet: m.subject ?? "", texte, html,
        brouillon: !!m.isDraft, lu: !!m.isRead, important: m.flag?.flagStatus === "flagged", images, pieces, lien: m.webLink, messageId: m.internetMessageId };
    },
    async piece(id: string, piece: string) {
      const a = await o(`/messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(piece)}`);
      if (!a.contentBytes) throw new Error("cette pièce jointe (élément Outlook) ne se télécharge pas ici : ouvrir dans Outlook");
      return { nom: a.name, type: a.contentType, contenu: a.contentBytes };
    },
    async ranger(id: string, quoi: string) {
      const u = `/messages/${encodeURIComponent(id)}`;
      if (quoi === "lu" || quoi === "non_lu") return o(u, { method: "PATCH", body: JSON.stringify({ isRead: quoi === "lu" }) });
      if (quoi === "drapeau" || quoi === "sans_drapeau") return o(u, { method: "PATCH", body: JSON.stringify({ flag: { flagStatus: quoi === "drapeau" ? "flagged" : "notFlagged" } }) });
      return o(`${u}/move`, { method: "POST", body: JSON.stringify({ destinationId: quoi === "corbeille" ? "deleteditems" : quoi === "reception" ? "inbox" : "archive" }) });
    },
    deplacer: (id: string, vers: string) => o(`/messages/${encodeURIComponent(id)}/move`, { method: "POST", body: JSON.stringify({ destinationId: vers }) }),
    // Écrire : brouillon Outlook (réponse, réponse à tous, transfert ou nouveau) complété, puis envoyé si demandé
    async ecrire(e: { mode: string; origine: string | null; a: string[]; cc: string[]; cci: string[]; objet: string; html: string; pieces: PieceJointe[];
      brouillonId: string | null }, envoyer: boolean) {
      let id = e.brouillonId, avant = "";
      if (!id && e.origine && e.mode !== "nouveau") {
        const action = e.mode === "repondre_tous" ? "createReplyAll" : e.mode === "transferer" ? "createForward" : "createReply";
        id = (await o(`/messages/${encodeURIComponent(e.origine)}/${action}`, { method: "POST", body: "{}" })).id;
        avant = String((await o(`/messages/${encodeURIComponent(id!)}?$select=body`)).body?.content ?? "");
      } else if (!id) id = (await o("/messages", { method: "POST", body: JSON.stringify({ subject: e.objet, body: { contentType: "html", content: "" } }) })).id;
      // Notre texte entre deux repères : un brouillon repris garde la citation qu'Outlook a mise dessous
      const DEBUT = '<div id="ar-conseil-texte">', FIN = '<span id="ar-conseil-fin"></span></div>', notre = `${DEBUT}${e.html}${FIN}`;
      if (e.brouillonId) {
        const actuel = String((await o(`/messages/${encodeURIComponent(id!)}?$select=body`)).body?.content ?? "");
        const repere = /<div[^>]*id="(?:x_)?ar-conseil-texte"[^>]*>[\s\S]*?<span[^>]*id="(?:x_)?ar-conseil-fin"[^>]*><\/span><\/div>/i;
        if (repere.test(actuel)) avant = actuel.replace(repere, "\u0000");
      }
      const contenu = avant.includes("\u0000") ? avant.replace("\u0000", notre)
        : avant ? (/<body[^>]*>/i.test(avant) ? avant.replace(/<body[^>]*>/i, (x) => `${x}${notre}<br>`) : `${notre}<br>${avant}`) : notre;
      await o(`/messages/${encodeURIComponent(id!)}`, { method: "PATCH", body: JSON.stringify({ subject: e.objet, toRecipients: dest(e.a), ccRecipients: dest(e.cc),
        bccRecipients: dest(e.cci), body: { contentType: "html", content: contenu } }) });
      const deja = e.brouillonId ? new Set(((await o(`/messages/${encodeURIComponent(id!)}/attachments?$select=name`).catch(() => ({}))).value ?? []).map((x: any) => x.name)) : new Set();
      for (const p of e.pieces.filter((x) => !deja.has(x.nom))) await o(`/messages/${encodeURIComponent(id!)}/attachments`, { method: "POST", body: JSON.stringify({
        "@odata.type": "#microsoft.graph.fileAttachment", name: p.nom, contentType: p.type || "application/octet-stream", contentBytes: b64(p.octets) }) });
      if (!envoyer) return id;
      try { await o(`/messages/${encodeURIComponent(id!)}/send`, { method: "POST" }); }
      catch (err: any) {
        if (err?.status === 403) throw new Error("ENVOI_REFUSE");
        throw err;
      }
      return null;
    },
  };
}

// ---------- Harnes (IONOS, IMAP + SMTP) ----------
const utf7Lire = (s: string) => s.replace(/&([^-]*)-/g, (_, b) => {
  if (!b) return "&";
  const o = Uint8Array.from(atob(b.replace(/,/g, "/") + "===".slice((b.length + 3) % 4)), (c) => c.charCodeAt(0));
  let t = ""; for (let i = 0; i + 1 < o.length; i += 2) t += String.fromCharCode((o[i] << 8) | o[i + 1]); return t;
});
type Imap = { cmd: (c: string) => Promise<string>; cite: (s: string) => string; ajouter: (d: string, f: string, m: string) => Promise<void>; liste: { attr: string; nom: string }[] };
async function ionos<T>(f: (x: Imap) => Promise<T>) {
  const { email, mdp, hote } = IONOS();
  const { cmd, cite, fermer, ajouter } = await connexionImap(hote, email, mdp);
  try {
    const liste = [...(await cmd('LIST "" "*"')).matchAll(/^\* LIST \(([^)]*)\) (?:"[^"]*"|NIL) (?:"((?:[^"\\]|\\.)*)"|(\S+))\r?$/gm)]
      .map((x) => ({ attr: x[1], nom: (x[2] ?? x[3]).replace(/\\(.)/g, "$1") })).filter((x) => !/\\Noselect/i.test(x.attr));
    return await f({ cmd, cite, ajouter, liste });
  } finally { await fermer(); }
}
const typeIonos = (x: { attr: string; nom: string }) => x.nom.toUpperCase() === "INBOX" ? "reception" : /\\Sent/i.test(x.attr) ? "envoyes" : /\\Drafts/i.test(x.attr) ? "brouillons"
  : /\\Trash/i.test(x.attr) ? "corbeille" : /\\Junk/i.test(x.attr) ? "indesirables" : /\\Archive/i.test(x.attr) ? "archive" : "perso";
// UID d'un message (par son Message-ID) : dans le dossier indiqué d'abord, sinon partout
async function trouver(x: Imap, id: string, dossier: string, ecriture = false) {
  const mid = id.replace(/^ionos:/, "");
  const ordre = [dossier, "INBOX", ...x.liste.map((l) => l.nom)].filter((d, i, a) => d && a.indexOf(d) === i);
  for (const d of ordre) {
    if (!x.liste.some((l) => l.nom === d)) continue;
    await x.cmd(`${ecriture ? "SELECT" : "EXAMINE"} ${x.cite(d)}`);
    const uid = /^\d+$/.test(mid) ? (d === dossier || d === "INBOX" ? mid : null)
      : /\* SEARCH ?(\d+)?/.exec(await x.cmd(`UID SEARCH HEADER Message-ID ${x.cite("<" + mid + ">")}`))?.[1];
    if (uid) return { dossier: d, uid };
  }
  throw new Error("mail introuvable dans la boîte Harnes");
}
const lireComplet = async (cmd: (c: string) => Promise<string>, uid: string) => {
  const r = await cmd(`UID FETCH ${uid} (FLAGS INTERNALDATE BODY.PEEK[])`);
  const i = r.search(/BODY\[\] \{\d+\}\r\n/), taille = +(/BODY\[\] \{(\d+)\}/.exec(r)?.[1] ?? 0), debut = r.indexOf("}\r\n", i) + 3;
  return { brut: r.slice(debut, debut + taille), drapeaux: /FLAGS \(([^)]*)\)/.exec(r)?.[1] ?? "", date: /INTERNALDATE "([^"]+)"/.exec(r)?.[1] };
};
const dateImap = (d?: string) => d ? new Date(d.replace(/^(\d+)-(\w+)-(\d+) /, "$2 $1 $3 ")).toISOString() : null;
const harnes = {
  dossiers: () => ionos(async (x) => {
    const sortie = [];
    for (const l of x.liste) {
      const s = await x.cmd(`STATUS ${x.cite(l.nom)} (MESSAGES UNSEEN)`).catch(() => "");
      const t = typeIonos(l);
      sortie.push({ id: l.nom, nom: ({ reception: "Boîte de réception", envoyes: "Envoyés", brouillons: "Brouillons", corbeille: "Corbeille", indesirables: "Courrier indésirable",
        archive: "Archive" } as any)[t] ?? utf7Lire(l.nom.replace(/^INBOX[./]/, "")), type: t, total: +(/MESSAGES (\d+)/.exec(s)?.[1] ?? 0),
        non_lus: t === "envoyes" || t === "brouillons" ? 0 : +(/UNSEEN (\d+)/.exec(s)?.[1] ?? 0) });
    }
    const ordre = ["reception", "envoyes", "brouillons", "archive", "indesirables", "corbeille"];
    return sortie.sort((a, b) => (ordre.indexOf(a.type) + 1 || 99) - (ordre.indexOf(b.type) + 1 || 99) || a.nom.localeCompare(b.nom, "fr"));
  }),
  lister: (dossier: string, q: string, suite: string, n: number) => ionos(async (x) => {
    const d = dossier || "INBOX", email = IONOS().email;
    await x.cmd(`EXAMINE ${x.cite(d)}`);
    const ascii = q.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e]/g, " ").trim();
    const tous = (/\* SEARCH([\d ]*)/.exec(await x.cmd(ascii ? `UID SEARCH CHARSET UTF-8 TEXT ${x.cite(ascii)}` : "UID SEARCH ALL").catch(() => ""))?.[1] ?? "")
      .trim().split(/\s+/).filter(Boolean).reverse();
    const saut = +suite || 0, uids = tous.slice(saut, saut + n), mails: any[] = [];
    if (uids.length) {
      const rep = await x.cmd(`UID FETCH ${uids.join(",")} (UID FLAGS INTERNALDATE BODYSTRUCTURE BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT MESSAGE-ID)])`);
      for (const bloc of rep.split(/\r\n(?=\* \d+ FETCH )/)) {
        const uid = /\bUID (\d+)/.exec(bloc)?.[1];
        if (!uid) continue;
        const drapeaux = /FLAGS \(([^)]*)\)/.exec(bloc)?.[1] ?? "";
        const i = bloc.indexOf("HEADER.FIELDS"), debut = bloc.indexOf("}\r\n", i) + 3, h: Record<string, string> = {};
        for (const l of bloc.slice(debut).replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) { const k = l.indexOf(":"); if (k > 0) h[l.slice(0, k).trim().toLowerCase()] = l.slice(k + 1).trim(); }
        const mid = (h["message-id"] ?? "").replace(/^<|>$/g, "");
        mails.push({ boite: email, nom: nom(email), id: mid ? `ionos:${mid}` : `ionos:${uid}`, dossier: d, de: enTete(h["from"] ?? ""), a: enTete(h["to"] ?? ""),
          objet: enTete(h["subject"] ?? ""), date: dateImap(/INTERNALDATE "([^"]+)"/.exec(bloc)?.[1]), extrait: "", lu: /\\Seen/.test(drapeaux),
          important: /\\Flagged/.test(drapeaux), pieces: /"attachment"/i.test(bloc), brouillon: /\\Draft/.test(drapeaux) });
      }
      mails.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    }
    return { mails, suite: saut + n < tous.length ? String(saut + n) : null };
  }),
  lire: (id: string, dossier: string) => ionos(async (x) => {
    const t = await trouver(x, id, dossier);
    const { brut, drapeaux, date } = await lireComplet(x.cmd, t.uid);
    const a = analyser(brut), images: Record<string, string> = {};
    for (const p of a.pieces) if (p.cid && p.taille < IMAGE_MAX && /^image\//.test(p.type)) images[p.cid] = `data:${p.type};base64,${b64(p.octets)}`;
    return { de: enTete(a.h["from"] ?? ""), a: enTete(a.h["to"] ?? ""), cc: enTete(a.h["cc"] ?? ""), date: dateImap(date), objet: enTete(a.h["subject"] ?? ""),
      texte: a.texte, html: a.html, images, dossier: t.dossier, lu: /\\Seen/.test(drapeaux), important: /\\Flagged/.test(drapeaux), brouillon: /\\Draft/.test(drapeaux),
      messageId: a.h["message-id"] ?? "", references: a.h["references"] ?? "", lien: "https://mail.ionos.fr/",
      pieces: a.pieces.filter((p) => !(p.cid && images[p.cid] && a.html.includes("cid:" + p.cid))).map((p) => ({ id: String(p.index), nom: p.nom, type: p.type, taille: p.taille })) };
  }),
  piece: (id: string, piece: string, dossier: string) => ionos(async (x) => {
    const t = await trouver(x, id, dossier);
    const p = analyser((await lireComplet(x.cmd, t.uid)).brut).pieces.find((y) => String(y.index) === piece);
    if (!p) throw new Error("pièce jointe introuvable");
    return { nom: p.nom, type: p.type, contenu: b64(p.octets) };
  }),
  origine: (id: string, dossier: string) => ionos(async (x) => {
    const t = await trouver(x, id, dossier);
    const { brut, date } = await lireComplet(x.cmd, t.uid);
    const a = analyser(brut);
    return { de: enTete(a.h["from"] ?? ""), a: enTete(a.h["to"] ?? ""), cc: enTete(a.h["cc"] ?? ""), date: dateImap(date) ?? "", objet: enTete(a.h["subject"] ?? ""),
      texte: a.texte, html: a.html, messageId: a.h["message-id"] ?? "", references: a.h["references"] ?? "",
      pieces: a.pieces.filter((p) => !p.cid || p.nom.includes(".")).map((p) => ({ nom: p.nom, type: p.type, octets: p.octets })) };
  }),
  ranger: (id: string, quoi: string, dossier: string) => ionos(async (x) => {
    const t = await trouver(x, id, dossier, true);
    if (["lu", "non_lu", "drapeau", "sans_drapeau"].includes(quoi)) {
      const f = quoi === "lu" || quoi === "non_lu" ? "\\Seen" : "\\Flagged";
      return x.cmd(`UID STORE ${t.uid} ${quoi === "lu" || quoi === "drapeau" ? "+" : "-"}FLAGS.SILENT (${f})`);
    }
    const cible = quoi === "reception" ? "INBOX" : x.liste.find((l) => typeIonos(l) === (quoi === "corbeille" ? "corbeille" : "archive"))?.nom;
    if (!cible) throw new Error(quoi === "corbeille" ? "corbeille introuvable" : "dossier Archive introuvable dans la boîte Harnes");
    if (cible !== t.dossier) await x.cmd(`UID MOVE ${t.uid} ${x.cite(cible)}`);
  }),
  deplacer: (id: string, vers: string, dossier: string) => ionos(async (x) => {
    const t = await trouver(x, id, dossier, true);
    if (vers !== t.dossier) await x.cmd(`UID MOVE ${t.uid} ${x.cite(vers)}`);
  }),
  // Copie d'un message (envoyé ou brouillon) rangée dans le dossier voulu ; l'ancien brouillon part à la corbeille
  ranger_copie: (message: string, type: "envoyes" | "brouillons", ancien: string | null) => ionos(async (x) => {
    const d = x.liste.find((l) => typeIonos(l) === type)?.nom ?? (type === "envoyes" ? "Sent" : "Drafts");
    await x.ajouter(d, type === "brouillons" ? "\\Seen \\Draft" : "\\Seen", message);
    if (ancien) {
      const corbeille = x.liste.find((l) => typeIonos(l) === "corbeille")?.nom;
      const t = await trouver(x, ancien, d, true).catch(() => null);
      if (t && corbeille) await x.cmd(`UID MOVE ${t.uid} ${x.cite(corbeille)}`);
    }
    return /Message-ID: <([^>]+)>/i.exec(message)?.[1] ?? null;
  }),
};

// ---------- Écrire (envoyer ou brouillon) ----------
async function ecrire(db: any, b: any, envoyer: boolean) {
  const boite = String(b.boite ?? "").toLowerCase(), mode = ["repondre", "repondre_tous", "transferer"].includes(b.mode) ? b.mode : "nouveau";
  const a = adresses(b.a), cc = adresses(b.cc), cci = adresses(b.cci);
  const objet = String(b.objet ?? "").trim().slice(0, 300), corps = String(b.texte ?? "").replace(/\s+$/, "").slice(0, 100000);
  if (envoyer && !a.length && !cc.length && !cci.length) throw new Error("destinataire manquant");
  const pieces: PieceJointe[] = (Array.isArray(b.pieces) ? b.pieces : []).slice(0, 20).map((p: any) => ({ nom: String(p.nom ?? "piece"), type: String(p.type ?? ""), octets: deB64(String(p.contenu ?? "")) }));
  if (pieces.reduce((s, p) => s + p.octets.length, 0) > 20_000_000) throw new Error("pièces jointes trop lourdes (20 Mo au plus)");
  const { data: sig } = await db.from("signatures").select("texte").eq("boite", boite).maybeSingle();
  const texteSigne = sig?.texte && !corps.includes(sig.texte.trim()) ? `${corps}\n\n${sig.texte.trim()}` : corps;   // brouillon repris : déjà signé
  const htmlSigne = (await messageHtml(db, boite, texteSigne)) ?? `<div style="font-family:Arial,sans-serif;font-size:14px">${echapper(texteSigne).replace(/\n/g, "<br>")}</div>`;
  const [genre, ...reste] = String(b.origine ?? "").split(":"), origine = reste.join(":") || null;
  const brouillonId = b.brouillon_id ? String(b.brouillon_id) : null;

  if (boite === IONOS().email) {
    const o = origine && mode !== "nouveau" && genre === "ionos" ? await harnes.origine(`ionos:${origine}`, String(b.dossier ?? "")) : null;
    const c = o ? citer(o, mode) : null;
    const message = mime({ de: boite, a, cc, objet, texte: texteSigne + (c?.t ?? ""), html: htmlSigne + (c?.h ?? ""),
      pieces: [...pieces, ...(mode === "transferer" && o ? o.pieces : [])], enReponse: o && mode !== "transferer" ? { messageId: o.messageId, references: o.references } : null });
    const ancien = brouillonId ? `ionos:${brouillonId.replace(/^ionos:/, "")}` : null;
    if (!envoyer) return { brouillon_id: await harnes.ranger_copie(message, "brouillons", ancien) };
    await envoyerSmtp(Deno.env.get("IONOS_SMTP") || "smtp.ionos.fr", boite, IONOS().mdp, boite, [...a, ...cc, ...cci].map(nue), message);
    await harnes.ranger_copie(message, "envoyes", ancien).catch((e) => console.error("messagerie : copie non rangée", e instanceof Error ? e.message : e));
    return {};
  }
  const { data: c } = await db.from("comptes_agenda").select("*").eq("usage", "mail").eq("email", boite).maybeSingle();
  if (!c) throw new Error("boîte non connectée");
  const jeton = await jetonAcces(db, c as Compte);
  if (c.fournisseur === "google") {
    const g = gmail(c, jeton);
    const o = origine && mode !== "nouveau" && genre === "gmail" ? await g.origine(origine) : null;
    const ci = o ? citer(o, mode) : null;
    const raw = mime({ de: boite, a, cc: [...cc], objet, texte: texteSigne + (ci?.t ?? ""), html: htmlSigne + (ci?.h ?? ""),
      pieces: [...pieces, ...(mode === "transferer" && o ? o.pieces : [])], enReponse: o && mode !== "transferer" ? { messageId: o.messageId, references: o.references } : null })
      .replace(/^(To: .*)$/m, (l) => cci.length ? `${l}\r\nBcc: ${cci.join(", ")}` : l);
    const id = await g.ecrire(raw, o && mode !== "transferer" ? o.fil : null, envoyer, brouillonId);
    return envoyer ? {} : { brouillon_id: id };
  }
  try {
    const id = await outlook(c, jeton).ecrire({ mode, origine: genre === "outlook" ? origine : null, a, cc, cci, objet, html: htmlSigne, pieces, brouillonId }, envoyer);
    return envoyer ? {} : { brouillon_id: id };
  } catch (e) {
    if (e instanceof Error && e.message === "ENVOI_REFUSE")
      throw new Error("Microsoft n'autorise pas encore l'envoi depuis Palomano (accord administrateur). Le message est enregistré dans tes Brouillons Outlook.");
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
    const { data: comptes } = await db.from("comptes_agenda").select("*").eq("usage", "mail");
    const fournisseurs: Record<string, () => Promise<any>> = {};
    for (const c of (comptes ?? []) as Compte[]) fournisseurs[c.email.toLowerCase()] = async () => { const j = await jetonAcces(db, c); return c.fournisseur === "google" ? gmail(c, j) : outlook(c, j); };
    if (IONOS().email && IONOS().mdp) fournisseurs[IONOS().email] = async () => null;   // Harnes : fonctions à part (une connexion IMAP par appel)
    const boites = Object.keys(fournisseurs).map((e) => ({ email: e, nom: nom(e) }));
    const boite = String(b.boite ?? "").toLowerCase(), estHarnes = boite === IONOS().email;
    const id = String(b.id ?? "").replace(/^(gmail|outlook|ionos):/, ""), dossier = String(b.dossier ?? "");
    const f = boite && fournisseurs[boite] && !estHarnes ? await fournisseurs[boite]() : null;
    if (b.action !== "lister" && b.action !== "envoyer" && b.action !== "brouillon" && !f && !estHarnes) return json({ erreur: "boîte inconnue" }, 404);

    switch (b.action) {
      case "dossiers": return json({ dossiers: estHarnes ? await harnes.dossiers() : await f.dossiers() });
      case "lire": return json(estHarnes ? await harnes.lire(String(b.id), dossier) : await f.lire(id));
      case "piece": return json(estHarnes ? await harnes.piece(String(b.id), String(b.piece), dossier) : await f.piece(id, String(b.piece)));
      case "ranger": {
        if (!["lu", "non_lu", "drapeau", "sans_drapeau", "archiver", "corbeille", "reception"].includes(b.quoi)) return json({ erreur: "action inconnue" }, 400);
        await (estHarnes ? harnes.ranger(String(b.id), b.quoi, dossier) : f.ranger(id, b.quoi));
        return json({ ok: true });
      }
      case "deplacer": await (estHarnes ? harnes.deplacer(String(b.id), String(b.vers), dossier) : f.deplacer(id, String(b.vers), dossier)); return json({ ok: true });
      case "brouillon_de": return json({ brouillon_id: f?.brouillonDe ? await f.brouillonDe(id) : estHarnes ? String(b.id) : id });
      case "envoyer": return json({ ok: true, ...(await ecrire(db, b, true)) });
      case "brouillon": return json({ ok: true, ...(await ecrire(db, b, false)) });
    }
    // lister : une boîte (avec dossier et recherche) ou toutes les réceptions ensemble
    const voulue = String(b.boite ?? "tout").toLowerCase(), q = String(b.q ?? "").trim().slice(0, 200);
    const choisies = voulue === "tout" ? Object.keys(fournisseurs) : Object.keys(fournisseurs).filter((e) => e === voulue);
    if (!choisies.length) return json({ erreur: "boîte inconnue" }, 404);
    const suites: Record<string, string | null> = b.suites ?? {}, erreurs: Record<string, string> = {}, sortie: Record<string, string | null> = {};
    const lots = await Promise.all(choisies.filter((e) => suites[e] !== null).map(async (e) => {
      try {
        const n = voulue === "tout" ? PAGE_TOUT : PAGE, d = voulue === "tout" ? "" : dossier;
        const r = e === IONOS().email ? await harnes.lister(d, q, suites[e] ?? "", n) : await (await fournisseurs[e]()).lister(d, q, suites[e] ?? "", n);
        sortie[e] = r.suite; return r.mails;
      } catch (err) { erreurs[e] = err instanceof Error ? err.message.slice(0, 200) : String(err); sortie[e] = null; return []; }
    }));
    const mails = lots.flat().sort((x, y) => String(y.date ?? "").localeCompare(String(x.date ?? "")));
    return json({ mails, suites: sortie, erreurs, boites });
  } catch (e) {
    return json({ erreur: e instanceof Error ? e.message : String(e) }, 502);
  }
});
