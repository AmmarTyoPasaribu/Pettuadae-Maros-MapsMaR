import raw from './data/pettuadae.json';
import imagery from './data/pettuadae-imagery.json';
import measured from './data/pettuadae-roads.json';
import placeData from './data/pettuadae-places.json';

// Turns the raw OSM export into what the game needs: clipped roads, a drivable
// graph for AI, a spatial road index and analysed building footprints.

export const R_CLIP = 1295;
export const LIMIT = 1285;

const DRIVE = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'service', 'living_street', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);
// Fallback paved widths (m) when neither an OSM width tag nor an imagery measurement exists.
const WIDTH = { trunk: 14, primary: 12, secondary: 9.5, tertiary: 8, unclassified: 7, residential: 5.8, service: 4, living_street: 4.3, trunk_link: 6, primary_link: 6, secondary_link: 6, tertiary_link: 5.5, path: 1.6 };
export const SIDEWALK = 1.8;

// Shop/service categories (Overture basic_category) grouped for signs and map icons.
const GROUPS = [
  ['food', /restaurant|eatery|food_court|bakery|seafood|chicken|noodle|dessert|snack|meat|fish|catering/],
  ['cafe', /cafe|coffee|tea|juice|beverage_shop/],
  ['shop', /store|shop|market|mart|supermarket|convenience|retail|boutique|grocery|food_and_beverage/],
  ['bank', /bank|atm|financial|credit|insurance|money/],
  ['health', /pharmac|drug|clinic|hospital|doctor|dent|health|medical|midwife/],
  ['service', /service|repair|salon|beauty|print|laundry|tailor|barber|photo|automotive|dealer|rental|agency|office/],
  ['lodging', /hotel|lodging|guest|inn|homestay/],
  ['edu', /school|education|learning|college|universit|kindergarten|academy/],
  ['gov', /government|police|post_office|military|court/],
  ['worship', /worship|mosque|church|temple/],
];
export const groupOf = (basic, cat = '') => {
  const s = (basic || '') + ' ' + (cat || '');
  for (const [g, re] of GROUPS) if (re.test(s)) return g;
  return 'other';
};
const SPEED = { trunk: 13, primary: 12, secondary: 11, tertiary: 10, unclassified: 8, residential: 7.5, service: 5, living_street: 5, trunk_link: 9, primary_link: 9, secondary_link: 9, tertiary_link: 8 };
const RANK = { trunk: 5, primary: 5, secondary: 4, tertiary: 3, unclassified: 2, residential: 2, service: 1, living_street: 1, trunk_link: 2, primary_link: 2, secondary_link: 2, tertiary_link: 2 };

// Split a polyline into the runs that stay inside the playable circle.
function clip(pts, r = R_CLIP) {
  const runs = [];
  let cur = [];
  for (const p of pts) {
    if (Math.hypot(p[0], p[1]) <= r) cur.push(p);
    else if (cur.length) { runs.push(cur); cur = []; }
  }
  if (cur.length) runs.push(cur);
  return runs.filter((r2) => r2.length >= 2);
}

const polyLen = (pts) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);

export function cumulative(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return cum;
}

// Position + direction at distance s along a polyline (cum = cumulative lengths).
export function pointAt(pts, cum, s, hint = 0) {
  const n = pts.length;
  let i = Math.max(0, Math.min(n - 2, hint));
  while (i > 0 && cum[i] > s) i--;
  while (i < n - 2 && cum[i + 1] < s) i++;
  const seg = cum[i + 1] - cum[i] || 1e-6;
  const u = Math.max(0, Math.min(1, (s - cum[i]) / seg));
  const dx = (pts[i + 1][0] - pts[i][0]) / seg;
  const dz = (pts[i + 1][1] - pts[i][1]) / seg;
  return { x: pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u, z: pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u, dx, dz, i };
}

// Polyline shifted sideways by `off` metres (positive = left of travel).
export function offsetPolyline(pts, off) {
  const n = pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0];
    let tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    // Miter factor so sharp bends keep the offset distance.
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[Math.min(n - 1, i + 1)];
    const s1x = p1[0] - p0[0], s1z = p1[1] - p0[1], s2x = p2[0] - p1[0], s2z = p2[1] - p1[1];
    const l1 = Math.hypot(s1x, s1z) || 1, l2 = Math.hypot(s2x, s2z) || 1;
    const cos = Math.max(0.5, (s1x / l1) * tx + (s1z / l1) * tz);
    const m = i === 0 || i === n - 1 ? 1 : 1 / cos;
    void l2;
    out.push([pts[i][0] + tz * off * m, pts[i][1] - tx * off * m]);
  }
  return out;
}

