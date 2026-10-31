import * as THREE from 'three';
import { makeVehicleModel, VEHICLE_SPECS } from '../../core/vehicles3d.js';
import { vehicleCircles } from '../vehicles.js';
import { angleDiff, clamp } from '../util.js';
import { cumulative, pointAt, offsetPolyline } from './osm.js';

// Typical mix on Maros streets: mostly scooters, then family cars, pickups and pete-pete.
const MIX = [['moto', 0.46], ['mpv', 0.3], ['pickup', 0.12], ['angkot', 0.1], ['sport', 0.02]];
const COLORS = {
  moto: [0x111111, 0xf5f5f5, 0xb91c1c, 0x1d4ed8, 0x6b7280, 0x0f766e, 0xea580c],
  mpv: [0xf5f5f5, 0xd9d9d9, 0x2b2b2e, 0x9aa0a6, 0x7a1c1c, 0x1e3a5f, 0x4b5563],
  pickup: [0xf5f5f5, 0x2b2b2e, 0x9aa0a6, 0x1e3a5f],
  angkot: [0x1d4ed8, 0x2563eb, 0x1e40af],
  sport: [0xc1121f, 0xe5b422],
};

// Lane geometry for an edge travelled in direction `dir`, shifted `off` metres to the left.
export function createPaths() {
  const cache = new Map();
  return function legOf(edge, dir, off) {
    const key = `${edge.id}:${dir}:${off.toFixed(2)}`;
    let leg = cache.get(key);
    if (!leg) {
      const base = dir > 0 ? edge.pts : [...edge.pts].reverse();
      const pts = off ? offsetPolyline(base, off) : base;
      const cum = cumulative(pts);
      leg = { pts, cum, len: cum[cum.length - 1] };
      cache.set(key, leg);
    }
    return leg;
  };
}

export const laneOffset = (edge, moto = false) => {
  const base = edge.oneway ? 0 : clamp(edge.width / 4, 1.1, 2.4);
  // Scooters keep to the kerb side of the lane.
  return moto ? Math.min(base + 0.8, edge.width / 2 - 0.5) : base;
};

function pickType(rnd) {
  let r = rnd();
  for (const [t, w] of MIX) {
    r -= w;
    if (r <= 0) return t;
  }
  return 'mpv';
}

