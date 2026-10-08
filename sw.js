// Кэш оболочки приложения: открывается мгновенно и без сети показывает интерфейс
const CACHE = 'vladaak-web-v1';
const SHELL = ['./', 'index.html', 'style.css?v=1', 'app.js?v=1', 'manifest.webmanifest', 'icon-192.png', 'apple-touch-icon.png', 'bg.jpg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // API и видео — всегда из сети
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
