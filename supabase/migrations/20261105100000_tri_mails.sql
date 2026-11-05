-- Tri des boîtes mail par Victor : chaque matin, une fois le point du jour publié, les mails de la réception sont
-- rangés dans un dossier par thème, marqués comme lus, et les publicités mises à la corbeille (récupérables 30 jours).
-- droits : autorisations accordées à la connexion (le tri demande gmail.modify ou Mail.ReadWrite).
alter table public.comptes_agenda add column if not exists droits text;
grant select (droits) on public.comptes_agenda to authenticated;

-- Journal du tri : ce que Victor a rangé ou jeté, pour l'afficher dans le cockpit (gardé 60 jours).
create table if not exists public.tri_mails (
  id bigint generated always as identity primary key,
  boite text not null,
  message_id text not null,
  de text,
  objet text,
  recu_le timestamptz,
  dossier text not null,          -- nom du dossier, ou « Corbeille »
  important boolean not null default false,
  resume text,
  trie_le timestamptz not null default now(),
  unique (boite, message_id)
);
create index if not exists tri_mails_trie_le on public.tri_mails (trie_le desc);
alter table public.tri_mails enable row level security;
create policy tri_mails_proprietaire on public.tri_mails for all to authenticated using (true) with check (true);
