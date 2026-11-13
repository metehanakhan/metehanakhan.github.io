/*
 * Hohla servis çalışanı (web). İki işi var:
 *
 * 1) Bildirim: sunucudan gelen Web Push iletisini gösterir; dokununca açık pencereyi öne getirip
 *    ilgili ekrana yönlendirir (pencere yoksa uygulamayı o ekranda açar). iPhone'da yalnızca
 *    Ana Ekrana eklenmiş Hohla bildirim alabilir.
 *
 * 2) Hız ve çevrimdışı açılış: adında özet (hash) olan dosyalar bir kez iner, sonra hep
 *    önbellekten gelir (GitHub Pages bunları 10 dakikada bir yeniden sorduruyordu). Sayfa ve
 *    özetsiz dosyalar önce ağdan istenir; ağ yoksa son iyi kopya açılır. Böylece yeni sürüm
 *    hiçbir zaman eski kopyanın arkasında kalmaz.
 */
const SURUM = 'hohla-v1';
const KALICI = `${SURUM}-kalici`; // özetli dosyalar: içerik değişmez
const YEDEK = `${SURUM}-yedek`; // ağ yokken kullanılacak son iyi kopyalar
const GELISTIRME = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const adlar = await caches.keys();
      await Promise.all(adlar.filter((a) => a.startsWith('hohla-') && !a.startsWith(SURUM)).map((a) => caches.delete(a)));
      await self.clients.claim();
    })(),
  );
});

// ------------------------------------------------------------------ önbellek
/** Adında içerik özeti olan dosya: bir kez iner, hiç değişmez */
const ozetli = (yol) => yol.startsWith('/_expo/static/') || /[.-][0-9a-f]{16,}\.[a-z0-9]+$/i.test(yol);
/** Önbelleğe alınmayacak kadar büyük ya da akışla inen dosyalar */
const BUYUK = 40 * 1024 * 1024;

async function sakla(depo, istek, yanit) {
  try {
    if (!yanit || yanit.status !== 200 || yanit.type !== 'basic') return;
    const boy = Number(yanit.headers.get('content-length') || 0);
    if (boy > BUYUK) return;
    const c = await caches.open(depo);
    await c.put(istek, yanit);
  } catch {
    // kota doldu: önbelleksiz devam
  }
}

async function onceOnbellek(istek) {
  const c = await caches.open(KALICI);
  const eski = await c.match(istek);
  if (eski) return eski;
  const yanit = await fetch(istek);
  sakla(KALICI, istek, yanit.clone());
  return yanit;
}

async function onceAg(istek, yedekAnahtar) {
  try {
    const yanit = await fetch(istek);
    // GitHub Pages bilinmeyen adreste 404.html'i (uygulamanın kendisi) sunar; o da geçerli
    if (yanit.status === 200) sakla(YEDEK, yedekAnahtar || istek, yanit.clone());
    return yanit;
  } catch (hata) {
    const c = await caches.open(YEDEK);
    const eski = await c.match(yedekAnahtar || istek, { ignoreSearch: true });
    if (eski) return eski;
    throw hata;
  }
}

self.addEventListener('fetch', (event) => {
  const istek = event.request;
  if (GELISTIRME || istek.method !== 'GET' || istek.headers.has('range')) return;
  const url = new URL(istek.url);
  if (url.origin !== self.location.origin) return; // Supabase, harita karoları, yazı tipleri: dokunma
  if (url.pathname === '/sw.js') return;

  if (istek.mode === 'navigate') {
    // Her sayfa aynı uygulama kabuğu: ağ yoksa kökün son kopyası açılır
    event.respondWith(onceAg(istek, '/'));
    return;
  }
  event.respondWith(ozetli(url.pathname) ? onceOnbellek(istek) : onceAg(istek));
});

// ------------------------------------------------------------------ bildirim
self.addEventListener('push', (event) => {
  let veri = {};
  try {
    veri = event.data ? event.data.json() : {};
  } catch {
    veri = { notification: { title: 'Hohla', body: event.data ? event.data.text() : '' } };
  }
  // Sunucu "declarative web push" biçiminde yollar: { web_push: 8030, notification: {...} }
  const n = veri.notification || veri;
  const baslik = n.title || 'Hohla';
  const url = (n.data && n.data.url) || '/';
  const isler = [
    self.registration.showNotification(baslik, {
      body: n.body || '',
      icon: '/icon-192.png',
      badge: '/simge/bildirim-rozet.png',
      lang: 'tr',
      tag: n.tag || undefined,
      renotify: !!n.tag,
      data: { url },
    }),
  ];
  // Ana ekrandaki simgede kırmızı nokta (uygulama açılınca silinir)
  if (self.navigator && self.navigator.setAppBadge) isler.push(self.navigator.setAppBadge(1).catch(() => {}));
  event.waitUntil(Promise.all(isler));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    (async () => {
      const pencereler = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const acik = pencereler.find((p) => new URL(p.url).origin === self.location.origin);
      if (acik) {
        // Uygulama açık: yeniden yüklemeden ilgili ekrana geç
        acik.postMessage({ tur: 'hohla-bildirim', url });
        if (acik.focus) await acik.focus().catch(() => {});
        return;
      }
      await self.clients.openWindow(url === '/' ? '/' : `/?b=${encodeURIComponent(url)}`);
    })(),
  );
});

// Abonelik tarayıcı tarafından yenilenirse uygulama bir sonraki açılışta yeniden kaydeder
self.addEventListener('pushsubscriptionchange', () => {});
