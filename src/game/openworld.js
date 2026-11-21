import * as THREE from 'three';
import { createEngine } from '../core/engine.js';
import { createInput, isTouch } from '../core/input.js';
import { createShell } from '../core/ui.js';
import { sfx, loopTone, tone, setVolumes, createMusic, createAmbience, RADIO } from '../core/audio.js';
import { env, clamp, angleDiff, mulberry32 } from './util.js';
import { createSky } from './sky.js';
import { Vehicle, collideVehicles, blockVehicle } from './vehicles.js';
import { createPlayer } from './player.js';
import { createMissions } from './missions.js';
import { loadSave, writeSave, clearSave, loadSettings, writeSettings } from './save.js';
import { createCombat, WEAPONS } from './combat.js';
import { createPolice } from './police.js';
import { createWeather, WEATHER } from './weather.js';

const DAY_SECONDS = 1440; // one in-game day = 24 real minutes
const IDLE = { thr: 0, brk: 0, steer: 0, hand: false };
const MAX_VEHICLES = 50;
const FOOD_PRICE = 15; // Rp15.000
const QUALITY = {
  otomatis: { label: 'Otomatis', pr: 'auto', shadow: 2048, shadows: true },
  tinggi: { label: 'Tinggi', pr: 2, shadow: 2048, shadows: true },
  sedang: { label: 'Sedang', pr: 1, shadow: 1024, shadows: true },
  rendah: { label: 'Rendah', pr: 0.75, shadow: 1024, shadows: false },
};
const QUALITY_ORDER = ['otomatis', 'tinggi', 'sedang', 'rendah'];
const SIGN_ICON = { food: '🍴', cafe: '☕', shop: '🛍️', bank: '🏦', health: '🏥', service: '🔧', lodging: '🏨', edu: '🏫', gov: '🏛️', worship: '🕌', other: '📍' };
const SIGN_LABEL = { food: 'Rumah makan', cafe: 'Kafe / warkop', shop: 'Toko', bank: 'Bank', health: 'Kesehatan', service: 'Jasa', lodging: 'Penginapan', edu: 'Pendidikan', gov: 'Instansi', worship: 'Tempat ibadah', other: 'Tempat' };
const WEATHER_ICON = { cerah: '☀️', berawan: '⛅', hujan: '🌧️', badai: '⛈️' };
// Weapon icons for the HUD (white silhouettes).
const WEAPON_SVG = {
  fist: '<svg width="34" height="26" viewBox="0 0 34 26"><path fill="#fff" d="M6 9c0-2 1.5-3 3-3h16c2 0 3 1 3 3v2c2 0 3 1.5 3 3v4c0 4-3 7-7 7H12c-4 0-6-3-6-6z"/><path stroke="#0b0f17" stroke-width="1.4" d="M12 6v7M17 6v7M22 6v7"/></svg>',
  pistol: '<svg width="40" height="26" viewBox="0 0 40 26"><path fill="#fff" d="M3 5h33l1 2v5h-2l-1 2H20l-1 2-2 1-1 3-1 5H8l2-8-3-1-1-5H3z"/><rect x="16" y="13" width="5" height="3" fill="#0b0f17"/></svg>',
};
const rp = (k) => 'Rp' + (Math.round(k) * 1000).toLocaleString('id-ID');
const nextFrame = () => new Promise((r) => setTimeout(r, 0));

// GPS line draped on the road surface.
function routeRibbon(pts, width, heightAt) {
  const n = pts.length;
  const pos = new Float32Array(n * 6);
  const idx = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0];
    let tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    const x1 = pts[i][0] + tz * width, z1 = pts[i][1] - tx * width, x2 = pts[i][0] - tz * width, z2 = pts[i][1] + tx * width;
    pos.set([x1, heightAt(x1, z1) + 0.12, z1, x2, heightAt(x2, z2) + 0.12, z2], i * 6);
    if (i < n - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}
function densify(pts, step = 4) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  return out;
}

