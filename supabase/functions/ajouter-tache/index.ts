// Tâches et rendez-vous dictés depuis l'iPhone (Raccourci iOS « Tâche pour Victor », lancé par les Raccourcis vocaux) : une phrase libre crée, modifie, supprime
// ou termine une tâche, ou un rendez-vous dans le bon agenda. Claude Haiku 5.5 en tire l'action, la cible, le titre, le projet,
// la date, l'heure, la durée, le lieu et la priorité ; sans lui, une tâche est créée d'après les mots-clés des projets.
// Rendez-vous (une heure est dite, ou « toute la journée ») : écrit par agenda-ecrire dans l'agenda du projet
// (Palomano : Outlook avec lien Teams ; Harnes, Camp : leurs agendas Google ; Perso, Berkay, Wealthy : agenda Google principal).
// Evoa : son agenda Outlook une fois connecté (page Agendas), sinon une tâche « À caler ». Un chevauchement est signalé, pas bloqué.
// Modifier, supprimer, terminer : seulement si UNE seule tâche ouverte (ou un seul rendez-vous à venir d'un agenda modifiable) correspond ;
// sinon rien n'est touché et la réponse demande de préciser. « Annule la dernière » défait le dernier ajout dicté (12 h).
// Chaque dictée est notée dans `dictees`. Une invitation reçue (organisateur autre qu'Antonin, vérifié chez Google ou Outlook) n'est jamais touchée.
// Protégée par une clé personnelle dédiée (secret CLE_TACHE, posée par outils/cle-tache.sh), passée dans l'en-tête x-cle-tache.
//  POST { texte: "Relancer Toynamics pour le solde créditeur vendredi" }   (ou le texte brut en corps)
//  -> 201, texte court : « Ajoutée : Relancer Toynamics pour le solde créditeur · Palomano · demain, vendredi 6 »
//  POST { texte, essai: true } -> renvoie ce qui serait fait, sans rien écrire
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import Anthropic from "npm:@anthropic-ai/sdk@1.4.0";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk@1.4.0/helpers/zod";
import { z } from "npm:zod@4.6.7";
import { jetonAcces, organisateurAutre, type Compte } from "../_partage/fournisseurs.ts";
import { deposerBrouillon, dernierMail, rediger } from "../_partage/reponses.ts";

