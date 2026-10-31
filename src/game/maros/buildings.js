import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as tex from '../../core/textures.js';
import { pointInPoly, closestOnSegment } from '../colliders.js';
import { createAtlases, drawShopSign, signPlane, SHOP_STYLE } from './signs.js';
import { pointAt } from './osm.js';

// Turns OSM footprints into Maros-style buildings: plastered houses with hip/gable roofs,
// shophouses (ruko) with signboards along the main roads, Bugis stilt houses in the lanes,
// offices/schools with flags, and hand-modelled landmarks. Roof colours come from imagery.

const merge = (list) => (list.length ? mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g))) : null);
const tmpC = new THREE.Color();

// Adds the attributes every merged building mesh shares: color, aLit (and uv if missing).
function colorize(g, color, lit = 0) {
  const n = g.attributes.position.count;
  tmpC.set(color);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([tmpC.r, tmpC.g, tmpC.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aLit', new THREE.BufferAttribute(new Float32Array(n).fill(lit), 1));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}

function extrude(pts, y0, h) {
  const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0], -p[1])));
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return g;
}

// Wall UVs in metres along each wall (u) and above ground (v); caps sample a plain texel.
function wallUV(g, tile, uOff) {
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
    if (Math.abs(ny) > 0.5) { uv.setXY(i, tile.cap[0], tile.cap[1]); continue; }
    const u = pos.getX(i) * -nz + pos.getZ(i) * nx;
    uv.setXY(i, (u + uOff) / tile.w, Math.max(0, pos.getY(i)) / tile.h);
  }
}

