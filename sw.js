/* Application AR CONSEIL : rend le cockpit installable (écran d'accueil du téléphone, Dock du Mac) et affiche les notifications
   de Victor, même application fermée. Ne garde aucune page en mémoire : le cockpit se charge toujours depuis le site, à jour. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function () { /* rien : le réseau répond, comme avant */ });
self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { corps: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.titre || 'AR CONSEIL', {
    body: d.corps || '', icon: 'assets/marque/icone-192.png', badge: 'assets/marque/icone-192.png', tag: 'ar-' + Date.now(), data: { url: d.url || './' }
  }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (fen) {
    for (var i = 0; i < fen.length; i++) if ('focus' in fen[i]) { if ('navigate' in fen[i]) fen[i].navigate(url).catch(function () {}); return fen[i].focus(); }
    return self.clients.openWindow(url);
  }));
});
