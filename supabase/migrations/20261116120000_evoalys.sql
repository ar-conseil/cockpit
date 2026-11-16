-- Tâches Evoa synchronisées avec Evoalys (logiciel du cabinet) : identifiant distant, état « fait » au dernier passage, lien.
alter table public.taches add column if not exists externe text unique;          -- « evoalys:<id> »
alter table public.taches add column if not exists externe_fait boolean;          -- fait côté Evoalys au dernier passage
alter table public.taches add column if not exists lien text;                     -- page Evoalys de la tâche (fiche client)
create table if not exists public.evoalys_sync (
  id smallint primary key default 1 check (id = 1), depuis timestamptz not null default now(), dernier timestamptz, erreur text
);
alter table public.evoalys_sync enable row level security;
create policy evoalys_sync_lecture on public.evoalys_sync for select to authenticated using (true);
