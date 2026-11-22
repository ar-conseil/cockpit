-- Signatures modifiables dans le cockpit (Réglages › Signatures), comme la page Signature d'Evoalys :
-- les informations de chaque boîte (nom, fonction, téléphone, photo, avis Google, marque, lignes, mentions) en JSON ;
-- le cockpit en tire la version mise en forme (html) et la version texte, que Victor ajoute à ce qu'il rédige.
alter table public.signatures add column if not exists infos jsonb;

-- Photos et cartes en image (version Outlook) déposées depuis le cockpit dans le stockage public « signatures ».
-- Chaque dépôt a un nom unique : rien n'est remplacé ni effacé (une signature déjà collée dans Outlook garde son image).
drop policy if exists signatures_depot on storage.objects;
create policy signatures_depot on storage.objects for insert to authenticated with check (bucket_id = 'signatures');
