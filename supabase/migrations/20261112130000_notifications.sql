-- Notifications sur le téléphone (Web Push vers l'appli Victor installée sur l'écran d'accueil) : un abonnement par appareil.
create table if not exists public.push_abonnements (
  endpoint text primary key,
  abonnement jsonb not null,          -- { endpoint, keys: { p256dh, auth } } donné par le navigateur
  appareil text,
  cree_le timestamptz not null default now()
);
alter table public.push_abonnements enable row level security;
create policy push_proprietaire on public.push_abonnements for all to authenticated using (true) with check (true);