const CLE_TACHE = Deno.env.get("CLE_TACHE") ?? "";
const URL_PROJET = Deno.env.get("SUPABASE_URL")!;
const db = createClient(URL_PROJET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const texte = (corps: string, status = 200) => new Response(corps, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
const message = (e: unknown) => e instanceof Error ? e.message : String(e);
const COURTS: Record<string, string> = { "evoa-courtage": "Evoa", "camp-rouzier-marechal": "Camp", "wealthy": "Wealthy", "harnes-volley": "Harnes" };
const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const AVEC_TEAMS = new Set(["palomano"]); // projets dont les rendez-vous Outlook reçoivent un lien Teams
const SANS_REPLI = new Set(["evoa-courtage"]); // sans agenda propre connecté, le rendez-vous devient une tâche (jamais l'agenda perso)
const CHAMPS = ["date", "heure", "duree", "lieu", "priorite", "activite", "titre"] as const;

type Activite = { id: string; nom: string; description: string | null; mots_cles: string[] | null };
type Action = "creer" | "annuler" | "modifier" | "supprimer" | "terminer" | "repondre";
const SITE = "https://ar-conseil.github.io/cockpit/";
const BOITE_DU_PROJET: Record<string, string> = { palomano: "lille@palomano.com", "camp-rouzier-marechal": "camprouziermarechal@gmail.com" };
type Comprise = {
  action: Action; cibles: string[]; champs: string[]; canal: "mail" | "sms" | "whatsapp" | ""; correspondant: string; consigne: string;
  type: "tache" | "rdv"; titre: string; activite_id: string; date: string | null; heure: string | null; heure_fin: string | null;
  duree: number | null; journee: boolean; lieu: string | null; priorite: "haute" | "moyenne" | "basse";
};
type TacheOuverte = { id: string; titre: string; activite_id: string; echeance: string | null; priorite: string };
type RdvDicte = { dictee: string | null; id: string; titre: string; debut: string; fin: string; journee: boolean; lieu: string | null; agenda: string; agenda_id?: string };

function egal(a: string, b: string) { // comparaison à temps constant
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// ---------- Dates (Europe/Paris) ----------
const jourParis = (d = new Date()) => new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris" }).format(d); // AAAA-MM-JJ
const hhmmParis = (d: Date) => new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }).format(d); // HH:MM
const enDate = (iso: string) => new Date(iso + "T12:00:00Z");
const plus = (iso: string, n: number) => new Date(enDate(iso).getTime() + n * 864e5).toISOString().slice(0, 10);
function parisEnUtc(date: string, hhmm: string): Date { // « 2026-11-12 », « 14:30 » (heure de Paris) -> instant UTC
  const brut = Date.parse(`${date}T${hhmm}:00Z`);
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(brut));
  const v = (k: string) => Number(p.find((x) => x.type === k)!.value);
  return new Date(brut - (Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute")) - brut));
}
const heureParis = (d: Date) => { const [h, m] = hhmmParis(d).split(":"); return `${Number(h)} h${m === "00" ? "" : " " + m}`; };
function dire(echeance: string, aujourdhui: string) {
  const d = enDate(echeance), ecart = Math.round((d.getTime() - enDate(aujourdhui).getTime()) / 864e5);
  const jour = `${JOURS[d.getUTCDay()]} ${d.getUTCDate()}`;
  if (ecart === 0) return `aujourd'hui, ${jour}`;
  if (ecart === 1) return `demain, ${jour}`;
  return ecart > 0 && ecart < 7 ? jour : `${jour} ${MOIS[d.getUTCMonth()]}`;
}
const direRdv = (r: { debut: string; fin: string; journee: boolean }, aujourdhui: string) =>
  `${dire(jourParis(new Date(r.debut)), aujourdhui)}${r.journee ? ", toute la journée" : `, ${heureParis(new Date(r.debut))} – ${heureParis(new Date(r.fin))}`}`;

function parMotsCles(phrase: string, acts: Activite[]) {
  const p = ` ${phrase.toLowerCase()} `;
  return acts.find((a) => (a.mots_cles ?? []).some((m) => m && p.includes(m.toLowerCase())))?.id ?? "perso";
}

// ---------- Ce qui existe déjà (cibles possibles) ----------
async function tachesOuvertes(): Promise<TacheOuverte[]> {
  const { data } = await db.from("taches").select("id, titre, activite_id, echeance, priorite").neq("statut", "fait")
    .order("cree_le", { ascending: false }).limit(250);
  return (data ?? []) as TacheOuverte[];
}
async function rdvDictes(): Promise<RdvDicte[]> { // rendez-vous à venir créés par dictée et toujours présents
  const { data } = await db.from("dictees").select("id, evenement_id, agenda_id, evenement_externe, evenements(id, titre, debut, fin, journee, lieu), agendas(nom)")
    .eq("action", "creer").eq("annulee", false).not("agenda_id", "is", null).order("cree_le", { ascending: false }).limit(100);
  const sortie: RdvDicte[] = [];
  // deno-lint-ignore no-explicit-any
  for (const d of (data ?? []) as any[]) {
    let e = d.evenements;
    if (!e && d.evenement_externe) { // la ligne a été remplacée (synchro) : on la retrouve par son identifiant distant
      const { data: x } = await db.from("evenements").select("id, titre, debut, fin, journee, lieu").eq("agenda_id", d.agenda_id).eq("externe_id", d.evenement_externe).maybeSingle();
      e = x;
      if (e) await db.from("dictees").update({ evenement_id: e.id }).eq("id", d.id);
    }
    if (e && Date.parse(e.fin) > Date.now() - 864e5) sortie.push({ dictee: d.id, ...e, agenda: d.agendas?.nom ?? "" });
  }
  return sortie;
}

// Cibles possibles : les rendez-vous dictés, puis tous les rendez-vous à venir (45 jours) des agendas que le cockpit peut écrire.
// Une invitation reçue est écartée au moment d'agir (organisateurAutre), pas ici : la synchro ne connaît pas l'organisateur.
async function rdvCibles(): Promise<RdvDicte[]> {
  const dictes = await rdvDictes();
  const { data } = await db.from("evenements").select("id, titre, debut, fin, journee, lieu, agenda_id, agendas!inner(nom, ecriture, actif)")
    .eq("modifiable", true).eq("annule", false).eq("agendas.ecriture", true).eq("agendas.actif", true)
    .gt("fin", new Date(Date.now() - 864e5).toISOString()).lt("debut", new Date(Date.now() + 45 * 864e5).toISOString())
    .order("debut").limit(250);
  const vus = new Set(dictes.map((e) => e.id)), cles = new Set(dictes.map((e) => `${e.titre}|${e.debut}`));
  const autres: RdvDicte[] = [];
  // deno-lint-ignore no-explicit-any
  for (const e of (data ?? []) as any[]) {
    const cle = `${e.titre}|${e.debut}`; // un même rendez-vous copié dans deux agendas : une seule entrée
    if (vus.has(e.id) || cles.has(cle) || !e.titre) continue;
    cles.add(cle);
    autres.push({ dictee: null, id: e.id, titre: e.titre, debut: e.debut, fin: e.fin, journee: e.journee, lieu: e.lieu, agenda: e.agendas?.nom ?? "", agenda_id: e.agenda_id });
  }
  return [...dictes, ...autres];
}

// Nom de l'organisateur si le rendez-vous est une invitation reçue (on n'y touche pas), sinon null.
async function invitation(r: RdvDicte): Promise<string | null> {
  if (r.dictee) return null; // créé par dictée : Antonin en est l'organisateur
  const { data: e } = await db.from("evenements").select("externe_id, agendas!inner(externe_id, comptes_agenda!inner(*))").eq("id", r.id).single();
  // deno-lint-ignore no-explicit-any
  const ag = (e as any)?.agendas, compte = ag?.comptes_agenda as Compte | undefined;
  if (!e?.externe_id || !ag?.externe_id || !compte) return "inconnu";
  return await organisateurAutre(compte, await jetonAcces(db, compte), ag.externe_id, e.externe_id);
}

// ---------- Compréhension par Claude ----------
async function comprendre(phrase: string, acts: Activite[], aujourdhui: string, taches: TacheOuverte[], rdvs: RdvDicte[]): Promise<Comprise> {
  const [{ data: clients }] = await Promise.all([db.from("clients").select("nom, activite_id").limit(400)]);
  const calendrier = Array.from({ length: 21 }, (_, i) => { const j = plus(aujourdhui, i); return `${JOURS[enDate(j).getUTCDay()]} ${j}`; });
  const Sortie = z.object({
    action: z.enum(["creer", "annuler", "modifier", "supprimer", "terminer", "repondre"]),
    canal: z.enum(["mail", "sms", "whatsapp", ""]), correspondant: z.string(), consigne: z.string(),
    cibles: z.array(z.string()), champs: z.array(z.enum(CHAMPS)),
    type: z.enum(["tache", "rdv"]), titre: z.string(), activite: z.enum([...acts.map((a) => a.id), ""] as [string, ...string[]]),
    date: z.string(), heure: z.string(), heure_fin: z.string(), duree_minutes: z.number().int(), journee: z.boolean(),
    lieu: z.string(), priorite: z.enum(["haute", "moyenne", "basse", ""]),
  });
  const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });
  const r = await client.messages.parse({
    model: "claude-haiku-5-5",
    max_tokens: 1500,
    output_config: { effort: "low", format: zodOutputFormat(Sortie) },
    system: `Tu es Victor, l'assistant d'Antonin Rouzier. Antonin te dicte depuis son téléphone une tâche ou un rendez-vous à ajouter, ou un changement sur ce qui existe ; tu le ranges dans son cockpit. Français, sans émoticônes.

- action :
  « creer » pour ajouter quelque chose (cas par défaut) ;
  « annuler » pour défaire le dernier ajout (« annule », « annule la dernière », « supprime ce que je viens de dire », « c'était une erreur ») ;
  « modifier » pour changer une tâche ou un rendez-vous existant (« décale Toynamics à lundi », « le rendez-vous Monteil passe à 15 h », « mets Excom en priorité haute », « range la tâche Monteil dans Wealthy », « renomme… ») ;
  « supprimer » pour effacer une tâche ou un rendez-vous existant (« supprime la tâche Toynamics », « annule le rendez-vous avec Julien ») ;
  « terminer » pour une tâche faite (« Toynamics, c'est fait », « j'ai appelé Édouard ») ;
  « repondre » pour écrire à quelqu'un : répondre à un mail (« réponds à Toynamics que… », « réponds au mail de Julien… ») ou envoyer un SMS ou un WhatsApp (« envoie un SMS à Lili pour lui dire… », « WhatsApp à Zac : … »).
- canal (repondre) : « mail » pour une réponse à un mail (par défaut quand il dit « réponds à »), « sms » pour un SMS ou un texto, « whatsapp » pour WhatsApp ; sinon chaîne vide.
- correspondant (repondre) : pour un mail, le mot le plus sûr pour retrouver l'expéditeur dans la boîte (nom de la société ou nom de famille, ou son adresse si elle est dite : « Toynamics », « Monteil ») ; pour un SMS ou WhatsApp, le nom de la personne tel qu'il est dit. Sinon chaîne vide.
- consigne (repondre) : ce qu'Antonin veut dire, reformulé fidèlement, sans rien ajouter. Sinon chaîne vide.
- Pour repondre, activite est le projet du correspondant si on le devine (sinon « perso »).
- cibles (modifier, supprimer, terminer) : les identifiants (t… ou r…) des tâches ouvertes et rendez-vous de la liste ci-dessous qu'Antonin désigne. Si sa description en désigne clairement un seul (« la relance Dupont » = « Relancer Dupont pour le devis », pas « Appeler Dupont »), mets seulement celui-là ; s'il reste plusieurs candidats aussi plausibles, mets-les tous (ne choisis jamais au hasard) ; liste vide si aucun. Pour creer et annuler : liste vide.
- champs (modifier) : les éléments à changer, parmi date, heure, duree, lieu, priorite, activite, titre ; les nouvelles valeurs vont dans les champs ci-dessous. Pour les autres actions : liste vide.
- type : « rdv » si une heure précise est dite (« à 14 h », « de 9 h à 10 h », « 14 h 30 ») ou si c'est un événement sur toute la journée (« toute la journée », « salon mardi ») ; sinon « tache ». « Appeler X demain » est une tâche ; « Appeler X demain à 10 h » est un rendez-vous.
- titre : court, sans la date, l'heure, la durée ni le lieu, et sans les mots « tâche », « rappelle-moi », « Victor ». Tâche : à l'infinitif, majuscule au début (« Relancer Toynamics pour le solde créditeur »). Rendez-vous : comme dans un agenda (« Point Excom avec Julien », « Déjeuner avec A. Monteil »). Garde les noms propres tels quels (corrige seulement une faute de dictée évidente). Pour modifier : le nouveau titre seulement si « titre » est dans champs, sinon chaîne vide.
- activite : le projet concerné, d'après les noms de clients, les mots-clés et les tâches ouvertes ci-dessous ; « perso » si rien ne correspond. Pour modifier : le nouveau projet si « activite » est dans champs, sinon chaîne vide.
- date : AAAA-MM-JJ si un jour est dit (« vendredi » = le prochain vendredi à venir, aujourd'hui exclu ; « demain » ; « fin de semaine » = vendredi ; « la semaine prochaine » = lundi prochain ; « avant le 15 » = le 15), sinon chaîne vide. Un rendez-vous à créer avec une heure mais sans jour : aujourd'hui si l'heure n'est pas passée, sinon demain.
- heure : HH:MM (24 h) du début d'un rendez-vous (« 14 h » = 14:00, « 9 h et demie » = 09:30), sinon chaîne vide. heure_fin : HH:MM si une heure de fin est dite, sinon chaîne vide.
- duree_minutes : durée dite (« pendant 2 h » = 120, « une demi-heure » = 30), sinon 0.
- journee : true seulement pour un rendez-vous sur toute la journée sans heure.
- lieu : le lieu dit (« au bureau », « à la Maillerie »), sans la préposition, sinon chaîne vide.
- priorite : « haute » si c'est dit urgent ou important, « basse » si c'est dit sans urgence ou « quand j'ai le temps », sinon « moyenne ». Pour modifier sans changer la priorité : chaîne vide.

Maintenant : ${JOURS[enDate(aujourdhui).getUTCDay()]} ${aujourdhui}, ${heureParis(new Date())} (Europe/Paris). Jours à venir : ${calendrier.join(", ")}.

Projets :
${acts.map((a) => `- ${a.id} (${a.nom}) : ${a.description ?? ""}${a.mots_cles?.length ? ` Mots-clés : ${a.mots_cles.join(", ")}.` : ""}`).join("\n")}

Clients par projet :
${acts.map((a) => `- ${a.id} : ${(clients ?? []).filter((c) => c.activite_id === a.id).map((c) => c.nom).join(", ") || "-"}`).join("\n")}

Tâches ouvertes (identifiant : [projet] titre, échéance) :
${taches.map((t, i) => `- t${i + 1} : [${t.activite_id}] ${t.titre}${t.echeance ? `, ${t.echeance}` : ""}`).join("\n") || "-"}

Rendez-vous à venir (identifiant : titre, quand, agenda) :
${rdvs.map((e, i) => `- r${i + 1} : ${e.titre}, ${direRdv(e, aujourdhui)}${e.lieu ? `, ${e.lieu}` : ""}, ${e.agenda}`).join("\n") || "-"}`,
    messages: [{ role: "user", content: phrase }],
  });
  const o = r.parsed_output;
  if (!o) throw new Error(`réponse illisible (${r.stop_reason})`);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(o.date) && o.date >= aujourdhui && o.date <= plus(aujourdhui, 730) ? o.date : null;
  const hh = (h: string) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(h) ? h : null);
  return { action: o.action, cibles: [...new Set(o.cibles)], champs: o.champs, canal: o.canal, correspondant: o.correspondant.trim(), consigne: o.consigne.trim(),
    type: o.type, titre: o.titre.trim(), activite_id: o.activite || parMotsCles(phrase, acts), date, heure: hh(o.heure), heure_fin: hh(o.heure_fin),
    duree: o.duree_minutes > 0 && o.duree_minutes <= 24 * 60 ? o.duree_minutes : null, journee: o.journee,
    lieu: o.lieu.trim() || null, priorite: o.priorite || "moyenne" };
}

