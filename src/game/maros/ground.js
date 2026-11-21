import * as THREE from 'three';
import * as tex from '../../core/textures.js';
import { pointInPoly } from '../colliders.js';
import { elev, N, STEP, HALF, smooth01 } from './elevation.js';

// Terrain mesh for the elevation grid: 9x9 chunks of 320 m, each with three levels of detail
// (4, 8 and 16 m) and skirts that hide cracks between levels. Every vertex carries a tint and a
// grass/soil blend factor derived from the map: rice fields, parks, yards around houses, gravel
// road shoulders, greener ground under trees, muddy river banks and dark silt underwater.

const CS = 80; // cells per chunk
const CHUNKS = (N - 1) / CS;
const LOD_DIST = [520, 1150];

// Smooth value noise for natural variation.
function hash(x, z) {
  let h = (x * 374761393 + z * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const fx = smooth01(x - xi), fz = smooth01(z - zi);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
}

// Fill a polygon on the grid (scanline), calling fn(k) for each vertex inside.
function rasterPoly(pts, fn) {
  let z0 = Infinity, z1 = -Infinity;
  for (const p of pts) { z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
  const j0 = Math.max(0, Math.ceil((z0 + HALF) / STEP)), j1 = Math.min(N - 1, Math.floor((z1 + HALF) / STEP));
  const xs = [];
  for (let j = j0; j <= j1; j++) {
    const z = -HALF + j * STEP;
    xs.length = 0;
    for (let i = 0, k = pts.length - 1; i < pts.length; k = i++) {
      const [xa, za] = pts[i], [xb, zb] = pts[k];
      if (za > z !== zb > z) xs.push(xa + ((z - za) * (xb - xa)) / (zb - za));
    }
    xs.sort((a, b) => a - b);
    for (let q = 0; q + 1 < xs.length; q += 2) {
      const i0 = Math.max(0, Math.ceil((xs[q] + HALF) / STEP)), i1 = Math.min(N - 1, Math.floor((xs[q + 1] + HALF) / STEP));
      for (let i = i0; i <= i1; i++) fn(j * N + i);
    }
  }
}

// Visit grid vertices within r of segment AB: fn(k, d).
function nearSeg(ax, az, bx, bz, r, fn) {
  const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - r + HALF) / STEP)), i1 = Math.min(N - 1, Math.ceil((Math.max(ax, bx) + r + HALF) / STEP));
  const j0 = Math.max(0, Math.floor((Math.min(az, bz) - r + HALF) / STEP)), j1 = Math.min(N - 1, Math.ceil((Math.max(az, bz) + r + HALF) / STEP));
  const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const x = -HALF + i * STEP, z = -HALF + j * STEP;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2));
      const d = Math.hypot(x - ax - vx * t, z - az - vz * t);
      if (d <= r) fn(j * N + i, d);
    }
  }
}

