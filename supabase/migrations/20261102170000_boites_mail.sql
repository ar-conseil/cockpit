-- Boîtes mail lues par Victor (lecture seule) : un compte Google ou Microsoft peut être connecté pour ses agendas
-- (usage « agenda ») ou pour ses mails (usage « mail »), avec des autorisations différentes.
alter table public.comptes_agenda add column usage text not null default 'agenda' check (usage in ('agenda','mail'));
alter table public.comptes_agenda drop constraint comptes_agenda_fournisseur_email_key;
alter table public.comptes_agenda add constraint comptes_agenda_fournisseur_email_usage_key unique (fournisseur, email, usage);
grant select (usage) on public.comptes_agenda to authenticated;
