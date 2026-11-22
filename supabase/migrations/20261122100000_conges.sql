-- Mode congé : réponse d'absence posée sur chaque boîte (Gmail et Outlook : réglage natif ; Harnes : réponse
-- envoyée par la fonction `conge`, une seule par expéditeur), journée « Congé » posée dans l'agenda.
create table if not exists public.conges (
  id uuid primary key default gen_random_uuid(),
  du date not null,                         -- premier jour de congé
  au date not null,                         -- dernier jour de congé (inclus)
  message text not null,                    -- texte de la réponse, sans signature (celle de chaque boîte est ajoutée)
  boites text[] not null default '{}',      -- boîtes choisies
  etat jsonb not null default '{}',         -- {boite: {ok, mode, erreur}}
  evenement_id uuid,                        -- journée « Congé » posée dans l'agenda
  actif boolean not null default true,
  cree_le timestamptz not null default now(),
  arrete_le timestamptz
);
create table if not exists public.conge_reponses (  -- Harnes : expéditeurs déjà prévenus pendant ce congé
  conge_id uuid not null references public.conges on delete cascade,
  boite text not null,
  expediteur text not null,
  repondu_le timestamptz not null default now(),
  primary key (conge_id, boite, expediteur)
);
alter table public.conges enable row level security;
alter table public.conge_reponses enable row level security;
create policy "proprietaire" on public.conges for all to authenticated using (true) with check (true);
create policy "proprietaire" on public.conge_reponses for select to authenticated using (true);
alter publication supabase_realtime add table public.conges;

-- Harnes : les mails reçus pendant le congé reçoivent la réponse (toutes les 10 minutes, seulement si un congé est en cours)
select cron.schedule('conge', '*/10 * * * *', $$
  select net.http_post(url := 'https://piuqaqjdegkwwhlwputf.supabase.co/functions/v1/conge',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cle-synchro', (select decrypted_secret from vault.decrypted_secrets where name = 'cle_synchro')),
    body := '{"veille": true}'::jsonb, timeout_milliseconds := 60000)
  where exists (select 1 from public.conges where actif and au >= (now() at time zone 'Europe/Paris')::date - 1)
$$);
