-- Réponses dictées à Victor (mail, SMS, WhatsApp) : brouillon à valider, puis journal de ce qui est parti.
-- Mail : brouillon déposé dans la boîte (Gmail ou Outlook), envoyé seulement quand Antonin le valide (fonction reponses).
-- SMS et WhatsApp : texte préparé, ouvert sur l'iPhone ; Antonin choisit le destinataire et envoie lui-même.
create table if not exists public.reponses (
  id uuid primary key default gen_random_uuid(),
  cree_le timestamptz not null default now(),
  canal text not null check (canal in ('mail','sms','whatsapp')),
  consigne text not null,                   -- ce qu'Antonin a dicté
  destinataire text,                        -- adresse (mail) ou nom dit (SMS, WhatsApp)
  boite text,                               -- adresse d'envoi (mail)
  fournisseur text,                         -- google ou microsoft (mail)
  objet text,
  texte text not null,                      -- réponse rédigée par Victor (modifiable avant l'envoi)
  original_de text, original_objet text, original_extrait text, original_recu_le timestamptz,
  mail_id text, fil_id text, brouillon_id text,
  statut text not null default 'brouillon' check (statut in ('brouillon','envoye','abandonne','ouvert')),
  envoye_le timestamptz,
  erreur text
);
create index if not exists reponses_recentes on public.reponses (cree_le desc);
alter table public.reponses enable row level security;
drop policy if exists "proprietaire" on public.reponses;
create policy "proprietaire" on public.reponses for select to authenticated using (true);
grant select on public.reponses to authenticated;
grant all on public.reponses to service_role;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'reponses') then
    alter publication supabase_realtime add table public.reponses;
  end if;
end $$;
