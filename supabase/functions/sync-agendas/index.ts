// Synchronise tous les agendas actifs vers la table evenements (7 jours en arrière, 60 jours en avant) :
//  - comptes Google / Microsoft connectés : lecture par l'API, rendez-vous modifiables depuis le cockpit ;
//  - adresses iCal secrètes : lecture seule.
// Appelée chaque minute par pg_cron (en-tête x-cle-synchro) ou par le bouton « En direct » du cockpit
// (jeton de l'utilisateur connecté). Déployée avec --no-verify-jwt : le contrôle est fait ici.
import ICAL from "npm:ical.js@2.1.0";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { extraireOccurrences } from "./ical.ts";
import { jetonAcces, lireRdv, listerAgendas, projetParDefaut, type Compte } from "../_partage/fournisseurs.ts";

const URL = Deno.env.get("SUPABASE_URL")!;
const CLE_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLE_SYNCHRO = Deno.env.get("CLE_SYNCHRO") ?? "";
const JOUR = 86400000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cle-synchro",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(URL, CLE_SERVICE, { auth: { persistSession: false } });

  const parCron = CLE_SYNCHRO && req.headers.get("x-cle-synchro") === CLE_SYNCHRO;
  if (!parCron) {
    const jeton = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data } = jeton ? await db.auth.getUser(jeton) : { data: { user: null } };
    if (!data?.user) return json({ erreur: "non autorisé" }, 401);
  }

  // Liste des agendas de chaque compte connecté : à la première synchro, puis tous les quarts d'heure,
  // pour qu'un agenda créé dans Google ou Outlook (ex. « Harnes Volley ») apparaisse tout seul.
  const { data: comptes } = await db.from("comptes_agenda").select("*, agendas(id)").eq("usage", "agenda");
  const corps = await req.json().catch(() => ({}));
  const quartDHeure = new Date().getMinutes() % 15 === 0 || corps.lister === true; // { "lister": true } force la relecture
  for (const c of comptes ?? []) {
    if ((c.agendas ?? []).length && !quartDHeure) continue;
    try {
      const liste = await listerAgendas(c as Compte, await jetonAcces(db, c as Compte));
      for (const a of liste) {
        await db.from("agendas").upsert({ compte_id: c.id, externe_id: a.externe_id, nom: a.nom, ecriture: a.ecriture, actif: a.actif,
          activite_id: projetParDefaut(a.nom, a.principal ? c.email : "") }, { onConflict: "compte_id,externe_id", ignoreDuplicates: true });
        // Les droits peuvent changer dans Google ou Outlook (partage modifié) : on les relit à chaque fois.
        await db.from("agendas").update({ ecriture: a.ecriture }).eq("compte_id", c.id).eq("externe_id", a.externe_id);
      }
    } catch (e) {
      await db.from("comptes_agenda").update({ derniere_erreur: (e instanceof Error ? e.message : String(e)).slice(0, 300) }).eq("id", c.id);
    }
  }

  const { data: activites } = await db.from("activites").select("id, mots_cles");
  const { data: agendas, error } = await db.from("agendas")
    .select("id, nom, activite_id, ics_url, externe_id, ecriture, compte_id, comptes_agenda(*)").eq("actif", true);
  if (error) return json({ erreur: error.message }, 500);

  const maintenant = new Date();
  const debut = new Date(maintenant.getTime() - 7 * JOUR), fin = new Date(maintenant.getTime() + 60 * JOUR);
  // Un agenda rangé dans un projet (Famille -> Perso, Palomano -> Palomano) l'emporte ; sinon, les mots-clés décident.
  const classer = (titre: string | null, lieu: string | null, defaut: string | null) => {
    if (defaut) return defaut;
    const texte = `${titre ?? ""} ${lieu ?? ""}`.toLowerCase();
    for (const a of activites ?? []) {
      if ((a.mots_cles ?? []).some((m: string) => m && texte.includes(m.toLowerCase()))) return a.id;
    }
    return defaut;
  };

  const bilan: Record<string, unknown>[] = [];
  for (const ag of agendas ?? []) {
    const marque = new Date().toISOString();
    try {
      let lignes: Record<string, unknown>[];
      if (ag.compte_id) {
        const compte = ag.comptes_agenda as unknown as Compte;
        const rdv = await lireRdv(compte, await jetonAcces(db, compte), ag.externe_id!, debut, fin);
        lignes = rdv.map((o) => ({
          agenda_id: ag.id, uid: o.externe_id, externe_id: o.externe_id, debut: o.debut, fin: o.fin, journee: o.journee,
          titre: o.titre, lieu: o.lieu, description: o.description, modifiable: !!ag.ecriture, serie: o.serie,
          activite_id: classer(o.titre, o.lieu, ag.activite_id), annule: false, vu_le: marque,
        }));
      } else {
        const url = String(ag.ics_url).replace(/^webcal:/i, "https:");
        const r = await fetch(url, { headers: { "User-Agent": "Cockpit AR Conseil" } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        lignes = extraireOccurrences(ICAL, await r.text(), debut, fin).map((o) => ({
          agenda_id: ag.id, uid: o.uid, debut: o.debut, fin: o.fin, journee: o.journee,
          titre: o.titre, lieu: o.lieu, description: o.description, modifiable: false,
          activite_id: classer(o.titre, o.lieu, ag.activite_id), annule: false, vu_le: marque,
        }));
      }
      for (let i = 0; i < lignes.length; i += 500) {
        const { error: e } = await db.from("evenements").upsert(lignes.slice(i, i + 500), { onConflict: "agenda_id,uid,debut" });
        if (e) throw new Error(e.message);
      }
      // Rendez-vous supprimés ou déplacés dans l'agenda d'origine : ils n'ont pas été revus.
      await db.from("evenements").delete().eq("agenda_id", ag.id)
        .gte("debut", debut.toISOString()).lte("debut", fin.toISOString()).lt("vu_le", marque);
      await db.from("agendas").update({ derniere_synchro: marque, derniere_erreur: null, nb_evenements: lignes.length }).eq("id", ag.id);
      bilan.push({ agenda: ag.nom, evenements: lignes.length });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await db.from("agendas").update({ derniere_erreur: message.slice(0, 300) }).eq("id", ag.id);
      if (ag.compte_id) await db.from("comptes_agenda").update({ derniere_erreur: message.slice(0, 300) }).eq("id", ag.compte_id);
      bilan.push({ agenda: ag.nom, erreur: message });
    }
  }
  return json({ ok: true, le: maintenant.toISOString(), bilan });
});