// Shared open-world game: camera, on-foot / swimming / vehicle control, weapons, police,
// missions, GPS, HUD, weather, music and saving. The `map` supplies the world and its AI.
export async function startOpenWorld(container, map) {
  const touch = isTouch();
  const settings = loadSettings({ quality: 'otomatis', master: 0.8, music: 0.55, sfx: 0.9, ambience: 0.7, sens: 1, invertY: false, fps: false });
  if (!QUALITY[settings.quality]) settings.quality = 'otomatis';
  setVolumes(settings);
  const save = loadSave();

  const engine = createEngine(container, { fov: 65, near: 0.3, far: 2600, exposure: 0.9 });
  const { scene, camera, renderer } = engine;
  const rnd = mulberry32(4242);
  const prevEnv = { ...env };
  Object.assign(env, map.env);
  const sky = createSky(engine);

  // ---------------- Shell first: loading screen while the world builds ----------------
  const settingDefs = [
    { id: 'quality', label: 'Kualitas grafik', type: 'cycle', get: () => settings.quality, set: () => cycleQuality(), text: () => QUALITY[settings.quality].label },
    { id: 'master', label: 'Volume utama', type: 'range', get: () => settings.master, set: (v) => setSetting('master', v) },
    { id: 'music', label: 'Musik & radio', type: 'range', get: () => settings.music, set: (v) => setSetting('music', v) },
    { id: 'sfx', label: 'Efek suara', type: 'range', get: () => settings.sfx, set: (v) => setSetting('sfx', v) },
    { id: 'ambience', label: 'Suasana (alam, hujan)', type: 'range', get: () => settings.ambience, set: (v) => setSetting('ambience', v) },
    { id: 'sens', label: 'Sensitivitas mouse', type: 'range', min: 0.3, max: 2.5, step: 0.05, get: () => settings.sens, set: (v) => setSetting('sens', v), text: (v) => v.toFixed(2) + '×' },
    { id: 'invertY', label: 'Balik sumbu Y kamera', type: 'toggle', get: () => settings.invertY, set: () => setSetting('invertY', !settings.invertY) },
    { id: 'fps', label: 'Tampilkan FPS', type: 'toggle', get: () => settings.fps, set: () => setSetting('fps', !settings.fps) },
  ];
  const controls = touch
    ? [['Joystick kiri', 'Jalan / gas & belok'], ['Joystick kanan', 'Putar kamera'], ['AKSI', 'Naik / turun kendaraan, beli makan'], ['TEMBAK', 'Tembak (otomatis membidik)'], ['SENJATA', 'Ganti senjata'], ['PETA', 'Peta & GPS']]
    : [
        ['W A S D', 'Jalan · gas, rem, belok'],
        ['Shift', 'Sprint / berenang cepat'],
        ['Space', 'Lompat · rem tangan'],
        ['F', 'Naik / turun / ambil kendaraan'],
        ['E', 'Interaksi: beli makan di warung'],
        ['Klik kanan', 'Bidik'],
        ['Klik kiri', 'Tembak / pukul'],
        ['1 · 2 · Roda', 'Ganti senjata'],
        ['R', 'Isi peluru'],
        ['M', 'Peta, klik untuk tujuan GPS'],
        ['B', 'Ganti radio (di kendaraan)'],
        ['H', 'Klakson / bel sepeda'],
        ['T', 'Percepat waktu'],
        ['Alt', 'Jalan pelan'],
        ['P / Esc', 'Jeda'],
      ];
  const about = `<p><b>${map.title}</b> adalah game open world 3D yang dibangun dari data sungguhan Kelurahan Pettuadae, Kecamatan Turikale, Kabupaten Maros, Sulawesi Selatan: jaringan jalan, sungai, ribuan bangunan, toko dan tempat usaha, serta ketinggian tanah.</p>
    <p>Ketinggian tanah dari AWS Terrain Tiles (SRTM). Semua suara dan musik dibuat secara prosedural di browser.</p>
    <p>Dibuat oleh <b>Ammar Tyo Pasaribu</b>.</p>`;

  let S = null;
  let P = null;
  let engineSnd = null;
  const shell = createShell(container, {
    title: map.title,
    subtitle: map.subtitle,
    accent: map.accent,
    credits: map.credits,
    hasSave: !!save,
    controls,
    settings: settingDefs,
    about,
    pauseItems: [
      { id: 'map', label: 'Buka Peta', onClick: () => { shell.setPaused(false); openMap(); } },
      { id: 'weather', label: 'Cuaca: Otomatis', onClick: () => shell.setPauseLabel('weather', 'Cuaca: ' + weather.cycleMode()) },
      { id: 'reset', label: 'Hapus progres & mulai baru', onClick: () => { clearSave(); location.reload(); } },
      { id: 'menu', label: 'Simpan & ke menu utama', onClick: () => { saveNow(); location.reload(); } },
    ],
    onStart: startGame,
    onPause: (p) => {
      engine.setRunning(!p);
      if (p) {
        document.exitPointerLock?.();
        engineSnd?.set(40, 0);
      } else lock();
    },
    onKey: (e) => {
      if (!S) return false;
      if (S.mapOpen && (e.code === 'KeyM' || e.code === 'Escape')) {
        closeMap();
        return true;
      }
      if (e.code === 'KeyM' && S.mode !== 'menu' && !shell.paused) {
        openMap();
        return true;
      }
      return false;
    },
  });
  shell.loading(0.02, 'Menyiapkan mesin grafis…');
  await nextFrame();

  // ---------------- World ----------------
  const playerObs = { x: 0, z: 0, r: 0.4 };
  const obsBuf = [];
  let vehicles = [];
  const built = await map.create({
    scene,
    camera,
    rnd,
    progress: async (f, label) => {
      shell.loading(0.05 + f * 0.9, label);
      await nextFrame();
    },
    getObstacles() {
      obsBuf.length = 0;
      for (const v of vehicles) obsBuf.push(v);
      if (S && !S.car) {
        playerObs.x = P.x;
        playerObs.z = P.z;
        obsBuf.push(playerObs);
      }
      return obsBuf;
    },
  });
  shell.loading(0.96, 'Menyiapkan pemain…');
  await nextFrame();
  const { world, traffic, peds, animals } = built;
  vehicles = built.vehicles;
  const SPAWN = map.spawn;
  const player = createPlayer(scene, world.colliders);
  P = player.P;
  player.place(SPAWN.x, SPAWN.z, SPAWN.face);
  const missions = createMissions(scene, rnd, built.pickDestination);
  const combat = createCombat({ scene, camera, colliders: world.colliders, hero: player.hero });
  const police = createPolice({ scene, M: built.M, route: built.route, vehicles, colliders: world.colliders, combat });
  const weather = createWeather({ scene, camera });
  const music = createMusic();
  const ambience = createAmbience();
  const hazards = [];

  // Headlights move to whichever vehicle the player drives.
  const lights = [-0.6, 0.6].map((sx) => {
    const sl = new THREE.SpotLight(0xfff1d0, 0, 60, 0.5, 0.6, 1.2);
    sl.position.set(sx, 0.8, 2.0);
    const tg = new THREE.Object3D();
    tg.position.set(sx, 0, 18);
    sl.target = tg;
    return { sl, tg };
  });
  // Lights are only re-parented, never removed: changing the number of lights in the scene
  // forces every material to recompile, which shows up as a stutter.
  const lightHolder = new THREE.Group();
  lightHolder.userData.dynamic = true;
  scene.add(lightHolder);
  function attachLights(v) {
    lights.forEach(({ sl, tg }, i) => {
      if (!v || (v.spec.moto && i > 0)) {
        lightHolder.add(sl, tg);
        sl.intensity = 0;
        return;
      }
      const sx = v.spec.moto ? 0 : i ? 0.6 : -0.6;
      sl.position.set(sx, v.spec.moto ? 1.1 : 0.8, v.spec.moto ? 0.7 : 2.0);
      tg.position.set(sx, 0, 18);
      v.root.add(sl, tg);
    });
  }
  attachLights(null);

  // GPS line on the road.
  const routeMat = new THREE.MeshBasicMaterial({ color: 0xc084fc, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide });
  const routeMesh = new THREE.Mesh(new THREE.BufferGeometry(), routeMat);
  routeMesh.renderOrder = 3;
  routeMesh.frustumCulled = false;
  routeMesh.userData.dynamic = true;
  scene.add(routeMesh);

  // ---------------- State ----------------
  S = {
    mode: 'menu', t: 0, timeH: 16, money: 50, car: null, camYaw: SPAWN.cam, camPitch: 0.3, lastLook: -10, hurt: 0, regen: 0, wastedT: 0, shake: 0, hudT: 0, prompt: '',
    waypoint: null, route: null, routeColor: '#c084fc', routeT: 0, street: '', streetT: 0, saveT: 0, mapOpen: false,
    anim: null, frame: 0, mapT: 0, fpsT: 0, fpsN: 0, lastNow: 0, aim: 0, aiming: false, hitT: 0, radio: 1, deadKind: '', hint: 0,
  };

  // ---------------- Settings & quality ----------------
  const maxPR = Math.min(window.devicePixelRatio || 1, 2);
  let autoPR = Math.min(maxPR, touch ? 1 : 1.5);
  function applyQuality() {
    const q = QUALITY[settings.quality] || QUALITY.otomatis;
    renderer.setPixelRatio(q.pr === 'auto' ? autoPR : q.pr >= 2 ? maxPR : q.pr);
    renderer.setSize(container.clientWidth, container.clientHeight);
    sky.light.castShadow = q.shadows;
    if (sky.light.shadow.mapSize.x !== q.shadow) {
      sky.light.shadow.mapSize.set(q.shadow, q.shadow);
      sky.light.shadow.map?.dispose();
      sky.light.shadow.map = null;
    }
    renderer.shadowMap.needsUpdate = true;
  }
  function cycleQuality() {
    const i = QUALITY_ORDER.indexOf(settings.quality);
    settings.quality = QUALITY_ORDER[(i + 1) % QUALITY_ORDER.length];
    writeSettings(settings);
    applyQuality();
  }
  function setSetting(k, v) {
    settings[k] = v;
    writeSettings(settings);
    setVolumes(settings);
    fpsEl.hidden = !settings.fps;
  }
  applyQuality();
  // The sun's shadow map is re-rendered every other frame instead of every frame.
  renderer.shadowMap.autoUpdate = false;

  // ---------------- Input ----------------
  const input = createInput(container);
  const canvas = renderer.domElement;
  let moveStick = null;
  let lookStick = null;
  const tb = { act: false, jump: false, run: false, fire: false };
  let actionPressed = false;
  const mouse = { left: false, right: false, clickT: 0, wheel: 0 };

  const lock = () => {
    if (touch) return;
    try {
      const r = canvas.requestPointerLock?.();
      r?.catch?.(() => {});
    } catch {
      /* pointer lock unavailable */
    }
  };

  const minimap = built.createMinimap(shell.root);
  const fullMap = built.createFullMap(shell.root, {
    onWaypoint(w) {
      S.waypoint = w;
      S.routeT = 0;
      if (!w) clearRoute();
      tone(w ? 880 : 440, 0.08, { type: 'triangle', vol: 0.15 });
    },
    onClose: () => closeMap(),
  });
  const el = (cls, html = '') => {
    const d = document.createElement('div');
    d.className = cls;
    d.innerHTML = html;
    return d;
  };
  const promptEl = el('prompt');
  promptEl.hidden = true;
  const streetEl = el('street-name');
  const dmg = el('damage');
  const cross = el('crosshair');
  cross.hidden = true;
  const vitals = el('vitals', '<div class="hp"><i></i></div><div class="st"><i></i></div>');
  const speedo = el('speedo', `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" fill="rgba(0,0,0,.45)" stroke="rgba(255,255,255,.15)" stroke-width="2"/><path class="trk" d="" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="6" stroke-linecap="round"/><path class="val" d="" fill="none" stroke="#4ade80" stroke-width="6" stroke-linecap="round"/></svg><div class="num"><b>0</b><span>KM/J</span></div><div class="veh"></div>`);
  speedo.hidden = true;
  const fpsEl = el('fps');
  fpsEl.hidden = !settings.fps;
  shell.root.append(promptEl, streetEl, dmg, cross, vitals, speedo, fpsEl);
  const arc = (a0, a1) => {
    const p = (a) => [50 + Math.cos(a) * 38, 50 + Math.sin(a) * 38];
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A 38 38 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };
  const A0 = Math.PI * 0.75, A1 = Math.PI * 2.25;
  speedo.querySelector('.trk').setAttribute('d', arc(A0, A1));

  if (touch) {
    moveStick = input.joystick(shell.root, 'left');
    lookStick = input.joystick(shell.root, 'right');
    for (const [k, label, right, bottom] of [['act', 'AKSI', 30, 170], ['jump', 'LOMPAT', 120, 150], ['run', 'LARI', 30, 260], ['map', 'PETA', 120, 240], ['fire', 'TEMBAK', 210, 170], ['weapon', 'SENJATA', 210, 260]]) {
      const b = document.createElement('button');
      b.className = 'touch-btn' + (k === 'fire' ? ' fire' : '');
      b.textContent = label;
      b.style.right = right + 'px';
      b.style.bottom = bottom + 'px';
      input.on(b, 'touchstart', (e) => {
        e.preventDefault();
        if (k === 'map') return S.mapOpen ? closeMap() : openMap();
        if (k === 'weapon') return switchWeapon((combat.W.slot + 1) % WEAPONS.length);
        tb[k] = true;
        if (k === 'act') actionPressed = true;
      }, { passive: false });
      input.on(b, 'touchend', () => (tb[k] = false));
      shell.root.appendChild(b);
    }
  }

  let dragging = false;
  input.on(canvas, 'contextmenu', (e) => e.preventDefault());
  input.on(canvas, 'pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || S.mode === 'menu' || shell.paused || S.mapOpen) return;
    const locked = document.pointerLockElement === canvas;
    if (e.button === 2) mouse.right = true;
    if (e.button === 0) {
      if (locked) {
        mouse.left = true;
        mouse.clickT = 0.12;
      } else dragging = true;
    }
    lock();
  });
  input.on(window, 'pointerup', (e) => {
    dragging = false;
    if (e.button === 2) mouse.right = false;
    if (e.button === 0) mouse.left = false;
  });
  input.on(window, 'wheel', (e) => {
    if (S.mode === 'play' && !S.car && !shell.paused && !S.mapOpen) mouse.wheel += Math.sign(e.deltaY);
  }, { passive: true });
  input.on(window, 'pointermove', (e) => {
    if (S.mode === 'menu' || shell.paused || S.mapOpen || e.pointerType === 'touch') return;
    if (!(document.pointerLockElement === canvas || dragging)) return;
    const k = settings.sens * (S.aiming ? 0.55 : 1);
    S.camYaw -= e.movementX * 0.0026 * k;
    S.camPitch = clamp(S.camPitch + e.movementY * 0.0022 * k * (settings.invertY ? -1 : 1), -0.5, 1.25);
    S.lastLook = S.t;
  });
  input.on(document, 'pointerlockchange', () => {
    if (document.pointerLockElement !== canvas && S.mode !== 'menu' && !shell.paused && !S.mapOpen && shell.playing) shell.setPaused(true);
  });

  // ---------------- Map & GPS ----------------
  function mapState() {
    const m = missions.state;
    return {
      player: { x: P.x, z: P.z, face: S.car ? S.car.h : P.face },
      mission: m.active ? { x: m.x, z: m.z, name: m.name } : null,
      waypoint: S.waypoint,
      route: S.route,
      routeColor: S.routeColor,
    };
  }
  function openMap() {
    if (S.mode === 'menu') return;
    S.mapOpen = true;
    engine.setRunning(false);
    engineSnd?.set(40, 0);
    document.exitPointerLock?.();
    fullMap.show(mapState());
  }
  function closeMap() {
    S.mapOpen = false;
    fullMap.hide();
    engine.setRunning(true);
    lock();
  }
  function clearRoute() {
    S.route = null;
    routeMesh.geometry.dispose();
    routeMesh.geometry = new THREE.BufferGeometry();
  }
  function updateRoute(dt) {
    S.routeT -= dt;
    if (S.routeT > 0) return;
    S.routeT = 0.8;
    const m = missions.state;
    let target = null;
    if (S.waypoint) {
      target = S.waypoint;
      S.routeColor = '#c084fc';
      if (Math.hypot(P.x - target.x, P.z - target.z) < 12) {
        S.waypoint = null;
        shell.toast('Sampai di tujuan', 1400);
        sfx.pickup();
        clearRoute();
        return;
      }
    } else if (m.active) {
      target = m;
      S.routeColor = '#facc15';
    }
    if (!target) {
      if (S.route) clearRoute();
      return;
    }
    const pts = built.route(P.x, P.z, target.x, target.z);
    if (!pts) return;
    S.route = pts;
    // Only the next ~400 m are drawn on the road.
    const near = [];
    let len = 0;
    for (let i = 0; i < pts.length; i++) {
      if (i) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      near.push(pts[i]);
      if (len > 400) break;
    }
    routeMesh.geometry.dispose();
    routeMesh.geometry = near.length > 1 ? routeRibbon(densify(near, 4), 0.35, (x, z) => env.groundHeight(x, z)) : new THREE.BufferGeometry();
    routeMat.color.set(S.routeColor);
    if (S.mapOpen) fullMap.refresh(mapState());
  }

  // ---------------- Game flow ----------------
  function startGame(fresh) {
    S.mode = 'play';
    S.hurt = 0;
    P.hp = 100;
    P.stamina = 100;
    if (S.car) leaveCar(true);
    if (!fresh && save) {
      S.money = save.money ?? 50;
      S.timeH = save.timeH ?? 16;
      combat.W.mag = save.mag ?? 12;
      combat.W.reserve = save.ammo ?? 60;
      player.place(save.x ?? SPAWN.x, save.z ?? SPAWN.z, SPAWN.face, save.y);
      shell.toast('Progres dimuat', 1400);
    } else {
      S.money = 50;
      S.timeH = 16;
      player.place(SPAWN.x, SPAWN.z, SPAWN.face);
      shell.help('Selamat datang di <b>Pettuadae</b>! Kamu berdiri di depan kantor <b>BPS Kabupaten Maros</b>. Naik motor merah dengan <kbd>F</kbd>, buka peta dengan <kbd>M</kbd>.', 9000);
    }
    S.camYaw = SPAWN.cam;
    missions.reset();
    police.clear();
    music.stop();
    lock();
  }

  function saveNow() {
    if (!S || S.mode !== 'play') return;
    writeSave({ money: S.money, timeH: S.timeH, x: P.x, z: P.z, y: P.y, mag: combat.W.mag, ammo: combat.W.reserve });
  }

  function nearestVehicle() {
    let best = null;
    let bd = 3.6;
    for (const v of vehicles) {
      if (v.wrecked) continue;
      const d = Math.hypot(v.x - P.x, v.z - P.z) - (v.spec.moto ? 0.6 : 0);
      if (d < bd && Math.abs(v.y - P.y) < 2.5) { bd = d; best = v; }
    }
    return best;
  }
  function nearestTraffic() {
    let best = null;
    let bd = 4.2;
    for (const c of traffic.cars) {
      if (!c.legs.length || c.v > 9) continue;
      const d = Math.hypot(c.x - P.x, c.z - P.z);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  // Walk to the driver door, open it, get in, close it (two-wheelers: walk up and swing on).
  function enterCar(v) {
    if (S.anim) return;
    ctlDrive.thr = ctlDrive.brk = ctlDrive.steer = 0;
    ctlDrive.hand = false;
    S.anim = { kind: 'enter', v, t: 0, fx: P.x, fz: P.z };
    S.aiming = false;
  }

  function finishEnter(v) {
    S.car = v;
    v.driver = true;
    if (v.spec.moto) player.mount(v.model.body, v.spec.bike ? 'bike' : 'moto');
    else player.root.visible = false;
    attachLights(v.spec.bike ? null : v);
    engineSnd?.stop();
    engineSnd = null;
    if (!v.spec.bike) {
      engineSnd = v.spec.moto ? loopTone({ type: 'square', freq: 90, vol: 0.03, filter: 900 }) : loopTone({ type: 'sawtooth', freq: 50, vol: 0.04, filter: 600 });
      tone(220, 0.08, { type: 'square', vol: 0.12 });
      if (!v.spec.moto) setRadio(S.radio, true);
    }
    if (v.spec.police) police.add(1, 1);
    if (S.hint < 2 && !v.spec.bike) {
      S.hint++;
      shell.help(`Gas <kbd>W</kbd>, rem/mundur <kbd>S</kbd>, rem tangan <kbd>Space</kbd>. ${v.spec.moto ? '' : 'Ganti radio <kbd>B</kbd>. '}Turun dengan <kbd>F</kbd>.`, 6000);
    }
  }

  function setRadio(i, quiet = false) {
    S.radio = (i + RADIO.length) % RADIO.length;
    const st = RADIO[S.radio];
    music.play(st.id);
    if (!quiet || st.id) {
      const lab = el('radio-label', `📻 ${st.name}`);
      shell.root.appendChild(lab);
      setTimeout(() => lab.remove(), 2700);
    }
  }

  // Carjack: take an AI vehicle, its driver runs away.
  function hijack(c) {
    const info = traffic.takeOver(c);
    const v = new Vehicle(scene, info.type, info.color, info.x, info.z, info.h);
    v.vx = Math.sin(info.h) * info.v * 0.3;
    v.vz = Math.cos(info.h) * info.v * 0.3;
    vehicles.push(v);
    peds.spawnFleeing(info.x + Math.cos(info.h) * 2, info.z - Math.sin(info.h) * 2);
    enterCar(v);
    shell.toast(`${v.spec.label} diambil!`, 1300);
    if (police.nearest(P.x, P.z) < 60) police.add(1, 1);
    trimVehicles();
  }

  // Keep the number of loose vehicles bounded: drop far, unused ones.
  function trimVehicles() {
    while (vehicles.length > MAX_VEHICLES) {
      let far = null;
      let fd = 0;
      for (const v of vehicles) {
        if (v === S.car || v.police) continue;
        const d = Math.hypot(v.x - P.x, v.z - P.z);
        if (d > fd) { fd = d; far = v; }
      }
      if (!far || fd < 120) break;
      far.dispose(scene);
      vehicles.splice(vehicles.indexOf(far), 1);
    }
  }

  // Open the door, step out, close it.
  function beginExit() {
    const v = S.car;
    if (!v || S.anim) return;
    if (v.speed > 3 && !v.drowned) {
      shell.toast('Berhenti dulu untuk turun', 1100);
      return;
    }
    ctlDrive.thr = ctlDrive.brk = ctlDrive.steer = 0;
    S.anim = { kind: 'exit', v, t: 0 };
  }

  function stepAnim(dt) {
    const A = S.anim;
    const v = A.v;
    A.t += dt;
    if (A.kind === 'enter') {
      const dp = v.doorPoint();
      const walkT = 0.4;
      if (A.t < walkT) {
        const k = A.t / walkT;
        P.x = A.fx + (dp.x - A.fx) * k;
        P.z = A.fz + (dp.z - A.fz) * k;
        P.y = env.groundHeight(P.x, P.z, P.y);
        P.face = Math.atan2(dp.x - A.fx, dp.z - A.fz);
        player.hero.run(A.t * 11, 0.55);
        player.sync();
        return;
      }
      if (v.spec.moto) {
        if (!A.done) {
          A.done = true;
          finishEnter(v);
        }
        if (A.t > walkT + 0.25) S.anim = null;
        return;
      }
      P.face = Math.atan2(v.x - P.x, v.z - P.z);
      if (A.t < walkT + 0.35) {
        if (!A.opened) { A.opened = true; sfx.door(true); }
        v.setDoor((A.t - walkT) / 0.35);
        player.hero.idle(A.t);
      } else if (A.t < walkT + 0.7) {
        const k = (A.t - walkT - 0.35) / 0.35;
        P.x = dp.x + (v.x - dp.x) * k * 0.45;
        P.z = dp.z + (v.z - dp.z) * k * 0.45;
        if (k > 0.7 && !A.done) {
          A.done = true;
          finishEnter(v);
        }
      } else if (A.t < walkT + 1.05) v.setDoor(1 - (A.t - walkT - 0.7) / 0.35);
      else {
        v.setDoor(0);
        sfx.door(false);
        S.anim = null;
      }
      if (!A.done) player.sync();
    } else {
      if (v.spec.moto) {
        leaveCar();
        S.anim = null;
        return;
      }
      if (A.t < 0.3) {
        if (!A.opened) { A.opened = true; sfx.door(true); }
        v.setDoor(A.t / 0.3);
      } else if (!A.out) {
        A.out = true;
        leaveCar(false, v.doorPoint());
      } else if (A.t < 0.95) v.setDoor(Math.min(1, Math.max(0, 1 - (A.t - 0.6) / 0.35)));
      else {
        v.setDoor(0);
        sfx.door(false);
        S.anim = null;
      }
    }
  }

  function leaveCar(silent = false, at = null) {
    const v = S.car;
    if (!v) return;
    const lx = Math.cos(v.h);
    const lz = -Math.sin(v.h);
    const side = v.spec.moto ? 1.1 : 2.3;
    let ex = v.x + lx * side;
    let ez = v.z + lz * side;
    for (const sgn of at ? [0] : [1, -1]) {
      player.probe.x = at ? at.x : v.x + lx * side * sgn;
      player.probe.z = at ? at.z : v.z + lz * side * sgn;
      player.probe.y = v.y + 1;
      const hit = world.colliders.resolve(player.probe, 0.45);
      ex = player.probe.x;
      ez = player.probe.z;
      if (!hit) break;
    }
    v.driver = false;
    v.braking = false;
    S.car = null;
    attachLights(null);
    engineSnd?.stop();
    engineSnd = null;
    music.stop();
    if (v.spec.moto) player.dismount();
    player.root.visible = true;
    player.place(ex, ez, v.h, v.y);
    if (!silent && !v.spec.moto) tone(180, 0.08, { type: 'square', vol: 0.1 });
  }

  function hurtPlayer(amount) {
    if (S.hurt > 0.15 || S.mode !== 'play') return;
    P.hp -= amount;
    S.hurt = 0.5;
    S.regen = 7;
    S.shake = Math.max(S.shake, Math.min(0.6, amount * 0.03));
    sfx.hurt();
    if (P.hp <= 0) die('wasted');
  }

  function die(kind) {
    if (S.mode !== 'play') return;
    P.hp = Math.max(0, P.hp);
    S.mode = 'wasted';
    S.deadKind = kind;
    S.wastedT = 4.2;
    S.aiming = false;
    if (S.car) leaveCar(true);
    const loss = kind === 'busted' ? Math.min(S.money, Math.max(30, Math.round(S.money * 0.15))) : Math.min(S.money, Math.max(20, Math.round(S.money * 0.1)));
    S.money -= loss;
    canvas.classList.add('dead');
    if (kind === 'busted') {
      shell.big('BUSTED', `Ditangkap polisi · denda ${rp(loss)} · senjata disita`, 'busted', 4000);
      combat.W.reserve = 0;
      combat.W.mag = 0;
      sfx.busted();
    } else {
      shell.big('WASTED', `Biaya rumah sakit ${rp(loss)}`, 'wasted', 4000);
      sfx.lose();
    }
    missions.reset();
  }

  function respawn() {
    S.mode = 'play';
    P.hp = 100;
    P.stamina = 100;
    canvas.classList.remove('dead');
    police.clear();
    player.place(SPAWN.x, SPAWN.z, SPAWN.face);
    S.camYaw = SPAWN.cam;
    if (S.deadKind === 'busted') {
      combat.W.mag = 12;
      combat.W.reserve = 24;
    }
  }

  // ---------------- Weapons ----------------
  function switchWeapon(slot) {
    if (combat.select(slot)) {
      sfx.ui();
      S.hudT = 0;
    }
  }
  const aimO = new THREE.Vector3();
  const aimD = new THREE.Vector3();
  const targets = [];
  function gatherTargets() {
    targets.length = 0;
    peds.targets(targets, P.x, P.z);
    animals.targets(targets, P.x, P.z);
    police.targets(targets);
    for (const v of vehicles) if (v !== S.car && Math.abs(v.x - P.x) < 140 && Math.abs(v.z - P.z) < 140) for (const [x, z] of v.circles()) targets.push({ x, y: v.y, z, r: v.spec.r * (v.spec.moto ? 0.9 : 1), h: v.spec.moto ? 1.3 : 1.6, ref: v, kind: 'vehicle' });
    for (const c of traffic.cars) if (c.legs.length && Math.abs(c.x - P.x) < 140 && Math.abs(c.z - P.z) < 140) for (const [x, z] of c.circles()) targets.push({ x, y: c.y || 0, z, r: c.r, h: c.spec.moto ? 1.3 : 1.6, ref: c, kind: 'traffic' });
    return targets;
  }
  // Something was shot or punched.
  function applyHit(hit, dmgAmt, dirX, dirZ) {
    const tg = hit.target;
    if (!tg) return;
    S.hitT = 0.15;
    if (tg.kind === 'ped' || tg.kind === 'loiter') {
      peds.kill(tg.ref, dirX, dirZ, true);
      combat.bleed(hit.x, hit.y, hit.z);
      sfx.flesh();
      police.add(1, 1);
      peds.scare(hit.x, hit.z, 50);
    } else if (tg.kind === 'cop') {
      police.hitOfficer(tg.ref, dmgAmt * 1.5, dirX, dirZ);
    } else if (tg.kind === 'animal') {
      animals.kill(tg.ref, dirX, dirZ);
      combat.bleed(hit.x, hit.y, hit.z, 8);
    } else if (tg.kind === 'vehicle' || tg.kind === 'traffic') {
      combat.sparks(hit.x, hit.y, hit.z, 10);
      sfx.impact(1);
      damageVehicle(tg.ref, dmgAmt * 0.45, tg.kind === 'traffic');
      peds.scare(hit.x, hit.z, 30);
    }
  }
  // Vehicle health: smoke below 40, fire below 15, then it explodes.
  function damageVehicle(v, amount, isTraffic = false) {
    if (isTraffic) {
      // Shooting an AI car: the driver flees and the car becomes a loose (damageable) vehicle.
      if (!v.legs.length) return;
      const info = traffic.takeOver(v);
      const nv = new Vehicle(scene, info.type, info.color, info.x, info.z, info.h);
      nv.health = 100 - amount;
      vehicles.push(nv);
      peds.spawnFleeing(info.x + Math.cos(info.h) * 2, info.z - Math.sin(info.h) * 2);
      trimVehicles();
      return;
    }
    if (v.wrecked) return;
    v.health -= amount;
    if (v.health <= 0 && !v.burning) v.burning = 3.5;
  }
  function explodeVehicle(v) {
    v.wrecked = true;
    v.burning = 0;
    v.health = 0;
    v.model.paint.color.set(0x1c1a18);
    v.model.paint.roughness = 1;
    v.model.paint.metalness = 0;
    combat.explode(v.x, v.y, v.z);
    const d = Math.hypot(camera.position.x - v.x, camera.position.z - v.z);
    sfx.explosion(Math.max(0.25, 1 - d / 200));
    S.shake = Math.max(S.shake, Math.max(0, 1.2 - d / 40));
    peds.scare(v.x, v.z, 70);
    // Blast damage.
    for (const p of peds.peds) if (p.active && Math.hypot(p.x - v.x, p.z - v.z) < 6) peds.kill(p, p.x - v.x, p.z - v.z, true);
    for (const a of animals.all) if (a.state !== 'off' && Math.hypot(a.x - v.x, a.z - v.z) < 6) animals.kill(a);
    for (const o of [...police.officers]) if (Math.hypot(o.x - v.x, o.z - v.z) < 6) police.hitOfficer(o, 200, 0, 0);
    for (const w of vehicles) if (w !== v && !w.wrecked && Math.hypot(w.x - v.x, w.z - v.z) < 7) damageVehicle(w, 60);
    if (v === S.car) {
      leaveCar(true);
      hurtPlayer(80);
    } else if (!S.car && Math.hypot(P.x - v.x, P.z - v.z) < 7) hurtPlayer(Math.max(15, 70 - Math.hypot(P.x - v.x, P.z - v.z) * 9));
    if (police.nearest(v.x, v.z) < 90 || peds.peds.some((p) => p.active && Math.hypot(p.x - v.x, p.z - v.z) < 40)) police.add(1, 2);
  }

  // ---------------- Camera ----------------
  const focus = new THREE.Vector3();
  const camTarget = new THREE.Vector3();
  const desired = new THREE.Vector3();

  function updateCamera(dt, t) {
    let dist;
    if (S.mode === 'menu') {
      built.menuCamera(t, camera, camTarget);
      camera.lookAt(camTarget);
      focus.copy(camTarget);
      return;
    }
    const v = S.car;
    // Over-the-shoulder offset while aiming.
    S.aim += ((S.aiming ? 1 : 0) - S.aim) * Math.min(1, dt * 10);
    if (v) {
      camTarget.set(v.x, v.y + (v.spec.moto ? 1.55 : 1.35), v.z);
      dist = v.spec.cam + Math.min(4.5, v.speed * 0.09);
      if (t - S.lastLook > 1.2 && v.speed > 2.5) {
        const follow = v.vF >= -0.5 ? v.h : v.h + Math.PI;
        S.camYaw += angleDiff(follow, S.camYaw) * Math.min(1, dt * 2.2);
        S.camPitch += (0.22 - S.camPitch) * Math.min(1, dt * 1.2);
      }
    } else {
      const side = 0.55 + S.aim * 0.5;
      camTarget.set(P.x - Math.cos(S.camYaw) * side, P.y + 1.55 + (P.swimming ? 0.2 : 0), P.z + Math.sin(S.camYaw) * side);
      // Indoors the camera stays closer.
      dist = (env.ceilingAt(P.x, P.z, P.y) < Infinity ? 2.6 : 4.1) - S.aim * 1.3;
    }
    const cp = Math.cos(S.camPitch);
    const dx = -Math.sin(S.camYaw) * cp;
    const dy = Math.sin(S.camPitch);
    const dz = -Math.cos(S.camYaw) * cp;
    let d = dist;
    for (let k = 1; k <= 12; k++) {
      const s = (dist * k) / 12;
      if (world.colliders.inside(camTarget.x + dx * s, camTarget.z + dz * s, camTarget.y + dy * s)) {
        d = Math.max(0.9, (dist * (k - 1)) / 12);
        break;
      }
    }
    // Interior walls (height-aware segments) and ceilings.
    const hit = world.colliders.rayCast(camTarget.x, camTarget.z, camTarget.x + dx * d, camTarget.z + dz * d, camTarget.y + dy * d * 0.5);
    if (hit < 1) d = Math.max(0.45, d * hit - 0.25);
    desired.set(camTarget.x + dx * d, camTarget.y + dy * d, camTarget.z + dz * d);
    // Stay above the ground and the water surface.
    const floorY = Math.max(env.groundHeight(desired.x, desired.z, camTarget.y) + 0.45, env.waterAt(desired.x, desired.z) + 0.3);
    if (desired.y < floorY) desired.y = floorY;
    const ceil = env.ceilingAt(desired.x, desired.z, P.y);
    if (desired.y > ceil - 0.25) desired.y = ceil - 0.25;
    camera.position.lerp(desired, Math.min(1, dt * (d < dist || S.aim > 0.5 ? 30 : 12)));
    if (S.shake > 0) {
      S.shake = Math.max(0, S.shake - dt * 1.6);
      camera.position.x += (Math.random() - 0.5) * S.shake;
      camera.position.y += (Math.random() - 0.5) * S.shake;
    }
    // Look along the view direction through the target (keeps the crosshair exactly centred).
    camera.lookAt(camTarget.x - dx * 30, camTarget.y - dy * 30, camTarget.z - dz * 30);
    const fov = 65 - S.aim * 16 + (v ? Math.min(18, v.speed * 0.45) : P.sprinting ? 5 : 0);
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 6);
    camera.updateProjectionMatrix();
    focus.copy(camTarget);
  }

  // ---------------- Main loop ----------------
  const fmtTime = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
  const ctlDrive = { thr: 0, brk: 0, steer: 0, hand: false };
  const dangers = [];
  let hudState = '';
  let menuMusic = false;

  player.on.step = (hard, wet) => sfx.step(hard ? 1.3 : 1, wet);
  player.on.splash = (v) => sfx.splash(v);
  player.on.stroke = () => sfx.stroke();

  // Food: warung / cafe places and food carts within a few metres.
  function foodNear() {
    const pl = built.placeNear?.(P.x, P.z, 9);
    if (pl && (pl.group === 'food' || pl.group === 'cafe')) return pl;
    for (const c of world.props.carts) if (Math.hypot(c.x - P.x, c.z - P.z) < 3.5) return { name: 'Gerobak ' + c.name };
    return null;
  }

  const tick = (dt, t) => {
    S.t = t;
    S.frame++;
    // Always render it while no shadow map exists yet (first frame, after a quality change).
    if (S.frame % 2 === 0 || !sky.light.shadow.map) renderer.shadowMap.needsUpdate = true;
    // Adaptive resolution for the 'Otomatis' preset, based on real frame times.
    const now = performance.now();
    if (S.lastNow) {
      S.fpsT += now - S.lastNow;
      S.fpsN++;
    }
    S.lastNow = now;
    if (S.fpsT > 1000) {
      const fps = (1000 * S.fpsN) / S.fpsT;
      S.fps = fps;
      S.fpsT = S.fpsN = 0;
      if (settings.fps) fpsEl.textContent = `${fps.toFixed(0)} FPS · ${renderer.info.render.calls} draw · ${(renderer.info.render.triangles / 1000).toFixed(0)}k tri`;
      if (settings.quality === 'otomatis') {
        S.fpsSlow = (S.fpsSlow || 0) + 1;
        if (S.fpsSlow >= 2) {
          S.fpsSlow = 0;
          const next = fps < 45 ? Math.max(0.6, autoPR * 0.85) : fps > 58 ? Math.min(maxPR, autoPR * 1.1) : autoPR;
          if (Math.abs(next - autoPR) > 0.02) {
            autoPR = next;
            applyQuality();
          }
        }
      }
    }
    const playing = S.mode === 'play';
    const live = playing || S.mode === 'wasted';

    // ---- Input ----
    let fwd = (input.down('KeyW', 'ArrowUp') ? 1 : 0) - (input.down('KeyS', 'ArrowDown') ? 1 : 0);
    let right = (input.down('KeyD', 'ArrowRight') ? 1 : 0) - (input.down('KeyA', 'ArrowLeft') ? 1 : 0);
    if (moveStick?.active) {
      right = moveStick.x;
      fwd = -moveStick.y;
    }
    const sprint = input.down('ShiftLeft', 'ShiftRight') || tb.run;
    const walk = input.down('AltLeft', 'AltRight');
    const jumpHit = input.hit('Space') || (tb.jump && !S.car && (tb.jump = false, true));
    const hand = input.down('Space') || tb.jump;
    const act = input.hit('KeyF') || (actionPressed && (S.car || nearestVehicle() || nearestTraffic()));
    const interact = input.hit('KeyE') || (actionPressed && !act);
    actionPressed = false;
    if (input.hit('KeyT')) S.timeH += 1;
    if (input.hit('KeyH') && S.car) S.car.spec.bike ? sfx.bell() : sfx.horn(S.car.spec.moto);
    if (input.hit('KeyB') && S.car && !S.car.spec.moto) setRadio(S.radio + 1);
    if (input.hit('Digit1')) switchWeapon(0);
    if (input.hit('Digit2')) switchWeapon(1);
    if (input.hit('KeyR')) combat.reload();
    if (mouse.wheel) {
      switchWeapon((combat.W.slot + (mouse.wheel > 0 ? 1 : WEAPONS.length - 1)) % WEAPONS.length);
      mouse.wheel = 0;
    }
    input.endFrame();
    if (live && lookStick?.active) {
      S.camYaw -= lookStick.x * 2.6 * dt;
      S.camPitch = clamp(S.camPitch + lookStick.y * 1.4 * dt, -0.5, 1.25);
      S.lastLook = t;
    }

    // ---- Player control ----
    S.hurt = Math.max(0, S.hurt - dt);
    S.hitT = Math.max(0, S.hitT - dt);
    const canAim = playing && !S.car && !S.anim && !P.swimming;
    S.aiming = canAim && (mouse.right || (touch && tb.fire)) && combat.weapon.id === 'pistol';
    if (playing && S.anim) {
      stepAnim(dt);
      if (S.car) {
        P.x = S.car.x;
        P.z = S.car.z;
      }
    } else if (playing) {
      if (act) {
        if (S.car) beginExit();
        else {
          const v = nearestVehicle();
          if (v) enterCar(v);
          else {
            const c = nearestTraffic();
            if (c) hijack(c);
          }
        }
      }
      if (S.car) {
        const v = S.car;
        ctlDrive.thr = fwd > 0.3 ? 1 : 0;
        ctlDrive.brk = fwd < -0.3 ? 1 : 0;
        ctlDrive.steer = -right;
        ctlDrive.hand = hand;
        // Pedalling: sprinting on a bike is faster and uses stamina.
        if (v.spec.bike) {
          const pedal = ctlDrive.thr && sprint && !P.tired;
          v.spec.top = pedal ? 10.5 : 7.5;
          if (pedal) P.stamina = Math.max(0, P.stamina - 9 * dt);
          else P.stamina = Math.min(100, P.stamina + 7 * dt);
          if (P.stamina <= 0) P.tired = true;
          if (P.tired && P.stamina > 30) P.tired = false;
          player.pedal(v.wheelRot * 0.55);
          if (v.model.crank) v.model.crank.rotation.x = v.wheelRot * 0.55;
        }
        P.x = v.x;
        P.z = v.z;
        P.y = v.y;
        // Sinking vehicle: get out and swim.
        if (v.drowned && v.sink > 0.15 && !S.anim) {
          shell.toast('Kendaraan tenggelam!', 1400);
          leaveCar(true);
        }
      } else {
        player.update(dt, { fwd, right, sprint: sprint && !S.aiming, walk: walk || S.aiming, jump: jumpHit }, S.camYaw);
        if (S.aiming) P.face += angleDiff(S.camYaw, P.face) * Math.min(1, dt * 20);
        S.regen = Math.max(0, S.regen - dt);
        if (S.regen <= 0 && P.hp < 100) P.hp = Math.min(100, P.hp + 4 * dt);
        // Interact: buy food at a warung, cafe or food cart.
        if (interact) {
          const shop = foodNear();
          if (shop) {
            if (S.money < FOOD_PRICE) shell.toast('Uang tidak cukup', 1200);
            else if (P.hp >= 100) shell.toast('Kamu sudah kenyang', 1200);
            else {
              S.money -= FOOD_PRICE;
              P.hp = Math.min(100, P.hp + 45);
              P.stamina = 100;
              sfx.eat();
              shell.toast('Nyam! +45 darah', 1600);
            }
          }
        }
      }
      // Shooting / punching.
      const fireHeld = (mouse.left || mouse.clickT > 0 || (touch && tb.fire)) && !S.car && !S.anim && !P.swimming;
      mouse.clickT = Math.max(0, mouse.clickT - dt);
      if (fireHeld) {
        camera.getWorldPosition(aimO);
        camera.getWorldDirection(aimD);
        if (touch && !S.aiming) {
          // Touch: aim assist towards the nearest target in front.
          let best = null, bd = 25;
          for (const tg of gatherTargets()) {
            const dxx = tg.x - P.x, dzz = tg.z - P.z;
            const d = Math.hypot(dxx, dzz);
            if (d < bd && (dxx * Math.sin(P.face) + dzz * Math.cos(P.face)) / d > 0.6 && tg.kind !== 'vehicle') { bd = d; best = tg; }
          }
          if (best) {
            aimO.set(P.x, P.y + 1.45, P.z);
            aimD.set(best.x - P.x, best.y + best.h * 0.6 - P.y - 1.45, best.z - P.z).normalize();
          }
        }
        const w = combat.weapon;
        const res = combat.fire(aimO, aimD, w.id === 'pistol' ? gatherTargets() : [], aimO.distanceTo(focus) + 0.6);
        if (res && res.punch) {
          // Fists: knock down whoever is right in front.
          const fx2 = Math.sin(P.face), fz2 = Math.cos(P.face);
          for (const tg of gatherTargets()) {
            const dxx = tg.x - P.x, dzz = tg.z - P.z;
            const d = Math.hypot(dxx, dzz);
            if (d < 1.4 && (dxx * fx2 + dzz * fz2) / (d || 1) > 0.5 && tg.kind !== 'vehicle' && tg.kind !== 'traffic') {
              sfx.thud(0.5);
              if (tg.kind === 'ped') peds.kill(tg.ref, fx2, fz2, false);
              else applyHit({ target: tg, x: tg.x, y: tg.y + 1.3, z: tg.z }, 20, fx2, fz2);
              if (police.nearest(P.x, P.z) < 40) police.add(1, 1);
              break;
            }
          }
          sfx.whoosh();
        } else if (res) {
          if (!S.aiming) P.face = Math.atan2(aimD.x, aimD.z);
          if (res.target) applyHit(res, w.damage, aimD.x, aimD.z);
          // Gunfire is heard: people panic, police get interested.
          peds.scare(P.x, P.z, 45);
          if (police.nearest(P.x, P.z) < 80 || peds.peds.some((p) => p.active && Math.hypot(p.x - P.x, p.z - P.z) < 35)) police.add(0.34, 1);
        }
      }
      combat.update(dt, { aiming: S.aiming, holding: !S.car && !P.swimming, camPitch: S.camPitch - 0.3 });
    } else if (S.mode === 'wasted') {
      player.collapse(dt);
      S.wastedT -= dt;
      if (S.wastedT <= 0) respawn();
      combat.update(dt, { aiming: false, holding: false, camPitch: 0 });
    } else {
      player.update(dt, { fwd: 0, right: 0, sprint: false, walk: false, jump: false }, S.camYaw);
      combat.update(dt, { aiming: false, holding: false, camPitch: 0 });
    }

    // ---- Vehicles ----
    const fx = focus.x;
    const fz = focus.z;
    for (const v of vehicles) {
      const driven = v === S.car;
      // LOD: far vehicles are hidden, only close ones cast shadows.
      const vd = Math.abs(v.x - fx) + Math.abs(v.z - fz);
      v.root.visible = driven || vd < 380;
      const sh = vd < 90;
      if (sh !== v.shadow) {
        v.shadow = sh;
        v.root.traverse((o) => {
          if (o.isMesh) o.castShadow = sh;
        });
      }
      if (v.police && v.police.active && !driven) continue; // driven by the police AI
      if (!driven && v.speed < 0.2 && !v.burning && !v.air && Math.hypot(v.x - fx, v.z - fz) > 170) continue;
      const imp = v.step(dt, driven && !v.wrecked ? ctlDrive : IDLE, world.colliders);
      if (v.splash) {
        v.splash = false;
        sfx.splash(1.2);
      }
      if (imp > 3) {
        if (driven) {
          S.shake = Math.min(0.7, imp * 0.05);
          sfx.thud(Math.min(0.6, imp * 0.04));
        }
        if (imp > 8) damageVehicle(v, (imp - 8) * 1.5);
        if (driven && v.spec.moto && imp > 9) hurtPlayer((imp - 9) * 3);
      }
      // Damage effects: smoke, fire, explosion.
      if (v.health < 40 && !v.wrecked && Math.random() < dt * (v.burning ? 18 : 6)) combat.smokeAt(v.x + Math.sin(v.h) * 1.4, v.y + 1.0, v.z + Math.cos(v.h) * 1.4, v.health < 15, !!v.burning);
      if (v.burning > 0) {
        v.burning -= dt;
        if (v.burning <= 0) explodeVehicle(v);
      }
      if (v.wrecked && Math.random() < dt * 3) combat.smokeAt(v.x, v.y + 1.2, v.z, true, false);
    }
    const crash = collideVehicles(vehicles);
    if (crash > 3 && S.car) {
      S.shake = Math.min(0.7, crash * 0.05);
      sfx.thud(Math.min(0.6, crash * 0.04));
      if (crash > 8) damageVehicle(S.car, (crash - 8) * 1.3);
    }

    traffic.update(dt, t, fx, fz);
    hazards.length = 0;
    for (const v of vehicles) hazards.push(v);
    for (const c of traffic.cars) if (c.legs.length) hazards.push(c);
    for (const tc of traffic.cars) {
      if (!tc.legs.length) continue;
      for (const v of vehicles) {
        if (Math.abs(v.x - tc.x) > 6 || Math.abs(v.z - tc.z) > 6) continue;
        const imp = blockVehicle(v, tc.circles(), tc.r);
        if (imp > 2 && v === S.car) {
          S.shake = Math.min(0.7, imp * 0.05);
          sfx.thud(Math.min(0.6, imp * 0.04));
          if (imp > 8) damageVehicle(v, (imp - 8) * 1.3);
        }
      }
    }

    // Vehicles vs player on foot
    if (playing && !S.car) {
      for (const c of hazards) {
        if (Math.abs(c.x - P.x) > 5 || Math.abs(c.z - P.z) > 5 || Math.abs((c.y || 0) - P.y) > 2.5) continue;
        for (const [cx, cz] of c.circles()) {
          const dx = P.x - cx;
          const dz = P.z - cz;
          const d = Math.hypot(dx, dz);
          const min = c.r + 0.42;
          if (d >= min) continue;
          const nx = d > 1e-4 ? dx / d : 1;
          const nz = d > 1e-4 ? dz / d : 0;
          P.x = cx + nx * min;
          P.z = cz + nz * min;
          if (c.speed > 3) {
            hurtPlayer(Math.min(60, c.speed * 4.5));
            P.x += nx * 0.8;
            P.z += nz * 0.8;
          }
        }
      }
      player.sync();
    }

    const knocked = peds.update(dt, fx, fz, hazards, t);
    if (knocked && police.nearest(P.x, P.z) < 70) police.add(1, 1);
    dangers.length = 0;
    if (!S.car && S.mode !== 'menu') dangers.push({ x: P.x, z: P.z, speed: P.speed });
    for (const v of vehicles) if (v.speed > 2) dangers.push(v);
    animals.update(dt, t, fx, fz, dangers, sky.state.night, S.timeH, hazards);

    // ---- Police ----
    police.update(dt, t, {
      P,
      car: S.car,
      onHurt: (d) => hurtPlayer(d),
      onBusted: () => die('busted'),
      onRam: (imp) => {
        S.shake = Math.min(0.7, imp * 0.05);
        sfx.thud(Math.min(0.6, imp * 0.04));
      },
    });

    // ---- Missions & GPS ----
    if (playing) {
      missions.update(dt, t, {
        px: P.x,
        pz: P.z,
        inCar: !!S.car,
        onDone(reward, bonus) {
          S.money += reward + bonus;
          shell.big('MISI SELESAI', `+${rp(reward + bonus)}`, 'passed', 2600);
          sfx.pickup();
          S.routeT = 0;
          S.saveT = 99;
        },
        onFail() {
          shell.toast('Misi gagal', 1400);
          sfx.hurt();
          S.routeT = 0;
        },
      });
      updateRoute(dt);
    }

    // ---- Sound: engine, music, ambience ----
    if (engineSnd && S.car && playing) {
      const v = S.car;
      const kmh = v.speed * 3.6;
      if (v.drowned || v.wrecked) engineSnd.set(30, 0);
      else if (v.spec.moto) engineSnd.set(95 + kmh * 2.2 + (ctlDrive.thr ? 30 : 0), 0.025 + (ctlDrive.thr ? 0.02 : 0), 900 + (ctlDrive.thr ? 700 : 0));
      else {
        const gear = (kmh % 48) / 48;
        engineSnd.set(52 + gear * 85 + (ctlDrive.thr ? 25 : 0) + Math.min(kmh, 160) * 0.2, 0.03 + (ctlDrive.thr ? 0.03 : 0), 480 + (ctlDrive.thr ? 800 : 0));
      }
    }
    if (S.mode === 'menu' && menuMusic && !music.style) music.play('title');
    const indoor = env.ceilingAt(P.x, P.z, P.y) < Infinity || (!!S.car && !S.car.spec.moto);
    ambience.update(dt, { night: sky.state.night, rain: weather.state.rain, water: env.waterAt(P.x, P.z) > -Infinity, indoor, muted: S.mode === 'menu' });

    // ---- Time of day, weather, lights ----
    const hours = playing ? (dt * 24) / DAY_SECONDS : 0;
    S.timeH = (S.timeH + hours) % 24;
    updateCamera(dt, t);
    weather.update(dt, t, hours, camera.position, sky.state.night, indoor);
    sky.update(S.timeH, focus, camera.position, { cloud: weather.state.cloud, rain: weather.state.rain, flash: weather.state.flash });
    const night = sky.state.night;
    world.update(night, t, dt, focus.x, focus.z, camera.position, { rain: weather.state.rain, wet: weather.state.wet });
    if (S.car && !S.car.spec.bike) for (const { sl } of lights) if (sl.parent) sl.intensity = Math.max(night, weather.state.cloud * 0.4) * 320;

    // ---- Save ----
    if (playing) {
      S.saveT += dt;
      if (S.saveT > 8) {
        S.saveT = 0;
        saveNow();
      }
    }

    // ---- HUD ----
    dmg.style.opacity = S.hurt > 0 || S.mode === 'wasted' ? 1 : P.hp < 30 && playing ? 0.35 : 0;
    cross.hidden = !S.aiming;
    cross.classList.toggle('hit', S.hitT > 0);
    if (live) {
      S.hudT -= dt;
      if (S.hudT <= 0) {
        S.hudT = 0.1;
        const m = missions.state;
        // Top-centre: mission.
        const mission = m.active ? `<div class="chip chip-mission">📍<b style="font-size:14px">${m.name ? m.name + ' · ' : ''}${Math.round(m.dist)} m · ${fmtTime(m.time)}</b></div>` : '';
        if (mission !== hudState) {
          hudState = mission;
          shell.setHud(mission);
        }
        // Top-right: clock + weather, money, weapon, wanted stars.
        const W = combat.W;
        const wpn = WEAPONS[W.slot];
        const stars = Math.floor(police.state.level);
        const ammo = wpn.mag ? (W.reloading > 0 ? '<b class="reload">ISI…</b>' : `<b>${W.mag}</b><em>/ ${W.reserve}</em>`) : '';
        let starsHtml = '';
        for (let i = 0; i < 5; i++) starsHtml += `<span class="${i < stars ? 'on' : ''}">★</span>`;
        const cls = police.state.flash > 0 ? 'flash' : stars && !police.state.seen ? 'evade' : '';
        shell.hudTR.innerHTML = `<div class="clock">${sky.label(S.timeH)}<small>${WEATHER_ICON[weather.state.kind]} ${WEATHER[weather.state.kind].label}</small></div>
          <div class="money">${rp(S.money)}</div>
          ${S.car ? '' : `<div class="weapon">${WEAPON_SVG[wpn.id]}${ammo}</div>`}
          <div class="stars ${cls}">${starsHtml}</div>`;
        // Vitals under the minimap.
        vitals.querySelector('.hp i').style.width = `${P.hp}%`;
        vitals.querySelector('.hp').classList.toggle('low', P.hp < 30);
        vitals.querySelector('.st i').style.width = `${P.stamina}%`;
        vitals.querySelector('.st').classList.toggle('tired', P.tired);
        // Speedometer.
        speedo.hidden = !S.car;
        streetEl.classList.toggle('driving', !!S.car);
        if (S.car) {
          const v = S.car;
          const kmh = Math.round(v.speed * 3.6);
          const k = clamp(kmh / (v.spec.top * 3.6 * 1.05), 0, 1);
          speedo.querySelector('.val').setAttribute('d', k > 0.005 ? arc(A0, A0 + (A1 - A0) * k) : '');
          speedo.querySelector('.val').setAttribute('stroke', v.health < 40 ? '#f97316' : '#4ade80');
          speedo.querySelector('.num b').textContent = kmh;
          speedo.querySelector('.veh').textContent = v.spec.label + (v.health < 40 ? ' · rusak' : '');
        }

        let prompt = '';
        if (playing) {
          const shop = !S.car && foodNear();
          if (S.car) prompt = `<kbd>F</kbd>Turun dari ${S.car.spec.label.toLowerCase()}`;
          else if (nearestVehicle()) prompt = `<kbd>F</kbd>Naik ${nearestVehicle().spec.label.toLowerCase()}`;
          else if (nearestTraffic()) prompt = '<kbd>F</kbd>Ambil kendaraan';
          else if (shop) prompt = `<kbd>E</kbd>Beli makan · <b>${shop.name}</b> · ${rp(FOOD_PRICE)}`;
          else if (P.swimming) prompt = '🏊 Berenang · <kbd>Shift</kbd> lebih cepat';
          else if (built.placeNear) {
            const pl = built.placeNear(P.x, P.z);
            if (pl) prompt = `${SIGN_ICON[pl.group] || '📍'} <b>${pl.name}</b> · ${SIGN_LABEL[pl.group] || 'Tempat'}`;
          }
        }
        if (prompt !== S.prompt) {
          S.prompt = prompt;
          promptEl.innerHTML = prompt;
          promptEl.hidden = !prompt;
        }
      }
      // Street name label.
      S.streetT -= dt;
      if (S.streetT <= 0) {
        S.streetT = 0.5;
        const name = built.streetAt(P.x, P.z);
        if (name && name !== S.street) {
          S.street = name;
          streetEl.innerHTML = `<b>${name}</b><span>${map.areaName}</span>`;
          streetEl.classList.remove('show');
          void streetEl.offsetWidth;
          streetEl.classList.add('show');
        }
      }
      const m = missions.state;
      const markers = [];
      if (m.active) markers.push({ x: m.x, z: m.z, color: '#facc15', r: 6 });
      if (S.waypoint) markers.push({ x: S.waypoint.x, z: S.waypoint.z, color: '#c084fc', r: 6 });
      const blink = Math.floor(t * 4) % 2;
      for (const u of police.units) if (u.active) markers.push({ x: u.v.x, z: u.v.z, color: blink ? '#ef4444' : '#3b82f6', r: 4 });
      for (const o of police.officers) if (!o.down) markers.push({ x: o.x, z: o.z, color: '#60a5fa', r: 3 });
      const driving = S.car;
      S.mapT -= dt;
      if (S.mapT <= 0) {
        S.mapT = 0.05;
        minimap.update(P.x, P.z, S.camYaw, driving ? driving.speed : 0, markers, vehicles, driving ? driving.h : P.face, S.route, S.routeColor);
      }
    }
  };

  // Music starts on the first interaction with the menu (browsers block autoplay).
  const startMusic = () => {
    menuMusic = true;
    window.removeEventListener('pointerdown', startMusic);
    window.removeEventListener('keydown', startMusic);
  };
  window.addEventListener('pointerdown', startMusic);
  window.addEventListener('keydown', startMusic);

  engine.onUpdate(tick);

  // Headless hook for automated simulation checks: open the page with ?debug.
  if (location.search.includes('debug')) window.__city = { S, P, player, beginExit, settings, vehicles, traffic, peds, missions, world, tick, startGame, enterCar, nearestVehicle, nearestTraffic, hijack, openMap, closeMap, fullMap, built, renderer: engine.renderer, scene, camera, sky, engine, combat, police, weather, animals, music, explodeVehicle, damageVehicle, die, shell, gatherTargets };

  engine.start();
  shell.loading(1, 'Siap!');
  await nextFrame();
  shell.ready();

  return {
    dispose() {
      engineSnd?.stop();
      music.stop();
      document.exitPointerLock?.();
      input.dispose();
      minimap.dispose();
      fullMap.dispose();
      shell.dispose();
      Object.assign(env, prevEnv);
      engine.dispose();
    },
  };
}
