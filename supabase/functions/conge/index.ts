// Mode congé (bouton « Je suis en congé » de la page Aujourd'hui) : une réponse d'absence sur chaque boîte choisie,
// avec la signature de la boîte, et une journée « Congé » posée dans l'agenda.
// - Gmail (arouzier, Camp) : réponse d'absence de Gmail (droit gmail.settings.basic), programmée du premier au dernier jour.
// - Outlook (Palomano, Evoa) : réponses automatiques d'Outlook (droit MailboxSettings.ReadWrite, accord de l'administrateur).
// - Harnes (IONOS, pas de réglage à distance) : la veille (`{ veille: true }`, pg_cron `conge` toutes les 10 min) répond
//   elle-même, une seule fois par expéditeur, jamais aux listes, robots, publicités ni réponses automatiques.
// Actions (session de l'utilisateur) : etat, activer { du, au, message, boites[], agenda_id? }, arreter.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { jetonAcces, jetonMicrosoft, minuitParis, peutRegler, type Compte } from "../_partage/fournisseurs.ts";
import { connexionImap, enTete } from "../_partage/mails.ts";
import { messageHtml } from "../_partage/reponses.ts";
import { base64Lignes, enteteUtf8, envoyerSmtp } from "../_partage/smtp.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cle-synchro",
  "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: { ...cors, "Content-Type": "application/json" } });
const NOMS: Record<string, string> = { "arouzier@gmail.com": "Gmail", "camprouziermarechal@gmail.com": "Camp", "a.rouzier@evoa-courtage.fr": "Evoa",
  "antonin.rouzier@harnes-volleyball.fr": "Harnes" };
const nom = (email: string) => NOMS[email.toLowerCase()] ?? (/palomano/i.test(email) ? "Palomano" : email.split("@")[0]);
const IONOS = () => ({ email: (Deno.env.get("IONOS_EMAIL") ?? "").toLowerCase(), mdp: Deno.env.get("IONOS_MOT_DE_PASSE") ?? "",
  imap: Deno.env.get("IONOS_IMAP") || "imap.ionos.fr", smtp: Deno.env.get("IONOS_SMTP") || "smtp.ionos.fr" });
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me", GRAPH = "https://graph.microsoft.com/v1.0/me", ABSENCE = "MailboxSettings.ReadWrite";
const SUPABASE = Deno.env.get("SUPABASE_URL")!;

const aujourdhui = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
const lendemain = (d: string) => new Date(Date.parse(d + "T12:00:00Z") + 86_400_000).toISOString().slice(0, 10);
const echapper = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const periode = (c: Conge) => ({ debut: minuitParis(c.du), fin: minuitParis(lendemain(c.au)) });   // fin : minuit après le dernier jour

type Conge = { id: string; du: string; au: string; message: string; boites: string[]; etat: Record<string, { ok: boolean; erreur?: string }>; evenement_id: string | null; actif: boolean };
type Boite = { email: string; nom: string; fournisseur: "google" | "microsoft" | "ionos"; compte?: Compte; mode: "pret" | "autorisation" | "evoalys" };

