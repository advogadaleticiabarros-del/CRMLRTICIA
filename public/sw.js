/* Service worker do CRM — instalação (PWA), Web Push (app fechado) e clique em notificação.
   Estratégia: network-first com fallback ao cache (não serve dado velho quando online). */
const CACHE = 'crm-cache-v2';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/logo.png', '/manifest.json'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        // só cacheia a casca estática; respostas de API não vão para o cache
        if (!req.url.includes('/api/')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((m) => m || caches.match('/index.html')))
  );
});

// Web Push: alerta do servidor (chega mesmo com o app fechado)
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  const title = d.title || 'CRM Jurídico';
  const opts = {
    body: d.body || '',
    icon: '/logo.png',
    badge: '/logo.png',
    tag: d.tag || undefined,
    data: { url: d.url || '/' },
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

// Clique na notificação → foca a janela do app (ou abre a URL)
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cls) => {
      for (const c of cls) { if ('focus' in c) { c.navigate && c.navigate(url); return c.focus(); } }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
