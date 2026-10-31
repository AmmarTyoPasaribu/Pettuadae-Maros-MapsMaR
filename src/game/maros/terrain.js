import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as tex from '../../core/textures.js';
import { pointInPoly, closestOnSegment } from '../colliders.js';
import { cumulative, pointAt, offsetPolyline, R_CLIP, SIDEWALK } from './osm.js';
import { createAtlases, drawStreetSign, signPlane } from './signs.js';
import { buildBuildings } from './buildings.js';
import { buildBPS } from './bps.js';

const merge = (list) => (list.length ? mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g))) : null);
const mat4 = new THREE.Matrix4();

// Flat strip along a polyline. `off` shifts it sideways (positive = left of travel).
function ribbon(pts, width, y, off = 0, uvScale = 5) {
  const n = pts.length;
  const cum = cumulative(pts);
  const pos = new Float32Array(n * 6);
  const nor = new Float32Array(n * 6);
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
    pos.set([cx + lx * hw, y, cz + lz * hw, cx - lx * hw, y, cz - lz * hw], i * 6);
    nor.set([0, 1, 0, 0, 1, 0], i * 6);
    uv.set([0, cum[i] / uvScale, width / uvScale, cum[i] / uvScale], i * 4);
    if (i < n - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function shapeGeo(pts, y) {
  const g = new THREE.ShapeGeometry(new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0], -p[1]))));
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