export function buildGround(scene, M) {
  const H = elev.H;
  const W = elev.W;
  const n = N * N;

  // ---------------- Surface classification ----------------
  const LU = { farmland: 1, meadow: 2, open_field_space: 3, forest: 4, park: 5, industrial: 6, commercial: 6 };
  const land = new Uint8Array(n);
  for (const l of M.landuse) if (LU[l.kind]) rasterPoly(l.pts, (k) => (land[k] = LU[l.kind]));
  const yard = new Float32Array(n);
  for (const b of M.buildings) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of b.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const i0 = Math.max(0, Math.floor((x0 - 5 + HALF) / STEP)), i1 = Math.min(N - 1, Math.ceil((x1 + 5 + HALF) / STEP));
    const j0 = Math.max(0, Math.floor((z0 - 5 + HALF) / STEP)), j1 = Math.min(N - 1, Math.ceil((z1 + 5 + HALF) / STEP));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = -HALF + i * STEP, z = -HALF + j * STEP;
      const inside = pointInPoly(x, z, b.pts);
      const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1);
      const v = inside ? 1 : 1 - smooth01(Math.hypot(dx, dz) / 5);
      const k = j * N + i;
      if (v > yard[k]) yard[k] = v;
    }
  }
  const shoulder = new Float32Array(n);
  for (const r of M.roads) {
    if (r.type === 'path') continue;
    const w = r.width / 2;
    for (let i = 0; i < r.pts.length - 1; i++) {
      nearSeg(...r.pts[i], ...r.pts[i + 1], w + 2.2, (k, d) => {
        const v = d < w + 0.6 ? 1 : 1 - (d - w - 0.6) / 1.6;
        if (v > shoulder[k]) shoulder[k] = v;
      });
    }
  }
  const shade = new Float32Array(n);
  for (const [x, z, s] of M.trees) {
    nearSeg(x, z, x, z, 6 * Math.max(0.8, s), (k, d) => {
      const v = 1 - d / (6 * Math.max(0.8, s));
      if (v > shade[k]) shade[k] = v;
    });
  }

  // ---------------- Per-vertex attributes ----------------
  const nor = new Int8Array(n * 3);
  const col = new Uint8Array(n * 3);
  const grass = new Uint8Array(n);
  const PAL = {
    0: [0.86, 0.86, 0.8, 0.72], // open ground: grass and soil
    1: [0.95, 1.0, 0.72, 1.0], // farmland (sawah)
    2: [0.9, 0.92, 0.78, 0.92],
    3: [0.92, 0.9, 0.8, 0.55],
    4: [0.62, 0.74, 0.6, 1.0], // forest
    5: [0.85, 0.98, 0.82, 1.0], // park
    6: [0.82, 0.8, 0.78, 0.15], // industrial / commercial yards
  };
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const x = -HALF + i * STEP, z = -HALF + j * STEP;
      // Normal from the full-resolution grid.
      const hl = H[j * N + Math.max(0, i - 1)], hr = H[j * N + Math.min(N - 1, i + 1)];
      const hu = H[Math.max(0, j - 1) * N + i], hd = H[Math.min(N - 1, j + 1) * N + i];
      let nx = -(hr - hl) / (2 * STEP), ny = 1, nz = -(hd - hu) / (2 * STEP);
      const nl = Math.hypot(nx, ny, nz);
      nor[k * 3] = Math.round((nx / nl) * 127);
      nor[k * 3 + 1] = Math.round((ny / nl) * 127);
      nor[k * 3 + 2] = Math.round((nz / nl) * 127);

      const p = PAL[land[k]];
      let r = p[0], g = p[1], b = p[2], gr = p[3];
      if (land[k] === 1) {
        const plot = hash(Math.floor((x + 7) / 24), Math.floor((z + 3) / 16));
        if (plot < 0.18) { r = 0.62; g = 0.64; b = 0.6; gr = 0.25; } // flooded, just planted
        else if (plot < 0.4) { r = 1.0; g = 0.93; b = 0.55; } // ripening
        else if (plot < 0.75) { r = 0.82; g = 1.0; b = 0.62; }
        // Dikes (pematang) between plots.
        const px = ((x + 7) % 24 + 24) % 24, pz = ((z + 3) % 16 + 16) % 16;
        if (px < 2 || pz < 2) { r *= 0.85; g *= 0.85; b *= 0.8; gr = 0.6; }
      }
      const n1 = noise(x / 37, z / 37), n2 = noise(x / 9 + 50, z / 9 - 20);
      const v = 0.86 + n1 * 0.2 + (n2 - 0.5) * 0.1;
      r *= v; g *= v; b *= v;
      gr = Math.min(1, gr + (n1 - 0.5) * 0.5);
      // Yards and road shoulders: trodden soil.
      if (yard[k] > 0 && land[k] !== 1) {
        gr *= 1 - yard[k] * 0.8;
        r *= 1 + yard[k] * 0.05;
      }
      if (shoulder[k] > 0) {
        gr *= 1 - shoulder[k] * 0.9;
        const t = shoulder[k] * 0.35;
        r = r * (1 - t) + 0.8 * t; g = g * (1 - t) + 0.78 * t; b = b * (1 - t) + 0.74 * t;
      }
      // Under trees: greener, a little darker.
      if (shade[k] > 0) {
        gr = Math.min(1, gr + shade[k] * 0.5);
        const s = 1 - shade[k] * 0.16;
        r *= s * 0.96; g *= s; b *= s * 0.94;
      }
      // Slopes show more soil.
      const slope = 1 - ny / nl;
      if (slope > 0.04) gr *= Math.max(0.3, 1 - (slope - 0.04) * 6);
      // River beds and banks.
      const w = W[k];
      if (w > -Infinity) {
        const dep = w - H[k];
        if (dep > 0) {
          const t = Math.min(1, dep / 1.5);
          gr *= 0.2 * (1 - t);
          r *= 0.72 - t * 0.2; g *= 0.68 - t * 0.2; b *= 0.6 - t * 0.18;
        } else if (dep > -1.2) {
          const t = 1 + dep / 1.2;
          gr *= 1 - t * 0.6;
          r *= 1 - t * 0.25; g *= 1 - t * 0.27; b *= 1 - t * 0.3;
        }
      } else {
        // Dry ground well below the natural level (deep channel side) stays muddy.
        const cut = elev.B[k] - H[k];
        if (cut > 1.2) {
          const t = Math.min(1, (cut - 1.2) / 2);
          gr *= 1 - t * 0.5;
          r *= 1 - t * 0.15; g *= 1 - t * 0.18; b *= 1 - t * 0.2;
        }
      }
      col[k * 3] = Math.round(Math.min(1, r) * 255);
      col[k * 3 + 1] = Math.round(Math.min(1, g) * 255);
      col[k * 3 + 2] = Math.round(Math.min(1, b) * 255);
      grass[k] = Math.round(Math.max(0, Math.min(1, gr)) * 255);
    }
  }

  // ---------------- Material ----------------
  const soil = tex.soil();
  const grs = tex.grass({ repeat: 1 });
  const mat = new THREE.MeshStandardMaterial({ map: soil.map, normalMap: soil.normalMap, normalScale: new THREE.Vector2(0.7, 0.7), vertexColors: true, roughness: 0.96 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.grassMap = { value: grs.map };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGrass;\nvarying float vGrass;')
      .replace('#include <uv_vertex>', 'vec2 wuv = position.xz * 0.16;\nvMapUv = wuv;\nvNormalMapUv = wuv;\nvGrass = aGrass;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D grassMap;\nvarying float vGrass;')
      .replace(
        '#include <map_fragment>',
        `// Two scales of each texture hide the tiling; far away they fade to their average colour.
        float fd = smoothstep( 25.0, 260.0, length( vViewPosition ) );
        vec4 sSoil = mix( texture2D( map, vMapUv ), texture2D( map, vMapUv * 0.137 + 0.31 ), 0.45 );
        vec4 sGrass = mix( texture2D( grassMap, vMapUv * 0.71 + 0.13 ), texture2D( grassMap, vMapUv * 0.093 + 0.57 ), 0.5 );
        sSoil = mix( sSoil, vec4( 0.29, 0.23, 0.15, 1.0 ), fd * 0.75 );
        sGrass = mix( sGrass, vec4( 0.075, 0.15, 0.04, 1.0 ), fd * 0.75 );
        diffuseColor *= mix( sSoil, sGrass, vGrass );`,
      );
  };
  mat.customProgramCacheKey = () => 'pettuadae-ground';

  // ---------------- Chunks ----------------
  const skirt = 2.5;
  function chunkGeo(ci, cj, stride) {
    const m = CS / stride + 1;
    const nv = m * m + 4 * m;
    const pos = new Float32Array(nv * 3);
    const nrm = new Int8Array(nv * 3);
    const c = new Uint8Array(nv * 3);
    const gr = new Uint8Array(nv);
    const idx = [];
    const put = (v, k, dy) => {
      const i = k % N, j = Math.floor(k / N);
      pos[v * 3] = -HALF + i * STEP;
      pos[v * 3 + 1] = H[k] + dy;
      pos[v * 3 + 2] = -HALF + j * STEP;
      for (let q = 0; q < 3; q++) {
        nrm[v * 3 + q] = nor[k * 3 + q];
        c[v * 3 + q] = col[k * 3 + q];
      }
      gr[v] = grass[k];
    };
    const kOf = (a, b) => (cj * CS + b * stride) * N + ci * CS + a * stride;
    for (let b = 0; b < m; b++) for (let a = 0; a < m; a++) put(b * m + a, kOf(a, b), 0);
    for (let b = 0; b < m - 1; b++) {
      for (let a = 0; a < m - 1; a++) {
        const va = b * m + a, vb = va + 1, vc = va + m, vd = vc + 1;
        idx.push(va, vc, vb, vb, vc, vd);
      }
    }
    // Skirts hanging below each border.
    const borders = [
      Array.from({ length: m }, (_, a) => [a, 0]),
      Array.from({ length: m }, (_, b) => [m - 1, b]),
      Array.from({ length: m }, (_, a) => [m - 1 - a, m - 1]),
      Array.from({ length: m }, (_, b) => [0, m - 1 - b]),
    ];
    let v = m * m;
    for (const line of borders) {
      const start = v;
      for (const [a, b] of line) put(v++, kOf(a, b), -skirt);
      for (let q = 0; q < m - 1; q++) {
        const top0 = line[q][1] * m + line[q][0], top1 = line[q + 1][1] * m + line[q + 1][0];
        idx.push(top0, top1, start + q, top1, start + q + 1, start + q);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3, true));
    g.setAttribute('color', new THREE.BufferAttribute(c, 3, true));
    g.setAttribute('aGrass', new THREE.BufferAttribute(gr, 1, true));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }

  const group = new THREE.Group();
  group.userData.dynamic = true; // LOD switching changes children
  scene.add(group);
  const chunks = [];
  for (let cj = 0; cj < CHUNKS; cj++) {
    for (let ci = 0; ci < CHUNKS; ci++) {
      const cx = -HALF + (ci + 0.5) * CS * STEP, cz = -HALF + (cj + 0.5) * CS * STEP;
      const mesh = new THREE.Mesh(chunkGeo(ci, cj, 4), mat);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
      chunks.push({ ci, cj, cx, cz, mesh, lod: 2, geos: [null, null, mesh.geometry] });
    }
  }

  // ---------------- Horizon: flat ground around the data square ----------------
  const outer = new THREE.Shape([new THREE.Vector2(-4000, -4000), new THREE.Vector2(4000, -4000), new THREE.Vector2(4000, 4000), new THREE.Vector2(-4000, 4000)]);
  const e = HALF - 2;
  outer.holes.push(new THREE.Path([new THREE.Vector2(-e, -e), new THREE.Vector2(-e, e), new THREE.Vector2(e, e), new THREE.Vector2(e, -e)]));
  const far = new THREE.Mesh(new THREE.ShapeGeometry(outer).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6f7f48, roughness: 1 }));
  far.position.y = elev.edge - 0.3;
  far.receiveShadow = true;
  scene.add(far);

  const half = (CS * STEP) / 2;
  return {
    material: mat,
    // Choose each chunk's detail level from the camera position.
    update(px, pz) {
      for (const c of chunks) {
        const dx = Math.max(0, Math.abs(px - c.cx) - half), dz = Math.max(0, Math.abs(pz - c.cz) - half);
        const d = Math.hypot(dx, dz);
        const lod = d < LOD_DIST[0] ? 0 : d < LOD_DIST[1] ? 1 : 2;
        if (lod === c.lod) continue;
        c.lod = lod;
        c.geos[lod] ||= chunkGeo(c.ci, c.cj, [1, 2, 4][lod]);
        c.mesh.geometry = c.geos[lod];
      }
    },
  };
}
