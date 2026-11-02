-- Recommandations (parrainage) : les personnes qu'un client recommande, notées à chaque rendez-vous (Evoa Courtage).
create table public.recommandations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  activite_id text references public.activites(id) on delete cascade,
  nom text not null,
  contact text,                      -- téléphone ou e-mail
  lien text,                         -- collègue, ami, famille…
  besoin text,                       -- prévoyance, IARD, épargne…
  recue_le date not null default current_date,
  statut text not null default 'a-appeler' check (statut in ('a-appeler','contacte','rdv-pris','devenu-client','sans-suite')),
  notes text,
  cree_le timestamptz not null default now()
);
create index recommandations_client on public.recommandations (client_id);
alter table public.recommandations enable row level security;
create policy recommandations_proprietaire on public.recommandations for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.recommandations to authenticated, service_role;
alter publication supabase_realtime add table public.recommandations;
update public.activites set reglages = coalesce(reglages, '{}'::jsonb) || '{"recommandations": true}'::jsonb where id = 'evoa-courtage';
