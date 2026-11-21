import dem from './data/pettuadae-elevation.json';
import { cumulative } from './osm.js';
import { pointInPoly } from '../colliders.js';

// Real ground height for Pettuadae. The smoothed SRTM-derived grid (scripts/fetch-elevation.mjs)
// is resampled to a 4 m grid, then shaped by what is on the map:
//  - Sungai Maros and the other rivers get a channel (sloped banks, water level a few metres
//    below the banks, a deeper bed you can swim in),
//  - the pond gets a basin,
//  - roads sit on the natural ground and build small embankments where they cross channels,
//  - bridges get a deck that spans between the abutments with a gentle hump.
// Everything (terrain mesh, roads, buildings, trees, vehicles, people) reads heights from here.

export const STEP = 4;
export const HALF = 1440;
export const N = Math.round((2 * HALF) / STEP) + 1;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// Points every <= maxSeg metres along a polyline (keeps the original vertices).
export function densify(pts, maxSeg = 4) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / maxSeg));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  return out;
}

// Closed ring pushed outwards by d metres (mitred).
export function offsetRing(pts, d) {
  const n = pts.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    area += p[0] * q[1] - q[0] * p[1];
  }
  const s = area > 0 ? -1 : 1;
  return pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const e1 = [p[0] - a[0], p[1] - a[1]], e2 = [b[0] - p[0], b[1] - p[1]];
    const l1 = Math.hypot(...e1) || 1, l2 = Math.hypot(...e2) || 1;
    const n1 = [(e1[1] / l1) * s, (-e1[0] / l1) * s], n2 = [(e2[1] / l2) * s, (-e2[0] / l2) * s];
    let mx = n1[0] + n2[0], mz = n1[1] + n2[1];
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml;
    mz /= ml;
    const k = d / Math.max(0.4, mx * n1[0] + mz * n1[1]);
    return [p[0] + mx * k, p[1] + mz * k];
  });
}

// Distance from P to segment AB and the parameter t (0..1).
function segDT(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az;
  const l2 = vx * vx + vz * vz;
  const t = l2 ? clamp(((px - ax) * vx + (pz - az) * vz) / l2, 0, 1) : 0;
  return [Math.hypot(px - ax - vx * t, pz - az - vz * t), t];
}

// Raw DEM (metres above the lowest point of the area), bilinear.
function demAt(x, z) {
  const n = dem.size;
  const gx = clamp((x + dem.half) / dem.step, 0, n - 1.0001);
  const gz = clamp((z + dem.half) / dem.step, 0, n - 1.0001);
  const i = Math.floor(gx), j = Math.floor(gz);
  const fx = gx - i, fz = gz - j;
  const c = dem.cm;
  const a = c[j * n + i], b = c[j * n + i + 1], d = c[(j + 1) * n + i], e = c[(j + 1) * n + i + 1];
  return ((a * (1 - fx) + b * fx) * (1 - fz) + (d * (1 - fx) + e * fx) * fz) / 100;
}

