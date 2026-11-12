-- Wispr Flow -> Victor, en ligne (sans le Mac) : les notes vocales Wispr qui commencent par « Victor » sont lues
-- sur le serveur MCP de Wispr (lecture seule) et confiées à l'assistant. Jetons et notes vues : clé de service seulement.
create table if not exists public.wispr_connexion (
  id smallint primary key default 1 check (id = 1),     -- un seul compte Wispr (celui d'Antonin)
  acces text, renouvellement text, expire timestamptz,
  connecte_le timestamptz, derniere_synchro timestamptz, erreur text
);
alter table public.wispr_connexion enable row level security;

create table if not exists public.wispr_attente (     -- connexion OAuth en cours (PKCE), gardée 15 minutes
  etat text primary key, verificateur text not null, cree_le timestamptz not null default now()
);
alter table public.wispr_attente enable row level security;

create table if not exists public.wispr_vues (         -- notes Wispr déjà examinées (pour Victor ou non)
  reference text primary key, pour_victor boolean not null default false, resultat text, vue_le timestamptz not null default now()
);
alter table public.wispr_vues enable row level security;

-- État affiché dans le cockpit (sans les jetons)
create or replace function public.wispr_etat() returns json language sql security definer set search_path = public as $$
  select json_build_object('connecte', exists(select 1 from wispr_connexion where renouvellement is not null),
    'connecte_le', (select connecte_le from wispr_connexion), 'derniere_synchro', (select derniere_synchro from wispr_connexion),
    'erreur', (select erreur from wispr_connexion),
    'recues', (select count(*) from wispr_vues where pour_victor and vue_le > now() - interval '7 days'))
$$;
revoke all on function public.wispr_etat() from public, anon;
grant execute on function public.wispr_etat() to authenticated;
