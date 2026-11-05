// Accès aux agendas Google et Microsoft (Outlook / Microsoft 365) : connexion OAuth, jetons, agendas, rendez-vous.
// Utilisé par agenda-connexion, sync-agendas et agenda-ecrire. Les jetons ne quittent jamais le serveur.

export type Fournisseur = "google" | "microsoft";
export type Usage = "agenda" | "mail"; // agendas (lecture et écriture) ou mails (lecture et tri, pour Victor)
export type Compte = { id: string; fournisseur: Fournisseur; email: string; refresh_token: string | null; jeton_acces: string | null; jeton_expire_le: string | null; usage?: Usage; droits?: string | null };
export type AgendaDistant = { externe_id: string; nom: string; ecriture: boolean; principal: boolean; actif: boolean };
export type RdvDistant = { externe_id: string; debut: string; fin: string; journee: boolean; titre: string | null; lieu: string | null; description: string | null; serie: boolean };
export type RdvSaisi = { titre: string; debut: string; fin: string; journee: boolean; lieu?: string | null; teams?: boolean }; // teams : réunion Teams (Outlook seulement)

const env = (k: string) => Deno.env.get(k) ?? "";
export const urlRetourOAuth = () => `${env("SUPABASE_URL")}/functions/v1/agenda-connexion`;

const GOOGLE = {
  auth: "https://accounts.google.com/o/oauth2/v2/auth",
  jeton: "https://oauth2.googleapis.com/token",
  api: "https://www.googleapis.com/calendar/v3",
  scopes: "openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly",
};
const MICROSOFT = {
  auth: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
  jeton: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
  api: "https://graph.microsoft.com/v1.0",
  scopes: "offline_access openid email User.Read Calendars.ReadWrite",
};

// Mails : lecture, rangement dans des dossiers, marquage lu et mise à la corbeille (jamais d'envoi ni d'effacement définitif).
const SCOPES_MAIL = { google: "openid email https://www.googleapis.com/auth/gmail.modify", microsoft: "offline_access openid email User.Read Mail.ReadWrite" };
// Boîtes Outlook connectées avant le tri (lecture seule) : leur jeton se renouvelle avec les droits d'origine.
const SCOPES_MAIL_LECTURE = "offline_access openid email User.Read Mail.Read";
export const scopes = (f: Fournisseur, u: Usage = "agenda") => u === "mail" ? SCOPES_MAIL[f] : f === "google" ? GOOGLE.scopes : MICROSOFT.scopes;
export const peutTrier = (c: Compte) => /gmail\.modify|Mail\.ReadWrite/i.test(c.droits ?? "");

export function urlAutorisation(f: Fournisseur, etat: string, u: Usage = "agenda"): string {
  const p: Record<string, string> = f === "google"
    ? { client_id: env("GOOGLE_CLIENT_ID"), redirect_uri: urlRetourOAuth(), response_type: "code", scope: scopes(f, u),
        access_type: "offline", prompt: "consent select_account", state: etat }
    : { client_id: env("MS_CLIENT_ID"), redirect_uri: urlRetourOAuth(), response_type: "code", response_mode: "query",
        scope: scopes(f, u), prompt: "select_account", state: etat };
  return `${f === "google" ? GOOGLE.auth : MICROSOFT.auth}?${new URLSearchParams(p)}`;
}

