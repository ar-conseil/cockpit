-- Production Evoa : un associé peut toucher une part (ex. 15 %) de la commission d'Antonin sur un dossier fait avec lui.
-- La liste des associés et leur taux habituel sont dans activites.reglages.associes (hors dépôt).
alter table public.production add column associe text, add column taux_associe numeric;
alter table public.production add column part_associe numeric generated always as
  ((coalesce(pp,0)+coalesce(pu_uc,0)+coalesce(pu_fe,0)+coalesce(structure,0)+coalesce(iard,0)) * coalesce(taux,0) * (1 - taux_acp) * 0.8 * coalesce(taux_associe,0)) stored;
