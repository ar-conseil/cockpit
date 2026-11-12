-- Signature de chaque boîte mail : ajoutée par Victor à ce qu'il rédige depuis cette boîte (brouillons de réponse, invitations).
-- Modifiable dans le cockpit (page Tri des boîtes). Les signatures elles-mêmes sont en base, pas dans le dépôt.
create table if not exists public.signatures (
  boite text primary key,             -- adresse de la boîte
  texte text not null,
  mis_a_jour timestamptz not null default now()
);
alter table public.signatures enable row level security;
create policy signatures_proprietaire on public.signatures for all to authenticated using (true) with check (true);
