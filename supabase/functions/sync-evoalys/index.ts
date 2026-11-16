// Synchronisation des tâches Evoa avec Evoalys (logiciel du cabinet), toutes les 5 minutes (pg_cron, clé de synchro) :
//  - une tâche d'Antonin créée dans Evoalys arrive dans le cockpit (projet evoa-courtage), titre et échéance tenus à jour ;
//  - cochée d'un côté, elle l'est de l'autre (externe_fait garde l'état du dernier passage pour savoir qui a changé) ;
//  - une tâche Evoa créée dans le cockpit après la mise en service part dans Evoalys.
// Evoalys : GET/POST {EVOALYS_URL}/cockpit/taches, en-tête X-Cle-Cockpit = secret EVOALYS_CLE. Les clients particuliers
// arrivent déjà en initiales (Evoalys les remplace avant l'envoi).
// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: { "Content-Type": "application/json" } });
const PROJET = "evoa-courtage";

Deno.serve(async (req) => {
  if (!(Deno.env.get("CLE_SYNCHRO") && req.headers.get("x-cle-synchro") === Deno.env.get("CLE_SYNCHRO"))) return json({ erreur: "non autorisé" }, 401);
  const URL_E = (Deno.env.get("EVOALYS_URL") || "https://app.evoalys.com").replace(/\/$/, ""), CLE = Deno.env.get("EVOALYS_CLE") ?? "";
  if (!CLE) return json({ ignore: "clé EVOALYS_CLE absente (outils/evoalys-cle.sh)" });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const evoalys = async (chemin: string, corps?: unknown) => {
    const r = await fetch(`${URL_E}${chemin}`, { method: corps ? "POST" : "GET",
      headers: { "x-cle-cockpit": CLE, "Content-Type": "application/json", Accept: "application/json", "User-Agent": "Cockpit AR Conseil" },
      body: corps ? JSON.stringify(corps) : undefined });
    if (!r.ok) throw new Error(`Evoalys ${chemin} : HTTP ${r.status}`);
    return r.json();
  };
  let { data: etat } = await db.from("evoalys_sync").select("*").eq("id", 1).maybeSingle();
  if (!etat) etat = (await db.from("evoalys_sync").insert({ id: 1 }).select().single()).data;
  const bilan = { recues: 0, creees: 0, mises_a_jour: 0, cochees_ici: 0, cochees_la_bas: 0, envoyees: 0 };
  try {
    const distantes: any[] = (await evoalys("/cockpit/taches")).taches ?? [];
    const { data: locales } = await db.from("taches").select("id, titre, echeance, statut, externe, externe_fait, lien").like("externe", "evoalys:%");
    const parExterne = new Map((locales ?? []).map((t: any) => [t.externe, t]));
    bilan.recues = distantes.length;
    for (const d of distantes) {
      const ext = `evoalys:${d.id}`, l: any = parExterne.get(ext), lien = `${URL_E}${d.lien || "/"}`;
      const notes = d.client ? `Evoalys · client ${d.client}` : "Evoalys";
      if (!l) {
        if (d.fait) continue;   // déjà faite avant d'arriver : rien à reprendre
        await db.from("taches").insert({ titre: d.titre, activite_id: PROJET, echeance: d.echeance, priorite: "moyenne", statut: "a-faire",
          notes, externe: ext, externe_fait: false, lien });
        bilan.creees++;
        continue;
      }
      const maj: Record<string, unknown> = {};
      if (l.titre !== d.titre) maj.titre = d.titre;
      if ((l.echeance ?? null) !== (d.echeance ?? null)) maj.echeance = d.echeance;
      if (l.lien !== lien) maj.lien = lien;
      const faitIci = l.statut === "fait";
      if (d.fait !== l.externe_fait) {             // changé dans Evoalys : on suit
        if (d.fait !== faitIci) { maj.statut = d.fait ? "fait" : "a-faire"; maj.fait_le = d.fait ? new Date().toISOString() : null; bilan.cochees_ici++; }
        maj.externe_fait = d.fait;
      } else if (faitIci !== d.fait) {              // changé dans le cockpit : on le dit à Evoalys
        await evoalys(`/cockpit/taches/${d.id}/fait`, { fait: faitIci });
        maj.externe_fait = faitIci; bilan.cochees_la_bas++;
      }
      if (Object.keys(maj).length) { await db.from("taches").update(maj).eq("id", l.id); bilan.mises_a_jour++; }
    }
    // Tâches Evoa créées dans le cockpit depuis la mise en service : envoyées dans Evoalys
    const { data: nouvelles } = await db.from("taches").select("id, titre, echeance").eq("activite_id", PROJET).is("externe", null)
      .neq("statut", "fait").gte("cree_le", etat.depuis);
    for (const t of nouvelles ?? []) {
      const r = await evoalys("/cockpit/taches", { titre: t.titre, echeance: t.echeance });
      await db.from("taches").update({ externe: `evoalys:${r.id}`, externe_fait: false, lien: `${URL_E}/` }).eq("id", t.id);
      bilan.envoyees++;
    }
    await db.from("evoalys_sync").update({ dernier: new Date().toISOString(), erreur: null }).eq("id", 1);
    return json(bilan);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    await db.from("evoalys_sync").update({ erreur: m.slice(0, 300) }).eq("id", 1);
    return json({ erreur: m, ...bilan }, 502);
  }
});
