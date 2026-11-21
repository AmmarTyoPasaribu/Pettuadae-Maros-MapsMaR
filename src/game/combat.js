import * as THREE from 'three';
import { softDot } from '../core/textures.js';
import { sfx } from '../core/audio.js';
import { env } from './util.js';

// Weapons and their effects: a pistol (12-round magazine) and fists, hitscan shots from the
// crosshair, tracers, muzzle flash, sparks / dust / blood particles, vehicle damage with smoke,
// fire and explosions. NPCs (police) fire through the same code.

export const WEAPONS = [
  { id: 'fist', name: 'Tangan kosong', icon: '✊' },
  { id: 'pistol', name: 'Pistol', icon: '🔫', mag: 12, damage: 34, range: 140, rate: 0.22, reload: 1.15 },
];

// Closest distance between ray (o + d t, t in [t0, t1]) and the vertical segment (x, y0..y1, z).
function rayVsCapsule(o, d, t0, t1, x, y0, y1, z, r) {
  // Solve in 2D for the horizontal distance, then check height at that t.
  const ox = o.x - x, oz = o.z - z;
  const a = d.x * d.x + d.z * d.z;
  let t = a > 1e-8 ? -(ox * d.x + oz * d.z) / a : t0;
  t = Math.max(t0, Math.min(t1, t));
  // Search a little around the closest approach for the first entry into the capsule.
  const hx = ox + d.x * t, hz = oz + d.z * t;
  const h2 = hx * hx + hz * hz;
  if (h2 > r * r) return null;
  const back = Math.sqrt(Math.max(0, r * r - h2) / Math.max(a, 1e-8));
  const te = Math.max(t0, t - back);
  const y = o.y + d.y * te;
  if (y < y0 - r * 0.5 || y > y1 + r * 0.5) {
    const yc = o.y + d.y * t;
    if (yc < y0 - r * 0.5 || yc > y1 + r * 0.5) return null;
    return t;
  }
  return te;
}

