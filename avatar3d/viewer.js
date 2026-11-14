// Hohla 3D avatar görüntüleyicisi: MakeHuman tabanlı karakter, yüz kaydırıcıları, gardırop, dans.
// Uygulama bu sayfayı web'de iframe, Android'de WebView olarak açar ve ayarları mesajla gönderir.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { mekanKur, DOLAP_X } from './mekan.js';

const SURUM = '55';
const q = new URLSearchParams(location.search);
const V3 = THREE.Vector3;
const Q = THREE.Quaternion;

// ---------------- sahne ----------------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: q.has('cek') });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 60);
scene.add(new THREE.HemisphereLight('#FFF4E6', '#3A2C40', 1.15));
const key = new THREE.DirectionalLight('#FFF1DF', 2.1);
key.position.set(-3, 5, 6);
scene.add(key);
const rimA = new THREE.DirectionalLight('#FFB45E', 1.6);
rimA.position.set(4, 3, -4);
scene.add(rimA);
const rimB = new THREE.DirectionalLight('#B57BFF', 1.2);
rimB.position.set(-4, 2, -3);
scene.add(rimB);
for (let i = 0; i < 5; i++) {
  const sh = new THREE.Mesh(new THREE.CircleGeometry(0.42 - i * 0.07, 40), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.08, depthWrite: false }));
  sh.rotation.x = -Math.PI / 2;
  sh.position.y = 0.001 + i * 0.0003;
  scene.add(sh);
}

// Mekân (arka plan sahnesi): uygulama seçer; test sayfasında ?mekan=oda|teras|sahne
const mekan = mekanKur(THREE, scene, renderer);
mekan.sec(q.get('mekan') || 'sade', q.get('b') === 'erkek' ? 'erkek' : 'kadin');

const draco = new DRACOLoader().setDecoderPath('./vendor/draco/');
const loader = new GLTFLoader().setDRACOLoader(draco);
const texLoader = new THREE.TextureLoader();

// Gölgelendiricileri çizimden önce, arka planda derle (yoksa ilk karede ve her yeni saçta ekran donar).
// Gizli nesneler derlemeye girmesin diye kısa süre görünür yapılır; derleme çizim yapmaz, ekrana yansımaz.
async function onDerle(o) {
  if (!renderer.compileAsync) return;
  const gizli = [];
  o.traverse((c) => {
    if (!c.visible) {
      gizli.push(c);
      c.visible = true;
    }
  });
  try {
    const p = renderer.compileAsync(o, camera, scene);
    for (const c of gizli) c.visible = false;
    // sayfa görünmezken (arka plandaki sekme/uygulama) derleme hiç bitmeyebilir: en çok 1.5 sn bekle
    await Promise.race([p, new Promise((r) => setTimeout(r, 1500))]);
  } catch {
    for (const c of gizli) c.visible = false;
  }
}

// ---------------- iletişim ----------------
function post(type, extra = {}) {
  const msg = { source: 'hohla-avatar', type, ...extra };
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  else if (window.parent && window.parent !== window) window.parent.postMessage(msg, '*');
}
const bar = document.getElementById('bar');
const yuk = document.getElementById('yuk');

// ---------------- varlık seti ----------------
const sets = {};
function loadSet(beden) {
  if (sets[beden]) return sets[beden];
  sets[beden] = (async () => {
    const man = await fetch(`avatar_${beden}.json?v=${SURUM}`).then((r) => r.json());
    const gltf = await loader.loadAsync(`avatar_${beden}.glb?v=${SURUM}`, (e) => {
      if (e.total) bar.style.width = `${Math.round((e.loaded / e.total) * 100)}%`;
    });
    return prepare(man, gltf.scene);
  })();
  return sets[beden];
}

const meshesOf = (o) => {
  const out = [];
  o.traverse((c) => c.isMesh && out.push(c));
  return out;
};

// Maskeler dosyada üç 8 bitlik parça (_ortu0-2): sıkıştırma 0-255'i bozmadan taşır. Yüklerken tek 24 bitlik değere birleştirilir.
function birlestir(geo, ad) {
  const a0 = geo.attributes[ad + '0'];
  if (!a0) return;
  const a1 = geo.attributes[ad + '1'];
  const a2 = geo.attributes[ad + '2'];
  const n = a0.count;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.round(a0.getX(i)) | (Math.round(a1.getX(i)) << 8) | (Math.round(a2.getX(i)) << 16);
  geo.setAttribute(ad, new THREE.BufferAttribute(out, 1));
  for (let k = 0; k < 3; k++) geo.deleteAttribute(ad + k);
}

function prepare(man, root) {
  const model = new THREE.Group();
  model.add(root);
  const parts = {};
  const morphers = [];
  const coverables = []; // beden: giyilen kıyafetin altı silinir (_ortu)
  const hatCoverables = []; // saç: şapkanın altı ve tepeden taşan kısmı silinir (_sapka)
  const icMats = []; // beden ve iç katman: giyilen kıyafetin altında 4-5 mm içe çekilir (_ic)
  const bone = (n) => root.getObjectByName(n);
  const byName = (n) => root.getObjectByName(n);

  const hairLike = (k) => k === 'sac' || k === 'sakal' || k === 'biyik' || k === 'kas' || k === 'kirpik' || k === 'gozluk';
  const setup = (obj, kat) => {
    const extra = [];
    // Ombre aralığı saçın tamamından (kahkül nakledilmiş saç birden çok parçadan oluşur)
    let sacBB = null;
    if (kat === 'sac') {
      sacBB = new THREE.Box3();
      for (const mm of meshesOf(obj)) {
        mm.geometry.computeBoundingBox();
        sacBB.union(mm.geometry.boundingBox);
      }
    }
    for (const m of meshesOf(obj)) {
      m.frustumCulled = false;
      if (m.morphTargetDictionary) morphers.push(m);
      for (const ek of ['', 'v', 'w', 'x']) {
        birlestir(m.geometry, '_ortu' + ek);
        birlestir(m.geometry, '_ic' + ek);
      }
      const at = m.geometry.attributes;
      const ortulur = !!(at._ortu || at._ortuv || at._ortuw || at._ortux);
      // örtülü üçgenleri gizlenenler: beden ve üstündeki giysinin tamamen örttüğü iç katman kıyafetler
      if (ortulur || at._sapka) {
        m.userData.idx0 = m.geometry.index.array.slice();
        if (ortulur) coverables.push(m);
        if (at._sapka) hatCoverables.push(m);
      }
      const mats = [].concat(m.material);
      for (const mt of mats) {
        mt.needsUpdate = true;
        const kumas = !['beden', 'goz', 'sac', 'sakal', 'biyik', 'kas', 'kirpik', 'gozluk', 'kabuk'].includes(kat);
        // Kumaş mat olur: paketlerdeki parlak (metalik) ayarlar gömleği deri gibi gösteriyordu
        if (kumas && mt.isMeshStandardMaterial) {
          mt.metalness = 0;
          mt.roughness = Math.max(mt.roughness ?? 1, kat === 'ayakkabi' ? 0.55 : 0.82);
        }
        const icVar = !!(at._ic || at._icv || at._icw || at._icx);
        if (icVar || kumas) {
          const u = yamala(mt, { derinlik: icVar ? (kat === 'beden' ? 0.005 : 0.011) : 0, ic: kumas });
          if (icVar) {
            icMats.push(u);
            (m.userData.icU ??= []).push(u);
          }
        }
        // Kesik (alfa) kenarlar kenar yumuşatmayla pürüzsüz
        if (kat !== 'beden' && kat !== 'goz') mt.alphaToCoverage = true;
        // Üst üste binen yüzeylerde dış katman öne çıksın (titreşme olmasın)
        if (['ust', 'elbise', 'takim'].includes(kat)) {
          mt.polygonOffset = true;
          mt.polygonOffsetFactor = -1;
          mt.polygonOffsetUnits = -2;
        } else if (kat === 'beden') {
          mt.polygonOffset = true;
          mt.polygonOffsetFactor = 1;
          mt.polygonOffsetUnits = 2;
        }
        if (kat === 'goz') {
          mt.transparent = true;
          mt.depthWrite = false;
          m.renderOrder = 2;
        } else if ((kat === 'sakal' || kat === 'biyik') && at._kat) {
          // Kendi sakallarımız: katmanlı tüy. İçten dışa sırayla çizilir (aynı ağ içinde dizin sırası)
          mt.transparent = true;
          mt.depthWrite = true;
          mt.alphaTest = 0.02;
          mt.alphaToCoverage = false;
          mt.side = THREE.FrontSide;
          mt.roughness = 0.85;
          mt.metalness = 0;
          mt.polygonOffset = true;
          mt.polygonOffsetFactor = -1;
          mt.polygonOffsetUnits = -2;
          m.renderOrder = 1;
          sakalYamala(mt);
        } else if (kat === 'kabuk' || (kat === 'sakal' && at._kenar)) {
          // Saç kabuğu: saçın altındaki deriyi saç rengine boyar; saç çizgisinde yumuşak solar
          mt.transparent = true;
          mt.depthWrite = false;
          mt.alphaTest = 0;
          mt.alphaToCoverage = false;
          mt.side = THREE.FrontSide;
          mt.polygonOffset = true;
          mt.polygonOffsetFactor = -1;
          mt.polygonOffsetUnits = -2;
          m.renderOrder = 0;
          kabukYamala(mt, m, kat === 'sakal');
        } else if (hairLike(kat)) {
          // 1. geçiş opak çekirdek, 2. geçiş yumuşak saydam kenar. Çekirdek derinlik yazmalı: glTF'de
          // saydam (BLEND) gelen malzemede kapalı geliyor, beden sonradan saçın üstüne çiziliyordu
          mt.transparent = false;
          mt.depthWrite = true;
          mt.alphaTest = 0.5;
          mt.side = THREE.DoubleSide;
          const katmanli = kat === 'sac' && !!m.geometry.attributes._kat;
          if (katmanli) {
            mt.roughness = 0.72;
            mt.metalness = 0;
            mt.side = THREE.FrontSide;
            mt.alphaTest = 0.5;
            mt.alphaToCoverage = true;
          }
          if (kat === 'sac') {
            if (!m.userData.ombre) {
              const bb = sacBB;
              m.userData.ombre = { uUcRenk: { value: new THREE.Color() }, uOmbre: { value: 0 }, uKonum: { value: 0.5 }, uYumusak: { value: 0.3 }, uUst: { value: bb.max.y }, uAlt: { value: bb.min.y } };
            }
            ombreYamala(mt, m.userData.ombre, katmanli);
          }
          if (katmanli) continue;
          const soft = mt.clone();
          if (kat === 'sac') ombreYamala(soft, m.userData.ombre);
          soft.alphaTest = 0;
          soft.alphaToCoverage = false;
          soft.transparent = true;
          soft.depthWrite = false;
          const c = m.isSkinnedMesh ? new THREE.SkinnedMesh(m.geometry, soft) : new THREE.Mesh(m.geometry, soft);
          if (m.isSkinnedMesh) c.bind(m.skeleton, m.bindMatrix);
          c.morphTargetInfluences = m.morphTargetInfluences;
          c.morphTargetDictionary = m.morphTargetDictionary;
          c.position.copy(m.position);
          c.quaternion.copy(m.quaternion);
          c.scale.copy(m.scale);
          c.renderOrder = 1;
          c.frustumCulled = false;
          extra.push([m, c, soft]);
        } else {
          mt.transparent = false;
          mt.depthWrite = true;
          mt.alphaTest = kat === 'beden' ? 0 : 0.5;
          mt.side = kat === 'beden' ? THREE.FrontSide : THREE.DoubleSide;
        }
      }
    }
    for (const [m, c, soft] of extra) {
      m.parent.add(c);
      m.userData.soft = soft;
      m.userData.softMesh = c;
    }
  };

  const body = byName('beden');
  setup(body, 'beden');
  const eyes = byName('gozler');
  setup(eyes, 'goz');
  for (const p of man.parcalar) {
    const o = byName(p.mesh);
    if (!o) continue;
    setup(o, p.kat);
    parts[p.mesh] = { ...p, obj: o };
    o.visible = false;
    for (const m of meshesOf(o)) if (m.userData.softMesh) m.userData.softMesh.visible = false;
  }

  // Kollar: A duruşundan doğal duruşa
  root.updateMatrixWorld(true);
  const rest = new Map();
  const names = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head', 'clavicle_l', 'clavicle_r', 'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r', 'hand_l', 'hand_r', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'foot_l', 'foot_r'];
  const B = {};
  for (const n of names) B[n] = bone(n);
  const aim = (b, child, dir) => {
    if (!b || !child) return;
    const a = new V3().setFromMatrixPosition(b.matrixWorld);
    const c = new V3().setFromMatrixPosition(child.matrixWorld);
    rotWorld(b, new Q().setFromUnitVectors(c.sub(a).normalize(), dir.normalize()));
  };
  if (!q.has('ham')) {
    const d = durusSec(man.beden, q.get('durus'));
    if (d === 'eski') {
      aim(B.upperarm_l, B.lowerarm_l, new V3(0.2, -1, 0.02));
      aim(B.upperarm_r, B.lowerarm_r, new V3(-0.2, -1, 0.02));
      aim(B.lowerarm_l, B.hand_l, new V3(0.08, -1, 0.18));
      aim(B.lowerarm_r, B.hand_r, new V3(-0.08, -1, 0.18));
    } else durusUygula(root, B, d);
  }
  for (const n of names) if (B[n]) rest.set(n, { q: B[n].quaternion.clone(), p: B[n].position.clone() });

  const box = new THREE.Box3().setFromObject(body);
  const H = box.max.y - box.min.y;
  const headPos = new V3().setFromMatrixPosition(B.head.matrixWorld);
  const scarf = buildScarf(B, man.beden === 'kadin');
  // Yüz noktaları (gözlerin ortasından ölçülür): kamera bu noktalara yaklaşır
  const eb = new THREE.Box3().setFromObject(eyes);
  const e = eb.getCenter(new V3());
  const nok = {
    yuz: e.clone().add(new V3(0, -0.035, 0)),
    goz: e.clone().add(new V3(0, 0, 0.01)),
    kas: e.clone().add(new V3(0, 0.02, 0.015)),
    burun: e.clone().add(new V3(0, -0.035, 0.04)),
    agiz: e.clone().add(new V3(0, -0.073, 0.03)),
    cene: e.clone().add(new V3(0, -0.085, 0.0)),
    kulak: e.clone().add(new V3(-0.07, -0.03, -0.075)),
    sac: e.clone().add(new V3(0, 0.045, -0.04)),
    kafa: e.clone().add(new V3(0, 0.015, -0.03)),
  };
  return { man, model, root, body, eyes, parts, morphers, coverables, hatCoverables, icMats, B, rest, H, headY: headPos.y, nok, scarf, skinCache: {}, eyeCache: {}, setup, sacYuk: {} };
}

