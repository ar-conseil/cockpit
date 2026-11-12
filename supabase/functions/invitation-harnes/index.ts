// Invitation d'agenda envoyée depuis la boîte du club (antonin.rouzier@harnes-volleyball.fr, IONOS, SMTP) pour un rendez-vous
// Harnes du cockpit : un vrai mail d'invitation (iCalendar, METHOD:REQUEST) que Gmail, Outlook ou Apple affichent avec
// « Oui / Non / Peut-être », organisé par l'adresse du club, avec le lien de visio du rendez-vous. Une copie est rangée dans
// les Éléments envoyés de la boîte Harnes. annuler: true envoie l'annulation (METHOD:CANCEL) de la même invitation.
// Session du cockpit ou clé de synchro (assistant).  POST { evenement_id, emails: [..], annuler? } -> { ok, envoye_a }
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { base64Lignes, enteteUtf8, envoyerSmtp } from "../_partage/smtp.ts";
import { messageHtml } from "../_partage/reponses.ts";
import { connexionImap } from "../_partage/mails.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cle-synchro",
  "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: { ...cors, "Content-Type": "application/json" } });
const NOM = "Antonin Rouzier";

const ics = (t: string) => t.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const utc = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
function plier(ligne: string) {             // lignes iCalendar de 75 octets au plus
  const o = new TextEncoder().encode(ligne);
  if (o.length <= 75) return ligne;
  const morceaux: string[] = []; let courant = "", taille = 0;
  for (const c of ligne) {
    const n = new TextEncoder().encode(c).length;
    if (taille + n > (morceaux.length ? 74 : 75)) { morceaux.push(courant); courant = ""; taille = 0; }
    courant += c; taille += n;
  }
  morceaux.push(courant);
  return morceaux.join("\r\n ");
}
const quandParis = (iso: string) => new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const heureParis = (iso: string) => new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const parCle = !!Deno.env.get("CLE_SYNCHRO") && req.headers.get("x-cle-synchro") === Deno.env.get("CLE_SYNCHRO");
  if (!parCle) {
    const { data: u } = await db.auth.getUser((req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
    if (!u?.user) return json({ erreur: "non autorisé" }, 401);
  }
  const b = await req.json().catch(() => ({}));
  const emails = (Array.isArray(b.emails) ? b.emails : []).map((x: unknown) => String(x).trim().toLowerCase())
    .filter((x: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)).slice(0, 20);
  if (!emails.length) return json({ erreur: "aucune adresse valable" }, 400);
  const { data: ev } = await db.from("evenements").select("id, externe_id, uid, titre, debut, fin, journee, lieu, visio").eq("id", b.evenement_id).maybeSingle();
  if (!ev) return json({ erreur: "rendez-vous introuvable" }, 404);
  const de = Deno.env.get("IONOS_EMAIL") ?? "", mdp = Deno.env.get("IONOS_MOT_DE_PASSE") ?? "";
  if (!de || !mdp) return json({ erreur: "boîte Harnes non configurée (outils/ionos.sh)" }, 400);

  const annuler = !!b.annuler, methode = annuler ? "CANCEL" : "REQUEST";
  const lien = ev.visio ?? null, lieu = lien ? (ev.lieu ? `${ev.lieu} · ${lien}` : lien) : (ev.lieu ?? "");
  const description = [lien ? `Rejoindre la visio : ${lien}` : "", `Organisé par ${NOM} (${de})`].filter(Boolean).join("\n");
  const uidInvitation = `${ev.externe_id ?? ev.uid ?? ev.id}-harnes@cockpit`;
  const lignes = ["BEGIN:VCALENDAR", "PRODID:-//Cockpit Antonin Rouzier//FR", "VERSION:2.0", "CALSCALE:GREGORIAN", `METHOD:${methode}`, "BEGIN:VEVENT",
    `UID:${uidInvitation}`, `DTSTAMP:${utc(new Date().toISOString())}`,
    ...(ev.journee ? [`DTSTART;VALUE=DATE:${ev.debut.slice(0, 10).replace(/-/g, "")}`, `DTEND;VALUE=DATE:${ev.fin.slice(0, 10).replace(/-/g, "")}`]
      : [`DTSTART:${utc(ev.debut)}`, `DTEND:${utc(ev.fin)}`]),
    `SUMMARY:${ics(ev.titre ?? "Rendez-vous")}`, ...(lieu ? [`LOCATION:${ics(lieu)}`] : []), `DESCRIPTION:${ics(description)}`,
    ...(lien ? [`URL:${lien}`] : []),
    `ORGANIZER;CN=${NOM}:mailto:${de}`,
    ...emails.map((x: string) => `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${x}`),
    `SEQUENCE:${annuler ? 1 : 0}`, `STATUS:${annuler ? "CANCELLED" : "CONFIRMED"}`, "END:VEVENT", "END:VCALENDAR"].map(plier).join("\r\n");

  const quand = ev.journee ? new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long" }).format(new Date(ev.debut))
    : `${quandParis(ev.debut)} – ${heureParis(ev.fin)}`;
  const objet = `${annuler ? "Annulé" : "Invitation"} : ${ev.titre} @ ${quand}`;
  const { data: sig } = await db.from("signatures").select("texte, html").eq("boite", de.toLowerCase()).maybeSingle();
  const signature = sig?.texte?.trim() || NOM;     // signature de la boîte Harnes (page Tri des boîtes du cockpit)
  const texte = annuler ? `Bonjour,\n\nLe rendez-vous « ${ev.titre} » du ${quand} est annulé.\n\nBien à vous,\n\n${signature}`
    : `Bonjour,\n\nJe vous invite à « ${ev.titre} », ${quand} (heure de Paris).${lien ? `\n\nRejoindre la visio : ${lien}` : ""}${ev.lieu ? `\nLieu : ${ev.lieu}` : ""}\n\nBien à vous,\n\n${signature}`;
  const html = await messageHtml(db, de, texte);       // version mise en forme, avec la signature HTML du club
  const frontiere = "cockpit-" + crypto.randomUUID();
  const message = [
    `From: ${enteteUtf8(NOM)} <${de}>`, `To: ${emails.join(", ")}`, `Subject: ${enteteUtf8(objet)}`, `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${crypto.randomUUID()}@harnes-volleyball.fr>`, "MIME-Version: 1.0", `Content-Type: multipart/mixed; boundary="${frontiere}"`, "",
    `--${frontiere}`, `Content-Type: multipart/alternative; boundary="${frontiere}-alt"`, "",
    `--${frontiere}-alt`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", base64Lignes(texte), "",
    ...(html ? [`--${frontiere}-alt`, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", base64Lignes(html), ""] : []),
    `--${frontiere}-alt`, `Content-Type: text/calendar; charset=UTF-8; method=${methode}`, "Content-Transfer-Encoding: base64", "", base64Lignes(lignes), "",
    `--${frontiere}-alt--`, "",
    `--${frontiere}`, `Content-Type: application/ics; name="invitation.ics"`, `Content-Disposition: attachment; filename="invitation.ics"`,
    "Content-Transfer-Encoding: base64", "", base64Lignes(lignes), "", `--${frontiere}--`, ""].join("\r\n");

  try {
    await envoyerSmtp(Deno.env.get("IONOS_SMTP") || "smtp.ionos.fr", de, mdp, de, emails, message);
  } catch (e) {
    return json({ erreur: e instanceof Error ? e.message : String(e) }, 502);
  }
  // Copie dans les Éléments envoyés (sans bloquer l'envoi si elle échoue)
  try {
    const { cmd, cite, fermer } = await connexionImap(Deno.env.get("IONOS_IMAP") || "imap.ionos.fr", de, mdp);
    try {
      const liste = await cmd('LIST "" "*"');
      const envoyes = /\* LIST \([^)]*\\Sent[^)]*\) (?:"[^"]*"|NIL) (?:"((?:[^"\\]|\\.)*)"|(\S+))/i.exec(liste);
      const dossier = envoyes ? (envoyes[1] ?? envoyes[2]) : "Gesendete Objekte";
      const octets = new TextEncoder().encode(message).length;
      await cmd(`APPEND ${cite(dossier)} (\\Seen) {${octets}+}\r\n${message}`);
    } finally { await fermer(); }
  } catch (e) { console.error("invitation-harnes : copie non rangée", e instanceof Error ? e.message : e); }
  return json({ ok: true, envoye_a: emails, de });
});
