-- Production d'Evoa Courtage (= sa facturation) : une ligne par contrat, au format du « TABLEAU DE PROD ».
-- Montants calculés comme dans le tableau Excel :
--   COM CAB = (PP + PU UC + PU FE + Structure + IARD) × Taux ; ACP = COM CAB × Taux ACP ;
--   Commercial = (COM CAB − ACP) × 80 % ; EVOA = (COM CAB − ACP) × 20 %.
create table public.production (
  id uuid primary key default gen_random_uuid(),
  activite_id text not null default 'evoa-courtage' references public.activites(id) on delete cascade,
  annee int not null,
  mois int not null check (mois between 1 and 12),
  client text,
  compagnie text,
  risque text,
  pp numeric, pu_uc numeric, pu_fe numeric, structure numeric, iard numeric,
  taux numeric,
  taux_acp numeric not null default 0.1,
  com_cab numeric generated always as ((coalesce(pp,0) + coalesce(pu_uc,0) + coalesce(pu_fe,0) + coalesce(structure,0) + coalesce(iard,0)) * coalesce(taux,0)) stored,
  acp numeric generated always as ((coalesce(pp,0) + coalesce(pu_uc,0) + coalesce(pu_fe,0) + coalesce(structure,0) + coalesce(iard,0)) * coalesce(taux,0) * taux_acp) stored,
  commercial numeric generated always as ((coalesce(pp,0) + coalesce(pu_uc,0) + coalesce(pu_fe,0) + coalesce(structure,0) + coalesce(iard,0)) * coalesce(taux,0) * (1 - taux_acp) * 0.8) stored,
  evoa numeric generated always as ((coalesce(pp,0) + coalesce(pu_uc,0) + coalesce(pu_fe,0) + coalesce(structure,0) + coalesce(iard,0)) * coalesce(taux,0) * (1 - taux_acp) * 0.2) stored,
  contrat text,
  date_effet date,
  notes text,
  cree_le timestamptz not null default now()
);
create index production_periode on public.production (activite_id, annee, mois);
alter table public.production enable row level security;
create policy production_proprietaire on public.production for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.production to authenticated, service_role;
alter publication supabase_realtime add table public.production;
update public.activites set reglages = coalesce(reglages, '{}'::jsonb) || '{"production": true}'::jsonb where id = 'evoa-courtage';
