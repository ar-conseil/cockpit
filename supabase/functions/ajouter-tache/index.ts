// Ajout d'une tâche depuis l'iPhone (Raccourci « Tâche pour Victor ») : une phrase libre devient une ligne de `taches`.
// Claude Haiku 5.5 en tire le titre, le projet, l'échéance et la priorité ; sans lui, les mots-clés des projets suffisent.
// Protégée par une clé personnelle dédiée (secret CLE_TACHE, posée par outils/cle-tache.sh), passée dans l'en-tête x-cle-tache.
//  POST { texte: "Relancer Toynamics pour le solde créditeur vendredi" }   (ou le texte brut en corps)
//  -> 201, texte court : « Ajoutée : Relancer Toynamics pour le solde créditeur · Palomano · vendredi 7 »
//  POST { texte, essai: true } -> renvoie ce qui serait créé, sans rien écrire
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import Anthropic from "npm:@anthropic-ai/sdk@1.4.0";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk@1.4.0/helpers/zod";
import { z } from "npm:zod@4.6.7";

const CLE_TACHE = Deno.env.get("CLE_TACHE") ?? "";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const texte = (corps: string, status = 200) => new Response(corps, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
const COURTS: Record<string, string> = { "evoa-courtage": "Evoa", "camp-rouzier-marechal": "Camp", "wealthy": "Wealthy", "harnes-volley": "Harnes" };
const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

type Activite = { id: string; nom: string; description: string | null; mots_cles: string[] | null };
type Tache = { titre: string; activite_id: string; echeance: string | null; priorite: "haute" | "moyenne" | "basse" };

function egal(a: string, b: string) { // comparaison à temps constant
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const jourParis = (d = new Date()) => new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(d); // AAAA-MM-JJ
const enDate = (iso: string) => new Date(iso + "T12:00:00Z");
const plus = (iso: string, n: number) => new Date(enDate(iso).getTime() + n * 864e5).toISOString().slice(0, 10);

function dire(echeance: string, aujourdhui: string) {
  const d = enDate(echeance), ecart = Math.round((d.getTime() - enDate(aujourdhui).getTime()) / 864e5);
  if (ecart === 0) return "aujourd'hui";
  const jour = `${JOURS[d.getUTCDay()]} ${d.getUTCDate()}`;
  if (ecart === 1) return `demain, ${jour}`;
  return ecart > 0 && ecart < 7 ? jour : `${jour} ${MOIS[d.getUTCMonth()]}`;
}

function parMotsCles(phrase: string, acts: Activite[]) {
  const p = ` ${phrase.toLowerCase()} `;
  return acts.find((a) => (a.mots_cles ?? []).some((m) => m && p.includes(m.toLowerCase())))?.id ?? "perso";
}

async function comprendre(phrase: string, acts: Activite[], aujourdhui: string): Promise<Tache> {
  const [{ data: clients }, { data: recentes }] = await Promise.all([
    db.from("clients").select("nom, activite_id").limit(400),
    db.from("taches").select("titre, activite_id").order("cree_le", { ascending: false }).limit(80),
  ]);
  const calendrier = Array.from({ length: 21 }, (_, i) => { const j = plus(aujourdhui, i); return `${JOURS[enDate(j).getUTCDay()]} ${j}`; });
  const Sortie = z.object({
    titre: z.string(), activite: z.enum(acts.map((a) => a.id) as [string, ...string[]]),
    echeance: z.string(), priorite: z.enum(["haute", "moyenne", "basse"]),
  });
  const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
  const r = await client.messages.parse({
    model: "claude-haiku-5-5",
    max_tokens: 1000,
    output_config: { effort: "low", format: zodOutputFormat(Sortie) },
    system: `Tu es Victor, l'assistant d'Antonin Rouzier. Antonin te dicte une tâche depuis son téléphone ; tu la ranges dans son cockpit. Français, sans émoticônes.

- titre : la tâche, courte, à l'infinitif et commençant par une majuscule, sans la date ni les mots « tâche », « rappelle-moi » ou « pour Victor ». Garde les noms propres tels quels (corrige seulement une faute de dictée évidente).
- activite : le projet concerné, d'après les noms de clients, les mots-clés et les tâches récentes ci-dessous ; « perso » si rien ne correspond.
- echeance : AAAA-MM-JJ si un jour est dit (« vendredi » = le prochain vendredi à venir, aujourd'hui exclu ; « demain » ; « fin de semaine » = vendredi ; « la semaine prochaine » = lundi prochain ; « avant le 15 » = le 15), sinon chaîne vide.
- priorite : « haute » si c'est dit urgent ou important, « basse » si c'est dit sans urgence ou « quand j'ai le temps », sinon « moyenne ».

Aujourd'hui : ${JOURS[enDate(aujourdhui).getUTCDay()]} ${aujourdhui} (Europe/Paris). Jours à venir : ${calendrier.join(", ")}.

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
  const echeance = /^\d{4}-\d{2}-\d{2}$/.test(o.echeance) && o.echeance >= aujourdhui && o.echeance <= plus(aujourdhui, 730) ? o.echeance : null;
  return { titre: o.titre.trim() || phrase, activite_id: o.activite, echeance, priorite: o.priorite };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return texte("Envoyer la tâche en POST.", 405);
  if (!egal(CLE_TACHE, req.headers.get("x-cle-tache") ?? "")) return texte("Clé refusée : vérifier l'en-tête x-cle-tache du raccourci.", 401);

  const brut = await req.text();
  let corps: { texte?: string; essai?: boolean } = {};
  try { corps = JSON.parse(brut); } catch { corps = { texte: brut }; }
  if (typeof corps !== "object" || corps === null) corps = { texte: String(corps) };
  const phrase = String(corps.texte ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  if (!phrase) return texte("Rien à ajouter : la phrase est vide.", 400);

  const aujourdhui = jourParis();
  const { data: acts, error } = await db.from("activites").select("id, nom, description, mots_cles").order("ordre");
  if (error || !acts?.length) return texte("Cockpit injoignable, réessayer dans un instant.", 500);

  let t: Tache, secours = false;
  try {
    if (!Deno.env.get("ANTHROPIC_API_KEY")) throw new Error("clé ANTHROPIC_API_KEY absente");
    t = await comprendre(phrase, acts as Activite[], aujourdhui);
  } catch (e) {
    console.error("ajouter-tache : Claude indisponible,", e instanceof Error ? e.message : e);
    secours = true;
    t = { titre: phrase.charAt(0).toUpperCase() + phrase.slice(1), activite_id: parMotsCles(phrase, acts as Activite[]), echeance: null, priorite: "moyenne" };
  }
  t.titre = t.titre.slice(0, 200);
  const nom = COURTS[t.activite_id] ?? acts.find((a) => a.id === t.activite_id)?.nom ?? t.activite_id;
  const resume = [t.titre, nom, t.echeance ? dire(t.echeance, aujourdhui) : null, t.priorite === "moyenne" ? null : `priorité ${t.priorite}`]
    .filter(Boolean).join(" · ");

  if (corps.essai) return texte(`Essai (rien d'écrit) : ${resume}${secours ? " (sans Claude)" : ""}`);
  const notes = "Dictée depuis l'iPhone" + (phrase.toLowerCase() !== t.titre.toLowerCase() ? ` : « ${phrase} »` : "");
  const { error: e2 } = await db.from("taches").insert({ ...t, notes, statut: "a-faire" });
  if (e2) { console.error("ajouter-tache :", e2.message); return texte("La tâche n'a pas pu être enregistrée, réessayer.", 500); }
  return texte(`Ajoutée : ${resume}${secours ? " (projet deviné sans Claude, à vérifier)" : ""}`, 201);
});
