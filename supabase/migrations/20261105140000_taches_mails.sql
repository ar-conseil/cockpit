-- Tâche née d'un mail « À faire » (libellé Gmail posé par le tri) : la boîte et le fil Gmail, et si le libellé est encore posé.
-- Tâche terminée dans le cockpit -> le tri retire le libellé ; libellé retiré dans Gmail -> la tâche passe à « fait ».
alter table public.taches add column if not exists mail_boite text;
alter table public.taches add column if not exists mail_fil text;
alter table public.taches add column if not exists mail_a_faire boolean not null default false;
create index if not exists taches_mail on public.taches (mail_boite, mail_fil) where mail_fil is not null;
