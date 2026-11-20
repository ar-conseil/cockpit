-- Tri des boîtes : chaque mail reste 14 jours dans la boîte de réception (lu et étiqueté par Victor), puis part dans son
-- dossier (demande d'Antonin, 20 novembre 2026 : il veut voir tous ses mails récents dans la réception).
--  en_reception : le mail est classé mais encore dans la réception ; ranger_le : date à partir de laquelle il est rangé.
alter table public.tri_mails add column if not exists en_reception boolean not null default false;
alter table public.tri_mails add column if not exists ranger_le timestamptz;
create index if not exists tri_mails_a_ranger on public.tri_mails (boite, ranger_le) where en_reception;

-- Références déjà dans le journal (pour ne pas reclasser un mail resté en réception). Par fonction : la liste part dans
-- le corps de la demande, sans limite de longueur d'adresse.
create or replace function public.tri_connus(b text, refs text[])
returns table (message_id text, dossier text, en_reception boolean)
language sql stable set search_path = public as $$
  select t.message_id, t.dossier, t.en_reception from public.tri_mails t where t.boite = b and t.message_id = any(refs)
$$;
-- Marque des mails comme restés en réception (jusqu'à « jusqu ») ou comme rangés.
create or replace function public.tri_marquer(b text, refs text[], reception boolean, jusqu timestamptz default null)
returns integer language sql set search_path = public as $$
  with m as (update public.tri_mails t set en_reception = reception, ranger_le = case when reception then jusqu else null end
             where t.boite = b and t.message_id = any(refs) returning 1)
  select count(*)::int from m
$$;
revoke all on function public.tri_connus(text, text[]) from public, anon, authenticated;
revoke all on function public.tri_marquer(text, text[], boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.tri_connus(text, text[]) to service_role;
grant execute on function public.tri_marquer(text, text[], boolean, timestamptz) to service_role;
