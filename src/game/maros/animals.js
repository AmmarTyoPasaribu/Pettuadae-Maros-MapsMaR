import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { sfx } from '../../core/audio.js';
import { pointInPoly } from '../colliders.js';
import { elev } from './elevation.js';

// Village animals around Pettuadae: free-roaming chickens in the yards, cats near houses and
// warung, goats along the lanes, Bali cattle (sapi Bali) in the fields, ducks on the river and
// the pond, and flocks of birds circling overhead. Each species is drawn with a few instanced
// meshes (body + legs), so a hundred animals cost a handful of draw calls.

const tmpC = new THREE.Color();
const paint = (g, color) => {
  tmpC.set(color);
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set([tmpC.r, tmpC.g, tmpC.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
};
const merge = (l) => mergeGeometries(l.map((g) => (g.index ? g.toNonIndexed() : g)));
const S = (r, x, y, z, sx = 1, sy = 1, sz = 1) => new THREE.SphereGeometry(r, 10, 8).scale(sx, sy, sz).translate(x, y, z);
const Bx = (w, h, d, x, y, z, rx = 0) => new THREE.BoxGeometry(w, h, d).rotateX(rx).translate(x, y, z);
const Cn = (r, h, x, y, z, rx = 0, rz = 0) => new THREE.ConeGeometry(r, h, 6).rotateX(rx).rotateZ(rz).translate(x, y, z);

// Species: body geometry (white parts take the instance colour), legs, speeds, sounds.
const SPECIES = {
  chicken: {
    body: () => merge([
      paint(S(0.17, 0, 0.32, 0, 1, 0.9, 1.25), '#ffffff'),
      paint(S(0.1, 0, 0.5, 0.15), '#ffffff'),
      paint(Bx(0.04, 0.06, 0.06, 0, 0.6, 0.16), '#d91e18'),
      paint(Cn(0.025, 0.07, 0, 0.49, 0.26, Math.PI / 2), '#e8b10e'),
      paint(Bx(0.03, 0.06, 0.03, 0, 0.44, 0.2), '#d91e18'),
      paint(S(0.09, 0, 0.42, -0.2, 0.6, 1.4, 0.8).rotateX(-0.5), '#ffffff'),
    ]),
    leg: () => paint(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 5).translate(0, -0.1, 0), '#e8b10e'),
    legs: [[0.05, 0.2, 0], [-0.05, 0.2, 0]],
    colors: ['#f4f1ea', '#a0522d', '#7a3b1c', '#2b2420', '#c9874a', '#e9dccb'],
    walk: 0.55, flee: 3.6, fleeR: 4, r: 0.2, h: 0.6, sound: 'chicken', count: 44, group: [3, 6], stride: 14,
  },
  cat: {
    body: () => merge([
      paint(S(0.13, 0, 0.27, 0, 0.9, 0.85, 2.0), '#ffffff'),
      paint(S(0.1, 0, 0.36, 0.27), '#ffffff'),
      paint(Cn(0.035, 0.07, 0.05, 0.46, 0.27), '#ffffff'),
      paint(Cn(0.035, 0.07, -0.05, 0.46, 0.27), '#ffffff'),
      paint(new THREE.CylinderGeometry(0.018, 0.02, 0.32, 5).rotateX(-0.9).translate(0, 0.38, -0.33), '#ffffff'),
      paint(S(0.012, 0.035, 0.38, 0.36), '#1a1a1a'),
      paint(S(0.012, -0.035, 0.38, 0.36), '#1a1a1a'),
    ]),
    leg: () => paint(new THREE.CylinderGeometry(0.022, 0.02, 0.2, 5).translate(0, -0.1, 0), '#ffffff'),
    legs: [[0.06, 0.2, 0.16], [-0.06, 0.2, 0.16], [0.06, 0.2, -0.16], [-0.06, 0.2, -0.16]],
    colors: ['#e08a3c', '#f2efe9', '#2a2624', '#8f8a84', '#c97a3a', '#d9c4a8'],
    walk: 0.7, flee: 5.2, fleeR: 3, r: 0.25, h: 0.5, sound: 'cat', count: 14, group: [1, 2], stride: 8,
  },
  goat: {
    body: () => merge([
      paint(S(0.22, 0, 0.72, 0, 1, 0.95, 1.9), '#ffffff'),
      paint(S(0.12, 0, 0.92, 0.45, 0.9, 1, 1.4).rotateX(0.4), '#ffffff'),
      paint(Cn(0.03, 0.2, 0.06, 1.1, 0.4, -0.5), '#5a4a3a'),
      paint(Cn(0.03, 0.2, -0.06, 1.1, 0.4, -0.5), '#5a4a3a'),
      paint(Bx(0.18, 0.04, 0.08, 0, 0.98, 0.42), '#ffffff'),
      paint(Cn(0.03, 0.1, 0, 0.78, 0.52, Math.PI), '#ffffff'),
      paint(Cn(0.04, 0.12, 0, 0.82, -0.42, 0.8), '#ffffff'),
    ]),
    leg: () => paint(new THREE.CylinderGeometry(0.035, 0.03, 0.55, 5).translate(0, -0.27, 0), '#ffffff'),
    legs: [[0.1, 0.55, 0.28], [-0.1, 0.55, 0.28], [0.1, 0.55, -0.28], [-0.1, 0.55, -0.28]],
    colors: ['#f3f0e8', '#3a2e25', '#8a6440', '#e8e2d6', '#5b4636'],
    walk: 0.6, flee: 3.2, fleeR: 4, r: 0.4, h: 1.0, sound: 'goat', count: 14, group: [2, 4], stride: 6,
  },
  cow: {
    // Sapi Bali: reddish-brown coat, white rump and stockings, short horns.
    body: () => merge([
      paint(S(0.42, 0, 1.15, 0, 1, 0.95, 2.1), '#ffffff'),
      paint(S(0.3, 0, 1.1, -0.62, 1.05, 0.95, 0.7), '#f4f1ea'),
      paint(S(0.2, 0, 1.48, 0.5, 1, 0.9, 1), '#ffffff'),
      paint(S(0.18, 0, 1.32, 0.92, 0.9, 1, 1.45), '#ffffff'),
      paint(S(0.11, 0, 1.2, 1.1, 1.1, 0.8, 0.8), '#2a2420'),
      paint(Cn(0.04, 0.22, 0.13, 1.5, 0.9, 0, -0.9), '#d8d0c0'),
      paint(Cn(0.04, 0.22, -0.13, 1.5, 0.9, 0, 0.9), '#d8d0c0'),
      paint(new THREE.CylinderGeometry(0.03, 0.02, 0.6, 5).translate(0, 0.95, -0.95), '#2a2420'),
    ]),
    leg: () => merge([paint(new THREE.CylinderGeometry(0.07, 0.06, 0.62, 6).translate(0, -0.31, 0), '#ffffff'), paint(new THREE.CylinderGeometry(0.065, 0.07, 0.3, 6).translate(0, -0.66, 0), '#f4f1ea')]),
    legs: [[0.2, 0.82, 0.55], [-0.2, 0.82, 0.55], [0.2, 0.82, -0.55], [-0.2, 0.82, -0.55]],
    colors: ['#a0522d', '#9a4f2a', '#b5652f', '#7a3f22', '#4a3a30'],
    walk: 0.45, flee: 1.8, fleeR: 3, r: 0.8, h: 1.7, sound: 'cow', count: 12, group: [2, 4], stride: 5,
  },
  duck: {
    body: () => merge([
      paint(S(0.14, 0, 0.08, 0, 1, 0.75, 1.5), '#ffffff'),
      paint(S(0.08, 0, 0.26, 0.17), '#ffffff'),
      paint(Bx(0.06, 0.025, 0.09, 0, 0.24, 0.27), '#e89a10'),
      paint(Cn(0.06, 0.1, 0, 0.13, -0.2, -1.2), '#ffffff'),
    ]),
    leg: null,
    legs: [],
    colors: ['#f2efe6', '#8a6a46', '#6b5a45', '#e9e2d0'],
    walk: 0.35, flee: 1.6, fleeR: 5, r: 0.2, h: 0.4, sound: 'duck', count: 16, group: [4, 7], stride: 16, water: true,
  },
};

export function createAnimals({ scene, M, colliders }) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  const species = [];
  const all = [];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e3 = new THREE.Euler(0, 0, 0, 'YXZ');
  const one = new THREE.Vector3(1, 1, 1);
  const pv = new THREE.Vector3();
  const legM = new THREE.Matrix4();
  const tmpM = new THREE.Matrix4();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  // Spawn helpers.
  const houses = M.buildings.filter((b) => b.area > 30 && b.area < 250);
  const fields = M.landuse.filter((l) => ['farmland', 'meadow', 'open_field_space', 'park'].includes(l.kind));
  const lanes = M.edges.filter((e) => e.rank <= 2 && e.len > 30);
  const waterPts = [];
  for (const r of elev.rivers) if (r.big) for (let i = 0; i < r.pts.length; i += 3) waterPts.push([...r.pts[i], r.wl[i], r.hw]);
  for (const p of elev.ponds) {
    let cx = 0, cz = 0;
    for (const [x, z] of p.ring) { cx += x; cz += z; }
    for (let k = 0; k < 30; k++) waterPts.push([cx / p.ring.length + (Math.random() - 0.5) * 60, cz / p.ring.length + (Math.random() - 0.5) * 40, p.wl, 20]);
  }
  const free = (x, z) => !colliders.containsPoint(x, z) && !M.roadIndex.near(x, z, 0.8) && elev.depthAt(x, z) < 0.05;

  function home(kind, px, pz) {
    const sp = SPECIES[kind];
    for (let tries = 0; tries < 40; tries++) {
      let x, z;
      if (kind === 'chicken' || kind === 'cat') {
        const b = houses[Math.floor(Math.random() * houses.length)];
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(b.area) * 0.75 + 2 + Math.random() * 3;
        x = b.cx + Math.cos(a) * r;
        z = b.cz + Math.sin(a) * r;
      } else if (kind === 'goat') {
        const e = lanes[Math.floor(Math.random() * lanes.length)];
        const i = Math.floor(Math.random() * (e.pts.length - 1));
        const [ax, az] = e.pts[i], [bx, bz] = e.pts[i + 1];
        const t = Math.random(), l = Math.hypot(bx - ax, bz - az) || 1;
        const off = (e.width / 2 + 3 + Math.random() * 6) * (Math.random() < 0.5 ? 1 : -1);
        x = ax + (bx - ax) * t + ((bz - az) / l) * off;
        z = az + (bz - az) * t - ((bx - ax) / l) * off;
      } else if (kind === 'cow') {
        const f = fields[Math.floor(Math.random() * fields.length)];
        if (!f) return null;
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (const [qx, qz] of f.pts) { x0 = Math.min(x0, qx); x1 = Math.max(x1, qx); z0 = Math.min(z0, qz); z1 = Math.max(z1, qz); }
        x = x0 + Math.random() * (x1 - x0);
        z = z0 + Math.random() * (z1 - z0);
        if (!pointInPoly(x, z, f.pts)) continue;
      } else {
        const w = waterPts[Math.floor(Math.random() * waterPts.length)];
        if (!w) return null;
        x = w[0] + (Math.random() - 0.5) * w[3] * 0.8;
        z = w[1] + (Math.random() - 0.5) * w[3] * 0.8;
      }
      const d = Math.hypot(x - px, z - pz);
      if (d < 45 || d > 150) continue;
      if (sp.water ? elev.depthAt(x, z) < 0.6 : !free(x, z)) continue;
      return [x, z];
    }
    return null;
  }

  for (const [kind, sp] of Object.entries(SPECIES)) {
    const body = new THREE.InstancedMesh(sp.body(), mat, sp.count);
    body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    body.castShadow = kind === 'cow' || kind === 'goat';
    body.frustumCulled = false;
    scene.add(body);
    let legs = null;
    if (sp.leg) {
      legs = new THREE.InstancedMesh(sp.leg(), mat, sp.count * sp.legs.length);
      legs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      legs.frustumCulled = false;
      scene.add(legs);
    }
    const list = [];
    for (let i = 0; i < sp.count; i++) {
      const a = { kind, sp, i, x: 0, z: 0, y: 0, face: Math.random() * 6, hx: 0, hz: 0, tx: 0, tz: 0, state: 'off', t: 0, phase: Math.random() * 6, dead: 0, fall: 0, sound: 2 + Math.random() * 10, speed: 0 };
      body.setColorAt(i, tmpC.set(sp.colors[Math.floor(Math.random() * sp.colors.length)]));
      body.setMatrixAt(i, hidden);
      list.push(a);
      all.push(a);
    }
    if (legs) for (let k = 0; k < sp.count * sp.legs.length; k++) legs.setMatrixAt(k, hidden);
    body.instanceColor.needsUpdate = true;
    species.push({ kind, sp, body, legs, list });
  }

  // ---------------- Birds: flocks circling overhead ----------------
  const birdBody = new THREE.ConeGeometry(0.08, 0.4, 5).rotateX(Math.PI / 2);
  const wing = new THREE.BoxGeometry(0.5, 0.02, 0.18).translate(0.25, 0, 0);
  const birdMat = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.9 });
  const FLOCKS = 3, PER = 12;
  const birds = new THREE.InstancedMesh(birdBody, birdMat, FLOCKS * PER);
  const wings = new THREE.InstancedMesh(wing, birdMat, FLOCKS * PER * 2);
  for (const m of [birds, wings]) {
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    scene.add(m);
  }
  const flocks = Array.from({ length: FLOCKS }, (_, f) => ({ cx: 0, cz: 0, r: 30 + f * 12, h: 26 + f * 9, sp: 0.18 + f * 0.05, ph: f * 2, members: Array.from({ length: PER }, () => [Math.random() * 6, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 6, Math.random() * 6]) }));

  let soundT = 0;
  return {
    all,
    // Targets for shooting.
    targets(list, px, pz) {
      for (const a of all) if (a.state !== 'off' && !a.dead && Math.abs(a.x - px) < 120 && Math.abs(a.z - pz) < 120) list.push({ x: a.x, y: a.y, z: a.z, r: Math.max(0.2, a.sp.r * 0.7), h: a.sp.h, ref: a, kind: 'animal' });
    },
    kill(a, dx = 0, dz = 0) {
      if (a.dead) return;
      a.dead = 18;
      a.fall = 0;
      a.hx = dx * 2;
      a.hz = dz * 2;
      sfx[a.sp.sound]?.(0.9);
    },
    // dangers: [{ x, z, speed }] (player, vehicles); fx, fz: focus; night 0..1; hour 0..24.
    update(dt, t, fx, fz, dangers, night, hour, hazards) {
      soundT -= dt;
      for (const S2 of species) {
        const { sp, body, legs, list } = S2;
        let groupHome = null;
        let groupLeft = 0;
        for (const a of list) {
          if (a.state === 'off' || Math.hypot(a.x - fx, a.z - fz) > 175) {
            // (Re)spawn in groups around a new home spot.
            if (groupLeft <= 0) {
              groupHome = home(a.kind, fx, fz);
              groupLeft = sp.group[0] + Math.floor(Math.random() * (sp.group[1] - sp.group[0] + 1));
            }
            if (!groupHome) { a.state = 'off'; body.setMatrixAt(a.i, hidden); continue; }
            groupLeft--;
            a.hx = groupHome[0];
            a.hz = groupHome[1];
            a.x = a.hx + (Math.random() - 0.5) * 4;
            a.z = a.hz + (Math.random() - 0.5) * 4;
            a.tx = a.x;
            a.tz = a.z;
            a.state = 'idle';
            a.t = Math.random() * 3;
            a.dead = 0;
            a.fall = 0;
          }
          const near = Math.hypot(a.x - fx, a.z - fz);
          if (a.dead > 0) {
            a.dead -= dt;
            a.fall = Math.min(1, a.fall + dt * 4);
            if (a.dead <= 0) a.state = 'off';
          } else {
            // Flee from the player and fast vehicles.
            let fleeX = 0, fleeZ = 0;
            for (const d of dangers) {
              const dx = a.x - d.x, dz = a.z - d.z;
              const dd = Math.hypot(dx, dz);
              const R = sp.fleeR + (d.speed > 3 ? 3 : 0);
              if (dd < R && dd > 0.01) { fleeX += dx / dd; fleeZ += dz / dd; }
            }
            if (fleeX || fleeZ) {
              if (a.state !== 'flee' && near < 30) sfx[sp.sound]?.(Math.max(0.2, 1 - near / 30));
              a.state = 'flee';
              a.t = 1.5;
              const l = Math.hypot(fleeX, fleeZ);
              a.face = Math.atan2(fleeX / l, fleeZ / l);
            }
            a.t -= dt;
            if (a.state === 'flee') {
              a.speed = sp.flee;
              if (a.t <= 0) { a.state = 'idle'; a.t = 1 + Math.random() * 2; }
            } else if (a.state === 'walk') {
              const dx = a.tx - a.x, dz = a.tz - a.z;
              const dd = Math.hypot(dx, dz);
              let dy = Math.atan2(dx, dz) - a.face;
              dy = Math.atan2(Math.sin(dy), Math.cos(dy));
              a.face += dy * Math.min(1, dt * 4);
              a.speed = sp.walk;
              if (dd < 0.4 || a.t <= 0) { a.state = 'idle'; a.t = 1 + Math.random() * 4; }
            } else {
              a.speed = 0;
              if (a.t <= 0) {
                a.state = 'walk';
                a.t = 4 + Math.random() * 5;
                const ang = Math.random() * Math.PI * 2, r = Math.random() * (sp.water ? 10 : 7);
                a.tx = a.hx + Math.cos(ang) * r;
                a.tz = a.hz + Math.sin(ang) * r;
              }
            }
            if (a.speed > 0) {
              const nx = a.x + Math.sin(a.face) * a.speed * dt, nz = a.z + Math.cos(a.face) * a.speed * dt;
              if (sp.water ? elev.depthAt(nx, nz) > 0.4 : elev.depthAt(nx, nz) < 0.3) {
                a.x = nx;
                a.z = nz;
              } else { a.face += Math.PI * 0.7; a.state = 'idle'; a.t = 0.5; }
              if (!sp.water) {
                const pr = { x: a.x, z: a.z };
                if (colliders.resolve(pr, sp.r)) { a.x = pr.x; a.z = pr.z; }
              }
              a.phase += dt * a.speed * sp.stride;
            }
            // Run over by vehicles.
            for (const c of hazards) {
              if (c.speed < 4 || Math.abs(c.x - a.x) > 3 || Math.abs(c.z - a.z) > 3) continue;
              if (c.circles().some(([cx, cz]) => Math.hypot(cx - a.x, cz - a.z) < (c.r || 1) + sp.r)) this.kill(a, c.vx * 0.2, c.vz * 0.2);
            }
            // Idle sounds near the player (roosters crow at dawn).
            a.sound -= dt;
            if (a.sound <= 0 && near < 35) {
              a.sound = 6 + Math.random() * 14;
              if (soundT <= 0) {
                soundT = 1.2;
                const v = Math.max(0.15, 1 - near / 35);
                if (a.kind === 'chicken' && hour > 4.5 && hour < 8 && Math.random() < 0.5) sfx.rooster(v);
                else if (!(a.kind === 'chicken' && night > 0.6)) sfx[sp.sound]?.(v * 0.7);
              }
            }
          }
          // Pose.
          const water = sp.water ? elev.waterAt(a.x, a.z) : -Infinity;
          a.y = sp.water ? water : elev.surface(a.x, a.z);
          const bob = sp.water ? Math.sin(t * 2 + a.i) * 0.02 : a.speed > 0 ? Math.abs(Math.sin(a.phase)) * 0.03 : 0;
          const peck = a.kind === 'chicken' && a.state === 'idle' ? Math.max(0, Math.sin(t * 3 + a.i * 1.7)) * 0.5 : 0;
          e3.set(peck, a.face, a.fall * 1.5);
          q.setFromEuler(e3);
          m4.compose(pv.set(a.x, a.y + bob + (a.fall * sp.h) / 4, a.z), q, one);
          body.setMatrixAt(a.i, near < 150 ? m4 : hidden);
          if (legs) {
            sp.legs.forEach(([lx, ly, lz], k) => {
              const sw = a.speed > 0 && !a.dead ? Math.sin(a.phase + (k % 2 ? Math.PI : 0) + (k > 1 ? Math.PI / 2 : 0)) * 0.6 : 0;
              legM.makeRotationX(sw).setPosition(lx, ly, lz);
              legs.setMatrixAt(a.i * sp.legs.length + k, near < 90 ? tmpM.copy(m4).multiply(legM) : hidden);
            });
          }
        }
        body.instanceMatrix.needsUpdate = true;
        if (legs) legs.instanceMatrix.needsUpdate = true;
      }
      // Birds.
      let k = 0;
      for (const f of flocks) {
        f.cx += (fx + Math.cos(f.ph) * 60 - f.cx) * Math.min(1, dt * 0.05);
        f.cz += (fz + Math.sin(f.ph) * 60 - f.cz) * Math.min(1, dt * 0.05);
        if (!f.cx) { f.cx = fx; f.cz = fz; }
        const base = elev.ground(f.cx, f.cz);
        for (const [o, dy, dr, wp] of f.members) {
          const ang = t * f.sp + o * 0.12 + f.ph;
          const x = f.cx + Math.cos(ang) * (f.r + dr), z = f.cz + Math.sin(ang) * (f.r + dr);
          const y = base + f.h + dy + Math.sin(t * 0.7 + o) * 2;
          const face = -ang; // heading along the circle
          q.setFromEuler(e3.set(0, face, 0.3));
          birds.setMatrixAt(k, m4.compose(pv.set(x, y, z), q, one));
          const flap = Math.sin(t * 9 + wp) * 0.6;
          for (const s of [1, -1]) {
            q.setFromEuler(e3.set(0, face, s > 0 ? flap + 0.3 : Math.PI - flap + 0.3));
            wings.setMatrixAt(k * 2 + (s > 0 ? 0 : 1), m4.compose(pv.set(x, y, z), q, one));
          }
          k++;
        }
      }
      birds.instanceMatrix.needsUpdate = true;
      wings.instanceMatrix.needsUpdate = true;
    },
  };
}
