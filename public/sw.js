// سرویس‌ورکرِ سبکِ simorgh-ledger — فقط برای نسخه‌ی وب (PWA)
// راهبرد: navigation شبکه‌اول (همیشه به‌روز در حالتِ آنلاین، و آفلاین از کش)؛
// منابعِ ثابت کش‌اول با پُرشدنِ زمانِ اجرا. بدونِ نیاز به فهرستِ فایل‌های هش‌دار.
const CACHE = 'simorgh-cache-v1';

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // فقط منابعِ خودیِ سایت

  // صفحه‌ها: شبکه‌اول، در صورتِ آفلاین از index کش‌شده
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/index.html')));
    return;
  }
  // فایل‌های ثابت: کش‌اول و در صورتِ نبودن از شبکه (و کش‌کردنِ آن)
  e.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res && res.status === 200) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    } catch {
      return cached || Response.error();
    }
  })());
});
