// Downloads OpenStreetMap data around a point and writes a compact local-metres JSON.
// Usage: node scripts/fetch-osm.mjs <lat> <lon> <radiusMetres> <outFile>
// Data (c) OpenStreetMap contributors, ODbL. Run once; the result is committed to the repo.
import fs from 'node:fs';
import path from 'node:path';

const [lat0, lon0, radius, out] = [Number(process.argv[2]), Number(process.argv[3]), Number(process.argv[4]), process.argv[5]];
if (!out) throw new Error('usage: fetch-osm.mjs <lat> <lon> <radius> <outFile>');

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const around = `(around:${radius},${lat0},${lon0})`;
const query = `[out:json][timeout:180];
(
  way${around}[highway];
  way${around}[building];
  way${around}[waterway];
  way${around}[natural];
  way${around}[landuse];
  way${around}[leisure];
  way${around}[amenity][~"."~"."];
  relation${around}[building];
  relation${around}[natural=water];
  node${around}[amenity];
  node${around}[shop];
  node${around}[highway~"traffic_signals|street_lamp|crossing"];
  node${around}[natural=tree];
);
out geom tags;`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function download() {
  for (let round = 0; round < 4; round++) {
    for (const url of ENDPOINTS) {
      try {
        console.log('trying', url);
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'User-Agent': 'arcade3d-data-fetch/1.0 (personal project)', 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(query),
          signal: AbortSignal.timeout(200000),
        });
        const text = await res.text();
        if (!res.ok || text.trimStart().startsWith('<') || text.includes('"remark"')) {
          console.log('  failed:', res.status, text.slice(0, 120).replace(/\s+/g, ' '));
          await sleep(4000);
          continue;
        }
        return JSON.parse(text);
      } catch (e) {
        console.log('  error:', e.message);
        await sleep(4000);
      }
    }
    await sleep(15000);
  }
  throw new Error('all Overpass endpoints failed');
}

const raw = await download();
console.log('elements:', raw.elements.length);

const k = Math.cos((lat0 * Math.PI) / 180) * 111320;
const proj = (g) => [Math.round((g.lon - lon0) * k * 10) / 10, Math.round(-(g.lat - lat0) * 110574 * 10) / 10]; // x east, z south
const poly = (geom) => geom.map(proj);
const area = (p) => {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const [x1, z1] = p[i]; const [x2, z2] = p[(i + 1) % p.length]; a += x1 * z2 - x2 * z1; }
  return a / 2;
};
const closed = (g) => g.length > 3 && g[0].lat === g[g.length - 1].lat && g[0].lon === g[g.length - 1].lon;

const data = { origin: { lat: lat0, lon: lon0 }, radius, roads: [], buildings: [], water: [], waterways: [], landuse: [], pois: [], trees: [], lamps: [], signals: [] };
const ROAD_OK = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'service', 'living_street', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'track', 'footway', 'path', 'pedestrian', 'steps', 'cycleway']);

for (const e of raw.elements) {
  const t = e.tags || {};
  if (e.type === 'node') {
    const [x, z] = proj(e);
    if (t.highway === 'street_lamp') data.lamps.push([x, z]);
    else if (t.highway === 'traffic_signals') data.signals.push([x, z]);
    else if (t.natural === 'tree') data.trees.push([x, z]);
    else if (t.name && (t.amenity || t.shop)) data.pois.push({ name: t.name, kind: t.amenity || t.shop, x, z });
    continue;
  }
  const rings = [];
  if (e.type === 'way' && e.geometry) rings.push(e.geometry);
  if (e.type === 'relation') for (const m of e.members || []) if (m.role === 'outer' && m.geometry) rings.push(m.geometry);

  for (const g of rings) {
    if (g.length < 2) continue;
    if (t.highway && ROAD_OK.has(t.highway) && e.type === 'way') {
      data.roads.push({
        type: t.highway, name: t.name || '', oneway: t.oneway === 'yes' || t.oneway === '1' || t.junction === 'roundabout',
        width: t.width ? Number.parseFloat(t.width) || 0 : 0, lanes: t.lanes ? Number.parseInt(t.lanes, 10) || 0 : 0,
        bridge: !!t.bridge && t.bridge !== 'no', pts: poly(g),
      });
    } else if (t.building && closed(g)) {
      const p = poly(g.slice(0, -1));
      const levels = Number.parseFloat(t['building:levels']) || 0;
      const height = Number.parseFloat(t.height) || 0;
      data.buildings.push({ pts: area(p) < 0 ? p.reverse() : p, kind: t.building, levels, height, name: t.name || '', amenity: t.amenity || '', religion: t.religion || '' });
    } else if (t.waterway && e.type === 'way') {
      data.waterways.push({ type: t.waterway, name: t.name || '', width: Number.parseFloat(t.width) || 0, pts: poly(g) });
    } else if ((t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'basin' || t.landuse === 'reservoir') && closed(g)) {
      data.water.push({ pts: poly(g.slice(0, -1)) });
    } else if ((t.landuse || t.natural || t.leisure) && closed(g)) {
      data.landuse.push({ kind: t.landuse || t.natural || t.leisure, pts: poly(g.slice(0, -1)) });
    } else if (t.name && t.amenity && closed(g)) {
      const p = poly(g.slice(0, -1));
      const cx = p.reduce((s, q) => s + q[0], 0) / p.length;
      const cz = p.reduce((s, q) => s + q[1], 0) / p.length;
      data.pois.push({ name: t.name, kind: t.amenity, x: Math.round(cx * 10) / 10, z: Math.round(cz * 10) / 10 });
    }
  }
}
// Named buildings also act as destinations.
for (const b of data.buildings) {
  if (!b.name) continue;
  const cx = b.pts.reduce((s, q) => s + q[0], 0) / b.pts.length;
  const cz = b.pts.reduce((s, q) => s + q[1], 0) / b.pts.length;
  data.pois.push({ name: b.name, kind: b.amenity || b.kind, x: Math.round(cx * 10) / 10, z: Math.round(cz * 10) / 10 });
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(data));

const byType = {};
for (const r of data.roads) byType[r.type] = (byType[r.type] || 0) + 1;
const kinds = {};
for (const l of data.landuse) kinds[l.kind] = (kinds[l.kind] || 0) + 1;
console.log(JSON.stringify({
  file: out, kb: Math.round(fs.statSync(out).size / 1024),
  roads: data.roads.length, roadTypes: byType, namedRoads: new Set(data.roads.filter((r) => r.name).map((r) => r.name)).size,
  buildings: data.buildings.length, withLevels: data.buildings.filter((b) => b.levels).length, namedBuildings: data.buildings.filter((b) => b.name).length,
  waterAreas: data.water.length, waterways: data.waterways.length, landuse: kinds, pois: data.pois.length, trees: data.trees.length, lamps: data.lamps.length, signals: data.signals.length,
}, null, 1));