async function appel(jeton: string, url: string, options: RequestInit = {}) {
  const r = await fetch(url, { ...options, headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json", ...(options.headers || {}) } });
  const t = await r.text(); const j = t ? JSON.parse(t) : null;
  if (!r.ok) throw new Error(j?.error?.message || `HTTP ${r.status}`);
  return j;
}
const outlookPret = async (c: Compte) => peutRegler(c) || await jetonMicrosoft(c, ABSENCE).then(() => true, () => false);

// Boîtes où le congé peut répondre, et ce qui manque pour les autres
// deno-lint-ignore no-explicit-any
async function boites(db: any): Promise<Boite[]> {
  const comptes = ((await db.from("comptes_agenda").select("*")).data ?? []) as Compte[];
  const mails = comptes.filter((c) => c.usage === "mail");
  const sortie: Boite[] = [];
  for (const c of mails) sortie.push({ email: c.email, nom: nom(c.email), fournisseur: c.fournisseur, compte: c,
    mode: c.fournisseur === "google" ? (/gmail\.settings\.basic/.test(c.droits ?? "") ? "pret" : "autorisation") : (await outlookPret(c) ? "pret" : "autorisation") });
  // Evoa : agenda Outlook qui lit aussi les mails ; sans l'accord de l'administrateur, l'absence se règle dans Evoalys
  for (const c of comptes.filter((c) => c.usage !== "mail" && c.fournisseur === "microsoft" && /Mail\.Read/i.test(c.droits ?? "") && !mails.some((m) => m.email === c.email)))
    sortie.push({ email: c.email, nom: nom(c.email), fournisseur: "microsoft", compte: c, mode: await outlookPret(c) ? "pret" : "evoalys" });
  if (IONOS().email && IONOS().mdp) sortie.push({ email: IONOS().email, nom: nom(IONOS().email), fournisseur: "ionos", mode: "pret" });
  const ordre = ["Gmail", "Palomano", "Evoa", "Harnes", "Camp"];
  return sortie.sort((a, b) => (ordre.indexOf(a.nom) + 1 || 99) - (ordre.indexOf(b.nom) + 1 || 99));
}

// Texte et version mise en forme de la réponse, signés avec la signature de la boîte
// deno-lint-ignore no-explicit-any
async function reponse(db: any, boite: string, message: string) {
  const { data: sig } = await db.from("signatures").select("texte").eq("boite", boite.toLowerCase()).maybeSingle();
  const texte = sig?.texte?.trim() ? `${message.trim()}\n\n${sig.texte.trim()}` : message.trim();
  const html = (await messageHtml(db, boite, texte)) ?? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">${echapper(texte).replace(/\n/g, "<br>")}</div>`;
  return { texte, html };
}

// Allume (programmée sur la période) ou éteint la réponse d'absence d'une boîte Gmail ou Outlook
// deno-lint-ignore no-explicit-any
async function poser(db: any, b: Boite, c: Conge, allumer: boolean) {
  if (b.fournisseur === "ionos") return;   // Harnes : la veille répond elle-même
  const { debut, fin } = periode(c), r = allumer ? await reponse(db, b.email, c.message) : null;
  if (b.fournisseur === "google") {
    await appel(await jetonAcces(db, b.compte!), `${GMAIL}/settings/vacation`, { method: "PUT", body: JSON.stringify(allumer
      ? { enableAutoReply: true, responseBodyHtml: r!.html, responseBodyPlainText: r!.texte, restrictToContacts: false, restrictToDomain: false,
          startTime: String(Date.parse(debut)), endTime: String(Date.parse(fin)) }
      : { enableAutoReply: false }) });
    return;
  }
  const quand = (iso: string) => ({ dateTime: iso.slice(0, 19), timeZone: "UTC" });
  await appel(await jetonMicrosoft(b.compte!, ABSENCE), `${GRAPH}/mailboxSettings`, { method: "PATCH", body: JSON.stringify({ automaticRepliesSetting: allumer
    ? { status: "scheduled", externalAudience: "all", scheduledStartDateTime: quand(debut), scheduledEndDateTime: quand(fin),
        internalReplyMessage: r!.html, externalReplyMessage: r!.html }
    : { status: "disabled" } }) });
}

// Journée « Congé » dans l'agenda (fonction agenda-ecrire, appelée avec la clé de synchro)
async function agenda(corps: Record<string, unknown>) {
  const r = await fetch(`${SUPABASE}/functions/v1/agenda-ecrire`, { method: "POST",
    headers: { "Content-Type": "application/json", "x-cle-synchro": Deno.env.get("CLE_SYNCHRO") ?? "" }, body: JSON.stringify(corps) });
  const j = await r.json().catch(() => ({ erreur: `HTTP ${r.status}` }));
  if (j.erreur) throw new Error(j.erreur);
  return j;
}

// Fin d'un congé : réponses éteintes (sauf sur les boîtes que le congé suivant reprend), journée « Congé » retirée ou raccourcie
// deno-lint-ignore no-explicit-any
async function arreter(db: any, c: Conge, toutes: Boite[], reprises: string[] = [], remplace = false) {
  for (const email of c.boites) {
    const b = toutes.find((x) => x.email === email);
    if (!b || reprises.includes(email) || !c.etat?.[email]?.ok) continue;
    await poser(db, b, c, false).catch((e) => console.error("conge : réponse non éteinte", email, e instanceof Error ? e.message : e));
  }
  if (c.evenement_id) {
    const { debut, fin } = periode(c), maintenant = Date.now();
    try {
      if (remplace || maintenant < Date.parse(debut)) await agenda({ action: "supprimer", evenement_id: c.evenement_id });
      else if (maintenant < Date.parse(fin)) await agenda({ action: "modifier", evenement_id: c.evenement_id, titre: "Congé", journee: true,
        debut, fin: minuitParis(lendemain(aujourdhui())) });   // retour anticipé : la journée « Congé » s'arrête aujourd'hui
    } catch (e) { console.error("conge : agenda", e instanceof Error ? e.message : e); }
  }
  await db.from("conges").update({ actif: false, arrete_le: new Date().toISOString() }).eq("id", c.id);
}

// ---------- Harnes : réponse envoyée par le cockpit, une fois par expéditeur ----------
const ROBOTS = /(^|[._-])(no-?reply|noreply|ne-?pas-?repondre|nepasrepondre|donotreply|do-not-reply|mailer-daemon|postmaster|bounces?|notifications?|newsletters?|news|marketing|alertes?)([._+-]|@)/i;
const nue = (a: string) => (/<([^>]+)>/.exec(a)?.[1] ?? a).trim().toLowerCase();
const MOIS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dateImap = (d?: string) => d ? Date.parse(d.replace(/^(\d+)-(\w+)-(\d+) /, "$2 $1 $3 ")) : NaN;

// deno-lint-ignore no-explicit-any
async function repondreHarnes(db: any, c: Conge) {
  const { email, mdp, imap, smtp } = IONOS(), { debut } = periode(c), depuis = new Date(Date.parse(debut) - 86_400_000);
  const x = await connexionImap(imap, email, mdp);
  const faits: string[] = [];
  try {
    await x.cmd("EXAMINE INBOX");
    const uids = (/\* SEARCH([\d ]*)/.exec(await x.cmd(`UID SEARCH SINCE ${depuis.getUTCDate()}-${MOIS[depuis.getUTCMonth()]}-${depuis.getUTCFullYear()}`))?.[1] ?? "")
      .trim().split(/\s+/).filter(Boolean).slice(-150);
    if (!uids.length) return faits;
    const rep = await x.cmd(`UID FETCH ${uids.join(",")} (UID INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM REPLY-TO SUBJECT MESSAGE-ID REFERENCES LIST-ID LIST-UNSUBSCRIBE AUTO-SUBMITTED PRECEDENCE X-AUTO-RESPONSE-SUPPRESS RETURN-PATH)])`);
    const { texte, html } = await reponse(db, email, c.message);
    for (const bloc of rep.split(/\r\n(?=\* \d+ FETCH )/)) {
      if (!(dateImap(/INTERNALDATE "([^"]+)"/.exec(bloc)?.[1]) >= Date.parse(debut))) continue;
      const i = bloc.indexOf("HEADER.FIELDS"), h: Record<string, string> = {};
      for (const l of bloc.slice(bloc.indexOf("}\r\n", i) + 3).replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
        const k = l.indexOf(":"); if (k > 0) h[l.slice(0, k).trim().toLowerCase()] = l.slice(k + 1).trim();
      }
      const vers = nue(enTete(h["reply-to"] || h["from"] || ""));
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(vers) || vers === email || ROBOTS.test(vers) || ROBOTS.test(nue(h["from"] ?? ""))) continue;
      if (h["list-id"] || h["list-unsubscribe"] || (h["auto-submitted"] && !/^no\b/i.test(h["auto-submitted"]))) continue;
      if (/bulk|list|junk/i.test(h["precedence"] ?? "") || /all|oof|autoreply/i.test(h["x-auto-response-suppress"] ?? "") || /^<>$/.test(h["return-path"] ?? "")) continue;
      // Une seule réponse par expéditeur et par congé : la ligne est posée avant l'envoi, retirée s'il échoue
      const { error } = await db.from("conge_reponses").insert({ conge_id: c.id, boite: email, expediteur: vers });
      if (error) continue;
      const objet = enTete(h["subject"] ?? ""), mid = h["message-id"] ?? "", id = crypto.randomUUID(), alt = "alt-" + id;
      const message = [`From: ${enteteUtf8("Antonin Rouzier")} <${email}>`, `To: ${vers}`,
        `Subject: ${enteteUtf8(/^re\s*:/i.test(objet) ? objet : `Re: ${objet || "votre message"}`)}`, `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
        `Message-ID: <${id}@${email.split("@")[1]}>`, ...(mid ? [`In-Reply-To: ${mid}`, `References: ${[h["references"], mid].filter(Boolean).join(" ")}`] : []),
        "Auto-Submitted: auto-replied", "X-Auto-Response-Suppress: All", "MIME-Version: 1.0", `Content-Type: multipart/alternative; boundary="${alt}"`, "",
        `--${alt}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", base64Lignes(texte),
        `--${alt}`, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", base64Lignes(html), `--${alt}--`, ""].join("\r\n");
      try { await envoyerSmtp(smtp, email, mdp, email, [vers], message); faits.push(vers); }
      catch (e) {
        await db.from("conge_reponses").delete().eq("conge_id", c.id).eq("boite", email).eq("expediteur", vers);
        console.error("conge : réponse Harnes non envoyée", e instanceof Error ? e.message : e);
      }
    }
  } finally { await x.fermer(); }
  return faits;
}

// deno-lint-ignore no-explicit-any
async function veille(db: any) {
  const { data } = await db.from("conges").select("*").eq("actif", true);
  const sortie: Record<string, unknown> = {};
  for (const c of (data ?? []) as Conge[]) {
    const { debut, fin } = periode(c);
    if (Date.now() >= Date.parse(fin)) { await db.from("conges").update({ actif: false }).eq("id", c.id); sortie[c.id] = "terminé"; continue; }
    if (Date.now() < Date.parse(debut) || !c.boites.includes(IONOS().email) || !IONOS().mdp) continue;
    sortie[c.id] = await repondreHarnes(db, c).catch((e) => `erreur : ${e instanceof Error ? e.message : e}`);
  }
  return sortie;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(SUPABASE, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const parCle = !!Deno.env.get("CLE_SYNCHRO") && req.headers.get("x-cle-synchro") === Deno.env.get("CLE_SYNCHRO");
  if (!parCle) {
    const { data: u } = await db.auth.getUser((req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
    if (!u?.user) return json({ erreur: "non autorisé" }, 401);
  }
  const b = await req.json().catch(() => ({}));
  try {
    if (b.veille) return parCle ? json(await veille(db)) : json({ erreur: "non autorisé" }, 403);
    const enCours = async () => ((await db.from("conges").select("*").eq("actif", true).gte("au", aujourdhui()).order("cree_le", { ascending: false })).data ?? []) as Conge[];
    const sans = (x: Boite) => ({ email: x.email, nom: x.nom, fournisseur: x.fournisseur, mode: x.mode });

    if (b.action === "etat") {
      const toutes = await boites(db);
      return json({ conge: (await enCours())[0] ?? null, boites: toutes.map(sans) });
    }
    if (b.action === "arreter") {
      const toutes = await boites(db);
      for (const c of await enCours()) await arreter(db, c, toutes);
      return json({ ok: true });
    }
    if (b.action === "activer") {
      const du = String(b.du ?? ""), au = String(b.au ?? ""), message = String(b.message ?? "").trim().slice(0, 3000);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(du) || !/^\d{4}-\d{2}-\d{2}$/.test(au) || au < du) return json({ erreur: "indique le premier et le dernier jour du congé" }, 400);
      if (au < aujourdhui()) return json({ erreur: "ce congé est déjà passé" }, 400);
      if (!message) return json({ erreur: "écris le message d'absence" }, 400);
      const toutes = await boites(db), voulues: string[] = Array.isArray(b.boites) ? b.boites.map((x: unknown) => String(x).toLowerCase()) : [];
      const choisies = toutes.filter((x) => voulues.includes(x.email) && x.mode === "pret");
      // Un seul congé à la fois : le précédent (modifié) est remplacé
      for (const c of await enCours()) await arreter(db, c, toutes, choisies.map((x) => x.email), true);
      const { data: c, error } = await db.from("conges").insert({ du, au, message, boites: choisies.map((x) => x.email) }).select().single();
      if (error) throw new Error(error.message);
      const etat: Conge["etat"] = {};
      for (const x of choisies) {
        try { await poser(db, x, c as Conge, true); etat[x.email] = { ok: true }; }
        catch (e) { etat[x.email] = { ok: false, erreur: e instanceof Error ? e.message : String(e) }; }
      }
      let evenement_id: string | null = null, erreurAgenda: string | null = null;
      if (b.agenda_id) {
        const p = periode(c as Conge);
        try { evenement_id = (await agenda({ action: "creer", agenda_id: b.agenda_id, titre: "Congé", debut: p.debut, fin: p.fin, journee: true })).evenement?.id ?? null; }
        catch (e) { erreurAgenda = e instanceof Error ? e.message : String(e); }
      }
      const { data: fini } = await db.from("conges").update({ etat, evenement_id }).eq("id", c.id).select().single();
      return json({ conge: fini, erreur_agenda: erreurAgenda });
    }
    return json({ erreur: "action inconnue" }, 400);
  } catch (e) {
    return json({ erreur: e instanceof Error ? e.message : String(e) }, 502);
  }
});
