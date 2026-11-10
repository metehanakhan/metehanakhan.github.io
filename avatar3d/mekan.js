// Hohla avatar mekânları: avatarın arkasındaki sahneler (kodla çizilir, dosya indirmez).
//  oda   — kadında evde giyinme odası, erkekte loft; yan tarafta gardırop (kapakları açılır)
//  teras — gece çatı terası, şehir ışıkları ve ampul zinciri
//  sahne — dans sahnesi: ışık duvarı ve hareketli spotlar
//  sade  — arka plan yok (uygulamanın kendi zemini)
// Avatar hep dünya merkezinde durur; "yürürken" oda kayar (kamera avatarı izliyormuş gibi).
// Eksenler: avatar +Z'ye (kameraya) bakar, sağı (izleyicinin solu) -X... izleyiciye göre: +X sağ, yukarı +Y.

export const MEKANLAR = ['oda', 'teras', 'sahne', 'sade'];
export const DOLAP_X = 1.9; // gardırobun odadaki yeri (avatar oraya yürür)

export function mekanKur(THREE, scene, renderer) {
  const kok = new THREE.Group();
  kok.name = 'mekan';
  scene.add(kok);
  const sahneler = {};
  let aktif = null;
  let aktifAd = 'sade';
  let beden = 'kadin';

  // ---------- yardımcılar ----------
  const tuvalCache = new Map();
  function tuval(ad, w, h, ciz, { tekrar = null, renkli = true } = {}) {
    const k = ad + w + 'x' + h + (tekrar ? tekrar.join(',') : '');
    if (tuvalCache.has(k)) return tuvalCache.get(k);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    ciz(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    if (renkli) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    if (tekrar) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(tekrar[0], tekrar[1]);
    }
    tuvalCache.set(k, t);
    return t;
  }
  // tekrarlanabilir rastgele (her açılışta aynı desen)
  let tohum = 7;
  const rnd = () => {
    tohum = (tohum * 16807) % 2147483647;
    return (tohum - 1) / 2147483646;
  };
  const mat = (o) => new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, ...o });
  const parla = (renk, guc = 1) => new THREE.MeshBasicMaterial({ color: new THREE.Color(renk).multiplyScalar(guc), toneMapped: false });
  function kutu(w, h, d, m, x = 0, y = 0, z = 0, ebeveyn) {
    const k = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    k.position.set(x, y, z);
    if (ebeveyn) ebeveyn.add(k);
    return k;
  }
  function yuvarlakKutu(w, h, d, r, m) {
    const s = new THREE.Shape();
    const x = -w / 2;
    const y = -h / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y);
    s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r);
    s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h);
    s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r);
    s.quadraticCurveTo(x, y, x + r, y);
    const b = Math.min(r, d / 2) * 0.9;
    const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, d - 2 * b), bevelEnabled: true, bevelSize: b, bevelThickness: b, bevelSegments: 3, curveSegments: 6 });
    g.translate(0, 0, -(d - 2 * b) / 2);
    return new THREE.Mesh(g, m);
  }
  // yumuşak ışık lekesi (ampul parıltısı, lamba hâlesi)
  const haleDoku = tuval('hale', 128, 128, (g, w) => {
    const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.18, 'rgba(255,255,255,0.55)');
    r.addColorStop(0.45, 'rgba(255,255,255,0.12)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, w, w);
  });
  function hale(renk, boy, opak = 1) {
    const m = new THREE.SpriteMaterial({ map: haleDoku, color: renk, transparent: true, opacity: opak, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const s = new THREE.Sprite(m);
    s.scale.set(boy, boy, 1);
    return s;
  }
  // ampul zinciri: iki nokta arasında sarkan kablo, üstünde sıcak ampuller
  function ampulZinciri(a, b, sarkma, aralik, renk = '#FFC98A', ebeveyn) {
    const g = new THREE.Group();
    const n = Math.max(2, Math.round(a.distanceTo(b) / aralik));
    const nok = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const p = a.clone().lerp(b, t);
      p.y -= sarkma * 4 * t * (1 - t);
      nok.push(p);
    }
    const kablo = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(nok), 60, 0.004, 4), mat({ color: '#1a1410', roughness: 0.6 }));
    g.add(kablo);
    const ampulGeo = new THREE.SphereGeometry(0.018, 10, 8);
    const ampuller = [];
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const p = a.clone().lerp(b, t);
      p.y -= sarkma * 4 * t * (1 - t) + 0.035;
      const am = new THREE.Mesh(ampulGeo, parla(renk, 1.6));
      am.position.copy(p);
      g.add(am);
      const h = hale(renk, 0.32, 0.55);
      h.position.copy(p);
      g.add(h);
      ampuller.push({ h, faz: rnd() * 6.28 });
    }
    g.userData.ampuller = ampuller;
    if (ebeveyn) ebeveyn.add(g);
    return g;
  }
  function zincirTitret(g, t, guc = 0.12) {
    for (const a of g.userData.ampuller) a.h.material.opacity = 0.5 + guc * Math.sin(t * 1.7 + a.faz) + guc * 0.5 * Math.sin(t * 4.3 + a.faz * 2);
  }

  // ---------- dokular ----------
  const balikSirti = (koyu) =>
    tuval('parke' + koyu, 1024, 1024, (g, w) => {
      const tonlar = koyu ? ['#3a2618', '#43301f', '#33221a', '#4a3322', '#2e1f15'] : ['#8a6240', '#9a6f49', '#7d5739', '#a67a52', '#86603f'];
      g.fillStyle = koyu ? '#20150e' : '#5e4129';
      g.fillRect(0, 0, w, w);
      const L = 128;
      const E = 32;
      for (let y = -L; y < w + L; y += E) {
        for (let x = -L; x < w + L; x += L) {
          for (const yon of [0, 1]) {
            g.save();
            g.translate(x + (yon ? L / 2 : 0), y + (yon ? 0 : 0));
            g.rotate(yon ? -Math.PI / 4 : Math.PI / 4);
            g.fillStyle = tonlar[Math.floor(rnd() * tonlar.length)];
            g.fillRect(0, 0, L * 0.7, E * 0.68);
            g.globalAlpha = 0.18;
            for (let k = 0; k < 6; k++) {
              g.fillStyle = rnd() > 0.5 ? '#000' : '#fff';
              g.fillRect(0, rnd() * E * 0.68, L * 0.7, 0.8);
            }
            g.globalAlpha = 1;
            g.restore();
          }
        }
      }
    }, { tekrar: [3, 3] });
  const tahta = (renk1, renk2, ad) =>
    tuval('tahta' + ad, 512, 1024, (g, w, h) => {
      const n = 8;
      for (let i = 0; i < n; i++) {
        let y = 0;
        while (y < h) {
          const boy = 180 + rnd() * 380;
          const c = new THREE.Color(renk1).lerp(new THREE.Color(renk2), rnd());
          g.fillStyle = '#' + c.getHexString();
          g.fillRect((i * w) / n + 1, y + 1, w / n - 2, boy - 2);
          g.globalAlpha = 0.12;
          for (let k = 0; k < 9; k++) {
            g.fillStyle = rnd() > 0.5 ? '#000' : '#fff';
            g.fillRect((i * w) / n + rnd() * (w / n), y, 1, boy);
          }
          g.globalAlpha = 1;
          y += boy;
        }
      }
    }, { tekrar: [4, 2] });
  const beton = tuval('beton', 512, 512, (g, w) => {
    g.fillStyle = '#3b3a3c';
    g.fillRect(0, 0, w, w);
    for (let i = 0; i < 9000; i++) {
      const v = 40 + rnd() * 40;
      g.fillStyle = `rgba(${v},${v},${v + 3},${0.15 + rnd() * 0.2})`;
      g.fillRect(rnd() * w, rnd() * w, 1 + rnd() * 3, 1 + rnd() * 3);
    }
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 2;
    g.strokeRect(0, 0, w, w);
  }, { tekrar: [6, 2] });
  const tugla = tuval('tugla', 512, 512, (g, w) => {
    g.fillStyle = '#2a201d';
    g.fillRect(0, 0, w, w);
    const bh = 32;
    const bw = 96;
    for (let r = 0; r < w / bh; r++) {
      for (let c = -1; c < w / bw + 1; c++) {
        const x = c * bw + (r % 2 ? bw / 2 : 0);
        const ton = new THREE.Color('#6b3326').lerp(new THREE.Color('#8a4a34'), rnd()).multiplyScalar(0.7 + rnd() * 0.4);
        g.fillStyle = '#' + ton.getHexString();
        g.fillRect(x + 3, r * bh + 3, bw - 6, bh - 6);
        g.globalAlpha = 0.25;
        for (let k = 0; k < 14; k++) {
          g.fillStyle = rnd() > 0.5 ? '#000' : '#d9a080';
          g.fillRect(x + 3 + rnd() * (bw - 8), r * bh + 3 + rnd() * (bh - 8), 2, 2);
        }
        g.globalAlpha = 1;
      }
    }
  }, { tekrar: [3, 3] });
  // gece manzarası: gökyüzü, ay, şehir siluetleri ve yanan pencereler
  const geceManzara = (ad, ayX = 0.7) =>
    tuval('gece' + ad, 1024, 768, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#07091a');
      gr.addColorStop(0.55, '#1b1736');
      gr.addColorStop(0.8, '#3f2445');
      gr.addColorStop(1, '#5e3346');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 220; i++) {
        g.fillStyle = `rgba(255,255,255,${0.2 + rnd() * 0.7})`;
        const r = rnd() * 1.3;
        g.beginPath();
        g.arc(rnd() * w, rnd() * h * 0.6, r, 0, 7);
        g.fill();
      }
      // ay
      const ax = w * ayX;
      const ay = h * 0.2;
      const ag = g.createRadialGradient(ax, ay, 0, ax, ay, 90);
      ag.addColorStop(0, 'rgba(255,240,215,0.5)');
      ag.addColorStop(1, 'rgba(255,240,215,0)');
      g.fillStyle = ag;
      g.fillRect(ax - 90, ay - 90, 180, 180);
      g.fillStyle = '#FFF1DA';
      g.beginPath();
      g.arc(ax, ay, 22, 0, 7);
      g.fill();
      // şehir: iki kat siluet
      for (const [katman, renk, alt, ust] of [[0, '#1a1426', 0.62, 0.4], [1, '#0d0a14', 0.74, 0.55]]) {
        let x = 0;
        while (x < w) {
          const bw = 30 + rnd() * 70;
          const bh = h * (ust + rnd() * (1 - ust) * 0.5);
          const top = h * alt - (bh - h * (1 - alt)) * 0.4 - rnd() * 60 * (katman ? 1 : 0.6);
          g.fillStyle = renk;
          g.fillRect(x, top, bw, h - top);
          for (let yy = top + 8; yy < h - 6; yy += 11) {
            for (let xx = x + 5; xx < x + bw - 6; xx += 9) {
              if (rnd() < (katman ? 0.22 : 0.12)) {
                g.fillStyle = rnd() < 0.8 ? `rgba(255,${190 + rnd() * 40},${110 + rnd() * 50},${0.5 + rnd() * 0.5})` : 'rgba(170,200,255,0.7)';
                g.fillRect(xx, yy, 4, 5);
              }
            }
          }
          x += bw + rnd() * 6;
        }
      }
    });
  // duvar: koyu mürdüm, alt yarıda pervazlı panolar, köşelere doğru kararır
  const morDuvar = tuval('morduvar', 1024, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#24142a');
    gr.addColorStop(0.6, '#3a2140');
    gr.addColorStop(1, '#2f1a33');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    const ust = h * 0.62;
    g.fillStyle = 'rgba(255,220,240,0.10)';
    g.fillRect(0, ust, w, 4);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(0, ust + 4, w, 3);
    for (let x = 16; x < w; x += 128) {
      g.strokeStyle = 'rgba(255,220,240,0.08)';
      g.lineWidth = 3;
      g.strokeRect(x, ust + 26, 96, h - ust - 60);
      g.strokeStyle = 'rgba(0,0,0,0.22)';
      g.strokeRect(x + 3, ust + 29, 96, h - ust - 60);
    }
  }, { tekrar: [4, 1] });

  // neon yazı: uygulamanın el yazısıyla "hohla"
  const HOHLA = [[-0.25, 0.05], [0.15, 0.8], [0.45, 1.7], [0.42, 2.12], [0.26, 1.95], [0.21, 1.15], [0.19, 0.35], [0.2, 0.0], [0.27, 0.52], [0.44, 0.88], [0.63, 0.93], [0.77, 0.66], [0.8, 0.22], [0.92, 0.0], [1.1, 0.16], [1.36, 0.6], [1.62, 0.95], [1.4, 0.82], [1.27, 0.42], [1.41, 0.04], [1.68, 0.1], [1.81, 0.5], [1.67, 0.92], [1.61, 0.84], [1.8, 0.85], [2.05, 0.8], [2.3, 1.4], [2.48, 1.95], [2.4, 2.14], [2.24, 1.88], [2.21, 1.0], [2.2, 0.0], [2.26, 0.5], [2.43, 0.87], [2.62, 0.93], [2.77, 0.66], [2.8, 0.22], [2.91, 0.0], [3.08, 0.18], [3.3, 1.0], [3.47, 1.82], [3.38, 2.15], [3.21, 1.86], [3.2, 1.0], [3.24, 0.22], [3.38, 0.0], [3.56, 0.16], [3.96, 0.86], [3.74, 0.96], [3.53, 0.7], [3.49, 0.3], [3.64, 0.02], [3.88, 0.2], [3.98, 0.62], [4.0, 0.96], [3.98, 0.42], [4.03, 0.05], [4.2, 0.08], [4.38, 0.32]];
  function egri(ps, n = 9) {
    const o = [];
    for (let i = 0; i < ps.length - 1; i++) {
      const p0 = ps[Math.max(0, i - 1)];
      const p1 = ps[i];
      const p2 = ps[i + 1];
      const p3 = ps[Math.min(ps.length - 1, i + 2)];
      for (let k = 0; k < n; k++) {
        const t = k / n;
        const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
        o.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    o.push(ps[ps.length - 1]);
    return o;
  }
  const neonDoku = (ad, yol, kapali = false) =>
    tuval('neon' + ad, 1024, 512, (g, w, h) => {
      const xs = yol.map((p) => p[0]);
      const ys = yol.map((p) => p[1]);
      const x0 = Math.min(...xs);
      const x1 = Math.max(...xs);
      const y0 = Math.min(...ys);
      const y1 = Math.max(...ys);
      const s = Math.min((w * 0.82) / (x1 - x0), (h * 0.7) / (y1 - y0));
      const ox = (w - (x1 - x0) * s) / 2;
      const oy = (h + (y1 - y0) * s) / 2;
      const gr = g.createLinearGradient(ox, 0, w - ox, 0);
      gr.addColorStop(0, '#FFB25E');
      gr.addColorStop(1, '#FF5FA8');
      const ciz = (lw, alfa, blur, renk) => {
        g.save();
        g.globalAlpha = alfa;
        g.shadowColor = '#FF7A8A';
        g.shadowBlur = blur;
        g.strokeStyle = renk;
        g.lineWidth = lw;
        g.lineCap = g.lineJoin = 'round';
        g.beginPath();
        yol.forEach(([x, y], i) => (i ? g.lineTo : g.moveTo).call(g, ox + (x - x0) * s, oy - (y - y0) * s));
        if (kapali) g.closePath();
        g.stroke();
        g.restore();
      };
      ciz(26, 0.35, 40, gr);
      ciz(13, 0.8, 18, gr);
      ciz(6, 1, 6, '#FFF3E6');
    });
  function neon(ad, yol, gen, kapali) {
    const m = new THREE.MeshBasicMaterial({ map: neonDoku(ad, yol, kapali), transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
    return new THREE.Mesh(new THREE.PlaneGeometry(gen, gen / 2), m);
  }
  const kalpYolu = (() => {
    const o = [];
    for (let i = 0; i <= 64; i++) {
      const t = (i / 64) * Math.PI * 2;
      o.push([16 * Math.pow(Math.sin(t), 3), 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)]);
    }
    return o;
  })();

  // ---------- giysiler (dolabın içinde yandan görünen askılar) ----------
  function askidaGiysi(renk, boy, gen, elbise) {
    const s = new THREE.Shape();
    const alt = elbise ? gen * 1.25 : gen * 0.95;
    s.moveTo(-gen * 0.42, 0);
    s.lineTo(gen * 0.42, 0);
    s.quadraticCurveTo(gen * 0.52, -0.06, gen * 0.5, -0.12);
    s.lineTo(alt / 2, -boy);
    s.lineTo(-alt / 2, -boy);
    s.lineTo(-gen * 0.5, -0.12);
    s.quadraticCurveTo(-gen * 0.52, -0.06, -gen * 0.42, 0);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2 });
    geo.rotateY(Math.PI / 2);
    const m = new THREE.Mesh(geo, mat({ color: renk, roughness: 0.85 }));
    const askı = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.004, 4, 12, Math.PI * 1.3), mat({ color: '#C9A15A', metalness: 0.8, roughness: 0.35 }));
    askı.rotation.y = Math.PI / 2;
    askı.position.y = 0.035;
    const g = new THREE.Group();
    g.add(m, askı);
    return g;
  }
  function katliYigin(renkler, gen, d) {
    const g = new THREE.Group();
    let y = 0;
    for (const r of renkler) {
      const k = yuvarlakKutu(gen * (0.9 + rnd() * 0.1), 0.07, d, 0.02, mat({ color: r, roughness: 0.95 }));
      k.position.set((rnd() - 0.5) * 0.02, y + 0.035, 0);
      g.add(k);
      y += 0.072;
    }
    return g;
  }

  // ---------- gardırop ----------
  // tur: 'klasik' (kadın: krem lake, menteşeli kapaklar, içi aynalı) | 'cam' (erkek: siyah çerçeve, sürgülü füme cam)
  function gardirop(tur) {
    const W = 1.7;
    const H = 2.25;
    const D = 0.6;
    const g = new THREE.Group();
    const govdeM = tur === 'klasik' ? mat({ color: '#EADFD2', roughness: 0.42 }) : mat({ color: '#141416', roughness: 0.5, metalness: 0.4 });
    const icM = tur === 'klasik' ? mat({ color: '#9c7f86', roughness: 0.8 }) : mat({ color: '#2e2119', roughness: 0.7 });
    const altin = mat({ color: tur === 'klasik' ? '#D4AC63' : '#B88A4A', metalness: 0.85, roughness: 0.3 });
    const t = 0.03;
    kutu(t, H, D, govdeM, -W / 2 + t / 2, H / 2, 0, g);
    kutu(t, H, D, govdeM, W / 2 - t / 2, H / 2, 0, g);
    kutu(W, t, D, govdeM, 0, H - t / 2, 0, g);
    kutu(W, 0.09, D, govdeM, 0, 0.045, 0, g);
    kutu(W - 2 * t, H - 0.1, 0.02, icM, 0, H / 2, -D / 2 + 0.01, g);
    kutu(0.022, H - 0.12, D - 0.04, govdeM, 0.12, H / 2, -0.01, g); // orta bölme
    if (tur === 'klasik') {
      kutu(W + 0.08, 0.06, D + 0.06, govdeM, 0, H + 0.03, 0.0, g); // korniş
      kutu(W + 0.12, 0.025, D + 0.09, altin, 0, H + 0.07, 0.0, g);
    }
    // iç ışık şeridi (kapak açılınca yanar)
    const led = kutu(W - 0.1, 0.012, 0.02, parla(tur === 'klasik' ? '#FFE3BF' : '#FFD39A', 0), 0, H - 0.05, D / 2 - 0.06, g);
    const ledYan = [];
    if (tur === 'cam') {
      for (const x of [-W / 2 + 0.05, W / 2 - 0.05]) ledYan.push(kutu(0.012, H - 0.25, 0.02, parla('#FFD39A', 0), x, H / 2, D / 2 - 0.07, g));
    }
    // askı borusu ve giysiler (sol bölme)
    const boru = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, W / 2 + 0.05, 10), altin);
    boru.rotation.z = Math.PI / 2;
    boru.position.set(-W / 4 + 0.05, H - 0.32, 0);
    g.add(boru);
    const renkler =
      tur === 'klasik'
        ? ['#7a1f3d', '#e7c6cf', '#1f3a5f', '#c9a227', '#f2ede6', '#5b2a6e', '#d96c75', '#2d5a4a', '#e8b4a0', '#101014']
        : ['#1d2a44', '#f1efe9', '#5b5f66', '#b48a5b', '#141416', '#3e4b33', '#8f9aa6', '#e5dfd3', '#2f2a26'];
    const x0 = -W / 2 + 0.1;
    const x1 = 0.06;
    renkler.forEach((r, i) => {
      const elbise = tur === 'klasik' && i % 3 !== 1;
      const gg = askidaGiysi(r, elbise ? 1.15 + rnd() * 0.35 : 0.72 + rnd() * 0.15, 0.42, elbise);
      gg.position.set(x0 + ((x1 - x0) * i) / (renkler.length - 1), H - 0.32, (rnd() - 0.5) * 0.04);
      gg.rotation.y = (rnd() - 0.5) * 0.25;
      g.add(gg);
    });
    // sağ bölme: raflar, katlı giysiler, çanta/ayakkabı
    const rafX = (0.12 + W / 2) / 2;
    const rafW = W / 2 - 0.12 - 0.05;
    for (const y of [0.42, 0.9, 1.38, 1.82]) kutu(rafW, 0.02, D - 0.06, govdeM, rafX, y, -0.01, g);
    const pastel =
      tur === 'klasik'
        ? [['#f3d1dc', '#e9e4dc', '#c7d7e8', '#f1e2c4'], ['#d8a7b1', '#efe9e1', '#b9a3c9'], ['#f6efe6', '#e5c3b0', '#cdb4db', '#f3d1dc']]
        : [['#2b3a55', '#d9d4c7', '#6c7a89', '#1a1a1c'], ['#7a5c43', '#e8e3d9', '#3f4b3a'], ['#9aa5b1', '#262a30', '#c8b79a', '#4b5563']];
    [0.92, 1.4].forEach((y, i) => {
      const a = katliYigin(pastel[i], 0.3, 0.32);
      a.position.set(rafX - 0.1, y + 0.01, 0.02);
      g.add(a);
      const b = katliYigin(pastel[(i + 1) % 3], 0.28, 0.32);
      b.position.set(rafX + 0.2, y + 0.01, 0.02);
      g.add(b);
    });
    if (tur === 'klasik') {
      // çanta
      const canta = yuvarlakKutu(0.3, 0.2, 0.12, 0.03, mat({ color: '#a8324a', roughness: 0.55 }));
      canta.position.set(rafX, 1.94, 0.02);
      g.add(canta);
      const sap = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.008, 6, 16, Math.PI), altin);
      sap.position.set(rafX, 2.04, 0.02);
      g.add(sap);
    } else {
      const kutuS = yuvarlakKutu(0.34, 0.12, 0.22, 0.015, mat({ color: '#2a1d14', roughness: 0.5 }));
      kutuS.position.set(rafX, 1.89, 0.0);
      g.add(kutuS);
    }
    // alt raf: ayakkabılar
    for (let i = 0; i < 3; i++) {
      const renk = tur === 'klasik' ? ['#b0123b', '#e9d9c8', '#141414'][i] : ['#f2f2f2', '#3a2618', '#141414'][i];
      for (const dx of [-0.04, 0.04]) {
        const ay = yuvarlakKutu(0.07, tur === 'klasik' ? 0.07 : 0.08, 0.24, 0.03, mat({ color: renk, roughness: 0.4 }));
        ay.position.set(rafX - 0.22 + i * 0.22 + dx, 0.47, 0.02);
        if (tur === 'klasik') ay.rotation.x = -0.18;
        g.add(ay);
      }
    }
    // kapaklar
    const kapaklar = [];
    if (tur === 'klasik') {
      const kapakM = mat({ color: '#EFE6DA', roughness: 0.38 });
      const ayna = new THREE.MeshStandardMaterial({ color: '#b9c2cc', metalness: 0.25, roughness: 0.12, emissive: '#2a2f38', emissiveIntensity: 0.6 });
      for (const yon of [-1, 1]) {
        const mentese = new THREE.Group();
        mentese.position.set((yon * W) / 2, 0.09, D / 2 + 0.012);
        const kw = W / 2 - 0.004;
        const kp = new THREE.Group();
        kp.position.x = (-yon * kw) / 2;
        kutu(kw, H - 0.12, 0.022, kapakM, 0, (H - 0.12) / 2, 0, kp);
        // pervazlı iki pano
        for (const [py, ph] of [[0.62, 1.02], [1.62, 0.76]]) {
          kutu(kw - 0.16, ph, 0.006, kapakM, 0, py, 0.014, kp);
          const cer = kutu(kw - 0.13, ph + 0.03, 0.004, altin, 0, py, 0.012, kp);
          cer.scale.set(1, 1, 1);
        }
        // kulp
        const kulp = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.36, 8), altin);
        kulp.position.set((yon * (kw / 2 - 0.06)), 1.08, 0.04);
        kp.add(kulp);
        // iç yüz ayna
        kutu(kw - 0.12, H - 0.3, 0.004, ayna, 0, (H - 0.12) / 2, -0.014, kp);
        mentese.add(kp);
        g.add(mentese);
        kapaklar.push({ tur: 'mentese', o: mentese, yon });
      }
    } else {
      const cam = new THREE.MeshPhysicalMaterial({ color: '#2b2a2e', metalness: 0.1, roughness: 0.12, transparent: true, opacity: 0.72 });
      const cerM = mat({ color: '#0d0d0f', metalness: 0.6, roughness: 0.4 });
      // üst ray
      kutu(W * 2, 0.03, 0.05, cerM, 0, H + 0.03, D / 2 + 0.04, g);
      for (const yon of [-1, 1]) {
        const kp = new THREE.Group();
        const kw = W / 2 + 0.02;
        kp.position.set((yon * kw) / 2, 0.09, D / 2 + 0.03 + (yon > 0 ? 0.025 : 0));
        kutu(kw, H - 0.1, 0.012, cam, 0, (H - 0.1) / 2, 0, kp);
        for (const [x, y, w, h] of [[0, H - 0.115, kw, 0.03], [0, 0.015, kw, 0.03], [-kw / 2 + 0.015, (H - 0.1) / 2, 0.03, H - 0.1], [kw / 2 - 0.015, (H - 0.1) / 2, 0.03, H - 0.1], [0, (H - 0.1) * 0.55, kw, 0.02]]) kutu(w, h, 0.02, cerM, x, y, 0, kp);
        const kulp = kutu(0.02, 0.5, 0.03, altin, -yon * (kw / 2 - 0.06), 1.1, 0.025, kp);
        void kulp;
        g.add(kp);
        kapaklar.push({ tur: 'surgu', o: kp, yon, x0: kp.position.x, kw });
      }
    }
    g.userData = { kapaklar, led, ledYan, W, H, D };
    return g;
  }
  function kapakAyarla(dolap, a) {
    const e = a < 0.5 ? 4 * a * a * a : 1 - Math.pow(-2 * a + 2, 3) / 2;
    const u = dolap.userData;
    for (const k of u.kapaklar) {
      // sol kapak (menteşe solda) -Y yönünde, sağ kapak +Y yönünde döner: ikisi de kameraya doğru açılır
      if (k.tur === 'mentese') k.o.rotation.y = k.yon * e * 1.85;
      else k.o.position.x = k.x0 + k.yon * e * (k.kw * 0.92);
    }
    const isik = Math.min(1, e * 1.4);
    u.led.material.color.setRGB(1, 0.89, 0.75).multiplyScalar(0.15 + isik * 2.2);
    for (const l of u.ledYan) l.material.color.setRGB(1, 0.83, 0.6).multiplyScalar(0.2 + isik * 2.4);
  }

  // ---------- ortak ışık havuzu (sayı sabit kalsın: ışık sayısı değişirse gölgelendiriciler yeniden derlenir) ----------
  const isiklar = [0, 1, 2].map(() => {
    const l = new THREE.PointLight('#ffffff', 0, 4, 1.6);
    scene.add(l);
    return l;
  });
  function isikKur(liste) {
    isiklar.forEach((l, i) => {
      const o = liste[i];
      l.intensity = o ? o.g : 0;
      l.userData.taban = o ? o.g : 0;
      if (o) {
        l.color.set(o.renk);
        l.position.set(o.x, o.y, o.z);
        l.userData.x = o.x;
        l.distance = o.mesafe ?? 4;
      }
      l.userData.bagli = o?.bagli ?? null;
    });
  }

  // ---------- ODA: kadın giyinme odası ----------
  function kadinOda() {
    const g = new THREE.Group();
    const zemin = new THREE.Mesh(new THREE.PlaneGeometry(10, 8), mat({ map: balikSirti(false), roughness: 0.55 }));
    zemin.rotation.x = -Math.PI / 2;
    zemin.position.set(0.8, 0, 2.2);
    g.add(zemin);
    const duvar = new THREE.Mesh(new THREE.PlaneGeometry(10, 3.6), mat({ map: morDuvar, roughness: 0.9 }));
    duvar.position.set(0.8, 1.8, -1.5);
    g.add(duvar);
    kutu(10, 0.1, 0.03, mat({ color: '#efe3ea', roughness: 0.6 }), 0.8, 0.05, -1.485, g); // süpürgelik
    // kemerli gece penceresi (avatarın tam arkasında)
    const pen = new THREE.Group();
    pen.position.set(0, 0, -1.49);
    const pW = 1.05;
    const pH = 1.75;
    const s = new THREE.Shape();
    s.moveTo(-pW / 2, 0);
    s.lineTo(pW / 2, 0);
    s.lineTo(pW / 2, pH - pW / 2);
    s.absarc(0, pH - pW / 2, pW / 2, 0, Math.PI, false);
    s.lineTo(-pW / 2, 0);
    const camGeo = new THREE.ShapeGeometry(s, 24);
    const uv = camGeo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (camGeo.attributes.position.getX(i) + pW / 2) / pW * 0.55 + 0.22, camGeo.attributes.position.getY(i) / pH * 0.62 + 0.3);
    const manzara = new THREE.Mesh(camGeo, new THREE.MeshBasicMaterial({ map: geceManzara('oda', 0.62), toneMapped: false }));
    manzara.position.set(0, 0.62, 0.004);
    pen.add(manzara);
    // çerçeve ve kayıtlar
    const cerM = mat({ color: '#f1e7ee', roughness: 0.5 });
    const cerYol = [];
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI;
      cerYol.push(new THREE.Vector3(Math.cos(a) * pW / 2, pH - pW / 2 + Math.sin(a) * pW / 2, 0));
    }
    const cerceve = [new THREE.Vector3(pW / 2, 0, 0), ...cerYol, new THREE.Vector3(-pW / 2, 0, 0), new THREE.Vector3(pW / 2, 0, 0)];
    const cerMesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cerceve, false, 'catmullrom', 0.01), 120, 0.03, 6), cerM);
    cerMesh.position.set(0, 0.62, 0.02);
    pen.add(cerMesh);
    kutu(0.02, pH - 0.05, 0.02, cerM, 0, 0.62 + (pH - 0.05) / 2, 0.025, pen);
    kutu(pW, 0.02, 0.02, cerM, 0, 0.62 + 0.62, 0.025, pen);
    kutu(pW + 0.2, 0.05, 0.14, cerM, 0, 0.6, 0.06, pen); // denizlik
    // tül perdeler
    const tulDoku = tuval('tul', 128, 512, (gg, w, h) => {
      for (let x = 0; x < w; x++) {
        const a = 0.42 + 0.1 * Math.sin(x * 0.2) + 0.05 * Math.sin(x * 0.9);
        gg.fillStyle = `rgba(255,236,246,${a})`;
        gg.fillRect(x, 0, 1, h);
      }
    });
    const tuller = [];
    for (const yon of [-1, 1]) {
      const tg = new THREE.PlaneGeometry(0.42, 2.6, 12, 1);
      const p = tg.attributes.position;
      for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 22) * 0.025);
      const tul = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ map: tulDoku, transparent: true, side: THREE.DoubleSide, roughness: 1, depthWrite: false }));
      tul.position.set(yon * (pW / 2 + 0.12), 1.32, 0.12);
      pen.add(tul);
      tuller.push(tul);
    }
    kutu(pW + 0.9, 0.025, 0.025, mat({ color: '#d4ac63', metalness: 0.8, roughness: 0.3 }), 0, 2.64, 0.12, pen);
    g.add(pen);
    // ampul zinciri pencerenin üstünden iki yana
    const zincir = ampulZinciri(new THREE.Vector3(-1.4, 2.42, -1.4), new THREE.Vector3(0.9, 2.38, -1.4), 0.42, 0.15, '#FFC98A', g);
    const zincir2 = ampulZinciri(new THREE.Vector3(0.9, 2.38, -1.4), new THREE.Vector3(3.4, 2.42, -1.4), 0.32, 0.15, '#FFC98A', g);
    // yuvarlak halı (avatarın altında)
    const haliDoku = tuval('hali', 512, 512, (gg, w) => {
      const c = w / 2;
      const r0 = gg.createRadialGradient(c, c, 0, c, c, c);
      r0.addColorStop(0, '#d9aeb8');
      r0.addColorStop(0.85, '#cf9fab');
      r0.addColorStop(1, '#b9838f');
      gg.fillStyle = r0;
      gg.beginPath();
      gg.arc(c, c, c, 0, 7);
      gg.fill();
      // tüylü doku
      for (let i = 0; i < 26000; i++) {
        const a = rnd() * 6.28;
        const r = Math.sqrt(rnd()) * c;
        gg.fillStyle = rnd() > 0.5 ? 'rgba(255,240,245,0.10)' : 'rgba(90,40,55,0.10)';
        gg.fillRect(c + Math.cos(a) * r, c + Math.sin(a) * r, 1.5, 1.5);
      }
      // kenara yakın ince çift çizgi
      gg.strokeStyle = 'rgba(255,236,242,0.55)';
      gg.lineWidth = 3;
      for (const rr of [c * 0.86, c * 0.82]) {
        gg.beginPath();
        gg.arc(c, c, rr, 0, 7);
        gg.stroke();
      }
    });
    const hali = new THREE.Mesh(new THREE.CircleGeometry(1.05, 64), mat({ map: haliDoku, roughness: 1 }));
    hali.rotation.x = -Math.PI / 2;
    hali.position.set(0, 0.006, 0.05);
    g.add(hali);
    // ayaklı lamba (pencereyle dolap arasında)
    const lamba = new THREE.Group();
    lamba.position.set(0.95, 0, -1.05);
    const pirinc = mat({ color: '#C9A15A', metalness: 0.85, roughness: 0.3 });
    kutu(0.28, 0.025, 0.28, pirinc, 0, 0.012, 0, lamba);
    const direk = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.45, 8), pirinc);
    direk.position.y = 0.74;
    lamba.add(direk);
    const abajur = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.24, 0.3, 24, 1, true), new THREE.MeshStandardMaterial({ color: '#fff1dc', emissive: '#ffcf96', emissiveIntensity: 1.4, side: THREE.DoubleSide, roughness: 1 }));
    abajur.position.y = 1.6;
    lamba.add(abajur);
    const lh = hale('#FFC27A', 1.6, 0.7);
    lh.position.set(0, 1.6, -0.25);
    lamba.add(lh);
    g.add(lamba);
    // kadife puf ve bitki
    const puf = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.24, 0.38, 32), mat({ color: '#7e3a5a', roughness: 0.95 }));
    puf.position.set(-0.95, 0.19, -0.75);
    g.add(puf);
    const pufUst = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.05, 10, 32), mat({ color: '#8b4565', roughness: 0.95 }));
    pufUst.rotation.x = Math.PI / 2;
    pufUst.position.set(-0.95, 0.38, -0.75);
    g.add(pufUst);
    g.add(bitki(-1.75, -1.05, 1.35));
    // boy aynası (sol, ışıklı)
    const ayna = new THREE.Group();
    ayna.position.set(-2.4, 0, -1.25);
    const am = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 1.1, 8, 24), new THREE.MeshStandardMaterial({ color: '#b9c2cc', metalness: 0.25, roughness: 0.12, emissive: '#2a2f38', emissiveIntensity: 0.6 }));
    am.scale.z = 0.04;
    am.position.y = 1.0;
    ayna.add(am);
    const halka = new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 6, 64), parla('#FFE1C2', 2));
    halka.scale.set(0.34, 0.9, 1);
    halka.position.set(0, 1.0, 0.02);
    ayna.add(halka);
    g.add(ayna);
    // kalp neon (gardırobun yanında)
    const kalp = neon('kalp', kalpYolu, 0.5, true);
    kalp.position.set(3.05, 1.65, -1.48);
    g.add(kalp);
    // gardırop
    const dolap = gardirop('klasik');
    dolap.position.set(DOLAP_X, 0, -1.12);
    g.add(dolap);
    const halı2 = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.9), mat({ color: '#d9b9bf', roughness: 1 }));
    halı2.rotation.x = -Math.PI / 2;
    halı2.position.set(DOLAP_X, 0.005, -0.35);
    g.add(halı2);
    return {
      g,
      dolap,
      isik: [
        { renk: '#FFC27A', g: 2.2, x: 0.95, y: 1.6, z: -0.9, mesafe: 3.2 },
        { renk: '#FFD9AE', g: 0, x: DOLAP_X, y: 1.95, z: -0.75, mesafe: 2.0, bagli: 'dolap' },
        { renk: '#B9A2FF', g: 0.6, x: 0, y: 1.6, z: -1.1, mesafe: 2.2 },
      ],
      guncelle(t) {
        zincirTitret(zincir, t);
        zincirTitret(zincir2, t);
        tuller.forEach((tl, i) => (tl.rotation.y = Math.sin(t * 0.6 + i * 2) * 0.05));
        kalp.material.opacity = 0.9 + 0.1 * Math.sin(t * 2.2);
      },
      zemin: '#120a14',
    };
  }
  function bitki(x, z, boy) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const saksi = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.36, 24), mat({ color: '#d9cfc4', roughness: 0.6 }));
    saksi.position.y = 0.18;
    g.add(saksi);
    const yaprakDoku = tuval('yaprak', 128, 256, (gg, w, h) => {
      gg.fillStyle = '#2f5b3a';
      gg.beginPath();
      gg.moveTo(w / 2, h);
      gg.quadraticCurveTo(w * 1.05, h * 0.45, w / 2, 0);
      gg.quadraticCurveTo(-w * 0.05, h * 0.45, w / 2, h);
      gg.fill();
      gg.strokeStyle = 'rgba(180,220,170,0.4)';
      gg.lineWidth = 3;
      gg.beginPath();
      gg.moveTo(w / 2, h);
      gg.lineTo(w / 2, 8);
      gg.stroke();
    });
    const ym = new THREE.MeshStandardMaterial({ map: yaprakDoku, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.7 });
    for (let i = 0; i < 26; i++) {
      const y = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.4), ym);
      const a = rnd() * 6.28;
      const h = 0.45 + rnd() * (boy - 0.5);
      y.position.set(Math.cos(a) * 0.12 * rnd(), h, Math.sin(a) * 0.12 * rnd());
      y.rotation.set(-0.5 + rnd() * 0.6, a, (rnd() - 0.5) * 1.2);
      g.add(y);
    }
    return g;
  }

  // ---------- ODA: erkek loft ----------
  function erkekLoft() {
    const g = new THREE.Group();
    const zemin = new THREE.Mesh(new THREE.PlaneGeometry(10, 8), mat({ map: tahta('#3a2617', '#5a3c25', 'ceviz'), roughness: 0.5 }));
    zemin.rotation.x = -Math.PI / 2;
    zemin.rotation.z = Math.PI / 2;
    zemin.position.set(0.8, 0, 2.2);
    g.add(zemin);
    const duvar = new THREE.Mesh(new THREE.PlaneGeometry(10, 3.6), mat({ map: beton, roughness: 0.95 }));
    duvar.position.set(0.8, 1.8, -1.5);
    g.add(duvar);
    // avatarın arkasında tuğla pano ve neon "hohla"
    const tug = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 3.6), mat({ map: tugla, roughness: 0.95 }));
    tug.position.set(-0.15, 1.8, -1.49);
    g.add(tug);
    const yazi = neon('hohla', egri(HOHLA), 1.05, false);
    yazi.position.set(0.0, 2.05, -1.45);
    g.add(yazi);
    const yaziHale = hale('#FF8C7A', 2.2, 0.35);
    yaziHale.position.set(0, 2.05, -1.4);
    g.add(yaziHale);
    // fabrika penceresi (sol)
    const pen = new THREE.Group();
    pen.position.set(-1.75, 0.55, -1.47);
    const pw = 1.2;
    const ph = 1.9;
    const manz = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), new THREE.MeshBasicMaterial({ map: geceManzara('loft', 0.3), toneMapped: false }));
    manz.position.set(0, ph / 2, 0);
    pen.add(manz);
    const siyah = mat({ color: '#101012', metalness: 0.6, roughness: 0.45 });
    for (let i = 0; i <= 3; i++) kutu(0.03, ph, 0.04, siyah, -pw / 2 + (pw * i) / 3, ph / 2, 0.02, pen);
    for (let i = 0; i <= 5; i++) kutu(pw, 0.03, 0.04, siyah, 0, (ph * i) / 5, 0.02, pen);
    g.add(pen);
    // Edison sarkıt lambalar
    const ampuller = [];
    for (const [x, y] of [[-0.75, 2.35], [0.75, 2.25], [1.35, 2.45]]) {
      const kablo = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 3.6 - y, 4), mat({ color: '#111' }));
      kablo.position.set(x, y + (3.6 - y) / 2, -0.95);
      g.add(kablo);
      const amp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 10), parla('#FFB56A', 2.2));
      amp.scale.y = 1.3;
      amp.position.set(x, y, -0.95);
      g.add(amp);
      const h = hale('#FFA956', 0.9, 0.75);
      h.position.set(x, y, -0.95);
      g.add(h);
      ampuller.push(h);
    }
    // deri koltuk
    const deri = mat({ color: '#7b4425', roughness: 0.55 });
    const koltuk = new THREE.Group();
    koltuk.position.set(-1.15, 0, -0.85);
    koltuk.rotation.y = 0.35;
    const otur = yuvarlakKutu(0.8, 0.22, 0.7, 0.06, deri);
    otur.position.y = 0.36;
    koltuk.add(otur);
    const sirt = yuvarlakKutu(0.8, 0.55, 0.16, 0.06, deri);
    sirt.position.set(0, 0.65, -0.3);
    koltuk.add(sirt);
    for (const s of [-1, 1]) {
      const kol = yuvarlakKutu(0.14, 0.4, 0.7, 0.06, deri);
      kol.position.set(s * 0.4, 0.5, 0);
      koltuk.add(kol);
    }
    for (const [x, z] of [[-0.33, -0.28], [0.33, -0.28], [-0.33, 0.28], [0.33, 0.28]]) kutu(0.04, 0.24, 0.04, mat({ color: '#111' }), x, 0.12, z, koltuk);
    g.add(koltuk);
    // üç ayaklı lamba
    const lamba = new THREE.Group();
    lamba.position.set(0.95, 0, -1.05);
    const siyahM = mat({ color: '#151515', metalness: 0.5, roughness: 0.4 });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * 6.28;
      const ayak = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.45, 6), siyahM);
      ayak.position.set(Math.cos(a) * 0.12, 0.7, Math.sin(a) * 0.12);
      ayak.rotation.set(Math.sin(a) * 0.17, 0, -Math.cos(a) * 0.17);
      lamba.add(ayak);
    }
    const kafa = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.22, 20, 1, true), new THREE.MeshStandardMaterial({ color: '#151515', side: THREE.DoubleSide, metalness: 0.5, roughness: 0.4 }));
    kafa.position.y = 1.5;
    kafa.rotation.x = 0.4;
    lamba.add(kafa);
    const lh = hale('#FFB56A', 1.2, 0.6);
    lh.position.set(0, 1.42, 0.08);
    lamba.add(lh);
    g.add(lamba);
    g.add(bitki(3.05, -1.0, 1.25));
    // halı
    const hali = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.4), mat({ map: tuval('halikoyu', 256, 256, (gg, w) => {
      gg.fillStyle = '#2b2b30';
      gg.fillRect(0, 0, w, w);
      gg.strokeStyle = '#4a4a52';
      gg.lineWidth = 6;
      gg.strokeRect(10, 10, w - 20, w - 20);
      gg.globalAlpha = 0.2;
      for (let i = 0; i < 3000; i++) {
        gg.fillStyle = rnd() > 0.5 ? '#fff' : '#000';
        gg.fillRect(rnd() * w, rnd() * w, 1, 1);
      }
    }), roughness: 1 }));
    hali.rotation.x = -Math.PI / 2;
    hali.position.set(0, 0.006, 0.05);
    g.add(hali);
    const dolap = gardirop('cam');
    dolap.position.set(DOLAP_X, 0, -1.12);
    g.add(dolap);
    return {
      g,
      dolap,
      isik: [
        { renk: '#FFB15E', g: 2.0, x: 0, y: 2.3, z: -0.9, mesafe: 3.0 },
        { renk: '#FFD9A6', g: 0, x: DOLAP_X, y: 1.9, z: -0.55, mesafe: 2.4, bagli: 'dolap' },
        { renk: '#FF7A9A', g: 0.7, x: 0, y: 2.0, z: -1.2, mesafe: 2.0 },
      ],
      guncelle(t) {
        yazi.material.opacity = Math.sin(t * 13) > 0.995 ? 0.55 : 0.95 + 0.05 * Math.sin(t * 3); // ara sıra neon kırpışması
        ampuller.forEach((h, i) => (h.material.opacity = 0.7 + 0.06 * Math.sin(t * 2 + i)));
      },
      zemin: '#0d0b0c',
    };
  }

  // ---------- TERAS ----------
  function teras() {
    const g = new THREE.Group();
    const zemin = new THREE.Mesh(new THREE.PlaneGeometry(10, 8), mat({ map: tahta('#6a4a33', '#8a6345', 'tik'), roughness: 0.7 }));
    zemin.rotation.x = -Math.PI / 2;
    zemin.rotation.z = Math.PI / 2;
    zemin.position.set(0, 0, 2.2);
    g.add(zemin);
    const gok = new THREE.Mesh(new THREE.PlaneGeometry(26, 13), new THREE.MeshBasicMaterial({ map: geceManzara('teras', 0.72), toneMapped: false }));
    gok.position.set(0, 3.2, -11);
    g.add(gok);
    // cam korkuluk
    const camM = new THREE.MeshPhysicalMaterial({ color: '#9fb3c8', transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0.1, depthWrite: false });
    const metal = mat({ color: '#1b1b1f', metalness: 0.7, roughness: 0.35 });
    kutu(9, 1.0, 0.02, camM, 0, 0.55, -1.6, g);
    kutu(9, 0.04, 0.06, metal, 0, 1.07, -1.6, g);
    for (let x = -4; x <= 4; x += 1.1) kutu(0.04, 1.05, 0.04, metal, x, 0.53, -1.6, g);
    // ampul zincirleri tepede
    const zincirler = [
      ampulZinciri(new THREE.Vector3(-2.2, 2.45, -1.5), new THREE.Vector3(2.2, 2.4, -1.5), 0.5, 0.2, '#FFC98A', g),
      ampulZinciri(new THREE.Vector3(-3, 2.9, -0.4), new THREE.Vector3(3, 2.95, 0.4), 0.5, 0.24, '#FFD29A', g),
    ];
    // fenerler ve saksılar
    const fenerler = [];
    for (const [x, z] of [[-0.95, -0.9], [0.95, -1.0]]) {
      const f = new THREE.Group();
      f.position.set(x, 0, z);
      kutu(0.22, 0.4, 0.22, new THREE.MeshPhysicalMaterial({ color: '#fff', transparent: true, opacity: 0.12, roughness: 0.1 }), 0, 0.2, 0, f);
      for (const [dx, dz] of [[-0.1, -0.1], [0.1, -0.1], [-0.1, 0.1], [0.1, 0.1]]) kutu(0.02, 0.42, 0.02, metal, dx, 0.21, dz, f);
      kutu(0.26, 0.03, 0.26, metal, 0, 0.42, 0, f);
      const mum = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.12, 12), mat({ color: '#f5ead6' }));
      mum.position.y = 0.08;
      f.add(mum);
      const alev = hale('#FFB45E', 0.5, 0.9);
      alev.position.y = 0.2;
      f.add(alev);
      fenerler.push(alev);
      g.add(f);
    }
    g.add(bitki(-1.9, -1.15, 1.5));
    g.add(bitki(2.0, -1.2, 1.3));
    // yer minderi
    const minder = yuvarlakKutu(0.6, 0.12, 0.6, 0.05, mat({ color: '#c47a5a', roughness: 1 }));
    minder.position.set(-1.45, 0.06, -0.35);
    g.add(minder);
    return {
      g,
      dolap: null,
      isik: [
        { renk: '#FFC98A', g: 1.6, x: 0, y: 2.5, z: -1.0, mesafe: 3.5 },
        { renk: '#FFB45E', g: 0.9, x: -0.95, y: 0.4, z: -0.85, mesafe: 1.8 },
        { renk: '#FFB45E', g: 0.9, x: 0.95, y: 0.4, z: -0.95, mesafe: 1.8 },
      ],
      guncelle(t) {
        zincirler.forEach((z) => zincirTitret(z, t));
        fenerler.forEach((f, i) => {
          const s = 0.48 + 0.05 * Math.sin(t * 9 + i * 3) + 0.03 * Math.sin(t * 23 + i);
          f.scale.set(s, s * 1.1, 1);
        });
      },
      zemin: '#07091a',
    };
  }

  // ---------- SAHNE (dans) ----------
  function dansSahnesi() {
    const g = new THREE.Group();
    const zemin = new THREE.Mesh(new THREE.PlaneGeometry(12, 8), new THREE.MeshStandardMaterial({ color: '#0b0a10', roughness: 0.22, metalness: 0.5 }));
    zemin.rotation.x = -Math.PI / 2;
    zemin.position.set(0, 0, 1.5);
    g.add(zemin);
    // ayağın altında ışık halkası
    const halkaDoku = tuval('halka', 256, 256, (gg, w) => {
      const r = gg.createRadialGradient(w / 2, w / 2, w * 0.3, w / 2, w / 2, w / 2);
      r.addColorStop(0, 'rgba(255,255,255,0)');
      r.addColorStop(0.75, 'rgba(255,255,255,0.9)');
      r.addColorStop(1, 'rgba(255,255,255,0)');
      gg.fillStyle = r;
      gg.fillRect(0, 0, w, w);
    });
    const halka = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7), new THREE.MeshBasicMaterial({ map: halkaDoku, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, color: '#ff8a5c' }));
    halka.rotation.x = -Math.PI / 2;
    halka.position.y = 0.008;
    g.add(halka);
    // ışık duvarı: dikey çubuklar
    const n = 28;
    const cubuk = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 3.2, 0.04), new THREE.MeshBasicMaterial({ toneMapped: false }), n);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      m4.makeTranslation(-3.1 + (i * 6.2) / (n - 1), 1.75, -2.6);
      cubuk.setMatrixAt(i, m4);
      cubuk.setColorAt(i, new THREE.Color('#000'));
    }
    g.add(cubuk);
    kutu(14, 4, 0.02, new THREE.MeshBasicMaterial({ color: '#050407' }), 0, 2, -2.66, g);
    // tavan kafesi ve spot ışık huzmeleri
    const kafes = mat({ color: '#2a2a30', metalness: 0.8, roughness: 0.3 });
    kutu(7, 0.08, 0.08, kafes, 0, 3.3, -1.2, g);
    const huzmeDoku = tuval('huzme', 64, 256, (gg, w, h) => {
      const r = gg.createLinearGradient(0, 0, 0, h);
      r.addColorStop(0, 'rgba(255,255,255,0.9)');
      r.addColorStop(1, 'rgba(255,255,255,0)');
      gg.fillStyle = r;
      gg.fillRect(0, 0, w, h);
      const y = gg.createLinearGradient(0, 0, w, 0);
      y.addColorStop(0, 'rgba(0,0,0,1)');
      y.addColorStop(0.5, 'rgba(0,0,0,0)');
      y.addColorStop(1, 'rgba(0,0,0,1)');
      gg.globalCompositeOperation = 'destination-out';
      gg.fillStyle = y;
      gg.fillRect(0, 0, w, h);
    }, { renkli: true });
    const huzmeler = [];
    const renkler = ['#FF9A4D', '#FF5FA8', '#9B7BFF', '#FFC27A'];
    [-1.6, -0.55, 0.55, 1.6].forEach((x, i) => {
      const pv = new THREE.Group();
      pv.position.set(x, 3.25, -1.2);
      const koni = new THREE.Mesh(new THREE.ConeGeometry(0.75, 3.6, 24, 1, true), new THREE.MeshBasicMaterial({ map: huzmeDoku, color: renkler[i], transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      koni.position.y = -1.8;
      pv.add(koni);
      const kafa = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.16, 12), kafes);
      pv.add(kafa);
      g.add(pv);
      huzmeler.push({ pv, koni, faz: i * 1.3, renk: new THREE.Color(renkler[i]) });
    });
    const renk = new THREE.Color();
    const PAL = [new THREE.Color('#F2A65A'), new THREE.Color('#E879A6'), new THREE.Color('#9B7BFF')];
    return {
      g,
      dolap: null,
      isik: [
        { renk: '#FF7A5C', g: 1.2, x: -1.2, y: 2.5, z: -0.6, mesafe: 4 },
        { renk: '#9B7BFF', g: 1.2, x: 1.2, y: 2.5, z: -0.6, mesafe: 4 },
        { renk: '#FFC27A', g: 0.6, x: 0, y: 0.3, z: 0.8, mesafe: 2.5 },
      ],
      guncelle(t, dt, ctx) {
        const hiz = ctx.dans ? 1 : 0.35;
        for (let i = 0; i < n; i++) {
          const u = i / (n - 1);
          const dalga = 0.5 + 0.5 * Math.sin(t * 2.2 * hiz * 2 + u * 9);
          const nabiz = ctx.dans ? 0.5 + 0.5 * Math.sin(t * 7.5) : 0.6;
          // uygulamanın renkleri arasında gezinir: turuncu → pembe → mor
          const k = 0.5 + 0.5 * Math.sin(u * 4 + t * 0.4 * hiz);
          renk.copy(k < 0.5 ? PAL[0] : PAL[1]).lerp(k < 0.5 ? PAL[1] : PAL[2], k < 0.5 ? k * 2 : k * 2 - 1);
          renk.multiplyScalar(0.06 + 1.3 * Math.pow(dalga, 3) * nabiz);
          cubuk.setColorAt(i, renk);
        }
        cubuk.instanceColor.needsUpdate = true;
        for (const h of huzmeler) {
          h.pv.rotation.z = Math.sin(t * 0.9 * (0.6 + hiz) + h.faz) * 0.45;
          h.pv.rotation.x = 0.25 + Math.cos(t * 0.7 * (0.6 + hiz) + h.faz) * 0.25;
          h.koni.material.opacity = ctx.dans ? 0.28 + 0.14 * Math.sin(t * 6 + h.faz) : 0.22;
        }
        halka.material.opacity = 0.55 + 0.25 * Math.sin(t * (ctx.dans ? 6 : 1.5));
        halka.rotation.z = t * 0.2;
      },
      zemin: '#050407',
    };
  }

  // ---------- yönetim ----------
  function kur(ad) {
    const anahtar = ad === 'oda' ? 'oda_' + beden : ad;
    if (!sahneler[anahtar]) {
      tohum = 7 + anahtar.length * 31;
      const s = ad === 'oda' ? (beden === 'erkek' ? erkekLoft() : kadinOda()) : ad === 'teras' ? teras() : ad === 'sahne' ? dansSahnesi() : null;
      if (!s) return null;
      s.g.visible = false;
      kok.add(s.g);
      sahneler[anahtar] = s;
    }
    return sahneler[anahtar];
  }
  let kapak = 0;
  let kapakHedef = 0;
  const durum = {
    get ad() {
      return aktifAd;
    },
    get dolapVar() {
      return !!aktif?.dolap;
    },
    get kapak() {
      return kapak;
    },
    kok,
    sec(ad, b, gecici = false) {
      if (!MEKANLAR.includes(ad)) ad = 'oda';
      beden = b || beden;
      const s = ad === 'sade' ? null : kur(ad);
      if (aktif) aktif.g.visible = false;
      aktif = s;
      aktifAd = ad;
      if (s) {
        s.g.visible = true;
        isikKur(s.isik);
        renderer.setClearColor(s.zemin, 1);
      } else {
        isikKur([]);
        renderer.setClearColor(0x000000, 0);
      }
      if (!gecici) kapak = kapakHedef = 0;
      if (s?.dolap) kapakAyarla(s.dolap, gecici ? kapak : 0);
    },
    kapakAc(ac) {
      kapakHedef = ac ? 1 : 0;
    },
    // önizleme/portre çekerken arka plan görünmesin
    gizle(g) {
      kok.visible = !g;
      for (const l of isiklar) l.visible = !g;
      if (g) renderer.setClearColor(0x000000, 0);
      else if (aktif) renderer.setClearColor(aktif.zemin, 1);
    },
    guncelle(t, dt, ctx) {
      if (!aktif) return;
      if (aktif.dolap) {
        const hiz = kapakHedef > kapak ? 1 / 1.0 : 1 / 0.7;
        kapak = kapakHedef > kapak ? Math.min(kapakHedef, kapak + dt * hiz) : Math.max(kapakHedef, kapak - dt * hiz);
        kapakAyarla(aktif.dolap, kapak);
      }
      for (const l of isiklar) {
        if (l.userData.bagli === 'dolap') l.intensity = 1.3 * Math.min(1, kapak * 1.3);
        l.position.x = (l.userData.x ?? 0) + kok.position.x; // oda kayarken ışıklar da kaysın
      }
      aktif.guncelle(t, dt, ctx);
    },
  };
  return durum;
}
