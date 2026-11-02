-- Cockpit AR Conseil : activités, agendas synchronisés, tâches, clients, suivis, semaine type.
-- Un seul utilisateur : les inscriptions sont fermées (config.toml), donc « authenticated » = Antonin.
-- Les agents passent par service_role.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------- Activités ----------
create table public.activites (
  id text primary key,                      -- sert d'adresse : #palomano
  nom text not null,
  description text,
  couleur text not null default '#c9a24b',
  ordre smallint not null default 0,
  cible_heures numeric,                     -- heures par semaine visées
  mots_cles text[] not null default '{}',   -- classement automatique des rendez-vous
  kpis jsonb not null default '[]',         -- [{label, valeur, unite, precedent, objectif, detail, alerte}]
  serie jsonb,                              -- {titre, unite, points:[{label, valeur}]}
  etapes text[] not null default '{}',      -- étapes du pipeline clients, dans l'ordre
  reglages jsonb not null default '{}',     -- colonnes propres au projet : {libelle_montant, champs:[{cle,label,type,somme,taux}], total:{label,de:[]}, etapes_gagnees:[]}
  liens jsonb not null default '[]',        -- [{label, url}]
  notes text,
  sources text[] not null default '{}',
  mise_a_jour timestamptz not null default now()
);

-- ---------- Comptes d'agenda connectés (Google, Microsoft) : lecture et écriture des rendez-vous ----------
create table public.comptes_agenda (
  id uuid primary key default gen_random_uuid(),
  fournisseur text not null check (fournisseur in ('google','microsoft')),
  email text not null,
  refresh_token text,                       -- jamais lisible par le navigateur
  jeton_acces text,
  jeton_expire_le timestamptz,
  derniere_erreur text,
  cree_le timestamptz not null default now(),
  unique (fournisseur, email)
);

-- ---------- Agendas : soit un compte connecté (lecture + écriture), soit une adresse iCal (lecture seule) ----------
create table public.agendas (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  activite_id text references public.activites(id) on delete set null,  -- activité par défaut
  compte_id uuid references public.comptes_agenda(id) on delete cascade,
  externe_id text,                          -- identifiant de l'agenda chez Google ou Microsoft
  ecriture boolean not null default false,  -- le cockpit peut créer, modifier et supprimer des rendez-vous
  ics_url text,                             -- adresse secrète : jamais lue par le navigateur
  actif boolean not null default true,
  derniere_synchro timestamptz,
  derniere_erreur text,
  nb_evenements int,
  unique (compte_id, externe_id),
  check (compte_id is not null or ics_url is not null)
);

create table public.evenements (
  id uuid primary key default gen_random_uuid(),
  agenda_id uuid not null references public.agendas(id) on delete cascade,
  uid text not null,
  debut timestamptz not null,
  fin timestamptz not null,
  journee boolean not null default false,
  titre text,
  lieu text,
  description text,
  activite_id text references public.activites(id) on delete set null,   -- classement automatique
  activite_forcee text references public.activites(id) on delete set null, -- reclassé à la main
  annule boolean not null default false,
  externe_id text,                          -- identifiant du rendez-vous (ou de l'occurrence) chez Google ou Microsoft
  modifiable boolean not null default false,
  serie boolean not null default false,     -- occurrence d'un rendez-vous récurrent
  vu_le timestamptz not null default now(),
  unique (agenda_id, uid, debut)
);
create index evenements_debut on public.evenements (debut);

-- ---------- Clients, suivis, tâches ----------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  activite_id text not null references public.activites(id) on delete cascade,
  nom text not null,
  type text not null default 'prospect' check (type in ('prospect','client','partenaire','fournisseur','autre')),
  etape text,                               -- une des activites.etapes
  montant numeric,
  donnees jsonb not null default '{}',      -- valeurs des colonnes propres au projet (activites.reglages.champs)
  contact text,                             -- nom de la personne, téléphone ou e-mail
  notes text,
  prochaine_action text,
  prochaine_action_le date,
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now()
);
create index clients_activite on public.clients (activite_id);

