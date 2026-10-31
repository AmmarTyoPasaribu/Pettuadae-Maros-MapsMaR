// Derives per-building roof colours and tree positions from satellite imagery.
// Usage: node scripts/sample-imagery.mjs
// Imagery: Esri World Imagery (Source: Esri, Maxar, Earthstar Geographics). Only derived
// colours/positions are stored; tiles are cached locally in scripts/.cache and not shipped.
import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';

const DATA = 'src/game/maros/data/pettuadae.json';
const OUT = 'src/game/maros/data/pettuadae-imagery.json';
const CACHE = 'scripts/.cache/tiles';
const Z = 18;
const R = 1310;

const raw = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const { lat: lat0, lon: lon0 } = raw.origin;
const kx = Math.cos((lat0 * Math.PI) / 180) * 111320;
const toLatLon = (x, z) => [lat0 - z / 110574, lon0 + x / kx];
const N = 2 ** Z;
const toPix = (lat, lon) => {
  const r = (lat * Math.PI) / 180;
  return [((lon + 180) / 360) * N * 256, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * N * 256];
};

const [la, lo] = toLatLon(-R, -R);
const [lb, lp] = toLatLon(R, R);
const [px0, py0] = toPix(la, lo);
const [px1, py1] = toPix(lb, lp);
const tx0 = Math.floor(Math.min(px0, px1) / 256), tx1 = Math.floor(Math.max(px0, px1) / 256);
const ty0 = Math.floor(Math.min(py0, py1) / 256), ty1 = Math.floor(Math.max(py0, py1) / 256);
console.log(`tiles x ${tx0}-${tx1}, y ${ty0}-${ty1} (${(tx1 - tx0 + 1) * (ty1 - ty0 + 1)} tiles)`);

fs.mkdirSync(CACHE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getTile(x, y) {
  const f = path.join(CACHE, `${Z}_${x}_${y}.jpg`);
  if (!fs.existsSync(f)) {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await fetch(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${Z}/${y}/${x}`, { headers: { 'User-Agent': 'arcade3d-imagery/1.0 (personal project)' } });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        fs.writeFileSync(f, Buffer.from(await res.arrayBuffer()));
        break;
      } catch (e) {
        console.log('retry', x, y, e.message);
        await sleep(1500 * (attempt + 1));
      }
    }
  }
  return jpeg.decode(fs.readFileSync(f), { useTArray: true });
}

const tiles = new Map();
const jobs = [];
for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) jobs.push([x, y]);
let done = 0;
async function worker() {
  while (jobs.length) {
    const [x, y] = jobs.shift();
    tiles.set(`${x},${y}`, await getTile(x, y));
    if (++done % 40 === 0) console.log('tiles', done);
    await sleep(60);
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);

function pixel(gx, gy) {
  const t = tiles.get(`${Math.floor(gx / 256)},${Math.floor(gy / 256)}`);
  if (!t || t.width !== 256) return null;
  const i = ((Math.floor(gy) % 256) * 256 + (Math.floor(gx) % 256)) * 4;
  return [t.data[i], t.data[i + 1], t.data[i + 2]];
}
const sample = (x, z) => pixel(...toPix(...toLatLon(x, z)));

function pip(x, z, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
const edgeDist = (x, z, pts) => {
  let d = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
    const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1;
    const k = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2));
    d = Math.min(d, Math.hypot(x - ax - vx * k, z - az - vz * k));
  }
  return d;
};

// ---------------- Roof colours ----------------
const hex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const roofs = [];
for (const b of raw.buildings) {
  const pts = b.pts;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const step = Math.max(0.6, Math.sqrt(((x1 - x0) * (z1 - z0)) / 300));
  const px = [];
  for (let x = x0; x <= x1; x += step) {
    for (let z = z0; z <= z1; z += step) {
      if (!pip(x, z, pts) || edgeDist(x, z, pts) < 0.7) continue;
      const c = sample(x, z);
      if (c) px.push(c);
    }
  }
  if (px.length < 3) { roofs.push(''); continue; }
  // Robust colour: drop the darkest and brightest quarter (shadows, glare), average the rest.
  px.sort((a, c) => a[0] + a[1] + a[2] - (c[0] + c[1] + c[2]));
  const mid = px.slice(Math.floor(px.length * 0.25), Math.ceil(px.length * 0.75));
  const avg = [0, 1, 2].map((k) => mid.reduce((s, c) => s + c[k], 0) / mid.length);
  roofs.push(hex(avg));
}

// ---------------- Trees from vegetation (excess-green index) ----------------
const STEP = 9;
const trees = [];
const cols = Math.ceil((2 * R) / STEP);
const veg = new Uint8Array(cols * cols);
for (let i = 0; i < cols; i++) {
  for (let j = 0; j < cols; j++) {
    const cx = -R + (i + 0.5) * STEP, cz = -R + (j + 0.5) * STEP;
    if (Math.hypot(cx, cz) > R - 10) continue;
    let g = 0, n = 0;
    for (const [ox, oz] of [[0, 0], [-3, -3], [3, -3], [-3, 3], [3, 3]]) {
      const c = sample(cx + ox, cz + oz);
      if (!c) continue;
      n++;
      const [r, gg, b] = c;
      const exg = (2 * gg - r - b) / (r + gg + b + 1);
      // Canopy is green, fairly dark and textured; lawns/rice fields are brighter.
      if (exg > 0.07 && gg < 150 && r + gg + b < 380) g++;
    }
    if (n && g >= 3) veg[i * cols + j] = g;
  }
}
for (let i = 0; i < cols; i++) {
  for (let j = 0; j < cols; j++) {
    const v = veg[i * cols + j];
    if (!v) continue;
    let nb = 0;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (veg[(i + a) * cols + (j + b)]) nb++;
    const x = -R + (i + 0.5) * STEP, z = -R + (j + 0.5) * STEP;
    // Denser canopy -> bigger trees.
    trees.push([Math.round(x * 10) / 10, Math.round(z * 10) / 10, Math.round((0.75 + nb * 0.07 + v * 0.03) * 100) / 100]);
  }
}

fs.writeFileSync(OUT, JSON.stringify({ source: 'Esri World Imagery (Esri, Maxar, Earthstar Geographics)', roofs, trees }));
const coloured = roofs.filter(Boolean).length;
console.log(JSON.stringify({ out: OUT, kb: Math.round(fs.statSync(OUT).size / 1024), buildings: roofs.length, coloured, trees: trees.length }));
