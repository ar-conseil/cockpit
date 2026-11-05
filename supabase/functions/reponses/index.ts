// Validation des réponses préparées par Victor, depuis le cockpit (session de l'utilisateur connecté).
// Corps : { id, action: "envoyer" | "modifier" | "abandonner", texte? }
//  - modifier : remplace le texte du brouillon (dans la boîte et dans la table) ;
//  - envoyer : (avec le texte final s'il a changé) envoie le brouillon ; Outlook sans droit d'envoi -> à envoyer depuis Outlook ;
//  - abandonner : retire le brouillon.
// Seule une réponse au statut « brouillon » peut partir ; chaque envoi est noté (statut envoye, envoye_le).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { abandonnerBrouillon, envoyerBrouillon, modifierBrouillon } from "../_partage/reponses.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const b = await req.json().catch(() => ({}));
  // Clé d'essai temporaire (CLE_TACHE_ESSAI) : tests de modifier / abandonner sans session du site ; jamais d'envoi avec elle
  const essai = !!Deno.env.get("CLE_TACHE_ESSAI") && req.headers.get("x-cle-tache") === Deno.env.get("CLE_TACHE_ESSAI");
  if (!essai) {
    const { data: u } = await db.auth.getUser((req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
    if (!u?.user) return json({ erreur: "non autorisé" }, 401);
  } else if (b.action === "envoyer") return json({ erreur: "pas d'envoi avec la clé d'essai" }, 403);

  if (!["envoyer", "modifier", "abandonner"].includes(b.action)) return json({ erreur: "action inconnue" }, 400);
  const { data: r } = await db.from("reponses").select("*").eq("id", b.id).single();
  if (!r) return json({ erreur: "réponse introuvable" }, 404);
  if (r.canal !== "mail") return json({ erreur: "un SMS ou un WhatsApp s'envoie depuis l'iPhone" }, 400);
  if (r.statut !== "brouillon") return json({ erreur: `déjà ${r.statut === "envoye" ? "envoyée" : "abandonnée"}` }, 409);
  const texte = typeof b.texte === "string" ? b.texte.trim().slice(0, 20000) : null;

  try {
    if (texte && texte !== r.texte) {
      r.brouillon_id = await modifierBrouillon(db, r, texte); r.texte = texte;
      await db.from("reponses").update({ texte, brouillon_id: r.brouillon_id, erreur: null }).eq("id", r.id);
    }
    if (b.action === "modifier") return json({ ok: true });
    if (b.action === "abandonner") {
      await abandonnerBrouillon(db, r);
      await db.from("reponses").update({ statut: "abandonne", erreur: null }).eq("id", r.id);
      return json({ ok: true });
    }
    await envoyerBrouillon(db, r);
    await db.from("reponses").update({ statut: "envoye", envoye_le: new Date().toISOString(), erreur: null }).eq("id", r.id);
    return json({ ok: true });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (m === "OUTLOOK_SANS_ENVOI") return json({ erreur: "Outlook n'autorise pas le cockpit à envoyer : le brouillon est prêt dans vos Brouillons Outlook, à envoyer depuis Outlook.", outlook: true }, 403);
    await db.from("reponses").update({ erreur: m.slice(0, 300) }).eq("id", r.id);
    return json({ erreur: m }, 502);
  }
});
