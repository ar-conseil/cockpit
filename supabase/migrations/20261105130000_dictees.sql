-- Journal des dictées de l'iPhone (fonction ajouter-tache) : permet « annule la dernière » et limite les modifications
-- et suppressions de rendez-vous à ceux que Victor a lui-même créés (jamais une invitation reçue).
create table if not exists public.dictees (
  id uuid primary key default gen_random_uuid(),
  cree_le timestamptz not null default now(),
  phrase text not null,
  action text not null,                    -- creer, modifier, supprimer, terminer, annuler
  resultat text,                           -- réponse renvoyée au téléphone
  tache_id uuid references public.taches(id) on delete set null,
  evenement_id uuid references public.evenements(id) on delete set null,
  agenda_id uuid references public.agendas(id) on delete set null,
  evenement_externe text,                  -- identifiant chez Google ou Microsoft (retrouve le rendez-vous après une synchro)
  evenement_titre text,
  annulee boolean not null default false
);
create index if not exists dictees_recentes on public.dictees (cree_le desc);
alter table public.dictees enable row level security;
drop policy if exists "proprietaire" on public.dictees;
create policy "proprietaire" on public.dictees for select to authenticated using (true);
grant select on public.dictees to authenticated;
grant all on public.dictees to service_role;
