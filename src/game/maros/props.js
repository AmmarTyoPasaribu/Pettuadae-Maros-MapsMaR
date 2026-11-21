import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createAtlases, fitText, signPlane } from './signs.js';
import { pointAt } from './osm.js';
import { elev } from './elevation.js';

// Street-level details that make the kampung feel lived in: house fences and gates, water
// tanks (toren) on stands and roofs, AC condensers, gapura arches at lane entrances,
// speed bumps (polisi tidur), rubbish bins, food carts with umbrellas, benches at warung,
// and umbul-umbul banners along the main road.

const merge = (list) => (list.length ? mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g))) : null);
const tmpC = new THREE.Color();
function colorize(g, color) {
  tmpC.set(color);
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set([tmpC.r, tmpC.g, tmpC.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}
const tmpO = new THREE.Object3D();
function beam(ax, ay, az, bx, by, bz, w, h) {
  const len = Math.hypot(bx - ax, by - ay, bz - az) || 0.01;
  const g = new THREE.BoxGeometry(w, h, len);
  tmpO.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  tmpO.lookAt(bx, by, bz);
  tmpO.updateMatrix();
  return g.applyMatrix4(tmpO.matrix);
}
// Quad between two ground points rising from y0 to y1 above each (for see-through fences).
function panel(ax, ay, az, bx, by, bz, y0, y1, uScale) {
  const g = new THREE.BufferGeometry();
  const len = Math.hypot(bx - ax, bz - az);
  g.setAttribute('position', new THREE.Float32BufferAttribute([ax, ay + y0, az, bx, by + y0, bz, bx, by + y1, bz, ax, ay + y1, az], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, len / uScale, 0, len / uScale, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return g;
}

function canvasTex(w, h, draw, repeat = false) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function buildProps(scene, M, colliders, rnd, { onSite, inWater, top, details, kiosks }) {
  const CH = 300;
  const chunks = new Map();
  const chunk = (x, z) => {
    const k = `${Math.floor(x / CH)},${Math.floor(z / CH)}`;
    let c = chunks.get(k);
    if (!c) chunks.set(k, (c = { solid: [], bars: [], bamboo: [], flags: [] }));
    return c;
  };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const G = (x, z) => elev.ground(x, z);

  // ---------------- Fences and gates in front of houses ----------------
  const barsTex = canvasTex(128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    for (let x = 4; x < w; x += 16) ctx.fillRect(x, 0, 5, h);
    ctx.fillRect(0, 10, w, 6);
    ctx.fillRect(0, h - 18, w, 6);
  }, true);
  const bambooTex = canvasTex(128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    for (let x = 0; x < w; x += 11) {
      ctx.fillStyle = ['#b8955a', '#a8844c', '#c4a066'][(x / 11) % 3 | 0];
      ctx.fillRect(x, 6 + ((x * 7) % 9), 9, h);
      ctx.fillStyle = 'rgba(80,50,20,0.5)';
      ctx.fillRect(x, 40 + ((x * 5) % 13), 9, 3);
      ctx.fillRect(x, 92 + ((x * 3) % 11), 9, 3);
    }
    ctx.fillStyle = '#7a5a30';
    ctx.fillRect(0, 34, w, 5);
    ctx.fillRect(0, 96, w, 5);
  }, true);
  const FENCE_PAINT = ['#f2f0ea', '#e8e2d0', '#d9e6d4', '#e7d3c4', '#cfd8e3', '#f1e3b8'];
  const BAR_PAINT = ['#1f2937', '#14532d', '#f8fafc', '#1e3a8a', '#7f1d1d'];
  let fences = 0;
  for (const f of details.fronts) {
    if (rnd() < 0.25) continue;
    const b = f.b;
    const df = Math.max(1.4, Math.min(4.5, f.dist - f.roadHalf - 1.2));
    const ex = f.nz, ez = -f.nx; // along the wall
    const half = f.len / 2 + 0.4;
    const P = (u, v) => [f.mx + ex * u + f.nx * v, f.mz + ez * u + f.nz * v];
    const style = rnd();
    const c = chunk(f.mx, f.mz);
    const paint = pick(FENCE_PAINT);
    const bar = pick(BAR_PAINT);
    const gate = Math.min(2.8, f.len * 0.45);
    const gc = (rnd() - 0.5) * Math.max(0, f.len - gate - 1);
    // Front line split by the gate opening, plus the two side returns to the wall.
    const runs = [
      [P(-half, df), P(gc - gate / 2, df)],
      [P(gc + gate / 2, df), P(half, df)],
      [P(-half, df), P(-half, 0.2)],
      [P(half, df), P(half, 0.2)],
    ];
    const conflict = runs.some(([a, q]) => colliders.containsPoint((a[0] + q[0]) / 2, (a[1] + q[1]) / 2) || inWater((a[0] + q[0]) / 2, (a[1] + q[1]) / 2, 0.2) || M.roadIndex.near((a[0] + q[0]) / 2, (a[1] + q[1]) / 2, 0.6));
    if (conflict) continue;
    fences++;
    for (const [[ax, az], [bx, bz]] of runs) {
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.4) continue;
      const ay = G(ax, az), by = G(bx, bz);
      if (style < 0.45) {
        // Low wall with painted iron bars on top.
        c.solid.push(colorize(beam(ax, ay + 0.2, az, bx, by + 0.2, bz, 0.2, 0.8), paint));
        c.bars.push(colorize(panel(ax, ay, az, bx, by, bz, 0.6, 1.45, 1.4), bar));
      } else if (style < 0.8) {
        // Plastered masonry wall with a coping.
        c.solid.push(colorize(beam(ax, ay + 0.55, az, bx, by + 0.55, bz, 0.18, 1.5), paint));
        c.solid.push(colorize(beam(ax, ay + 1.33, az, bx, by + 1.33, bz, 0.26, 0.07), '#bdb6a8'));
      } else {
        // Bamboo fence (pagar bambu).
        c.bamboo.push(colorize(panel(ax, ay, az, bx, by, bz, -0.1, 1.3, 1.3), '#ffffff'));
      }
      // Pillars at the ends.
      for (const [x, y, z] of [[ax, ay, az], [bx, by, bz]]) c.solid.push(colorize(new THREE.BoxGeometry(0.3, 1.8, 0.3).translate(x, y + 0.6, z), style < 0.8 ? paint : '#8a6a3c'));
      colliders.addSegment(ax, az, bx, bz, Math.max(ay, by) + 1.6, Math.min(ay, by) - 1);
    }
    void b;
  }

  // ---------------- Water tanks (toren) ----------------
  const tanks = details.roofs.filter((t) => !t.tower || (!colliders.containsPoint(t.x, t.z) && !inWater(t.x, t.z, 0.2) && !M.roadIndex.near(t.x, t.z, 1.5)));
  const tankGeo = mergeGeometries([new THREE.CylinderGeometry(0.62, 0.62, 1.25, 18).translate(0, 0.625, 0), new THREE.SphereGeometry(0.62, 18, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.35, 1).translate(0, 1.25, 0), new THREE.CylinderGeometry(0.2, 0.2, 0.12, 10).translate(0, 1.5, 0)]);
  const tankMesh = new THREE.InstancedMesh(tankGeo, new THREE.MeshStandardMaterial({ roughness: 0.45 }), Math.max(1, tanks.length));
  const standGeo = merge([
    ...[[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([x, z]) => new THREE.BoxGeometry(0.08, 3.4, 0.08).translate(x, 1.7, z)),
    new THREE.BoxGeometry(1.3, 0.08, 1.3).translate(0, 3.4, 0),
    new THREE.BoxGeometry(1.0, 0.05, 0.05).translate(0, 1.4, -0.5),
    new THREE.BoxGeometry(0.05, 0.05, 1.0).translate(0.5, 1.4, 0),
  ]);
  const towers = tanks.filter((t) => t.tower);
  const standMesh = new THREE.InstancedMesh(standGeo, new THREE.MeshStandardMaterial({ color: 0x5b6067, metalness: 0.6, roughness: 0.5 }), Math.max(1, towers.length));
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const pv = new THREE.Vector3();
  const TANK_COL = ['#1f5fbf', '#1f5fbf', '#e07b1f', '#d9d9d4', '#2a7a8c'];
  let ti = 0;
  tanks.forEach((t, k) => {
    const y = t.tower ? G(t.x, t.z) + 3.44 : t.y + 0.05;
    tankMesh.setMatrixAt(k, m4.compose(pv.set(t.x, y, t.z), q.identity(), one));
    tankMesh.setColorAt(k, tmpC.set(pick(TANK_COL)));
    if (t.tower) {
      standMesh.setMatrixAt(ti++, m4.compose(pv.set(t.x, G(t.x, t.z), t.z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 3), one));
      colliders.addCircle(t.x, t.z, 0.75);
    }
  });
  tankMesh.count = tanks.length;
  standMesh.count = ti;
  for (const m of [tankMesh, standMesh]) {
    m.castShadow = true;
    m.receiveShadow = true;
    m.computeBoundingSphere();
    scene.add(m);
  }

  // ---------------- AC condensers on shop/office walls ----------------
  const acTex = canvasTex(128, 96, (ctx, w, h) => {
    ctx.fillStyle = '#e8e8e4';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#9ca0a4';
    ctx.beginPath();
    ctx.arc(46, 48, 36, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#5f6368';
    ctx.lineWidth = 2;
    for (let r = 8; r < 36; r += 6) {
      ctx.beginPath();
      ctx.arc(46, 48, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let y = 12; y < 86; y += 6) ctx.fillRect(92, y, 28, 2);
  });
  const acGeo = new THREE.BoxGeometry(0.85, 0.6, 0.3);
  const acMesh = new THREE.InstancedMesh(acGeo, [new THREE.MeshStandardMaterial({ color: 0xdcdcd8 }), new THREE.MeshStandardMaterial({ color: 0xdcdcd8 }), new THREE.MeshStandardMaterial({ color: 0xdcdcd8 }), new THREE.MeshStandardMaterial({ color: 0xdcdcd8 }), new THREE.MeshStandardMaterial({ map: acTex }), new THREE.MeshStandardMaterial({ color: 0xc8c8c4 })], Math.max(1, details.acs.length));
  details.acs.forEach((a, k) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a.ry);
    acMesh.setMatrixAt(k, m4.compose(pv.set(a.x, a.y, a.z), q, one));
  });
  acMesh.count = details.acs.length;
  acMesh.castShadow = true;
  acMesh.computeBoundingSphere();
  scene.add(acMesh);

  // ---------------- Gapura at lane entrances ----------------
  const gates = [];
  let lane = 1;
  for (const node of M.nodes) {
    const major = node.edges.filter((x) => x.edge.rank >= 3);
    const minor = node.edges.filter((x) => x.edge.rank <= 2 && x.edge.len > 40 && x.edge.type !== 'service');
    if (!major.length || !minor.length) continue;
    const mw = Math.max(...major.map((x) => x.edge.width));
    for (const { edge, dir } of minor) {
      if (gates.length > 70 || rnd() < 0.35) continue;
      const s = mw / 2 + 4;
      const p = pointAt(edge.pts, edge.cum, dir > 0 ? s : edge.len - s);
      if (gates.some((g) => Math.hypot(g.x - p.x, g.z - p.z) < 25)) continue;
      const w = edge.width + 1.4;
      const nx = p.dz, nz = -p.dx;
      const ends = [-1, 1].map((sg) => [p.x + nx * sg * (w / 2 + 0.3), p.z + nz * sg * (w / 2 + 0.3)]);
      if (ends.some(([x, z]) => colliders.containsPoint(x, z) || onSite(x, z) || inWater(x, z, 0.2))) continue;
      gates.push({ x: p.x, z: p.z, nx, nz, w, ends, name: edge.name ? edge.name.replace(/^Jalan /i, 'JL. ').toUpperCase() : `LORONG ${lane++}` });
    }
  }
  const gateAtlas = createAtlases(gates, {
    cellW: 512,
    cellH: 96,
    size: 1024,
    draw(ctx, g, x, y, w, h) {
      ctx.fillStyle = '#b91c1c';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y + h - 14, w, 7);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fde68a';
      fitText(ctx, 'SELAMAT DATANG DI', x + w / 2, y + 20, w - 30, 20, '600');
      ctx.fillStyle = '#ffffff';
      fitText(ctx, g.name, x + w / 2, y + 54, w - 30, 40);
    },
  });
  const gateSigns = {};
  gates.forEach((g, i) => {
    const c = chunk(g.x, g.z);
    const ys = g.ends.map(([x, z]) => G(x, z));
    const yTop = Math.max(...ys) + 4.0;
    for (const [k, [x, z]] of g.ends.entries()) {
      // Red-and-white striped pillar.
      for (let s = 0; s < 6; s++) {
        const y0 = ys[k] - 0.3 + ((yTop - ys[k] + 0.3) * s) / 6;
        const y1 = ys[k] - 0.3 + ((yTop - ys[k] + 0.3) * (s + 1)) / 6;
        c.solid.push(colorize(new THREE.BoxGeometry(0.55, y1 - y0, 0.55).translate(x, (y0 + y1) / 2, z), s % 2 ? '#f5f5f5' : '#c81e1e'));
      }
      c.solid.push(colorize(new THREE.ConeGeometry(0.42, 0.7, 4).rotateY(Math.PI / 4).translate(x, yTop + 0.35, z), '#c81e1e'));
      colliders.addCircle(x, z, 0.35);
    }
    const [a, b] = g.ends;
    c.solid.push(colorize(beam(a[0], yTop - 0.2, a[1], b[0], yTop - 0.2, b[1], 0.45, 0.4), '#f5f5f5'));
    const ry = Math.atan2(g.nx, g.nz) + Math.PI / 2;
    const sw = Math.min(g.w - 0.4, 6);
    const slot = gateAtlas.slots[i];
    for (const flip of [0, Math.PI]) {
      (gateSigns[slot.atlas] ||= []).push(signPlane(sw, sw * 0.19, slot.uv, ry + flip, g.x + Math.sin(ry + flip) * 0.24, yTop + 0.55, g.z + Math.cos(ry + flip) * 0.24));
    }
    c.solid.push(colorize(new THREE.BoxGeometry(sw + 0.2, sw * 0.19 + 0.2, 0.42).rotateY(ry).translate(g.x, yTop + 0.55, g.z), '#7f1212'));
  });
  for (const [ai, list] of Object.entries(gateSigns)) scene.add(new THREE.Mesh(merge(list), gateAtlas.materials[ai]));

  // ---------------- Speed bumps on residential streets ----------------
  const bumps = [];
  const BG = 20;
  const bumpGrid = new Map();
  for (const e of M.edges) {
    if (e.rank > 2 || e.len < 70 || e.bridge) continue;
    for (let s = 25; s < e.len - 20; s += 75 + rnd() * 30) {
      const p = pointAt(e.pts, e.cum, s);
      const bm = { x: p.x, z: p.z, dx: p.dx, dz: p.dz, hw: e.width / 2 - 0.25 };
      bumps.push(bm);
      const k = Math.floor(p.x / BG) * 10000 + Math.floor(p.z / BG);
      if (!bumpGrid.has(k)) bumpGrid.set(k, []);
      bumpGrid.get(k).push(bm);
      const c = chunk(p.x, p.z);
      const nx = p.dz, nz = -p.dx;
      const n = 6;
      for (let i = 0; i < n; i++) {
        const u0 = -bm.hw + (2 * bm.hw * i) / n, u1 = -bm.hw + (2 * bm.hw * (i + 1)) / n;
        const ax = p.x + nx * u0, az = p.z + nz * u0, bx = p.x + nx * u1, bz = p.z + nz * u1;
        c.solid.push(colorize(beam(ax, elev.surface(ax, az) + 0.06, az, bx, elev.surface(bx, bz) + 0.06, bz, 0.5, 0.1), i % 2 ? '#1f1f1f' : '#e9b10e'));
      }
    }
  }
  // Extra height of a speed bump under (x, z).
  const bumpAt = (x, z) => {
    const list = bumpGrid.get(Math.floor(x / BG) * 10000 + Math.floor(z / BG));
    if (!list) return 0;
    for (const b of list) {
      const rx = x - b.x, rz = z - b.z;
      const a = rx * b.dx + rz * b.dz;
      if (Math.abs(a) > 0.35) continue;
      if (Math.abs(rx * b.dz - rz * b.dx) > b.hw) continue;
      return 0.1 * (1 - (a / 0.35) ** 2);
    }
    return 0;
  };

  // ---------------- Rubbish bins along the main roads ----------------
  const bins = [];
  for (const e of M.edges) {
    if (e.rank < 4 || e.bridge) continue;
    for (let s = 20; s < e.len - 10; s += 55) {
      const p = pointAt(e.pts, e.cum, s);
      const side = (bins.length % 2) * 2 - 1;
      const off = side * (e.width / 2 + 0.55);
      const x = p.x + p.dz * off, z = p.z - p.dx * off;
      if (colliders.containsPoint(x, z) || onSite(x, z) || inWater(x, z, 0.2)) continue;
      bins.push([x, top(x, z), z]);
      colliders.addCircle(x, z, 0.3);
    }
  }
  const binGeo = mergeGeometries([new THREE.CylinderGeometry(0.28, 0.24, 0.8, 12).translate(0, 0.4, 0), new THREE.CylinderGeometry(0.3, 0.3, 0.06, 12).translate(0, 0.83, 0)]);
  const binMesh = new THREE.InstancedMesh(binGeo, new THREE.MeshStandardMaterial({ roughness: 0.6 }), Math.max(1, bins.length));
  bins.forEach(([x, y, z], k) => {
    binMesh.setMatrixAt(k, m4.compose(pv.set(x, y, z), q.identity(), one));
    binMesh.setColorAt(k, tmpC.set(k % 3 ? '#15803d' : '#ea580c'));
  });
  binMesh.count = bins.length;
  binMesh.castShadow = true;
  binMesh.computeBoundingSphere();
  scene.add(binMesh);

  // ---------------- Food carts (gerobak) and benches at warung ----------------
  const carts = [];
  for (const k of kiosks) {
    const g = k.place.group;
    const ex = Math.cos(k.ry), ez = -Math.sin(k.ry);
    const fx = Math.sin(k.ry), fz = Math.cos(k.ry);
    const c = chunk(k.x, k.z);
    // Bench in front of the counter.
    const bx = k.x + fx * 2.3, bz = k.z + fz * 2.3;
    if (!colliders.containsPoint(bx, bz) && !M.roadIndex.near(bx, bz, 0.3)) {
      const by = elev.surface(bx, bz);
      const ry = k.ry;
      const P = (w, h, d, lx, ly, lz, col) => c.solid.push(colorize(new THREE.BoxGeometry(w, h, d).translate(lx, ly, lz).rotateY(ry).translate(bx, by, bz), col));
      P(2.0, 0.06, 0.38, 0, 0.45, 0, '#9a6b3f');
      P(0.06, 0.45, 0.32, -0.85, 0.22, 0, '#6b4527');
      P(0.06, 0.45, 0.32, 0.85, 0.22, 0, '#6b4527');
      colliders.addCircle(bx, bz, 0.35);
    }
    if (g !== 'food' && g !== 'cafe') continue;
    const cx = k.x + ex * 2.6 + fx * 0.6, cz = k.z + ez * 2.6 + fz * 0.6;
    if (colliders.containsPoint(cx, cz) || M.roadIndex.near(cx, cz, 0.4) || inWater(cx, cz, 0.2)) continue;
    const cy = elev.surface(cx, cz);
    const ry = k.ry;
    const body = ['#2563eb', '#dc2626', '#16a34a', '#f59e0b'][carts.length % 4];
    const P = (geo, col) => c.solid.push(colorize(geo.rotateY(ry).translate(cx, cy, cz), col));
    P(new THREE.BoxGeometry(1.5, 0.7, 0.75).translate(0, 0.75, 0), body);
    P(new THREE.BoxGeometry(1.45, 0.45, 0.7).translate(0, 1.33, 0), '#dfeaf2');
    P(new THREE.BoxGeometry(1.55, 0.05, 0.8).translate(0, 1.58, 0), '#f5f5f5');
    for (const s of [-1, 1]) P(new THREE.CylinderGeometry(0.28, 0.28, 0.06, 14).rotateX(Math.PI / 2).translate(-0.4, 0.3, s * 0.42), '#222222');
    P(new THREE.BoxGeometry(0.05, 0.05, 0.7).translate(0.95, 0.8, 0), '#6b4527');
    P(new THREE.CylinderGeometry(0.025, 0.025, 1.4, 6).translate(0.5, 2.2, 0), '#d4d4d4');
    P(new THREE.ConeGeometry(1.25, 0.5, 10).translate(0.5, 2.95, 0), pick(['#ef4444', '#f59e0b', '#22c55e', '#3b82f6']));
    colliders.addCircle(cx, cz, 0.75);
    carts.push({ x: cx, z: cz, name: k.place.name });
  }

  // ---------------- Umbul-umbul banners along the main roads ----------------
  const FLAG_COL = [['#dc2626', '#f5f5f5'], ['#f59e0b', '#dc2626'], ['#16a34a', '#facc15'], ['#2563eb', '#f5f5f5'], ['#db2777', '#fde047']];
  for (const e of M.edges) {
    if (e.rank < 5 || e.bridge || e.len < 60) continue;
    for (let s = 15; s < e.len - 10; s += 22) {
      const p = pointAt(e.pts, e.cum, s);
      const side = e.median ? e.median.side : 1;
      const off = side * (e.width / 2 + (e.median ? e.median.w / 2 : SIDE));
      const x = p.x + p.dz * off, z = p.z - p.dx * off;
      if (colliders.containsPoint(x, z) || onSite(x, z) || inWater(x, z, 0.2)) continue;
      const y = top(x, z);
      const c = chunk(x, z);
      // Bamboo pole arching over at the top.
      c.solid.push(colorize(new THREE.CylinderGeometry(0.05, 0.08, 7.5, 6).translate(x, y + 3.75, z), '#c9a86a'));
      const ry = Math.atan2(p.dx, p.dz);
      const [c1, c2] = pick(FLAG_COL);
      // Long vertical cloth: aFlag = 0 at the pole, 1 at the free edge (for the wave shader).
      const fl = new THREE.PlaneGeometry(0.7, 4.2, 4, 8).translate(0.37, 0, 0);
      const pos = fl.attributes.position;
      const af = new Float32Array(pos.count);
      const colA = new Float32Array(pos.count * 3);
      const ca = new THREE.Color(c1), cb = new THREE.Color(c2);
      for (let i = 0; i < pos.count; i++) {
        af[i] = pos.getX(i) / 0.74;
        const cc = pos.getY(i) > 0.4 ? ca : cb;
        colA.set([cc.r, cc.g, cc.b], i * 3);
      }
      fl.setAttribute('aFlag', new THREE.BufferAttribute(af, 1));
      fl.setAttribute('color', new THREE.BufferAttribute(colA, 3));
      fl.rotateY(ry).translate(x, y + 5.1, z);
      c.flags.push(fl);
      colliders.addCircle(x, z, 0.12);
    }
  }

  // ---------------- Meshes ----------------
  const solidMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  const barsMat = new THREE.MeshStandardMaterial({ map: barsTex, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.4 });
  const bambooMat = new THREE.MeshStandardMaterial({ map: bambooTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 });
  const flagU = { uTime: { value: 0 } };
  const flagMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.8 });
  flagMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = flagU.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFlag;\nuniform float uTime;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nfloat ph = position.x * 0.3 + position.z * 0.2;\ntransformed += normal * sin(uTime * 3.2 - aFlag * 3.5 + position.y * 0.6 + ph) * 0.22 * aFlag;');
  };
  flagMat.customProgramCacheKey = () => 'umbul-flag';
  // Small details are hidden beyond ~420 m (they would be a few pixels anyway).
  const culled = [];
  for (const [key, c] of chunks) {
    const [gx, gz] = key.split(',').map(Number);
    for (const [list, mat, shadow] of [[c.solid, solidMat, true], [c.bars, barsMat, true], [c.bamboo, bambooMat, true], [c.flags, flagMat, false]]) {
      const g = merge(list);
      if (!g) continue;
      const m = new THREE.Mesh(g, mat);
      m.castShadow = shadow;
      m.receiveShadow = true;
      m.userData.dynamic = true;
      scene.add(m);
      culled.push({ m, cx: (gx + 0.5) * CH, cz: (gz + 0.5) * CH });
    }
  }
  let cullT = 0;

  return {
    counts: { fences, tanks: tanks.length, acs: details.acs.length, gapura: gates.length, bumps: bumps.length, bins: bins.length, carts: carts.length },
    carts,
    bumpAt,
    update(t, dt, fx, fz) {
      flagU.uTime.value = t;
      cullT -= dt || 0;
      if (cullT <= 0) {
        cullT = 0.5;
        for (const c of culled) c.m.visible = Math.hypot(c.cx - fx, c.cz - fz) < 420 + CH * 0.7;
      }
    },
  };
}

const SIDE = 1.2;
