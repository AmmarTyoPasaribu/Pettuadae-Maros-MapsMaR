// Estimates the paved width of every OSM road from satellite imagery (cached z18 tiles,
// ~0.6 m/pixel). At stations every 12 m it scans perpendicular to the road for asphalt/concrete
// pixels (grey, low saturation, not vegetation) and keeps the median of the good stations.
// Usage: node scripts/sample-imagery.mjs (fills the tile cache), then node scripts/measure-roads.mjs
import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';

const DATA = 'src/game/maros/data/pettuadae.json';
const OUT = 'src/game/maros/data/pettuadae-roads.json';
const CACHE = 'scripts/.cache/tiles';
const Z = 18;
const raw = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const { lat: lat0, lon: lon0 } = raw.origin;
const kx = Math.cos((lat0 * Math.PI) / 180) * 111320;
const N = 2 ** Z;
const toPix = (x, z) => {
  const lat = lat0 - z / 110574;
  const lon = lon0 + x / kx;
  const r = (lat * Math.PI) / 180;
  return [((lon + 180) / 360) * N * 256, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * N * 256];
};
const tiles = new Map();
function pixel(x, z) {
  const [gx, gy] = toPix(x, z);
  const tx = Math.floor(gx / 256), ty = Math.floor(gy / 256);
  const key = `${tx},${ty}`;
  if (!tiles.has(key)) {
    const f = path.join(CACHE, `${Z}_${tx}_${ty}.jpg`);
    tiles.set(key, fs.existsSync(f) ? jpeg.decode(fs.readFileSync(f), { useTArray: true }) : null);
  }
  const t = tiles.get(key);
  if (!t) return null;
  const i = ((Math.floor(gy) % 256) * 256 + (Math.floor(gx) % 256)) * 4;
  return [t.data[i], t.data[i + 1], t.data[i + 2]];
}
const paved = (c) => {
  if (!c) return false;
  const [r, g, b] = c;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (r + g + b) / 3;
  const exg = (2 * g - r - b) / (r + g + b + 1);
  return mx - mn < 34 && l > 62 && l < 215 && exg < 0.06;
};

// Plausible paved widths per road class (metres).
const RANGE = {
  trunk: [7, 20], primary: [7, 18], secondary: [6, 14], tertiary: [5, 12], unclassified: [4, 9],
  residential: [3, 8], service: [2.5, 6.5], living_street: [2.5, 6], trunk_link: [4, 9], secondary_link: [4, 8],
};

const widths = raw.roads.map((r) => {
  const range = RANGE[r.type];
  if (!range) return 0;
  const pts = r.pts;
  const found = [];
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1) continue;
    const dx = (bx - ax) / len, dz = (bz - az) / len;
    const nx = dz, nz = -dx;
    for (let s = (12 - (acc % 12)) % 12; s < len; s += 12) {
      const cx = ax + dx * s, cz = az + dz * s;
      if (Math.hypot(cx, cz) > 1290) continue;
      if (!paved(pixel(cx, cz))) continue;
      const side = (sgn) => {
        let miss = 0, last = 0;
        for (let d = 0.3; d < 13; d += 0.3) {
          if (paved(pixel(cx + nx * d * sgn, cz + nz * d * sgn))) { last = d; miss = 0; } else if (++miss >= 3) break;
        }
        return last;
      };
      const w = side(1) + side(-1) + 0.4;
      if (w >= range[0] * 0.7 && w <= range[1] * 1.3) found.push(w);
    }
    acc += len;
  }
  if (found.length < 3) return 0;
  found.sort((a, b) => a - b);
  const med = found[Math.floor(found.length / 2)];
  return Math.round(Math.max(range[0], Math.min(range[1], med)) * 10) / 10;
});

fs.writeFileSync(OUT, JSON.stringify({ source: 'Measured from Esri World Imagery (z18) along OSM centre lines', widths }));
const byType = {};
raw.roads.forEach((r, i) => {
  if (!widths[i]) return;
  (byType[r.type] ||= []).push(widths[i]);
});
const named = {};
raw.roads.forEach((r, i) => { if (r.name && widths[i]) (named[r.name] ||= []).push(widths[i]); });
console.log('measured', widths.filter(Boolean).length, 'of', raw.roads.length);
for (const [t, ws] of Object.entries(byType)) { ws.sort((a, b) => a - b); console.log(t.padEnd(14), 'n=' + ws.length, 'median', ws[ws.length >> 1], 'min', ws[0], 'max', ws[ws.length - 1]); }
for (const n of ['Jalan Jenderal Sudirman', 'Jalan Sultan Hasanuddin', 'Jalan Ahmad Yani', 'Jalan A.P. Petterani', 'Jalan Bambu Runcing', 'Jalan Gladiol', 'Jalan Asoka']) if (named[n]) console.log(n, JSON.stringify(named[n]));