export const elev = {
  ready: false,
  B: null, // natural ground (smoothed DEM)
  H: null, // final ground
  W: null, // water surface level (-Infinity where dry)
  rivers: [],
  ponds: [],
  bridges: [],
  edge: 0,
  // Triangle-exact height of the terrain mesh at (x, z).
  ground(x, z) {
    const H = this.H;
    if (!H) return 0;
    const gx = clamp((x + HALF) / STEP, 0, N - 1.0001);
    const gz = clamp((z + HALF) / STEP, 0, N - 1.0001);
    const i = Math.floor(gx), j = Math.floor(gz);
    const fx = gx - i, fz = gz - j;
    const k = j * N + i;
    // Cells are split along the (i+1, j) - (i, j+1) diagonal, like the mesh index buffer.
    if (fx + fz <= 1) return H[k] + (H[k + 1] - H[k]) * fx + (H[k + N] - H[k]) * fz;
    const d = H[k + N + 1];
    return d + (H[k + N] - d) * (1 - fx) + (H[k + 1] - d) * (1 - fz);
  },
  // Natural ground before channels and embankments.
  base(x, z) {
    const B = this.B;
    if (!B) return 0;
    const gx = clamp((x + HALF) / STEP, 0, N - 1.0001);
    const gz = clamp((z + HALF) / STEP, 0, N - 1.0001);
    const i = Math.floor(gx), j = Math.floor(gz);
    const fx = gx - i, fz = gz - j;
    const k = j * N + i;
    return (B[k] * (1 - fx) + B[k + 1] * fx) * (1 - fz) + (B[k + N] * (1 - fx) + B[k + N + 1] * fx) * fz;
  },
  // Bridge deck height at (x, z), or null when not on a bridge.
  deck(x, z) {
    let best = null;
    for (const b of this.bridges) {
      if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
      const p = b.pts;
      for (let i = 0; i < p.length - 1; i++) {
        const [d, t] = segDT(x, z, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]);
        if (d > b.width / 2 + 0.45) continue;
        const y = b.ys[i] + (b.ys[i + 1] - b.ys[i]) * t;
        if (best === null || y > best) best = y;
      }
    }
    return best;
  },
  // Walkable/drivable top surface: bridge deck when on one, else ground.
  surface(x, z) {
    const d = this.bridges.length ? this.deck(x, z) : null;
    const g = this.ground(x, z);
    return d === null ? g : Math.max(d, g);
  },
  // Water surface level at (x, z), or -Infinity on dry land.
  waterAt(x, z) {
    const W = this.W;
    if (!W) return -Infinity;
    const gx = (x + HALF) / STEP, gz = (z + HALF) / STEP;
    if (gx < 0 || gz < 0 || gx >= N - 1 || gz >= N - 1) return -Infinity;
    const k = Math.floor(gz) * N + Math.floor(gx);
    return Math.max(W[k], W[k + 1], W[k + N], W[k + N + 1]);
  },
  // Water depth under the surface at (x, z) (0 when dry).
  depthAt(x, z) {
    const w = this.waterAt(x, z);
    return w === -Infinity ? 0 : Math.max(0, w - this.ground(x, z));
  },
  // Make a rectangle (in a local frame) level at height y, blending out over `blend` metres.
  flatten(f, y, blend = 6) {
    const { cx, cz, ux, uz, nx, nz, x0, x1, z0, z1 } = f;
    const r = Math.hypot(Math.max(-x0, x1), Math.max(-z0, z1)) + blend + STEP;
    const H = this.H;
    for (let j = Math.max(0, Math.floor((cz - r + HALF) / STEP)); j <= Math.min(N - 1, Math.ceil((cz + r + HALF) / STEP)); j++) {
      for (let i = Math.max(0, Math.floor((cx - r + HALF) / STEP)); i <= Math.min(N - 1, Math.ceil((cx + r + HALF) / STEP)); i++) {
        const x = -HALF + i * STEP - cx, z = -HALF + j * STEP - cz;
        const lx = x * ux + z * uz, lz = x * nx + z * nz;
        const dx = Math.max(x0 - lx, 0, lx - x1), dz = Math.max(z0 - lz, 0, lz - z1);
        const d = Math.hypot(dx, dz);
        if (d >= blend) continue;
        const k = j * N + i;
        H[k] += (y - H[k]) * (1 - smooth01(d / blend));
      }
    }
  },
};

