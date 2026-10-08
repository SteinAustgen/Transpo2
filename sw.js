/* Stale-while-revalidate cache so the directory opens fast on weak or no signal. Bump V on each deploy. */
const V = 'pt-v2';
const SHELL = ['./', 'index.html', 'app.js', 'enhancements.js', 'config.js', 'styles.css', 'site-data.json'];

self.addEventListener('install', (e) => e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  // Same-origin files, PapaParse and Google Fonts only; live sheet/map requests always go to the network.
  if (e.request.method !== 'GET' || !(u.origin === location.origin || /(^|\.)(jsdelivr\.net|googleapis\.com|gstatic\.com)$/.test(u.hostname) && !/maps|docs/.test(u.hostname))) return;
  e.respondWith(caches.open(V).then(async (c) => {
    const hit = await c.match(e.request);
    const net = fetch(e.request).then((r) => { if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
