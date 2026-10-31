import * as THREE from 'three';

// Procedural canvas textures: no external assets needed.

function rand(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

function toTexture(c, repeat = 1, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Height canvas (grayscale) -> tangent-space normal map.
function normalFromHeight(hc, strength = 2) {
  const size = hc.width;
  const src = hc.getContext('2d').getImageData(0, 0, size, size).data;
  const [c, ctx] = canvas(size);
  const out = ctx.createImageData(size, size);
  const h = (x, y) => src[(((y + size) % size) * size + ((x + size) % size)) * 4] / 255;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (h(x - 1, y) - h(x + 1, y)) * strength;
      const dy = (h(x, y - 1) - h(x, y + 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      out.data[i] = ((dx / len) * 0.5 + 0.5) * 255;
      out.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      out.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return c;
}

function speckle(ctx, size, count, colors, minR, maxR, r) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[Math.floor(r() * colors.length)];
    const s = minR + r() * (maxR - minR);
    ctx.globalAlpha = 0.25 + r() * 0.6;
    ctx.fillRect(r() * size, r() * size, s, s);
  }
  ctx.globalAlpha = 1;
}

export function asphalt({ repeat = 8, size = 512, seed = 7, base = '#2b2c2f' } = {}) {
  const r = rand(seed);
  const [c, ctx] = canvas(size);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  speckle(ctx, size, 26000, ['#1d1e20', '#3a3b3f', '#46474a', '#232427', '#555'], 1, 2.4, r);
  for (let i = 0; i < 18; i++) {
    ctx.strokeStyle = 'rgba(15,15,16,0.35)';
    ctx.lineWidth = 1 + r() * 1.5;
    ctx.beginPath();
    let x = r() * size, y = r() * size;
    ctx.moveTo(x, y);
    for (let k = 0; k < 6; k++) ctx.lineTo((x += (r() - 0.5) * 50), (y += (r() - 0.5) * 50));
    ctx.stroke();
  }
  const [hc, hctx] = canvas(size);
  hctx.fillStyle = '#808080';
  hctx.fillRect(0, 0, size, size);
  speckle(hctx, size, 30000, ['#000', '#fff', '#555', '#aaa'], 1, 2, r);
  return { map: toTexture(c, repeat), normalMap: toTexture(normalFromHeight(hc, 3), repeat, false) };
}

export function grass({ repeat = 20, size = 512, seed = 3 } = {}) {
  const r = rand(seed);
  const [c, ctx] = canvas(size);
  ctx.fillStyle = '#3f6a2a';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 40; i++) {
    const g = ctx.createRadialGradient(r() * size, r() * size, 0, r() * size, r() * size, 60 + r() * 80);
    ctx.fillStyle = g;
    g.addColorStop(0, r() > 0.5 ? 'rgba(90,130,50,0.35)' : 'rgba(40,70,25,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillRect(0, 0, size, size);
  }
  for (let i = 0; i < 16000; i++) {
    const x = r() * size, y = r() * size;
    ctx.strokeStyle = ['#4f7f33', '#2f5420', '#6c9a42', '#3b6326', '#7da84f'][Math.floor(r() * 5)];
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (r() - 0.5) * 3, y - 3 - r() * 4);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const [hc, hctx] = canvas(size);
  hctx.drawImage(c, 0, 0);
  return { map: toTexture(c, repeat), normalMap: toTexture(normalFromHeight(hc, 2), repeat, false) };
}

export function concrete({ repeat = 6, size = 512, seed = 11, base = '#8d8b86', tiles = 0 } = {}) {
  const r = rand(seed);
  const [c, ctx] = canvas(size);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 60; i++) {
    const x = r() * size, y = r() * size, rad = 30 + r() * 90;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(${r() > 0.5 ? '255,255,255' : '0,0,0'},0.06)`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  speckle(ctx, size, 14000, ['#6f6d69', '#a3a19c', '#5c5a57', '#b5b3ad'], 1, 2, r);
  if (tiles) {
    ctx.strokeStyle = 'rgba(30,30,30,0.55)';
    ctx.lineWidth = 3;
    const step = size / tiles;
    for (let i = 0; i <= tiles; i++) {
      ctx.beginPath(); ctx.moveTo(i * step, 0); ctx.lineTo(i * step, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * step); ctx.lineTo(size, i * step); ctx.stroke();
    }
  }
  const [hc, hctx] = canvas(size);
  hctx.drawImage(c, 0, 0);
  return { map: toTexture(c, repeat), normalMap: toTexture(normalFromHeight(hc, 2.5), repeat, false) };
}

export function wood({ repeat = 1, size = 512, seed = 5, light = '#c99a62', dark = '#8a5a2e', planks = 6 } = {}) {
  const r = rand(seed);
  const [c, ctx] = canvas(size);
  const ph = size / planks;
  for (let p = 0; p < planks; p++) {
    const tint = (r() - 0.5) * 30;
    ctx.fillStyle = shade(light, tint);
    ctx.fillRect(0, p * ph, size, ph);
    for (let i = 0; i < 70; i++) {
      ctx.strokeStyle = shade(dark, tint + (r() - 0.5) * 20);
      ctx.globalAlpha = 0.15 + r() * 0.3;
      ctx.lineWidth = 0.5 + r() * 1.8;
      const y0 = p * ph + r() * ph;
      ctx.beginPath();
      ctx.moveTo(0, y0);
      for (let x = 0; x <= size; x += 16) ctx.lineTo(x, y0 + Math.sin(x * 0.02 + i) * 2 + (r() - 0.5) * 1.5);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (r() > 0.4) {
      const kx = r() * size, ky = p * ph + ph * (0.3 + r() * 0.4);
      const g = ctx.createRadialGradient(kx, ky, 1, kx, ky, 10 + r() * 8);
      g.addColorStop(0, shade(dark, -40));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(kx - 20, ky - 20, 40, 40);
    }
    ctx.fillStyle = 'rgba(30,15,5,0.6)';
    ctx.fillRect(0, p * ph, size, 2);
  }
  const [hc, hctx] = canvas(size);
  hctx.filter = 'grayscale(1)';
  hctx.drawImage(c, 0, 0);
  return { map: toTexture(c, repeat), normalMap: toTexture(normalFromHeight(hc, 1.5), repeat, false) };
}

export function dirt({ repeat = 10, size = 512, seed = 21 } = {}) {
  const r = rand(seed);
  const [c, ctx] = canvas(size);
  ctx.fillStyle = '#4a3f33';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 80; i++) {
    const x = r() * size, y = r() * size, rad = 20 + r() * 70;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, ['rgba(90,75,55,0.4)', 'rgba(40,33,25,0.4)', 'rgba(70,80,50,0.3)'][Math.floor(r() * 3)]);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  speckle(ctx, size, 20000, ['#2e261e', '#5e5143', '#6d6152', '#3a3128'], 1, 3, r);
  const [hc, hctx] = canvas(size);
  hctx.drawImage(c, 0, 0);
  return { map: toTexture(c, repeat), normalMap: toTexture(normalFromHeight(hc, 3), repeat, false) };
}

// Building facade with lit/unlit windows; returns map + emissiveMap.
export function facade({ seed = 1, base = '#6b6f78', cols = 6, rows = 12, litChance = 0.35, litDiffuse = true } = {}) {
  const r = rand(seed);
  const size = 256;
  const [c, ctx] = canvas(size);
  const [e, ectx] = canvas(size);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  speckle(ctx, size, 2500, ['rgba(0,0,0,0.3)', 'rgba(255,255,255,0.15)'], 1, 2, r);
  ectx.fillStyle = '#000';
  ectx.fillRect(0, 0, size, size);
  const cw = size / cols, rh = size / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const lit = r() < litChance;
      const wx = x * cw + cw * 0.18, wy = y * rh + rh * 0.2, ww = cw * 0.64, wh = rh * 0.6;
      const glass = ['#1b2230', '#243042', '#2c3a50'][Math.floor(r() * 3)];
      ctx.fillStyle = lit && litDiffuse ? '#f5d9a0' : glass;
      ctx.fillRect(wx, wy, ww, wh);
      if (lit) {
        ectx.fillStyle = ['#ffd890', '#fff1c8', '#ffc070'][Math.floor(r() * 3)];
        ectx.fillRect(wx, wy, ww, wh);
      }
    }
  }
  return { map: toTexture(c, 1), emissiveMap: toTexture(e, 1) };
}

export function stripes({ a = '#f2c200', b = '#151515', count = 8 } = {}) {
  const size = 256;
  const [c, ctx] = canvas(size);
  ctx.fillStyle = b;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = a;
  const w = size / count;
  for (let i = -count; i < count * 2; i += 2) {
    ctx.beginPath();
    ctx.moveTo(i * w, 0);
    ctx.lineTo(i * w + w, 0);
    ctx.lineTo(i * w + w + size, size);
    ctx.lineTo(i * w + size, size);
    ctx.fill();
  }
  return toTexture(c, 1);
}

export function roadLanes({ lanes = 3, size = 512 } = {}) {
  const r = rand(99);
  const [c, ctx] = canvas(size);
  ctx.fillStyle = '#2a2b2e';
  ctx.fillRect(0, 0, size, size);
  speckle(ctx, size, 22000, ['#1d1e20', '#3a3b3f', '#47484c', '#232427'], 1, 2.2, r);
  ctx.fillStyle = '#e8e6df';
  ctx.fillRect(size * 0.02, 0, size * 0.015, size);
  ctx.fillRect(size * 0.965, 0, size * 0.015, size);
  for (let l = 1; l < lanes; l++) {
    const x = (size * l) / lanes;
    for (let y = 0; y < size; y += size / 4) ctx.fillRect(x - 4, y, 8, size / 8);
  }
  const t = toTexture(c, 1);
  const [hc, hctx] = canvas(size);
  hctx.drawImage(c, 0, 0);
  return { map: t, normalMap: toTexture(normalFromHeight(hc, 2), 1, false) };
}

export function softDot(size = 128, inner = 'rgba(255,255,255,1)') {
  const [c, ctx] = canvas(size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function gradientSky(top, bottom) {
  const [c, ctx] = canvas(256);
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const cl = (v) => Math.max(0, Math.min(255, Math.round(v + amt)));
  return `rgb(${cl(n >> 16)},${cl((n >> 8) & 255)},${cl(n & 255)})`;
}

// Plaster wall with one window per 3.2 m x 3.2 m tile (UVs are in metres on extruded buildings).
export function wallTile({ size = 256, seed = 31 } = {}) {
  const r = rand(seed);
  const [c, ctx] = canvas(size);
  ctx.fillStyle = '#e4dfd3';
  ctx.fillRect(0, 0, size, size);
  speckle(ctx, size, 5000, ['#cfcabd', '#f3efe4', '#bdb8aa'], 1, 2, r);
  for (let i = 0; i < 10; i++) {
    const x = r() * size;
    const g = ctx.createLinearGradient(x, 0, x + 14, size);
    g.addColorStop(0, 'rgba(60,50,35,0)');
    g.addColorStop(0.5, 'rgba(60,50,35,0.07)');
    g.addColorStop(1, 'rgba(60,50,35,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 18, size);
  }
  // Keep the top-left corner plain: flat roofs / caps sample it.
  ctx.fillStyle = '#e4dfd3';
  ctx.fillRect(0, 0, 20, 20);
  const wx = size * 0.31, wy = size * 0.2, ww = size * 0.38, wh = size * 0.5;
  ctx.fillStyle = '#5b4a38';
  ctx.fillRect(wx - 7, wy - 7, ww + 14, wh + 14);
  const glass = ctx.createLinearGradient(wx, wy, wx + ww, wy + wh);
  glass.addColorStop(0, '#3d566b');
  glass.addColorStop(1, '#1d2a38');
  ctx.fillStyle = glass;
  ctx.fillRect(wx, wy, ww, wh);
  ctx.fillStyle = '#5b4a38';
  ctx.fillRect(wx + ww / 2 - 2, wy, 4, wh);
  ctx.fillRect(wx, wy + wh * 0.45, ww, 4);
  ctx.fillStyle = '#cfcabd';
  ctx.fillRect(wx - 12, wy + wh + 7, ww + 24, 7);
  const [e, ectx] = canvas(size);
  ectx.fillStyle = '#000';
  ectx.fillRect(0, 0, size, size);
  ectx.fillStyle = '#ffd890';
  ectx.fillRect(wx, wy, ww, wh);
  ectx.fillStyle = '#000';
  ectx.fillRect(wx + ww / 2 - 2, wy, 4, wh);
  const normal = (() => {
    const [hc, hctx] = canvas(size);
    hctx.drawImage(c, 0, 0);
    return toTexture(normalFromHeight(hc, 1.2), 1, false);
  })();
  return { map: toTexture(c, 1), emissiveMap: toTexture(e, 1), normalMap: normal };
}

// ---------------------------------------------------------------------------
// Facade tiles for real-world Indonesian buildings. Wall UVs are metres divided
// by the tile size, so v = 0 is ground level (canvas bottom = ground).
// Each returns { map, emissiveMap, normalMap, w, h, cap: [u, v] } where `cap`
// is a plain texel used for roof caps.
// ---------------------------------------------------------------------------
function plaster(ctx, w, h, r, base = '#ece8df') {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  speckle(ctx, Math.max(w, h), Math.floor((w * h) / 30), ['#d8d3c7', '#f7f4ec', '#c9c4b7'], 1, 2, r);
  for (let i = 0; i < 8; i++) {
    const x = r() * w;
    const g = ctx.createLinearGradient(x, 0, x + 10, h);
    g.addColorStop(0, 'rgba(70,60,45,0)');
    g.addColorStop(0.6, 'rgba(70,60,45,0.08)');
    g.addColorStop(1, 'rgba(70,60,45,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, h * 0.3, 14, h * 0.7);
  }
}

function rect2(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function finish(c, e, w, h, cap) {
  const [hc, hctx] = rect2(c.width, c.height);
  hctx.drawImage(c, 0, 0);
  const t = (cv, srgb) => {
    const tx = new THREE.CanvasTexture(cv);
    tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
    tx.anisotropy = 8;
    if (srgb) tx.colorSpace = THREE.SRGBColorSpace;
    return tx;
  };
  return { map: t(c, true), emissiveMap: t(e, true), normalMap: t(normalFromHeightRect(hc, 1.1), false), w, h, cap };
}

// Like normalFromHeight but for non-square canvases.
function normalFromHeightRect(hc, strength) {
  const w = hc.width, h = hc.height;
  const src = hc.getContext('2d').getImageData(0, 0, w, h).data;
  const [c, ctx] = rect2(w, h);
  const out = ctx.createImageData(w, h);
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x - 1, y) - H(x + 1, y)) * strength;
      const dy = (H(x, y - 1) - H(x, y + 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      out.data[i] = ((dx / len) * 0.5 + 0.5) * 255;
      out.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      out.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return c;
}

// Window with frame, glass, optional teralis (security bars) and a roster vent above.
function windowAt(ctx, ectx, x, y, w, h, bars = true) {
  ctx.fillStyle = '#6b5039';
  ctx.fillRect(x - 5, y - 5, w + 10, h + 10);
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, '#45607a');
  g.addColorStop(1, '#1b2836');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#6b5039';
  ctx.fillRect(x + w / 2 - 2, y, 4, h);
  if (bars) {
    ctx.fillStyle = 'rgba(30,30,30,0.85)';
    for (let k = 1; k < 6; k++) ctx.fillRect(x + (w * k) / 6 - 1, y, 2, h);
  }
  ctx.fillStyle = '#cdc7b8';
  ctx.fillRect(x - 10, y + h + 5, w + 20, 6);
  const ry = y - 24;
  ctx.fillStyle = '#d9d3c4';
  ctx.fillRect(x, ry, w, 14);
  ctx.fillStyle = '#7d766a';
  for (let k = 0; k < w / 12 - 1; k++) ctx.fillRect(x + 4 + k * 12, ry + 3, 7, 8);
  ectx.fillStyle = '#ffd38a';
  ectx.fillRect(x, y, w, h);
  ectx.fillStyle = '#000';
  ectx.fillRect(x + w / 2 - 2, y, 4, h);
}

const PXM = 64; // pixels per metre on facade tiles

// House: 6.4 m wide x 6.4 m (2 floors). Ground floor: wooden door + window; upper: 2 windows.
export function houseTile({ seed = 41 } = {}) {
  const r = rand(seed);
  const W = 6.4 * PXM, H = 6.4 * PXM;
  const [c, ctx] = rect2(W, H);
  const [e, ectx] = rect2(W, H);
  plaster(ctx, W, H, r);
  ectx.fillStyle = '#000';
  ectx.fillRect(0, 0, W, H);
  const gy = (m) => H - m * PXM;
  ctx.fillStyle = '#9a958a';
  ctx.fillRect(0, gy(0.45), W, 0.45 * PXM);
  ctx.fillStyle = '#d2ccbe';
  ctx.fillRect(0, gy(3.3), W, 0.12 * PXM);
  const dx = 1.0 * PXM, dw = 0.95 * PXM, dh = 2.15 * PXM;
  ctx.fillStyle = '#4a3322';
  ctx.fillRect(dx - 6, gy(0.45) - dh - 6, dw + 12, dh + 6);
  ctx.fillStyle = '#7a5434';
  ctx.fillRect(dx, gy(0.45) - dh, dw, dh);
  ctx.strokeStyle = '#5a3c25';
  ctx.lineWidth = 4;
  for (const [py, ph] of [[0.12, 0.35], [0.55, 0.38]]) ctx.strokeRect(dx + 10, gy(0.45) - dh + dh * py, dw - 20, dh * ph);
  ctx.fillStyle = '#d8c070';
  ctx.fillRect(dx + dw - 16, gy(0.45) - dh * 0.5, 6, 10);
  windowAt(ctx, ectx, 3.4 * PXM, gy(2.15), 1.5 * PXM, 1.15 * PXM);
  windowAt(ctx, ectx, 1.0 * PXM, gy(5.45), 1.4 * PXM, 1.15 * PXM);
  windowAt(ctx, ectx, 3.7 * PXM, gy(5.45), 1.4 * PXM, 1.15 * PXM);
  return finish(c, e, 6.4, 6.4, [0.02, 0.97]);
}

// Ruko (shophouse): 4.8 m wide x 12.8 m (4 floors). Ground floor: lit shop, half-down rolling door.
export function rukoTile({ seed = 43 } = {}) {
  const r = rand(seed);
  const W = 4.8 * PXM, H = 12.8 * PXM;
  const [c, ctx] = rect2(W, H);
  const [e, ectx] = rect2(W, H);
  plaster(ctx, W, H, r, '#e6e2d8');
  ectx.fillStyle = '#000';
  ectx.fillRect(0, 0, W, H);
  const gy = (m) => H - m * PXM;
  ctx.fillStyle = '#d4cfc3';
  ctx.fillRect(0, 0, 0.25 * PXM, H);
  ctx.fillRect(W - 0.25 * PXM, 0, 0.25 * PXM, H);
  const ox = 0.45 * PXM, ow = 3.9 * PXM, oh = 2.8 * PXM;
  ctx.fillStyle = '#e8d7a8';
  ctx.fillRect(ox, gy(2.8), ow, oh);
  ctx.fillStyle = 'rgba(120,90,50,0.35)';
  for (let k = 0; k < 5; k++) ctx.fillRect(ox + k * 0.8 * PXM + 8, gy(1.2), 0.6 * PXM, 1.0 * PXM);
  ectx.fillStyle = '#ffe4a8';
  ectx.fillRect(ox, gy(2.8), ow, oh);
  const shut = oh * 0.48;
  const sg = ctx.createLinearGradient(0, gy(2.8), 0, gy(2.8) + shut);
  sg.addColorStop(0, '#9aa0a8');
  sg.addColorStop(1, '#7c828a');
  ctx.fillStyle = sg;
  ctx.fillRect(ox, gy(2.8), ow, shut);
  ctx.fillStyle = 'rgba(40,44,50,0.5)';
  for (let y = gy(2.8); y < gy(2.8) + shut; y += 7) ctx.fillRect(ox, y, ow, 2);
  ectx.fillStyle = '#000';
  ectx.fillRect(ox, gy(2.8), ow, shut);
  for (const f of [3.2, 6.4, 9.6]) {
    ctx.fillStyle = '#c9c3b5';
    ctx.fillRect(0, gy(f) - 6, W, 14);
    windowAt(ctx, ectx, 0.7 * PXM, gy(f + 2.35), 3.4 * PXM, 1.35 * PXM, false);
    ctx.fillStyle = 'rgba(40,40,40,0.8)';
    for (let k = 0; k < 14; k++) ctx.fillRect(0.6 * PXM + k * 0.26 * PXM, gy(f + 0.9), 3, 0.75 * PXM);
    ctx.fillRect(0.6 * PXM, gy(f + 0.95), 3.6 * PXM, 5);
  }
  return finish(c, e, 4.8, 12.8, [0.02, 0.5]);
}

// Offices / schools: 3.6 m wide x 7.2 m (2 floors), white pilasters and tall windows.
export function officeTile({ seed = 47 } = {}) {
  const r = rand(seed);
  const W = 3.6 * PXM, H = 7.2 * PXM;
  const [c, ctx] = rect2(W, H);
  const [e, ectx] = rect2(W, H);
  plaster(ctx, W, H, r, '#efece4');
  ectx.fillStyle = '#000';
  ectx.fillRect(0, 0, W, H);
  const gy = (m) => H - m * PXM;
  ctx.fillStyle = '#fbfaf6';
  ctx.fillRect(0, 0, 0.45 * PXM, H);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(0.45 * PXM, 0, 4, H);
  ctx.fillStyle = '#9a958a';
  ctx.fillRect(0, gy(0.5), W, 0.5 * PXM);
  ctx.fillStyle = '#d6d1c4';
  ctx.fillRect(0, gy(3.6), W, 0.18 * PXM);
  windowAt(ctx, ectx, 0.95 * PXM, gy(2.75), 2.1 * PXM, 1.75 * PXM, false);
  windowAt(ctx, ectx, 0.95 * PXM, gy(6.35), 2.1 * PXM, 1.75 * PXM, false);
  return finish(c, e, 3.6, 7.2, [0.04, 0.5]);
}

// Bugis stilt house (rumah panggung): horizontal planks and a shuttered window, 3.2 m tile.
export function woodTile({ seed = 53 } = {}) {
  const r = rand(seed);
  const W = 3.2 * PXM, H = 3.2 * PXM;
  const [c, ctx] = rect2(W, H);
  const [e, ectx] = rect2(W, H);
  ectx.fillStyle = '#000';
  ectx.fillRect(0, 0, W, H);
  for (let y = 0; y < H; y += 14) {
    const t = (r() - 0.5) * 30;
    ctx.fillStyle = `rgb(${150 + t},${108 + t * 0.8},${70 + t * 0.6})`;
    ctx.fillRect(0, y, W, 14);
    ctx.fillStyle = 'rgba(40,25,12,0.55)';
    ctx.fillRect(0, y + 12, W, 2);
  }
  ctx.fillStyle = '#5a3a20';
  ctx.fillRect(0, 0, 10, H);
  const wx = 1.0 * PXM, wy = H - 2.3 * PXM, ww = 1.1 * PXM, wh = 1.1 * PXM;
  ctx.fillStyle = '#3c2614';
  ctx.fillRect(wx - 6, wy - 6, ww + 12, wh + 12);
  ctx.fillStyle = '#1d2a33';
  ctx.fillRect(wx, wy, ww, wh);
  ctx.fillStyle = '#7d5532';
  ctx.fillRect(wx - 0.5 * PXM, wy, 0.45 * PXM, wh);
  ctx.fillRect(wx + ww + 0.05 * PXM, wy, 0.45 * PXM, wh);
  ectx.fillStyle = '#ffcf80';
  ectx.fillRect(wx, wy, ww, wh);
  return finish(c, e, 3.2, 3.2, [0.5, 0.97]);
}

// Shop signboards in an atlas: 2 columns x 10 rows, each 5:1.
export const SIGN_NAMES = [
  'TOKO SINAR JAYA', 'WARUNG COTO MAROS', 'APOTEK SEHAT', 'BENGKEL MOTOR', 'KONTER HP & PULSA',
  'LAUNDRY KILAT', 'TOKO BANGUNAN', 'RM. SOP SAUDARA', 'FOTOCOPY & ATK', 'PANGKAS RAMBUT',
  'TOKO EMAS MULIA', 'DEPOT AIR ISI ULANG', 'KUE TRADISIONAL', 'TOKO KELONTONG', 'SALON CANTIK',
  'RUMAH MAKAN', 'PISANG EPE', 'TOKO PAKAIAN', 'SERVICE ELEKTRONIK', 'TOKO OBAT',
];
export function signAtlas() {
  const W = 1024, H = 1024, cw = 512, ch = 102;
  const [c, ctx] = rect2(W, H);
  const [e, ectx] = rect2(W, H);
  const bgs = ['#c81e1e', '#1d4ed8', '#047857', '#f59e0b', '#7c3aed', '#0f766e', '#be123c', '#1e3a8a', '#b45309', '#15803d'];
  SIGN_NAMES.forEach((name, i) => {
    const x = (i % 2) * cw, y = Math.floor(i / 2) * ch;
    const bg = bgs[i % bgs.length];
    for (const [cx, light] of [[ctx, false], [ectx, true]]) {
      cx.fillStyle = bg;
      cx.fillRect(x, y, cw, ch);
      if (!light) {
        cx.fillStyle = 'rgba(255,255,255,0.9)';
        cx.fillRect(x + 6, y + 6, cw - 12, 5);
        cx.fillRect(x + 6, y + ch - 11, cw - 12, 5);
      }
      cx.fillStyle = i % 3 === 1 ? '#fde047' : '#ffffff';
      cx.font = 'bold 50px Arial, sans-serif';
      cx.textAlign = 'center';
      cx.textBaseline = 'middle';
      cx.fillText(name, x + cw / 2, y + ch / 2 + 2, cw - 30);
    }
  });
  const t = (cv) => {
    const tx = new THREE.CanvasTexture(cv);
    tx.colorSpace = THREE.SRGBColorSpace;
    tx.anisotropy = 8;
    return tx;
  };
  // UV rect [u0, v0, du, dv] for sign i (texture v grows upward).
  const cell = (i) => [(i % 2) * 0.5, 1 - (Math.floor(i / 2) + 1) * (ch / H), 0.5, ch / H];
  return { map: t(c), emissiveMap: t(e), count: SIGN_NAMES.length, cell };
}

// Kampung ground: packed brown soil with grass patches and leaf litter.
export function soil({ repeat = 1, size = 512, seed = 61 } = {}) {
  const r = rand(seed);
  const [c, ctx] = canvas(size);
  ctx.fillStyle = '#7d6c51';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 70; i++) {
    const x = r() * size, y = r() * size, rad = 20 + r() * 80;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, ['rgba(92,110,52,0.45)', 'rgba(104,86,60,0.4)', 'rgba(70,88,40,0.4)', 'rgba(130,112,82,0.35)'][Math.floor(r() * 4)]);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  speckle(ctx, size, 16000, ['#6a5a42', '#8c7a5c', '#5e6e3a', '#76664c', '#97856a'], 1, 2.5, r);
  for (let i = 0; i < 4000; i++) {
    ctx.strokeStyle = ['#5f7a35', '#4d6a2c', '#6f8a3f'][Math.floor(r() * 3)];
    ctx.globalAlpha = 0.35;
    const x = r() * size, y = r() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (r() - 0.5) * 3, y - 2 - r() * 3);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const [hc, hctx] = canvas(size);
  hctx.drawImage(c, 0, 0);
  return { map: toTexture(c, repeat), normalMap: toTexture(normalFromHeight(hc, 2), repeat, false) };
}
