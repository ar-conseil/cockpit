-- Colonnes des tâches façon Notion : Tâches, En cours, En révision, Terminé (« Bloqué » devient « En révision »).
alter table public.taches drop constraint taches_statut_check;
update public.taches set statut = 'en-revision' where statut = 'bloque';
alter table public.taches add constraint taches_statut_check check (statut in ('a-faire','en-cours','en-revision','fait'));
