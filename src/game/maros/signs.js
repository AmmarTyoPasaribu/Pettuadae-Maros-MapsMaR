import * as THREE from 'three';

// Packs many text signs into a few canvas atlases. Each item gets { atlas, uv: [u0, v0, du, dv] }.
// The same texture is used as emissive map so signs glow at night.
export function createAtlases(items, { cellW, cellH, size = 1024, draw }) {
  const cols = Math.floor(size / cellW);
  const rows = Math.floor(size / cellH);
  const per = cols * rows;
  const materials = [];
  const slots = [];
  for (let start = 0; start < items.length; start += per) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    items.slice(start, start + per).forEach((item, k) => {
      const x = (k % cols) * cellW;
      const y = Math.floor(k / cols) * cellH;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, cellW, cellH);
      ctx.clip();
      draw(ctx, item, x, y, cellW, cellH);
      ctx.restore();
      slots.push({ atlas: materials.length, uv: [x / size, 1 - (y + cellH) / size, cellW / size, cellH / size] });
    });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    materials.push(new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.55 }));
  }
  return { materials, slots };
}

// Text that shrinks until it fits the width.
export function fitText(ctx, text, x, y, maxW, size, weight = 'bold') {
  let s = size;
  ctx.font = `${weight} ${s}px Arial, sans-serif`;
  while (s > 10 && ctx.measureText(text).width > maxW) {
    s -= 1;
    ctx.font = `${weight} ${s}px Arial, sans-serif`;
  }
  ctx.fillText(text, x, y);
}

// A plane (facing +z before rotation) whose UVs map to an atlas slot.
export function signPlane(w, h, uv, ry, x, y, z) {
  const g = new THREE.PlaneGeometry(w, h);
  const a = g.attributes.uv;
  for (let i = 0; i < a.count; i++) a.setXY(i, uv[0] + a.getX(i) * uv[2], uv[1] + a.getY(i) * uv[3]);
  return g.rotateY(ry).translate(x, y, z);
}

export const SHOP_STYLE = {
  food: { bg: '#c81e1e', label: 'RUMAH MAKAN', awning: '#c2410c' },
  cafe: { bg: '#5b3416', label: 'KAFE · WARKOP', awning: '#7c4a21' },
  shop: { bg: '#1d4ed8', label: 'TOKO', awning: '#1d4ed8' },
  bank: { bg: '#0b3d91', label: 'BANK · KEUANGAN', awning: null },
  health: { bg: '#15803d', label: 'KESEHATAN', awning: '#15803d' },
  service: { bg: '#334155', label: 'JASA', awning: '#475569' },
  lodging: { bg: '#6d28d9', label: 'PENGINAPAN', awning: null },
  edu: { bg: '#a16207', label: 'PENDIDIKAN', awning: null },
  gov: { bg: '#0f3b66', label: 'INSTANSI', awning: null },
  other: { bg: '#3f3f46', label: '', awning: '#6b7280' },
};

export function drawShopSign(ctx, p, x, y, w, h) {
  const st = SHOP_STYLE[p.group] || SHOP_STYLE.other;
  ctx.fillStyle = st.bg;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(x + 4, y + 4, w - 8, 3);
  ctx.fillRect(x + 4, y + h - 7, w - 8, 3);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  const name = p.name.length > 34 ? p.name.slice(0, 33) + '…' : p.name;
  fitText(ctx, name.toUpperCase(), x + w / 2, y + h * (st.label ? 0.42 : 0.52), w - 20, Math.floor(h * 0.42));
  if (st.label) {
    ctx.fillStyle = '#fde68a';
    fitText(ctx, st.label, x + w / 2, y + h * 0.8, w - 30, Math.floor(h * 0.2), '600');
  }
}

export function drawStreetSign(ctx, name, x, y, w, h) {
  ctx.fillStyle = '#0f6b3a';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 4, y + 4, w - 8, h - 8);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitText(ctx, name.replace(/^Jalan /i, 'JL. ').toUpperCase(), x + w / 2, y + h / 2 + 1, w - 24, Math.floor(h * 0.55));
}
