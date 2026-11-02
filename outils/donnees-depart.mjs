// Transforme les données de départ privées (.donnees/depart.mjs, jamais commité) en JSON ou en SQL pour Supabase.
// Ce fichier ne contient aucune donnée : le dépôt est public.
// Usage : node outils/donnees-depart.mjs <dossier-taches-ancien> > depart.json
//         node outils/donnees-depart.mjs <dossier-taches-ancien> --sql > depart.sql
import { existsSync } from "node:fs";

const source = new URL("../.donnees/depart.mjs", import.meta.url);
if (!existsSync(source)) {
  process.stderr.write("Données privées introuvables : .donnees/depart.mjs (gardé hors du dépôt).\n");
  process.exit(1);
}
const { depart, reprisesAncien } = await import(source.href);
const { activites, clients, taches, semaine_type, factures } = depart;

if (!process.argv.includes("--sql")) { process.stdout.write(JSON.stringify(depart, null, 2)); process.exit(0); }

// SQL : une insertion par table depuis un bloc JSON (on vide d'abord les tables de départ).
const bloc = (table, lignes) =>
  `insert into public.${table} select * from jsonb_populate_recordset(null::public.${table}, $json$${JSON.stringify(lignes)}$json$);`;
const maintenant = new Date().toISOString();
const sql = [
  "begin;",
  "delete from public.factures; delete from public.suivis; delete from public.taches; delete from public.clients; delete from public.semaine_type;",
  "delete from public.activites where id not in (" + activites.map((a) => `'${a.id}'`).join(",") + ");",
  `insert into public.activites (id, nom, description, couleur, ordre, cible_heures, mots_cles, kpis, serie, etapes, reglages, liens, notes, sources, mise_a_jour)
   select id, nom, description, couleur, ordre, cible_heures, mots_cles, kpis, serie, etapes, reglages, liens, notes, sources, mise_a_jour
   from jsonb_populate_recordset(null::public.activites, $json$${JSON.stringify(activites)}$json$)
   on conflict (id) do update set nom = excluded.nom, description = excluded.description, couleur = excluded.couleur, ordre = excluded.ordre,
     cible_heures = excluded.cible_heures, mots_cles = excluded.mots_cles, kpis = excluded.kpis, serie = excluded.serie, etapes = excluded.etapes, reglages = excluded.reglages,
     liens = excluded.liens, notes = excluded.notes, sources = excluded.sources, mise_a_jour = excluded.mise_a_jour;`,
  bloc("clients", clients.map((c) => ({ ...c, cree_le: maintenant, modifie_le: maintenant }))),
  bloc("taches", taches.map((t) => ({ ...t, cree_le: maintenant, fait_le: null }))),
  bloc("semaine_type", semaine_type),
  bloc("factures", factures.map((f) => ({ ...f, cree_le: maintenant }))),
  "commit;",
].join("\n");
process.stdout.write(sql + "\n");
process.stderr.write(`${activites.length} activités, ${clients.length} clients, ${taches.length} tâches (dont ${reprisesAncien} reprises de l'ancien cockpit), ${semaine_type.length} blocs de semaine type, ${factures.length} facture(s)\n`);