// Builds the height grids. M is the loaded map (osm.js).
export function buildElevation(M) {
  const B = new Float32Array(N * N);
  const W = new Float32Array(N * N).fill(-Infinity);
  // Fade to a constant level near the edge of the data so the horizon plane meets it.
  let edge = 0;
  for (let k = 0; k < 400; k++) {
    const a = (k / 400) * Math.PI * 2;
    edge += demAt(Math.cos(a) * 1400, Math.sin(a) * 1400);
  }
  edge /= 400;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = -HALF + i * STEP, z = -HALF + j * STEP;
      const f = smooth01((Math.hypot(x, z) - 1330) / 110) * 0.6 + smooth01((Math.max(Math.abs(x), Math.abs(z)) - 1330) / 110) * 0.4;
      B[j * N + i] = demAt(x, z) * (1 - f) + edge * f;
    }
  }
  const H = new Float32Array(B);
  const range = (v0, v1) => [Math.max(0, Math.floor((v0 + HALF) / STEP)), Math.min(N - 1, Math.ceil((v1 + HALF) / STEP))];
  const baseAt = (x, z) => {
    const gx = clamp((x + HALF) / STEP, 0, N - 1.0001), gz = clamp((z + HALF) / STEP, 0, N - 1.0001);
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, k = j * N + i;
    return (B[k] * (1 - fx) + B[k + 1] * fx) * (1 - fz) + (B[k + N] * (1 - fx) + B[k + N + 1] * fx) * fz;
  };

  // ---------------- Rivers ----------------
  const rivers = [];
  for (const r of M.rivers) {
    const big = r.width >= 12;
    const pts = densify(r.pts, big ? 6 : 4);
    const cum = cumulative(pts);
    const hw = r.width / 2;
    if (!big) {
      rivers.push({ pts, cum, hw, big, wl: null, name: r.name });
      continue;
    }
    const drop = r.width >= 30 ? 3.0 : 2.1;
    const depth = r.width >= 30 ? 3.6 : 2.3;
    const bankW = r.width >= 30 ? 9 : 5.5;
    // Lower bank on either side, smoothed along the river, then a few metres down to the water.
    const bank = pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1];
      const l = Math.hypot(tx, tz) || 1;
      tx /= l;
      tz /= l;
      const off = hw + bankW + 4;
      return Math.min(baseAt(p[0] + tz * off, p[1] - tx * off), baseAt(p[0] - tz * off, p[1] + tx * off));
    });
    const wl = bank.map((_, i) => {
      let s = 0, c = 0;
      for (let k = i; k >= 0 && cum[i] - cum[k] < 160; k--) { s += bank[k]; c++; }
      for (let k = i + 1; k < bank.length && cum[k] - cum[i] < 160; k++) { s += bank[k]; c++; }
      return Math.min(s / c - drop, bank[i] - 1.2);
    });
    const R = hw + bankW;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const [i0, i1] = range(Math.min(ax, bx) - R, Math.max(ax, bx) + R);
      const [j0, j1] = range(Math.min(az, bz) - R, Math.max(az, bz) + R);
      for (let j = j0; j <= j1; j++) {
        for (let gi = i0; gi <= i1; gi++) {
          const x = -HALF + gi * STEP, z = -HALF + j * STEP;
          const [d, t] = segDT(x, z, ax, az, bx, bz);
          if (d > R) continue;
          const k = j * N + gi;
          const w = wl[i] + (wl[i + 1] - wl[i]) * t;
          let h;
          if (d < hw) h = w - 0.05 - depth * (1 - (d / hw) ** 2);
          else if (B[k] <= w) h = B[k];
          else h = w - 0.05 + (B[k] - w + 0.05) * smooth01((d - hw) / bankW);
          if (h < H[k]) H[k] = h;
          if (d < hw + 2.5 && w > W[k]) W[k] = w;
        }
      }
    }
    rivers.push({ pts, cum, hw, big, wl, name: r.name, bankW });
  }

  // ---------------- Ponds ----------------
  const ponds = [];
  for (const w of M.water) {
    const ring = w.pts;
    let wl = Infinity;
    for (const p of densify([...ring, ring[0]], 6)) wl = Math.min(wl, baseAt(p[0], p[1]));
    wl -= 0.55;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const [i0, i1] = range(x0 - 9, x1 + 9);
    const [j0, j1] = range(z0 - 9, z1 + 9);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = -HALF + i * STEP, z = -HALF + j * STEP;
        let d = Infinity;
        for (let q = 0; q < ring.length; q++) d = Math.min(d, segDT(x, z, ...ring[q], ...ring[(q + 1) % ring.length])[0]);
        const inside = pointInPoly(x, z, ring);
        const k = j * N + i;
        let h;
        if (inside) h = wl - Math.min(2.8, 0.25 + d * 0.2);
        else if (d < 8) h = B[k] <= wl ? B[k] : wl + 0.1 + (B[k] - wl - 0.1) * smooth01(d / 8);
        else continue;
        if (h < H[k]) H[k] = h;
        if ((inside || d < 3) && wl > W[k]) W[k] = wl;
      }
    }
    ponds.push({ ring, wide: offsetRing(ring, 3.5), wl });
  }

  // ---------------- Roads sit on embankments across channels ----------------
  for (const r of M.roads) {
    if (r.bridge || r.type === 'path') continue;
    const core = r.width / 2 + 2.2;
    const R = core + 7;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      const [i0, i1] = range(Math.min(ax, bx) - R, Math.max(ax, bx) + R);
      const [j0, j1] = range(Math.min(az, bz) - R, Math.max(az, bz) + R);
      for (let j = j0; j <= j1; j++) {
        for (let gi = i0; gi <= i1; gi++) {
          const x = -HALF + gi * STEP, z = -HALF + j * STEP;
          const [d] = segDT(x, z, ax, az, bx, bz);
          if (d > R) continue;
          const k = j * N + gi;
          const emb = B[k] - Math.max(0, d - core) * 0.75;
          if (emb > H[k]) H[k] = emb;
          // Culverts: no open water under the road.
          if (d < core) W[k] = -Infinity;
        }
      }
    }
  }

  // ---------------- Bridges ----------------
  const waterGrid = (x, z) => {
    const gx = (x + HALF) / STEP, gz = (z + HALF) / STEP;
    const k = Math.floor(gz) * N + Math.floor(gx);
    return Math.max(W[k], W[k + 1], W[k + N], W[k + N + 1]);
  };
  const bridges = [];
  for (const r of M.roads) {
    if (!r.bridge) continue;
    const pts = densify(r.pts, 3);
    const cum = cumulative(pts);
    const L = cum[cum.length - 1];
    if (L < 1) continue;
    const hA = baseAt(...pts[0]);
    const hB = baseAt(...pts[pts.length - 1]);
    const arch = L > 14 ? Math.min(1.3, L * 0.022) : 0;
    const ys = pts.map((p, i) => hA + ((hB - hA) * cum[i]) / L + arch * Math.sin((Math.PI * cum[i]) / L));
    let raise = 0;
    pts.forEach((p, i) => {
      const w = waterGrid(p[0], p[1]);
      if (w > -Infinity) raise = Math.max(raise, w + 2.4 - ys[i]);
    });
    if (raise > 0) for (let i = 0; i < ys.length; i++) ys[i] += raise * Math.sin((Math.PI * cum[i]) / L);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const m = r.width / 2 + 1;
    bridges.push({ pts, cum, ys, len: L, width: r.width, name: r.name, rank: r.rank, x0: x0 - m, x1: x1 + m, z0: z0 - m, z1: z1 + m });
  }

  Object.assign(elev, { B, H, W, rivers, ponds, bridges, edge, ready: true });
  return elev;
}
