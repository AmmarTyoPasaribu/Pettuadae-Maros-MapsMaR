import { makeHumanoid } from '../../core/humanoid.js';
import { sfx } from '../../core/audio.js';
import { pointAt } from './osm.js';
import { createPaths } from './traffic.js';

const SKIN = ['#e0b08a', '#c98d62', '#a9754f', '#8d5a3b', '#6b4430'];
const SHIRT = ['#e11d48', '#2563eb', '#16a34a', '#f59e0b', '#7c3aed', '#e5e7eb', '#0f172a', '#ea580c', '#0891b2', '#f5f5dc'];
const PANTS = ['#1f2937', '#374151', '#3b4a63', '#5b4636', '#111827', '#2f3e46'];
const pick = (a, r) => a[Math.floor(r() * a.length)];

// Pedestrians stroll along the roadside of real streets and get knocked down by cars.
export function createPeds({ scene, M, count = 40, rnd = Math.random }) {
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
    update(dt, fx, fz, hazards) {
      lastFx = fx;
      lastFz = fz;
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
          h.root.position.set(p.x, 0.18 * p.fallT, p.z);
          if (p.down <= 0) { p.scare = 6; h.root.rotation.x = 0; p.fallT = 0; }
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
        h.root.position.set(p.x, 0, p.z);
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
    },
  };
}
