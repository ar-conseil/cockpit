// Création, modification et suppression d'un rendez-vous depuis le cockpit, répercutées dans Google ou Outlook.
// Corps : { action: "creer" | "modifier" | "supprimer", agenda_id, evenement_id?, titre, debut, fin, journee, lieu, activite_forcee? }
// Appelée avec le jeton de l'utilisateur connecté (contrôlé ici ; déployée avec --no-verify-jwt comme les autres).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { ecrireRdv, jetonAcces, type Compte } from "../_partage/fournisseurs.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cle-synchro",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const jeton = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u } = await db.auth.getUser(jeton);
  if (!u?.user) return json({ erreur: "non autorisé" }, 401);

  const b = await req.json().catch(() => ({}));
  const action = b.action as "creer" | "modifier" | "supprimer";
  if (!["creer", "modifier", "supprimer"].includes(action)) return json({ erreur: "action inconnue" }, 400);

  let ev: Record<string, unknown> | null = null;
  if (action !== "creer") {
    const { data } = await db.from("evenements").select("*").eq("id", b.evenement_id).single();
    if (!data) return json({ erreur: "rendez-vous introuvable" }, 404);
    ev = data;
  }
  const agendaId = (ev?.agenda_id as string) ?? b.agenda_id;
  const { data: ag } = await db.from("agendas").select("id, externe_id, ecriture, activite_id, compte_id, comptes_agenda(*)").eq("id", agendaId).single();
  if (!ag) return json({ erreur: "agenda introuvable" }, 404);
  if (!ag.compte_id || !ag.ecriture) return json({ erreur: "cet agenda est en lecture seule (adresse iCal ou droits insuffisants)" }, 400);

  if (action !== "supprimer") {
    if (!b.titre || !b.debut || !b.fin || Date.parse(b.fin) <= Date.parse(b.debut)) return json({ erreur: "titre, début et fin (après le début) sont obligatoires" }, 400);
  }
  try {
    const compte = ag.comptes_agenda as unknown as Compte;
    const id = await ecrireRdv(compte, await jetonAcces(db, compte), ag.externe_id!, action, (ev?.externe_id as string) ?? null,
      action === "supprimer" ? undefined : { titre: b.titre, debut: b.debut, fin: b.fin, journee: !!b.journee, lieu: b.lieu ?? null });

    if (action === "supprimer") {
      await db.from("evenements").delete().eq("id", ev!.id);
      return json({ ok: true });
    }
    const ligne = {
      agenda_id: ag.id, uid: id, externe_id: id, debut: new Date(b.debut).toISOString(), fin: new Date(b.fin).toISOString(), journee: !!b.journee,
      titre: b.titre, lieu: b.lieu ?? null, activite_id: (ev?.activite_id as string) ?? ag.activite_id,
      activite_forcee: b.activite_forcee === undefined ? (ev?.activite_forcee ?? null) : b.activite_forcee,
      modifiable: true, serie: (ev?.serie as boolean) ?? false, annule: false, vu_le: new Date().toISOString(),
    };
    // Un rendez-vous déplacé change de début : on remplace la ligne pour garder une seule copie.
    if (ev) await db.from("evenements").delete().eq("id", ev.id);
    const { data, error } = await db.from("evenements").upsert(ligne, { onConflict: "agenda_id,uid,debut" }).select().single();
    if (error) throw new Error(error.message);
    return json({ ok: true, evenement: data });
  } catch (e) {
    return json({ erreur: e instanceof Error ? e.message : String(e) }, 502);
  }
});
