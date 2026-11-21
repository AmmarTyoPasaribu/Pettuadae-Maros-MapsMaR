import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as tex from '../../core/textures.js';
import { pointInPoly } from '../colliders.js';
import { cumulative, pointAt, offsetPolyline, R_CLIP, SIDEWALK } from './osm.js';
import { createAtlases, drawStreetSign, signPlane } from './signs.js';
import { buildBuildings } from './buildings.js';
import { buildBPS, bpsFrame } from './bps.js';
import { buildElevation, elev, densify } from './elevation.js';
import { buildGround } from './ground.js';
import { createWaterMaterials } from './water.js';
import { buildProps } from './props.js';

const merge = (list) => (list.length ? mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g))) : null);
const mat4 = new THREE.Matrix4();
const surf = (x, z) => elev.surface(x, z);

// Strip along a polyline draped on the terrain. `off` shifts it sideways (positive = left of
// travel); `hy(x, z)` gives the surface height (default: ground / bridge deck), `dy` lifts it.
function ribbon(pts, width, dy, off = 0, uvScale = 5, hy = surf) {
  const n = pts.length;
  const cum = cumulative(pts);
  const pos = new Float32Array(n * 6);
  const uv = new Float32Array(n * 4);
  const idx = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0];
    let tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    let m = 1;
    if (i > 0 && i < n - 1) {
      const s1x = pts[i][0] - pts[i - 1][0], s1z = pts[i][1] - pts[i - 1][1];
      const l1 = Math.hypot(s1x, s1z) || 1;
      m = 1 / Math.max(0.55, (s1x / l1) * tx + (s1z / l1) * tz);
    }
    const lx = tz * m;
    const lz = -tx * m;
    const cx = pts[i][0] + lx * off;
    const cz = pts[i][1] + lz * off;
    const hw = width / 2;
    const x1 = cx + lx * hw, z1 = cz + lz * hw, x2 = cx - lx * hw, z2 = cz - lz * hw;
    pos.set([x1, hy(x1, z1) + dy, z1, x2, hy(x2, z2) + dy, z2], i * 6);
    uv.set([0, cum[i] / uvScale, width / uvScale, cum[i] / uvScale], i * 4);
    if (i < n - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Box from point A to point B (any slope), w wide and h tall, centred on the line.
const tmpO = new THREE.Object3D();
function beam(ax, ay, az, bx, by, bz, w, h) {
  const len = Math.hypot(bx - ax, by - ay, bz - az);
  const g = new THREE.BoxGeometry(w, h, len);
  tmpO.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  tmpO.lookAt(bx, by, bz);
  tmpO.updateMatrix();
  return g.applyMatrix4(tmpO.matrix);
}

export async function buildTerrain(scene, M, colliders, rnd, progress = async () => {}) {
  // ---------------- Elevation, BPS plot, terrain mesh ----------------
  await progress(0.1, 'Menghitung ketinggian tanah…');
  buildElevation(M);
  const frame = bpsFrame(M);
  let bpsBase = 0;
  if (frame) {
    const at = (lx, lz) => [frame.cx + lx * frame.ux + lz * frame.nx, frame.cz + lx * frame.uz + lz * frame.nz];
    bpsBase = elev.ground(...at(0, frame.hd + 9));
    elev.flatten(frame, bpsBase - 0.03, 7);
  }
  await progress(0.18, 'Membentuk permukaan tanah & sungai…');
  const ground = buildGround(scene, M);
  const landKind = (x, z) => {
    let kind = '';
    for (const l of M.landuse) if (pointInPoly(x, z, l.pts)) kind = l.kind;
    return kind;
  };

  // ---------------- Water ----------------
  const water = createWaterMaterials();
  const riverGeos = [];
  const drainGeos = [];
  for (const r of elev.rivers) {
    if (r.big) {
      // Water surface follows the river's own level (it drops slowly downstream).
      const wl = r.wl;
      const at = (x, z) => {
        let best = Infinity, y = wl[0];
        for (let i = 0; i < r.pts.length; i++) {
          const d = (r.pts[i][0] - x) ** 2 + (r.pts[i][1] - z) ** 2;
          if (d < best) { best = d; y = wl[i]; }
        }
        return y;
      };
      const g = ribbon(r.pts, r.hw * 2 + 7, 0, 0, 14, at);
      riverGeos.push(g);
    } else {
      drainGeos.push(ribbon(r.pts, Math.max(1.6, r.hw * 2), 0.05, 0, 6, (x, z) => elev.ground(x, z)));
    }
  }
  const addWater = (geos, mat) => {
    const g = merge(geos);
    if (!g) return;
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    m.renderOrder = 1;
    scene.add(m);
  };
  addWater(riverGeos, water.river);
  addWater(drainGeos, water.drain);
  const pondGeos = elev.ponds.map((p) => {
    const g = new THREE.ShapeGeometry(new THREE.Shape(p.wide.map((q) => new THREE.Vector2(q[0], -q[1]))));
    g.rotateX(-Math.PI / 2);
    g.translate(0, p.wl, 0);
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 14, pos.getZ(i) / 14);
    return g;
  });
  addWater(pondGeos, water.pond);
  const inWater = (x, z, margin = 0) => elev.waterAt(x, z) > elev.ground(x, z) - margin;

  await progress(0.3, 'Mengaspal jalan…');
  // ---------------- Roads ----------------
  // Widths come from OSM tags or imagery measurements (osm.js). Markings follow the width:
  // dashed lane divider on two-lane one-way carriageways, double centre line + lane lines on
  // wide two-way roads, a dashed centre on medium roads, edge lines on main roads.
  const asp = tex.asphalt({ repeat: 1 });
  const roadMat = new THREE.MeshStandardMaterial({ map: asp.map, normalMap: asp.normalMap, roughness: 0.88, normalScale: new THREE.Vector2(0.5, 0.5), side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  const roadGeos = [];
  const markGeos = [];
  const classY = { 5: 0.06, 4: 0.058, 3: 0.056, 2: 0.054, 1: 0.05 };
  const dashes = (pts, off, y, dash = 3, gap = 5, w = 0.15) => {
    const line = off ? offsetPolyline(pts, off) : pts;
    const cum = cumulative(line);
    const total = cum[cum.length - 1];
    for (let s = 2; s < total - dash - 1; s += dash + gap) {
      const a = pointAt(line, cum, s);
      const b = pointAt(line, cum, s + dash);
      markGeos.push(ribbon([[a.x, a.z], [b.x, b.z]], w, y));
    }
  };
  for (const r of M.roads) {
    if (r.type === 'path') continue;
    const pts = densify(r.pts, 4);
    const y = classY[r.rank] || 0.05;
    roadGeos.push(ribbon(pts, r.width, y));
    const my = y + 0.025;
    if (r.oneway) {
      if (r.width >= 6) dashes(pts, 0, my);
    } else if (r.rank >= 3 && r.width >= 11) {
      markGeos.push(ribbon(pts, 0.13, my, 0.12), ribbon(pts, 0.13, my, -0.12));
      dashes(pts, r.width / 4, my);
      dashes(pts, -r.width / 4, my);
    } else if (r.rank >= 3 && r.width >= 7) dashes(pts, 0, my, 3, 5, 0.16);
    if (r.rank >= 4) for (const side of [1, -1]) markGeos.push(ribbon(pts, 0.15, my, side * (r.width / 2 - 0.45)));
  }
  const roads = new THREE.Mesh(merge(roadGeos), roadMat);
  roads.receiveShadow = true;
  scene.add(roads);
  if (markGeos.length) {
    const marks = new THREE.Mesh(merge(markGeos), new THREE.MeshStandardMaterial({ color: 0xece9df, roughness: 0.7, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -4 }));
    marks.receiveShadow = true;
    scene.add(marks);
  }

  // ---------------- Sidewalks, kerbs and medians along main roads ----------------
  const KERB = 0.15;
  const walkGeos = [];
  const kerbGeos = [];
  const medianGeos = [];
  // Vertical strip (kerb face) along an offset polyline, from the road surface up to the kerb top.
  const kerbFace = (pts, off) => {
    const line = offsetPolyline(pts, off);
    const pos = [];
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, az] = line[i], [bx, bz] = line[i + 1];
      const ya = surf(ax, az), yb = surf(bx, bz);
      pos.push(ax, ya, az, bx, yb, bz, bx, yb + KERB, bz, ax, ya, az, bx, yb + KERB, bz, ax, ya + KERB, az);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
    g.computeVertexNormals();
    return g;
  };
  // Part of an edge between distances s0..s1 (keeps the edge's own vertices).
  const sub = (e, s0, s1) => {
    if (s1 - s0 < 2) return null;
    const out = [pointAt(e.pts, e.cum, s0)];
    for (let i = 0; i < e.pts.length; i++) if (e.cum[i] > s0 && e.cum[i] < s1) out.push({ x: e.pts[i][0], z: e.pts[i][1] });
    out.push(pointAt(e.pts, e.cum, s1));
    return densify(out.map((p) => [p.x, p.z]), 4);
  };
  // Stop sidewalks short of junctions so they do not cover crossing streets.
  const trim = (node, e) => {
    if (node.edges.length <= 2) return 0;
    let w = 0;
    for (const x of node.edges) if (x.edge !== e) w = Math.max(w, x.edge.width);
    return w / 2 + 2;
  };
  for (const e of M.edges) {
    if (e.rank < 4 || e.bridge) continue;
    const pts = sub(e, trim(e.a, e), e.len - trim(e.b, e));
    if (!pts) continue;
    for (const side of [1, -1]) {
      if (e.median && side === e.median.side) {
        // Half of the median between the two carriageways (the twin draws the other half).
        const hw = e.median.w / 2;
        medianGeos.push(ribbon(pts, hw, KERB, side * (e.width / 2 + hw / 2)));
        kerbGeos.push(kerbFace(pts, side * e.width / 2));
      } else {
        walkGeos.push(ribbon(pts, SIDEWALK, KERB, side * (e.width / 2 + SIDEWALK / 2), 2.5));
        kerbGeos.push(kerbFace(pts, side * e.width / 2));
        // Outer kerb face so raised sidewalks do not float over sloping ground.
        kerbGeos.push(kerbFace(pts, side * (e.width / 2 + SIDEWALK)));
      }
    }
  }
  const paving = tex.concrete({ repeat: 1, tiles: 4, base: '#9c948c', seed: 17 });
  const walkMesh = new THREE.Mesh(merge(walkGeos), new THREE.MeshStandardMaterial({ map: paving.map, normalMap: paving.normalMap, roughness: 0.9, side: THREE.DoubleSide }));
  walkMesh.receiveShadow = true;
  const kerbMesh = new THREE.Mesh(merge(kerbGeos), new THREE.MeshStandardMaterial({ color: 0xd4cfc4, roughness: 0.85, side: THREE.DoubleSide }));
  const grass = tex.grass({ repeat: 1 });
  grass.map.repeat.set(0.08, 0.08);
  grass.normalMap.repeat.set(0.08, 0.08);
  const medianMesh = new THREE.Mesh(merge(medianGeos), new THREE.MeshStandardMaterial({ map: grass.map, normalMap: grass.normalMap, color: 0x7fa25a, roughness: 1, side: THREE.DoubleSide }));
  medianMesh.receiveShadow = true;
  for (const m of [walkMesh, kerbMesh, medianMesh]) if (m.geometry) scene.add(m);

  // ---------------- Bridges: deck slab, parapets with railings, piers ----------------
  const bridgeGeos = [];
  const railGeos = [];
  for (const b of elev.bridges) {
    const { pts, ys } = b;
    const hw = b.width / 2;
    let ymin = Infinity, ymax = -Infinity;
    for (const y of ys) { ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); }
    // Slab under the road surface.
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      bridgeGeos.push(beam(ax, ys[i] - 0.45, az, bx, ys[i + 1] - 0.45, bz, b.width + 0.9, 0.9));
    }
    // Parapet + railing on each side.
    for (const side of [1, -1]) {
      const line = offsetPolyline(pts, side * (hw + 0.25));
      const yl = line.map(([x, z], i) => ys[i]);
      for (let i = 0; i < line.length - 1; i++) {
        const [ax, az] = line[i], [bx, bz] = line[i + 1];
        if (Math.hypot(bx - ax, bz - az) < 0.2) continue;
        railGeos.push(beam(ax, yl[i] + 0.25, az, bx, yl[i + 1] + 0.25, bz, 0.3, 0.5));
        railGeos.push(beam(ax, yl[i] + 1.05, az, bx, yl[i + 1] + 1.05, bz, 0.12, 0.1));
        railGeos.push(new THREE.BoxGeometry(0.1, 0.55, 0.1).translate(ax, yl[i] + 0.75, az));
        colliders.addSegment(ax, az, bx, bz, ymax + 1.6, ymin - 1.2);
      }
    }
    // Piers down to the river bed.
    for (let s = 8; s < b.len - 4; s += 14) {
      const p = pointAt(pts, b.cum, s);
      const y = ys[p.i] + (ys[p.i + 1] - ys[p.i]) * ((s - b.cum[p.i]) / (b.cum[p.i + 1] - b.cum[p.i] || 1));
      const g = elev.ground(p.x, p.z);
      if (y - g < 2.5) continue;
      const ang = Math.atan2(p.dx, p.dz);
      bridgeGeos.push(new THREE.BoxGeometry(b.width * 0.8, y - 0.9 - g + 1, 1.0).rotateY(ang).translate(p.x, (y - 0.9 + g - 1) / 2, p.z));
    }
  }
  if (bridgeGeos.length) {
    const concrete = tex.concrete({ repeat: 1, base: '#a8a49b', seed: 23 });
    const bm = new THREE.Mesh(merge(bridgeGeos), new THREE.MeshStandardMaterial({ map: concrete.map, color: 0xd8d4cc, roughness: 0.85 }));
    bm.castShadow = bm.receiveShadow = true;
    scene.add(bm);
    const rails = new THREE.Mesh(merge(railGeos), new THREE.MeshStandardMaterial({ color: 0xc9c5bb, roughness: 0.7 }));
    rails.castShadow = rails.receiveShadow = true;
    scene.add(rails);
  }

  // ---------------- Green street-name signs at junctions ----------------
  const streetNames = [...new Set(M.edges.filter((e) => e.name).map((e) => e.name))];
  const streetAtlas = createAtlases(streetNames, { cellW: 512, cellH: 64, size: 1024, draw: drawStreetSign });
  const slotOf = new Map(streetNames.map((n, i) => [n, streetAtlas.slots[i]]));
  const streetSignGeos = {};
  const poleGeos = [];
  const top = (x, z) => surf(x, z) + M.roadIndex.curbAt(x, z);
  for (const node of M.nodes) {
    if (node.edges.length < 3) continue;
    const seen = new Set();
    for (const { edge, dir } of node.edges) {
      if (!edge.name || seen.has(edge.name) || seen.size >= 2) continue;
      seen.add(edge.name);
      const pts = dir > 0 ? edge.pts : [...edge.pts].reverse();
      const cum = cumulative(pts);
      const p = pointAt(pts, cum, Math.min(cum[cum.length - 1] * 0.5, edge.width / 2 + 3));
      const off = edge.width / 2 + 1.1;
      const x = p.x + p.dz * off;
      const z = p.z - p.dx * off;
      if (colliders.containsPoint(x, z) || inWater(x, z, 0.3)) continue;
      const y = top(x, z);
      const ry = Math.atan2(p.dx, p.dz) + Math.PI / 2;
      const slot = slotOf.get(edge.name);
      poleGeos.push(new THREE.CylinderGeometry(0.04, 0.05, 3.2, 6).translate(x, y + 1.3, z));
      for (const flip of [0, Math.PI]) {
        (streetSignGeos[slot.atlas] ||= []).push(signPlane(1.6, 0.2, slot.uv, ry + flip, x + Math.sin(ry + flip) * 0.02, y + 2.75, z + Math.cos(ry + flip) * 0.02));
      }
      colliders.addCircle(x, z, 0.12);
    }
  }
  if (poleGeos.length) scene.add(new THREE.Mesh(merge(poleGeos), new THREE.MeshStandardMaterial({ color: 0x8d9299, metalness: 0.6, roughness: 0.4 })));
  for (const [ai, list] of Object.entries(streetSignGeos)) scene.add(new THREE.Mesh(merge(list), streetAtlas.materials[ai]));

  // ---------------- Buildings ----------------
  await progress(0.42, 'Membangun rumah, ruko & toko…');
  const buildings = buildBuildings(scene, M, colliders, rnd);
  await progress(0.55, 'Membangun kantor BPS Kabupaten Maros…');
  const bps = buildBPS(scene, M, colliders, bpsBase);
  const onSite = (x, z) => !!bps && bps.contains(x, z);

  await progress(0.6, 'Menanam pepohonan…');
  // ---------------- Trees (positions from satellite vegetation) ----------------
  const treeDefs = [];
  for (const [x, z, s] of M.trees) {
    const px = x + (rnd() - 0.5) * 5;
    const pz = z + (rnd() - 0.5) * 5;
    if (Math.hypot(px, pz) > R_CLIP - 12) continue;
    if (colliders.containsPoint(px, pz) || onSite(px, pz) || M.roadIndex.near(px, pz, 1.8) || inWater(px, pz, 0.4)) continue;
    const kind = landKind(px, pz);
    if (kind === 'farmland' && rnd() < 0.85) continue;
    treeDefs.push({ x: px, z: pz, y: elev.ground(px, pz), s: Math.min(1.7, s * (0.85 + rnd() * 0.3)), palm: rnd() < 0.2, banana: rnd() < 0.12 });
  }
  // Coconut palm crown: drooping fronds merged into one geometry.
  const frondGeo = (() => {
    const parts = [];
    for (let k = 0; k < 9; k++) {
      const g = new THREE.PlaneGeometry(0.55, 3.2, 1, 2).rotateX(-Math.PI / 2);
      // Droop: bend the outer half of the frond down.
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) if (pos.getZ(i) < -0.5) pos.setY(i, pos.getY(i) - 0.9);
      g.translate(0, 0, -1.6);
      g.rotateX(-0.25 - (k % 2) * 0.2);
      g.rotateY((k / 9) * Math.PI * 2);
      parts.push(g);
    }
    parts.push(new THREE.SphereGeometry(0.32, 6, 4));
    return merge(parts);
  })();
  const TCH = 320;
  const treeChunks = new Map();
  for (const t of treeDefs) {
    const k = `${Math.floor(t.x / TCH)},${Math.floor(t.z / TCH)}`;
    if (!treeChunks.has(k)) treeChunks.set(k, []);
    treeChunks.get(k).push(t);
  }
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 3.6, 5, 1, true).translate(0, 1.4, 0);
  const palmTrunkGeo = new THREE.CylinderGeometry(0.13, 0.2, 8.6, 5, 1, true).translate(0, 3.7, 0);
  // Rounder crowns close by, the cheap 20-triangle version further away.
  const crownGeo = new THREE.IcosahedronGeometry(1, 0);
  const crownHi = new THREE.IcosahedronGeometry(1, 1);
  const treeLod = [];
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3423, roughness: 1 });
  const palmTrunkMat = new THREE.MeshStandardMaterial({ color: 0x7a6650, roughness: 1 });
  const crownMat = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true });
  const frondMat = new THREE.MeshStandardMaterial({ color: 0x5f8f3a, roughness: 0.9, side: THREE.DoubleSide });
  // Leaves sway in the wind (vertex shader), stronger at the tips and during rain.
  const windU = { uTime: { value: 0 }, uWind: { value: 0.35 } };
  const sway = (amt) => (sh) => {
    sh.uniforms.uTime = windU.uTime;
    sh.uniforms.uWind = windU.uWind;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
        vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float ph = ip.x * 0.13 + ip.z * 0.17;
        float k = uWind * ${amt.toFixed(2)} * (0.4 + max(position.y, 0.0) * 0.4);
        transformed.x += sin(uTime * 1.7 + ph) * k * 0.12 + sin(uTime * 4.1 + ph * 2.0) * k * 0.03;
        transformed.z += cos(uTime * 1.3 + ph) * k * 0.09;
        #endif`,
      );
  };
  crownMat.onBeforeCompile = sway(1);
  frondMat.onBeforeCompile = sway(1.4);
  crownMat.customProgramCacheKey = () => 'sway-crown';
  frondMat.customProgramCacheKey = () => 'sway-frond';
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const col = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  for (const list of treeChunks.values()) {
    const broad = list.filter((t) => !t.palm);
    const palms = list.filter((t) => t.palm);
    const mk = (geo, mat, n) => {
      const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
      m.count = n;
      m.castShadow = true;
      m.receiveShadow = true;
      scene.add(m);
      return m;
    };
    const trunks = mk(trunkGeo, trunkMat, broad.length);
    const crowns = mk(crownGeo, crownMat, broad.length);
    broad.forEach((t, k) => {
      trunks.setMatrixAt(k, mat4.compose(pos.set(t.x, t.y, t.z), q.identity(), sc.set(t.s, t.s, t.s)));
      q.setFromAxisAngle(up, rnd() * 6);
      crowns.setMatrixAt(k, mat4.compose(pos.set(t.x, t.y + 4.6 * t.s, t.z), q, sc.set(2.6 * t.s, 2.3 * t.s, 2.6 * t.s)));
      crowns.setColorAt(k, col.setHSL(0.22 + rnd() * 0.1, 0.45 + rnd() * 0.25, 0.2 + rnd() * 0.1));
    });
    const ptr = mk(palmTrunkGeo, palmTrunkMat, palms.length);
    const pcr = mk(frondGeo, frondMat, palms.length);
    palms.forEach((t, k) => {
      const lean = new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.25, 0, (rnd() - 0.5) * 0.25));
      ptr.setMatrixAt(k, mat4.compose(pos.set(t.x, t.y, t.z), lean, sc.set(1, t.s, 1)));
      const tip = new THREE.Vector3(0, 8 * t.s, 0).applyQuaternion(lean);
      q.setFromAxisAngle(up, rnd() * 6);
      pcr.setMatrixAt(k, mat4.compose(pos.set(t.x + tip.x, t.y + tip.y, t.z + tip.z), q, sc.set(1, 1, 1)));
    });
    for (const m of [trunks, crowns, ptr, pcr]) m.computeBoundingSphere();
    let cx = 0, cz = 0;
    for (const t of list) { cx += t.x; cz += t.z; }
    treeLod.push({ crowns, all: [trunks, crowns, ptr, pcr], cx: cx / list.length, cz: cz / list.length, hi: false, on: true });
  }
  for (const t of treeDefs) colliders.addCircle(t.x, t.z, t.palm ? 0.3 : 0.4);

  await progress(0.68, 'Memasang tiang listrik & lampu jalan…');
  // ---------------- Power poles and overhead wires along local streets ----------------
  const poleDefs = [];
  const wirePts = [];
  for (const e of M.edges) {
    if (e.rank > 3 || e.len < 40 || e.bridge) continue;
    const side = e.id % 2 ? 1 : -1;
    let prev = null;
    for (let s = 6; s < e.len - 4; s += 34) {
      const p = pointAt(e.pts, e.cum, s);
      const off = side * (e.width / 2 + 0.7);
      const x = p.x + p.dz * off;
      const z = p.z - p.dx * off;
      if (colliders.containsPoint(x, z) || onSite(x, z) || inWater(x, z, 0.3)) { prev = null; continue; }
      const y = elev.ground(x, z);
      poleDefs.push({ x, y, z, ang: Math.atan2(p.dx, p.dz) });
      if (prev) for (const [dy, dl] of [[7.9, -0.55], [7.9, 0.55], [7.2, 0]]) {
        const cx = Math.cos(prev.ang), cz = -Math.sin(prev.ang);
        const cx2 = Math.cos(Math.atan2(p.dx, p.dz)), cz2 = -Math.sin(Math.atan2(p.dx, p.dz));
        // Wires sag between poles.
        const ax = prev.x + cx * dl, ay = prev.y + dy, az = prev.z + cz * dl;
        const bx = x + cx2 * dl, by = y + dy, bz = z + cz2 * dl;
        let lx = ax, ly = ay, lz = az;
        for (let k = 1; k <= 4; k++) {
          const t = k / 4;
          const nx2 = ax + (bx - ax) * t, ny2 = ay + (by - ay) * t - Math.sin(Math.PI * t) * 0.45, nz2 = az + (bz - az) * t;
          wirePts.push(lx, ly, lz, nx2, ny2, nz2);
          lx = nx2; ly = ny2; lz = nz2;
        }
      }
      prev = { x, y, z, ang: Math.atan2(p.dx, p.dz) };
    }
  }
  if (poleDefs.length) {
    const poleMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.11, 0.16, 8.9, 6).translate(0, 3.95, 0), new THREE.MeshStandardMaterial({ color: 0x9a9893, roughness: 0.9 }), poleDefs.length);
    const armMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 0.1, 0.1).translate(0, 7.95, 0), new THREE.MeshStandardMaterial({ color: 0x6b6b6b, roughness: 0.8 }), poleDefs.length);
    poleDefs.forEach((p, k) => {
      q.setFromAxisAngle(up, p.ang);
      poleMesh.setMatrixAt(k, mat4.compose(pos.set(p.x, p.y, p.z), q, sc.set(1, 1, 1)));
      armMesh.setMatrixAt(k, mat4.compose(pos.set(p.x, p.y, p.z), q, sc.set(1, 1, 1)));
      colliders.addCircle(p.x, p.z, 0.2);
    });
    for (const m of [poleMesh, armMesh]) {
      m.castShadow = true;
      m.computeBoundingSphere();
      scene.add(m);
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wirePts, 3));
    scene.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x1c1c1c, transparent: true, opacity: 0.75 })));
  }

  // ---------------- Street lamps on the bigger roads ----------------
  const lampDefs = [];
  for (const e of M.edges) {
    if (e.rank < 3) continue;
    let side = 1;
    for (let s = 12; s < e.len - 8; s += 38) {
      const p = pointAt(e.pts, e.cum, s);
      const off = side * (e.width / 2 + (e.rank >= 4 ? SIDEWALK - 0.4 : 1.1));
      const x = p.x + p.dz * off;
      const z = p.z - p.dx * off;
      side = -side;
      if (colliders.containsPoint(x, z) || onSite(x, z) || inWater(x, z, 0.3)) continue;
      lampDefs.push({ x, z, y: e.bridge ? surf(p.x, p.z) : top(x, z), dx: p.dx, dz: p.dz, off });
    }
  }
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.8, roughness: 0.35 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff0c8, emissive: 0xffd28a, emissiveIntensity: 0.1 });
  const L = Math.max(1, lampDefs.length);
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.11, 7.4, 8), poleMat, L);
  const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.12, 0.42), lampMat, L);
  const lamps = [];
  lampDefs.forEach((l, k) => {
    // Head leans toward the road centre line.
    const toX = -Math.sign(l.off) * l.dz;
    const toZ = Math.sign(l.off) * l.dx;
    const ang = Math.atan2(-toZ, toX);
    poles.setMatrixAt(k, mat4.compose(pos.set(l.x, l.y + 3.3, l.z), q.identity(), sc.set(1, 1, 1)));
    q.setFromAxisAngle(up, ang);
    heads.setMatrixAt(k, mat4.compose(pos.set(l.x + toX * 0.9, l.y + 6.95, l.z + toZ * 0.9), q, sc.set(1, 1, 1)));
    lamps.push({ x: l.x + toX * 0.9, y: l.y + 6.4, z: l.z + toZ * 0.9 });
    colliders.addCircle(l.x, l.z, 0.22);
  });
  poles.count = heads.count = lampDefs.length;
  for (const m of [poles, heads]) {
    m.frustumCulled = false;
    m.castShadow = m === poles;
    scene.add(m);
  }

  await progress(0.74, 'Menambahkan pagar, toren, gapura & detail kampung…');
  // ---------------- Small details: fences, water tanks, gapura, speed bumps, carts ----------------
  const props = buildProps(scene, M, colliders, rnd, { onSite, inWater, top, details: buildings.details, kiosks: buildings.kioskInfo });

  // ---------------- Distant hills ----------------
  const hillGeo = new THREE.SphereGeometry(1, 18, 10);
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x5f7d48, roughness: 1, flatShading: true });
  for (let k = 0; k < 34; k++) {
    const a = (k / 34) * Math.PI * 2 + rnd() * 0.2;
    const r = 1900 + rnd() * 700;
    const h = new THREE.Mesh(hillGeo, hillMat);
    const s = 180 + rnd() * 260;
    h.scale.set(s, s * (0.2 + rnd() * 0.25), s);
    h.position.set(Math.cos(a) * r, elev.edge - s * 0.06, Math.sin(a) * r);
    scene.add(h);
  }

  // ---------------- Lamp light pool ----------------
  const lampLights = Array.from({ length: 4 }, () => {
    const l = new THREE.PointLight(0xffc680, 0, 40, 1.6);
    l.userData.dynamic = true;
    scene.add(l);
    return l;
  });
  let lampT = 0;
  let lodT = 0;

  return {
    colliders,
    lamps,
    treeCount: treeDefs.length,
    buildingCounts: buildings.counts,
    shops: { onBuildings: buildings.shopsOnBuildings, kiosks: buildings.kiosks },
    kiosks: buildings.kioskInfo,
    bps,
    landmarks: buildings.landmarks,
    water,
    props,
    wind: windU,
    update(night, t, dt, fx, fz, cam, weather = {}) {
      buildings.update(night);
      // Wet asphalt after rain: darker and shinier.
      const wet = weather.wet || 0;
      roadMat.roughness = 0.88 - wet * 0.55;
      roadMat.color.setScalar(1 - wet * 0.35);
      walkMesh.material.color.setScalar(1 - wet * 0.25);
      ground.update(cam ? cam.x : fx, cam ? cam.z : fz);
      water.update(t, weather.rain || 0);
      windU.uTime.value = t;
      windU.uWind.value = 0.35 + (weather.rain || 0) * 0.9;
      props.update?.(t, dt, fx, fz);
      // Tree crown detail by distance (checked a few times per second).
      lodT -= dt;
      if (lodT <= 0) {
        lodT = 0.4;
        const px = cam ? cam.x : fx, pz = cam ? cam.z : fz;
        for (const c of treeLod) {
          const d = Math.hypot(c.cx - px, c.cz - pz);
          const hi = d < 260;
          if (hi !== c.hi) {
            c.hi = hi;
            c.crowns.geometry = hi ? crownHi : crownGeo;
          }
          // Distant trees disappear into the haze anyway.
          const on = d < 820;
          if (on !== c.on) {
            c.on = on;
            for (const m of c.all) m.visible = on;
          }
        }
      }
      for (const m of streetAtlas.materials) m.emissiveIntensity = night * 0.35;
      bps?.update(dt, fx, fz);
      lampMat.emissiveIntensity = 0.1 + night * 5;
      lampT -= dt;
      if (lampT <= 0) {
        lampT = 0.35;
        const best = [];
        for (let k = 0; k < lamps.length; k++) {
          const dx = lamps[k].x - fx;
          const dz = lamps[k].z - fz;
          const d2 = dx * dx + dz * dz;
          if (best.length < 4 || d2 < best[best.length - 1][0]) {
            best.push([d2, k]);
            best.sort((a, b) => a[0] - b[0]);
            if (best.length > 4) best.pop();
          }
        }
        best.forEach(([, k], n) => lampLights[n].position.set(lamps[k].x, lamps[k].y, lamps[k].z));
      }
      for (const l of lampLights) l.intensity = night * 70;
    },
  };
}
