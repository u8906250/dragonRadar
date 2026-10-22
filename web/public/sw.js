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
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      data: { url: d.url || './' },
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  const id = Number(new URL(url).searchParams.get('event')) || null;
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const win = wins.find((w) => w.url.startsWith(self.registration.scope));
      if (win) {
        await win.focus();
        if (id) win.postMessage({ type: 'show-event', id });
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
