// Notifications du téléphone : GET -> { cle_publique } (pour abonner l'appli Victor) ;
// POST { test: true } (session du cockpit) -> envoie une notification d'essai à tous les appareils abonnés.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { notifier } from "../_partage/notifier.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method === "GET") return json({ cle_publique: Deno.env.get("VAPID_PUBLIQUE") ?? null });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const interne = !!Deno.env.get("CLE_SYNCHRO") && req.headers.get("x-cle-synchro") === Deno.env.get("CLE_SYNCHRO");
  if (!interne) {
    const { data: u } = await db.auth.getUser((req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
    if (!u?.user) return json({ erreur: "non autorisé" }, 401);
  }
  return json(await notifier(db, "Victor", "Les notifications sont activées : je te préviens ici dès que j'ai fini une demande."));
});
