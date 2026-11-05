// Tâche ou rendez-vous dicté depuis l'iPhone (Raccourci « Tâche pour Victor ») : une phrase libre devient une ligne de
// `taches` ou un rendez-vous dans le bon agenda. Claude Haiku 5.5 en tire le type, le titre, le projet, la date, l'heure,
// la durée, le lieu et la priorité ; sans lui, une tâche est créée d'après les mots-clés des projets.
// Rendez-vous (une heure est dite, ou « toute la journée ») : écrit par agenda-ecrire dans l'agenda du projet
// (Palomano : Outlook avec lien Teams ; Harnes, Camp : leurs agendas Google ; Perso, Berkay, Wealthy : agenda Google principal).
// Evoa : son agenda Outlook une fois connecté (page Agendas), sinon une tâche « À caler ». Un chevauchement est signalé, pas bloqué.
// Protégée par une clé personnelle dédiée (secret CLE_TACHE, posée par outils/cle-tache.sh), passée dans l'en-tête x-cle-tache.
//  POST { texte: "Relancer Toynamics pour le solde créditeur vendredi" }   (ou le texte brut en corps)
//  -> 201, texte court : « Ajoutée : Relancer Toynamics pour le solde créditeur · Palomano · demain, vendredi 6 »
//  POST { texte, essai: true } -> renvoie ce qui serait créé, sans rien écrire
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import Anthropic from "npm:@anthropic-ai/sdk@1.4.0";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk@1.4.0/helpers/zod";
import { z } from "npm:zod@4.6.7";

