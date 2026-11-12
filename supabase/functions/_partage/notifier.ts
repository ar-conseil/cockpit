// Notification sur les téléphones abonnés (Web Push, clés VAPID : secrets VAPID_PUBLIQUE / VAPID_PRIVEE, posés par
// outils/notifications-cles.sh). Sans clés ou sans abonnement : rien n'est envoyé, sans erreur.
import webpush from "npm:web-push@3.6.7";

// Texte brut pour la notification (sans **gras**, titres ni puces Markdown)
const sansMarkdown = (t: string) => t.replace(/\*\*|__|`/g, "").replace(/^#+\s*/gm, "").replace(/^\s*[-*]\s+/gm, "· ").trim();

// deno-lint-ignore no-explicit-any
export async function notifier(db: any, titre: string, corps: string, url = "https://ar-conseil.github.io/cockpit/victor/") {
  const pub = Deno.env.get("VAPID_PUBLIQUE"), priv = Deno.env.get("VAPID_PRIVEE");
  if (!pub || !priv) return { envoyees: 0, raison: "clés absentes" };
  webpush.setVapidDetails("https://ar-conseil.github.io/cockpit/", pub, priv);
  const { data } = await db.from("push_abonnements").select("endpoint, abonnement");
  let envoyees = 0; const erreurs: string[] = [];
  for (const a of data ?? []) {
    try {
      await webpush.sendNotification(a.abonnement, JSON.stringify({ titre, corps: sansMarkdown(corps).slice(0, 300), url }), { TTL: 3600, urgency: "high" });
      envoyees++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from("push_abonnements").delete().eq("endpoint", a.endpoint); // appareil désabonné
      else { console.error("notification :", code, (e as Error).message); erreurs.push(`${code ?? "?"} ${(e as Error).message}`.slice(0, 200)); }
    }
  }
  return { envoyees, abonnes: (data ?? []).length, erreurs };
}
