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
    if (depo === KALICI) budaKalici(c);
  } catch {
    // kota doldu: önbelleksiz devam
  }
}

/**
 * Her yayın yeni özetli dosyalar ekler; eskileri kimse istemez. Kalıcı önbellek en fazla bu kadar
 * kayıt tutar, fazlası en eskiden başlayarak silinir (iPhone'da depolama kotası dolmasın).
 */
const KALICI_EN_FAZLA = 350;
let budaniyor = false;
async function budaKalici(c) {
  if (budaniyor) return;
  budaniyor = true;
  try {
    const anahtarlar = await c.keys();
    const fazla = anahtarlar.length - KALICI_EN_FAZLA;
    for (let i = 0; i < fazla; i++) await c.delete(anahtarlar[i]);
  } catch {
    // önemli değil
  } finally {
    budaniyor = false;
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

async function onceAg(istek, yedekAnahtar, bekleme) {
  const ag = fetch(istek).then((yanit) => {
    // GitHub Pages bilinmeyen adreste 404.html'i (uygulamanın kendisi) sunar; o da geçerli
    if (yanit.status === 200) sakla(YEDEK, yedekAnahtar || istek, yanit.clone());
    return yanit;
  });
  ag.catch(() => {}); // zaman aşımında yanıt beklenmiyorsa hata yutulur
  const yedek = async () => {
    const c = await caches.open(YEDEK);
    return c.match(yedekAnahtar || istek, { ignoreSearch: true });
  };
  if (!bekleme) {
    try {
      return await ag;
    } catch (hata) {
      const eski = await yedek();
      if (eski) return eski;
      throw hata;
    }
  }
  // Sayfa: ağ çok yavaşsa (metro, asansör) beyaz ekranda bekletme; son kopyayı aç, ağ arkada yenilesin
  const zaman = new Promise((coz) => setTimeout(() => coz('gec'), bekleme));
  try {
    const ilk = await Promise.race([ag, zaman]);
    if (ilk !== 'gec') return ilk;
    const eski = await yedek();
    return eski || (await ag);
  } catch (hata) {
    const eski = await yedek();
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
    event.respondWith(onceAg(istek, '/', 4000));
    return;
  }
  // Çizim motoru (canvaskit.wasm, 8 MB, adında özet yok): önce ağ, ama ağ 3 sn'de cevap vermezse son iyi kopya.
  // Eskiden zaman aşımı yoktu: zayıf ağda (metro) açılış bu dosyayı bekleyip asılı kalıyordu.
  if (url.pathname === '/canvaskit.wasm') {
    event.respondWith(onceAg(istek, null, 3000));
    return;
  }
  // Sürüm numaralı varlıklar (avatar ?v=55 gibi): adres değişmedikçe içerik de değişmez
  const surumlu = /(^|&)v=/.test(url.search.slice(1));
  event.respondWith(ozetli(url.pathname) || surumlu ? onceOnbellek(istek) : onceAg(istek));
});

// ------------------------------------------------------------------ bildirim
/**
 * Sessiz saatler (Ayarlar > Bildirim): uygulama tercihi IndexedDB'ye yazar (src/lib/bildirim-tercih.ts,
 * veritabanı src/lib/buyuk-depo.ts). Bu aralıkta bildirim gösterilir ama ses/titreşim olmadan.
 */
function sessizTercih() {
  return new Promise((coz) => {
    try {
      const ac = indexedDB.open('hohla-buyuk', 1);
      ac.onupgradeneeded = () => ac.result.createObjectStore('kayit');
      ac.onerror = () => coz(null);
      ac.onsuccess = () => {
        try {
          const db = ac.result;
          const al = db.transaction('kayit', 'readonly').objectStore('kayit').get('sw.sessiz');
          al.onsuccess = () => {
            try {
              coz(al.result ? JSON.parse(al.result) : null);
            } catch {
              coz(null);
            }
            db.close();
          };
          al.onerror = () => coz(null);
        } catch {
          coz(null);
        }
      };
    } catch {
      coz(null);
    }
  });
}
function sessizMi(s) {
  if (!s || !s.acik || s.bas === s.bit) return false;
  const h = new Date(Date.now() + (s.dilim || 0) * 60000).getUTCHours();
  return s.bas < s.bit ? h >= s.bas && h < s.bit : h >= s.bas || h < s.bit;
}

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
    sessizTercih().then((s) => {
      const sessiz = !!n.silent || sessizMi(s);
      return self.registration.showNotification(baslik, {
        body: n.body || '',
        icon: '/icon-192.png',
        badge: '/simge/bildirim-rozet.png',
        lang: 'tr',
        tag: n.tag || undefined,
        // Sessiz saatte aynı etiketli bildirim yeniden ses çıkarmasın
        renotify: !!n.tag && !sessiz,
        silent: sessiz,
        data: { url },
      });
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
