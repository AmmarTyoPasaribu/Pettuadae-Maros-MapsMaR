import * as THREE from 'three';
import { createEngine } from '../core/engine.js';
import { createInput, isTouch } from '../core/input.js';
import { createShell } from '../core/ui.js';
import { sfx, loopTone, tone } from '../core/audio.js';
import { env, clamp, angleDiff, mulberry32 } from './util.js';
import { createSky } from './sky.js';
import { Vehicle, collideVehicles, blockVehicle } from './vehicles.js';
import { createPlayer } from './player.js';
import { createMissions } from './missions.js';
import { loadSave, writeSave, clearSave, loadSettings, writeSettings } from './save.js';

const DAY_SECONDS = 1440; // one in-game day = 24 real minutes
const IDLE = { thr: 0, brk: 0, steer: 0, hand: false };
const MAX_VEHICLES = 44;
const QUALITY = {
  otomatis: { label: 'Otomatis', pr: 'auto', shadow: 2048, shadows: true },
  tinggi: { label: 'Tinggi', pr: 2, shadow: 2048, shadows: true },
  sedang: { label: 'Sedang', pr: 1, shadow: 1024, shadows: true },
  rendah: { label: 'Rendah', pr: 0.75, shadow: 1024, shadows: false },
};
const QUALITY_ORDER = ['otomatis', 'tinggi', 'sedang', 'rendah'];