export function createCombat({ scene, camera, colliders, hero }) {
  // ---------------- Pistol model in the right hand ----------------
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x1b1c1f, metalness: 0.7, roughness: 0.35 });
  const gun = new THREE.Group();
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.045, 0.2), gunMat);
  slide.position.set(0, 0.02, 0.07);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.11, 0.045), gunMat);
  grip.position.set(0, -0.035, -0.0);
  grip.rotation.x = -0.25;
  gun.add(slide, grip);
  gun.position.set(0, -0.36, 0.05);
  gun.rotation.x = Math.PI / 2; // barrel along the forearm, towards the hand
  gun.visible = false;
  hero.rArm.lower.add(gun);

  // ---------------- Muzzle flash, light, tracers ----------------
  const dot = softDot(128);
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: 0xffd27a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  flash.scale.setScalar(0.5);
  flash.visible = false;
  scene.add(flash);
  // One shared light for muzzle flashes and explosions (added once: the light count never changes).
  const flashLight = new THREE.PointLight(0xffc070, 0, 14, 2);
  flashLight.userData.dynamic = true;
  scene.add(flashLight);
  let flashT = 0;
  let boomLight = 0;

  const tracers = [];
  const tracerMat = new THREE.LineBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  for (let i = 0; i < 10; i++) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const l = new THREE.Line(g, tracerMat);
    l.frustumCulled = false;
    l.visible = false;
    scene.add(l);
    tracers.push({ l, t: 0 });
  }
  let tracerI = 0;
  function tracer(a, b) {
    const tr = tracers[tracerI++ % tracers.length];
    const p = tr.l.geometry.attributes.position;
    p.setXYZ(0, a.x, a.y, a.z);
    p.setXYZ(1, b.x, b.y, b.z);
    p.needsUpdate = true;
    tr.l.visible = true;
    tr.t = 0.06;
  }

  // ---------------- Particles: sparks, dust, blood (small) and smoke / fire (large) ----------------
  function pool(n, size, additive) {
    const pos = new Float32Array(n * 3).fill(-1e4);
    const col = new Float32Array(n * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({ size, map: dot, vertexColors: true, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, opacity: additive ? 1 : 0.75 });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    scene.add(pts);
    const P = Array.from({ length: n }, () => ({ life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, g: 0, r: 1, gg: 1, b: 1, fade: 1, grow: 0 }));
    let i = 0;
    return {
      emit(x, y, z, vx, vy, vz, life, [r, gg, b], g = 9, grow = 0) {
        const p = P[i++ % n];
        Object.assign(p, { x, y, z, vx, vy, vz, life, max: life, r, gg, b, g, grow });
      },
      update(dt) {
        for (let k = 0; k < n; k++) {
          const p = P[k];
          if (p.life <= 0) {
            if (pos[k * 3 + 1] > -1e3) pos[k * 3 + 1] = -1e4;
            continue;
          }
          p.life -= dt;
          p.vy -= p.g * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.z += p.vz * dt;
          const f = Math.max(0, p.life / p.max);
          pos.set([p.x, p.y, p.z], k * 3);
          col.set([p.r * f, p.gg * f, p.b * f], k * 3);
        }
        g.attributes.position.needsUpdate = true;
        g.attributes.color.needsUpdate = true;
      },
    };
  }
  const bits = pool(400, 0.16, true);
  const blood = pool(200, 0.13, false);
  const smoke = pool(260, 2.6, false);
  const fire = pool(160, 2.2, true);

  function sparks(x, y, z, n = 8, color = [1, 0.8, 0.4]) {
    for (let k = 0; k < n; k++) bits.emit(x, y, z, (Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.5) * 6, 0.25 + Math.random() * 0.3, color, 12);
  }
  function dust(x, y, z, n = 6) {
    for (let k = 0; k < n; k++) smoke.emit(x, y, z, (Math.random() - 0.5) * 1.2, 0.6 + Math.random(), (Math.random() - 0.5) * 1.2, 0.6, [0.55, 0.5, 0.42], -0.3);
  }
  function bleed(x, y, z, n = 14) {
    for (let k = 0; k < n; k++) blood.emit(x, y, z, (Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3, 0.5 + Math.random() * 0.4, [0.55, 0.02, 0.02], 9);
  }

  // ---------------- Explosions ----------------
  const explosions = [];
  function explode(x, y, z) {
    for (let k = 0; k < 40; k++) fire.emit(x + (Math.random() - 0.5) * 2, y + 0.5 + Math.random() * 1.5, z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 8, 2 + Math.random() * 6, (Math.random() - 0.5) * 8, 0.6 + Math.random() * 0.6, [1, 0.55 + Math.random() * 0.3, 0.15], 2);
    for (let k = 0; k < 40; k++) smoke.emit(x + (Math.random() - 0.5) * 3, y + 1 + Math.random() * 2, z + (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, 1.5 + Math.random() * 3, (Math.random() - 0.5) * 3, 2.5 + Math.random() * 2, [0.16, 0.15, 0.14], -0.5);
    sparks(x, y + 1, z, 40, [1, 0.7, 0.3]);
    flashLight.position.set(x, y + 2, z);
    boomLight = 1;
    explosions.push({ x, y, z });
  }

  // ---------------- Weapon state ----------------
  const W = { slot: 1, mag: 12, reserve: 60, cooldown: 0, reloading: 0, aiming: false, punchT: 0, recoil: 0 };
  const ray = { o: new THREE.Vector3(), d: new THREE.Vector3() };
  const tmp = new THREE.Vector3();
  const muzzle = new THREE.Vector3();

  // Where a shot from the crosshair lands. targets: [{ x, y, z, r, h, ref }]. Returns hit info.
  function trace(o, d, maxT, targets, skipT = 0) {
    let best = null;
    for (const tg of targets) {
      const t = rayVsCapsule(o, d, skipT, maxT, tg.x, tg.y + tg.r * 0.5, tg.y + tg.h - tg.r * 0.5, tg.z, tg.r);
      if (t !== null && (!best || t < best.t)) best = { t, target: tg };
    }
    // March through the world for buildings, walls and terrain.
    const lim = best ? best.t : maxT;
    for (let t = skipT; t < lim; t += 0.6) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      const g = env.groundHeight(x, z, y);
      if (y < g || colliders.inside(x, z, y)) {
        best = { t: Math.max(skipT, t - 0.3), target: null, ground: y < g };
        break;
      }
    }
    if (!best) best = { t: maxT, target: null, miss: true };
    best.x = o.x + d.x * best.t;
    best.y = o.y + d.y * best.t;
    best.z = o.z + d.z * best.t;
    return best;
  }

  return {
    W,
    gun,
    explosions,
    tracer,
    sparks,
    bleed,
    dust,
    explode,
    smokeAt(x, y, z, heavy = false, burning = false) {
      smoke.emit(x + (Math.random() - 0.5) * 0.6, y, z + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.5, 1.2 + Math.random(), (Math.random() - 0.5) * 0.5, heavy ? 2.4 : 1.6, heavy ? [0.12, 0.12, 0.12] : [0.45, 0.45, 0.45], -0.4);
      if (burning) fire.emit(x + (Math.random() - 0.5) * 0.8, y - 0.2, z + (Math.random() - 0.5) * 0.8, 0, 1.5 + Math.random(), 0, 0.45, [1, 0.5, 0.12], -1);
    },
    get weapon() {
      return WEAPONS[W.slot];
    },
    select(slot) {
      if (slot === W.slot || !WEAPONS[slot]) return false;
      W.slot = slot;
      W.reloading = 0;
      return true;
    },
    reload() {
      const w = WEAPONS[W.slot];
      if (!w.mag || W.reloading > 0 || W.mag >= w.mag || W.reserve <= 0) return false;
      W.reloading = w.reload;
      sfx.reload();
      return true;
    },
    // Fire the current weapon. aimO/aimD: crosshair ray. Returns hit info (or null).
    fire(aimO, aimD, targets, skipT) {
      const w = WEAPONS[W.slot];
      if (W.cooldown > 0 || W.reloading > 0) return null;
      if (w.id === 'fist') {
        W.cooldown = 0.45;
        W.punchT = 0.3;
        return { punch: true };
      }
      if (W.mag <= 0) {
        sfx.empty();
        W.cooldown = 0.25;
        if (W.reserve > 0) this.reload();
        return null;
      }
      W.mag--;
      W.cooldown = w.rate;
      W.recoil = 1;
      gun.getWorldPosition(muzzle);
      muzzle.addScaledVector(aimD, 0.25);
      const hit = trace(aimO, aimD, w.range, targets, skipT);
      tracer(muzzle, hit);
      flash.position.copy(muzzle);
      flash.material.rotation = Math.random() * 6;
      flash.visible = true;
      flashLight.position.copy(muzzle);
      flashT = 0.05;
      sfx.shoot();
      sfx.casing();
      if (!hit.target && !hit.miss) {
        if (hit.ground) dust(hit.x, hit.y, hit.z, 4);
        sparks(hit.x, hit.y, hit.z, 6);
        sfx.impact(0.6);
        if (Math.random() < 0.3) sfx.ricochet(0.6);
      }
      if (W.mag === 0 && W.reserve > 0) setTimeout(() => this.reload(), 250);
      return hit;
    },
    // An NPC shot from `from` towards `to` (with spread); the caller decides damage.
    npcShot(from, to, hits) {
      tmp.set(to.x - from.x, to.y - from.y, to.z - from.z);
      const d = tmp.length();
      tmp.normalize();
      const miss = hits ? 0 : 0.6 + Math.random() * 1.2;
      const end = { x: to.x + (Math.random() - 0.5) * miss * 2, y: to.y + (Math.random() - 0.3) * miss, z: to.z + (Math.random() - 0.5) * miss * 2 };
      tracer(from, end);
      flash.position.set(from.x, from.y, from.z);
      flash.visible = true;
      flashLight.position.copy(flash.position);
      flashT = 0.05;
      const cam = camera.position;
      const dd = Math.hypot(cam.x - from.x, cam.z - from.z);
      sfx.shoot(Math.max(0.15, 1 - dd / 120));
      if (!hits) {
        sparks(end.x, end.y, end.z, 4);
        if (Math.random() < 0.4) sfx.ricochet(Math.max(0.2, 1 - dd / 60));
      }
      void d;
    },
    trace,
    ray,
    update(dt, { aiming, holding, camPitch }) {
      W.cooldown = Math.max(0, W.cooldown - dt);
      W.recoil = Math.max(0, W.recoil - dt * 8);
      if (W.reloading > 0) {
        W.reloading -= dt;
        if (W.reloading <= 0) {
          const w = WEAPONS[W.slot];
          const need = w.mag - W.mag;
          const take = Math.min(need, W.reserve);
          W.mag += take;
          W.reserve -= take;
        }
      }
      W.aiming = aiming;
      gun.visible = holding && WEAPONS[W.slot].id === 'pistol';
      // Arm poses: aiming raises the right arm towards the crosshair; punches jab forward.
      if (holding) {
        if (aiming && WEAPONS[W.slot].id === 'pistol') {
          const up = -Math.PI / 2 - camPitch * 0.9 + W.recoil * 0.25 - (W.reloading > 0 ? -0.9 : 0);
          hero.rArm.pivot.rotation.set(up, 0, 0.08);
          hero.rArm.lower.rotation.x = 0;
          hero.lArm.pivot.rotation.set(up + 0.1, 0, -0.45);
          hero.lArm.lower.rotation.x = -0.35;
        } else if (W.punchT > 0) {
          W.punchT -= dt;
          const k = Math.sin((1 - W.punchT / 0.3) * Math.PI);
          hero.rArm.pivot.rotation.set(-0.4 - k * 1.2, 0, 0.1);
          hero.rArm.lower.rotation.x = -1.4 + k * 1.3;
        } else if (W.reloading > 0) {
          hero.rArm.pivot.rotation.x = -0.9;
          hero.rArm.lower.rotation.x = -0.6;
          hero.lArm.pivot.rotation.x = -1.0;
          hero.lArm.lower.rotation.x = -0.9;
        }
      }
      flashT -= dt;
      flash.visible = flashT > 0;
      boomLight = Math.max(0, boomLight - dt * 1.6);
      flashLight.intensity = flashT > 0 ? 60 : boomLight * 900;
      flashLight.distance = boomLight > 0 ? 60 : 14;
      for (const tr of tracers) {
        if (tr.t > 0) {
          tr.t -= dt;
          if (tr.t <= 0) tr.l.visible = false;
        }
      }
      bits.update(dt);
      blood.update(dt);
      smoke.update(dt);
      fire.update(dt);
      explosions.length = 0;
    },
  };
}