export function buildTerrain(scene, M, colliders, rnd) {
  // ---------------- Ground ----------------
  const dirt = tex.soil();
  dirt.map.repeat.set(380, 380);
  dirt.normalMap.repeat.set(380, 380);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ map: dirt.map, normalMap: dirt.normalMap, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Land use areas (rice fields, parks, forest...).
  const grass = tex.grass({ repeat: 1 });
  grass.map.repeat.set(0.08, 0.08);
  grass.normalMap.repeat.set(0.08, 0.08);
  const LU = {
    farmland: { color: 0x9bbf5a, y: -0.14 },
    meadow: { color: 0x9aac66, y: -0.13 },
    open_field_space: { color: 0xa9a676, y: -0.13 },
    forest: { color: 0x58803f, y: -0.12 },
    park: { color: 0x6fae48, y: -0.11 },
    industrial: { color: 0x9a9892, y: -0.1 },
    commercial: { color: 0xa7a59f, y: -0.1 },
  };
  const luMats = {};
  const luGeos = {};
  const luPolys = [];
  for (const l of M.landuse) {
    const def = LU[l.kind];
    if (!def) continue;
    (luGeos[l.kind] ||= []).push(shapeGeo(l.pts, def.y));
    luPolys.push({ kind: l.kind, pts: l.pts });
  }
  for (const [kind, geos] of Object.entries(luGeos)) {
    luMats[kind] = new THREE.MeshStandardMaterial({ map: grass.map, normalMap: grass.normalMap, color: LU[kind].color, roughness: 1, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(merge(geos), luMats[kind]);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  const landAt = (x, z) => {
    let kind = '';
    for (const p of luPolys) if (pointInPoly(x, z, p.pts)) kind = p.kind;
    return kind;
  };

  // ---------------- Water ----------------
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x1f4a48, roughness: 0.3, metalness: 0.15, envMapIntensity: 0.6, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const waterGeos = M.water.map((w) => shapeGeo(w.pts, -0.07));
  for (const r of M.rivers) waterGeos.push(ribbon(r.pts, r.width, -0.06));
  if (waterGeos.length) {
    const w = new THREE.Mesh(merge(waterGeos), waterMat);
    w.receiveShadow = true;
    scene.add(w);
  }
  // Invisible walls on both banks of wide rivers, with gaps where bridges cross.
  const bridges = M.roads.filter((r) => r.bridge);
  const nearBridge = (x, z) => bridges.some((b) => b.pts.some((p, i) => i < b.pts.length - 1 && closestOnSegment(x, z, p[0], p[1], b.pts[i + 1][0], b.pts[i + 1][1])[0] < 9));
  for (const r of M.rivers) {
    if (r.width < 12) continue;
    for (const side of [1, -1]) {
      const bank = offsetPolyline(r.pts, side * (r.width / 2 - 0.5));
      for (let i = 0; i < bank.length - 1; i++) {
        const mx = (bank[i][0] + bank[i + 1][0]) / 2;
        const mz = (bank[i][1] + bank[i + 1][1]) / 2;
        if (nearBridge(mx, mz)) continue;
        colliders.addSegment(bank[i][0], bank[i][1], bank[i + 1][0], bank[i + 1][1], 3);
      }
    }
  }
  const inRiver = (x, z) => {
    for (const r of M.rivers) for (let i = 0; i < r.pts.length - 1; i++) if (closestOnSegment(x, z, r.pts[i][0], r.pts[i][1], r.pts[i + 1][0], r.pts[i + 1][1])[0] < r.width / 2 + 2) return true;
    return false;
  };

  // ---------------- Roads ----------------
  // Widths come from OSM tags or imagery measurements (osm.js). Markings follow the width:
  // dashed lane divider on two-lane one-way carriageways, double centre line + lane lines on
  // wide two-way roads, a dashed centre on medium roads, edge lines on main roads.
  const asp = tex.asphalt({ repeat: 1 });
  const roadMat = new THREE.MeshStandardMaterial({ map: asp.map, normalMap: asp.normalMap, roughness: 0.88, normalScale: new THREE.Vector2(0.5, 0.5), side: THREE.DoubleSide });
  const roadGeos = [];
  const markGeos = [];
  const classY = { 5: 0.012, 4: 0.01, 3: 0.008, 2: 0.006, 1: 0.003 };
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
    const y = (classY[r.rank] || 0.004) + (r.bridge ? 0.02 : 0);
    roadGeos.push(ribbon(r.pts, r.width, y));
    const my = y + 0.03;
    if (r.oneway) {
      if (r.width >= 6) dashes(r.pts, 0, my);
    } else if (r.rank >= 3 && r.width >= 11) {
      markGeos.push(ribbon(r.pts, 0.13, my, 0.12), ribbon(r.pts, 0.13, my, -0.12));
      dashes(r.pts, r.width / 4, my);
      dashes(r.pts, -r.width / 4, my);
    } else if (r.rank >= 3 && r.width >= 7) dashes(r.pts, 0, my, 3, 5, 0.16);
    if (r.rank >= 4) for (const side of [1, -1]) markGeos.push(ribbon(r.pts, 0.15, my, side * (r.width / 2 - 0.45)));
  }
  const roads = new THREE.Mesh(merge(roadGeos), roadMat);
  roads.receiveShadow = true;
  scene.add(roads);
  if (markGeos.length) {
    const marks = new THREE.Mesh(merge(markGeos), new THREE.MeshStandardMaterial({ color: 0xece9df, roughness: 0.7, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    marks.receiveShadow = true;
    scene.add(marks);
  }

  // ---------------- Sidewalks, kerbs and medians along main roads ----------------
  const KERB = 0.15;
  const walkGeos = [];
  const kerbGeos = [];
  const medianGeos = [];
  // Vertical strip (kerb face) along an offset polyline.
  const kerbFace = (pts, off) => {
    const line = offsetPolyline(pts, off);
    const pos = [];
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, az] = line[i], [bx, bz] = line[i + 1];
      pos.push(ax, 0, az, bx, 0, bz, bx, KERB, bz, ax, 0, az, bx, KERB, bz, ax, KERB, az);
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
    return out.map((p) => [p.x, p.z]);
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
      }
    }
  }
  const paving = tex.concrete({ repeat: 1, tiles: 4, base: '#9c948c', seed: 17 });
  const walkMesh = new THREE.Mesh(merge(walkGeos), new THREE.MeshStandardMaterial({ map: paving.map, normalMap: paving.normalMap, roughness: 0.9, side: THREE.DoubleSide }));
  walkMesh.receiveShadow = true;
  const kerbMesh = new THREE.Mesh(merge(kerbGeos), new THREE.MeshStandardMaterial({ color: 0xd4cfc4, roughness: 0.85, side: THREE.DoubleSide }));
  const medianMesh = new THREE.Mesh(merge(medianGeos), new THREE.MeshStandardMaterial({ map: grass.map, normalMap: grass.normalMap, color: 0x7fa25a, roughness: 1, side: THREE.DoubleSide }));
  medianMesh.receiveShadow = true;
  for (const m of [walkMesh, kerbMesh, medianMesh]) if (m.geometry) scene.add(m);

  // ---------------- Bridge railings (and walls so cars stay on the bridge) ----------------
  const railGeos = [];
  for (const r of M.roads) {
    if (!r.bridge) continue;
    for (const side of [1, -1]) {
      const line = offsetPolyline(r.pts, side * (r.width / 2 + 0.2));
      for (let i = 0; i < line.length - 1; i++) {
        const [ax, az] = line[i], [bx, bz] = line[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.3) continue;
        const ry = Math.atan2(bx - ax, bz - az);
        railGeos.push(new THREE.BoxGeometry(0.25, 0.35, len).rotateY(ry).translate((ax + bx) / 2, 0.2, (az + bz) / 2));
        railGeos.push(new THREE.BoxGeometry(0.12, 0.12, len).rotateY(ry).translate((ax + bx) / 2, 1.0, (az + bz) / 2));
        for (let s = 0; s < len; s += 2) {
          const t = s / len;
          railGeos.push(new THREE.BoxGeometry(0.1, 0.65, 0.1).translate(ax + (bx - ax) * t, 0.68, az + (bz - az) * t));
        }
        colliders.addSegment(ax, az, bx, bz, 3);
      }
    }
  }
  if (railGeos.length) {
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
      if (colliders.containsPoint(x, z)) continue;
      const ry = Math.atan2(p.dx, p.dz) + Math.PI / 2;
      const slot = slotOf.get(edge.name);
      poleGeos.push(new THREE.CylinderGeometry(0.04, 0.05, 2.9, 6).translate(x, 1.45, z));
      for (const flip of [0, Math.PI]) {
        (streetSignGeos[slot.atlas] ||= []).push(signPlane(1.6, 0.2, slot.uv, ry + flip, x + Math.sin(ry + flip) * 0.02, 2.75, z + Math.cos(ry + flip) * 0.02));
      }
      colliders.addCircle(x, z, 0.12);
    }
  }
  if (poleGeos.length) scene.add(new THREE.Mesh(merge(poleGeos), new THREE.MeshStandardMaterial({ color: 0x8d9299, metalness: 0.6, roughness: 0.4 })));
  for (const [ai, list] of Object.entries(streetSignGeos)) scene.add(new THREE.Mesh(merge(list), streetAtlas.materials[ai]));

  // ---------------- Buildings ----------------
  const buildings = buildBuildings(scene, M, colliders, rnd);
  const bps = buildBPS(scene, M, colliders);
  const onSite = (x, z) => !!bps && bps.contains(x, z);

  // ---------------- Trees (positions from satellite vegetation) ----------------
  const treeDefs = [];
  for (const [x, z, s] of M.trees) {
    const px = x + (rnd() - 0.5) * 5;
    const pz = z + (rnd() - 0.5) * 5;
    if (Math.hypot(px, pz) > R_CLIP - 12) continue;
    if (colliders.containsPoint(px, pz) || onSite(px, pz) || M.roadIndex.near(px, pz, 1.8) || inRiver(px, pz)) continue;
    const kind = landAt(px, pz);
    if (kind === 'farmland' && rnd() < 0.85) continue;
    treeDefs.push({ x: px, z: pz, s: Math.min(1.7, s * (0.85 + rnd() * 0.3)), palm: rnd() < 0.2 });
  }
  // Coconut palm crown: drooping fronds merged into one geometry.
  const frondGeo = (() => {
    const parts = [];
    for (let k = 0; k < 8; k++) {
      const g = new THREE.BoxGeometry(0.5, 0.05, 3.2);
      g.translate(0, 0, 1.6);
      g.rotateX(0.45 + (k % 2) * 0.2);
      g.rotateY((k / 8) * Math.PI * 2);
      parts.push(g);
    }
    parts.push(new THREE.SphereGeometry(0.35, 8, 6));
    return merge(parts);
  })();
  const TCH = 450;
  const treeChunks = new Map();
  for (const t of treeDefs) {
    const k = `${Math.floor(t.x / TCH)},${Math.floor(t.z / TCH)}`;
    if (!treeChunks.has(k)) treeChunks.set(k, []);
    treeChunks.get(k).push(t);
  }
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 3.2, 6);
  const palmTrunkGeo = new THREE.CylinderGeometry(0.13, 0.2, 8, 6).translate(0, 4, 0);
  const crownGeo = new THREE.IcosahedronGeometry(1, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3423, roughness: 1 });
  const palmTrunkMat = new THREE.MeshStandardMaterial({ color: 0x7a6650, roughness: 1 });
  const crownMat = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true });
  const frondMat = new THREE.MeshStandardMaterial({ color: 0x5f8f3a, roughness: 0.9, side: THREE.DoubleSide });
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
      trunks.setMatrixAt(k, mat4.compose(pos.set(t.x, 1.6 * t.s, t.z), q.identity(), sc.set(t.s, t.s, t.s)));
      q.setFromAxisAngle(up, rnd() * 6);
      crowns.setMatrixAt(k, mat4.compose(pos.set(t.x, 4.6 * t.s, t.z), q, sc.set(2.6 * t.s, 2.3 * t.s, 2.6 * t.s)));
      crowns.setColorAt(k, col.setHSL(0.22 + rnd() * 0.1, 0.45 + rnd() * 0.25, 0.2 + rnd() * 0.1));
    });
    const ptr = mk(palmTrunkGeo, palmTrunkMat, palms.length);
    const pcr = mk(frondGeo, frondMat, palms.length);
    palms.forEach((t, k) => {
      const lean = new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.25, 0, (rnd() - 0.5) * 0.25));
      ptr.setMatrixAt(k, mat4.compose(pos.set(t.x, 0, t.z), lean, sc.set(1, t.s, 1)));
      const top = new THREE.Vector3(0, 8 * t.s, 0).applyQuaternion(lean);
      q.setFromAxisAngle(up, rnd() * 6);
      pcr.setMatrixAt(k, mat4.compose(pos.set(t.x + top.x, top.y, t.z + top.z), q, sc.set(1, 1, 1)));
    });
    for (const m of [trunks, crowns, ptr, pcr]) m.computeBoundingSphere();
  }
  for (const t of treeDefs) colliders.addCircle(t.x, t.z, t.palm ? 0.3 : 0.4);

  // ---------------- Power poles and overhead wires along local streets ----------------
  const poleDefs = [];
  const wirePts = [];
  for (const e of M.edges) {
    if (e.rank > 3 || e.len < 40) continue;
    const side = e.id % 2 ? 1 : -1;
    let prev = null;
    for (let s = 6; s < e.len - 4; s += 34) {
      const p = pointAt(e.pts, e.cum, s);
      const off = side * (e.width / 2 + 0.7);
      const x = p.x + p.dz * off;
      const z = p.z - p.dx * off;
      if (colliders.containsPoint(x, z) || onSite(x, z)) { prev = null; continue; }
      poleDefs.push({ x, z, ang: Math.atan2(p.dx, p.dz) });
      if (prev) for (const [dy, dl] of [[7.9, -0.55], [7.9, 0.55], [7.2, 0]]) {
        const cx = Math.cos(prev.ang), cz = -Math.sin(prev.ang);
        const cx2 = Math.cos(Math.atan2(p.dx, p.dz)), cz2 = -Math.sin(Math.atan2(p.dx, p.dz));
        wirePts.push(prev.x + cx * dl, dy, prev.z + cz * dl, x + cx2 * dl, dy, z + cz2 * dl);
      }
      prev = { x, z, ang: Math.atan2(p.dx, p.dz) };
    }
  }
  if (poleDefs.length) {
    const poleMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.11, 0.16, 8.4, 6).translate(0, 4.2, 0), new THREE.MeshStandardMaterial({ color: 0x9a9893, roughness: 0.9 }), poleDefs.length);
    const armMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 0.1, 0.1).translate(0, 7.95, 0), new THREE.MeshStandardMaterial({ color: 0x6b6b6b, roughness: 0.8 }), poleDefs.length);
    poleDefs.forEach((p, k) => {
      q.setFromAxisAngle(up, p.ang);
      poleMesh.setMatrixAt(k, mat4.compose(pos.set(p.x, 0, p.z), q, sc.set(1, 1, 1)));
      armMesh.setMatrixAt(k, mat4.compose(pos.set(p.x, 0, p.z), q, sc.set(1, 1, 1)));
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
      if (colliders.containsPoint(x, z) || onSite(x, z)) continue;
      lampDefs.push({ x, z, dx: p.dx, dz: p.dz, off });
    }
  }
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.8, roughness: 0.35 });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff0c8, emissive: 0xffd28a, emissiveIntensity: 0.1 });
  const L = Math.max(1, lampDefs.length);
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.11, 7, 8), poleMat, L);
  const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.12, 0.42), lampMat, L);
  const lamps = [];
  lampDefs.forEach((l, k) => {
    // Head leans toward the road centre line.
    const toX = -Math.sign(l.off) * l.dz;
    const toZ = Math.sign(l.off) * l.dx;
    const ang = Math.atan2(-toZ, toX);
    poles.setMatrixAt(k, mat4.compose(pos.set(l.x, 3.5, l.z), q.identity(), sc.set(1, 1, 1)));
    q.setFromAxisAngle(up, ang);
    heads.setMatrixAt(k, mat4.compose(pos.set(l.x + toX * 0.9, 6.95, l.z + toZ * 0.9), q, sc.set(1, 1, 1)));
    lamps.push({ x: l.x + toX * 0.9, z: l.z + toZ * 0.9 });
    colliders.addCircle(l.x, l.z, 0.22);
  });
  poles.count = heads.count = lampDefs.length;
  for (const m of [poles, heads]) {
    m.frustumCulled = false;
    m.castShadow = m === poles;
    scene.add(m);
  }

  // ---------------- Distant hills ----------------
  const hillGeo = new THREE.SphereGeometry(1, 18, 10);
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x5f7d48, roughness: 1, flatShading: true });
  for (let k = 0; k < 34; k++) {
    const a = (k / 34) * Math.PI * 2 + rnd() * 0.2;
    const r = 1900 + rnd() * 700;
    const h = new THREE.Mesh(hillGeo, hillMat);
    const s = 180 + rnd() * 260;
    h.scale.set(s, s * (0.2 + rnd() * 0.25), s);
    h.position.set(Math.cos(a) * r, -s * 0.06, Math.sin(a) * r);
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

  return {
    colliders,
    lamps,
    treeCount: treeDefs.length,
    buildingCounts: buildings.counts,
    shops: { onBuildings: buildings.shopsOnBuildings, kiosks: buildings.kiosks },
    bps,
    landmarks: buildings.landmarks,
    update(night, t, dt, fx, fz) {
      buildings.update(night);
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
        best.forEach(([, k], n) => lampLights[n].position.set(lamps[k].x, 6.4, lamps[k].z));
      }
      for (const l of lampLights) l.intensity = night * 70;
    },
  };
}