create table public.suivis (
  id uuid primary key default gen_random_uuid(),
  activite_id text not null references public.activites(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  le timestamptz not null default now(),
  type text not null default 'note' check (type in ('appel','mail','rdv','note','relance','devis','signature')),
  contenu text not null
);
create index suivis_client on public.suivis (client_id, le desc);

create table public.taches (
  id uuid primary key default gen_random_uuid(),
  activite_id text not null references public.activites(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  titre text not null,
  notes text,
  echeance date,
  priorite text not null default 'moyenne' check (priorite in ('haute','moyenne','basse')),
  statut text not null default 'a-faire' check (statut in ('a-faire','en-cours','bloque','fait')),
  cree_le timestamptz not null default now(),
  fait_le timestamptz
);
create index taches_ouvertes on public.taches (echeance) where statut <> 'fait';

-- ---------- Factures (Berkay, Wealthy, Evoa…) ----------
create table public.factures (
  id uuid primary key default gen_random_uuid(),
  activite_id text not null references public.activites(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  numero text,
  objet text not null,
  destinataire text,
  emise_le date,
  echeance date,
  montant_ht numeric,
  tva numeric not null default 0,           -- taux en % (0 : TVA non applicable, art. 293 B du CGI)
  montant_ttc numeric,
  statut text not null default 'a-emettre' check (statut in ('a-emettre','emise','payee','annulee')),
  payee_le date,
  notes text,
  cree_le timestamptz not null default now()
);
create index factures_activite on public.factures (activite_id, emise_le desc);

-- ---------- Semaine type (blocs de travail par jour) ----------
create table public.semaine_type (
  id uuid primary key default gen_random_uuid(),
  jour smallint not null check (jour between 0 and 6),   -- 0 = dimanche
  debut numeric not null,                                -- heures décimales : 9.5 = 9h30
  fin numeric not null,
  activite_id text references public.activites(id) on delete cascade,
  libelle text not null
);

-- ---------- Horodatages ----------
create function public.toucher() returns trigger language plpgsql as $$
begin
  if tg_table_name = 'clients' then new.modifie_le := now(); end if;
  if tg_table_name = 'taches' then
    new.fait_le := case when new.statut = 'fait' then coalesce(new.fait_le, now()) else null end;
  end if;
  return new;
end $$;
create trigger clients_toucher before update on public.clients for each row execute function public.toucher();
create trigger taches_toucher before insert or update on public.taches for each row execute function public.toucher();

-- ---------- Droits ----------
alter table public.activites enable row level security;
alter table public.comptes_agenda enable row level security;
alter table public.agendas enable row level security;
alter table public.evenements enable row level security;
alter table public.clients enable row level security;
alter table public.suivis enable row level security;
alter table public.taches enable row level security;
alter table public.semaine_type enable row level security;
alter table public.factures enable row level security;

create policy "proprietaire" on public.activites for all to authenticated using (true) with check (true);
create policy "proprietaire" on public.comptes_agenda for all to authenticated using (true) with check (true);
create policy "proprietaire" on public.agendas for all to authenticated using (true) with check (true);
create policy "proprietaire" on public.evenements for all to authenticated using (true) with check (true);
create policy "proprietaire" on public.clients for all to authenticated using (true) with check (true);
create policy "proprietaire" on public.suivis for all to authenticated using (true) with check (true);
create policy "proprietaire" on public.taches for all to authenticated using (true) with check (true);
create policy "proprietaire" on public.semaine_type for all to authenticated using (true) with check (true);
create policy "proprietaire" on public.factures for all to authenticated using (true) with check (true);

revoke all on all tables in schema public from anon;
grant select, insert, update, delete on public.activites, public.clients, public.suivis, public.taches, public.semaine_type, public.factures to authenticated;
grant select, update (activite_forcee) on public.evenements to authenticated;
-- l'adresse iCal reste côté serveur : le navigateur voit tout sauf ics_url
grant select (id, nom, activite_id, compte_id, ecriture, actif, derniere_synchro, derniere_erreur, nb_evenements) on public.agendas to authenticated;
-- comptes connectés : le navigateur voit l'adresse et l'état, jamais les jetons ; il peut déconnecter un compte
grant select (id, fournisseur, email, derniere_erreur, cree_le) on public.comptes_agenda to authenticated;
grant delete on public.comptes_agenda to authenticated;
grant update (nom, activite_id, actif) on public.agendas to authenticated;
grant all on all tables in schema public to service_role;

-- ---------- Temps réel : la page se met à jour sans recharger ----------
alter publication supabase_realtime add table public.evenements, public.taches, public.clients, public.suivis, public.activites, public.factures;