// ---------- Agendas ----------
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

async function chevauchement(debut: Date, fin: Date, sauf?: string) {
  const { data } = await db.from("evenements").select("id, titre, debut, fin").eq("annule", false).eq("journee", false)
    .lt("debut", fin.toISOString()).gt("fin", debut.toISOString()).order("debut").limit(20);
  // les séjours sur plusieurs jours (week-end, déplacement) ne comptent pas comme un chevauchement
  return (data ?? []).find((e) => e.id !== sauf && Date.parse(e.fin) - Date.parse(e.debut) < 12 * 3600e3)?.titre ?? null;
}

// deno-lint-ignore no-explicit-any
async function agendaEcrire(corps: Record<string, unknown>): Promise<any> {
  const r = await fetch(`${URL_PROJET}/functions/v1/agenda-ecrire`, {
    method: "POST", headers: { "x-cle-synchro": Deno.env.get("CLE_SYNCHRO") ?? "", "Content-Type": "application/json" },
    body: JSON.stringify(corps) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erreur ?? `HTTP ${r.status}`);
  return j;
}

// ---------- Réponses (mail, SMS, WhatsApp) : préparées par Victor, jamais envoyées sans Antonin ----------
const extrait = (t: string, n = 160) => { const u = t.replace(/\s+/g, " ").trim(); return u.length > n ? u.slice(0, n - 1) + "…" : u; };
async function repondre(c: Comprise, x: Contexte): Promise<Reponse> {
  const pre = x.essai ? "Essai (rien d'écrit) : " : "";
  if (!c.correspondant || !c.consigne) return { texte: "Je n'ai pas compris à qui répondre ni quoi dire : rien de préparé. Exemple : « Réponds à Toynamics que je passe vendredi »." };
  if (c.canal === "sms" || c.canal === "whatsapp") {
    const t = await rediger(c.canal, c.consigne, c.correspondant);
    const nom = c.canal === "sms" ? "SMS" : "WhatsApp";
    if (!x.essai) await db.from("reponses").insert({ canal: c.canal, consigne: x.phrase, destinataire: c.correspondant, texte: t, statut: "ouvert" });
    return { texte: `${pre}${nom} pour ${c.correspondant} : « ${t} ». Choisis ${c.correspondant} puis envoie.`,
      ouvrir: c.canal === "sms" ? `sms:&body=${encodeURIComponent(t)}` : `https://wa.me/?text=${encodeURIComponent(t)}` };
  }
  const m = await dernierMail(db, c.correspondant, BOITE_DU_PROJET[c.activite_id]);
  if (!m) return { texte: `Je n'ai trouvé aucun mail reçu de « ${c.correspondant} » ces 6 derniers mois : rien de préparé.` };
  const t = await rediger("mail", c.consigne, m.de, m);
  const quand = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long" }).format(new Date(m.recu_le));
  const resume = `Réponse à ${m.de.replace(/\s*<.*>/, "") || m.de} (« ${extrait(m.objet, 60)} », reçu le ${quand}, boîte ${m.compte.email}) : « ${extrait(t, 220)} »`;
  if (x.essai) return { texte: `${pre}${resume}` };
  const b = await deposerBrouillon(db, m, t);
  const { data } = await db.from("reponses").insert({ canal: "mail", consigne: x.phrase, destinataire: b.destinataire, boite: m.compte.email,
    fournisseur: m.compte.fournisseur, objet: b.objet, texte: t, original_de: m.de, original_objet: m.objet, original_extrait: extrait(m.texte, 600),
    original_recu_le: m.recu_le, mail_id: m.id, fil_id: m.fil, brouillon_id: b.brouillon_id }).select("id").single();
  return { texte: `Brouillon prêt, rien n'est parti. ${resume}. À valider dans le cockpit.`, status: 201, ouvrir: `${SITE}#reponses${data ? "/" + data.id : ""}` };
}

// ---------- Actions ----------
type Contexte = { phrase: string; aujourdhui: string; essai: boolean; nomProjet: (id: string) => string };
type Reponse = { texte: string; status?: number; journal?: Record<string, unknown>; ouvrir?: string };

async function creer(c: Comprise, x: Contexte): Promise<Reponse> {
  const titre = (c.titre || x.phrase).slice(0, 200);
  const nom = x.nomProjet(c.activite_id);
  const pre = x.essai ? "Essai (rien d'écrit) : " : "";
  let titreTache = titre;
  if (c.type === "rdv" && c.date && (c.heure || c.journee)) {
    const debut = parisEnUtc(c.date, c.heure ?? "00:00");
    let fin = c.heure ? (c.heure_fin ? parisEnUtc(c.date, c.heure_fin) : new Date(debut.getTime() + (c.duree ?? 60) * 60000)) : parisEnUtc(plus(c.date, 1), "00:00");
    if (fin <= debut) fin = new Date(debut.getTime() + 60 * 60000);
    const quand = direRdv({ debut: debut.toISOString(), fin: fin.toISOString(), journee: !c.heure }, x.aujourdhui);
    const agenda = await agendaPour(c.activite_id);
    if (agenda) {
      const teams = agenda.fournisseur === "microsoft" && AVEC_TEAMS.has(c.activite_id) && !!c.heure;
      const conflit = c.heure ? await chevauchement(debut, fin) : null;
      const rdv = { action: "creer", agenda_id: agenda.id, titre, debut: debut.toISOString(), fin: fin.toISOString(), journee: !c.heure, lieu: c.lieu,
        ...(agenda.activite_id !== c.activite_id ? { activite_forcee: c.activite_id } : {}) };
      let sansTeams = false, ev = null;
      if (!x.essai) {
        try { ev = (await agendaEcrire({ ...rdv, teams })).evenement; }
        catch (e) {
          if (!teams) { console.error("ajouter-tache : rendez-vous", message(e)); return { texte: `Le rendez-vous n'a pas pu être créé dans ${agenda.nom}, réessayer.`, status: 502 }; }
          try { ev = (await agendaEcrire(rdv)).evenement; sansTeams = true; } // Teams refusé par le compte : rendez-vous créé sans lien
          catch (e2) { console.error("ajouter-tache : rendez-vous", message(e2)); return { texte: `Le rendez-vous n'a pas pu être créé dans ${agenda.nom}, réessayer.`, status: 502 }; }
        }
      }
      const ou = `${nom} (${agenda.fournisseur === "microsoft" ? "Outlook" : "agenda " + agenda.nom}${teams ? (sansTeams ? ", sans lien Teams" : ", lien Teams") : ""})`;
      return { texte: `${pre || "Rendez-vous ajouté : "}${[titre, ou, quand, c.lieu].filter(Boolean).join(" · ")}${conflit ? `. Attention : chevauche « ${conflit} »` : ""}`,
        status: 201, journal: { agenda_id: agenda.id, evenement_id: ev?.id ?? null, evenement_externe: ev?.externe_id ?? null, evenement_titre: titre } };
    }
    // Pas d'agenda modifiable pour ce projet (Evoa, tant que son Outlook n'est pas connecté) : une tâche « À caler » à la date dite
    titreTache = `À caler : ${titre} (${c.heure ? quand.split(", ").pop() : "journée"}${c.lieu ? `, ${c.lieu}` : ""})`.slice(0, 200);
  }
  const resume = [titreTache, nom, c.date ? dire(c.date, x.aujourdhui) : null, c.priorite === "moyenne" ? null : `priorité ${c.priorite}`].filter(Boolean).join(" · ");
  if (x.essai) return { texte: `${pre}tâche ${resume}` };
  const notes = "Dictée depuis l'iPhone" + (x.phrase.toLowerCase() !== titreTache.toLowerCase() ? ` : « ${x.phrase} »` : "");
  const { data, error } = await db.from("taches").insert({ titre: titreTache, activite_id: c.activite_id, echeance: c.date, priorite: c.priorite, notes, statut: "a-faire" }).select("id").single();
  if (error) { console.error("ajouter-tache :", error.message); return { texte: "La tâche n'a pas pu être enregistrée, réessayer.", status: 500 }; }
  return { texte: `Ajoutée : ${resume}`, status: 201, journal: { tache_id: data.id } };
}

async function annuler(x: Contexte): Promise<Reponse> {
  const { data: d } = await db.from("dictees").select("id, tache_id, evenement_id, agenda_id, evenement_externe, evenement_titre, taches(titre)")
    .eq("action", "creer").eq("annulee", false).gt("cree_le", new Date(Date.now() - 12 * 3600e3).toISOString())
    .order("cree_le", { ascending: false }).limit(1).maybeSingle();
  // deno-lint-ignore no-explicit-any
  const der = d as any;
  if (!der || (!der.tache_id && !der.agenda_id)) return { texte: "Rien à annuler : aucun ajout dicté ces 12 dernières heures." };
  const pre = x.essai ? "Essai (rien d'écrit) : " : "";
  if (der.tache_id) {
    const titre = der.taches?.titre ?? "la tâche";
    if (!x.essai) { await db.from("taches").delete().eq("id", der.tache_id); await db.from("dictees").update({ annulee: true }).eq("id", der.id); }
    return { texte: `${pre}Annulée : ${titre} (tâche supprimée)` };
  }
  const rdv = (await rdvDictes()).find((e) => e.dictee === der.id);
  if (!rdv) return { texte: `Rien à annuler : le rendez-vous « ${der.evenement_titre ?? ""} » n'est plus dans l'agenda.` };
  if (!x.essai) { await agendaEcrire({ action: "supprimer", evenement_id: rdv.id }); await db.from("dictees").update({ annulee: true }).eq("id", der.id); }
  return { texte: `${pre}Annulé : ${rdv.titre} · ${direRdv(rdv, x.aujourdhui)} (rendez-vous supprimé de ${rdv.agenda})` };
}

async function agirSurCible(c: Comprise, x: Contexte, taches: TacheOuverte[], rdvs: RdvDicte[]): Promise<Reponse> {
  const pre = x.essai ? "Essai (rien d'écrit) : " : "";
  const trouvees = c.cibles.map((id) => id.startsWith("t") ? { t: taches[Number(id.slice(1)) - 1] } : { r: rdvs[Number(id.slice(1)) - 1] })
    .filter((o) => o.t || o.r);
  const verbe = { modifier: "modifier", supprimer: "supprimer", terminer: "terminer" }[c.action as "modifier"];
  if (!trouvees.length) return { texte: `Je n'ai trouvé aucune tâche ouverte ni rendez-vous à venir qui corresponde : rien de changé.` };
  if (trouvees.length > 1) {
    const noms = trouvees.slice(0, 3).map((o) => o.t ? o.t.titre : o.r!.titre).join(" ; ");
    return { texte: `J'ai trouvé ${trouvees.length} correspondances (${noms}${trouvees.length > 3 ? " ; …" : ""}) : préciser. Rien de changé.` };
  }
  const { t, r } = trouvees[0];

  if (t) {
    const desc = `${t.titre} · ${x.nomProjet(t.activite_id)}`;
    if (c.action === "supprimer") {
      if (!x.essai) await db.from("taches").delete().eq("id", t.id);
      return { texte: `${pre}Supprimée : ${desc}` };
    }
    if (c.action === "terminer") {
      if (!x.essai) await db.from("taches").update({ statut: "fait", fait_le: new Date().toISOString() }).eq("id", t.id);
      return { texte: `${pre}Terminée : ${desc}`, journal: { tache_id: t.id } };
    }
    const maj: Record<string, unknown> = {}, dit: string[] = [];
    if (c.champs.includes("date") && c.date) { maj.echeance = c.date; dit.push(`échéance ${dire(c.date, x.aujourdhui)}${t.echeance ? ` (était ${dire(t.echeance, x.aujourdhui)})` : ""}`); }
    if (c.champs.includes("priorite")) { maj.priorite = c.priorite; dit.push(`priorité ${c.priorite}`); }
    if (c.champs.includes("activite") && c.activite_id !== t.activite_id) { maj.activite_id = c.activite_id; dit.push(`projet ${x.nomProjet(c.activite_id)}`); }
    if (c.champs.includes("titre") && c.titre) { maj.titre = c.titre.slice(0, 200); dit.push(`nouveau titre « ${maj.titre} »`); }
    if (!dit.length) return { texte: `Je n'ai pas compris quoi changer sur « ${t.titre} » : rien de changé. (Une tâche n'a pas d'heure : pour un créneau, dicter un rendez-vous.)` };
    if (!x.essai) await db.from("taches").update(maj).eq("id", t.id);
    return { texte: `${pre}Modifiée : ${desc} → ${dit.join(", ")}`, journal: { tache_id: t.id } };
  }

  // Rendez-vous : jamais une invitation reçue
  const desc = `${r!.titre} · ${direRdv(r!, x.aujourdhui)}`;
  if (c.action === "terminer") return { texte: `« ${r!.titre} » est un rendez-vous, pas une tâche : rien de changé.` };
  const orga = await invitation(r!);
  if (orga) return { texte: `« ${r!.titre} » (${direRdv(r!, x.aujourdhui)}) est ${orga === "inconnu" ? "un rendez-vous dont je ne peux pas vérifier l'organisateur" : `une invitation de ${orga}`} : je n'y touche pas, à changer depuis l'agenda.` };
  if (c.action === "supprimer") {
    if (!x.essai) { await agendaEcrire({ action: "supprimer", evenement_id: r!.id }); if (r!.dictee) await db.from("dictees").update({ annulee: true }).eq("id", r!.dictee); }
    return { texte: `${pre}Rendez-vous supprimé : ${desc} (${r!.agenda})` };
  }
  const ancienDebut = new Date(r!.debut), ancienneFin = new Date(r!.fin);
  const jour = c.champs.includes("date") && c.date ? c.date : jourParis(ancienDebut);
  const heure = c.champs.includes("heure") && c.heure ? c.heure : (r!.journee ? null : hhmmParis(ancienDebut));
  const journee = !heure;
  const debut = parisEnUtc(jour, heure ?? "00:00");
  let fin: Date;
  if (journee) fin = parisEnUtc(plus(jour, Math.max(1, Math.round((ancienneFin.getTime() - ancienDebut.getTime()) / 864e5))), "00:00");
  else if (c.heure_fin && c.champs.includes("heure")) fin = parisEnUtc(jour, c.heure_fin);
  else if (c.champs.includes("duree") && c.duree) fin = new Date(debut.getTime() + c.duree * 60000);
  else fin = new Date(debut.getTime() + (r!.journee ? 3600e3 : ancienneFin.getTime() - ancienDebut.getTime()));
  if (fin <= debut) fin = new Date(debut.getTime() + 3600e3);
  const titre = c.champs.includes("titre") && c.titre ? c.titre.slice(0, 200) : r!.titre;
  const lieu = c.champs.includes("lieu") ? c.lieu : r!.lieu;
  const change = debut.getTime() !== ancienDebut.getTime() || fin.getTime() !== ancienneFin.getTime() || titre !== r!.titre || lieu !== r!.lieu;
  if (!change) return { texte: `Je n'ai pas compris quoi changer sur « ${r!.titre} » : rien de changé.` };
  const conflit = journee ? null : await chevauchement(debut, fin, r!.id);
  let ev = null;
  if (!x.essai) {
    ev = (await agendaEcrire({ action: "modifier", evenement_id: r!.id, titre, debut: debut.toISOString(), fin: fin.toISOString(), journee, lieu })).evenement;
    if (ev && r!.dictee) await db.from("dictees").update({ evenement_id: ev.id, evenement_externe: ev.externe_id, evenement_titre: titre }).eq("id", r!.dictee);
  }
  const apres = [titre, direRdv({ debut: debut.toISOString(), fin: fin.toISOString(), journee }, x.aujourdhui), lieu].filter(Boolean).join(" · ");
  return { texte: `${pre}Rendez-vous modifié : ${apres} (était ${direRdv(r!, x.aujourdhui)})${conflit ? `. Attention : chevauche « ${conflit} »` : ""}` };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return texte("Envoyer la phrase en POST.", 405);
  const brut = await req.text();
  let corps: { texte?: string; essai?: boolean; format?: string } = {};
  try { corps = JSON.parse(brut); } catch { corps = { texte: brut }; }
  if (typeof corps !== "object" || corps === null) corps = { texte: String(corps) };
  // Raccourci à jour (champ format = json) : toujours { texte, ouvrir? }, même pour une erreur
  const enJson = corps.format === "json";
  const sortie = (t: string, status = 200, ouvrir?: string) => enJson
    ? new Response(JSON.stringify({ texte: t, ...(ouvrir ? { ouvrir } : {}) }), { status, headers: { "Content-Type": "application/json; charset=utf-8" } })
    : texte(t + (ouvrir && !ouvrir.startsWith(SITE) ? " (mettre à jour le raccourci pour l'ouvrir directement)" : ""), status);
  const cle = req.headers.get("x-cle-tache") ?? "";
  // CLE_TACHE_ESSAI : clé temporaire pour tester sans toucher à celle du téléphone (posée puis retirée par l'API d'administration)
  if (!egal(CLE_TACHE, cle) && !egal(Deno.env.get("CLE_TACHE_ESSAI") ?? "", cle)) return sortie("Clé refusée : vérifier l'en-tête x-cle-tache du raccourci.", 401);
  const phrase = String(corps.texte ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  if (!phrase) { // noté pour comprendre d'où vient le vide (champ absent, corps vide, dictée vide), sans contenu
    await db.from("dictees").insert({ phrase: "", action: "vide", resultat: `type=${req.headers.get("content-type") ?? "-"} octets=${brut.length} champs=${Object.keys(corps).join(",") || "-"} texte=${JSON.stringify(corps.texte ?? null).slice(0, 40)}` });
    return sortie("Je n'ai rien reçu (dictée vide) : rien d'ajouté. Recommencer, et laisser la dictée s'arrêter seule ou toucher « Terminé ».", 400);
  }
  // Un seul mot = dictée coupée trop tôt (la suite est partie vers Siri) : rien n'est fait (sauf « annule »)
  if (phrase.split(" ").length < 2 && !/^annule/i.test(phrase)) return sortie(`Je n'ai entendu que « ${phrase} » : rien d'ajouté. Recommencer en parlant sans pause.`, 422);

  const aujourdhui = jourParis();
  const { data: acts, error } = await db.from("activites").select("id, nom, description, mots_cles").order("ordre");
  if (error || !acts?.length) return sortie("Cockpit injoignable, réessayer dans un instant.", 500);
  const x: Contexte = { phrase, aujourdhui, essai: !!corps.essai,
    nomProjet: (id) => COURTS[id] ?? acts.find((a) => a.id === id)?.nom ?? id };

  let c: Comprise, secours = false, rep: Reponse, enReponse = false;
  try {
    if (!Deno.env.get("ANTHROPIC_API_KEY")) throw new Error("clé ANTHROPIC_API_KEY absente");
    const [taches, rdvs] = await Promise.all([tachesOuvertes(), rdvCibles()]);
    c = await comprendre(phrase, acts as Activite[], aujourdhui, taches, rdvs);
    rep = c.action === "creer" ? await creer(c, x) : c.action === "annuler" ? await annuler(x) : c.action === "repondre" ? (enReponse = true, await repondre(c, x))
      : await agirSurCible(c, x, taches, rdvs);
  } catch (e) {
    console.error("ajouter-tache :", message(e));
    if (enReponse) return sortie(`La réponse n'a pas pu être préparée, rien n'est parti : réessayer.${x.essai ? ` (${message(e)})` : ""}`, 502);
    if (!/claude|anthropic|réponse illisible|ANTHROPIC/i.test(message(e)) && !(e instanceof Anthropic.APIError)) {
      return sortie(`Ça n'a pas marché, réessayer dans un instant.${x.essai ? ` (${message(e)})` : ""}`, 500);
    }
    secours = true; // Claude indisponible : simple tâche d'après les mots-clés
    c = { action: "creer", cibles: [], champs: [], canal: "", correspondant: "", consigne: "", type: "tache", titre: phrase.charAt(0).toUpperCase() + phrase.slice(1),
      activite_id: parMotsCles(phrase, acts as Activite[]), date: null, heure: null, heure_fin: null, duree: null, journee: false, lieu: null, priorite: "moyenne" };
    rep = await creer(c, x);
    rep.texte += " (projet deviné sans Claude, à vérifier)";
  }
  if (!x.essai) {
    await db.from("dictees").insert({ phrase, action: c.action, resultat: rep.texte, ...(rep.journal ?? {}) });
    await db.from("dictees").delete().lt("cree_le", new Date(Date.now() - 60 * 864e5).toISOString());
  }
  if (secours) console.error("ajouter-tache : réponse de secours sans Claude");
  return sortie(rep.texte, rep.status ?? 200, rep.ouvrir); // « ouvrir » : page ou appli où valider et envoyer
});
