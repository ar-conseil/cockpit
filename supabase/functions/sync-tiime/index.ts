// Factures Tiime d'AR Conseil -> table factures du cockpit (Berkay, Wealthy), toutes les heures par pg_cron.
// Connexion avec les identifiants Tiime d'Antonin, rangés dans les secrets TIIME_EMAIL / TIIME_MOT_DE_PASSE
// (posés par outils/tiime.sh, jamais écrits dans un fichier). Lecture seule côté Tiime.
//  POST {}                 -> synchronise
//  POST { apercu: true }   -> ne modifie rien, renvoie la forme des données (pour vérifier la lecture)
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CLE_SYNCHRO = Deno.env.get("CLE_SYNCHRO") ?? "";
const SOCIETE = Deno.env.get("TIIME_SOCIETE") || "539843"; // AR CONSEIL
const API = "https://chronos-api.tiime-apps.com/v1";
const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: { "Content-Type": "application/json" } });
// Statut : on ne revient jamais en arrière (une facture annulée ou payée dans le cockpit le reste)
const RANG: Record<string, number> = { "a-emettre": 0, "emise": 1, "payee": 2, "annulee": 3 };

async function connexion() {
  const r = await fetch("https://auth0.tiime.fr/oauth/token", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "password", client_id: "iEbsbe3o66gcTBfGRa012kj1Rb6vjAND", audience: "https://chronos/",
      scope: "openid email", username: Deno.env.get("TIIME_EMAIL"), password: Deno.env.get("TIIME_MOT_DE_PASSE") }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`connexion Tiime : ${j.error_description || j.error || r.status}`);
  return j.access_token as string;
}

// deno-lint-ignore no-explicit-any
async function factures(jeton: string): Promise<any[]> {
  const tout = [];
  for (let debut = 0; debut < 2000; debut += 100) {
    const r = await fetch(`${API}/invoice/companies/${SOCIETE}/invoices?sorts=emission_date:desc`, {
      headers: { Authorization: `Bearer ${jeton}`, Range: `items=${debut}-${debut + 99}`, Accept: "application/json" } });
    if (!r.ok && r.status !== 206) throw new Error(`factures Tiime : HTTP ${r.status} ${(await r.text()).slice(0, 150)}`);
    const page = await r.json();
    const liste = Array.isArray(page) ? page : page.data ?? page.items ?? [];
    tout.push(...liste);
    const plage = r.headers.get("content-range"); // ex. « items 0-99/123 »
    const total = plage ? Number(plage.split("/")[1]) : liste.length;
    if (liste.length < 100 || tout.length >= total) break;
  }
  return tout;
}

// deno-lint-ignore no-explicit-any
const champ = (o: any, ...cles: string[]) => { for (const k of cles) { const v = k.split(".").reduce((x, y) => x?.[y], o); if (v != null && v !== "") return v; } return null; };

Deno.serve(async (req) => {
  if (!(CLE_SYNCHRO && req.headers.get("x-cle-synchro") === CLE_SYNCHRO)) return json({ erreur: "non autorisé" }, 401);
  if (!Deno.env.get("TIIME_EMAIL") || !Deno.env.get("TIIME_MOT_DE_PASSE")) return json({ erreur: "identifiants Tiime manquants (outils/tiime.sh)" }, 400);
  const corps = await req.json().catch(() => ({}));
  try {
    const liste = await factures(await connexion());
    if (corps.apercu) {
      const f = liste[0] ?? {};
      return json({ ok: true, nombre: liste.length, cles: Object.keys(f), exemple: {
        numero: champ(f, "compiled_number", "number"), date: champ(f, "emission_date", "date"), client: champ(f, "client_name", "client.name"),
        statut: champ(f, "status"), type: champ(f, "type", "document_type"), ttc: champ(f, "total_including_taxes", "total_amount") } });
    }
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: existantes } = await db.from("factures").select("id, numero, activite_id, statut, payee_le");
    const { data: clients } = await db.from("clients").select("id, nom, activite_id").in("activite_id", ["berkay", "wealthy"]);
    let crees = 0, maj = 0, ignorees = 0;
    for (const f of liste) {
      const nomClient = String(champ(f, "client_name", "client.name", "client.billing_name") ?? "");
      const activite = /berkay/i.test(nomClient) ? "berkay" : /wealthy/i.test(nomClient) ? "wealthy" : null;
      if (!activite) { ignorees++; continue; }
      const ttc = Number(champ(f, "total_including_taxes", "total_amount", "amount") ?? 0);
      const ht = Number(champ(f, "total_excluding_taxes", "total_amount_excluding_taxes") ?? ttc);
      const avoir = /credit/i.test(String(champ(f, "type", "document_type") ?? "")) || ttc < 0;
      const brut = String(champ(f, "compiled_number", "number") ?? "").replace(/^\D+/, "");
      if (!brut) { ignorees++; continue; }
      const numero = (avoir ? "A" : "") + brut;
      const s = String(champ(f, "status") ?? "").toLowerCase();
      const statut = /cancel|annul/.test(s) ? "annulee" : /paid|pay/.test(s) ? "payee" : /draft|saved|brouillon/.test(s) ? "a-emettre" : "emise";
      const objet = String(champ(f, "title", "comment", "lines.0.description") ?? "").slice(0, 200) || (avoir ? "Avoir" : "Facture");
      const emise = String(champ(f, "emission_date", "date") ?? "").slice(0, 10) || null;
      const payee = String(champ(f, "payment_date", "paid_at", "last_payment_date") ?? "").slice(0, 10) || null;
      const deja = (existantes ?? []).find((x) => x.numero === numero && x.activite_id === activite);
      if (deja) {
        const nouveau = RANG[statut] > RANG[deja.statut] ? statut : deja.statut;
        const champs: Record<string, unknown> = { montant_ht: ht, montant_ttc: ttc, emise_le: emise };
        if (nouveau !== deja.statut) champs.statut = nouveau;
        if (nouveau === "payee" && !deja.payee_le && payee) champs.payee_le = payee;
        await db.from("factures").update(champs).eq("id", deja.id);
        maj++;
      } else {
        // Rattachement à l'affaire (Berkay : le nom de l'investisseur figure dans l'objet)
        const client = (clients ?? []).find((c) => c.activite_id === activite && new RegExp(c.nom.split(/\s+/).pop()!.replace(/[^\p{L}]/gu, ""), "iu").test(objet));
        await db.from("factures").insert({ numero, activite_id: activite, client_id: client?.id ?? null, objet, destinataire: nomClient,
          emise_le: emise, montant_ht: ht, tva: ttc && ht ? Math.round((ttc / ht - 1) * 1000) / 10 : 0, montant_ttc: ttc, statut,
          payee_le: statut === "payee" ? payee : null, notes: "Synchronisée depuis Tiime." });
        crees++;
      }
    }
    return json({ ok: true, bilan: { lues: liste.length, crees, maj, ignorees } });
  } catch (e) {
    return json({ erreur: e instanceof Error ? e.message : String(e) }, 502);
  }
});