async function demanderJeton(f: Fournisseur, champs: Record<string, string>, u: Usage = "agenda", portee = scopes(f, u)) {
  const base: Record<string, string> = f === "google"
    ? { client_id: env("GOOGLE_CLIENT_ID"), client_secret: env("GOOGLE_CLIENT_SECRET") }
    : { client_id: env("MS_CLIENT_ID"), client_secret: env("MS_CLIENT_SECRET"), scope: portee };
  const r = await fetch(f === "google" ? GOOGLE.jeton : MICROSOFT.jeton, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...base, ...champs }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${f} : ${j.error_description || j.error || r.status}`);
  return j as { access_token: string; refresh_token?: string; expires_in: number; id_token?: string; scope?: string };
}

// Échange du code reçu au retour de la page d'autorisation : jetons + adresse du compte.
export async function echangerCode(f: Fournisseur, code: string, u: Usage = "agenda") {
  const j = await demanderJeton(f, { grant_type: "authorization_code", code, redirect_uri: urlRetourOAuth() }, u);
  let email = "";
  if (f === "google" && j.id_token) {
    email = JSON.parse(atob(j.id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).email ?? "";
  } else {
    const moi = await (await fetch(`${MICROSOFT.api}/me`, { headers: { Authorization: `Bearer ${j.access_token}` } })).json();
    email = moi.mail || moi.userPrincipalName || "";
  }
  return { email: email.toLowerCase(), refresh_token: j.refresh_token ?? null, jeton_acces: j.access_token, droits: j.scope ?? null,
    jeton_expire_le: new Date(Date.now() + (j.expires_in - 60) * 1000).toISOString() };
}

// Jeton d'accès valide pour un compte (rafraîchi et enregistré si besoin).
// deno-lint-ignore no-explicit-any
export async function jetonAcces(db: any, c: Compte): Promise<string> {
  if (c.jeton_acces && c.jeton_expire_le && Date.parse(c.jeton_expire_le) > Date.now()) return c.jeton_acces;
  if (!c.refresh_token) throw new Error("connexion expirée : reconnectez le compte");
  const lectureSeule = c.usage === "mail" && c.fournisseur === "microsoft" && !peutTrier(c);
  const j = await demanderJeton(c.fournisseur, { grant_type: "refresh_token", refresh_token: c.refresh_token }, c.usage ?? "agenda",
    lectureSeule ? SCOPES_MAIL_LECTURE : scopes(c.fournisseur, c.usage ?? "agenda"));
  c.jeton_acces = j.access_token;
  c.jeton_expire_le = new Date(Date.now() + (j.expires_in - 60) * 1000).toISOString();
  const maj: Record<string, string> = { jeton_acces: c.jeton_acces, jeton_expire_le: c.jeton_expire_le };
  if (j.refresh_token) { c.refresh_token = j.refresh_token; maj.refresh_token = j.refresh_token; } // Microsoft renouvelle le jeton longue durée
  await db.from("comptes_agenda").update({ ...maj, derniere_erreur: null }).eq("id", c.id);
  return c.jeton_acces;
}

async function appel(jeton: string, url: string, options: RequestInit = {}) {
  const r = await fetch(url, { ...options, headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json", ...(options.headers || {}) } });
  if (r.status === 204 || r.status === 410) return null; // supprimé
  const texte = await r.text();
  const j = texte ? JSON.parse(texte) : null;
  if (!r.ok) throw new Error(j?.error?.message || j?.error_description || `HTTP ${r.status}`);
  return j;
}

export async function listerAgendas(c: Compte, jeton: string): Promise<AgendaDistant[]> {
  if (c.fournisseur === "google") {
    const j = await appel(jeton, `${GOOGLE.api}/users/me/calendarList?maxResults=250`);
    // deno-lint-ignore no-explicit-any
    return (j.items || []).filter((a: any) => a.accessRole !== "freeBusyReader").map((a: any) => ({
      externe_id: a.id, nom: a.summaryOverride || a.summary || a.id, ecriture: a.accessRole === "owner" || a.accessRole === "writer", principal: !!a.primary,
      // jours fériés, anniversaires et agendas importés par adresse (déjà connectés en direct) : désactivés par défaut
      actif: !/#holiday@|#contacts@|#weeknum@|@import\.calendar\.google\.com$/.test(a.id),
    }));
  }
  const j = await appel(jeton, `${MICROSOFT.api}/me/calendars?$top=100`);
  // deno-lint-ignore no-explicit-any
  return (j.value || []).map((a: any) => ({ externe_id: a.id, nom: a.name, ecriture: !!a.canEdit, principal: !!a.isDefaultCalendar,
    actif: !!a.isDefaultCalendar || !/anniversaire|birthday|férié|holiday/i.test(a.name) }));
}

const utc = (s: string) => (/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : s.replace(/\.\d+$/, "") + "Z");
function minuitParis(date: string): string { // « 2026-11-05 » -> instant UTC de minuit à Paris
  const utcMs = Date.parse(date + "T00:00:00Z");
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(utcMs));
  const v = (k: string) => Number(p.find((x) => x.type === k)!.value);
  const decal = Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute")) - utcMs;
  return new Date(utcMs - decal).toISOString();
}
const texte = (v: unknown) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, 2000));

export async function lireRdv(c: Compte, jeton: string, agendaId: string, debut: Date, fin: Date): Promise<RdvDistant[]> {
  const sortie: RdvDistant[] = [];
  if (c.fournisseur === "google") {
    let page = "";
    do {
      const q = new URLSearchParams({ timeMin: debut.toISOString(), timeMax: fin.toISOString(), singleEvents: "true", maxResults: "2500", ...(page ? { pageToken: page } : {}) });
      const j = await appel(jeton, `${GOOGLE.api}/calendars/${encodeURIComponent(agendaId)}/events?${q}`);
      for (const e of j.items || []) {
        if (e.status === "cancelled") continue;
        const journee = !!e.start?.date;
        sortie.push({ externe_id: e.id, journee, serie: !!e.recurringEventId,
          debut: journee ? minuitParis(e.start.date) : new Date(e.start.dateTime).toISOString(),
          fin: journee ? minuitParis(e.end.date) : new Date(e.end.dateTime).toISOString(),
          titre: texte(e.summary), lieu: texte(e.location), description: texte(e.description) });
      }
      page = j.nextPageToken || "";
    } while (page);
    return sortie;
  }
  const q = new URLSearchParams({ startDateTime: debut.toISOString(), endDateTime: fin.toISOString(), $top: "500",
    $select: "id,subject,start,end,isAllDay,location,bodyPreview,isCancelled,type" });
  let url = `${MICROSOFT.api}/me/calendars/${encodeURIComponent(agendaId)}/calendarView?${q}`;
  while (url) {
    const j = await appel(jeton, url, { headers: { Prefer: 'outlook.timezone="Europe/Paris"' } });
    for (const e of j.value || []) {
      if (e.isCancelled) continue;
      const journee = !!e.isAllDay;
      sortie.push({ externe_id: e.id, journee, serie: e.type === "occurrence" || e.type === "exception",
        debut: journee ? minuitParis(e.start.dateTime.slice(0, 10)) : parisVersUtc(e.start.dateTime),
        fin: journee ? minuitParis(e.end.dateTime.slice(0, 10)) : parisVersUtc(e.end.dateTime),
        titre: texte(e.subject), lieu: texte(e.location?.displayName), description: texte(e.bodyPreview) });
    }
    url = j["@odata.nextLink"] || "";
  }
  return sortie;
}
function parisVersUtc(local: string): string { // « 2026-11-03T09:00:00.0000000 » heure de Paris -> ISO UTC
  const [d, h] = local.split("T");
  const base = Date.parse(minuitParis(d));
  const [hh, mm, ss] = h.split(":").map((x) => parseFloat(x));
  // minuitParis tient compte de l'heure d'été ; les changements d'heure ont lieu la nuit, l'écart est négligeable en journée
  return new Date(base + ((hh * 60 + mm) * 60 + (ss || 0)) * 1000).toISOString();
}

// Création, modification ou suppression d'un rendez-vous chez le fournisseur. Retourne l'identifiant distant.
export async function ecrireRdv(c: Compte, jeton: string, agendaId: string, action: "creer" | "modifier" | "supprimer", rdvId: string | null, r?: RdvSaisi): Promise<string | null> {
  const jour = (iso: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris" }).format(new Date(iso)); // AAAA-MM-JJ à Paris
  if (c.fournisseur === "google") {
    const base = `${GOOGLE.api}/calendars/${encodeURIComponent(agendaId)}/events`;
    if (action === "supprimer") { await appel(jeton, `${base}/${encodeURIComponent(rdvId!)}`, { method: "DELETE" }); return null; }
    const corps = { summary: r!.titre, location: r!.lieu ?? null,
      start: r!.journee ? { date: jour(r!.debut), dateTime: null } : { dateTime: r!.debut, timeZone: "Europe/Paris", date: null },
      end: r!.journee ? { date: jour(r!.fin), dateTime: null } : { dateTime: r!.fin, timeZone: "Europe/Paris", date: null } };
    const j = action === "creer"
      ? await appel(jeton, base, { method: "POST", body: JSON.stringify(corps) })
      : await appel(jeton, `${base}/${encodeURIComponent(rdvId!)}`, { method: "PATCH", body: JSON.stringify(corps) });
    return j.id;
  }
  if (action === "supprimer") { await appel(jeton, `${MICROSOFT.api}/me/events/${encodeURIComponent(rdvId!)}`, { method: "DELETE" }); return null; }
  const quand = (iso: string) => r!.journee ? { dateTime: jour(iso) + "T00:00:00", timeZone: "Europe/Paris" } : { dateTime: iso.replace(/Z$/, ""), timeZone: "UTC" };
  const corps = { subject: r!.titre, isAllDay: r!.journee, start: quand(r!.debut), end: quand(r!.fin), location: { displayName: r!.lieu ?? "" },
    ...(r!.teams ? { isOnlineMeeting: true, onlineMeetingProvider: "teamsForBusiness" } : {}) };
  const j = action === "creer"
    ? await appel(jeton, `${MICROSOFT.api}/me/calendars/${encodeURIComponent(agendaId)}/events`, { method: "POST", body: JSON.stringify(corps) })
    : await appel(jeton, `${MICROSOFT.api}/me/events/${encodeURIComponent(rdvId!)}`, { method: "PATCH", body: JSON.stringify(corps) });
  return j.id;
}

// Rendez-vous reçu en invitation ? Renvoie le nom de l'organisateur si ce n'est pas le titulaire du compte, sinon null.
// Google : le titulaire figure parmi les participants sans être l'organisateur. Outlook : isOrganizer vaut false.
export async function organisateurAutre(c: Compte, jeton: string, agendaId: string, rdvId: string): Promise<string | null> {
  if (c.fournisseur === "google") {
    const e = await appel(jeton, `${GOOGLE.api}/calendars/${encodeURIComponent(agendaId)}/events/${encodeURIComponent(rdvId)}`);
    // deno-lint-ignore no-explicit-any
    const moi = (e?.attendees ?? []).find((a: any) => a.self);
    return moi && !moi.organizer && !e.organizer?.self ? (e.organizer?.displayName || e.organizer?.email || "quelqu'un d'autre") : null;
  }
  const e = await appel(jeton, `${MICROSOFT.api}/me/events/${encodeURIComponent(rdvId)}?$select=isOrganizer,organizer`);
  return e && e.isOrganizer === false ? (e.organizer?.emailAddress?.name || e.organizer?.emailAddress?.address || "quelqu'un d'autre") : null;
}

// Projet par défaut d'un agenda d'après son nom et l'adresse du compte.
export function projetParDefaut(nom: string, email: string): string | null {
  const t = `${nom} ${email}`.toLowerCase();
  if (/palomano|maillerie/.test(t)) return "palomano";
  if (/evoa/.test(t)) return "evoa-courtage";
  if (/harnes|volley/.test(t)) return "harnes-volley";
  if (/camp|rouzier.?mar/.test(t)) return "camp-rouzier-marechal";
  if (/berkay/.test(t)) return "berkay";
  if (/wealthy/.test(t)) return "wealthy";
  if (/famille|perso/.test(t)) return "perso";
  return null;
}

// Jeton signé (HMAC) qui accompagne l'aller-retour vers la page d'autorisation.
async function cle() {
  return await crypto.subtle.importKey("raw", new TextEncoder().encode(env("CLE_SYNCHRO")), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export async function signerEtat(f: Fournisseur, u: Usage = "agenda"): Promise<string> {
  const charge = b64(new TextEncoder().encode(JSON.stringify({ f, u, exp: Date.now() + 15 * 60000, n: crypto.randomUUID() })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await cle(), new TextEncoder().encode(charge)));
  return `${charge}.${b64(sig)}`;
}
export async function lireEtat(etat: string): Promise<{ f: Fournisseur; u: Usage } | null> {
  const [charge, sig] = etat.split(".");
  if (!charge || !sig) return null;
  const brut = Uint8Array.from(atob(sig.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((sig.length + 3) % 4)), (ch) => ch.charCodeAt(0));
  if (!(await crypto.subtle.verify("HMAC", await cle(), brut, new TextEncoder().encode(charge)))) return null;
  const j = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(charge.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((charge.length + 3) % 4)), (ch) => ch.charCodeAt(0))));
  return j.exp > Date.now() ? { f: j.f, u: j.u === "mail" ? "mail" : "agenda" } : null;
}