// Malzeme yaması (ekran kartında):
//  - içe çekme: giyilen kıyafetin altında kalan köşeler normal boyunca birkaç mm içe (taşan ten/kumaş görünmesin)
//  - kumaşın içi: arka yüz gölgede kalır (etek ucu ve kol ağzından içi parlak görünüyordu)
function yamala(mt, { derinlik = 0, ic = false } = {}) {
  const u = { uIcMask: { value: 0 }, uIcMaskV: { value: 0 }, uIcMaskW: { value: 0 }, uIcMaskX: { value: 0 }, uInset: { value: derinlik } };
  const icVar = derinlik > 0;
  mt.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    if (icVar) {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
attribute float _ic;
attribute float _icv;
attribute float _icw;
attribute float _icx;
uniform int uIcMask;
uniform int uIcMaskV;
uniform int uIcMaskW;
uniform int uIcMaskX;
uniform float uInset;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
if (((int(_ic + 0.5) & uIcMask) | (int(_icv + 0.5) & uIcMaskV) | (int(_icw + 0.5) & uIcMaskW) | (int(_icx + 0.5) & uIcMaskX)) != 0) transformed -= normalize(objectNormal) * uInset;`);
    }
    if (ic) sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
if (!gl_FrontFacing) gl_FragColor.rgb *= 0.42;`);
  };
  mt.customProgramCacheKey = () => `hohla-${icVar ? 1 : 0}${ic ? 1 : 0}`;
  return u;
}

// Saçta kökten uca renk geçişi (ombre: belirgin, sombre: yumuşak). Yükseklik saçın kendi kemik-öncesi
// konumundan ölçülür: 0 = en üst (kök), 1 = en alt uç. Kapalıyken saç tek renk.
// Fade kesimlerde (manifest kabukFade [h, eğim, uzunluk]) yan ve ensede, saçın kesildiği eğik çizgiden
// aşağı kabuk kısa saç gibi görünür ve uzunluk boyunca deriye solar.
// sakal=true: kendi sakallarımız; yoğunluk 1 iken dolu ve koyu, düşük yoğunlukta seyrek tüy
function kabukYamala(mt, m, sakal = false) {
  const u = { uFade: { value: 0 }, uFadeH: { value: 0 }, uFadeE: { value: 0.3 }, uFadeU: { value: 0.04 } };
  m.userData.kabukFade = u;
  mt.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute float _kenar;
attribute float _kok;
attribute float _yan;
attribute float _arka;
varying float vKenar;
varying float vKok;
varying float vYan;
varying float vArka;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vKenar = _kenar;
vKok = _kok;
vYan = _yan;
vArka = _arka;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uFade;
uniform float uFadeH;
uniform float uFadeE;
uniform float uFadeU;
varying float vKenar;
varying float vKok;
varying float vYan;
varying float vArka;`)
      .replace('#include <alphatest_fragment>', `${sakal
  ? 'diffuseColor.rgb *= 0.62; diffuseColor.a = clamp(diffuseColor.a * (0.45 + 1.7 * vKenar), 0.0, 1.0) * smoothstep(0.0, 0.3, vKenar);'
  : 'diffuseColor.a *= smoothstep(0.0, 1.0, vKenar) * 0.92;'}
float fCiz = vKok - (uFadeH - uFadeE * vArka);
diffuseColor.a *= mix(1.0, smoothstep(-uFadeU, -0.002, fCiz), uFade * clamp(vYan, 0.0, 1.0));
#include <alphatest_fragment>`);
  };
  mt.customProgramCacheKey = () => (sakal ? 'hohla-sakal' : 'hohla-kabuk');
}

// Sakal tüyü: doku A = telin yükseklik profili, RGB = tele özgü değer. Her katman profili kendi yüksekliğinde
// eşikler (kök kalın, uç ince); _kenar yoğunluğu hangi tellerin var olduğunu seçer (kenarda seyrelerek biter).
// En alttaki katman deriye hafif bir sakal gölgesi verir.
function sakalYamala(mt) {
  mt.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute float _kat;
attribute float _kenar;
varying float vKat;
varying float vYog;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vKat = _kat;
vYog = _kenar;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vKat;
varying float vYog;`)
      .replace('#include <alphatest_fragment>', `{
  vec3 doku = diffuseColor.rgb / max(diffuse, vec3(0.001));
  float kim = clamp(doku.r, 0.0, 1.0);
  float boy = diffuseColor.a;
  float var1 = smoothstep(kim - 0.04, kim + 0.04, vYog) * step(0.01, boy);
  // dipte sakal gölgesi: kıl aralarından çıplak deri görünmesin (seyrek sakalda hafif)
  float a = vKat < 0.01 ? 0.42 * vYog * vYog : smoothstep(vKat * 0.9 - 0.07, vKat * 0.9 + 0.07, boy) * var1;
  diffuseColor.a = a;
  // kökte koyu, uca doğru açılan kıllar; tel başına ton farkı (düz siyah maske gibi durmasın)
  diffuseColor.rgb = min(diffuse * (vKat < 0.01 ? 0.9 : mix(0.8, 1.7, vKat) * (0.7 + 0.65 * kim)) + vec3(0.025, 0.018, 0.012) * vKat, vec3(1.0));
}
#include <alphatest_fragment>`);
  };
  mt.customProgramCacheKey = () => 'hohla-sakal-tuy';
}

