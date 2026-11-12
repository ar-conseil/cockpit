// Connexion du compte Wispr Flow d'Antonin au cockpit (OAuth PKCE, sans mot de passe vu par le cockpit).
//  POST (session du cockpit) { action: "connecter" } -> { url } : page d'accord de Wispr ; { action: "deconnecter" } -> { ok }
//  GET ?code&state (retour de Wispr) -> jetons enregistrés (wispr_connexion), puis retour à la page Agendas du cockpit.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { AUTORISATION, CLIENT_ID, JETON, MCP, PORTEE, RETOUR, formulaire } from "../_partage/wispr.ts";

const SITE = "https://ar-conseil.github.io/cockpit/";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: { ...cors, "Content-Type": "application/json" } });
const vers = (message: string) => Response.redirect(`${SITE}#agendas?message=${encodeURIComponent(message)}`, 303);
const b64url = (o: Uint8Array) => btoa(String.fromCharCode(...o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  if (req.method === "GET") {
    const u = new URL(req.url), code = u.searchParams.get("code"), etat = u.searchParams.get("state") ?? "";
    if (u.searchParams.get("error") || !code) return vers("Wispr Flow : connexion annulée.");
    const { data: a } = await db.from("wispr_attente").delete().eq("etat", etat).gt("cree_le", new Date(Date.now() - 15 * 60e3).toISOString())
      .select().maybeSingle();
    if (!a) return vers("Wispr Flow : connexion expirée, recommencer.");
    try {
      const r = await formulaire(JETON, { grant_type: "authorization_code", code, redirect_uri: RETOUR, client_id: CLIENT_ID,
        code_verifier: a.verificateur, resource: MCP });
      await db.from("wispr_connexion").upsert({ id: 1, acces: r.access_token, renouvellement: r.refresh_token ?? null,
        expire: new Date(Date.now() + (Number(r.expires_in) || 3600) * 1000 - 60e3).toISOString(), connecte_le: new Date().toISOString(), erreur: null });
      return vers("Wispr Flow connecté : tes notes « Victor, … » arrivent maintenant dans le cockpit.");
    } catch (e) {
      console.error("wispr-connexion :", e instanceof Error ? e.message : e);
      return vers("Wispr Flow : la connexion a échoué, recommencer.");
    }
  }

  const { data: u } = await db.auth.getUser((req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  if (!u?.user) return json({ erreur: "non autorisé" }, 401);
  const b = await req.json().catch(() => ({}));
  if (b.action === "deconnecter") { await db.from("wispr_connexion").delete().eq("id", 1); return json({ ok: true }); }
  const verificateur = b64url(crypto.getRandomValues(new Uint8Array(48))), etat = b64url(crypto.getRandomValues(new Uint8Array(18)));
  const defi = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verificateur))));
  await db.from("wispr_attente").delete().lt("cree_le", new Date(Date.now() - 15 * 60e3).toISOString());
  await db.from("wispr_attente").insert({ etat, verificateur });
  const p = new URLSearchParams({ response_type: "code", client_id: CLIENT_ID, redirect_uri: RETOUR, scope: PORTEE, state: etat,
    code_challenge: defi, code_challenge_method: "S256", resource: MCP });
  return json({ url: `${AUTORISATION}?${p}` });
});
