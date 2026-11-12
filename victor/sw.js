// Service worker de l'appli Victor : affiche les notifications envoyées par le cockpit (Web Push) et ouvre la bonne page au toucher.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { corps: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.titre || "Victor", {
    body: d.corps || "C'est fait.", icon: "icone-192.png", badge: "icone-192.png", data: { url: d.url || "./" }, tag: "victor-" + Date.now() }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((fen) => {
    for (const f of fen) if ("focus" in f) { f.navigate(url).catch(() => null); return f.focus(); }
    return self.clients.openWindow(url);
  }));
});
