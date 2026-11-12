// Veille Wispr Flow (pg_cron, chaque minute, clé de synchro) : les nouvelles notes vocales Wispr d'Antonin sont lues
// sur le serveur MCP de Wispr ; celles qui commencent par « Victor » sont confiées à l'assistant, comme une demande tapée
// dans le cockpit. Fonctionne téléphone seul (en voiture) : rien ne passe par le Mac. Les autres notes sont seulement
// marquées comme vues (leur contenu n'est ni gardé ni envoyé). Une note encore en cours ou sans texte est reprise plus tard.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { CLIENT_ID, ClientMCP, JETON, MCP, demandePourVictor, formulaire, idDe, listeDicts, transcription } from "../_partage/wispr.ts";

const URL_SB = Deno.env.get("SUPABASE_URL")!;
const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: { "Content-Type": "application/json" } });
const A_RECONNECTER = "La connexion à Wispr Flow a expiré : la refaire depuis la page Agendas du cockpit.";

async function jeton(db: any, cx: any): Promise<string> {
  if (cx.acces && cx.expire && Date.parse(cx.expire) > Date.now()) return cx.acces;
  if (!cx.renouvellement) throw new Error(A_RECONNECTER);
  try {
    const r = await formulaire(JETON, { grant_type: "refresh_token", refresh_token: cx.renouvellement, client_id: CLIENT_ID, resource: MCP });
    await db.from("wispr_connexion").update({ acces: r.access_token, renouvellement: r.refresh_token ?? cx.renouvellement,
      expire: new Date(Date.now() + (Number(r.expires_in) || 3600) * 1000 - 60e3).toISOString() }).eq("id", 1);
    return r.access_token;
  } catch (e: any) {
    if ([400, 401, 403].includes(e?.status)) throw new Error(A_RECONNECTER);
    throw e;
  }
}

const finDe = (m: any) => { const v = typeof m.end === "object" ? m.end?.dateTime : m.end; return typeof v === "string" && v ? Date.parse(v) : null; };

async function veiller() {
  const db = createClient(URL_SB, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: cx } = await db.from("wispr_connexion").select("*").eq("id", 1).maybeSingle();
  if (!cx?.renouvellement) return { ignore: "Wispr non connecté" };
  await db.from("wispr_connexion").update({ derniere_synchro: new Date().toISOString() }).eq("id", 1);
  try {
    const mcp = await new ClientMCP(await jeton(db, cx)).ouvrir();
    const depuis = new Date(Math.max(Date.parse(cx.connecte_le), Date.now() - 2 * 864e5)).toISOString().replace(/\.\d+Z$/, "Z");
    const notes = listeDicts(await mcp.outil("search_meetings", { since: depuis, limit: 20 }));
    const refs = notes.map(idDe).filter(Boolean) as string[];
    const { data: vues } = refs.length ? await db.from("wispr_vues").select("reference").in("reference", refs) : { data: [] };
    const deja = new Set((vues ?? []).map((v: any) => v.reference));
    const traitees: string[] = [];
    for (const m of notes) {
      const ref = idDe(m);
      if (!ref || deja.has(ref) || m.shared || m.has_transcript === false) continue;
      if ("end" in m && finDe(m) == null) continue;              // encore en cours d'enregistrement
      const texte = await transcription(mcp, ref);
      const debut = Date.parse(m.created_at ?? m.start ?? m.start_time ?? ""), fin = finDe(m) ?? (Number.isNaN(debut) ? Date.now() : debut);
      const recente = Date.now() - fin < 15 * 60e3;
      if (texte.length < 8 && recente) continue;                 // transcription pas encore prête : au passage suivant
      const demande = demandePourVictor(texte);
      // marquée comme vue avant d'agir : deux passages simultanés ne la traitent jamais deux fois
      const { error } = await db.from("wispr_vues").insert({ reference: ref, pour_victor: !!demande });
      if (error || !demande) continue;
      const r = await fetch(`${URL_SB}/functions/v1/assistant`, { method: "POST",
        headers: { "Content-Type": "application/json", "x-cle-wispr": Deno.env.get("CLE_WISPR") ?? "" },
        body: JSON.stringify({ texte: demande, source: "wispr" }) });
      const j = await r.json().catch(() => ({}));
      await db.from("wispr_vues").update({ resultat: String(j.texte ?? j.erreur ?? `HTTP ${r.status}`).slice(0, 1000) }).eq("reference", ref);
      traitees.push(ref);
    }
    await db.from("wispr_connexion").update({ erreur: null }).eq("id", 1);
    return { notes: notes.length, pour_victor: traitees.length };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (!/trop de demandes/.test(m)) await db.from("wispr_connexion").update({ erreur: m.slice(0, 300) }).eq("id", 1);
    return { erreur: m };
  }
}

Deno.serve(async (req) => {
  if (!(Deno.env.get("CLE_SYNCHRO") && req.headers.get("x-cle-synchro") === Deno.env.get("CLE_SYNCHRO"))) return json({ erreur: "non autorisé" }, 401);
  return json(await veiller());
});
