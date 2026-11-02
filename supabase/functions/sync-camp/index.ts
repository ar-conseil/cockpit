// Camp Rouzier Maréchal en direct (tous les quarts d'heure, par pg_cron) : lit les totaux du suivi des inscriptions
// sur le site du camp (camprouziermarechal.com/.netlify/functions/suivi-cockpit, aucun nom d'enfant ni de parent)
// et recalcule les chiffres du projet (activites.kpis) et la courbe des inscriptions (activites.serie).
// Secrets : CAMP_CLE (clé partagée avec la variable COCKPIT_CLE du site Netlify).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CLE_SYNCHRO = Deno.env.get("CLE_SYNCHRO") ?? "";
const CAMP_CLE = Deno.env.get("CAMP_CLE") ?? "";
const SOURCE = "https://www.camprouziermarechal.com/.netlify/functions/suivi-cockpit";
const PROJET = "camp-rouzier-marechal";
const CALCULES = ["Inscrits 2027", "Encaissé 2027", "Places restantes", "Dossiers complets"];
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cle-synchro",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: { ...cors, "Content-Type": "application/json" } });
const court = (semaine: string) => semaine.replace(/\s*\(.*\)$/, "").replace(" 2027", "").replace("juillet", "juil.");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  if (!(CLE_SYNCHRO && req.headers.get("x-cle-synchro") === CLE_SYNCHRO)) {
    const jeton = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data } = jeton ? await db.auth.getUser(jeton) : { data: { user: null } };
    if (!data?.user) return json({ erreur: "non autorisé" }, 401);
  }
  if (!CAMP_CLE) return json({ erreur: "clé du camp manquante" }, 500);

  const r = await fetch(SOURCE, { headers: { "x-cle-cockpit": CAMP_CLE } });
  if (!r.ok) return json({ erreur: `suivi du camp ${r.status}` }, 502);
  const s = await r.json();
  const semaines = (s.semaines ?? []) as { semaine: string; places: number; inscrits: number; restantes: number }[];
  const restantes = semaines.reduce((t, x) => t + x.restantes, 0);

  const { data: a } = await db.from("activites").select("kpis, serie, sources").eq("id", PROJET).single();
  const anciens = ((a?.kpis ?? []) as Record<string, unknown>[]);
  const precedent = anciens.find((k) => k.label === "Inscrits 2027")?.precedent ?? 150;
  const kpis: Record<string, unknown>[] = [
    { label: "Inscrits 2027", valeur: s.inscrits, unite: "", objectif: s.places, precedent,
      detail: `${Math.round(s.inscrits / Math.max(1, s.places) * 100)} % des ${s.places} places · ${precedent} participants en 2026` },
    { label: "Encaissé 2027", valeur: Math.round(s.encaisse), unite: "€", detail: `${s.regles} réglés · ${s.enCours} paiements en cours` },
    { label: "Places restantes", valeur: restantes, unite: "", detail: semaines.map((x) => `${court(x.semaine)} : ${x.restantes}`).join(" · ") },
    { label: "Dossiers complets", valeur: s.complets, unite: "", objectif: s.inscrits, alerte: s.sansPaiement > 0 || undefined,
      detail: `${s.valides} validés par l'équipe` + (s.sansPaiement ? ` · ${s.sansPaiement} dossier(s) sans paiement` : "") },
  ].concat(anciens.filter((k) => !CALCULES.includes(k.label as string)));

  // Courbe : un point par jour (inscrits cumulés), le point du jour est mis à jour à chaque passage
  const jour = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "Europe/Paris" }).format(new Date());
  const serie = (a?.serie ?? { titre: "Inscriptions 2027 cumulées", unite: "", points: [] }) as { titre: string; unite: string; points: { label: string; valeur: number }[] };
  const points = (serie.points ?? []).filter((p) => p.label !== jour).concat([{ label: jour, valeur: s.inscrits }]).slice(-30);
  const sources = Array.from(new Set(["Suivi des inscriptions (site du camp)", ...((a?.sources ?? []) as string[])]));

  await db.from("activites").update({ kpis, serie: { ...serie, points }, sources, mise_a_jour: new Date().toISOString() }).eq("id", PROJET);
  return json({ ok: true, bilan: { inscrits: s.inscrits, places: s.places, encaisse: s.encaisse, restantes, maj: s.maj } });
});
