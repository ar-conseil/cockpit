-- Lien de la réunion en ligne d'un rendez-vous (Google Meet, Teams, ou lien Zoom/Webex repéré dans le lieu ou la description)
alter table public.evenements add column if not exists visio text;
