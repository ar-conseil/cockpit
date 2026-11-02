// Harnes Volley en direct (tous les quarts d'heure, par pg_cron) :
//  1. HubSpot : partenaires (deals) -> fiches clients du projet harnes-volley (étape, montant) ;
//  2. Billetweb : billets de chaque match à domicile et abonnés de la saison ;
//  3. matchs à domicile -> agenda Google « Harnes Volley » (identifiant stable : un match = un rendez-vous) ;
//  4. chiffres du projet (activites.kpis) recalculés.
// Secrets : HUBSPOT_TOKEN (lecture), BILLETWEB_USER / BILLETWEB_KEY (lecture). Aucune donnée personnelle de spectateur n'est stockée.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { jetonAcces, type Compte } from "../_partage/fournisseurs.ts";

const CLE_SYNCHRO = Deno.env.get("CLE_SYNCHRO") ?? "";
const HUBSPOT = Deno.env.get("HUBSPOT_TOKEN") ?? "";
const BW = Deno.env.get("BILLETWEB_USER") && Deno.env.get("BILLETWEB_KEY")
  ? "Basic " + btoa(`${Deno.env.get("BILLETWEB_USER")}:${Deno.env.get("BILLETWEB_KEY")}`) : "";
const PROJET = "harnes-volley";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cle-synchro",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: { ...cors, "Content-Type": "application/json" } });
const normaliser = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const euros = (v: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(v) + " €";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  if (!(CLE_SYNCHRO && req.headers.get("x-cle-synchro") === CLE_SYNCHRO)) {
    const jeton = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data } = jeton ? await db.auth.getUser(jeton) : { data: { user: null } };
    if (!data?.user) return json({ erreur: "non autorisé" }, 401);
  }
  const bilan: Record<string, unknown> = {};

  // ---------- 1. HubSpot -> fiches partenaires ----------
  if (HUBSPOT) {
    try {
      const hs = async (chemin: string) => {
        const r = await fetch(`https://api.hubapi.com${chemin}`, { headers: { Authorization: `Bearer ${HUBSPOT}` } });
        if (!r.ok) throw new Error(`HubSpot ${r.status} : ${(await r.text()).slice(0, 200)}`);
        return r.json();
      };
      const pipelines = await hs("/crm/v3/pipelines/deals");
      const libelles: Record<string, string> = {};
      let ordre: string[] = [];
      // deno-lint-ignore no-explicit-any
      for (const p of pipelines.results ?? []) {
        // deno-lint-ignore no-explicit-any
        const etapes = (p.stages ?? []).sort((a: any, b: any) => a.displayOrder - b.displayOrder);
        // deno-lint-ignore no-explicit-any
        etapes.forEach((s: any) => { libelles[s.id] = s.label; });
        if (p.id === "default" || !ordre.length) ordre = etapes.map((s: { label: string }) => s.label);
      }
      // deno-lint-ignore no-explicit-any
      const deals: any[] = [];
      let apres = "";
      do {
        const page = await hs(`/crm/v3/objects/deals?limit=100&properties=dealname,dealstage,amount,closedate,pipeline${apres ? "&after=" + apres : ""}`);
        deals.push(...(page.results ?? []));
        apres = page.paging?.next?.after ?? "";
      } while (apres);

      const { data: fiches } = await db.from("clients").select("id, nom, etape, donnees").eq("activite_id", PROJET);
      const parId = new Map((fiches ?? []).filter((f) => f.donnees?.hubspot_id).map((f) => [String(f.donnees.hubspot_id), f]));
      const parNom = new Map((fiches ?? []).map((f) => [normaliser(f.nom), f]));
      const actionPour = (etape: string) => /factur/i.test(etape) ? "Suivre l'encaissement" : /sign/i.test(etape) ? "Facturer le partenariat"
        : /proposition/i.test(etape) ? "Relancer la proposition" : /rendez|rdv/i.test(etape) ? "Préparer le rendez-vous" : /contacter/i.test(etape) ? "Contacter" : null;
      let maj = 0, crees = 0;
      for (const d of deals) {
        const p = d.properties ?? {};
        if (/\[d[ée]mo\]/i.test(p.dealname ?? "")) continue; // fiches de démonstration de l'appli HVB
        const nom = String(p.dealname ?? "Partenaire").replace(/\s*[–—-]\s*Partenariat.*$/i, "").trim();
        const etape = libelles[p.dealstage] ?? p.dealstage ?? null;
        const montant = p.amount ? Number(p.amount) : null;
        const fiche = parId.get(String(d.id)) ?? parNom.get(normaliser(nom));
        const donnees = { ...(fiche?.donnees ?? {}), hubspot_id: String(d.id) };
        if (fiche) {
          const champs: Record<string, unknown> = { etape, montant, donnees };
          if (fiche.etape !== etape) champs.prochaine_action = actionPour(etape ?? "");
          await db.from("clients").update(champs).eq("id", fiche.id);
          maj++;
        } else {
          await db.from("clients").insert({ activite_id: PROJET, nom, type: "partenaire", etape, montant, donnees,
            prochaine_action: actionPour(etape ?? ""), notes: "Créée depuis HubSpot." });
          crees++;
        }
      }
      if (ordre.length) await db.from("activites").update({ etapes: ordre }).eq("id", PROJET);
      bilan.hubspot = { partenaires: maj + crees, crees };
    } catch (e) { bilan.hubspot = { erreur: e instanceof Error ? e.message : String(e) }; }
  } else bilan.hubspot = "jeton manquant";

  // ---------- 2. Billetweb : billets par match à domicile ----------
  // deno-lint-ignore no-explicit-any
  type Match = { id: string; nom: string; debut: string; fin: string; lieu: string; boutique: string; places: number; payees: number; recette: number; invitations: number; scannees: number };
  const matchs: Match[] = [];
  let abonnes: number | null = null;
  if (BW) {
    try {
      const bw = async (chemin: string) => {
        const r = await fetch(`https://www.billetweb.fr/api${chemin}${chemin.includes("?") ? "&" : "?"}version=1`, { headers: { Authorization: BW } });
        if (!r.ok) throw new Error(`Billetweb ${r.status}`);
        return r.json();
      };
      // deno-lint-ignore no-explicit-any
      const evenements: any[] = await bw("/events");
      for (const e of evenements) {
        const estMatch = /hvb\s*vs/i.test(e.name ?? ""), estAbonnement = /abonnement/i.test(e.name ?? "");
        if (!estMatch && !estAbonnement) continue;
        // deno-lint-ignore no-explicit-any
        const participants: any[] = (await bw(`/event/${e.id}/attendees`)).filter((p: any) => p.disabled !== "1");
        if (estAbonnement) { abonnes = (abonnes ?? 0) + participants.length; continue; }
        const payes = participants.filter((p) => Number(p.price) > 0);
        matchs.push({
          id: String(e.id), nom: e.name, debut: String(e.start).replace(" ", "T"), fin: String(e.end || e.start).replace(" ", "T"),
          lieu: e.place ?? "", boutique: e.shop ?? "", places: participants.length, payees: payes.length,
          recette: payes.reduce((s, p) => s + Number(p.price), 0), invitations: participants.length - payes.length,
          scannees: participants.filter((p) => p.used === "1").length,
        });
      }
      matchs.sort((a, b) => a.debut.localeCompare(b.debut));
      bilan.billetweb = { matchs: matchs.length, abonnes };
    } catch (e) { bilan.billetweb = { erreur: e instanceof Error ? e.message : String(e) }; }
  } else bilan.billetweb = "clé manquante";

  // ---------- 3. Matchs -> agenda Google « Harnes Volley » ----------
  if (matchs.length) {
    try {
      const { data: ag } = await db.from("agendas").select("externe_id, comptes_agenda(*)")
        .eq("activite_id", PROJET).eq("ecriture", true).not("compte_id", "is", null).ilike("nom", "%harnes%").limit(1).maybeSingle();
      const compte = ag?.comptes_agenda as unknown as Compte | undefined;
      if (ag && compte?.fournisseur === "google") {
        const jeton = await jetonAcces(db, compte);
        const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(ag.externe_id!)}/events`;
        let ecrits = 0;
        for (const m of matchs) {
          const debut = new Date(Date.parse(m.debut + "Z")), finBillet = new Date(Date.parse(m.fin + "Z"));
          const fin = (finBillet.getTime() - debut.getTime()) > 6 * 3600000 || finBillet <= debut ? new Date(debut.getTime() + 2.5 * 3600000) : finBillet;
          const heure = (d: Date) => d.toISOString().slice(0, 19);
          const corps = {
            summary: m.nom.replace(/\s+/g, " ").trim(), location: m.lieu,
            description: `Billetterie : ${m.boutique}\nPlaces réservées : ${m.places} (dont ${m.payees} payées pour ${euros(m.recette)} et ${m.invitations} invitations).\nMis à jour automatiquement par le cockpit.`,
            start: { dateTime: heure(debut), timeZone: "Europe/Paris" }, end: { dateTime: heure(fin), timeZone: "Europe/Paris" },
          };
          const id = "hvb" + m.id; // identifiant stable : relancer la synchro met à jour le même rendez-vous
          let r = await fetch(`${base}/${id}`, { method: "PATCH", headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" }, body: JSON.stringify(corps) });
          if (r.status === 404) r = await fetch(base, { method: "POST", headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" }, body: JSON.stringify({ id, ...corps }) });
          if (r.ok) ecrits++; else bilan.agenda_erreur = `Google ${r.status} : ${(await r.text()).slice(0, 150)}`;
        }
        bilan.agenda = { matchs_inscrits: ecrits };
      } else bilan.agenda = "agenda « Harnes Volley » modifiable introuvable";
    } catch (e) { bilan.agenda = { erreur: e instanceof Error ? e.message : String(e) }; }
  }

  // ---------- 4. Chiffres du projet ----------
  const { data: partenaires } = await db.from("clients").select("etape, montant").eq("activite_id", PROJET);
  const somme = (f: (e: string) => boolean) => (partenaires ?? []).filter((c) => f(c.etape ?? "")).reduce((s, c) => s + (Number(c.montant) || 0), 0);
  const compte = (f: (e: string) => boolean) => (partenaires ?? []).filter((c) => f(c.etape ?? "")).length;
  const signe = (e: string) => /sign|factur|encaiss/i.test(e), facture = (e: string) => /factur|encaiss/i.test(e), encaisse = (e: string) => /encaiss/i.test(e);
  const prochain = matchs.find((m) => Date.parse(m.fin + "Z") > Date.now() - 3600000);
  const kpis: Record<string, unknown>[] = [
    { label: "Partenaires signés", valeur: compte(signe), unite: "", detail: `${compte((e) => !signe(e) && !/perdu/i.test(e))} en discussion` },
    { label: "Montant signé", valeur: somme(signe), unite: "€" },
    { label: "Facturé", valeur: somme(facture), unite: "€", detail: `${compte(facture)} partenaire(s)`, alerte: somme(signe) > 0 && somme(facture) === 0 },
    { label: "Encaissé", valeur: somme(encaisse), unite: "€", objectif: somme(signe) || undefined },
  ];
  if (prochain) kpis.push({ label: "Places · " + prochain.nom.replace(/^.*?HVB\s*vs\s*/i, "HVB vs ").slice(0, 40), valeur: prochain.places, unite: "",
    detail: `${new Date(Date.parse(prochain.debut + "Z")).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" })} · ${prochain.payees} payées (${euros(prochain.recette)}), ${prochain.invitations} invitations, ${prochain.scannees} scannées` });
  if (abonnes != null) kpis.push({ label: "Abonnés de la saison", valeur: abonnes, unite: "" });
  const sources = [HUBSPOT && "HubSpot", BW && "Billetweb"].filter(Boolean);
  await db.from("activites").update({ kpis, sources, mise_a_jour: new Date().toISOString() }).eq("id", PROJET);
  bilan.chiffres = kpis.length;
  return json({ ok: true, bilan });
});