export function loadMap() {
  // ---------------- Roads ----------------
  // Width priority: OSM width tag > width measured on satellite imagery > class default.
  const roads = [];
  raw.roads.forEach((r, idx) => {
    if (!(r.type in WIDTH)) return;
    const width = r.width > 0 ? r.width : measured.widths[idx] || WIDTH[r.type];
    for (const pts of clip(r.pts)) roads.push({ ...r, pts, width, tagged: r.width > 0, measured: !!measured.widths[idx], drive: DRIVE.has(r.type), speed: SPEED[r.type] || 6, rank: RANK[r.type] || 1, median: null });
  });

  // Dual carriageways (e.g. Jl. Jenderal Sudirman) are mapped as two parallel one-way ways.
  // Imagery measures across both, so derive each carriageway's width from the twin spacing
  // and remember which side the median is on.
  const segDist2 = (px, pz, a, b) => {
    const vx = b[0] - a[0], vz = b[1] - a[1];
    const l2 = vx * vx + vz * vz || 1;
    const k = Math.max(0, Math.min(1, ((px - a[0]) * vx + (pz - a[1]) * vz) / l2));
    return [Math.hypot(px - a[0] - vx * k, pz - a[1] - vz * k), a[0] + vx * k, a[1] + vz * k, vx / Math.sqrt(l2), vz / Math.sqrt(l2)];
  };
  const majors = roads.filter((r) => r.oneway && r.rank >= 4);
  for (const r of majors) {
    const mi = Math.floor((r.pts.length - 1) / 2);
    const a = r.pts[mi], b = r.pts[mi + 1] || r.pts[mi - 1];
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    let dx = b[0] - a[0], dz = b[1] - a[1];
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl;
    dz /= dl;
    let best = null;
    for (const o of majors) {
      if (o === r || (o.name && r.name && o.name !== r.name)) continue;
      for (let i = 0; i < o.pts.length - 1; i++) {
        const [d, qx, qz, ox, oz] = segDist2(mx, mz, o.pts[i], o.pts[i + 1]);
        if (d < 4.5 || d > 32 || Math.abs(ox * dx + oz * dz) < 0.85) continue;
        if (!best || d < best.d) best = { d, side: Math.sign(dz * (qx - mx) - dx * (qz - mz)) || 1 };
      }
    }
    if (!best) continue;
    if (!r.tagged) r.width = Math.max(6, Math.min(10.5, best.d - 2.4));
    r.median = { side: best.side, w: Math.max(0.6, best.d - r.width) };
  }

  // ---------------- Drivable graph ----------------
  const key = (p) => p[0] + ',' + p[1];
  const drivable = roads.filter((r) => r.drive);
  const count = new Map();
  for (const r of drivable) {
    r.pts.forEach((p, i) => {
      const k = key(p);
      count.set(k, (count.get(k) || 0) + (i === 0 || i === r.pts.length - 1 ? 2 : 1));
    });
  }
  const nodes = new Map();
  const getNode = (p) => {
    const k = key(p);
    let n = nodes.get(k);
    if (!n) nodes.set(k, (n = { id: nodes.size, x: p[0], z: p[1], edges: [] }));
    return n;
  };
  const edges = [];
  for (const r of drivable) {
    let start = 0;
    for (let i = 1; i < r.pts.length; i++) {
      if (count.get(key(r.pts[i])) >= 2 || i === r.pts.length - 1) {
        const pts = r.pts.slice(start, i + 1);
        start = i;
        const len = polyLen(pts);
        if (len < 0.5) continue;
        const a = getNode(pts[0]);
        const b = getNode(pts[pts.length - 1]);
        const e = { id: edges.length, a, b, pts, cum: cumulative(pts), len, type: r.type, name: r.name, width: r.width, oneway: r.oneway, rank: r.rank, speed: r.speed, bridge: r.bridge, median: r.median };
        edges.push(e);
        a.edges.push({ edge: e, dir: 1 });
        b.edges.push({ edge: e, dir: -1 });
      }
    }
  }

  // Which exits can a vehicle take from this node?
  const exits = (node) => node.edges.filter((x) => !x.edge.oneway || x.dir === 1);

  // ---------------- Spatial index of road segments ----------------
  const CELL = 24;
  const grid = new Map();
  const gk = (cx, cz) => (cx + 400) * 1000 + (cz + 400);
  for (const e of edges) {
    for (let i = 0; i < e.pts.length - 1; i++) {
      const [ax, az] = e.pts[i];
      const [bx, bz] = e.pts[i + 1];
      for (let cx = Math.floor((Math.min(ax, bx) - 8) / CELL); cx <= Math.floor((Math.max(ax, bx) + 8) / CELL); cx++) {
        for (let cz = Math.floor((Math.min(az, bz) - 8) / CELL); cz <= Math.floor((Math.max(az, bz) + 8) / CELL); cz++) {
          const k = gk(cx, cz);
          let a = grid.get(k);
          if (!a) grid.set(k, (a = []));
          a.push({ e, i });
        }
      }
    }
  }
  const segDist = (px, pz, ax, az, bx, bz) => {
    const vx = bx - ax, vz = bz - az;
    const l2 = vx * vx + vz * vz;
    const k = l2 ? Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / l2)) : 0;
    return [Math.hypot(px - (ax + vx * k), pz - (az + vz * k)), k];
  };
  const roadIndex = {
    // Is (x,z) within `margin` of the edge of any drivable road surface?
    near(x, z, margin = 0) {
      const a = grid.get(gk(Math.floor(x / CELL), Math.floor(z / CELL)));
      if (!a) return false;
      for (const { e, i } of a) {
        const [d] = segDist(x, z, e.pts[i][0], e.pts[i][1], e.pts[i + 1][0], e.pts[i + 1][1]);
        if (d < e.width / 2 + margin) return true;
      }
      return false;
    },
    // Raised kerb/sidewalk height beside main roads (0 on the carriageway or elsewhere).
    curbAt(x, z) {
      const n = this.nearest(x, z, 14);
      if (!n || n.dist < n.edge.width / 2 || n.edge.rank < 4) return 0;
      const extra = n.edge.median ? Math.max(SIDEWALK, n.edge.median.w) : SIDEWALK;
      return n.dist < n.edge.width / 2 + extra ? 0.15 : 0;
    },
    // Closest point on the drivable network within maxD metres.
    nearest(x, z, maxD = 200, minRank = 0) {
      let best = null;
      const rc = Math.ceil(maxD / CELL);
      const cx0 = Math.floor(x / CELL), cz0 = Math.floor(z / CELL);
      for (let cx = cx0 - rc; cx <= cx0 + rc; cx++) {
        for (let cz = cz0 - rc; cz <= cz0 + rc; cz++) {
          const a = grid.get(gk(cx, cz));
          if (!a) continue;
          for (const { e, i } of a) {
            if (e.rank < minRank) continue;
            const [d, k] = segDist(x, z, e.pts[i][0], e.pts[i][1], e.pts[i + 1][0], e.pts[i + 1][1]);
            if (d < (best ? best.dist : maxD)) {
              const s = e.cum[i] + (e.cum[i + 1] - e.cum[i]) * k;
              best = { dist: d, edge: e, s, x: e.pts[i][0] + (e.pts[i + 1][0] - e.pts[i][0]) * k, z: e.pts[i][1] + (e.pts[i + 1][1] - e.pts[i][1]) * k };
            }
          }
        }
      }
      return best;
    },
  };

  // ---------------- Buildings ----------------
  const buildings = [];
  raw.buildings.forEach((b, idx) => {
    const pts = b.pts;
    let cx = 0, cz = 0;
    for (const p of pts) { cx += p[0]; cz += p[1]; }
    cx /= pts.length;
    cz /= pts.length;
    if (Math.hypot(cx, cz) > R_CLIP) return;
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      area += p[0] * q[1] - q[0] * p[1];
    }
    area = Math.abs(area) / 2;
    if (area < 4) return;
    // Oriented bounding box from the principal axis of the vertices.
    let sxx = 0, szz = 0, sxz = 0;
    for (const p of pts) { const dx = p[0] - cx, dz = p[1] - cz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
    const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
    const ux = Math.cos(ang), uz = Math.sin(ang);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of pts) {
      const du = (p[0] - cx) * ux + (p[1] - cz) * uz;
      const dv = -(p[0] - cx) * uz + (p[1] - cz) * ux;
      u0 = Math.min(u0, du); u1 = Math.max(u1, du); v0 = Math.min(v0, dv); v1 = Math.max(v1, dv);
    }
    const mu = (u0 + u1) / 2, mv = (v0 + v1) / 2;
    buildings.push({
      ...b, idx, area, cx, cz, roof: imagery.roofs[idx] || '',
      obb: { cx: cx + ux * mu - uz * mv, cz: cz + uz * mu + ux * mv, ang, lu: u1 - u0, lv: v1 - v0 },
    });
  });

  // ---------------- Water ----------------
  const rivers = [];
  for (const w of raw.waterways) {
    const width = w.width > 0 ? w.width : w.name === 'Sungai Maros' ? 42 : w.type === 'river' ? 16 : w.type === 'stream' ? 4 : 2.5;
    for (const pts of clip(w.pts)) rivers.push({ ...w, pts, width });
  }

  const landuse = raw.landuse.filter((l) => l.pts.length >= 3 && Math.hypot(l.pts[0][0], l.pts[0][1]) < R_CLIP + 400);
  const water = raw.water.filter((l) => l.pts.length >= 3);

  // Shops, restaurants, cafes, services from Overture Maps Places (real names).
  const places = placeData.places
    .filter((p) => p.conf >= 0.45 && Math.hypot(p.x, p.z) < R_CLIP)
    .map((p) => ({ ...p, group: groupOf(p.basic, p.cat) }));
  const pois = raw.pois.filter((p) => Math.hypot(p.x, p.z) < R_CLIP);
  const known = new Set(pois.map((p) => p.name.toLowerCase()));
  for (const p of places) if (!known.has(p.name.toLowerCase())) pois.push({ name: p.name, kind: p.group, x: p.x, z: p.z, place: true });
  const kantor = pois.find((p) => /Kantor Kelurahan Pettuadae/i.test(p.name)) || { x: 0, z: 0, name: 'Pusat' };

  return { roads, edges, nodes: [...nodes.values()], exits, roadIndex, buildings, rivers, landuse, water, pois, kantor, signals: raw.signals, trees: imagery.trees, places, stats: { roads: roads.length, edges: edges.length, nodes: nodes.size, buildings: buildings.length } };
}
