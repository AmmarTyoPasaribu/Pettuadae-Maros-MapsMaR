import * as THREE from 'three';
import { makeHumanoid } from '../core/humanoid.js';
import { createSiren, sfx } from '../core/audio.js';
import { Vehicle } from './vehicles.js';
import { env, clamp, angleDiff } from './util.js';

// Wanted level (0-5 stars) and the police response: patrol cars with sirens follow the road
// network to the player, ram cars, and officers get out to chase on foot, shoot (from two
// stars) and arrest anyone standing still next to them. Stars fade after a while out of sight.

const UNIFORM = { skin: '#b07a52', shirt: '#6b5636', pants: '#3a2f22', shoes: '#111111', hair: '#120c08', cap: '#2a2219' };

export function createPolice({ scene, M, route, vehicles, colliders, combat }) {
  const state = { level: 0, cool: 0, seen: false, flash: 0, evade: 0 };
  const units = [];
  const officers = [];
  let spawnT = 0;
  let siren = null;
  let busted = 0;

  function spawnUnit(px, pz) {
    // A junction 140-260 m away, preferably behind the player's view.
    let node = null;
    for (let tries = 0; tries < 60 && !node; tries++) {
      const n = M.nodes[Math.floor(Math.random() * M.nodes.length)];
      const d = Math.hypot(n.x - px, n.z - pz);
      if (d < 140 || d > 260 || !n.edges.some((e) => e.edge.rank >= 2)) continue;
      node = n;
    }
    if (!node) return;
    const e = node.edges[0];
    const p = e.dir > 0 ? e.edge.pts[1] : e.edge.pts[e.edge.pts.length - 2];
    const h = Math.atan2(p[0] - node.x, p[1] - node.z);
    const v = new Vehicle(scene, 'police', 0xf2f2f2, node.x, node.z, h);
    const u = { v, route: null, ri: 0, routeT: 0, stuck: 0, rev: 0, flash: Math.random(), crew: 2, leaving: false };
    v.police = u;
    u.active = true;
    vehicles.push(v);
    units.push(u);
  }

  function spawnOfficer(u, side) {
    const v = u.v;
    const lx = Math.cos(v.h) * side * 1.5, lz = -Math.sin(v.h) * side * 1.5;
    const h = makeHumanoid(UNIFORM);
    const g = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.05, 0.2), new THREE.MeshStandardMaterial({ color: 0x18191c, metalness: 0.6, roughness: 0.4 }));
    g.position.set(0, -0.36, 0.08);
    g.rotation.x = Math.PI / 2;
    h.rArm.lower.add(g);
    scene.add(h.root);
    const o = { h, x: v.x + lx, z: v.z + lz, y: v.y, face: v.h, hp: 100, down: 0, shootT: 1 + Math.random(), phase: Math.random() * 6, unit: u, kind: 'cop' };
    officers.push(o);
    u.crew--;
  }

  function removeOfficer(o) {
    scene.remove(o.h.root);
    o.h.disposeMaterials();
    officers.splice(officers.indexOf(o), 1);
  }

  function removeUnit(u) {
    for (const o of officers.filter((q) => q.unit === u)) removeOfficer(o);
    if (u.active !== false || !u.v.driver) {
      const i = vehicles.indexOf(u.v);
      if (i >= 0 && !u.v.driver) {
        u.v.dispose(scene);
        vehicles.splice(i, 1);
      }
    }
    units.splice(units.indexOf(u), 1);
  }

  function drive(u, dt, tx, tz, closeStop) {
    const v = u.v;
    const d = Math.hypot(tx - v.x, tz - v.z);
    let gx = tx, gz = tz;
    u.routeT -= dt;
    if (d > 45) {
      if (u.routeT <= 0) {
        u.route = route(v.x, v.z, tx, tz);
        u.ri = 0;
        u.routeT = 1.6;
      }
      if (u.route) {
        while (u.ri < u.route.length - 1 && Math.hypot(u.route[u.ri][0] - v.x, u.route[u.ri][1] - v.z) < 8) u.ri++;
        [gx, gz] = u.route[u.ri];
      }
    }
    const want = Math.atan2(gx - v.x, gz - v.z);
    const diff = angleDiff(want, v.h);
    const ctl = { thr: 0, brk: 0, steer: 0, hand: false };
    if (u.rev > 0) {
      u.rev -= dt;
      ctl.brk = 1;
      ctl.steer = -Math.sign(diff);
    } else {
      ctl.steer = clamp(diff * 2.2, -1, 1);
      if (d < closeStop) ctl.brk = v.vF > 0.4 ? 1 : 0;
      else if (Math.abs(diff) > 1.3 && v.speed > 8) ctl.brk = 1;
      else ctl.thr = 1;
      if (ctl.thr && v.speed < 0.7) u.stuck += dt;
      else u.stuck = 0;
      if (u.stuck > 1.5) {
        u.rev = 1.2;
        u.stuck = 0;
      }
    }
    return v.step(dt, ctl, colliders);
  }

  return {
    state,
    units,
    officers,
    // Raise the wanted level (stars).
    add(n = 1, min = 0) {
      if (busted) return;
      const before = Math.floor(state.level);
      state.level = clamp(Math.max(state.level + n, min), 0, 5);
      state.cool = 0;
      if (Math.floor(state.level) > before) {
        sfx.star();
        state.flash = 2;
        spawnT = Math.min(spawnT, 0.5);
      }
    },
    clear() {
      state.level = 0;
      state.cool = 0;
      busted = 0;
      for (const u of [...units]) removeUnit(u);
      for (const o of [...officers]) removeOfficer(o);
      siren?.set(0);
    },
    // Targets for the player's gun.
    targets(list) {
      for (const o of officers) if (!o.down) list.push({ x: o.x, y: o.y, z: o.z, r: 0.42, h: 1.85, ref: o, kind: 'cop' });
    },
    hitOfficer(o, dmg, dx, dz) {
      o.hp -= dmg;
      combat.bleed(o.x, o.y + 1.3, o.z);
      sfx.flesh();
      if (o.hp <= 0 && !o.down) {
        o.down = 20;
        o.vx = dx * 2;
        o.vz = dz * 2;
        o.fall = 0;
      }
      this.add(1, 3);
    },
    nearest(x, z) {
      let d = Infinity;
      for (const u of units) d = Math.min(d, Math.hypot(u.v.x - x, u.v.z - z));
      for (const o of officers) if (!o.down) d = Math.min(d, Math.hypot(o.x - x, o.z - z));
      return d;
    },
    // ctx: { P, car, onHurt(dmg), onBusted() }
    update(dt, t, ctx) {
      const { P, car } = ctx;
      const px = car ? car.x : P.x, pz = car ? car.z : P.z;
      const level = Math.floor(state.level);
      state.flash = Math.max(0, state.flash - dt);
      // Seen by any unit or officer within 75 m -> stars stay; otherwise they fade.
      state.seen = level > 0 && this.nearest(px, pz) < 75;
      if (level > 0) {
        if (state.seen) state.cool = 0;
        else {
          state.cool += dt;
          state.evade = state.cool / (10 + level * 3);
          if (state.cool > 10 + level * 3) {
            state.level = Math.max(0, level - 1);
            state.cool = 0;
          }
        }
      }
      // Units: keep count matching the wanted level.
      const want = level === 0 ? 0 : level >= 5 ? 5 : level;
      spawnT -= dt;
      const live = units.filter((u) => u.active && !u.leaving);
      if (live.length < want && spawnT <= 0) {
        spawnUnit(px, pz);
        spawnT = 4;
      }
      if (live.length > want) for (const u of live.slice(want)) u.leaving = true;

      let nearest = Infinity;
      for (const u of [...units]) {
        const v = u.v;
        if (v.driver) u.active = false; // stolen by the player
        const d = Math.hypot(v.x - px, v.z - pz);
        if (u.active && !v.drowned) {
          if (u.leaving || level === 0) {
            drive(u, dt, v.x + Math.sin(v.h) * 50, v.z + Math.cos(v.h) * 50, 0);
            if (d > 160) { removeUnit(u); continue; }
          } else {
            const imp = drive(u, dt, px, pz, car ? 2 : 10);
            if (car && imp > 4) ctx.onRam?.(imp);
            // Crew gets out when close to a player on foot.
            if (!car && d < 22 && v.speed < 2.5 && u.crew > 0) {
              spawnOfficer(u, -1);
              if (u.crew > 0 && level >= 2) spawnOfficer(u, 1);
            }
          }
          // Flashing light bar.
          u.flash += dt * 3.2;
          const ph = u.flash % 1;
          if (v.model.siren) {
            v.model.siren.red.emissiveIntensity = level > 0 && !u.leaving ? (ph < 0.5 ? 7 : 0.2) : 0.3;
            v.model.siren.blue.emissiveIntensity = level > 0 && !u.leaving ? (ph >= 0.5 ? 7 : 0.2) : 0.3;
          }
        } else if (d > 400 && !v.driver) {
          removeUnit(u);
          continue;
        }
        if (u.active && level > 0 && !u.leaving) nearest = Math.min(nearest, d);
        // Arrest in a car: stopped next to a patrol car for a moment.
        if (car && u.active && !u.leaving && d < 5.5 && car.speed < 1.2) busted += dt * 0.6;
      }

      // Officers on foot.
      for (const o of [...officers]) {
        const h = o.h;
        if (o.down > 0) {
          o.down -= dt;
          o.fall = Math.min(1, (o.fall || 0) + dt * 3);
          o.x += (o.vx || 0) * dt;
          o.z += (o.vz || 0) * dt;
          o.vx = (o.vx || 0) * (1 - Math.min(1, dt * 3));
          o.vz = (o.vz || 0) * (1 - Math.min(1, dt * 3));
          h.root.rotation.x = -o.fall * 1.5;
          o.y = env.groundHeight(o.x, o.z);
          h.root.position.set(o.x, o.y + 0.18 * o.fall, o.z);
          if (o.down <= 0) removeOfficer(o);
          continue;
        }
        const dx = px - o.x, dz = pz - o.z;
        const d = Math.hypot(dx, dz);
        const u = o.unit;
        let speed = 0;
        let aim = false;
        if (level === 0 || (car && d > 25) || !units.includes(u)) {
          // Back to the patrol car.
          const tx = u.v.x - o.x, tz = u.v.z - o.z;
          const td = Math.hypot(tx, tz);
          if (td < 2.2 || !units.includes(u) || !u.active) {
            if (units.includes(u)) u.crew++;
            removeOfficer(o);
            continue;
          }
          o.face = Math.atan2(tx, tz);
          speed = 5;
        } else {
          o.face = Math.atan2(dx, dz);
          if (level >= 2 && d < 28 && d > 2.5) {
            aim = d < 16 || level >= 3;
            o.shootT -= dt;
            if (aim && o.shootT <= 0) {
              o.shootT = 0.9 + Math.random() * 0.6;
              const moving = car ? car.speed > 3 : P.speed > 4;
              const chance = clamp(0.5 - d * 0.014, 0.12, 0.5) * (moving ? 0.55 : 1) * (car ? 0.7 : 1);
              const hit = Math.random() < chance;
              const fy = o.y + 1.45;
              combat.npcShot({ x: o.x + Math.sin(o.face) * 0.6, y: fy, z: o.z + Math.cos(o.face) * 0.6 }, { x: px, y: (car ? car.y : P.y) + 1.2, z: pz }, hit);
              if (hit) ctx.onHurt(6 + Math.random() * 4);
            }
          }
          if (!aim || d > 14) speed = d > 2 ? 5.4 : 0;
          // Arrest: next to a slow player on foot.
          if (!car && d < 1.7 && P.speed < 3.5) busted += dt;
        }
        if (speed) {
          o.x += Math.sin(o.face) * speed * dt;
          o.z += Math.cos(o.face) * speed * dt;
          const pr = { x: o.x, z: o.z, y: o.y + 0.9 };
          if (colliders.resolve(pr, 0.4)) { o.x = pr.x; o.z = pr.z; }
          o.phase += dt * speed * 1.9;
          h.run(o.phase, 0.9);
        } else h.idle(t);
        if (aim) {
          h.rArm.pivot.rotation.set(-Math.PI / 2, 0, 0.05);
          h.rArm.lower.rotation.x = 0;
        }
        o.y = env.groundHeight(o.x, o.z, o.y);
        h.root.position.set(o.x, o.y, o.z);
        h.root.rotation.y = o.face;
        nearest = Math.min(nearest, d);
      }
      busted = Math.max(0, busted - dt * 0.3);
      if (busted > 1.4 && level > 0) {
        busted = 0;
        ctx.onBusted();
      }
      // Siren volume by distance.
      if (!siren && units.length) siren = createSiren();
      siren?.set(level > 0 && Number.isFinite(nearest) ? 0.07 * clamp(1 - nearest / 220, 0, 1) ** 1.5 : 0);
      state.nearest = nearest;
    },
  };
}
