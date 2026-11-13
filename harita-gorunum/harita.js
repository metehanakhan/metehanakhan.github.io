// Hohla harita: koyu 3D harita, ikinizin avatar iğneleri, aradaki parlayan bağ ve mesafe.
// Uygulama bu sayfayı web'de iframe, Android'de WebView olarak açar; veriler mesajla gelir.
/* global maplibregl */
(function () {
  const STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
  const BEN = '#F2A65A';
  const O = '#E879A6';
  const q = new URLSearchParams(location.search);
  let alt = Number(q.get('alt') || 260); // alttaki kartın yüksekliği (px)
  let ust = Number(q.get('ust') || 110);

  // Güvenlik: sevgilinin yazdığı yer adı, anı fotoğrafı gibi metinler HTML olarak çalışmasın
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"'`]/g, (c) => '&#' + c.charCodeAt(0) + ';');
  // Arka plan resmi yalnızca resim verisi ya da https adresi olabilir (CSS/HTML kaçışı yok)
  const guvenliResim = (u) => (typeof u === 'string' && /^(data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=\s]+|https:\/\/[^'"()\s<>\\]+)$/i.test(u) ? u : null);

  function post(type, extra) {
    const msg = Object.assign({ source: 'hohla-harita', type }, extra || {});
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    else if (window.parent && window.parent !== window) window.parent.postMessage(msg, '*');
  }

  const map = new maplibregl.Map({
    container: 'map',
    style: STYLE,
    center: [29.0, 41.02],
    zoom: 11,
    pitch: 45,
    bearing: -12,
    attributionControl: false,
    dragRotate: true,
    pitchWithRotate: true,
    maxPitch: 70,
  });
  document.documentElement.style.setProperty('--alt', alt + 'px');

  let ready = false;
  let state = null;
  let mode = 'ikimiz';
  const markers = {};
  let midMarker = null;
  let bagGizli = false;
  let unionMarker = null;
  let araMarker = null;
  let rotaVeri = null;
  let rotaOdak = null; // sığdırılan rota çizgisi (önizleme açıkken)

  // Harita künyesi (OpenStreetMap lisansı gereği görünür kalır); dokununca uygulama dışında açılır
  const kunye = document.createElement('div');
  kunye.className = 'kunye';
  kunye.textContent = '© OpenStreetMap · © CARTO';
  kunye.addEventListener('click', (e) => {
    e.stopPropagation();
    post('baglanti', { url: 'https://www.openstreetmap.org/copyright' });
  });
  document.body.appendChild(kunye);
  let kunyeGitti = false;
  function kunyeSondur() {
    if (kunyeGitti) return;
    kunyeGitti = true;
    kunye.style.opacity = '0';
    setTimeout(() => (kunye.style.display = 'none'), 900);
  }
  setTimeout(kunyeSondur, 5000);

  // Etiketler: koyu haritada gri ve küçüktü; büyüt, aç, koyu hale ver. Boyut ayardan çarpanla gelir.
  const asilBoyut = {};
  let yaziKat = 1.25;
  function carp(v, k) {
    if (typeof v === 'number') return Math.round(v * k * 10) / 10;
    if (v && Array.isArray(v.stops)) return { ...v, stops: v.stops.map(([z, x]) => [z, typeof x === 'number' ? Math.round(x * k * 10) / 10 : x]) };
    if (Array.isArray(v) && (v[0] === 'interpolate' || v[0] === 'step')) {
      const c = v.slice();
      const bas = v[0] === 'interpolate' ? 3 : 2;
      for (let i = bas; i < c.length; i++) {
        const tekMi = v[0] === 'interpolate' ? (i - bas) % 2 === 1 : (i - bas) % 2 === 0;
        if (tekMi && typeof c[i] === 'number') c[i] = Math.round(c[i] * k * 10) / 10;
      }
      return c;
    }
    return v;
  }
  function okunur() {
    for (const l of map.getStyle().layers) {
      if (l.type !== 'symbol' || !l.layout || !l.layout['text-field']) continue;
      if (!(l.id in asilBoyut)) {
        asilBoyut[l.id] = map.getLayoutProperty(l.id, 'text-size') ?? 16;
        const yerAdi = /place|city|town|village|suburb|country|state/.test(l.id);
        map.setPaintProperty(l.id, 'text-color', yerAdi ? '#E2DCEA' : '#B9B2C6');
        map.setPaintProperty(l.id, 'text-halo-color', 'rgba(10, 9, 14, 0.92)');
        map.setPaintProperty(l.id, 'text-halo-width', 1.6);
      }
      map.setLayoutProperty(l.id, 'text-size', carp(asilBoyut[l.id], yaziKat));
    }
  }
  let ayar = { yazi: 1.25, bina: true, egim: true };
  function ayarUygula(a) {
    if (!a) return;
    const once = ayar;
    ayar = { ...ayar, ...a };
    if (!ready) return;
    if (ayar.yazi !== yaziKat) {
      yaziKat = ayar.yazi;
      okunur();
    }
    if (map.getLayer('hohla-bina')) map.setLayoutProperty('hohla-bina', 'visibility', ayar.bina ? 'visible' : 'none');
    if (once.egim !== ayar.egim) frame(true);
  }

  // Stil gelir gelmez kur (karoların hepsinin inmesini bekleme: harita akarak dolar)
  map.once('style.load', () => {
    try {
      okunur();
    } catch (e) {
      // stil farklıysa varsayılan etiketlerle devam
    }
    // 3D binalar: koyu, hafif mor tonlu; yakınlaştıkça yükselir
    try {
      const src = Object.keys(map.getStyle().sources).find((k) => map.getStyle().sources[k].type === 'vector');
      if (src) {
        map.addLayer({
          id: 'hohla-bina',
          type: 'fill-extrusion',
          source: src,
          'source-layer': 'building',
          minzoom: 13.5,
          paint: {
            'fill-extrusion-color': ['interpolate', ['linear'], ['zoom'], 14, '#1A1724', 17, '#2A2338'],
            'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 13.5, 0, 15, ['coalesce', ['get', 'render_height'], 10]],
            'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
            'fill-extrusion-opacity': 0.85,
          },
        });
      }
    } catch (e) {
      // binalar olmasa da harita çalışır
    }
    // Aradaki bağ: geniş yumuşak ışık + ince akan çizgi
    map.addSource('bag', { type: 'geojson', lineMetrics: true, data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'bag-isik',
      type: 'line',
      source: 'bag',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-width': 14, 'line-blur': 10, 'line-opacity': 0.55, 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, BEN, 1, O] },
    });
    map.addLayer({
      id: 'bag',
      type: 'line',
      source: 'bag',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-width': 3, 'line-dasharray': [1, 1.6], 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, BEN, 1, O] },
    });
    // Rotalar: benim (turuncu) ve onun yolculuğu (pembe); geniş ışık + koyu kenar + parlak çekirdek
    map.addSource('rota', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    const RENK = ['match', ['get', 'kim'], 'o', O, BEN];
    map.addLayer({ id: 'rota-isik', type: 'line', source: 'rota', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': RENK, 'line-width': 16, 'line-blur': 10, 'line-opacity': 0.45 } });
    map.addLayer({ id: 'rota-kenar', type: 'line', source: 'rota', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#140F0A', 'line-width': 8.5, 'line-opacity': 0.9 } });
    map.addLayer({ id: 'rota', type: 'line', source: 'rota', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': RENK, 'line-width': 5 } });
    // Yerler: sahibine göre renkli, kesikli kenarlı bölgeler
    map.addSource('yerler', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'yer-dolgu', type: 'fill', source: 'yerler', paint: { 'fill-color': ['get', 'renk'], 'fill-opacity': ['case', ['get', 'icerde'], 0.22, 0.1] } });
    map.addLayer({ id: 'yer-kenar', type: 'line', source: 'yerler', paint: { 'line-color': ['get', 'renk'], 'line-width': 1.5, 'line-opacity': 0.8, 'line-dasharray': [2, 2] } });
    // Seçim önizlemesi
    map.addSource('secim', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'secim-dolgu', type: 'fill', source: 'secim', paint: { 'fill-color': '#F2A65A', 'fill-opacity': 0.18 } });
    map.addLayer({ id: 'secim-kenar', type: 'line', source: 'secim', paint: { 'line-color': '#F2A65A', 'line-width': 2 } });
    ready = true;
    if (rotaVeri) window.hohlaHarita.rota({ ...rotaVeri, sigdir: false });
    ayarUygula({});
    if (state) draw(true);
    post('hazir');
  });

  // Büyük çember üstünde yumuşak kavis (iki nokta arasında hafif yay)
  function arc(a, b) {
    const pts = [];
    const n = 48;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    const nx = -dy / (len || 1);
    const ny = dx / (len || 1);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const h = Math.sin(Math.PI * t) * len * 0.12;
      pts.push([a[0] + dx * t + nx * h, a[1] + dy * t + ny * h]);
    }
    return pts;
  }

  function km(a, b) {
    const R = 6371;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  function pinEl(p, color, kim) {
    const el = document.createElement('div');
    el.className = 'pin';
    el.style.setProperty('--c', color);
    el.innerHTML = '<div class="hal"><span class="he"></span><span class="hy"></span></div><div class="halo"></div><div class="disk"><div class="yuz"></div></div><div class="ucu"></div><div class="ad"></div><div class="rozet">🚗</div>';
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      post('dokun', { kim });
    });
    return el;
  }
  function fillPin(el, p) {
    const yuz = el.querySelector('.yuz');
    const tur = p.ikon && p.ikon.tur;
    yuz.classList.toggle('emoji', tur === 'emoji' && !!p.ikon.emoji);
    if (tur === 'emoji' && p.ikon.emoji) {
      yuz.style.backgroundImage = '';
      yuz.textContent = p.ikon.emoji;
    } else if (tur !== 'harf' && p.portre) {
      yuz.style.backgroundImage = `url("${p.portre}")`;
      yuz.textContent = '';
    } else {
      yuz.style.backgroundImage = '';
      yuz.textContent = (p.ad || '?').slice(0, 1).toLocaleUpperCase('tr');
    }
    // Durum balonu: "😴 Uyuyorum"; türüne göre küçük bir canlandırma
    const hal = el.querySelector('.hal');
    const anahtar = p.hal ? p.hal.emoji + '|' + p.hal.yazi : '';
    if (hal.dataset.k !== anahtar) {
      hal.dataset.k = anahtar;
      el.classList.remove('halli');
      if (p.hal) {
        hal.className = 'hal ' + (p.hal.anim || '');
        hal.innerHTML = '<span class="he"></span><span class="hy"></span>' + (p.hal.anim === 'uyku' ? '<b class="z">z</b><b class="z">z</b><b class="z">Z</b>' : '');
        hal.querySelector('.he').textContent = p.hal.emoji;
        hal.querySelector('.hy').textContent = p.hal.yazi;
        void el.offsetWidth;
        el.classList.add('halli');
      }
    }
    el.querySelector('.ad').textContent = p.etiket || p.ad || '';
    el.classList.toggle('yolda', !!p.yolda);
    el.classList.toggle('sis', !!p.sis);
    el.classList.toggle('eski', !!p.eski);
    el.querySelector('.rozet').textContent = p.yolda ? (p.eta ? `🚗 ${p.eta}` : '🚗') : '';
  }

  // Metre yarıçaplı çember (çokgen)
  function circle(lng, lat, r) {
    const pts = [];
    const dLat = r / 111320;
    const dLng = r / (111320 * Math.cos((lat * Math.PI) / 180));
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      pts.push([lng + Math.cos(a) * dLng, lat + Math.sin(a) * dLat]);
    }
    return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts] }, properties: {} };
  }

  const yerMarkers = {};
  function drawYerler() {
    const list = (state && state.yerler) || [];
    const feats = list.map((y) => {
      const f = circle(y.lng, y.lat, y.r);
      f.properties = { renk: y.sahip === 'ben' ? BEN : O, icerde: !!y.icerde };
      return f;
    });
    map.getSource('yerler').setData({ type: 'FeatureCollection', features: feats });
    const seen = {};
    for (const y of list) {
      seen[y.id] = true;
      let mk = yerMarkers[y.id];
      if (!mk) {
        const el = document.createElement('div');
        el.className = 'yer';
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          post('yer', { id: y.id });
        });
        mk = yerMarkers[y.id] = new maplibregl.Marker({ element: el, anchor: 'center' });
      }
      const el = mk.getElement();
      el.style.setProperty('--c', y.sahip === 'ben' ? BEN : O);
      el.classList.toggle('icerde', !!y.icerde);
      el.innerHTML = `<span class="em">${esc(y.emoji)}</span><span class="yad">${esc(y.ad)}${y.durum ? `<small>${esc(y.durum)}</small>` : ''}</span>`;
      mk.setLngLat([y.lng, y.lat]).addTo(map);
    }
    for (const id of Object.keys(yerMarkers)) {
      if (!seen[id]) {
        yerMarkers[id].remove();
        delete yerMarkers[id];
      }
    }
  }

  // Haritadan yer seçimi: ortadaki nişangâh, kaydırdıkça önizleme çemberi
  let secim = null;
  const nisan = document.createElement('div');
  nisan.className = 'nisan';
  nisan.innerHTML = '<i></i>';
  document.body.appendChild(nisan);
  function secimCiz() {
    if (!ready) return;
    const c = map.getCenter();
    map.getSource('secim').setData(secim ? circle(c.lng, c.lat, secim.r) : { type: 'FeatureCollection', features: [] });
  }
  map.on('move', () => secim && secimCiz());
  map.on('moveend', () => {
    if (!secim) return;
    const c = map.getCenter();
    post('merkez', { lat: c.lat, lng: c.lng });
  });

  // Mekân önerileri (ortada buluşalım) ve anı iğneleri (fotoğraflı, altın çerçeve)
  const extra = { mekan: {}, ani: {} };
  function drawExtra(kind, list, make) {
    const seen = {};
    for (const x of list || []) {
      seen[x.id] = true;
      let mk = extra[kind][x.id];
      if (!mk) {
        mk = extra[kind][x.id] = new maplibregl.Marker({ element: make(x), anchor: kind === 'ani' ? 'bottom' : 'center' });
      }
      mk.setLngLat([x.lng, x.lat]).addTo(map);
    }
    for (const id of Object.keys(extra[kind])) {
      if (!seen[id]) {
        extra[kind][id].remove();
        delete extra[kind][id];
      }
    }
  }
  function mekanEl(x) {
    const el = document.createElement('div');
    el.className = 'mekan';
    el.innerHTML = `<span>${esc(x.emoji)}</span><b></b>`;
    el.querySelector('b').textContent = x.ad;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      post('mekan', { id: x.id });
    });
    return el;
  }
  function aniEl(x) {
    const el = document.createElement('div');
    el.className = 'ani';
    const foto = guvenliResim(x.foto);
    el.innerHTML = `<div class="foto">${foto ? '' : '📸'}</div><div class="ucu"></div>`;
    if (foto) el.querySelector('.foto').style.backgroundImage = `url("${foto}")`;
    el.title = x.baslik;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      post('ani', { id: x.id });
    });
    return el;
  }

  function draw(fit) {
    if (!ready || !state) return;
    drawYerler();
    drawExtra('mekan', state.mekanlar, mekanEl);
    drawExtra('ani', state.anilar, aniEl);
    const list = [['ben', BEN], ['o', O]];
    const shown = {};
    const ben = state.ben && state.ben.lat != null ? state.ben : null;
    const o = state.o && state.o.lat != null ? state.o : null;
    const together = ben && o && km(ben, o) < 0.15;
    for (const [kim, color] of list) {
      const p = kim === 'ben' ? ben : o;
      if (!p || together) {
        if (markers[kim]) {
          markers[kim].remove();
          delete markers[kim];
        }
        continue;
      }
      shown[kim] = p;
      if (!markers[kim]) markers[kim] = new maplibregl.Marker({ element: pinEl(p, color, kim), anchor: 'bottom', offset: [0, 20] }).setLngLat([p.lng, p.lat]).addTo(map);
      else markers[kim].setLngLat([p.lng, p.lat]);
      fillPin(markers[kim].getElement(), p);
    }
    // Kavuşma iğnesi
    if (together) {
      if (!unionMarker) {
        const el = document.createElement('div');
        el.className = 'kavus';
        el.innerHTML = '<div class="disk"><div class="yuz"></div></div><div class="disk"><div class="yuz"></div></div>' + [0, 0.7, 1.4].map((d) => `<div class="kalp" style="animation-delay:${d}s">💗</div>`).join('');
        el.addEventListener('click', () => post('dokun', { kim: 'ikimiz' }));
        unionMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' });
      }
      const els = unionMarker.getElement().querySelectorAll('.yuz');
      [ben, o].forEach((p, i) => {
        els[i].style.backgroundImage = p.portre ? `url("${p.portre}")` : '';
        const emo = p.ikon && p.ikon.tur === 'emoji' && p.ikon.emoji;
        els[i].style.backgroundImage = !emo && p.ikon?.tur !== 'harf' && p.portre ? `url("${p.portre}")` : '';
        els[i].textContent = emo || (p.ikon?.tur !== 'harf' && p.portre ? '' : (p.ad || '?').slice(0, 1));
      });
      unionMarker.setLngLat([(ben.lng + o.lng) / 2, (ben.lat + o.lat) / 2]).addTo(map);
    } else if (unionMarker) {
      unionMarker.remove();
      unionMarker = null;
    }
    // Bağ ve ortadaki etiket
    const src = map.getSource('bag');
    if (ben && o && !together) {
      src.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: arc([ben.lng, ben.lat], [o.lng, o.lat]) }, properties: {} });
      if (!midMarker) {
        const el = document.createElement('div');
        el.className = 'orta';
        el.addEventListener('click', () => post('dokun', { kim: 'orta' }));
        midMarker = new maplibregl.Marker({ element: el });
      }
      const mid = arc([ben.lng, ben.lat], [o.lng, o.lat])[24];
      midMarker.getElement().innerHTML = state.ortaYazi || '';
      midMarker.setLngLat(mid).addTo(map);
      ortaGoster();
    } else {
      src.setData({ type: 'FeatureCollection', features: [] });
      if (midMarker) {
        midMarker.remove();
        midMarker = null;
      }
    }
    if (fit) frame(true);
  }

  function rotaSigdir(soft) {
    if (!ready || !rotaOdak) return;
    const b = new maplibregl.LngLatBounds();
    rotaOdak.forEach((p) => b.extend(p));
    map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
    const h = map.getContainer().clientHeight;
    const ustP = ust + 40;
    const altP = Math.min(alt + 40, Math.max(120, h - ustP - 160));
    const cam = map.cameraForBounds(b, { padding: { top: ustP, bottom: altP, left: 50, right: 50 }, maxZoom: 16.5 });
    if (cam) map.flyTo({ ...cam, pitch: ayar.egim ? 30 : 0, bearing: 0, duration: soft ? 1200 : 400, essential: true });
  }

  function frame(soft) {
    if (rotaOdak) return rotaSigdir(soft);
    if (!ready || !state) return;
    const ben = state.ben && state.ben.lat != null ? state.ben : null;
    const o = state.o && state.o.lat != null ? state.o : null;
    const pad = { top: ust + 70, bottom: alt + 60, left: 60, right: 60 };
    const opts = { duration: soft ? 1400 : 0, essential: true };
    const P = (v) => (ayar.egim ? v : 0);
    const Bg = (v) => (ayar.egim ? v : 0);
    if (mode === 'ben' && ben) return map.flyTo({ center: [ben.lng, ben.lat], zoom: 15.2, pitch: P(48), bearing: Bg(-14), padding: pad, ...opts });
    if (mode === 'o' && o) return map.flyTo({ center: [o.lng, o.lat], zoom: 15.2, pitch: P(48), bearing: Bg(14), padding: pad, ...opts });
    const pts = [ben, o].filter(Boolean);
    if (pts.length === 1) return map.flyTo({ center: [pts[0].lng, pts[0].lat], zoom: 14, pitch: P(45), padding: pad, ...opts });
    if (pts.length === 2) {
      const b = new maplibregl.LngLatBounds();
      pts.forEach((p) => b.extend([p.lng, p.lat]));
      // Önceki uçuşlardan kalan dolgu yenisine eklenmesin: sıfırla
      map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
      // Kartlar ekranı çok kaplıyorsa dolguyu sığacak kadar küçült (ikiniz için en az 140 px yer kalsın)
      const h = map.getContainer().clientHeight;
      const w = map.getContainer().clientWidth;
      const fit = { ...pad };
      const room = h - 140;
      if (fit.top + fit.bottom > room) {
        const k = Math.max(0.2, room / (fit.top + fit.bottom));
        fit.top *= k;
        fit.bottom *= k;
      }
      if (fit.left + fit.right > w - 100) fit.left = fit.right = 30;
      const cam = map.cameraForBounds(b, { padding: fit, maxZoom: 16.5 }) || map.cameraForBounds(b, { padding: 30, maxZoom: 16.5 });
      if (cam) map.flyTo({ ...cam, pitch: P(40), bearing: Bg(-12), ...opts });
      else map.flyTo({ center: [(ben.lng + o.lng) / 2, (ben.lat + o.lat) / 2], zoom: 12, pitch: P(40), bearing: Bg(-12), ...opts });
    }
  }

  // Duraklatma: sekme odakta değilken ya da uygulama arka plandayken uygulama "duraklat" yollar.
  // Sayfanın sürekli canlandırmaları (iğne nabzı, durum balonu, kavuşma kalpleri) CSS'tedir: hepsi dondurulur.
  // Veri güncellemeleri (set, rota, ara…) duraklamışken de işlenir; sürdürünce bir kare çizilir.
  let durakli = false;
  const durakStil = document.createElement('style');
  durakStil.textContent = 'body.durakli *, body.durakli *::before, body.durakli *::after { animation-play-state: paused !important; }';
  document.head.appendChild(durakStil);

  const api = {
    duraklat(v) {
      v = !!v;
      if (v === durakli) return;
      durakli = v;
      document.body.classList.toggle('durakli', durakli);
      if (!durakli) {
        try {
          map.triggerRepaint();
          ortaGoster();
        } catch (e) {
          // harita daha kurulmadıysa sorun değil
        }
      }
    },
    set(s) {
      if (s && s.ayar) ayarUygula(s.ayar);
      const first = !state;
      const moved =
        !state ||
        ['ben', 'o'].some((k) => {
          const a = state[k];
          const b = s[k];
          return !a !== !b || (a && b && (Math.abs(a.lat - b.lat) > 1e-4 || Math.abs(a.lng - b.lng) > 1e-4));
        });
      state = s;
      draw(first || (moved && mode === 'ikimiz'));
    },
    mode(m) {
      mode = (m && m.mod) || m || 'ikimiz';
      rotaOdak = null;
      frame(true);
    },
    fly(v) {
      if (!v) return;
      map.flyTo({ center: [v.lng, v.lat], zoom: 15.6, pitch: ayar.egim ? 45 : 0, duration: 1200 });
    },
    rota(v) {
      rotaVeri = v;
      const benVar = !!(v && v.ben && v.ben.length > 1);
      rotaOdak = benVar && v.sigdir ? v.ben : null;
      // Rota gösterilirken aradaki kuş uçuşu bağ ve mesafe etiketi karışıklık yaratmasın
      bagGizli = benVar;
      if (ready) {
        ['bag', 'bag-isik'].forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', bagGizli ? 'none' : 'visible'));
        ortaGoster();
      }
      const feats = [];
      for (const kim of ['o', 'ben']) {
        const c = v && v[kim];
        if (c && c.length > 1) feats.push({ type: 'Feature', properties: { kim }, geometry: { type: 'LineString', coordinates: c } });
      }
      if (!ready) return;
      map.getSource('rota').setData({ type: 'FeatureCollection', features: feats });
      if (rotaOdak) rotaSigdir(true);
    },
    ara(v) {
      if (araMarker) {
        araMarker.remove();
        araMarker = null;
      }
      if (!v || v.lat == null) return;
      const el = document.createElement('div');
      el.className = 'ara';
      el.innerHTML = '<div class="kafa"><i></i></div><div class="ad"></div>';
      el.querySelector('.ad').textContent = v.ad || '';
      araMarker = new maplibregl.Marker({ element: el, anchor: 'top', offset: [0, -40] }).setLngLat([v.lng, v.lat]).addTo(map);
      if (v.ucma) return;
      map.flyTo({ center: [v.lng, v.lat], zoom: 15.4, pitch: ayar.egim ? 40 : 0, duration: 1300 });
    },
    secim(v) {
      secim = v && v.on ? { r: v.r || 200 } : null;
      nisan.style.display = secim ? 'block' : 'none';
      if (secim) {
        const c = v.lat != null ? [v.lng, v.lat] : map.getCenter().toArray();
        map.flyTo({ center: c, zoom: 16.2, pitch: 30, duration: 900, padding: { top: 0, bottom: 0, left: 0, right: 0 } });
        post('merkez', { lat: c[1], lng: c[0] });
      }
      secimCiz();
    },
    insets(v) {
      alt = v.alt ?? alt;
      ust = v.ust ?? ust;
      document.documentElement.style.setProperty('--alt', alt + 'px');
      frame(false);
    },
  };
  window.hohlaHarita = api;
  window.addEventListener('message', (e) => {
    // Yalnızca aynı sitedeki uygulama (web iframe) komut verebilir; başka bir site bu sayfayı
    // çerçeveye alıp veri yollayamasın. Telefonda veri injectJavaScript ile gelir, buradan değil.
    if (e.origin !== location.origin || e.source !== window.parent) return;
    let m = e.data;
    if (typeof m === 'string') {
      try {
        m = JSON.parse(m);
      } catch (err) {
        return;
      }
    }
    if (!m || m.target !== 'hohla-harita') return;
    if (m.type === 'set') api.set(m.data);
    if (m.type === 'mode') api.mode(m.data);
    if (m.type === 'insets') api.insets(m.data);
    if (m.type === 'secim') api.secim(m.data);
    if (m.type === 'fly') api.fly(m.data);
    if (m.type === 'ara') api.ara(m.data);
    if (m.type === 'rota') api.rota(m.data);
    if (m.type === 'duraklat') api.duraklat(m.data);
  });
  // İki iğne ekranda birbirine çok yakınsa ortadaki mesafe etiketi iğnelerin üstüne biner: gizle
  function ortaGoster() {
    if (!midMarker) return;
    if (bagGizli) {
      midMarker.getElement().style.visibility = 'hidden';
      return;
    }
    if (!markers.ben || !markers.o) return;
    const a = map.project(markers.ben.getLngLat());
    const b = map.project(markers.o.getLngLat());
    midMarker.getElement().style.visibility = Math.hypot(a.x - b.x, a.y - b.y) < 170 ? 'hidden' : 'visible';
  }
  const uzakMi = () => document.body.classList.toggle('uzak', map.getZoom() < 13);
  map.on('zoom', uzakMi);
  map.once('style.load', uzakMi);
  map.on('move', ortaGoster);
  map.on('moveend', ortaGoster);
  map.on('dragstart', () => {
    kunyeSondur();
    post('surukle');
  });
  post('acildi');
})();