// Flat strip along a polyline for the in-world GPS line.
function routeRibbon(pts, width, y) {
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
    pos.set([pts[i][0] + tz * width, y, pts[i][1] - tx * width, pts[i][0] - tz * width, y, pts[i][1] + tx * width], i * 6);
    if (i < n - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

// Shared open-world game loop: camera, on-foot and vehicle control, carjacking, damage,
// missions, GPS routing, HUD, saving. The `map` supplies the world and its AI.
export function startOpenWorld(container, map) {
  const touch = isTouch();
  const settings = loadSettings({ quality: 'otomatis' });
  if (!QUALITY[settings.quality]) settings.quality = 'otomatis';
  const save = loadSave();

  const engine = createEngine(container, { fov: 65, near: 0.3, far: 2600, exposure: 0.9 });
  const { scene, camera, renderer } = engine;
  const rnd = mulberry32(4242);

  const prevEnv = { ...env };
  Object.assign(env, map.env);
  const sky = createSky(engine);

  // ---------------- Entities ----------------
  const playerObs = { x: 0, z: 0, r: 0.4 };
  const obsBuf = [];
  let vehicles = [];
  const built = map.create({
    scene,
    camera,
    rnd,
    getObstacles() {
      obsBuf.length = 0;
      for (const v of vehicles) obsBuf.push(v);
      if (!S.car) {
        playerObs.x = P.x;
        playerObs.z = P.z;
        obsBuf.push(playerObs);
      }
      return obsBuf;
    },
  });
  const { world, traffic, peds } = built;
  vehicles = built.vehicles;
  const SPAWN = map.spawn;
  const player = createPlayer(scene, world.colliders);
  const P = player.P;
  player.place(SPAWN.x, SPAWN.z, SPAWN.face);
  const missions = createMissions(scene, rnd, built.pickDestination);
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

  // GPS line on the road.
  const routeMat = new THREE.MeshBasicMaterial({ color: 0xc084fc, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide });
  attachLights(null);
  const routeMesh = new THREE.Mesh(new THREE.BufferGeometry(), routeMat);
  routeMesh.renderOrder = 3;
  routeMesh.frustumCulled = false;
  scene.add(routeMesh);

  // ---------------- State ----------------
  const S = {
    mode: 'menu', t: 0, timeH: 16, money: 0, car: null, camYaw: SPAWN.cam, camPitch: 0.3, lastLook: -10, hurt: 0, regen: 0, wastedT: 0, shake: 0, hudT: 0, prompt: '',
    waypoint: null, route: null, routeColor: '#c084fc', routeT: 0, street: '', streetT: 0, saveT: 0, mapOpen: false,
    anim: null, frame: 0, mapT: 0, fpsT: 0, fpsN: 0, lastNow: 0,
  };
  let engineSnd = null;

  // ---------------- Graphics quality ----------------
  // 'Otomatis' starts at a moderate resolution and adapts it to the measured frame rate.
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
  applyQuality();
  // The sun's shadow map is re-rendered every other frame instead of every frame.
  renderer.shadowMap.autoUpdate = false;

  // ---------------- Input ----------------
  const input = createInput(container);
  const canvas = renderer.domElement;
  let moveStick = null;
  let lookStick = null;
  const tb = { act: false, jump: false, run: false };
  let actionPressed = false;

  const lock = () => {
    if (touch) return;
    try {
      const r = canvas.requestPointerLock?.();
      r?.catch?.(() => {});
    } catch {
      /* pointer lock unavailable */
    }
  };

  const shell = createShell(container, {
    title: map.title,
    subtitle: map.subtitle,
    accent: map.accent,
    credits: map.credits,
    hasSave: !!save,
    controls: touch
      ? [['Joystick kiri', 'Jalan / gas & belok'], ['Joystick kanan', 'Putar kamera'], ['AKSI', 'Naik / turun kendaraan'], ['PETA', 'Buka peta & GPS']]
      : [
          ['W A S D', 'Jalan · gas, rem, belok'],
          ['Shift', 'Sprint (pakai stamina)'],
          ['Alt', 'Jalan pelan'],
          ['Space', 'Lompat · rem tangan'],
          ['F', 'Naik/turun · ambil kendaraan'],
          ['M', 'Peta, klik untuk waypoint GPS'],
          ['Mouse · Q E', 'Kamera (klik untuk kunci)'],
          ['H · T', 'Klakson · percepat waktu'],
        ],
    pauseItems: [
      { id: 'map', label: 'Buka Peta (M)', onClick: () => { shell.setPaused(false); openMap(); } },
      { id: 'quality', label: `Grafik: ${QUALITY[settings.quality].label}`, onClick: cycleQuality },
      { id: 'reset', label: 'Hapus progres & mulai baru', onClick: () => { clearSave(); location.reload(); } },
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

  function cycleQuality() {
    const i = QUALITY_ORDER.indexOf(settings.quality);
    settings.quality = QUALITY_ORDER[(i + 1) % QUALITY_ORDER.length];
    writeSettings(settings);
    applyQuality();
    shell.setPauseLabel('quality', `Grafik: ${QUALITY[settings.quality].label}`);
  }

  const minimap = built.createMinimap(shell.root);
  minimap.wrap.hidden = true;
  const fullMap = built.createFullMap(shell.root, {
    onWaypoint(w) {
      S.waypoint = w;
      S.routeT = 0;
      if (!w) clearRoute();
      tone(w ? 880 : 440, 0.08, { type: 'triangle', vol: 0.15 });
    },
    onClose: () => closeMap(),
  });
  const promptEl = document.createElement('div');
  promptEl.className = 'prompt';
  promptEl.hidden = true;
  const streetEl = document.createElement('div');
  streetEl.className = 'street-name';
  const dmg = document.createElement('div');
  dmg.className = 'damage';
  shell.root.append(promptEl, streetEl, dmg);

  if (touch) {
    moveStick = input.joystick(shell.root, 'left');
    lookStick = input.joystick(shell.root, 'right');
    for (const [k, label, right, bottom] of [['act', 'AKSI', 30, 170], ['jump', 'LOMPAT', 120, 150], ['run', 'LARI', 30, 260], ['map', 'PETA', 120, 240]]) {
      const b = document.createElement('button');
      b.className = 'touch-btn';
      b.textContent = label;
      b.style.right = right + 'px';
      b.style.bottom = bottom + 'px';
      input.on(b, 'touchstart', (e) => {
        e.preventDefault();
        if (k === 'map') return S.mapOpen ? closeMap() : openMap();
        tb[k] = true;
        if (k === 'act') actionPressed = true;
      }, { passive: false });
      input.on(b, 'touchend', () => (tb[k] = false));
      shell.root.appendChild(b);
    }
  }

  let dragging = false;
  input.on(canvas, 'pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || S.mode === 'menu' || shell.paused || S.mapOpen) return;
    dragging = true;
    lock();
  });
  input.on(window, 'pointerup', () => (dragging = false));
  input.on(window, 'pointermove', (e) => {
    if (S.mode === 'menu' || shell.paused || S.mapOpen || e.pointerType === 'touch') return;
    if (!(document.pointerLockElement === canvas || dragging)) return;
    S.camYaw -= e.movementX * 0.0026;
    S.camPitch = clamp(S.camPitch + e.movementY * 0.0022, -0.12, 1.25);
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
    routeMesh.geometry = near.length > 1 ? routeRibbon(near, 0.35, 0.07) : new THREE.BufferGeometry();
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
      S.money = save.money || 0;
      S.timeH = save.timeH ?? 16;
      player.place(save.x ?? SPAWN.x, save.z ?? SPAWN.z, SPAWN.face);
      shell.toast('Progres dimuat', 1400);
    } else {
      S.money = 0;
      S.timeH = 16;
      player.place(SPAWN.x, SPAWN.z, SPAWN.face);
    }
    S.camYaw = SPAWN.cam;
    missions.reset();
    minimap.wrap.hidden = false;
    lock();
  }

  function nearestVehicle() {
    let best = null;
    let bd = 3.6;
    for (const v of vehicles) {
      const d = Math.hypot(v.x - P.x, v.z - P.z) - (v.spec.moto ? 0.6 : 0);
      if (d < bd) { bd = d; best = v; }
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

  // Walk to the driver door, open it, get in, close it (scooters: walk up and swing on).
  function enterCar(v) {
    if (S.anim) return;
    ctlDrive.thr = ctlDrive.brk = ctlDrive.steer = 0;
    ctlDrive.hand = false;
    S.anim = { kind: 'enter', v, t: 0, fx: P.x, fz: P.z };
  }

  function finishEnter(v) {
    S.car = v;
    v.driver = true;
    if (v.spec.moto) player.mount(v.model.body);
    else player.root.visible = false;
    attachLights(v);
    engineSnd?.stop();
    engineSnd = v.spec.moto ? loopTone({ type: 'square', freq: 90, vol: 0.03, filter: 900 }) : loopTone({ type: 'sawtooth', freq: 50, vol: 0.04, filter: 600 });
    tone(220, 0.08, { type: 'square', vol: 0.12 });
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
    trimVehicles();
  }

  // Keep the number of loose vehicles bounded: drop far, unused ones.
  function trimVehicles() {
    while (vehicles.length > MAX_VEHICLES) {
      let far = null;
      let fd = 0;
      for (const v of vehicles) {
        if (v === S.car) continue;
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
    if (v.speed > 3) {
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
        S.anim = null;
      }
      if (!A.done) player.sync();
    } else {
      if (v.spec.moto) {
        leaveCar();
        S.anim = null;
        return;
      }
      if (A.t < 0.3) v.setDoor(A.t / 0.3);
      else if (!A.out) {
        A.out = true;
        leaveCar(false, v.doorPoint());
      } else if (A.t < 0.95) v.setDoor(Math.min(1, Math.max(0, 1 - (A.t - 0.6) / 0.35)));
      else {
        v.setDoor(0);
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
      player.probe.y = 1;
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
    if (v.spec.moto) player.dismount();
    player.root.visible = true;
    player.place(ex, ez, v.h);
    if (!silent) tone(180, 0.08, { type: 'square', vol: 0.1 });
  }

  function hurtPlayer(amount) {
    if (S.hurt > 0 || S.mode !== 'play') return;
    P.hp -= amount;
    S.hurt = 0.7;
    S.regen = 6;
    S.shake = 0.5;
    sfx.hurt();
    if (P.hp <= 0) {
      P.hp = 0;
      S.mode = 'wasted';
      S.wastedT = 3.4;
      const loss = Math.min(S.money, Math.max(50, Math.round(S.money * 0.1)));
      S.money -= loss;
      shell.toast('WASTED', 2600);
      sfx.lose();
    }
  }

  function respawn() {
    S.mode = 'play';
    P.hp = 100;
    P.stamina = 100;
    player.place(SPAWN.x, SPAWN.z, SPAWN.face);
    S.camYaw = SPAWN.cam;
    missions.reset();
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
      focus.set(P.x, 0, P.z);
      return;
    }
    const v = S.car;
    if (v) {
      camTarget.set(v.x, v.y + (v.spec.moto ? 1.55 : 1.35), v.z);
      dist = v.spec.cam + Math.min(4.5, v.speed * 0.09);
      if (t - S.lastLook > 1.2 && v.speed > 2.5) {
        const follow = v.vF >= -0.5 ? v.h : v.h + Math.PI;
        S.camYaw += angleDiff(follow, S.camYaw) * Math.min(1, dt * 2.2);
        S.camPitch += (0.22 - S.camPitch) * Math.min(1, dt * 1.2);
      }
    } else {
      camTarget.set(P.x - Math.cos(S.camYaw) * 0.55, P.y + 1.55, P.z + Math.sin(S.camYaw) * 0.55);
      // Indoors the camera stays closer.
      dist = env.ceilingAt(P.x, P.z, P.y) < Infinity ? 2.6 : 4.1;
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
    desired.set(camTarget.x + dx * d, Math.max(0.5, camTarget.y + dy * d), camTarget.z + dz * d);
    const ceil = env.ceilingAt(desired.x, desired.z, P.y);
    if (desired.y > ceil - 0.25) desired.y = ceil - 0.25;
    camera.position.lerp(desired, Math.min(1, dt * (d < dist ? 30 : 12)));
    if (S.shake > 0) {
      S.shake = Math.max(0, S.shake - dt * 1.6);
      camera.position.x += (Math.random() - 0.5) * S.shake;
      camera.position.y += (Math.random() - 0.5) * S.shake;
    }
    camera.lookAt(camTarget);
    const fov = 65 + (v ? Math.min(18, v.speed * 0.45) : P.sprinting ? 5 : 0);
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 3);
    camera.updateProjectionMatrix();
    focus.copy(camTarget);
  }

  // ---------------- Main loop ----------------
  const fmtTime = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
  const ctlDrive = { thr: 0, brk: 0, steer: 0, hand: false };

  const SIGN_ICON = { food: '🍴', cafe: '☕', shop: '🛍️', bank: '🏦', health: '🏥', service: '🔧', lodging: '🏨', edu: '🏫', gov: '🏛️', worship: '🕌', other: '📍' };
  const SIGN_LABEL = { food: 'Rumah makan', cafe: 'Kafe / warkop', shop: 'Toko', bank: 'Bank', health: 'Kesehatan', service: 'Jasa', lodging: 'Penginapan', edu: 'Pendidikan', gov: 'Instansi', worship: 'Tempat ibadah', other: 'Tempat' };

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
    if (S.fpsT > 2000) {
      const fps = (1000 * S.fpsN) / S.fpsT;
      S.fps = fps;
      S.fpsT = S.fpsN = 0;
      if (settings.quality === 'otomatis') {
        const next = fps < 45 ? Math.max(0.6, autoPR * 0.85) : fps > 58 ? Math.min(maxPR, autoPR * 1.1) : autoPR;
        if (Math.abs(next - autoPR) > 0.02) {
          autoPR = next;
          applyQuality();
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
    const act = input.hit('KeyF') || actionPressed;
    actionPressed = false;
    if (input.hit('KeyT')) S.timeH += 1;
    if (input.hit('KeyH') && S.car) {
      if (S.car.spec.moto) { tone(620, 0.09, { type: 'square', vol: 0.12 }); tone(620, 0.09, { type: 'square', vol: 0.12, delay: 0.14 }); }
      else tone(340, 0.28, { type: 'square', vol: 0.14 });
    }
    input.endFrame();
    if (live) {
      const turn = (input.down('KeyE') ? 1 : 0) - (input.down('KeyQ') ? 1 : 0);
      if (turn) { S.camYaw -= turn * 1.9 * dt; S.lastLook = t; }
      if (lookStick?.active) {
        S.camYaw -= lookStick.x * 2.6 * dt;
        S.camPitch = clamp(S.camPitch + lookStick.y * 1.4 * dt, -0.12, 1.25);
        S.lastLook = t;
      }
    }

    // ---- Player control ----
    S.hurt = Math.max(0, S.hurt - dt);
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
        ctlDrive.thr = fwd > 0.3 ? 1 : 0;
        ctlDrive.brk = fwd < -0.3 ? 1 : 0;
        ctlDrive.steer = -right;
        ctlDrive.hand = hand;
        P.x = S.car.x;
        P.z = S.car.z;
      } else {
        player.update(dt, { fwd, right, sprint, walk, jump: jumpHit }, S.camYaw);
        S.regen = Math.max(0, S.regen - dt);
        if (S.regen <= 0 && P.hp < 100) P.hp = Math.min(100, P.hp + 6 * dt);
      }
    } else if (S.mode === 'wasted') {
      player.collapse(dt);
      S.wastedT -= dt;
      if (S.wastedT <= 0) respawn();
    } else {
      player.update(dt, { fwd: 0, right: 0, sprint: false, walk: false, jump: false }, S.camYaw);
    }

    // ---- Vehicles ----
    const fx = focus.x;
    const fz = focus.z;
    for (const v of vehicles) {
      const driven = v === S.car;
      if (!driven && v.speed < 0.2 && Math.hypot(v.x - fx, v.z - fz) > 170) continue;
      const imp = v.step(dt, driven ? ctlDrive : IDLE, world.colliders);
      if (driven && imp > 3) {
        S.shake = Math.min(0.7, imp * 0.05);
        sfx.thud(Math.min(0.6, imp * 0.04));
      }
    }
    const crash = collideVehicles(vehicles);
    if (crash > 3 && S.car) { S.shake = Math.min(0.7, crash * 0.05); sfx.thud(Math.min(0.6, crash * 0.04)); }

    traffic.update(dt, t, fx, fz);
    hazards.length = 0;
    for (const v of vehicles) hazards.push(v);
    for (const c of traffic.cars) if (c.legs.length) hazards.push(c);
    for (const tc of traffic.cars) {
      if (!tc.legs.length) continue;
      for (const v of vehicles) {
        if (Math.abs(v.x - tc.x) > 6 || Math.abs(v.z - tc.z) > 6) continue;
        const imp = blockVehicle(v, tc.circles(), tc.r);
        if (imp > 2 && v === S.car) { S.shake = Math.min(0.7, imp * 0.05); sfx.thud(Math.min(0.6, imp * 0.04)); }
      }
    }

    // Vehicles vs player on foot
    if (playing && !S.car) {
      for (const c of hazards) {
        if (Math.abs(c.x - P.x) > 5 || Math.abs(c.z - P.z) > 5) continue;
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

    peds.update(dt, fx, fz, hazards);

    // ---- Missions & GPS ----
    if (playing) {
      missions.update(dt, t, {
        px: P.x,
        pz: P.z,
        inCar: !!S.car,
        onDone(reward, bonus) {
          S.money += reward + bonus;
          shell.toast(`+Rp${((reward + bonus) * 1000).toLocaleString('id-ID')}`, 1600);
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

    // ---- Engine sound ----
    if (engineSnd && S.car && playing) {
      const v = S.car;
      const kmh = v.speed * 3.6;
      if (v.spec.moto) engineSnd.set(95 + kmh * 2.2 + (ctlDrive.thr ? 30 : 0), 0.025 + (ctlDrive.thr ? 0.02 : 0), 900 + (ctlDrive.thr ? 700 : 0));
      else {
        const gear = (kmh % 48) / 48;
        engineSnd.set(52 + gear * 85 + (ctlDrive.thr ? 25 : 0) + Math.min(kmh, 160) * 0.2, 0.03 + (ctlDrive.thr ? 0.03 : 0), 480 + (ctlDrive.thr ? 800 : 0));
      }
    }

    // ---- Time of day, lights ----
    S.timeH = (S.timeH + (dt * 24) / DAY_SECONDS) % 24;
    updateCamera(dt, t);
    sky.update(S.timeH, focus, camera.position);
    const night = sky.state.night;
    world.update(night, t, dt, focus.x, focus.z);
    if (S.car) for (const { sl } of lights) if (sl.parent) sl.intensity = night * 320;

    // ---- Save ----
    if (playing) {
      S.saveT += dt;
      if (S.saveT > 8) {
        S.saveT = 0;
        writeSave({ money: S.money, timeH: S.timeH, x: P.x, z: P.z });
      }
    }

    // ---- HUD ----
    dmg.style.opacity = S.hurt > 0 || S.mode === 'wasted' ? 1 : P.hp < 30 && playing ? 0.35 : 0;
    if (live) {
      S.hudT -= dt;
      if (S.hudT <= 0) {
        S.hudT = 0.1;
        const m = missions.state;
        let html = `<div class="chip">Rp<b>${(S.money * 1000).toLocaleString('id-ID')}</b></div><div class="chip">🕒<b style="font-size:15px">${sky.label(S.timeH)}</b></div>`;
        if (m.active) html += `<div class="chip chip-mission">📍<b style="font-size:14px">${m.name ? m.name + ' · ' : ''}${Math.round(m.dist)} m · ${fmtTime(m.time)}</b></div>`;
        if (S.car) html += `<div class="chip">${Math.round(S.car.speed * 3.6)}<b style="font-size:13px">km/j</b></div>`;
        else {
          html += `<div class="chip">HP<span class="bar"><i style="width:${P.hp}%"></i></span></div>`;
          html += `<div class="chip">Stamina<span class="bar bar-stamina${P.tired ? ' tired' : ''}"><i style="width:${P.stamina}%"></i></span></div>`;
        }
        shell.setHud(html);

        let prompt = '';
        if (playing) {
          if (S.car) prompt = `<kbd>F</kbd>Turun dari ${S.car.spec.label.toLowerCase()}`;
          else if (nearestVehicle()) prompt = `<kbd>F</kbd>Naik ${nearestVehicle().spec.label.toLowerCase()}`;
          else if (nearestTraffic()) prompt = '<kbd>F</kbd>Ambil kendaraan';
          else if (built.placeNear) {
            const pl = built.placeNear(P.x, P.z);
            if (pl) prompt = `${SIGN_ICON[pl.group] || '📍'} <b>${pl.name}</b> · ${SIGN_LABEL[pl.group] || 'Tempat'}`;
          }
          else if (!m.active && !S.waypoint && t < 60) prompt = '<kbd>M</kbd>Buka peta untuk pasang tujuan GPS';
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
      const driving = S.car;
      S.mapT -= dt;
      if (S.mapT <= 0) {
        S.mapT = 0.05;
        minimap.update(P.x, P.z, S.camYaw, driving ? driving.speed : 0, markers, vehicles, driving ? driving.h : P.face, S.route, S.routeColor);
      }
    }
  };
  engine.onUpdate(tick);

  // Headless hook for automated simulation checks: open the page with ?debug.
  if (location.search.includes('debug')) window.__city = { S, P, player, beginExit, settings, vehicles, traffic, peds, missions, world, tick, startGame, enterCar, nearestVehicle, nearestTraffic, hijack, openMap, closeMap, fullMap, built, renderer: engine.renderer };

  engine.start();

  return {
    dispose() {
      engineSnd?.stop();
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
