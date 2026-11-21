import { makeHumanoid } from '../../core/humanoid.js';
import { sfx } from '../../core/audio.js';
import { pointAt } from './osm.js';
import { createPaths } from './traffic.js';
import { env } from '../util.js';

const SKIN = ['#e0b08a', '#c98d62', '#a9754f', '#8d5a3b', '#6b4430'];
const SHIRT = ['#e11d48', '#2563eb', '#16a34a', '#f59e0b', '#7c3aed', '#e5e7eb', '#0f172a', '#ea580c', '#0891b2', '#f5f5dc'];
const PANTS = ['#1f2937', '#374151', '#3b4a63', '#5b4636', '#111827', '#2f3e46'];
const pick = (a, r) => a[Math.floor(r() * a.length)];

// Pedestrians stroll along the roadside of real streets and get knocked down by cars.
export function createPeds({ scene, M, count = 40, rnd = Math.random, kiosks = [] }) {
  const legOf = createPaths();
  const walkable = M.edges.filter((e) => e.len > 16);
  const peds = [];
  for (let n = 0; n < count; n++) {
    const h = makeHumanoid({ skin: pick(SKIN, rnd), shirt: pick(SHIRT, rnd), pants: pick(PANTS, rnd), hair: pick(['#120c08', '#2b1a0e', '#3b2a1a'], rnd) });
    h.root.scale.setScalar(0.9 + rnd() * 0.12);
    h.root.visible = false;
    scene.add(h.root);
    peds.push({ h, edge: null, side: 1, dir: 1, s: 0, x: 0, z: 0, speed: 1.3, phase: rnd() * 6, down: 0, vx: 0, vz: 0, fallT: 0, scare: 0, active: false });
  }

  const legFor = (p) => legOf(p.edge, 1, p.side * (p.edge.width / 2 + 1.0));

  // People hanging out at the warung: a few stand and chat, some sit on the bench.
  const loiter = [];
  for (let n = 0; n < 12; n++) {
    const h = makeHumanoid({ skin: pick(SKIN, rnd), shirt: pick(SHIRT, rnd), pants: pick(PANTS, rnd), hair: pick(['#120c08', '#2b1a0e'], rnd), cap: rnd() < 0.25 ? pick(['#1f2937', '#7f1d1d', '#f5f5f5'], rnd) : null });
    h.root.visible = false;
    scene.add(h.root);
    loiter.push({ h, loiter: true, on: false, x: 0, z: 0, y: 0, face: 0, sit: false, dead: 0, fall: 0, flee: 0, ph: rnd() * 6, k: null });
  }
  const used = new Map();
  const release = (k) => used.set(k, Math.max(0, (used.get(k) || 1) - 1));
  function updateLoiter(dt, t, fx, fz) {
    for (const l of loiter) {
      const h = l.h;
      if (l.on && Math.hypot(l.x - fx, l.z - fz) > 160) {
        l.on = false;
        release(l.k);
        h.root.visible = false;
      }
      if (!l.on) {
        // Take a free kiosk 40-140 m away.
        const k = kiosks[Math.floor(rnd() * kiosks.length)];
        if (!k || (used.get(k) || 0) >= 3) continue;
        const d = Math.hypot(k.x - fx, k.z - fz);
        if (d < 40 || d > 140) continue;
        const group = loiter.filter((q) => q.on && q.k === k).length;
        used.set(k, (used.get(k) || 0) + 1);
        const fxk = Math.sin(k.ry), fzk = Math.cos(k.ry);
        l.sit = group === 0 || rnd() < 0.4;
        const side = (group - 1) * 0.75;
        l.x = k.x + fxk * (l.sit ? 2.55 : 1.9) + Math.cos(k.ry) * side;
        l.z = k.z + fzk * (l.sit ? 2.55 : 1.9) - Math.sin(k.ry) * side;
        l.face = l.sit ? k.ry + Math.PI : k.ry + Math.PI + (rnd() - 0.5);
        l.k = k;
        l.on = true;
        l.dead = 0;
        l.flee = 0;
        h.root.visible = true;
        h.root.rotation.set(0, l.face, 0);
        continue;
      }
      l.y = env.groundHeight(l.x, l.z);
      if (l.dead > 0) {
        l.dead -= dt;
        l.fall = Math.min(1, l.fall + dt * 3);
        h.root.rotation.set(-l.fall * 1.5, l.face, 0);
        h.root.position.set(l.x, l.y + 0.18 * l.fall, l.z);
        if (l.dead <= 0) { l.on = false; release(l.k); h.root.visible = false; }
        continue;
      }
      if (l.flee > 0) {
        // Run away from the kiosk, then vanish.
        l.flee -= dt;
        l.sit = false;
        l.x += Math.sin(l.face) * 4.5 * dt;
        l.z += Math.cos(l.face) * 4.5 * dt;
        l.ph += dt * 9;
        h.run(l.ph, 0.95);
        h.root.position.set(l.x, l.y, l.z);
        h.root.rotation.set(0, l.face, 0);
        if (l.flee <= 0) { l.on = false; release(l.k); h.root.visible = false; }
        continue;
      }
      const near = Math.hypot(l.x - fx, l.z - fz) < 70;
      if (!near) continue;
      h.idle(t + l.ph);
      if (l.sit) {
        h.lLeg.pivot.rotation.x = h.rLeg.pivot.rotation.x = -1.5;
        h.lLeg.lower.rotation.x = h.rLeg.lower.rotation.x = 1.5;
        h.body.position.y = -0.47;
        h.lArm.pivot.rotation.x = h.rArm.pivot.rotation.x = -0.5;
        h.lArm.lower.rotation.x = -0.8;
        // Sipping coffee now and then.
        h.rArm.lower.rotation.x = -1.2 - Math.max(0, Math.sin(t * 0.7 + l.ph)) * 0.9;
      } else {
        // Chatting: hand gestures.
        h.rArm.pivot.rotation.x = -0.3 - Math.max(0, Math.sin(t * 1.9 + l.ph)) * 0.6;
        h.rArm.lower.rotation.x = -0.9;
      }
      h.root.position.set(l.x, l.y, l.z);
    }
  }

  function place(p, fx, fz) {
    for (let tries = 0; tries < 40; tries++) {
      const e = walkable[Math.floor(rnd() * walkable.length)];
      const s = rnd() * e.len;
      const q = pointAt(e.pts, e.cum, s);
      const d = Math.hypot(q.x - fx, q.z - fz);
      if (d < 30 || d > 170) continue;
      Object.assign(p, { edge: e, s, side: rnd() < 0.5 ? 1 : -1, dir: rnd() < 0.5 ? 1 : -1, speed: 1.15 + rnd() * 0.5, down: 0, scare: 0, active: true });
      p.h.root.rotation.x = 0;
      p.h.root.visible = true;
      return;
    }
  }

  let lastFx = 0;
  let lastFz = 0;

  return {
    peds,
    // A driver who just lost their car runs off down the street.
    spawnFleeing(x, z) {
      const near = M.roadIndex.nearest(x, z, 40);
      if (!near || near.edge.len < 6) return;
      const far = (q) => Math.hypot(q.x - lastFx, q.z - lastFz);
      const p = peds.find((q) => !q.active) || peds.reduce((a, q) => (far(q) > far(a) ? q : a));
      Object.assign(p, { edge: near.edge, s: near.s, side: rnd() < 0.5 ? 1 : -1, dir: rnd() < 0.5 ? 1 : -1, down: 0, scare: 12, active: true, x, z });
      p.h.root.rotation.x = 0;
      p.h.root.visible = true;
    },
    // Shootable pedestrians near (px, pz).
    targets(list, px, pz) {
      for (const p of peds) if (p.active && p.down <= 0 && Math.abs(p.x - px) < 130 && Math.abs(p.z - pz) < 130) list.push({ x: p.x, y: p.y || 0, z: p.z, r: 0.4, h: 1.75, ref: p, kind: 'ped' });
      for (const l of loiter) if (l.on && !l.dead && Math.abs(l.x - px) < 130 && Math.abs(l.z - pz) < 130) list.push({ x: l.x, y: l.y, z: l.z, r: 0.4, h: l.sit ? 1.3 : 1.75, ref: l, kind: 'loiter' });
    },
    // Shot or beaten: falls and stays down.
    kill(p, dx = 0, dz = 0, stay = true) {
      if (p.loiter) {
        p.dead = 20;
        p.fall = 0;
        return;
      }
      p.down = stay ? 22 : 6;
      p.dead = stay;
      p.fallT = 0;
      p.vx = dx * 2.5;
      p.vz = dz * 2.5;
      p.scare = 0;
    },
    // Gunfire or an explosion: everyone nearby runs.
    scare(x, z, r = 45) {
      for (const p of peds) if (p.active && Math.hypot(p.x - x, p.z - z) < r) p.scare = 10 + Math.random() * 4;
      for (const l of loiter) if (l.on && !l.dead && Math.hypot(l.x - x, l.z - z) < r) l.flee = 8;
    },
    update(dt, fx, fz, hazards, t = 0) {
      lastFx = fx;
      lastFz = fz;
      let knocked = 0;
      updateLoiter(dt, t, fx, fz);
      for (const p of peds) {
        if (!p.active) { place(p, fx, fz); continue; }
        const h = p.h;
        if (p.down > 0) {
          p.down -= dt;
          p.fallT = Math.min(1, p.fallT + dt * 3.5);
          p.x += p.vx * dt;
          p.z += p.vz * dt;
          p.vx *= 1 - Math.min(1, dt * 3);
          p.vz *= 1 - Math.min(1, dt * 3);
          h.root.rotation.x = -p.fallT * 1.5;
          h.root.position.set(p.x, env.groundHeight(p.x, p.z) + 0.18 * p.fallT, p.z);
          if (p.down <= 0) {
            if (p.dead) {
              p.dead = false;
              p.active = false;
              h.root.visible = false;
              h.root.rotation.x = 0;
            } else { p.scare = 6; h.root.rotation.x = 0; p.fallT = 0; }
          }
          continue;
        }

        p.scare = Math.max(0, p.scare - dt);
        const v = p.scare > 0 ? 4.2 : p.speed;
        p.s += p.dir * v * dt;
        let leg = legFor(p);
        if (p.s < 0 || p.s > leg.len) {
          // Reached the end of this street: continue on any connecting one.
          const node = p.s < 0 ? p.edge.a : p.edge.b;
          const next = node.edges.filter((x) => x.edge !== p.edge && x.edge.len > 8);
          if (!next.length) p.dir = -p.dir;
          else {
            const n = next[Math.floor(rnd() * next.length)];
            p.edge = n.edge;
            p.dir = n.dir;
            p.side = rnd() < 0.5 ? 1 : -1;
            leg = legFor(p);
            p.s = n.dir > 0 ? 0 : leg.len;
          }
          p.s = Math.max(0, Math.min(leg.len, p.s));
        }
        const q = pointAt(leg.pts, leg.cum, p.s);
        p.x = q.x;
        p.z = q.z;
        // LOD: animate only nearby pedestrians, shadows only very close.
        const near = Math.hypot(p.x - fx, p.z - fz);
        h.root.visible = near < 120;
        const sh = near < 35;
        if (sh !== p.shadow) {
          p.shadow = sh;
          h.setShadow(sh);
        }
        p.phase += dt * v * 3.1;
        if (near < 75) h.run(p.phase, p.scare > 0 ? 0.95 : 0.5);
        p.y = near < 130 ? env.groundHeight(p.x, p.z) : 0;
        h.root.position.set(p.x, p.y, p.z);
        let dy = Math.atan2(q.dx * p.dir, q.dz * p.dir) - h.root.rotation.y;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        h.root.rotation.y += dy * Math.min(1, dt * 8);

        for (const c of hazards) {
          const ddx = c.x - p.x;
          const ddz = c.z - p.z;
          const dist2 = ddx * ddx + ddz * ddz;
          if (dist2 > 144 || c.speed < 3) continue;
          if (dist2 < 100) p.scare = Math.max(p.scare, 1.5);
          for (const [cx, cz] of c.circles()) {
            if (Math.hypot(cx - p.x, cz - p.z) < 1.4) {
              p.down = 6;
              p.fallT = 0;
              p.vx = c.vx * 0.6;
              p.vz = c.vz * 0.6;
              sfx.thud(0.35);
              if (c.driver) knocked++;
              break;
            }
          }
          if (p.down > 0) break;
        }

        if (Math.hypot(p.x - fx, p.z - fz) > 200) {
          p.active = false;
          h.root.visible = false;
        }
      }
      return knocked;
    },
  };
}
