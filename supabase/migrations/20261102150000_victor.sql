-- Victor, l'assistant du matin : briefing du jour et tâches proposées à partir des mails.
create table public.briefings (
  jour date primary key,
  resume text,
  priorites jsonb not null default '[]',   -- [{ titre, activite_id, pourquoi }]
  mails jsonb not null default '[]',       -- [{ boite, de, objet, resume, action }]
  planning jsonb not null default '[]',    -- [{ debut: "08:30", fin: "10:30", titre, type: rdv|orias|tache, activite_id }]
  orias_minutes int not null default 0,
  cree_le timestamptz not null default now(),
  mise_a_jour timestamptz not null default now()
);
create table public.propositions (
  id uuid primary key default gen_random_uuid(),
  cle text not null unique,                -- identifiant du mail source : jamais proposé deux fois
  activite_id text references public.activites(id) on delete set null,
  titre text not null,
  notes text,
  echeance date,
  priorite text not null default 'moyenne' check (priorite in ('haute','moyenne','basse')),
  source jsonb not null default '{}',      -- { boite, de, objet, recu_le }
  statut text not null default 'proposee' check (statut in ('proposee','acceptee','ecartee')),
  cree_le timestamptz not null default now(),
  traitee_le timestamptz
);
create index propositions_ouvertes on public.propositions (cree_le) where statut = 'proposee';

alter table public.briefings enable row level security;
alter table public.propositions enable row level security;
create policy briefings_proprietaire on public.briefings for all to authenticated using (true) with check (true);
create policy propositions_proprietaire on public.propositions for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.briefings, public.propositions to authenticated, service_role;
alter publication supabase_realtime add table public.briefings, public.propositions;