function ombreYamala(mt, u, katmanli = false) {
  mt.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
varying float vOmbreY;`)
      .replace('#include <morphtarget_vertex>', `#include <morphtarget_vertex>
vOmbreY = transformed.y;`);
    if (katmanli) {
      // Katmanlı kabuk saç: her katman dokudaki tel yoğunluğunu kendi yüksekliğine göre eşikler
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
attribute float _kat;
attribute float _kenar;
varying float vKat;
varying float vYog;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
vKat = _kat;
vYog = _kenar;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying float vKat;
varying float vYog;`)
        .replace('#include <alphatest_fragment>', `{
  float yog = diffuseColor.a;
  // Saç çizgisi ve fade: yoğunluk tel deseniyle karşılaştırılır, kenarda teller seyrelerek biter (cetvel çizgisi olmaz)
  float kenar = smoothstep(yog * 0.85 - 0.08, yog * 0.85 + 0.08, vYog);
  float a = vKat < 0.01 ? kenar : smoothstep(vKat * 0.92 - 0.06, vKat * 0.92 + 0.06, yog) * kenar;
  diffuseColor.a = a;
  // dipte gölge, uçta ışık; tel yoğunluğu rengi de oynatır (doku seçilsin, plastik görünmesin)
  diffuseColor.rgb *= mix(0.42, 1.08, vKat) * (0.72 + 0.55 * yog);
}
#include <alphatest_fragment>`);
    }
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vOmbreY;
uniform vec3 uUcRenk;
uniform float uOmbre;
uniform float uKonum;
uniform float uYumusak;
uniform float uUst;
uniform float uAlt;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
if (uOmbre > 0.5) {
  float t = clamp((uUst - vOmbreY) / max(uUst - uAlt, 0.001), 0.0, 1.0);
  float f = smoothstep(uKonum - uYumusak * 0.5, uKonum + uYumusak * 0.5, t);
  // Uçta dokunun yalnızca parlaklığı (telleri) kullanılır, renk seçilen tondan gelir (doku kahverengi tonlu)
  vec3 doku = diffuseColor.rgb / max(diffuse, vec3(0.02));
  float l = dot(doku, vec3(0.299, 0.587, 0.114));
  vec3 uc = uUcRenk * clamp(0.22 + l * 1.5, 0.0, 1.35);
  diffuseColor.rgb = mix(diffuseColor.rgb, uc, f);
}`);
  };
  mt.customProgramCacheKey = () => (katmanli ? 'hohla-ombre-katman' : 'hohla-ombre');
}

// ---------------- dinlenme duruşu ----------------
// Kemikler model uzayında (yüz +z, karakterin solu +x) döndürülür. s: ağırlığın bindiği bacak (+1 sol, -1 sağ, 0 ikisi).
// Kollarda x "dışarı" demektir (sol kolda +x, sağda -x olarak çevrilir). el: elin gideceği nokta (kalça kemiğine göre).
const DURUSLAR = {
  kadin: {
    // zarif: ağırlık sağ bacakta, sol diz içe bükük, sol ayak önde ve topuk kalkık; omuzlar gevşek
    zarif: {
      s: -1, kalca: 0.07, egim: 0.12, don: 0.14, bel: [0.09, 0.09], gogus: -0.03, omuzGeri: 0.07, omuzDus: 0.05, bas: [0.08, 0.1],
      ayak: { genis: -0.05, agirlik: [0.02, 0], serbest: [0.06, 0.1], ac: 0.4, topuk: 0.3, diz: 0.3 },
      kol: { ag: { ust: [0.15, -1, 0.05], alt: [0.04, -1, 0.2], bilek: [-0.1, -1, 0.08] }, sb: { ust: [0.14, -1, 0.1], alt: [0.04, -1, 0.3], bilek: [-0.1, -1, 0.12] } },
      parmak: 0.15,
      avuc: [0.25, 0, -1], // kadın iskeletinde avuç yönü erkeğin tersine ölçüldü
    },
    // rahat: ağırlık sol bacakta, daha hafif; kollar yanda serbest
    rahat: {
      s: 1, kalca: 0.05, egim: 0.08, don: 0.08, bel: [0.055, 0.055], gogus: -0.025, omuzGeri: 0.06, omuzDus: 0.05, bas: [-0.06, -0.08],
      ayak: { genis: -0.04, agirlik: [0.01, 0], serbest: [0.045, 0.07], ac: 0.38, topuk: 0.2, diz: 0.3 },
      kol: { ag: { ust: [0.17, -1, 0.02], alt: [0.08, -1, 0.16], bilek: [-0.1, -1, 0.08] }, sb: { ust: [0.16, -1, 0.07], alt: [0.07, -1, 0.24], bilek: [-0.1, -1, 0.1] } },
      parmak: 0.15,
      avuc: [0.25, 0, -1], // kadın iskeletinde avuç yönü erkeğin tersine ölçüldü
    },
    // belde: ağırlık sağda, sağ el kalçada (dirsek dışarı), sol kol serbest
    belde: {
      s: -1, kalca: 0.07, egim: 0.12, don: 0.14, bel: [0.09, 0.09], gogus: -0.03, omuzGeri: 0.07, omuzDus: 0.05, bas: [0.09, -0.1],
      ayak: { genis: -0.05, agirlik: [0.02, 0], serbest: [0.06, 0.1], ac: 0.4, topuk: 0.3, diz: 0.3 },
      kol: { ag: { el: [0.06, 0.12, 0.0], dirsek: [1, 0, -0.55], bilek: [0.1, -1, 0.6] }, sb: { ust: [0.14, -1, 0.08], alt: [0.04, -1, 0.26], bilek: [-0.1, -1, 0.12] } },
      parmak: 0.15,
      avuc: [0.25, 0, -1], // kadın iskeletinde avuç yönü erkeğin tersine ölçüldü
    },
  },
  erkek: {
    // dik: ayaklar omuz genişliğinde, göğüs açık, omuzlar geride, kollar gövdeden biraz uzak
    dik: {
      s: 0, kalca: 0, egim: 0, don: 0, bel: [0, 0], gogus: -0.07, omuzGeri: 0.12, omuzDus: 0.02, bas: [0, 0],
      ayak: { genis: -0.075, ac: 0.2 },
      kol: { ag: { ust: [0.22, -1, 0.0], alt: [0.1, -1, 0.18], bilek: [-0.2, -1, 0.05] }, sb: { ust: [0.22, -1, 0.0], alt: [0.1, -1, 0.18], bilek: [-0.2, -1, 0.05] } },
      parmak: 0.15,
    },
    // rahat: ağırlık hafif sol bacakta, sağ ayak dışa açık, kollar serbest
    rahat: {
      s: 1, kalca: 0.035, egim: 0.04, don: 0.08, bel: [0.025, 0.025], gogus: -0.04, omuzGeri: 0.08, omuzDus: 0.03, bas: [-0.03, -0.1],
      ayak: { genis: -0.06, agirlik: [0, 0], serbest: [-0.04, 0.07], ac: 0.35, topuk: 0.06, diz: 0.1 },
      kol: { ag: { ust: [0.22, -1, 0.02], alt: [0.1, -1, 0.2], bilek: [-0.2, -1, 0.05] }, sb: { ust: [0.2, -1, 0.08], alt: [0.08, -1, 0.3], bilek: [-0.2, -1, 0.08] } },
      parmak: 0.2,
    },
    // önde: eller kasığın önünde gevşekçe birleşir
    onde: {
      s: 0, kalca: 0, egim: 0, don: 0, bel: [0, 0], gogus: -0.06, omuzGeri: 0.08, omuzDus: 0.03, bas: [0, 0],
      ayak: { genis: -0.06, ac: 0.22 },
      kol: { ag: { el: [-0.11, -0.12, 0.19], dirsek: [1, 0, -0.15], bilek: [-0.35, -1, 0.25] }, sb: { el: [-0.07, -0.17, 0.17], dirsek: [1, 0, -0.15], bilek: [-0.35, -1, 0.25] } },
      parmak: 0.25,
    },
  },
};
// Metehan'ın seçimi (2026-11-14): kadında zarif, erkekte dik. ?durus=eski eski kol duruşunu verir.
const DURUS_VARSAYILAN = { kadin: 'zarif', erkek: 'dik' };
function durusSec(beden, ad) {
  const t = DURUSLAR[beden] || {};
  const a = ad && (ad === 'eski' || t[ad]) ? ad : DURUS_VARSAYILAN[beden] || 'eski';
  return a === 'eski' ? 'eski' : t[a];
}
function durusUygula(root, B, d) {
  const wp = (b) => new V3().setFromMatrixPosition(b.matrixWorld);
  const wq = (b) => b.getWorldQuaternion(new Q());
  const don = (b, eks, ang) => b && ang && rotWorld(b, new Q().setFromAxisAngle(eks, ang));
  const X = new V3(1, 0, 0), Y = new V3(0, 1, 0), Z = new V3(0, 0, 1);
  const hedefe = (b, child, nokta) => {
    const a = wp(b);
    rotWorld(b, new Q().setFromUnitVectors(wp(child).sub(a).normalize(), nokta.clone().sub(a).normalize()));
  };
  const dogrult = (b, child, dir) => hedefe(b, child, wp(b).add(dir));
  const dunyaQ = (b, w) => {
    b.quaternion.copy(wq(b.parent).invert().multiply(w));
    b.updateMatrixWorld(true);
  };
  // iki kemikli zincir: üst kemik, alt kemik, uç; uç hedef noktaya, diz/dirsek "kutup" yönüne bakar
  const zincir = (u, a, uc, T, kutup) => {
    const H = wp(u);
    const la = H.distanceTo(wp(a));
    const lb = wp(a).distanceTo(wp(uc));
    const dir = T.clone().sub(H);
    const dd = Math.min(dir.length(), (la + lb) * 0.999);
    dir.normalize();
    const cos = Math.max(-1, Math.min(1, (la * la + dd * dd - lb * lb) / (2 * la * dd)));
    const sin = Math.sqrt(1 - cos * cos);
    const p = kutup.clone().sub(dir.clone().multiplyScalar(kutup.dot(dir))).normalize();
    const K = H.clone().add(dir.clone().multiplyScalar(la * cos)).add(p.multiplyScalar(la * sin));
    hedefe(u, a, K);
    hedefe(a, uc, H.clone().add(dir.multiplyScalar(dd)));
  };
  root.updateMatrixWorld(true);
  const s = d.s;
  // ayakların ilk yeri ve yönü (yere basan nokta korunur)
  const ayak = {};
  for (const y of ['l', 'r']) {
    const f = B['foot_' + y];
    const top = root.getObjectByName('ball_' + y);
    ayak[y] = { p: wp(f), q: wq(f), top, topY: top ? wp(top).y : null };
  }
  // kalça: ağırlık bacağına kayar, o taraf yükselir, serbest kalça öne döner
  const pel = B.pelvis;
  const pw = wp(pel).add(new V3(s * d.kalca, 0, 0));
  pel.position.copy(pel.parent.worldToLocal(pw));
  pel.updateMatrixWorld(true);
  don(pel, Z, s * d.egim);
  don(pel, Y, s * d.don);
  // bel ters yöne: omuzlar kalçanın tersine eğilir, göğüs öne bakar
  don(B.spine_01, Z, -s * d.bel[0]);
  don(B.spine_02, Z, -s * d.bel[1]);
  don(B.spine_02, Y, -s * d.don * 0.8);
  don(B.spine_03, X, d.gogus);
  // omuzlar geride ve gevşek
  don(B.clavicle_l, Y, d.omuzGeri);
  don(B.clavicle_r, Y, -d.omuzGeri);
  don(B.clavicle_l, Z, -d.omuzDus);
  don(B.clavicle_r, Z, d.omuzDus);
  // baş: kalça/omuz eğiminin bir kısmını toplar, üstüne hafif yana yatma ve dönüş
  don(B.neck_01, Z, s * (d.bel[0] + d.bel[1] - d.egim) * 0.6);
  don(B.head, Z, d.bas[0]);
  don(B.head, Y, d.bas[1]);
  // bacaklar: ayak hedefleri, sonra iki kemikli çözüm (yetişmezse kalça biraz iner)
  const A = d.ayak || {};
  const yanS = { l: 1, r: -1 };
  const hedef = {};
  for (const y of ['l', 'r']) {
    const agirlik = s ? yanS[y] === s : false;
    const serbest = s ? !agirlik : false;
    const o = (agirlik ? A.agirlik : serbest ? A.serbest : null) || [0, 0];
    hedef[y] = { T: ayak[y].p.clone().add(new V3(yanS[y] * ((A.genis || 0) - o[0]), 0, o[1])), serbest, agirlik };
  }
  let in_ = 0;
  for (const y of ['l', 'r']) {
    const H = wp(B['thigh_' + y]);
    const L = wp(B['thigh_' + y]).distanceTo(wp(B['calf_' + y])) + wp(B['calf_' + y]).distanceTo(wp(B['foot_' + y]));
    const fazla = H.distanceTo(hedef[y].T) - L * 0.997;
    if (fazla > in_) in_ = fazla;
  }
  if (in_ > 0) {
    pel.position.copy(pel.parent.worldToLocal(wp(pel).add(new V3(0, -in_, 0))));
    pel.updateMatrixWorld(true);
  }
  for (const y of ['l', 'r']) {
    const h = hedef[y];
    const th = B['thigh_' + y], ca = B['calf_' + y], ft = B['foot_' + y];
    const kutup = new V3(h.serbest ? -yanS[y] * (A.diz || 0) : 0, 0, 1);
    const yon = new Q().setFromAxisAngle(Y, yanS[y] * (A.ac || 0) * (h.agirlik ? 0.5 : 1));
    const topuk = h.serbest ? A.topuk || 0 : 0;
    const coz = () => {
      zincir(th, ca, ft, h.T, kutup);
      const w = yon.clone().multiply(ayak[y].q);
      dunyaQ(ft, topuk ? new Q().setFromAxisAngle(X, topuk).multiply(w) : w);
    };
    coz();
    // topuk kalkınca ayak ucu yere değsin
    if (ayak[y].top && topuk) {
      h.T.y += ayak[y].topY - wp(ayak[y].top).y;
      coz();
    }
  }
  // kollar
  for (const [y, k] of [['l', s === -1 ? 'sb' : 'ag'], ['r', s === -1 ? 'ag' : 'sb']]) {
    const kd = d.kol[k];
    const x = yanS[y];
    const ua = B['upperarm_' + y], la = B['lowerarm_' + y], el = B['hand_' + y];
    if (kd.el) {
      const T = wp(B['thigh_' + y]).add(new V3(x * kd.el[0], kd.el[1], kd.el[2]));
      zincir(ua, la, el, T, new V3(x * kd.dirsek[0], kd.dirsek[1], kd.dirsek[2]));
    } else {
      dogrult(ua, la, new V3(x * kd.ust[0], kd.ust[1], kd.ust[2]));
      dogrult(la, el, new V3(x * kd.alt[0], kd.alt[1], kd.alt[2]));
    }
    // bilek: el parmak yönüne (orta parmak kökü) çevrilir; kol açısından gelen yamukluk gider
    const orta = root.getObjectByName('middle_01_' + y);
    const bk = kd.bilek || [0, -1, 0.12];
    if (orta) dogrult(el, orta, new V3(x * bk[0], bk[1], bk[2]));
    // avuç: işaret→serçe kökü bu yöne bakacak kadar el kendi ekseninde döner (avuç içi bacağa dönük)
    const ib = root.getObjectByName('index_01_' + y);
    const pb = root.getObjectByName('pinky_01_' + y);
    if (orta && ib && pb && kd.avuc !== null && !kd.el) {
      const av = kd.avuc || d.avuc || [0.4, 0, 1];
      const fa = wp(orta).sub(wp(el)).normalize();
      const v = wp(pb).sub(wp(ib));
      const h = new V3(x * av[0], av[1], av[2]);
      v.sub(fa.clone().multiplyScalar(v.dot(fa))).normalize();
      h.sub(fa.clone().multiplyScalar(h.dot(fa))).normalize();
      rotWorld(el, new Q().setFromUnitVectors(v, h));
    }
  }
  // parmaklar gevşekçe kıvrık (dümdüz açık el cansız duruyordu)
  if (d.parmak) {
    for (const y of ['l', 'r']) {
      const ib = root.getObjectByName('index_01_' + y);
      const pb = root.getObjectByName('pinky_01_' + y);
      if (!ib || !pb) continue;
      const eks = wp(pb).sub(wp(ib)).normalize();
      const yon = y === 'r' ? KAVRA : -KAVRA;
      for (const f of ['index', 'middle', 'ring', 'pinky', 'thumb'])
        for (const n of ['01', '02', '03']) {
          const b = root.getObjectByName(`${f}_${n}_${y}`);
          if (!b) continue;
          const kat = f === 'thumb' ? (n === '01' ? 0 : 0.35) : (n === '01' ? 0.5 : 1) * (0.8 + 0.12 * PARMAK.indexOf(f));
          don(b, eks, d.parmak * kat * yon);
        }
    }
  }
}

function rotWorld(b, q) {
  const pq = new Q();
  b.parent.getWorldQuaternion(pq);
  const wq = new Q();
  b.getWorldQuaternion(wq);
  b.quaternion.copy(pq.invert().multiply(q.multiply(wq)));
  b.updateMatrixWorld(true);
}

// ---------------- atkı (boyna takılan, örgü dokulu) ----------------
function knitTexture(stripes) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#e6e6e6';
  g.fillRect(0, 0, 64, 256);
  for (let y = 0; y < 256; y += 8) {
    for (let x = 0; x < 64; x += 8) {
      g.fillStyle = 'rgba(0,0,0,0.13)';
      g.beginPath();
      g.ellipse(x + 2, y + 4, 2.2, 4, 0.5, 0, Math.PI * 2);
      g.ellipse(x + 6, y + 4, 2.2, 4, -0.5, 0, Math.PI * 2);
      g.fill();
    }
  }
  if (stripes) {
    g.fillStyle = 'rgba(255,255,255,0.9)';
    for (let y = 16; y < 256; y += 64) g.fillRect(0, y, 64, 18);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildScarf(B, kadin) {
  const neck = B.neck_01;
  const chest = B.spine_03;
  if (!neck || !chest) return null;
  const group = { ring: new THREE.Group(), tail: new THREE.Group(), mats: {} };
  const np = new V3().setFromMatrixPosition(neck.matrixWorld);
  const r0 = kadin ? 0.068 : 0.078;
  const styles = {
    orgu: { tube: 0.03, map: knitTexture(false), rough: 0.95 },
    cizgili: { tube: 0.03, map: knitTexture(true), rough: 0.95 },
    ipek: { tube: 0.014, map: null, rough: 0.35 },
  };
  for (const [id, s] of Object.entries(styles)) {
    const mat = new THREE.MeshStandardMaterial({ color: '#B23A3A', roughness: s.rough, map: s.map });
    if (s.map) s.map.repeat.set(1, 4);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r0 + s.tube * 0.6, s.tube, 14, 48), mat);
    ring.rotation.x = Math.PI / 2 - 0.25;
    ring.position.copy(np).add(new V3(0, -0.035, 0.012));
    ring.scale.set(1, 1.08, 1);
    ring.name = 'atki_' + id;
    const tail = new THREE.Mesh(
      s.tube > 0.02 ? new THREE.BoxGeometry(0.09, 0.32, 0.03) : new THREE.ConeGeometry(0.05, 0.14, 4, 1, true),
      mat,
    );
    if (s.tube > 0.02) {
      tail.position.copy(np).add(new V3(0.055, -0.2, r0 + 0.04));
      tail.rotation.set(0.12, 0, 0.1);
    } else {
      tail.position.copy(np).add(new V3(0.04, -0.12, r0 + 0.02));
      tail.rotation.set(Math.PI + 0.2, 0, 0.3);
    }
    tail.name = 'atkiuc_' + id;
    group.mats[id] = { ring, tail, mat };
    ring.visible = tail.visible = false;
    neck.attach(ring);
    chest.attach(tail);
  }
  return group;
}

// ---------------- saçlar: ayrı dosyalardan, istendiğinde ----------------
// Her saç kendi küçük dosyasında (iskeletiyle). Yüklenince ana iskelete bağlanır: dans ve yüz ayarlarını izler.
function sacYukle(set, mesh) {
  if (mesh) (set.kullanim ??= {})[mesh] = performance.now();
  if (!mesh || set.parts[mesh]) return Promise.resolve();
  if (set.sacYuk[mesh]) return set.sacYuk[mesh];
  const p = set.man.parcalar.find((x) => x.mesh === mesh);
  if (!p || !p.dosya) return Promise.resolve();
  const url = p.dosya + '?v=' + SURUM;
  // bağlantı yarıda kesilirse bir kez daha dene
  set.sacYuk[mesh] = loader
    .loadAsync(url)
    .catch(() => new Promise((r) => setTimeout(r, 600)).then(() => loader.loadAsync(url)))
    .then((gltf) => {
      const o = gltf.scene.getObjectByName(mesh);
      if (!o) throw new Error('saç bulunamadı: ' + mesh);
      const kok = set.root.getObjectByName('iskelet') || set.root;
      for (const m of meshesOf(o)) {
        if (!m.isSkinnedMesh) continue;
        const sk = m.skeleton;
        const kemik = sk.bones.map((b) => set.root.getObjectByName(b.name) || b);
        m.bind(new THREE.Skeleton(kemik, sk.boneInverses), m.bindMatrix);
      }
      kok.add(o);
      set.setup(o, p.kat);
      o.visible = false;
      for (const m of meshesOf(o)) if (m.userData.softMesh) m.userData.softMesh.visible = false;
      return onDerle(o).then(() => o);
    })
    .then((o) => {
      set.parts[mesh] = { ...p, obj: o, ayri: true };
      bellekTemizle(set);
      // yüz ayarları ve şapka bastırması bu saça da işlesin
      if (cfg && cur === set) {
        gorunum(set, cfg);
        applyMorphs(cfg);
      }
    })
    .catch((e) => {
      delete set.sacYuk[mesh];
      post('hata', { mesaj: String(e) });
    });
  return set.sacYuk[mesh];
}
// Bellek: ayrı dosyadan inen ve şu an giyilmeyen parçalardan en çok AYRI_SINIR tanesi tutulur; en eski
// kullanılanlar atılır (geometri, malzeme, doku). Telefonda gardırobu uzun gezince bellek dolup kasmasın/çökmesin.
const AYRI_SINIR = 24;
function bellekTemizle(set) {
  const giyili = new Set(cfg && cur === set ? seciliMeshler(set, cfg) : []);
  // önizleme sırasında bekleyenler de korunur (çekilmeden atılmasın); üst/alt önizlemesindeki ilk eş parça da
  for (const q of onizKuyruk) {
    giyili.add(sacMesh(set, q.id, q.kat));
    if (q.kat === 'ust' || q.kat === 'alt') giyili.add(set.man.parcalar.find((x) => x.kat === (q.kat === 'ust' ? 'alt' : 'ust'))?.mesh);
  }
  const adaylar = Object.entries(set.parts)
    .filter(([n, p]) => p.ayri && !giyili.has(n) && !p.obj.visible)
    .sort((a, b) => (set.kullanim?.[a[0]] ?? 0) - (set.kullanim?.[b[0]] ?? 0));
  for (let i = 0; i < adaylar.length - AYRI_SINIR; i++) bosalt(set, adaylar[i][0]);
}
function bosalt(set, mesh) {
  const p = set.parts[mesh];
  if (!p) return;
  const ms = meshesOf(p.obj);
  const disla = (arr, f) => {
    for (let i = arr.length - 1; i >= 0; i--) if (f(arr[i])) arr.splice(i, 1);
  };
  disla(set.morphers, (m) => ms.includes(m));
  disla(set.hatCoverables, (m) => ms.includes(m));
  disla(set.coverables, (m) => ms.includes(m));
  const uler = new Set(ms.flatMap((m) => m.userData.icU ?? []));
  disla(set.icMats, (u) => uler.has(u));
  const dokular = new Set();
  for (const m of ms) {
    const ekler = [m, m.userData.softMesh].filter(Boolean);
    for (const x of ekler) {
      for (const mt of [].concat(x.material)) {
        for (const v of Object.values(mt)) if (v && v.isTexture) dokular.add(v);
        mt.dispose();
      }
    }
    m.userData.softMesh?.parent?.remove(m.userData.softMesh);
    m.geometry.dispose();
  }
  for (const t of dokular) t.dispose();
  p.obj.parent?.remove(p.obj);
  delete set.parts[mesh];
  delete set.sacYuk[mesh];
}
const sacMesh = (set, id, kat = 'sac') => {
  const k = kat === 'tam' ? (set.man.beden === 'kadin' ? 'elbise' : 'takim') : kat;
  return set.man.parcalar.find((x) => x.kat === k && x.id === id)?.mesh;
};
/** Bu ayarda giyilen ve dosyası ayrı olan her parça (saç, sakal, bıyık, kıyafetler) */
function seciliMeshler(set, c) {
  const out = [];
  for (const k of ['sac', 'sakal', 'biyik']) if (c[k]) out.push(sacMesh(set, c[k], k));
  const g = c.giysi ?? {};
  const kats = g.tam ? ['tam', 'ayakkabi', 'sapka', 'gozluk'] : ['ust', 'alt', 'ayakkabi', 'sapka', 'gozluk'];
  for (const k of kats) if (g[k]) out.push(sacMesh(set, g[k].id ?? g[k], k));
  return out.filter(Boolean);
}

// ---------------- ayarları uygula ----------------
let cur = null; // etkin set
let cfg = null;
let expr = { mouthSmileLeft: 0.22, mouthSmileRight: 0.22 };
let dokuHazir = Promise.resolve();
let gorundu = false; // ilk ayar uygulanıp avatar belirdi mi
let ilkIstek = false; // uygulamadan ayar geldi mi
// Ayarlar sırayla: arka arkaya iki ayar gelince (açılışta taslak geri yüklenirken olur) geç biten eskisi
// yenisinin üstüne yazmasın; önizlemeler de son ayar oturmadan çekilmesin
let applyNo = 0;
let applySoz = Promise.resolve();
async function ayarOtursun() {
  let s;
  do {
    s = applySoz;
    await s;
  } while (s !== applySoz);
}
let sapkaMask = 0;

function defaults(man) {
  const P = (k) => man.parcalar.filter((p) => p.kat === k);
  const kadin = man.beden === 'kadin';
  const first = (k, id) => {
    const p = P(k).find((x) => x.id === id) ?? P(k)[0];
    return p ? { id: p.id, renk: p.renk } : null;
  };
  return {
    surum: 2,
    beden: man.beden,
    ten: man.tenler[0].id,
    tenTonu: 0,
    goz: (man.gozler.find((g) => g.id === 'brown') ?? man.gozler[0]).id,
    sac: P('sac')[0].id,
    sacRengi: kadin ? '#3B2418' : '#1E1612',
    kas: P('kas')[0].id,
    kasRengi: kadin ? '#3B2418' : '#1E1612',
    kirpik: P('kirpik')[0].id,
    yuz: {},
    giysi: kadin
      ? { tam: first('elbise', 'duz'), ayakkabi: first('ayakkabi', 'babet'), ust: null, alt: null, sapka: null, gozluk: null, atki: null }
      : { tam: first('takim', 'gomlekkot'), ayakkabi: first('ayakkabi', 'klasik'), ust: null, alt: null, sapka: null, gozluk: null, atki: null },
  };
}

function texture(set, cache, file) {
  if (!cache[file]) {
    cache[file] = texLoader.loadAsync(file + '?v=' + SURUM).then((t) => {
      t.flipY = false;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    });
  }
  return cache[file];
}

async function apply(next) {
  const no = ++applyNo;
  const set = await loadSet(next.beden);
  if (no !== applyNo) return;
  const man = set.man;
  const base = defaults(man);
  const c = { ...base, ...next, yuz: { ...(next.yuz ?? {}) }, giysi: { ...base.giysi, ...(next.giysi ?? {}) } };
  // Seçili saç ayrı dosyada: önce o insin (gelmezse saçsız gösterilmez, eski saç kalır)
  await Promise.all(seciliMeshler(set, c).map((mesh) => sacYukle(set, mesh)));
  if (no !== applyNo) return;
  if (cur !== set) {
    if (!set.derlendi) {
      set.derlendi = true;
      await onDerle(set.model);
      if (no !== applyNo) return;
    }
    if (cur) {
      scene.remove(cur.model);
      if (cur.dansAkt) dansBaslat(cur, null);
    }
    scene.add(set.model);
    cur = set;
    if (mekan.ad === 'oda') mekan.sec('oda', set.man.beden);
    fitCamera(true);
    if (dans) dansBaslat(set, dans); // beden değişince aynı dans o bedenin kaydıyla sürer
  }
  cfg = c;
  gorunum(set, c);
  // Ten ve göz
  const skin = man.tenler.find((t) => t.id === c.ten) ?? man.tenler[0];
  const eye = man.gozler.find((t) => t.id === c.goz) ?? man.gozler[0];
  const bodyMat = meshesOf(set.body)[0].material;
  const tone = Math.max(-1, Math.min(1, c.tenTonu ?? 0));
  bodyMat.color.setRGB(1, 1, 1);
  if (tone > 0) bodyMat.color.lerp(new THREE.Color('#C98E66'), tone * 0.55);
  if (tone < 0) bodyMat.color.lerp(new THREE.Color('#FFF6F0'), -tone * 0.5);
  const tenP = texture(set, set.skinCache, skin.dosya).then((t) => {
    if (cfg !== c) return;
    bodyMat.map = t;
    bodyMat.needsUpdate = true;
  });
  const gozP = texture(set, set.eyeCache, eye.dosya).then((t) => {
    if (cfg !== c) return;
    for (const m of meshesOf(set.eyes)) {
      m.material.map = t;
      m.material.needsUpdate = true;
    }
  });
  // Portre dokular yerine oturmadan çekilmesin
  dokuHazir = Promise.all([tenP, gozP]).catch(() => {});
  applyMorphs();
  if (!gorundu) {
    // ilk görünüş: ten dokusu oturmadan gösterme (gri ten "pat" diye değişmesin), en çok 1.5 sn bekle
    await Promise.race([dokuHazir, new Promise((r) => setTimeout(r, 1500))]);
    gorundu = true;
    renderer.domElement.classList.add('hazir');
    yuk.classList.add('gitti');
    setTimeout(() => (yuk.style.display = 'none'), 400);
  }
  post('uygulandi');
}

/** Eşzamanlı görünüm: hangi parçalar giyili, renkleri, örtülen yüzeyler, şapka altı saç */
function gorunum(set, c) {
  const man = set.man;
  const tamKat = man.beden === 'kadin' ? 'elbise' : 'takim';

  // Görünürlük
  const worn = new Set();
  const want = new Map();
  const pick = (kat, sel) => {
    if (!sel) return;
    const p = man.parcalar.find((x) => x.kat === kat && x.id === (sel.id ?? sel));
    if (p) want.set(p.mesh, sel.renk ?? null);
  };
  pick('sac', c.sac);
  if (c.sac) for (const p of man.parcalar) if (p.kat === 'kabuk') want.set(p.mesh, null);
  pick('kas', c.kas);
  pick('sakal', c.sakal);
  pick('biyik', c.biyik);
  pick('kirpik', c.kirpik);
  const g = c.giysi;
  if (g.tam) pick(tamKat, g.tam);
  else {
    pick('ust', g.ust);
    pick('alt', g.alt);
  }
  pick('ayakkabi', g.ayakkabi);
  pick('sapka', g.sapka);
  pick('gozluk', g.gozluk);
  for (const [name, p] of Object.entries(set.parts)) {
    const on = want.has(name);
    p.obj.visible = on;
    for (const m of meshesOf(p.obj)) if (m.userData.softMesh) m.userData.softMesh.visible = on;
    if (!on) continue;
    if (['ust', 'alt', 'elbise', 'takim', 'ayakkabi'].includes(p.kat)) worn.add(name);
    let color = want.get(name) ?? p.renk;
    if (p.kat === 'sac') {
      color = c.sacRengi;
      const o = c.sacUc;
      for (const m of meshesOf(p.obj)) {
        const u = m.userData.ombre;
        if (!u) continue;
        u.uOmbre.value = o ? 1 : 0;
        if (o) {
          u.uUcRenk.value.set(o.renk);
          u.uKonum.value = o.konum ?? 0.5;
          u.uYumusak.value = o.tur === 'sombre' ? 0.75 : 0.28;
        }
      }
    }
    if (p.kat === 'kas') color = c.kasRengi;
    if (p.kat === 'sakal' || p.kat === 'biyik') color = c.sakalRengi ?? c.sacRengi;
    if (p.kat === 'kirpik') color = '#1A1412';
    if (p.kat === 'kabuk') {
      color = c.sacRengi;
      const f = man.parcalar.find((x) => x.kat === 'sac' && x.id === c.sac)?.kabukFade;
      for (const m of meshesOf(p.obj)) {
        const u = m.userData.kabukFade;
        if (!u) continue;
        u.uFade.value = f ? 1 : 0;
        if (f) {
          u.uFadeH.value = f[0];
          u.uFadeE.value = f[1];
          u.uFadeU.value = f[2];
        }
      }
    }
    for (const m of meshesOf(p.obj)) {
      for (const mt of [].concat(m.material)) if (color && p.renk !== null) mt.color.set(color);
      if (m.userData.soft && color && p.renk !== null) m.userData.soft.color.set(color);
    }
  }
  // Atkı
  if (set.scarf) {
    for (const [id, s] of Object.entries(set.scarf.mats)) {
      const on = g.atki && (g.atki.id ?? g.atki) === id;
      s.ring.visible = s.tail.visible = !!on;
      if (on) s.mat.color.set(g.atki.renk ?? '#B23A3A');
    }
  }
  // Örtülen yüzeyler: giyilen kıyafetlerin bitleri (üç grup, her biri 24 bit)
  const maske = [0, 0, 0, 0];
  for (const n of worn) {
    const b = man.bitler[n];
    if (b !== undefined) maske[Math.floor(b / 24)] |= 1 << b % 24;
  }
  for (const m of set.coverables) gizleOrtu(m, maske);
  for (const u of set.icMats) {
    u.uIcMask.value = maske[0];
    u.uIcMaskV.value = maske[1];
    u.uIcMaskW.value = maske[2];
    u.uIcMaskX.value = maske[3];
  }
  // Şapka takılıysa altında kalan saç kafa derisine bastırılır (h_<bit> şekil anahtarı)
  sapkaMask = 0;
  for (const [name, p] of Object.entries(set.parts)) if (p.kat === 'sapka' && p.obj.visible && man.sapkaBitler?.[name] !== undefined) sapkaMask |= 1 << man.sapkaBitler[name];
  for (const m of set.hatCoverables) gizle(m, '_sapka', 0);
}

// Bedende giyilen kıyafetlerin altında kalan üçgenler: üç maske grubundan herhangi biri köşeyi örtüyorsa örtülü
function gizleOrtu(m, maske) {
  const idx0 = m.userData.idx0;
  if (!maske[0] && !maske[1] && !maske[2] && !maske[3]) {
    m.geometry.setIndex(new THREE.BufferAttribute(idx0, 1));
    return;
  }
  const at = m.geometry.attributes;
  const gruplar = [
    [at._ortu?.array, maske[0]],
    [at._ortuv?.array, maske[1]],
    [at._ortuw?.array, maske[2]],
    [at._ortux?.array, maske[3]],
  ].filter(([a, mk]) => a && mk);
  const ortulu = (v) => gruplar.some(([a, mk]) => Math.round(a[v]) & mk);
  const out = new Uint32Array(idx0.length);
  let n = 0;
  for (let i = 0; i < idx0.length; i += 3) {
    const a = idx0[i];
    const b = idx0[i + 1];
    const d = idx0[i + 2];
    if (ortulu(a) && ortulu(b) && ortulu(d)) continue;
    out[n++] = a;
    out[n++] = b;
    out[n++] = d;
  }
  m.geometry.setIndex(new THREE.BufferAttribute(out.slice(0, n), 1));
}

// Üç köşesi de maskeye düşen üçgenleri çizimden çıkar (bitler kayıpsız gelir; yine de en yakın tam sayıya yuvarla)
function gizle(m, ad, mask) {
  const idx0 = m.userData.idx0;
  if (!mask) {
    m.geometry.setIndex(new THREE.BufferAttribute(idx0, 1));
    return;
  }
  const o = m.geometry.attributes[ad].array;
  const out = new Uint32Array(idx0.length);
  let n = 0;
  for (let i = 0; i < idx0.length; i += 3) {
    const a = idx0[i];
    const b = idx0[i + 1];
    const d = idx0[i + 2];
    if (Math.round(o[a]) & mask && Math.round(o[b]) & mask && Math.round(o[d]) & mask) continue;
    out[n++] = a;
    out[n++] = b;
    out[n++] = d;
  }
  m.geometry.setIndex(new THREE.BufferAttribute(out.slice(0, n), 1));
}

function applyMorphs(c = cfg) {
  if (!cur || !c) return;
  for (const m of cur.morphers) {
    const d = m.morphTargetDictionary;
    const inf = m.morphTargetInfluences;
    for (const k in d) {
      if (k.startsWith('s_')) {
        const sign = k[k.length - 1];
        const v = Number(c.yuz[k.slice(2, -1)] ?? 0);
        inf[d[k]] = sign === '+' ? Math.max(0, v) : Math.max(0, -v);
      } else if (k.startsWith('x_')) {
        inf[d[k]] = expr[k.slice(2)] ?? 0;
      } else if (k.startsWith('h_')) {
        inf[d[k]] = (sapkaMask >> Number(k.slice(2))) & 1;
      }
    }
  }
}

// ---------------- kamera ----------------
let focus = q.get('odak') || 'tum';
let ustBos = Number(q.get('ust') || 0); // üstteki düğmelerin kapladığı yükseklik (px)
let altBos = Number(q.get('alt') || 0); // alttaki dans şeridinin kapladığı yükseklik (px)
// Odaklar: tüm beden / üst / alt ya da bir yüz noktası. Yüz noktalarında kamera o noktaya yaklaşır ve
// avatar uygun açıya döner (burun ve kulak yandan); kullanıcı yine istediği gibi sağa sola çevirebilir.
const ODAK = {
  yuz: { uzak: 0.5, yaw: -0.18, dy: 0.01 },
  goz: { uzak: 0.19, yaw: -0.08, dy: 0.002 },
  kas: { uzak: 0.21, yaw: -0.3, dy: 0.004 },
  burun: { uzak: 0.26, yaw: 1.2, dy: 0.008 },
  agiz: { uzak: 0.2, yaw: -0.32, dy: 0 },
  cene: { uzak: 0.34, yaw: 0.62, dy: -0.01 },
  kulak: { uzak: 0.24, yaw: 1.5, dy: 0.004 },
  sac: { uzak: 0.7, yaw: -0.75, dy: 0.03 },
  // Önizleme kartı: kafa ortada, saçın tamamı karede
  kafa: { uzak: 0.62, yaw: -0.6, dy: 0.01 },
};
const Y = new V3(0, 1, 0);
const camNow = { pos: new V3(0, 1, 4), look: new V3(0, 1, 0) };
function camTarget() {
  if (!cur) return { pos: new V3(0, 1, 4), look: new V3(0, 1, 0) };
  // yürürken tüm beden görünsün
  return hedefKamera(gez.hareket ? 'tum' : focus, spin.yaw, bosOran(), !!dans);
}
function hedefKamera(f, yaw, oran, dansta = false) {
  const H = cur.H;
  const o = ODAK[f];
  if (o && cur.nok[f]) {
    // Nokta modelle birlikte döner: kamera onu takip eder (döndürürken de yakın plan kalır)
    const look = cur.nok[f].clone().applyAxisAngle(Y, yaw);
    return { pos: look.clone().add(new V3(0, o.dy, o.uzak / oran)), look };
  }
  const t =
    f === 'ust' ? { y: H * 0.78, z: 1.9, look: H * 0.74 }
    : f === 'alt' ? { y: H * 0.35, z: 2.2, look: H * 0.3 }
    : f === 'ayak' ? { y: H * 0.16, z: 1.05, look: H * 0.07 }
    : dansta ? { y: H * 0.62, z: H * 2.9, look: H * 0.56 }
    : { y: H * 0.55, z: H * 2.45, look: H * 0.49 };
  return { pos: new V3(0, t.y, t.z / oran), look: new V3(0, t.look, 0) };
}
function fitCamera(jump) {
  const t = camTarget();
  if (jump) {
    camNow.pos.copy(t.pos);
    camNow.look.copy(t.look);
  }
}
function odakla(f) {
  if (f === focus) return;
  focus = f;
  const o = ODAK[f];
  if (o) {
    // En kısa yoldan dön (tam turlar atmasın)
    const tam = Math.PI * 2;
    spin.target = o.yaw + tam * Math.round((spin.target - o.yaw) / tam);
    spin.vel = 0;
  }
}
// Görünür alan: üst düğmeler ile alt şerit arası. Avatar bu alana ortalanır ve sığdırılır.
function bosOran() {
  const h = window.innerHeight || 1;
  return Math.max(0.45, (h - ustBos - altBos) / h);
}
function applyOffset() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.setViewOffset(w, h, 0, -(ustBos - altBos) / 2, w, h);
  camera.updateProjectionMatrix();
}
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  applyOffset();
}

// Portre: haritadaki iğne için yüzden kare bir fotoğraf (aynı karede çekilir, ekranda görünmez)
let portreReq = null;
// Portre ve önizlemeler arka plansız (saydam) çizilir; mekân ve mendil o an gizlenir
function temizCiz() {
  mekan.gizle(true);
  const mv = mendil?.mesh.visible;
  if (mendil) mendil.mesh.visible = false;
  renderer.render(scene, camera);
  mekan.gizle(false);
  if (mendil) mendil.mesh.visible = !!mv;
}
// Mekân önizlemesi: o mekânı avatar yerindeyken (oda kaymamış, kapaklar kapalı) çizer, sonra geri döner
function mekanCiz(ad) {
  const eski = mekan.ad;
  const kx = mekan.kok.position.x;
  const mv = mendil?.mesh.visible;
  if (mendil) mendil.mesh.visible = false;
  if (ad !== eski) mekan.sec(ad, cur.man.beden, true);
  mekan.kok.position.x = 0;
  mekan.guncelle(clock.elapsedTime, 0, { dans: false });
  renderer.render(scene, camera);
  if (ad !== eski) mekan.sec(eski, cur.man.beden, true);
  mekan.kok.position.x = kx;
  if (mendil) mendil.mesh.visible = !!mv;
}
function shootPortrait() {
  const res = portreReq;
  portreReq = null;
  try {
    const cv = renderer.domElement;
    const w = cv.width;
    const h = cv.height;
    const s = Math.min(w, h);
    const yaw = cur.model.rotation.y;
    cur.model.rotation.y = 0;
    // Nötr duruş ve açık gözler: dans ya da göz kırpma anında çekilse de yüz düzgün çıksın
    for (const [n, rr] of cur.rest) {
      cur.B[n].quaternion.copy(rr.q);
      cur.B[n].position.copy(rr.p);
    }
    for (const m of cur.morphers) {
      const d = m.morphTargetDictionary;
      for (const k of ['eyeBlinkLeft', 'eyeBlinkRight']) if (d['x_' + k] !== undefined) m.morphTargetInfluences[d['x_' + k]] = 0;
      for (const k of ['mouthSmileLeft', 'mouthSmileRight']) if (d['x_' + k] !== undefined) m.morphTargetInfluences[d['x_' + k]] = 0.3;
    }
    cur.model.updateMatrixWorld(true);
    const worldH = (0.34 * h) / s;
    const d = worldH / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    const keep = camera.position.clone();
    camera.clearViewOffset();
    camera.updateProjectionMatrix();
    camera.position.set(0, cur.headY + 0.09, d);
    camera.lookAt(0, cur.headY + 0.08, 0);
    temizCiz();
    const out = document.createElement('canvas');
    out.width = out.height = 256;
    out.getContext('2d').drawImage(cv, (w - s) / 2, (h - s) / 2, s, s, 0, 0, 256, 256);
    let url = out.toDataURL('image/webp', 0.86);
    if (!url.startsWith('data:image/webp')) url = out.toDataURL('image/jpeg', 0.86);
    cur.model.rotation.y = yaw;
    camera.position.copy(keep);
    applyOffset();
    res(url);
  } catch (e) {
    res(null);
  }
}
window.addEventListener('resize', resize);

// ---------------- seçenek önizlemeleri ----------------
// Her seçenek senin avatarınla çekilir: aynı karede görünüm o seçeneğe geçer, çekilir, geri döner (titreme yok).
const ONIZ_ODAK = { mekan: 'tum', sac: 'kafa', sakal: 'cene', biyik: 'agiz', kas: 'kas', kirpik: 'goz', sapka: 'kafa', gozluk: 'yuz', ust: 'ust', alt: 'alt', tam: 'tum', ayakkabi: 'ayak' };
const ONIZ_YAW = { mekan: -0.15, sac: -0.6, sakal: -0.55, biyik: -0.4, kas: -0.25, kirpik: -0.12, sapka: -0.55, gozluk: -0.3, ust: -0.35, alt: -0.35, tam: -0.35, ayakkabi: -0.6 };
const onizKuyruk = [];
const onizNo = {}; // bölüm başına son istek numarası
let kareNo = 0;
function varyant(base, kat, id) {
  const c = { ...base, yuz: { ...base.yuz }, giysi: { ...base.giysi } };
  if (kat === 'mekan') return c; // mekân önizlemesinde avatar olduğu gibi
  if (['sac', 'sakal', 'biyik', 'kas', 'kirpik'].includes(kat)) {
    c[kat] = id;
    return c;
  }
  const g = c.giysi;
  const man = cur.man;
  const mk = kat === 'tam' ? (man.beden === 'kadin' ? 'elbise' : 'takim') : kat;
  const p = man.parcalar.find((x) => x.kat === mk && x.id === id);
  const ayni = g[kat] && (g[kat].id ?? g[kat]) === id;
  g[kat] = id ? { id, renk: ayni ? (g[kat].renk ?? p?.renk ?? null) : (p?.renk ?? null) } : null;
  if (kat === 'tam' && id) g.ust = g.alt = null;
  if ((kat === 'ust' || kat === 'alt') && id) {
    g.tam = null;
    const diger = kat === 'ust' ? 'alt' : 'ust';
    if (!g[diger]) {
      const ilk = man.parcalar.find((x) => x.kat === diger);
      g[diger] = ilk ? { id: ilk.id, renk: ilk.renk } : null;
    }
  }
  return c;
}
function onizCek(is) {
  const set = cur;
  if (!set || !cfg || cfg.beden !== set.man.beden || is.beden !== set.man.beden) {
    is.res(null);
    return;
  }
  try {
    const c = varyant(cfg, is.kat, is.id);
    gorunum(set, c);
    applyMorphs(c);
    // Nötr duruş, açık gözler
    for (const [n, rr] of set.rest) {
      set.B[n].quaternion.copy(rr.q);
      set.B[n].position.copy(rr.p);
    }
    for (const m of set.morphers) {
      const d = m.morphTargetDictionary;
      for (const k of ['eyeBlinkLeft', 'eyeBlinkRight']) if (d['x_' + k] !== undefined) m.morphTargetInfluences[d['x_' + k]] = 0;
    }
    const f = ONIZ_ODAK[is.kat] ?? 'yuz';
    const yaw = ONIZ_YAW[is.kat] ?? -0.3;
    set.model.rotation.y = yaw;
    set.model.updateMatrixWorld(true);
    const t = hedefKamera(f, yaw, 1);
    camera.clearViewOffset();
    camera.updateProjectionMatrix();
    camera.position.copy(t.pos);
    camera.lookAt(t.look);
    if (is.kat === 'mekan') mekanCiz(is.id);
    else temizCiz();
    const cv = renderer.domElement;
    const ch = cv.height;
    const cw = Math.min(cv.width, Math.round(ch * 0.75));
    // Kart ekranda ~2 kat yoğunlukla gösterilir: önizleme o boyutta çekilsin ki pikselleşmesin
    // (mekân kartları iki sütun, daha geniş; diğerleri üç sütun)
    const [ow, oh] = is.kat === 'mekan' ? [330, 440] : [210, 280];
    const out = document.createElement('canvas');
    out.width = ow;
    out.height = oh;
    const c2 = out.getContext('2d');
    c2.imageSmoothingEnabled = true;
    c2.imageSmoothingQuality = 'high';
    c2.drawImage(cv, (cv.width - cw) / 2, 0, cw, ch, 0, 0, ow, oh);
    // Safari webp yazamaz: jpeg'e düşer
    let url = out.toDataURL('image/webp', 0.84);
    if (!url.startsWith('data:image/webp')) url = out.toDataURL('image/jpeg', 0.86);
    is.res(url);
  } catch (e) {
    is.res(null);
  } finally {
    gorunum(set, cfg);
    applyMorphs(cfg);
    applyOffset();
  }
}

// ---------------- döndürme ----------------
const spin = { yaw: Number(q.get('yaw') || -0.3), target: Number(q.get('yaw') || -0.3), vel: 0, drag: false, lx: 0 };
renderer.domElement.addEventListener('pointerdown', (e) => {
  spin.drag = true;
  spin.lx = e.clientX;
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!spin.drag) return;
  const dx = e.clientX - spin.lx;
  spin.lx = e.clientX;
  spin.target += dx * 0.012;
  spin.vel = dx * 0.012;
});
const endDrag = () => (spin.drag = false);
renderer.domElement.addEventListener('pointerup', endDrag);
renderer.domElement.addEventListener('pointercancel', endDrag);

// ---------------- hareket: nefes, göz kırpma, danslar ----------------
let dans = null;
let dansW = 0;
let blinkAt = performance.now() + 2500;

const AX = { x: new V3(1, 0, 0), y: new V3(0, 1, 0), z: new V3(0, 0, 1) };
function rot(name, axis, ang) {
  const b = cur.B[name];
  if (!b || !ang) return;
  const a = AX[axis].clone().applyQuaternion(cur.model.quaternion);
  rotWorld(b, new Q().setFromAxisAngle(a, ang));
}
function shift(name, dx, dy, dz) {
  const b = cur.B[name];
  if (!b) return;
  const p = new V3().setFromMatrixPosition(b.matrixWorld);
  p.add(new V3(dx, dy, dz).applyQuaternion(cur.model.quaternion));
  b.position.copy(b.parent.worldToLocal(p));
  b.updateMatrixWorld(true);
}
// ---------------- dans: gerçek hareket kaydı (CMU mocap, avatar iskeletine aktarılmış) ----------------
// Her dans kendi küçük dosyasında (dans/<beden>_<klip>.glb), seçilince iner. Geçişler yumuşak (0.5 sn);
// kayıt sonunda başa dönerken iki kopya üst üste bindirilir, kesik görünmez.
const dansKlip = {};
function dansYukle(beden, id) {
  const k = `${beden}_${id}`;
  if (!dansKlip[k]) {
    dansKlip[k] = loader
      .loadAsync(`dans/${k}.glb?v=${SURUM}`)
      .then((g) => {
        const c = g.animations[0];
        // yalnızca dönüşler ve kalça konumu (öbür kemiklerin sabit konum/ölçek izleri gereksiz yük)
        c.tracks = c.tracks.filter((t) => t.name.endsWith('.quaternion') || t.name === 'pelvis.position');
        return c;
      })
      .catch((e) => {
        delete dansKlip[k];
        throw e;
      });
  }
  return dansKlip[k];
}
const GECIS = 0.5;
let dansIstek = 0;
function dansBaslat(set, id) {
  const no = ++dansIstek;
  const eski = set.dansAkt;
  if (!id) {
    if (eski) for (const a of eski.a) a.fadeOut(GECIS);
    set.dansAkt = null;
    return;
  }
  dansYukle(set.man.beden, id)
    .then((clip) => {
      if (no !== dansIstek || cur !== set) return;
      const mixer = (set.mixer ??= new THREE.AnimationMixer(set.model));
      const a1 = mixer.clipAction(clip);
      const a2 = mixer.clipAction(clip.clone());
      for (const a of [a1, a2]) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      a1.reset().play();
      if (eski) {
        for (const a of eski.a) a.fadeOut(GECIS);
        a1.fadeIn(GECIS);
      } else a1.fadeIn(GECIS);
      set.dansAkt = { id, a: [a1, a2], i: 0, sure: clip.duration };
    })
    .catch((e) => post('hata', { mesaj: 'dans: ' + String(e) }));
}
// kayıt sonuna yaklaşınca öbür kopyaya yumuşak geç (sonsuz, kesiksiz döngü)
function dansDongu(set) {
  const d = set.dansAkt;
  if (!d) return;
  const a = d.a[d.i];
  if (a.time > d.sure - GECIS - 0.05) {
    const b = d.a[1 - d.i];
    b.reset().play();
    a.crossFadeTo(b, GECIS, false);
    d.i = 1 - d.i;
  }
}

// ---------------- gardıroba yürüyüş ----------------
// Gardırop açılınca avatar dolaba döner, yürür (kayıt yerinde oynar, oda kayar: kamera onu izliyormuş gibi),
// varınca kameraya döner ve kapaklar açılır. Gardıroptan çıkınca kapaklar kapanır, yerine geri yürür.
const YURU = { id: 'yuru_35_01', hiz: { erkek: 1.34, kadin: 1.07 } }; // kayıttaki yürüme hızı (m/sn)
let dolapIstek = false;
const gez = { x: 0, v: 0, yaw: 0, w: 0, hareket: false };
function yuruHazirla(set) {
  if (set.yuruAkt || set.yuruYuk) return;
  set.yuruYuk = true;
  dansYukle(set.man.beden, YURU.id)
    .then((clip) => {
      const mixer = (set.mixer ??= new THREE.AnimationMixer(set.model));
      const a = mixer.clipAction(clip);
      a.setLoop(THREE.LoopRepeat, Infinity);
      a.setEffectiveWeight(0);
      a.play();
      set.yuruAkt = a;
    })
    .catch(() => (set.yuruYuk = false));
}
function gezGuncelle(set, dt) {
  if (!mekan.dolapVar) {
    gez.x = gez.v = gez.yaw = gez.w = 0;
    gez.hareket = false;
    mekan.kok.position.x = 0;
    if (set.yuruAkt) set.yuruAkt.setEffectiveWeight(0);
    return;
  }
  yuruHazirla(set);
  const hazir = !!set.yuruAkt;
  const varis = dolapIstek ? DOLAP_X : 0;
  // dansta yürünmez: bulunduğu yere geçer (dans yarıda kesilmesin); yürüme kaydı gecikirse 1.5 sn sonra beklemez
  gez.bekle = hazir ? 0 : (gez.bekle || 0) + dt;
  if (dans || gez.bekle > 1.5) gez.x = varis;
  if (dans || !hazir) gez.v = 0;
  const fark = varis - gez.x;
  // dolaptan ayrılırken önce kapaklar kapansın
  const bekle = varis !== DOLAP_X && mekan.kapak > 0.03;
  mekan.kapakAc(varis === DOLAP_X && Math.abs(fark) < 0.35);
  const yurumeli = hazir && !dans && !bekle && Math.abs(fark) > 0.004;
  const yon = Math.sign(fark) || 1;
  const hedefYaw = yurumeli ? (yon * Math.PI) / 2 : 0;
  gez.yaw += (hedefYaw - gez.yaw) * Math.min(1, dt * 6);
  const hiz = YURU.hiz[set.man.beden] || 1.1;
  if (yurumeli) {
    // yürümeden önce gövde dönsün; varırken yavaşlasın
    const dondu = Math.abs(hedefYaw - gez.yaw) < 0.6;
    const hv = dondu ? Math.min(hiz, Math.sqrt(2 * 1.4 * Math.abs(fark)) + 0.05) : 0;
    gez.v += (hv - gez.v) * Math.min(1, dt * 4);
    gez.x += yon * Math.min(Math.abs(fark), gez.v * dt);
    const tam = Math.PI * 2;
    spin.target = tam * Math.round(spin.target / tam);
    spin.vel = 0;
  } else {
    if (Math.abs(fark) <= 0.004) gez.x = varis;
    gez.v = 0;
  }
  gez.w += ((yurumeli ? 1 : 0) - gez.w) * Math.min(1, dt * 5);
  gez.hareket = yurumeli || Math.abs(gez.yaw) > 0.08;
  if (set.yuruAkt) {
    set.yuruAkt.setEffectiveWeight(gez.w * (1 - dansW));
    set.yuruAkt.timeScale = Math.max(0.45, gez.v / hiz);
  }
  mekan.kok.position.x = -gez.x;
}

// ---------------- halay mendili ----------------
// Halayda sağ elde, köşesinden tutulan mendil. Kumaş gibi davranır (Verlet parçacık ağı): el savruldukça
// arkasından dalgalanır, durunca sarkar. Kırmızı, kenarı beyaz oyalı ve pullu.
const MN = 10; // kenar başına parçacık
const MENDIL_BOY = 0.42;
let mendil = null;
function mendilDoku() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const k = 18; // oya payı
  const gr = g.createLinearGradient(0, 0, 256, 256);
  gr.addColorStop(0, '#C8102E');
  gr.addColorStop(0.5, '#A50D27');
  gr.addColorStop(1, '#C41530');
  g.fillStyle = gr;
  g.fillRect(k, k, 256 - 2 * k, 256 - 2 * k);
  // ince altın sırma çerçeve ve köşe motifleri
  g.strokeStyle = '#E8C46A';
  g.lineWidth = 3;
  g.strokeRect(k + 8, k + 8, 256 - 2 * k - 16, 256 - 2 * k - 16);
  g.fillStyle = '#F2D27E';
  for (const [x, y] of [[k + 26, k + 26], [256 - k - 26, k + 26], [k + 26, 256 - k - 26], [256 - k - 26, 256 - k - 26], [128, 128]]) {
    for (let a = 0; a < 6; a++) {
      g.beginPath();
      g.ellipse(x + Math.cos((a * Math.PI) / 3) * 7, y + Math.sin((a * Math.PI) / 3) * 7, 5, 2.6, (a * Math.PI) / 3, 0, Math.PI * 2);
      g.fill();
    }
  }
  // kenarda beyaz oya: dişli fistolar ve delikler
  g.fillStyle = '#FFFFFF';
  const fis = (x, y) => {
    g.beginPath();
    g.arc(x, y, 8, 0, Math.PI * 2);
    g.fill();
  };
  for (let i = k / 2; i <= 256 - k / 2; i += 14) {
    fis(i, k - 4);
    fis(i, 256 - k + 4);
    fis(k - 4, i);
    fis(256 - k + 4, i);
  }
  g.globalCompositeOperation = 'destination-out';
  for (let i = k / 2 + 7; i <= 256 - k / 2; i += 14) {
    for (const [x, y] of [[i, k - 6], [i, 256 - k + 6], [k - 6, i], [256 - k + 6, i]]) {
      g.beginPath();
      g.arc(x, y, 2.4, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.globalCompositeOperation = 'source-over';
  // pul
  g.fillStyle = '#FFF4C8';
  for (let i = 0; i < 26; i++) {
    g.beginPath();
    g.arc(k + 20 + Math.random() * (256 - 2 * k - 40), k + 20 + Math.random() * (256 - 2 * k - 40), 1.6, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function mendilKur() {
  const n = MN * MN;
  const geo = new THREE.BufferGeometry();
  const uv = new Float32Array(n * 2);
  const idx = [];
  for (let j = 0; j < MN; j++)
    for (let i = 0; i < MN; i++) {
      uv[(j * MN + i) * 2] = i / (MN - 1);
      uv[(j * MN + i) * 2 + 1] = 1 - j / (MN - 1);
      if (i < MN - 1 && j < MN - 1) {
        const a = j * MN + i;
        idx.push(a, a + MN, a + 1, a + 1, a + MN, a + MN + 1);
      }
    }
  geo.setIndex(idx);
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const mat = new THREE.MeshStandardMaterial({ map: mendilDoku(), side: THREE.DoubleSide, roughness: 0.62, metalness: 0, alphaTest: 0.5 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);
  // kısıtlar: yapı, çapraz ve bükülme (iki adım öte)
  const ara = MENDIL_BOY / (MN - 1);
  const kis = [];
  const ekle = (a, b, d) => kis.push(a, b, d);
  for (let j = 0; j < MN; j++)
    for (let i = 0; i < MN; i++) {
      const a = j * MN + i;
      if (i < MN - 1) ekle(a, a + 1, ara);
      if (j < MN - 1) ekle(a, a + MN, ara);
      if (i < MN - 1 && j < MN - 1) {
        ekle(a, a + MN + 1, ara * Math.SQRT2);
        ekle(a + 1, a + MN, ara * Math.SQRT2);
      }
      if (i < MN - 3) ekle(a, a + 3, ara * 3 * 0.92);
      if (j < MN - 3) ekle(a, a + 3 * MN, ara * 3 * 0.92);
    }
  return { mesh, p: new Float32Array(n * 3), o: new Float32Array(n * 3), kis: new Float32Array(kis), olcek: 0, set: null, tut: new V3(), el: new V3() };
}
const _v1 = new V3();
const _v2 = new V3();
// Mendili tutan sağ el: parmaklar avuca kıvrılır (dinlenme açıları saklanır, her karede baştan uygulanır)
const PARMAK = ['index', 'middle', 'ring', 'pinky'];
const KAVRA = -1; // bu iskelette avuç içine bükme yönü (ölçüldü: başparmak tarafı)
function parmakKavra(set, w) {
  if (!set.parmak) {
    set.parmak = [];
    for (const f of [...PARMAK, 'thumb'])
      for (const k of ['01', '02', '03']) {
        const b = set.root.getObjectByName(`${f}_${k}_r`);
        if (b) set.parmak.push({ b, q0: b.quaternion.clone(), f, k });
      }
  }
  for (const p of set.parmak) p.b.quaternion.copy(p.q0);
  if (w < 0.01 || !set.parmak.length) {
    for (const p of set.parmak) p.b.updateMatrixWorld(true);
    return;
  }
  set.B.hand_r.updateMatrixWorld(true);
  const bul = (n) => set.parmak.find((p) => p.b.name === n)?.b;
  const ib = bul('index_01_r');
  const pb = bul('pinky_01_r');
  if (!ib || !pb) return;
  // bükme ekseni: avuç boyunca (işaret kökünden serçe köküne)
  const eks = new V3().setFromMatrixPosition(pb.matrixWorld).sub(new V3().setFromMatrixPosition(ib.matrixWorld)).normalize();
  for (const p of set.parmak) {
    if (p.f === 'thumb') continue;
    p.b.updateMatrixWorld(true);
    rotWorld(p.b, new Q().setFromAxisAngle(eks, (p.k === '01' ? 1.1 : 1.3) * w * KAVRA));
  }
  for (const p of set.parmak) if (p.f === 'thumb' && p.k !== '01') rotWorld(p.b, new Q().setFromAxisAngle(eks, 0.5 * w * KAVRA));
}
function mendilGuncelle(set, dt, t) {
  const ister = dans === 'halay' && set.dansAkt?.id === 'halay';
  parmakKavra(set, mendil?.mesh.visible ? mendil.olcek : 0);
  if (!ister && !mendil?.mesh.visible) return;
  mendil ??= mendilKur();
  const m = mendil;
  const el = set.B.hand_r;
  if (!el) return;
  set.parmakR ??= set.root.getObjectByName('middle_01_r') || null;
  // tutma noktası: avuç (bilek ile orta parmak kökü arası, biraz parmağa doğru)
  const bilek = _v1.setFromMatrixPosition(el.matrixWorld);
  const parmak = set.parmakR ? _v2.setFromMatrixPosition(set.parmakR.matrixWorld) : _v2.copy(bilek).add(new V3(0, -0.08, 0));
  m.tut.copy(bilek).lerp(parmak, 1.25);
  // görünme/kaybolma: el içinden açılır gibi büyüsün
  m.olcek += ((ister ? 1 : 0) - m.olcek) * Math.min(1, dt * 5);
  if (!ister && m.olcek < 0.02) {
    m.mesh.visible = false;
    m.set = null;
    return;
  }
  const P = m.p;
  const O = m.o;
  const n = MN * MN;
  const ara = (MENDIL_BOY / (MN - 1)) * Math.max(0.05, m.olcek);
  if (m.set !== set || !m.mesh.visible) {
    // ilk kare: köşeden aşağı, hafif çapraz sarkık başlasın
    for (let j = 0; j < MN; j++)
      for (let i = 0; i < MN; i++) {
        const k = (j * MN + i) * 3;
        P[k] = O[k] = m.tut.x + (i - j) * ara * 0.35;
        P[k + 1] = O[k + 1] = m.tut.y - (i + j) * ara * 0.7;
        P[k + 2] = O[k + 2] = m.tut.z + (i + j) * ara * 0.1;
      }
    m.set = set;
    m.mesh.visible = true;
  }
  // Verlet: 3 alt adım
  const AD = 3;
  const h = Math.min(dt, 0.05) / AD;
  const yer = 0.01;
  // çarpışma küreleri: baş, göğüs, kalça (kumaş vücudun içinden geçmesin)
  const kure = [];
  for (const [b, r] of [['head', 0.11], ['spine_03', 0.16], ['spine_01', 0.15]]) {
    const kb = set.B[b];
    if (kb) kure.push(new V3().setFromMatrixPosition(kb.matrixWorld), r);
  }
  const ruzgar = Math.sin(t * 1.3) * 0.6 + Math.sin(t * 3.1) * 0.3;
  for (let s = 0; s < AD; s++) {
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      for (let a = 0; a < 3; a++) {
        const v = (P[k + a] - O[k + a]) * 0.975; // hava sürtünmesi
        O[k + a] = P[k + a];
        const ivme = a === 1 ? -9.8 : a === 0 ? ruzgar * 0.4 : ruzgar * 0.25;
        P[k + a] += v + ivme * h * h;
      }
    }
    for (let it = 0; it < 6; it++) {
      const K = m.kis;
      for (let c = 0; c < K.length; c += 3) {
        const a = K[c] * 3;
        const b = K[c + 1] * 3;
        const d0 = K[c + 2] * Math.max(0.05, m.olcek);
        const dx = P[b] - P[a];
        const dy = P[b + 1] - P[a + 1];
        const dz = P[b + 2] - P[a + 2];
        const d = Math.hypot(dx, dy, dz) || 1e-6;
        const f = ((d - d0) / d) * 0.5;
        P[a] += dx * f;
        P[a + 1] += dy * f;
        P[a + 2] += dz * f;
        P[b] -= dx * f;
        P[b + 1] -= dy * f;
        P[b + 2] -= dz * f;
      }
      // köşe elde
      P[0] = m.tut.x;
      P[1] = m.tut.y;
      P[2] = m.tut.z;
    }
    for (let i = 1; i < n; i++) {
      const k = i * 3;
      if (P[k + 1] < yer) P[k + 1] = yer;
      for (let c = 0; c < kure.length; c += 2) {
        const o = kure[c];
        const r = kure[c + 1];
        const dx = P[k] - o.x;
        const dy = P[k + 1] - o.y;
        const dz = P[k + 2] - o.z;
        const d = Math.hypot(dx, dy, dz);
        if (d < r && d > 1e-6) {
          const f = r / d;
          P[k] = o.x + dx * f;
          P[k + 1] = o.y + dy * f;
          P[k + 2] = o.z + dz * f;
        }
      }
    }
  }
  const pos = m.mesh.geometry.attributes.position;
  pos.array.set(P);
  pos.needsUpdate = true;
  m.mesh.geometry.computeVertexNormals();
}

function animate(t, dt) {
  const set = cur;
  for (const [n, r] of set.rest) {
    const b = set.B[n];
    b.quaternion.copy(r.q);
    b.position.copy(r.p);
  }
  // Dans (gerçek kayıt; yumuşak giriş ve çıkış karıştırıcıda): önce dans, sonra üstüne hafif nefes
  dansW += ((dans ? 1 : 0) - dansW) * Math.min(1, dt * 4);
  gezGuncelle(set, dt);
  if (set.mixer) {
    dansDongu(set);
    set.mixer.update(dt);
  }
  set.root.updateMatrixWorld(true);
  // Nefes ve baş
  rot('spine_03', 'x', Math.sin(t * 1.6) * 0.012 * (1 - dansW));
  rot('head', 'y', Math.sin(t * 0.45) * 0.06 * (1 - dansW));
  rot('head', 'x', Math.sin(t * 0.6) * 0.02 * (1 - dansW));
  set.root.updateMatrixWorld(true);
  mendilGuncelle(set, dt, t);
  // Göz kırpma ve gülümseme
  const now = performance.now();
  let blink = 0;
  if (now > blinkAt) {
    const p = (now - blinkAt) / 150;
    blink = p < 1 ? Math.sin(p * Math.PI) : 0;
    if (p >= 1) blinkAt = now + 2600 + Math.random() * 3000;
  }
  const smile = dans ? 0.45 : 0.22;
  expr = { mouthSmileLeft: smile, mouthSmileRight: smile, cheekSquintLeft: dans ? 0.25 : 0.08, cheekSquintRight: dans ? 0.25 : 0.08, eyeBlinkLeft: blink, eyeBlinkRight: blink };
  for (const m of set.morphers) {
    const d = m.morphTargetDictionary;
    for (const k in expr) {
      const i = d['x_' + k];
      if (i !== undefined) m.morphTargetInfluences[i] = expr[k];
    }
  }
}

// ---------------- döngü ----------------
const clock = new THREE.Clock();
// Test sayfası (?cek): pencere gizliyken de çizsin diye zamanlayıcıyla döner (uygulamada her zaman rAF)
const kare = q.has('cek') ? (f) => setTimeout(f, 16) : requestAnimationFrame;
// Duraklatma: sekme odakta değilken ya da uygulama arka plandayken uygulama "duraklat" yollar; çizim durur.
// Bekleyen portre/önizleme isteği varsa döngü o iş bitene kadar çalışır, sonra yeniden durur.
let durakli = false;
let donuyor = false; // sıraya konmuş bir kare var mı (iki döngü aynı anda koşmasın)
const bekleyenIs = () => !!portreReq || onizKuyruk.length > 0;
function donguBaslat() {
  if (donuyor) return;
  donuyor = true;
  // Dururken biriken süre atılır: ne adım (dt) ne de canlandırma saati (elapsedTime) sıçrasın
  const gecen = clock.elapsedTime;
  clock.getDelta();
  clock.elapsedTime = gecen;
  kare(loop);
}
// Isınma (2026-11-14): telefonun ekranı 120 Hz; sahne saniyede 120 kez tam çözünürlükte çiziliyordu ve
// telefon ısınıyordu. Görüntü aynı kalır, yalnız kare sayısı sınırlanır: hareket varken (dans, döndürme,
// yürüyüş, kamera geçişi, yükleme) 60, avatar sakin dururken (yalnız nefes ve göz kırpma) 30 kare/sn.
let sonCizim = 0;
let kamOynuyor = true;
let sakinSay = 0;
const hareketVar = () =>
  !!dans ||
  spin.drag ||
  Math.abs(spin.vel) > 1e-4 ||
  Math.abs(spin.target - spin.yaw) > 1e-3 ||
  gez.hareket ||
  gez.v > 1e-3 ||
  Math.abs(gez.w) > 1e-3 ||
  kamOynuyor ||
  dansW > 1e-3 ||
  bekleyenIs() ||
  !cur;
function loop() {
  if (durakli && !bekleyenIs()) {
    donuyor = false;
    return;
  }
  kare(loop);
  const simdi = performance.now();
  // Hareket bittikten sonra 1 sn daha 60 karede kalır (yavaşlarken takılma hissi olmasın)
  sakinSay = hareketVar() ? 0 : sakinSay + 1;
  const aralik = sakinSay > 60 ? 1000 / 30 : 1000 / 60;
  if (simdi - sonCizim < aralik - 3) return;
  sonCizim = simdi;
  const dt = Math.min(0.05, clock.getDelta());
  const t = clock.elapsedTime;
  if (!spin.drag) {
    spin.target += spin.vel;
    spin.vel *= Math.pow(0.04, dt);
  }
  spin.yaw += (spin.target - spin.yaw) * Math.min(1, dt * 12);
  if (cur) {
    // Bekleyen önizleme varsa karede bir tane (ekranda görünmez: aynı karede normal çizim üstüne gelir)
    if (onizKuyruk.length && cfg && !portreReq && kareNo++ % 2 === 0) onizCek(onizKuyruk.shift());
    cur.model.rotation.y = spin.yaw + gez.yaw;
    if (!q.has('ham')) animate(t, dt);
    const c = camTarget();
    const k = Math.min(1, dt * 4.5);
    kamOynuyor = camNow.pos.distanceToSquared(c.pos) > 1e-6 || camNow.look.distanceToSquared(c.look) > 1e-6;
    camNow.pos.lerp(c.pos, k);
    camNow.look.lerp(c.look, k);
    camera.position.copy(camNow.pos);
    camera.lookAt(camNow.look);
    if (portreReq && !yuk.style.display.includes('flex') && cfg) shootPortrait();
  }
  mekan.guncelle(t, dt, { dans: !!dans });
  renderer.render(scene, camera);
}

// ---------------- dış arayüz ----------------
const api = {
  set: (c) => {
    ilkIstek = true;
    applySoz = apply(c).catch((e) => post('hata', { mesaj: String(e) }));
    return applySoz;
  },
  focus: (f) => odakla(f),
  inset: (v) => {
    ustBos = Number(v?.ust ?? 0);
    altBos = Number(v?.alt ?? 0);
    resize();
  },
  // mekân: { ad: 'oda'|'teras'|'sahne'|'sade', dolap: gardırop açık mı }
  sahne: (v) => {
    if (!v) return;
    if (v.ad && v.ad !== mekan.ad) {
      mekan.sec(v.ad, cur?.man.beden || (q.get('b') === 'erkek' ? 'erkek' : 'kadin'));
      gez.x = gez.v = gez.yaw = 0;
      mekan.kok.position.x = 0;
    }
    dolapIstek = !!v.dolap;
  },
  dance: (id) => {
    id = id || null;
    if (id === dans) return;
    dans = id;
    if (cur) dansBaslat(cur, id);
  },
  yaw: (y) => (spin.target = y),
  portrait: async () => {
    await dokuHazir;
    return new Promise((res) => {
      portreReq = res;
      donguBaslat(); // duraklamışken de çekilsin
    });
  },
  // Görünmüyorken çizimi durdur (true) / sürdür (false)
  duraklat: (v) => {
    durakli = !!v;
    if (!durakli) donguBaslat();
  },
  defaults: async (beden) => defaults((await loadSet(beden)).man),
  onizle: async ({ kat, ids }) => {
    await ayarOtursun();
    await dokuHazir;
    // görüntüleyici başka bedendeyse (ayar daha gelmediyse) yanlış önizleme çekme
    const bos = () => Object.fromEntries(ids.map((id) => [id ?? '__yok', null]));
    if (!cur || !cfg || cfg.beden !== cur.man.beden) return bos();
    const no = (onizNo[kat] = (onizNo[kat] ?? 0) + 1);
    // aynı bölüm için daha yeni bir istek geldiyse kuyruktaki eskiler çekilmeden düşer
    for (let i = onizKuyruk.length - 1; i >= 0; i--) {
      if (onizKuyruk[i].kat === kat && onizKuyruk[i].no !== no) onizKuyruk.splice(i, 1)[0].res(null);
    }
    const ayri = true; // dosyası olmayan parçada sacYukle hemen döner
    // üst ya da alt önizlenirken diğeri yoksa ilk seçenek giydirilir (çıplak kalmasın): o da insin
    if ((kat === 'ust' || kat === 'alt') && cur) {
      const diger = kat === 'ust' ? 'alt' : 'ust';
      const ilk = cur.man.parcalar.find((x) => x.kat === diger);
      if (ilk) await sacYukle(cur, ilk.mesh);
    }
    const sozler = [];
    for (const id of ids) {
      // dosyası ayrı olanlar sırayla iner ve iner inmez çekilir (hepsi birden inip ekranı dondurmasın)
      if (ayri && cur) {
        const mesh = sacMesh(cur, id, kat);
        const yeni = mesh && !cur.parts[mesh];
        await sacYukle(cur, mesh);
        // yeni inen dosyalar arasında kısa nefes: hazırlık işleri art arda binip arayüzü dondurmasın
        if (yeni) await new Promise((r) => setTimeout(r, 70));
      }
      if (onizNo[kat] !== no) {
        sozler.push(Promise.resolve(null));
        continue;
      }
      sozler.push(new Promise((res) => onizKuyruk.push({ kat, id, res, no, beden: cur.man.beden })));
      donguBaslat(); // duraklamışken de çekilsin
    }
    const list = await Promise.all(sozler);
    return Object.fromEntries(ids.map((id, i) => [id ?? '__yok', list[i]]));
  },
  manifest: async (beden) => (await loadSet(beden)).man,
};
window.hohlaAvatar = api;
// Geliştirme kancaları yalnızca yerel sunucuda (yayındaki sitede açık kalmasın)
const yerelGelistirme = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
if (yerelGelistirme) window.hohlaGelistir = (fn) => fn({ cur, cfg, THREE, renderer, gez, mekan, dolapIstek }); // GEÇİCİ
// Tanı: görünen parçalar ve malzeme renkleri (geliştirme sırasında kontrol için)
if (yerelGelistirme) window.hohlaTani = () => cur && Object.entries(cur.parts).filter(([, p]) => p.obj.visible).map(([n, p]) => { const ms = meshesOf(p.obj); const g = ms[0]?.geometry; const at = {}; for (const [k, v] of Object.entries(g?.attributes || {})) if (k.startsWith('_')) { let lo = 1e9, hi = -1e9; for (let i = 0; i < v.count; i++) { const x = v.getX(i); lo = Math.min(lo, x); hi = Math.max(hi, x); } at[k] = [+lo.toFixed(3), +hi.toFixed(3)]; } return { at, n, renk: '#' + [].concat(ms[0].material)[0].color.getHexString(), kose: g?.attributes.position.count, kat: !!g?.attributes._kat, bb: g && (g.computeBoundingBox(), [g.boundingBox.min.y.toFixed(3), g.boundingBox.max.y.toFixed(3)]) }; });
window.addEventListener('message', async (e) => {
  // Yalnızca aynı sitedeki uygulama (web iframe) komut verebilir; telefonda veri injectJavaScript ile gelir
  if (e.origin !== location.origin) return;
  let m = e.data;
  if (typeof m === 'string') {
    try {
      m = JSON.parse(m);
    } catch {
      return;
    }
  }
  if (!m || m.target !== 'hohla-avatar') return;
  if (m.type === 'set') api.set(m.data);
  if (m.type === 'focus') api.focus(m.data);
  if (m.type === 'inset') api.inset(m.data);
  if (m.type === 'dance') api.dance(m.data);
  if (m.type === 'sahne') api.sahne(m.data);
  if (m.type === 'yaw') api.yaw(m.data);
  if (m.type === 'duraklat') api.duraklat(m.data);
  if (m.type === 'portre') post('portre', { data: await api.portrait() });
  if (m.type === 'manifest') post('manifest', { data: await api.manifest(m.data) });
  if (m.type === 'onizle') post('onizleme', { istek: m.data.istek, data: await api.onizle(m.data) });
});

resize();
donguBaslat();
const first = q.get('cfg');
const ilkBeden = q.get('b') === 'erkek' ? 'erkek' : 'kadin';
if (first) api.set(JSON.parse(first));
else {
  loadSet(ilkBeden).catch(() => {});
  // Uygulama ayarını hemen gönderir; tek başına açıldıysa (test sayfası) varsayılan gösterilir
  setTimeout(() => {
    if (!ilkIstek) api.set({ beden: ilkBeden });
  }, 2500);
}
if (q.get('dans')) api.dance(q.get('dans'));
post('hazir');