// AI traffic on the real road graph: lane following, junction turns, obstacle braking.
export function createTraffic({ scene, camera, M, getObstacles, count = 40, rnd = Math.random }) {
  const legOf = createPaths();
  const agents = [];
  const tmp = new THREE.Vector3();
  const drivable = M.edges.filter((e) => e.len > 14);
  let focusX = 0;
  let focusZ = 0;

  function makeAgent() {
    const type = pickType(rnd);
    const palette = COLORS[type];
    const color = palette[Math.floor(rnd() * palette.length)];
    const rider = type === 'moto' ? Math.floor(rnd() * 6) : -1;
    const model = makeVehicleModel(type, color, { rider });
    scene.add(model.root);
    const spec = VEHICLE_SPECS[type];
    return {
      type, color, spec, model, car: model, root: model.root, r: spec.r,
      legs: [], s: 0, hint: 0, v: 0, vmax: (type === 'moto' ? 0.95 : 0.85) + rnd() * 0.3,
      x: 0, z: 0, hx: 0, hz: 1, h: 0, vx: 0, vz: 0, speed: 0, roll: 0,
      tail: null, stuck: 0, ghost: 0, dead: false, kind: 'traffic', wheelRot: 0,
      circles() { return vehicleCircles(this.spec, this.x, this.z, this.h); },
    };
  }

  const tangentAt = (leg, atEnd) => {
    const n = leg.pts.length;
    const a = leg.pts[atEnd ? n - 2 : 0];
    const b = leg.pts[atEnd ? n - 1 : 1];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };

  // Append the next road (plus a short connector through the junction).
  function extend(c) {
    const t = c.tail;
    const options = M.exits(t.node).filter((x) => x.edge !== t.edge);
    if (!options.length) { c.dead = true; return; }
    const inT = tangentAt(t.leg, true);
    let total = 0;
    const weights = options.map((x) => {
      const o = tangentAt(legOf(x.edge, x.dir, 0), false);
      const ang = Math.acos(clamp(inT[0] * o[0] + inT[1] * o[1], -1, 1));
      const w = Math.exp(-ang * 1.1) * (1 + 0.2 * x.edge.rank);
      total += w;
      return w;
    });
    let r = rnd() * total;
    let pick = options[options.length - 1];
    for (let i = 0; i < options.length; i++) { r -= weights[i]; if (r <= 0) { pick = options[i]; break; } }
    const leg = legOf(pick.edge, pick.dir, laneOffset(pick.edge, c.spec.moto));
    const last = t.leg.pts[t.leg.pts.length - 1];
    const first = leg.pts[0];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) > 0.3) {
      const pts = [last, first];
      c.legs.push({ pts, cum: cumulative(pts), len: Math.hypot(first[0] - last[0], first[1] - last[1]), cap: 4.5 });
    }
    c.legs.push({ ...leg, cap: pick.edge.speed * (c.spec.moto ? 1.1 : 1) });
    c.tail = { edge: pick.edge, dir: pick.dir, node: pick.dir > 0 ? pick.edge.b : pick.edge.a, leg };
  }

  const visible = (x, z) => {
    tmp.set(x, 1, z).project(camera);
    return tmp.z < 1 && Math.abs(tmp.x) < 1.2 && Math.abs(tmp.y) < 1.2;
  };

  function place(c, fx, fz, anywhere = false) {
    for (let tries = 0; tries < 80; tries++) {
      const e = drivable[Math.floor(rnd() * drivable.length)];
      const dir = e.oneway ? 1 : rnd() < 0.5 ? 1 : -1;
      const leg = legOf(e, dir, laneOffset(e, c.spec.moto));
      const s = 3 + rnd() * (leg.len - 6);
      const p = pointAt(leg.pts, leg.cum, s);
      const dist = Math.hypot(p.x - fx, p.z - fz);
      if (!anywhere && (dist < 110 || dist > 300)) continue;
      if (!anywhere && dist < 260 && visible(p.x, p.z)) continue;
      if (agents.some((o) => o !== c && o.legs.length && Math.hypot(o.x - p.x, o.z - p.z) < 10)) continue;
      c.legs = [{ ...leg, cap: e.speed }];
      c.tail = { edge: e, dir, node: dir > 0 ? e.b : e.a, leg };
      c.dead = false;
      extend(c);
      if (c.dead) continue;
      extend(c);
      Object.assign(c, { s, hint: 0, v: Math.min(e.speed * c.vmax, 6), x: p.x, z: p.z, h: Math.atan2(p.dx, p.dz), hx: p.dx, hz: p.dz, stuck: 0, ghost: 0 });
      c.root.visible = true;
      return true;
    }
    return false;
  }

  for (let n = 0; n < count; n++) {
    const c = makeAgent();
    agents.push(c);
    place(c, 0, 0, true);
  }

  return {
    cars: agents,
    // Hand an AI vehicle over to the player (carjack): returns its pose, then respawns the agent elsewhere.
    takeOver(c) {
      const info = { type: c.type, color: c.color, x: c.x, z: c.z, h: c.h, v: c.v };
      c.legs = [];
      c.root.visible = false;
      c.x = c.z = 1e6;
      place(c, focusX, focusZ);
      return info;
    },
    update(dt, t, fx, fz) {
      focusX = fx;
      focusZ = fz;
      const obstacles = getObstacles();
      for (const c of agents) {
        if (!c.legs.length) { place(c, fx, fz); continue; }
        let leg = c.legs[0];
        let vdes = Math.min(leg.cap * c.vmax, leg.cap);

        if (c.ghost <= 0) {
          const lx = c.hz;
          const lz = -c.hx;
          const latMax = c.spec.moto ? 0.95 : 1.5;
          const check = (o) => {
            if (o === c) return;
            const rx = o.x - c.x;
            const rz = o.z - c.z;
            const fwd = rx * c.hx + rz * c.hz;
            if (fwd <= 0 || fwd > 16) return;
            if (Math.abs(rx * lx + rz * lz) > latMax + (o.r || 0.5) * 0.5) return;
            const gap = c.spec.moto ? 2.8 : 5.2;
            vdes = Math.min(vdes, Math.max(0, fwd - gap) * 1.4);
          };
          for (const o of agents) check(o);
          for (const o of obstacles) check(o);
        } else c.ghost -= dt;

        c.v += Math.max(-9 * dt, Math.min((c.spec.moto ? 4 : 3.2) * dt, vdes - c.v));
        c.stuck = c.v < 0.2 ? c.stuck + dt : 0;
        if (c.stuck > 9) { c.ghost = 4; c.stuck = 0; }

        c.s += c.v * dt;
        while (c.s >= leg.len) {
          c.s -= leg.len;
          c.legs.shift();
          c.hint = 0;
          if (c.legs.length < 3 && !c.dead) extend(c);
          if (!c.legs.length) break;
          leg = c.legs[0];
        }
        if (!c.legs.length) { c.v = 0; continue; }

        const p = pointAt(leg.pts, leg.cum, c.s, c.hint);
        c.hint = p.i;
        c.x = p.x;
        c.z = p.z;
        c.hx = p.dx;
        c.hz = p.dz;
        const dh = angleDiff(Math.atan2(p.dx, p.dz), c.h);
        c.h += dh * Math.min(1, dt * 10);
        c.vx = Math.sin(c.h) * c.v;
        c.vz = Math.cos(c.h) * c.v;
        c.speed = c.v;

        c.root.position.set(c.x, 0, c.z);
        c.root.rotation.y = c.h;
        const turn = dh / Math.max(dt, 1e-3);
        if (c.spec.moto) {
          c.roll += (clamp(-turn * c.v * 0.012, -0.45, 0.45) - c.roll) * Math.min(1, dt * 5);
          c.model.body.rotation.z = c.roll;
        }
        c.wheelRot += (c.v / 0.33) * dt;
        const steer = clamp(turn * 0.12, -0.5, 0.5);
        for (const w of c.model.wheels) {
          w.spin.rotation.x = c.wheelRot;
          if (w.front) w.steerG.rotation.y = steer;
        }
        c.model.tail.emissiveIntensity = vdes < c.v - 0.5 ? 4 : 1.2;

        // LOD: hide distant vehicles, only nearby ones cast shadows.
        const dist = Math.hypot(c.x - fx, c.z - fz);
        c.root.visible = dist < 250;
        const sh = dist < 70;
        if (sh !== c.shadow) {
          c.shadow = sh;
          c.root.traverse((o) => {
            if (o.isMesh) o.castShadow = sh;
          });
        }
        if (dist > 330) place(c, fx, fz);
      }
    },
  };
}
