// Downloads terrain elevation around Pettuadae (AWS Terrain Tiles, "terrarium" encoding, z15 ~4.8 m/px)
// and writes a smoothed ground-height grid in the game's local metre coordinates.
// Usage: npm i -D pngjs && node scripts/fetch-elevation.mjs
// Source: Mapzen/AWS Terrain Tiles (SRTM, GMTED, NED, ...), open data.
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const LAT0 = -5.01425, LON0 = 119.57761;
const R = 1450; // metres covered around the origin
const STEP = 8; // output grid spacing (m)
const Z = 15;
const OUT = 'src/game/maros/data/pettuadae-elevation.json';
const CACHE = 'scripts/.cache/terrarium';

const N = 2 ** Z;
const kx = Math.cos((LAT0 * Math.PI) / 180) * 111320;
const toPix = (lat, lon) => {
  const r = (lat * Math.PI) / 180;
  return [((lon + 180) / 360) * N * 256, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * N * 256];
};
const local2ll = (x, z) => [LAT0 - z / 110574, LON0 + x / kx];

fs.mkdirSync(CACHE, { recursive: true });
const tiles = new Map();
async function tile(tx, ty) {
  const k = `${tx},${ty}`;
  if (tiles.has(k)) return tiles.get(k);
  const f = path.join(CACHE, `${Z}_${tx}_${ty}.png`);
  if (!fs.existsSync(f)) {
    const res = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${tx}/${ty}.png`);
    if (!res.ok) throw new Error(`tile ${k}: HTTP ${res.status}`);
    fs.writeFileSync(f, Buffer.from(await res.arrayBuffer()));
  }
  const png = PNG.sync.read(fs.readFileSync(f));
  tiles.set(k, png);
  return png;
}
async function elevationAt(x, z) {
  const [px, py] = toPix(...local2ll(x, z));
  // Bilinear sample of the decoded heights.
  const sample = async (gx, gy) => {
    const t = await tile(Math.floor(gx / 256), Math.floor(gy / 256));
    const i = ((Math.floor(gy) % 256) * 256 + (Math.floor(gx) % 256)) * 4;
    return t.data[i] * 256 + t.data[i + 1] + t.data[i + 2] / 256 - 32768;
  };
  const x0 = Math.floor(px - 0.5), y0 = Math.floor(py - 0.5);
  const fx = px - 0.5 - x0, fy = py - 0.5 - y0;
  const a = await sample(x0, y0), b = await sample(x0 + 1, y0), c = await sample(x0, y0 + 1), d = await sample(x0 + 1, y0 + 1);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

const n = Math.floor((2 * R) / STEP) + 1;
let grid = new Float32Array(n * n);
for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) grid[j * n + i] = await elevationAt(-R + i * STEP, -R + j * STEP);
const mm = (a) => a.reduce((r, v) => [Math.min(r[0], v), Math.max(r[1], v)], [Infinity, -Infinity]);
console.log('raw range', ...mm(grid).map((v) => v.toFixed(1)));

// Radar DEMs include roofs and tree canopy. A morphological opening (min then max filter, ~24 m)
// removes those bumps; a wide Gaussian-ish blur then gives smooth, drivable ground.
const filt = (src, rad, fn) => {
  const out = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    let v = fn === 'min' ? Infinity : -Infinity;
    for (let b = -rad; b <= rad; b++) for (let a = -rad; a <= rad; a++) {
      const ii = Math.min(n - 1, Math.max(0, i + a)), jj = Math.min(n - 1, Math.max(0, j + b));
      const s = src[jj * n + ii];
      v = fn === 'min' ? Math.min(v, s) : Math.max(v, s);
    }
    out[j * n + i] = v;
  }
  return out;
};
const blur = (src, rad) => {
  let a = src;
  for (let pass = 0; pass < 3; pass++) {
    const out = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      let s = 0, c = 0;
      for (let b = -rad; b <= rad; b++) for (let q = -rad; q <= rad; q++) {
        const ii = Math.min(n - 1, Math.max(0, i + q)), jj = Math.min(n - 1, Math.max(0, j + b));
        s += a[jj * n + ii];
        c++;
      }
      out[j * n + i] = s / c;
    }
    a = out;
  }
  return a;
};
grid = filt(filt(grid, 3, 'min'), 3, 'max');
grid = blur(grid, 5); // ~45 m Gaussian: keeps the real slopes, drops radar noise from roofs and trees
const [min, max] = mm(grid);
console.log('ground range after cleanup', min.toFixed(1), max.toFixed(1));

// Store heights relative to the lowest point, in centimetres.
const cm = Array.from(grid, (v) => Math.round((v - min) * 100));
fs.writeFileSync(OUT, JSON.stringify({ source: 'AWS Terrain Tiles (terrarium z15), opened + smoothed', origin: [LAT0, LON0], step: STEP, size: n, half: R, base: +min.toFixed(2), cm }));
console.log('written', OUT, Math.round(fs.statSync(OUT).size / 1024) + ' KB', n + 'x' + n);
