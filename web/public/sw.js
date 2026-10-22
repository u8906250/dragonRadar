/*
 * 洋流雷達的 service worker：收手機推播、顯示通知，點通知打開雷達並選到那一則。
 * 不快取網頁（沒有 fetch 處理），網頁更新照常。
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = { body: e.data ? e.data.text() : '' };
  }
  e.waitUntil(
    self.registration.showNotification(d.title || '洋流雷達', {
      body: d.body || '',
      tag: d.tag || 'dragon-radar',
      renotify: !!d.renotify,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      data: { url: d.url || './' },
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope);
  const id = Number(target.searchParams.get('event')) || null;
  e.waitUntil(
    (async () => {
      // 同一頁（雷達、管理頁）已經開著就切過去，雷達再選到那一則；不然開新的
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Cloudflare Pages 會把 admin.html 轉到 /admin
      const page = (u) => new URL(u).pathname.replace(/\.html$/, '').replace(/\/index$/, '/');
      const win = wins.find((w) => page(w.url) === page(target.href));
      if (win) {
        await win.focus();
        win.postMessage(id ? { type: 'show-event', id } : { type: 'refresh' });
        return;
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});
