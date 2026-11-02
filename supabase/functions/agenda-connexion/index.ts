// Connexion d'un compte Google ou Microsoft au cockpit.
//  POST (jeton de l'utilisateur connecté, { fournisseur })  -> { url } de la page d'autorisation Google / Microsoft
//  GET  ?code=…&state=… (retour de cette page)              -> enregistre le compte et ses agendas, puis revient sur le site
// Déployée avec --no-verify-jwt : le retour de Google / Microsoft n'a pas de jeton Supabase ; l'état signé fait foi.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { echangerCode, jetonAcces, listerAgendas, lireEtat, projetParDefaut, signerEtat, urlAutorisation, type Compte, type Fournisseur } from "../_partage/fournisseurs.ts";

const SITE = Deno.env.get("SITE_URL") ?? "https://ar-conseil.github.io/cockpit/";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type" };
const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: { ...cors, "Content-Type": "application/json" } });
const retour = (message: string) => Response.redirect(`${SITE}#agendas?message=${encodeURIComponent(message)}`, 302);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  if (req.method === "POST") {
    const jeton = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data } = await db.auth.getUser(jeton);
    if (!data?.user) return json({ erreur: "non autorisé" }, 401);
    const { fournisseur } = await req.json().catch(() => ({}));
    if (fournisseur !== "google" && fournisseur !== "microsoft") return json({ erreur: "fournisseur inconnu" }, 400);
    const manque = fournisseur === "google" ? !Deno.env.get("GOOGLE_CLIENT_ID") : !Deno.env.get("MS_CLIENT_ID");
    if (manque) return json({ erreur: `l'accès ${fournisseur === "google" ? "Google" : "Microsoft"} n'est pas encore configuré` }, 400);
    return json({ url: urlAutorisation(fournisseur, await signerEtat(fournisseur)) });
  }

  const p = new URL(req.url).searchParams;
  if (p.get("error")) return retour(`Connexion refusée : ${p.get("error_description") || p.get("error")}`);
  const etat = await lireEtat(p.get("state") ?? "");
  const code = p.get("code");
  if (!etat || !code) return retour("Lien de connexion expiré : recommencez.");
  const f = etat.f as Fournisseur;
  try {
    const j = await echangerCode(f, code);
    const { data: existant } = await db.from("comptes_agenda").select("id, refresh_token").eq("fournisseur", f).eq("email", j.email).maybeSingle();
    const { data: compte, error } = await db.from("comptes_agenda").upsert({
      fournisseur: f, email: j.email, refresh_token: j.refresh_token ?? existant?.refresh_token ?? null,
      jeton_acces: j.jeton_acces, jeton_expire_le: j.jeton_expire_le, derniere_erreur: null,
    }, { onConflict: "fournisseur,email" }).select().single();
    if (error) throw new Error(error.message);
    const c = compte as Compte;
    const agendas = await listerAgendas(c, await jetonAcces(db, c));
    for (const a of agendas) {
      const { data: deja } = await db.from("agendas").select("id").eq("compte_id", c.id).eq("externe_id", a.externe_id).maybeSingle();
      if (deja) await db.from("agendas").update({ nom: a.nom, ecriture: a.ecriture }).eq("id", deja.id);
      else await db.from("agendas").insert({ compte_id: c.id, externe_id: a.externe_id, nom: a.nom, ecriture: a.ecriture, actif: a.actif,
        activite_id: projetParDefaut(a.nom, a.principal ? c.email : "") });
    }
    // Première lecture des rendez-vous tout de suite, sans attendre le passage du cron.
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/sync-agendas`, { method: "POST",
      headers: { "Content-Type": "application/json", "x-cle-synchro": Deno.env.get("CLE_SYNCHRO") ?? "" }, body: "{}" }).catch(() => null);
    return retour(`${j.email} connecté : ${agendas.length} agenda(s).`);
  } catch (e) {
    return retour(`Connexion impossible : ${e instanceof Error ? e.message : String(e)}`);
  }
});
