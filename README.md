# Cockpit

Mon poste de pilotage : la journée en direct (tous mes agendas réunis) et mes quatre projets côte à côte,
puis une page par projet avec ses tâches, ses clients, ses suivis et ses chiffres.

| Page | Adresse | Touche |
|---|---|---|
| Aujourd'hui | `/` | 0 |
| Palomano | `/#palomano` | 1 |
| Evoa Courtage | `/#evoa-courtage` | 2 |
| Harnes Volley | `/#harnes-volley` | 3 |
| Camp Rouzier Maréchal | `/#camp-rouzier-marechal` | 4 |
| Berkay (apport d'affaires immobilier) | `/#berkay` | 5 |
| Wealthy · Perso | `/#perso` | 6 |

Autres raccourcis : **N** nouvelle tâche, **←/→** jour précédent ou suivant, **T** revenir à aujourd'hui.

## Comment ça marche

- **Supabase** garde tout : projets, tâches, clients, suivis, semaine type et rendez-vous. Connexion par e-mail et
  mot de passe ; personne d'autre ne peut s'inscrire.
- **Agendas** : chaque agenda (Google, Outlook Palomano, Outlook Evoa…) est relu par son adresse iCal secrète toutes
  les 5 minutes. Chaque rendez-vous est rangé dans un projet (mots-clés ou agenda d'origine) ; un clic dessus permet
  de le reclasser. Lecture seule : les rendez-vous se créent dans Google ou Outlook.
- **Temps réel** : une tâche cochée, un rendez-vous synchronisé ou un chiffre mis à jour apparaît sans recharger.
- **Colonnes propres à un projet** : Berkay a un tableau d'affaires comme dans Excel (prix du bien, commission sur
  la vente, part des frais Berkay, total). Une commission laissée vide est calculée avec le taux du projet
  (1,5 % et 0,6 % du prix). Les commissions signées et en cours sont recalculées en direct. Ces colonnes se règlent
  dans `activites.reglages`, donc un autre projet peut avoir les siennes.
- **Semaine type** : les créneaux prévus par projet apparaissent hachurés dans la frise, et chaque projet affiche
  ses heures de la semaine par rapport à son objectif.

## Mise en route (une fois)

1. Créer le projet Supabase « cockpit » (région Paris) et un jeton d'accès, puis remplir `~/.cockpit/supabase.env`.
2. Coller les adresses iCal secrètes dans `~/.cockpit/agendas.env`.
3. `outils/deployer.sh --depart <dossier>` : tables, fonction de synchro, cron, données de départ et `assets/config.js`.
4. Supabase : Authentication > Users > Add user (mon e-mail et un mot de passe), puis se connecter sur le site.
5. GitHub : Settings > Pages > Deploy from a branch, `main`, `/ (root)`.

Ajouter un agenda plus tard : le coller dans `~/.cockpit/agendas.env` et relancer `outils/deployer.sh`.