const CLE_TACHE = Deno.env.get("CLE_TACHE") ?? "";
const URL_PROJET = Deno.env.get("SUPABASE_URL")!;
const db = createClient(URL_PROJET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const texte = (corps: string, status = 200) => new Response(corps, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
const COURTS: Record<string, string> = { "evoa-courtage": "Evoa", "camp-rouzier-marechal": "Camp", "wealthy": "Wealthy", "harnes-volley": "Harnes" };
const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const AVEC_TEAMS = new Set(["palomano"]); // projets dont les rendez-vous Outlook reçoivent un lien Teams
const SANS_REPLI = new Set(["evoa-courtage"]); // sans agenda propre connecté, le rendez-vous devient une tâche (jamais l'agenda perso)

type Activite = { id: string; nom: string; description: string | null; mots_cles: string[] | null };
type Comprise = {
  type: "tache" | "rdv"; titre: string; activite_id: string; date: string | null; heure: string | null; heure_fin: string | null;
  duree: number; journee: boolean; lieu: string | null; priorite: "haute" | "moyenne" | "basse";
};

function egal(a: string, b: string) { // comparaison à temps constant
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// ---------- Dates (Europe/Paris) ----------
const jourParis = (d = new Date()) => new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(d); // AAAA-MM-JJ
const enDate = (iso: string) => new Date(iso + "T12:00:00Z");
const plus = (iso: string, n: number) => new Date(enDate(iso).getTime() + n * 864e5).toISOString().slice(0, 10);
function parisEnUtc(date: string, hhmm: string): Date { // « 2026-11-12 », « 14:30 » (heure de Paris) -> instant UTC
  const brut = Date.parse(`${date}T${hhmm}:00Z`);
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(brut));
  const v = (k: string) => Number(p.find((x) => x.type === k)!.value);
  return new Date(brut - (Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute")) - brut));
}
const heureParis = (d: Date) => {
  const [h, m] = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }).format(d).split(":");
  return `${Number(h)} h${m === "00" ? "" : " " + m}`;
};
function dire(echeance: string, aujourdhui: string) {
  const d = enDate(echeance), ecart = Math.round((d.getTime() - enDate(aujourdhui).getTime()) / 864e5);
  const jour = `${JOURS[d.getUTCDay()]} ${d.getUTCDate()}`;
  if (ecart === 0) return `aujourd'hui, ${jour}`;
  if (ecart === 1) return `demain, ${jour}`;
  return ecart > 0 && ecart < 7 ? jour : `${jour} ${MOIS[d.getUTCMonth()]}`;
}

function parMotsCles(phrase: string, acts: Activite[]) {
  const p = ` ${phrase.toLowerCase()} `;
  return acts.find((a) => (a.mots_cles ?? []).some((m) => m && p.includes(m.toLowerCase())))?.id ?? "perso";
}

// ---------- Compréhension par Claude ----------
async function comprendre(phrase: string, acts: Activite[], aujourdhui: string): Promise<Comprise> {
  const [{ data: clients }, { data: recentes }] = await Promise.all([
    db.from("clients").select("nom, activite_id").limit(400),
    db.from("taches").select("titre, activite_id").order("cree_le", { ascending: false }).limit(80),
  ]);
  const calendrier = Array.from({ length: 21 }, (_, i) => { const j = plus(aujourdhui, i); return `${JOURS[enDate(j).getUTCDay()]} ${j}`; });
  const Sortie = z.object({
    type: z.enum(["tache", "rdv"]), titre: z.string(), activite: z.enum(acts.map((a) => a.id) as [string, ...string[]]),
    date: z.string(), heure: z.string(), heure_fin: z.string(), duree_minutes: z.number().int(), journee: z.boolean(),
    lieu: z.string(), priorite: z.enum(["haute", "moyenne", "basse"]),
  });
  const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
  const r = await client.messages.parse({
    model: "claude-haiku-5-5",
    max_tokens: 1000,
    output_config: { effort: "low", format: zodOutputFormat(Sortie) },
    system: `Tu es Victor, l'assistant d'Antonin Rouzier. Antonin te dicte depuis son téléphone une tâche ou un rendez-vous ; tu le ranges dans son cockpit. Français, sans émoticônes.

- type : « rdv » si une heure précise est dite (« à 14 h », « de 9 h à 10 h », « 14 h 30 ») ou si c'est un événement sur toute la journée (« toute la journée », « salon mardi ») ; sinon « tache ». « Appeler X demain » est une tâche ; « Appeler X demain à 10 h » est un rendez-vous.
- titre : court, sans la date, l'heure, la durée ni le lieu, et sans les mots « tâche », « rendez-vous pour Victor », « rappelle-moi ». Tâche : à l'infinitif, majuscule au début (« Relancer Toynamics pour le solde créditeur »). Rendez-vous : comme dans un agenda (« Point Excom avec Julien », « Déjeuner avec A. Monteil »). Garde les noms propres tels quels (corrige seulement une faute de dictée évidente).
- activite : le projet concerné, d'après les noms de clients, les mots-clés et les tâches récentes ci-dessous ; « perso » si rien ne correspond.
- date : AAAA-MM-JJ si un jour est dit (« vendredi » = le prochain vendredi à venir, aujourd'hui exclu ; « demain » ; « fin de semaine » = vendredi ; « la semaine prochaine » = lundi prochain ; « avant le 15 » = le 15), sinon chaîne vide. Un rendez-vous avec une heure mais sans jour : aujourd'hui si l'heure n'est pas passée, sinon demain.
- heure : HH:MM (24 h) du début d'un rendez-vous (« 14 h » = 14:00, « 9 h et demie » = 09:30), sinon chaîne vide. heure_fin : HH:MM si une heure de fin est dite, sinon chaîne vide.
- duree_minutes : durée dite (« pendant 2 h » = 120, « une demi-heure » = 30), sinon 0.
- journee : true seulement pour un rendez-vous sur toute la journée sans heure.
- lieu : le lieu dit (« au bureau », « à la Maillerie », « chez le client »), sans la préposition, sinon chaîne vide.
- priorite : « haute » si c'est dit urgent ou important, « basse » si c'est dit sans urgence ou « quand j'ai le temps », sinon « moyenne ».

Maintenant : ${JOURS[enDate(aujourdhui).getUTCDay()]} ${aujourdhui}, ${heureParis(new Date())} (Europe/Paris). Jours à venir : ${calendrier.join(", ")}.

Projets :
${acts.map((a) => `- ${a.id} (${a.nom}) : ${a.description ?? ""}${a.mots_cles?.length ? ` Mots-clés : ${a.mots_cles.join(", ")}.` : ""}`).join("\n")}

Clients par projet :
${acts.map((a) => `- ${a.id} : ${(clients ?? []).filter((c) => c.activite_id === a.id).map((c) => c.nom).join(", ") || "-"}`).join("\n")}

Tâches récentes (projet : titre) :
${(recentes ?? []).map((t) => `- ${t.activite_id} : ${t.titre}`).join("\n")}`,
    messages: [{ role: "user", content: phrase }],
  });
  const o = r.parsed_output;
  if (!o) throw new Error(`réponse illisible (${r.stop_reason})`);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(o.date) && o.date >= aujourdhui && o.date <= plus(aujourdhui, 730) ? o.date : null;
  const hh = (h: string) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(h) ? h : null);
  return { type: o.type, titre: o.titre.trim() || phrase, activite_id: o.activite, date, heure: hh(o.heure), heure_fin: hh(o.heure_fin),
    duree: o.duree_minutes > 0 && o.duree_minutes <= 24 * 60 ? o.duree_minutes : 60, journee: o.journee,
    lieu: o.lieu.trim() || null, priorite: o.priorite };
}

// ---------- Rendez-vous ----------
type Agenda = { id: string; nom: string; activite_id: string | null; fournisseur: string; email: string };
async function agendaPour(activite: string): Promise<Agenda | null> {
  const { data } = await db.from("agendas").select("id, nom, activite_id, comptes_agenda!inner(fournisseur, email, usage)")
    .eq("ecriture", true).eq("actif", true).eq("comptes_agenda.usage", "agenda");
  // deno-lint-ignore no-explicit-any
  const liste: Agenda[] = (data ?? []).map((a: any) => ({ id: a.id, nom: a.nom, activite_id: a.activite_id, fournisseur: a.comptes_agenda.fournisseur, email: a.comptes_agenda.email }));
  const duProjet = liste.filter((a) => a.activite_id === activite).sort((a, b) => (a.fournisseur === "microsoft" ? -1 : 0) - (b.fournisseur === "microsoft" ? -1 : 0));
  if (duProjet.length && activite !== "perso") return duProjet[0];
  if (SANS_REPLI.has(activite)) return null;
  return liste.find((a) => a.fournisseur === "google" && a.nom === a.email && !a.activite_id) ?? null; // agenda principal (Perso, Berkay, Wealthy…)
}

async function chevauchement(debut: Date, fin: Date) {
  const { data } = await db.from("evenements").select("titre, debut, fin").eq("annule", false).eq("journee", false)
    .lt("debut", fin.toISOString()).gt("fin", debut.toISOString()).order("debut").limit(20);
  // les séjours sur plusieurs jours (week-end, déplacement) ne comptent pas comme un chevauchement
  return (data ?? []).find((e) => Date.parse(e.fin) - Date.parse(e.debut) < 12 * 3600e3)?.titre ?? null;
}

async function creerRdv(corps: Record<string, unknown>) {
  const r = await fetch(`${URL_PROJET}/functions/v1/agenda-ecrire`, {
    method: "POST", headers: { "x-cle-synchro": Deno.env.get("CLE_SYNCHRO") ?? "", "Content-Type": "application/json" },
    body: JSON.stringify({ action: "creer", ...corps }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erreur ?? `HTTP ${r.status}`);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return texte("Envoyer la tâche en POST.", 405);
  const cle = req.headers.get("x-cle-tache") ?? "";
  // CLE_TACHE_ESSAI : clé temporaire pour tester sans toucher à celle du téléphone (posée puis retirée par l'API d'administration)
  if (!egal(CLE_TACHE, cle) && !egal(Deno.env.get("CLE_TACHE_ESSAI") ?? "", cle)) return texte("Clé refusée : vérifier l'en-tête x-cle-tache du raccourci.", 401);

  const brut = await req.text();
  let corps: { texte?: string; essai?: boolean } = {};
  try { corps = JSON.parse(brut); } catch { corps = { texte: brut }; }
  if (typeof corps !== "object" || corps === null) corps = { texte: String(corps) };
  const phrase = String(corps.texte ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  if (!phrase) return texte("Rien à ajouter : la phrase est vide.", 400);

  const aujourdhui = jourParis();
  const { data: acts, error } = await db.from("activites").select("id, nom, description, mots_cles").order("ordre");
  if (error || !acts?.length) return texte("Cockpit injoignable, réessayer dans un instant.", 500);

  let c: Comprise, secours = false;
  try {
    if (!Deno.env.get("ANTHROPIC_API_KEY")) throw new Error("clé ANTHROPIC_API_KEY absente");
    c = await comprendre(phrase, acts as Activite[], aujourdhui);
  } catch (e) {
    console.error("ajouter-tache : Claude indisponible,", e instanceof Error ? e.message : e);
    secours = true;
    c = { type: "tache", titre: phrase.charAt(0).toUpperCase() + phrase.slice(1), activite_id: parMotsCles(phrase, acts as Activite[]),
      date: null, heure: null, heure_fin: null, duree: 60, journee: false, lieu: null, priorite: "moyenne" };
  }
  c.titre = c.titre.slice(0, 200);
  const nom = COURTS[c.activite_id] ?? acts.find((a) => a.id === c.activite_id)?.nom ?? c.activite_id;
  const essai = corps.essai ? "Essai (rien d'écrit) : " : "";

  // ----- Rendez-vous -----
  if (c.type === "rdv" && c.date && (c.heure || c.journee)) {
    const debut = c.heure ? parisEnUtc(c.date, c.heure) : parisEnUtc(c.date, "00:00");
    let fin = c.heure ? (c.heure_fin ? parisEnUtc(c.date, c.heure_fin) : new Date(debut.getTime() + c.duree * 60000)) : parisEnUtc(plus(c.date, 1), "00:00");
    if (fin <= debut) fin = new Date(debut.getTime() + 60 * 60000);
    const quand = `${dire(c.date, aujourdhui)}${c.heure ? `, ${heureParis(debut)} – ${heureParis(fin)}` : ", toute la journée"}`;
    const agenda = await agendaPour(c.activite_id);
    if (agenda) {
      const teams = agenda.fournisseur === "microsoft" && AVEC_TEAMS.has(c.activite_id) && !!c.heure;
      const conflit = c.heure ? await chevauchement(debut, fin) : null;
      const rdv = { agenda_id: agenda.id, titre: c.titre, debut: debut.toISOString(), fin: fin.toISOString(), journee: !c.heure, lieu: c.lieu,
        ...(agenda.activite_id !== c.activite_id ? { activite_forcee: c.activite_id } : {}) };
      let sansTeams = false;
      if (!essai) {
        try { await creerRdv({ ...rdv, teams }); }
        catch (e) {
          if (!teams) { console.error("ajouter-tache : rendez-vous", e instanceof Error ? e.message : e); return texte(`Le rendez-vous n'a pas pu être créé dans ${agenda.nom}, réessayer.`, 502); }
          try { await creerRdv(rdv); sansTeams = true; } // Teams refusé par le compte : rendez-vous créé sans lien
          catch (e2) { console.error("ajouter-tache : rendez-vous", e2 instanceof Error ? e2.message : e2); return texte(`Le rendez-vous n'a pas pu être créé dans ${agenda.nom}, réessayer.`, 502); }
        }
      }
      const ou = `${nom} (${agenda.fournisseur === "microsoft" ? "Outlook" : "agenda " + agenda.nom}${teams ? (sansTeams ? ", sans lien Teams" : ", lien Teams") : ""})`;
      const resume = [c.titre, ou, quand, c.lieu].filter(Boolean).join(" · ");
      return texte(`${essai || "Rendez-vous ajouté : "}${resume}${conflit ? `. Attention : chevauche « ${conflit} »` : ""}`, essai ? 200 : 201);
    }
    // Pas d'agenda modifiable pour ce projet (Evoa, tant que son Outlook n'est pas connecté) : une tâche « À caler » à la date dite
    c = { ...c, type: "tache", titre: `À caler : ${c.titre} (${c.heure ? quand.split(", ").pop() : "journée"}${c.lieu ? `, ${c.lieu}` : ""})`.slice(0, 200) };
  }

  // ----- Tâche -----
  const resume = [c.titre, nom, c.date ? dire(c.date, aujourdhui) : null, c.priorite === "moyenne" ? null : `priorité ${c.priorite}`]
    .filter(Boolean).join(" · ");
  if (essai) return texte(`${essai}tâche ${resume}${secours ? " (sans Claude)" : ""}`);
  const notes = "Dictée depuis l'iPhone" + (phrase.toLowerCase() !== c.titre.toLowerCase() ? ` : « ${phrase} »` : "");
  const { error: e2 } = await db.from("taches").insert({ titre: c.titre, activite_id: c.activite_id, echeance: c.date, priorite: c.priorite, notes, statut: "a-faire" });
  if (e2) { console.error("ajouter-tache :", e2.message); return texte("La tâche n'a pas pu être enregistrée, réessayer.", 500); }
  return texte(`Ajoutée : ${resume}${secours ? " (projet deviné sans Claude, à vérifier)" : ""}`, 201);
});