// Triangles -> geometry with outward-facing normals (relative to `centre`).
function trisGeo(tris, centre) {
  const pos = [];
  const nor = [];
  for (const t of tris) {
    let [a, b, c] = t;
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const m = [(a[0] + b[0] + c[0]) / 3 - centre[0], (a[1] + b[1] + c[1]) / 3 - centre[1], (a[2] + b[2] + c[2]) / 3 - centre[2]];
    if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0) {
      [b, c] = [c, b];
      n = n.map((v) => -v);
    }
    const l = Math.hypot(...n) || 1;
    pos.push(...a, ...b, ...c);
    for (let k = 0; k < 3; k++) nor.push(n[0] / l, n[1] / l, n[2] / l);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

// Roof over an oriented box. kind: 'hip' (limas) or 'gable' (pelana). Ridge runs along the long side.
function roofGeo(o, baseY, rise, over, kind) {
  let ang = o.ang, lu = o.lu, lv = o.lv;
  if (lv > lu) { ang += Math.PI / 2; [lu, lv] = [lv, lu]; }
  const hu = lu / 2 + over, hv = lv / 2 + over;
  const cu = Math.cos(ang), su = Math.sin(ang);
  const P = (u, v, y) => [o.cx + u * cu - v * su, y, o.cz + u * su + v * cu];
  const t = baseY + rise;
  const r = kind === 'hip' ? Math.max(0, hu - hv) : hu;
  const tris = [];
  const quad = (a, b, c, d) => tris.push([a, b, c], [a, c, d]);
  quad(P(-hu, hv, baseY), P(hu, hv, baseY), P(r, 0, t), P(-r, 0, t));
  quad(P(hu, -hv, baseY), P(-hu, -hv, baseY), P(-r, 0, t), P(r, 0, t));
  tris.push([P(hu, hv, baseY), P(hu, -hv, baseY), P(r, 0, t)]);
  tris.push([P(-hu, -hv, baseY), P(-hu, hv, baseY), P(-r, 0, t)]);
  return trisGeo(tris, [o.cx, baseY + rise * 0.3, o.cz]);
}

// Low wall around a flat roof (ruko parapet): footprint minus a shrunken copy.
function parapet(pts, cx, cz, y0, h) {
  const shrink = (p) => {
    const dx = p[0] - cx, dz = p[1] - cz;
    const d = Math.hypot(dx, dz) || 1;
    const k = Math.max(0.5, (d - 0.3) / d);
    return new THREE.Vector2(cx + dx * k, -(cz + dz * k));
  };
  const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0], -p[1])));
  shape.holes.push(new THREE.Path([...pts].reverse().map(shrink)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return g;
}

const cylinder = (r1, r2, h, x, y, z, seg = 10) => new THREE.CylinderGeometry(r1, r2, h, seg).translate(x, y + h / 2, z);
const boxAt = (w, h, d, x, y, z, ry = 0) => new THREE.BoxGeometry(w, h, d).rotateY(ry).translate(x, y, z);

const HOUSE_WALLS = ['#f1e7cf', '#e3ead7', '#f0d9d4', '#d4e4ee', '#f4edbf', '#e8e4dc', '#fbfaf5', '#cfe3cf', '#f2d7b6', '#dfe6f2', '#f7d9a6'];
const RUKO_WALLS = ['#f4f1ea', '#e9e4d7', '#f6efe0', '#dfe3e8', '#f2e6cf'];
const OFFICE_WALLS = ['#f5f2e9', '#efe9d9', '#f8f6f0'];
const FALLBACK_ROOFS = ['#9a4a32', '#8a3f2c', '#7b6a62', '#8c9096', '#a65a3c'];
const AWNINGS = ['#1d4ed8', '#15803d', '#c2410c', '#b91c1c', '#6b7280', '#0f766e'];

// Satellite colours are hazy and washed out. Map them back to real roofing materials:
// red/brown clay tiles or rusty zinc -> terracotta, grey zinc stays grey, blue zinc gets its colour back.
const clamp01 = (v, a, b2) => Math.max(a, Math.min(b2, v));
function roofColor(hex, rnd) {
  if (!hex) return FALLBACK_ROOFS[Math.floor(rnd() * FALLBACK_ROOFS.length)];
  const c = new THREE.Color(hex);
  if (c.g > c.r * 1.04 && c.g > c.b) return FALLBACK_ROOFS[Math.floor(rnd() * FALLBACK_ROOFS.length)];
  const hsl = {};
  c.getHSL(hsl);
  if (hsl.s < 0.09) c.setHSL(hsl.h, hsl.s, clamp01(hsl.l * 0.92, 0.25, 0.72));
  else if (hsl.h < 0.11 || hsl.h > 0.9) c.setHSL(0.015 + rnd() * 0.035, clamp01(0.4 + hsl.s, 0.45, 0.68), clamp01(hsl.l * 0.64, 0.17, 0.34));
  else if (hsl.h > 0.5 && hsl.h < 0.75) c.setHSL(hsl.h, clamp01(hsl.s * 1.7, 0.35, 0.62), clamp01(hsl.l * 0.88, 0.28, 0.55));
  else c.setHSL(hsl.h, clamp01(hsl.s * 1.2, 0, 0.5), clamp01(hsl.l * 0.9, 0.2, 0.6));
  return '#' + c.getHexString();
}

const isMosque = (b) => b.kind === 'mosque' || (b.amenity === 'place_of_worship' && b.religion !== 'christian') || /masjid|mesjid|musholla|mushola/i.test(b.name);

function classify(b, M) {
  const n = b.name || '';
  if (/markaz/i.test(n)) return 'markaz';
  if (/bupati/i.test(n)) return 'bupati';
  if (isMosque(b)) return 'mosque';
  if (/pasar/i.test(n) || b.amenity === 'marketplace') return 'market';
  if (/museum/i.test(n)) return 'museum';
  if (b.kind === 'school' || /sekolah|\bSD\b|\bSMP\b|\bSMA\b|\bSMK\b|\bMTs\b|madrasah|\bTK\b|kampus|universitas/i.test(n)) return 'school';
  if (/kantor|dinas|badan|bank|puskesmas|rumah sakit|polres|kodim|gedung|pengadilan|kejaksaan|telkom|DPRD/i.test(n) || ['public', 'commercial', 'retail'].includes(b.kind)) return 'office';
  if (b.kind === 'industrial' || b.area > 1500) return 'warehouse';
  if (b.area < 22) return 'shed';
  const main = M.roadIndex.nearest(b.cx, b.cz, 40, 4);
  if (main && main.dist < main.edge.width / 2 + 16 && b.area < 700) return 'ruko';
  return 'house';
}

export function buildBuildings(scene, M, colliders, rnd) {
  // ---------------- Materials ----------------
  const tiles = { house: tex.houseTile(), ruko: tex.rukoTile(), office: tex.officeTile(), wood: tex.woodTile() };
  const litShader = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aLit;\nvarying float vLit;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLit = aLit;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vLit;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vLit;');
  };
  const wallMats = {};
  for (const [k, t] of Object.entries(tiles)) {
    const m = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, emissiveMap: t.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0, vertexColors: true, roughness: 0.86, normalScale: new THREE.Vector2(0.35, 0.35) });
    m.onBeforeCompile = litShader;
    wallMats[k] = m;
  }
  const roofMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.08 });
  const domeMat = new THREE.MeshStandardMaterial({ color: 0xe9edf0, roughness: 0.28, metalness: 0.55 });
  // ---------------- Real shops and services (Overture places) ----------------
  // Each place is attached to the footprint that contains it or lies within 18 m.
  const SIGNED = new Set(['food', 'cafe', 'shop', 'bank', 'health', 'service', 'lodging']);
  const signed = M.places.filter((p) => SIGNED.has(p.group));
  const atlas = createAtlases(signed, { cellW: 320, cellH: 64, size: 1024, draw: drawShopSign });
  signed.forEach((p, i) => (p.slot = atlas.slots[i]));
  const BG = 30;
  const bgrid = new Map();
  M.buildings.forEach((b) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of b.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    for (let gx = Math.floor(x0 / BG); gx <= Math.floor(x1 / BG); gx++) for (let gz = Math.floor(z0 / BG); gz <= Math.floor(z1 / BG); gz++) {
      const k = gx * 10000 + gz;
      if (!bgrid.has(k)) bgrid.set(k, []);
      bgrid.get(k).push(b);
    }
  });
  const kioskPlaces = [];
  for (const p of signed) {
    let best = null;
    let bd = 18;
    for (let gx = Math.floor(p.x / BG) - 1; gx <= Math.floor(p.x / BG) + 1; gx++) for (let gz = Math.floor(p.z / BG) - 1; gz <= Math.floor(p.z / BG) + 1; gz++) {
      for (const b of bgrid.get(gx * 10000 + gz) || []) {
        if (/BPS Kabupaten Maros/i.test(b.name)) continue;
        let d = pointInPoly(p.x, p.z, b.pts) ? 0 : Infinity;
        if (d) for (let i = 0; i < b.pts.length; i++) d = Math.min(d, closestOnSegment(p.x, p.z, ...b.pts[i], ...b.pts[(i + 1) % b.pts.length])[0]);
        if (d < bd) { bd = d; best = b; }
      }
    }
    if (best) (best.shops ||= []).push(p);
    else kioskPlaces.push(p);
  }

  const CH = 220;
  const chunks = new Map();
  const chunk = (x, z) => {
    const k = `${Math.floor(x / CH)},${Math.floor(z / CH)}`;
    let c = chunks.get(k);
    if (!c) chunks.set(k, (c = { house: [], ruko: [], office: [], wood: [], roofs: [], signs: {} }));
    return c;
  };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const landmarks = [];

  // Wall prism for one building (adds colour, lighting flag and UVs).
  function walls(c, kind, pts, y0, h, wallCol, roofCol, lit) {
    let g;
    try {
      g = extrude(pts, y0, h);
    } catch {
      return false;
    }
    wallUV(g, tiles[kind], rnd() * 12);
    colorize(g, wallCol, lit);
    // Caps take the roof colour and never glow.
    const nor = g.attributes.normal;
    const col = g.attributes.color;
    const litA = g.attributes.aLit;
    tmpC.set(roofCol);
    for (let i = 0; i < nor.count; i++) {
      if (Math.abs(nor.getY(i)) > 0.5) {
        col.setXYZ(i, tmpC.r, tmpC.g, tmpC.b);
        litA.setX(i, 0);
      }
    }
    c[kind].push(g);
    return true;
  }

  // Signboard + awning on the wall that faces the nearest main road.
  function shopFront(c, b, road, h, shops = []) {
    const pts = b.pts;
    let best = null;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], q = pts[(i + 1) % pts.length];
      const dx = q[0] - a[0], dz = q[1] - a[1];
      const len = Math.hypot(dx, dz);
      if (len < 2.5) continue;
      let nx = dz / len, nz = -dx / len;
      const mx = (a[0] + q[0]) / 2, mz = (a[1] + q[1]) / 2;
      if (nx * (mx - b.cx) + nz * (mz - b.cz) < 0) { nx = -nx; nz = -nz; }
      const rx = road.x - mx, rz = road.z - mz;
      const rl = Math.hypot(rx, rz) || 1;
      const score = len * ((nx * rx + nz * rz) / rl);
      if (score > 0 && (!best || score > best.score)) best = { score, mx, mz, nx, nz, len };
    }
    if (!best) return;
    const ry = Math.atan2(best.nx, best.nz);
    // Edge direction (along the wall) for placing several signs side by side.
    const ex = best.nz, ez = -best.nx;
    const signY = Math.min(h - 0.5, 3.65);
    const list = shops.slice(0, 3);
    const span = Math.min(best.len * 0.9, 7.5);
    list.forEach((p, i) => {
      const w = Math.min(span / list.length - 0.15, 5.2);
      const off = (i - (list.length - 1) / 2) * (span / list.length);
      const x = best.mx + best.nx * 0.09 + ex * off;
      const z = best.mz + best.nz * 0.09 + ez * off;
      (c.signs[p.slot.atlas] ||= []).push(signPlane(w, w * 0.2, p.slot.uv, ry, x, signY, z));
    });
    const style = list.length ? SHOP_STYLE[list[0].group] : null;
    const awning = style ? style.awning : pick(AWNINGS);
    if (awning) {
      const aw = new THREE.BoxGeometry(Math.min(best.len * 0.95, 7), 0.07, 1.3).rotateX(0.18).rotateY(ry).translate(best.mx + best.nx * 0.65, Math.min(h - 0.9, 3.05), best.mz + best.nz * 0.65);
      c.roofs.push(colorize(aw, awning));
    }
  }

  function flag(c, x, z) {
    c.roofs.push(colorize(cylinder(0.06, 0.08, 9, x, 0, z, 8), '#d9dce1'));
    c.roofs.push(colorize(boxAt(1.6, 0.5, 0.03, x + 0.82, 8.6, z), '#d4141c'));
    c.roofs.push(colorize(boxAt(1.6, 0.5, 0.03, x + 0.82, 8.1, z), '#f8f8f8'));
  }

  function minaret(c, x, z, h, r) {
    c.roofs.push(colorize(cylinder(r, r * 1.15, h, x, 0, z, 12), '#f3f1ea'));
    c.roofs.push(colorize(cylinder(r * 1.6, r * 1.6, 0.5, x, h * 0.72, z, 12), '#e2ded3'));
    c.roofs.push(colorize(cylinder(r * 1.5, r * 1.5, 0.4, x, h - 0.4, z, 12), '#e2ded3'));
    colliders.addCircle(x, z, r * 1.2);
    return [x, h, z];
  }

  function dome(x, y, z, r) {
    const d = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
    d.position.set(x, y, z);
    d.castShadow = true;
    scene.add(d);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(Math.max(0.15, r * 0.06), Math.max(1, r * 0.35), 8), domeMat);
    tip.position.set(x, y + r + Math.max(0.5, r * 0.17), z);
    scene.add(tip);
  }

  const counts = {};
  for (const b of M.buildings) {
    if (/BPS Kabupaten Maros/i.test(b.name)) continue; // hand-built in bps.js
    const type = classify(b, M);
    counts[type] = (counts[type] || 0) + 1;
    const c = chunk(b.cx, b.cz);
    const o = b.obb;
    const fill = b.area / Math.max(1, o.lu * o.lv);
    const roofCol = roofColor(b.roof, rnd);
    const lit = rnd() < 0.6 ? 1 : 0;
    let h;

    if (type === 'markaz') {
      h = 13;
      walls(c, 'office', b.pts, -0.2, h + 0.2, '#f6f4ee', '#d5d7d9', 1);
      const r = Math.min(o.lu, o.lv) * 0.22;
      c.roofs.push(colorize(cylinder(r * 0.95, r * 0.95, 3, o.cx, h, o.cz, 32), '#f0eee8'));
      dome(o.cx, h + 3, o.cz, r);
      const cu = Math.cos(o.ang), su = Math.sin(o.ang);
      for (const [u, v] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const x = o.cx + (u * o.lu * 0.32) * cu - (v * o.lv * 0.32) * su;
        const z = o.cz + (u * o.lu * 0.32) * su + (v * o.lv * 0.32) * cu;
        c.roofs.push(colorize(cylinder(r * 0.33, r * 0.33, 1.2, x, h, z, 16), '#f0eee8'));
        dome(x, h + 1.2, z, r * 0.33);
      }
      for (const v of [1, -1]) {
        const x = o.cx + (o.lu / 2 + 4) * cu - (v * o.lv * 0.42) * su;
        const z = o.cz + (o.lu / 2 + 4) * su + (v * o.lv * 0.42) * cu;
        const top = minaret(c, x, z, 38, 1.5);
        dome(top[0], top[1], top[2], 1.8);
      }
      landmarks.push({ name: b.name, x: o.cx, z: o.cz });
    } else if (type === 'bupati') {
      h = 8;
      walls(c, 'office', b.pts, -0.2, h + 0.2, '#f3ecd9', roofCol, 1);
      c.roofs.push(colorize(roofGeo(o, h, Math.min(5, Math.min(o.lu, o.lv) * 0.25), 1.2, 'hip'), roofCol));
      c.roofs.push(colorize(cylinder(3, 3, 16, o.cx, 0, o.cz, 24), '#f8f6f0'));
      dome(o.cx, 16, o.cz, 3.2);
      const road = M.roadIndex.nearest(o.cx, o.cz, 120);
      if (road) flag(c, o.cx + (road.x - o.cx) * 0.6, o.cz + (road.z - o.cz) * 0.6);
      landmarks.push({ name: b.name, x: o.cx, z: o.cz });
    } else if (type === 'mosque') {
      h = b.area > 250 ? 7 : 5;
      walls(c, 'office', b.pts, -0.2, h + 0.2, '#f7f5ef', roofCol, 1);
      const r = Math.max(2.2, Math.min(o.lu, o.lv) * 0.3);
      c.roofs.push(colorize(cylinder(r * 0.95, r * 0.95, 1.2, o.cx, h, o.cz, 24), '#efede6'));
      dome(o.cx, h + 1.2, o.cz, r);
      const cu = Math.cos(o.ang), su = Math.sin(o.ang);
      const top = minaret(c, o.cx + (o.lu / 2 + 1.5) * cu, o.cz + (o.lu / 2 + 1.5) * su, Math.min(22, 10 + b.area / 40), 0.8);
      dome(top[0], top[1], top[2], 1.0);
    } else if (type === 'market' || type === 'warehouse') {
      h = type === 'market' ? 5.5 : 6.5;
      walls(c, type === 'market' ? 'ruko' : 'office', b.pts, -0.2, h + 0.2, pick(RUKO_WALLS), roofCol, lit);
      if (fill > 0.6) c.roofs.push(colorize(roofGeo(o, h, Math.min(3.5, Math.min(o.lu, o.lv) * 0.12), 0.8, 'gable'), roofCol));
    } else if (type === 'office' || type === 'school' || type === 'museum') {
      h = b.levels ? b.levels * 3.6 + 0.4 : rnd() < (type === 'school' ? 0.35 : 0.6) ? 7.4 : 4.0;
      walls(c, 'office', b.pts, -0.2, h + 0.2, type === 'museum' ? '#fbfaf5' : pick(OFFICE_WALLS), roofCol, lit);
      if (fill > 0.68) c.roofs.push(colorize(roofGeo(o, h, Math.min(4, Math.min(o.lu, o.lv) * 0.3), 0.9, 'hip'), roofCol));
      if (type === 'school' && b.name) {
        const road = M.roadIndex.nearest(o.cx, o.cz, 120);
        if (road) flag(c, o.cx + (road.x - o.cx) * 0.5, o.cz + (road.z - o.cz) * 0.5);
      }
      if (b.name && type !== 'school') landmarks.push({ name: b.name, x: o.cx, z: o.cz });
    } else if (type === 'ruko') {
      const floors = b.levels || (rnd() < 0.1 ? 1 : rnd() < 0.62 ? 2 : 3);
      h = floors * 3.2 + 0.3;
      walls(c, 'ruko', b.pts, -0.2, h + 0.2, pick(RUKO_WALLS), roofCol, lit);
      if (rnd() < 0.7 || fill < 0.7) c.roofs.push(colorize(parapet(b.pts, b.cx, b.cz, h, 0.9), '#e9e5dc'));
      else c.roofs.push(colorize(roofGeo(o, h, Math.min(2.2, Math.min(o.lu, o.lv) * 0.3), 0.4, 'gable'), roofCol));
      const road = M.roadIndex.nearest(b.cx, b.cz, 40, 4);
      if (road && !b.shops) shopFront(c, b, road, h);
    } else if (type === 'shed') {
      h = 2.6;
      walls(c, 'house', b.pts, -0.2, h + 0.2, pick(HOUSE_WALLS), roofCol, 0);
      if (fill > 0.6) c.roofs.push(colorize(roofGeo(o, h, 0.7, 0.3, 'gable'), roofCol));
    } else {
      // House. Some lane houses are Bugis rumah panggung on stilts.
      const lane = !M.roadIndex.nearest(b.cx, b.cz, 45, 3);
      const panggung = lane && b.area > 35 && b.area < 150 && fill > 0.7 && rnd() < 0.22;
      if (panggung) {
        const y0 = 2.0;
        h = 2.9;
        walls(c, 'wood', b.pts, y0, h, '#ffffff', roofCol, lit);
        c.roofs.push(colorize(roofGeo(o, y0 + h, Math.min(3.4, Math.min(o.lu, o.lv) * 0.55), 0.6, 'gable'), roofCol));
        const cu = Math.cos(o.ang), su = Math.sin(o.ang);
        for (const u of [-0.45, 0, 0.45]) {
          for (const v of [-0.45, 0.45]) {
            const x = o.cx + u * o.lu * cu - v * o.lv * su;
            const z = o.cz + u * o.lu * su + v * o.lv * cu;
            c.roofs.push(colorize(cylinder(0.12, 0.14, y0, x, 0, z, 6), '#4a2f1b'));
          }
        }
        c.roofs.push(colorize(boxAt(0.9, 0.12, 1.6, o.cx + (o.lu / 2 + 0.6) * cu, 1.0, o.cz + (o.lu / 2 + 0.6) * su, -o.ang + Math.PI / 2).rotateZ(0), '#5a3a20'));
        h = y0 + h;
      } else {
        h = b.levels ? b.levels * 3.2 + 0.2 : b.area > 70 && rnd() < 0.22 ? 6.6 : 3.4;
        walls(c, 'house', b.pts, -0.2, h + 0.2, pick(HOUSE_WALLS), roofCol, lit);
        if (fill > 0.72 && o.lu > 2.5 && o.lv > 2.5) {
          const kind = rnd() < 0.55 ? 'hip' : 'gable';
          const rise = Math.max(0.9, Math.min(kind === 'hip' ? 2.3 : 2.6, Math.min(o.lu, o.lv) * (kind === 'hip' ? 0.34 : 0.4)));
          c.roofs.push(colorize(roofGeo(o, h, rise, 0.45, kind), roofCol));
        }
      }
    }
    if (b.shops) {
      const road = M.roadIndex.nearest(b.cx, b.cz, 60);
      if (road) shopFront(c, b, road, h, b.shops);
    }
    colliders.addPolygon(b.pts, h);
  }

  // ---------------- Kiosks / warung for places without a mapped building ----------------
  const kiosks = [];
  for (const p of kioskPlaces) {
    const road = M.roadIndex.nearest(p.x, p.z, 40);
    if (!road) continue;
    let x = p.x, z = p.z;
    let fx = road.x - x, fz = road.z - z;
    let fl = Math.hypot(fx, fz);
    const minD = road.edge.width / 2 + 2.6;
    if (fl < minD) {
      // Standing on the road: move it to the roadside.
      const t = pointAt(road.edge.pts, road.edge.cum, road.s);
      let nx = t.dz, nz = -t.dx;
      if (fl > 0.1 && nx * -fx + nz * -fz < 0) { nx = -nx; nz = -nz; }
      x = road.x + nx * minD;
      z = road.z + nz * minD;
      fx = road.x - x;
      fz = road.z - z;
      fl = Math.hypot(fx, fz);
    }
    if (colliders.containsPoint(x, z) || kiosks.some((k) => Math.hypot(k[0] - x, k[1] - z) < 4.5)) continue;
    kiosks.push([x, z]);
    fx /= fl || 1;
    fz /= fl || 1;
    const ry = Math.atan2(fx, fz);
    const c = chunk(x, z);
    const st = SHOP_STYLE[p.group] || SHOP_STYLE.other;
    const part = (w, hh, d, lx, ly, lz, color) => c.roofs.push(colorize(new THREE.BoxGeometry(w, hh, d).translate(lx, ly, lz).rotateY(ry).translate(x, 0, z), color));
    part(2.6, 2.3, 2.2, 0, 1.15, 0, pick(['#e9dcc0', '#d4e4d0', '#f1d9b5', '#c9b08a']));
    part(3.2, 0.08, 2.9, 0, 2.38, 0.1, '#8a9096');
    part(1.9, 0.95, 0.04, 0, 1.45, 1.11, '#2a1f16');
    part(2.2, 0.1, 0.5, 0, 0.95, 1.3, '#a8774a');
    if (st.awning) c.roofs.push(colorize(new THREE.BoxGeometry(2.8, 0.06, 1.1).rotateX(0.2).translate(0, 2.05, 1.6).rotateY(ry).translate(x, 0, z), st.awning));
    (c.signs[p.slot.atlas] ||= []).push(signPlane(2.5, 0.5, p.slot.uv, ry, x + fx * 1.13, 2.62, z + fz * 1.13));
    const corners = [[-1.3, -1.1], [1.3, -1.1], [1.3, 1.1], [-1.3, 1.1]].map(([lx, lz]) => [x + lx * Math.cos(ry) + lz * Math.sin(ry), z - lx * Math.sin(ry) + lz * Math.cos(ry)]);
    colliders.addPolygon(corners, 2.4);
  }

  for (const c of chunks.values()) {
    for (const kind of ['house', 'ruko', 'office', 'wood']) {
      const g = merge(c[kind]);
      if (!g) continue;
      const m = new THREE.Mesh(g, wallMats[kind]);
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
      c[kind].forEach((x) => x.dispose());
    }
    const rg = merge(c.roofs);
    if (rg) {
      const m = new THREE.Mesh(rg, roofMat);
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
    }
    for (const [ai, list] of Object.entries(c.signs)) {
      const sg = merge(list);
      if (sg) scene.add(new THREE.Mesh(sg, atlas.materials[ai]));
    }
  }

  return {
    kiosks: kiosks.length,
    shopsOnBuildings: signed.length - kioskPlaces.length,
    counts,
    landmarks,
    update(night) {
      for (const m of Object.values(wallMats)) m.emissiveIntensity = night * 1.25;
      for (const m of atlas.materials) m.emissiveIntensity = night * 0.9;
    },
  };
}
