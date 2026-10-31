import { Colliders } from '../colliders.js';
import { mulberry32, env } from '../util.js';
import { Vehicle } from '../vehicles.js';
import { loadMap, pointAt, LIMIT } from './osm.js';
import { buildTerrain } from './terrain.js';
import { createTraffic, createPaths } from './traffic.js';
import { createPeds } from './peds.js';
import { createMinimap, createFullMap } from './minimap.js';
import { createRouter } from './route.js';

const PARKED = [
  ['moto', 0.45, [0x111111, 0xf5f5f5, 0xb91c1c, 0x1d4ed8, 0x6b7280]],
  ['mpv', 0.33, [0xf5f5f5, 0xd9d9d9, 0x2b2b2e, 0x9aa0a6, 0x7a1c1c, 0x1e3a5f]],
  ['pickup', 0.12, [0xf5f5f5, 0x2b2b2e, 0x9aa0a6]],
  ['angkot', 0.07, [0x1d4ed8, 0x2563eb]],
  ['sport', 0.03, [0xc1121f, 0xe5b422]],
];

// Kelurahan Pettuadae, Turikale, Maros built from OpenStreetMap + satellite-derived detail.
export const marosMap = {
  id: 'pettuadae',
  title: 'Pettuadae, Maros',
  subtitle: 'Kelurahan Pettuadae, Turikale, Kabupaten Maros, dibangun dari peta sungguhan: jalan, sungai, ribuan bangunan dengan warna atap dan pepohonan dari citra satelit.',
  credits: 'Data peta © kontributor OpenStreetMap (ODbL) · Toko & tempat: Overture Maps Foundation · Warna atap, pohon & lebar jalan diturunkan dari citra Esri World Imagery (Esri, Maxar, Earthstar Geographics)',
  accent: '#22c55e',
  env: { groundHeight: () => 0, limit: LIMIT },
  spawn: { x: 0, z: 0, face: 0, cam: 0 }, // set in create()
  areaName: 'Pettuadae · Turikale',

  create({ scene, camera, rnd, getObstacles }) {
    const M = loadMap();
    const colliders = new Colliders(24);
    const r = mulberry32(777);
    const before = new Set(scene.children);
    const world = buildTerrain(scene, M, colliders, r);
    // Static world: compute matrices once instead of every frame.
    const freeze = (o) => {
      if (o.userData.dynamic) return;
      o.updateMatrix();
      o.matrixAutoUpdate = false;
      for (const c of o.children) freeze(c);
    };
    for (const o of scene.children) if (!before.has(o)) freeze(o);
    const legOf = createPaths();
    const router = createRouter(M);
    const bps = world.bps;
    if (bps) {
      // Floors and ceilings of the walk-in BPS office.
      env.groundHeight = (x, z, y = 0) => {
        const h = bps.heightAt(x, z, y);
        return h > 0 ? h : M.roadIndex.curbAt(x, z);
      };
      env.ceilingAt = (x, z, y = 0) => bps.ceilingAt(x, z, y);
    }

    const probe = { x: 0, z: 0 };
    const clear = (x, z, h, offs = [1.45, 0, -1.45], rad = 1.1) => {
      for (const o of offs) {
        probe.x = x + Math.sin(h) * o;
        probe.z = z + Math.cos(h) * o;
        if (colliders.resolve(probe, rad)) return false;
      }
      return true;
    };

    // ---- Spawn on the roadside nearest to the Kantor Kelurahan ----
    const near = M.roadIndex.nearest(M.kantor.x, M.kantor.z, 300) || M.roadIndex.nearest(0, 0, 600);
    const e = near.edge;
    const tangent = pointAt(e.pts, e.cum, near.s);
    const nx = tangent.dz, nz = -tangent.dx;
    const toK = (M.kantor.x - near.x) * nx + (M.kantor.z - near.z) * nz;
    let sx = near.x, sz = near.z;
    for (const sign of [Math.sign(toK) || 1, -(Math.sign(toK) || 1)]) {
      const x = near.x + nx * sign * (e.width / 2 + 1.4);
      const z = near.z + nz * sign * (e.width / 2 + 1.4);
      if (!colliders.containsPoint(x, z)) { sx = x; sz = z; break; }
    }
    const heading = Math.atan2(tangent.dx, tangent.dz);
    this.spawn = { x: sx, z: sz, face: heading, cam: heading };

    // ---- Starter scooter + car right next to the spawn ----
    const vehicles = [];
    const parkAt = (edge, s, dir, extra) => {
      const leg = legOf(edge, dir, edge.width / 2 + extra);
      const p = pointAt(leg.pts, leg.cum, Math.max(2, Math.min(leg.len - 2, s)));
      return { x: p.x, z: p.z, h: Math.atan2(p.dx, p.dz) };
    };
    for (const [type, color, extra, offs, rad] of [['moto', 0xb91c1c, 0.9, [0.55, -0.55], 0.5], ['mpv', 0xf5f5f5, 1.6, [1.35, 0, -1.35], 1.05]]) {
      let done = false;
      for (const ds of [4, -4, 8, -8, 13, -13, 19, -19]) {
        for (const dir of [1, -1]) {
          const sAlong = near.s + ds;
          if (sAlong < 2 || sAlong > e.len - 2) continue;
          const p = parkAt(e, dir > 0 ? sAlong : e.len - sAlong, dir, extra);
          if (Math.hypot(p.x - sx, p.z - sz) > 24 || !clear(p.x, p.z, p.h, offs, rad)) continue;
          if (vehicles.some((v) => Math.hypot(v.x - p.x, v.z - p.z) < 4)) continue;
          vehicles.push(new Vehicle(scene, type, color, p.x, p.z, p.h));
          done = true;
          break;
        }
        if (done) break;
      }
      if (!done) vehicles.push(new Vehicle(scene, type, color, sx + 2.5 + vehicles.length * 3, sz, heading));
    }

    // ---- Staff vehicles in the BPS parking ----
    if (bps) {
      for (const [i, type, color] of [[0, 'mpv', 0xf5f5f5], [2, 'mpv', 0x2b2b2e], [4, 'moto', 0x1d4ed8]]) {
        const p = bps.parking[i];
        vehicles.push(new Vehicle(scene, type, color, p.x, p.z, p.h));
      }
    }

    // ---- Parked vehicles on shoulders across the area ----
    const cand = M.edges.filter((x) => x.len > 30);
    const pickParked = () => {
      let q = r();
      for (const p of PARKED) { q -= p[1]; if (q <= 0) return p; }
      return PARKED[0];
    };
    let guard = 0;
    while (vehicles.length < 34 && guard++ < 900) {
      const [type, , colors] = pickParked();
      const moto = type === 'moto';
      const ed = cand[Math.floor(r() * cand.length)];
      const dir = r() < 0.5 ? 1 : -1;
      const p0 = parkAt(ed, 10 + r() * (ed.len - 20), dir, moto ? 0.9 : 1.6);
      if (!clear(p0.x, p0.z, p0.h, moto ? [0.55, -0.55] : [1.45, 0, -1.45], moto ? 0.5 : 1.1)) continue;
      if (vehicles.some((v) => Math.hypot(v.x - p0.x, v.z - p0.z) < 7)) continue;
      vehicles.push(new Vehicle(scene, type, colors[Math.floor(r() * colors.length)], p0.x, p0.z, p0.h));
    }

    const traffic = createTraffic({ scene, camera, M, getObstacles, count: 40, rnd: r });
    const peds = createPeds({ scene, M, count: 44, rnd: r });

    // Jobs go to real named places (shops, schools, offices, markets...), snapped to the road.
    const named = M.pois.filter((p) => p.name && p.name.length > 2);
    const pickDestination = (px, pz) => {
      for (let tries = 0; tries < 60; tries++) {
        const poi = named[Math.floor(rnd() * named.length)];
        const d = Math.hypot(poi.x - px, poi.z - pz);
        if (d < 180 || d > 850) continue;
        const rd = M.roadIndex.nearest(poi.x, poi.z, 60);
        if (!rd) continue;
        return { x: rd.x, z: rd.z, name: poi.name };
      }
      return null;
    };

    // Street name under the player (for the on-screen location label).
    // Shop / service the player is standing next to.
    const PG = 25;
    const pgrid = new Map();
    for (const p of M.places) {
      const k = Math.floor(p.x / PG) * 10000 + Math.floor(p.z / PG);
      if (!pgrid.has(k)) pgrid.set(k, []);
      pgrid.get(k).push(p);
    }
    const placeNear = (x, z, r2 = 7) => {
      let best = null;
      let bd = r2;
      for (let gx = Math.floor(x / PG) - 1; gx <= Math.floor(x / PG) + 1; gx++) for (let gz = Math.floor(z / PG) - 1; gz <= Math.floor(z / PG) + 1; gz++) {
        for (const p of pgrid.get(gx * 10000 + gz) || []) {
          const d = Math.hypot(p.x - x, p.z - z);
          if (d < bd) { bd = d; best = p; }
        }
      }
      return best;
    };

    const streetAt = (x, z) => {
      if (bps && bps.isInside(x, z)) return bps.name;
      const rd = M.roadIndex.nearest(x, z, 18);
      return rd && rd.edge.name ? rd.edge.name : '';
    };

    return {
      world,
      vehicles,
      traffic,
      peds,
      pickDestination,
      streetAt,
      placeNear,
      M,
      route: (fx, fz, tx, tz) => router.route(fx, fz, tx, tz),
      createMinimap: (parent) => createMinimap(parent, M),
      createFullMap: (parent, opts) => createFullMap(parent, M, opts),
      stats: { ...M.stats, trees: world.treeCount, buildingTypes: world.buildingCounts, places: M.places.length, shops: world.shops },
      menuCamera(t, camera2, target) {
        const a = t * 0.04;
        target.set(-300, 0, 120);
        camera2.position.set(-300 + Math.cos(a) * 380, 170, 120 + Math.sin(a) * 380);
      },
    };
  },
};
