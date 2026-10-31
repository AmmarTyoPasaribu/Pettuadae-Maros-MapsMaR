import { R_CLIP } from './osm.js';

// The whole area is rendered once to an offscreen canvas ("base") shared by the radar
// minimap and the full-screen map.
const K = 0.6; // offscreen pixels per metre
const EXT = R_CLIP + 40;
let baseCache = null;

function mapBase(M) {
  if (baseCache) return baseCache;
  const size = Math.ceil(EXT * 2 * K);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const b = c.getContext('2d');
  const px = (v) => (v + EXT) * K;
  b.fillStyle = '#20283a';
  b.fillRect(0, 0, size, size);
  const fill = (pts, color) => {
    b.fillStyle = color;
    b.beginPath();
    pts.forEach(([x, z], i) => (i ? b.lineTo(px(x), px(z)) : b.moveTo(px(x), px(z))));
    b.closePath();
    b.fill();
  };
  const line = (pts) => {
    b.beginPath();
    pts.forEach(([x, z], i) => (i ? b.lineTo(px(x), px(z)) : b.moveTo(px(x), px(z))));
    b.stroke();
  };
  const LU = { farmland: '#35552d', meadow: '#35552d', open_field_space: '#3b4c31', forest: '#24402a', park: '#2f5f37', industrial: '#3a3f4a', commercial: '#3a3f4a' };
  for (const l of M.landuse) if (LU[l.kind]) fill(l.pts, LU[l.kind]);
  for (const w of M.water) fill(w.pts, '#2b6496');
  b.lineCap = 'round';
  b.lineJoin = 'round';
  b.strokeStyle = '#2b6496';
  for (const r of M.rivers) {
    b.lineWidth = Math.max(1.5, r.width * K);
    line(r.pts);
  }
  for (const bd of M.buildings) fill(bd.pts, '#485166');
  // Roads: casing first, then fill, major roads on top.
  const roads = [...M.roads].filter((r) => r.type !== 'path').sort((a, b2) => a.rank - b2.rank);
  for (const r of roads) {
    b.strokeStyle = '#141923';
    b.lineWidth = Math.max(2.2, r.width * K + 1.6);
    line(r.pts);
  }
  for (const r of roads) {
    b.strokeStyle = r.rank >= 4 ? '#f2d58a' : r.rank >= 3 ? '#e2e2e2' : '#9aa3b5';
    b.lineWidth = Math.max(1.4, r.width * K);
    line(r.pts);
  }
  // Longest stretch of each named street, for labels on the big map.
  const labels = new Map();
  for (const e of M.edges) {
    if (!e.name) continue;
    const cur = labels.get(e.name);
    if (!cur || e.len > cur.len) labels.set(e.name, { name: e.name, len: e.len, e });
  }
  baseCache = { canvas: c, K, EXT, size, labels: [...labels.values()] };
  return baseCache;
}

const ICONS = { place_of_worship: '🕌', mosque: '🕌', school: '🏫', marketplace: '🛒', townhall: '🏛️', fuel: '⛽', police: '🚓', hospital: '🏥', clinic: '🏥', bank: '🏦', restaurant: '🍴', cafe: '☕', convenience: '🛍️', social_facility: '🏥', yes: '📍' };
const iconFor = (p) => (/BPS|statistik/i.test(p.name) ? '📊' : null) || ICONS[p.kind] || (/masjid/i.test(p.name) ? '🕌' : /sekolah|SD |SMP|SMA|MTs/i.test(p.name) ? '🏫' : /kantor|dinas|badan/i.test(p.name) ? '🏛️' : /bank/i.test(p.name) ? '🏦' : /spbu|pertamina/i.test(p.name) ? '⛽' : '📍');

function drawPath(ctx, pts, map, color, width) {
  if (!pts || pts.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach(([x, z], i) => {
    const [sx, sy] = map(x, z);
    if (i) ctx.lineTo(sx, sy);
    else ctx.moveTo(sx, sy);
  });
  ctx.stroke();
}

function drawArrow(ctx, x, y, rot, s = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(s, s);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -8);
  ctx.lineTo(6, 7);
  ctx.lineTo(0, 3);
  ctx.lineTo(-6, 7);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}

// ---------------- Radar minimap (rotates with the camera) ----------------
export function createMinimap(parent, M) {
  const base = mapBase(M);
  const size = 160;
  const wrap = document.createElement('div');
  wrap.className = 'minimap';
  const cv = document.createElement('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = cv.height = size * dpr;
  wrap.appendChild(cv);
  const north = document.createElement('div');
  north.className = 'minimap-north';
  north.textContent = 'U';
  wrap.appendChild(north);
  parent.appendChild(wrap);
  const ctx = cv.getContext('2d');
  const half = size / 2;
  let scale = 0.75;

  return {
    wrap,
    // markers: [{x, z, color, r}], route: [[x,z]...] | null
    update(px, pz, yaw, speed, markers, cars, facing = yaw, route = null, routeColor = '#c084fc') {
      const s = Math.sin(yaw);
      const c = Math.cos(yaw);
      scale += ((speed > 6 ? 0.45 : 0.75) - scale) * 0.05;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#10151f';
      ctx.fillRect(0, 0, size, size);
      const k = scale / base.K;
      const m0 = -base.EXT;
      ctx.setTransform(
        dpr * -c * k, dpr * -s * k, dpr * s * k, dpr * -c * k,
        dpr * (half + scale * (-c * (m0 - px) + s * (m0 - pz))),
        dpr * (half + scale * (-s * (m0 - px) - c * (m0 - pz)))
      );
      ctx.drawImage(base.canvas, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const map = (x, z) => {
        const dx = x - px;
        const dz = z - pz;
        return [half + (-dx * c + dz * s) * scale, half - (dx * s + dz * c) * scale];
      };
      drawPath(ctx, route, map, routeColor, 3.5);
      for (const v of cars) {
        const [mx, my] = map(v.x, v.z);
        ctx.fillStyle = '#60a5fa';
        ctx.fillRect(mx - 1.5, my - 1.5, 3, 3);
      }
      for (const mk of markers) {
        let [mx, my] = map(mk.x, mk.z);
        const dx = mx - half;
        const dy = my - half;
        const d = Math.hypot(dx, dy);
        const lim = half - 9;
        if (d > lim) { mx = half + (dx / d) * lim; my = half + (dy / d) * lim; }
        ctx.fillStyle = mk.color;
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(mx, my, mk.r || 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fill();
      }
      drawArrow(ctx, half, half, yaw - facing);
      // North marker sits on the rim in the direction of world north (-z).
      const [nx, ny] = map(px, pz - 1000);
      const ang = Math.atan2(ny - half, nx - half);
      north.style.transform = `translate(${Math.cos(ang) * (half - 9)}px, ${Math.sin(ang) * (half - 9)}px)`;
    },
    dispose() {
      wrap.remove();
    },
  };
}

// ---------------- Full-screen map (north up, pan/zoom, waypoint) ----------------
export function createFullMap(parent, M, { onWaypoint, onClose }) {
  const base = mapBase(M);
  const el = document.createElement('div');
  el.className = 'fullmap';
  el.hidden = true;
  el.innerHTML = `
    <canvas></canvas>
    <div class="fm-title">Peta · Pettuadae, Turikale, Maros</div>
    <div class="fm-legend">
      <div><i style="background:#f2d58a"></i>Jalan utama</div>
      <div><i style="background:#e2e2e2"></i>Jalan</div>
      <div><i style="background:#2b6496"></i>Sungai</div>
      <div><i style="background:#facc15;border-radius:50%"></i>Misi</div>
      <div><i style="background:#c084fc;border-radius:50%"></i>Waypoint</div>
      <p>Klik peta untuk pasang waypoint · klik lagi untuk hapus<br>Seret untuk geser · scroll untuk zoom · M / Esc tutup</p>
    </div>
    <div class="fm-buttons">
      <button data-a="in">＋</button><button data-a="out">－</button><button data-a="me">⌖</button><button data-a="close">✕</button>
    </div>`;
  parent.appendChild(el);
  const cv = el.querySelector('canvas');
  const ctx = cv.getContext('2d');
  const named = M.pois.filter((p) => p.name && p.name.length > 2);
  const V = { cx: 0, cz: 0, zoom: 0.9, drag: null, moved: false };
  let state = null;
  const listeners = [];
  const on = (t, ev, fn, o) => {
    t.addEventListener(ev, fn, o);
    listeners.push(() => t.removeEventListener(ev, fn, o));
  };

  const toScreen = (x, z) => [cv.clientWidth / 2 + (x - V.cx) * V.zoom, cv.clientHeight / 2 + (z - V.cz) * V.zoom];
  const toWorld = (sx, sy) => [V.cx + (sx - cv.clientWidth / 2) / V.zoom, V.cz + (sy - cv.clientHeight / 2) / V.zoom];

  function draw() {
    if (el.hidden || !state) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0d121b';
    ctx.fillRect(0, 0, W, H);
    const [ox, oy] = toScreen(-base.EXT, -base.EXT);
    ctx.imageSmoothingEnabled = V.zoom < base.K * 2;
    ctx.drawImage(base.canvas, ox, oy, (base.size * V.zoom) / base.K, (base.size * V.zoom) / base.K);

    drawPath(ctx, state.route, toScreen, state.routeColor || '#c084fc', Math.max(3, V.zoom * 3));

    // Street names along their longest stretch.
    if (V.zoom > 0.75) {
      ctx.font = `600 ${Math.min(15, 9 + V.zoom * 2)}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const l of base.labels) {
        const e = l.e;
        const i = Math.floor((e.pts.length - 1) / 2);
        const a = e.pts[i], b = e.pts[Math.min(e.pts.length - 1, i + 1)];
        const [sx, sy] = toScreen((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        if (sx < -100 || sy < -40 || sx > W + 100 || sy > H + 40) continue;
        let ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        if (ang > Math.PI / 2) ang -= Math.PI;
        if (ang < -Math.PI / 2) ang += Math.PI;
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(ang);
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(10,14,22,0.85)';
        ctx.strokeText(l.name, 0, 0);
        ctx.fillStyle = '#f5f1e6';
        ctx.fillText(l.name, 0, 0);
        ctx.restore();
      }
    }
    // Places.
    if (V.zoom > 0.45) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const p of named) {
        const [sx, sy] = toScreen(p.x, p.z);
        if (sx < -20 || sy < -20 || sx > W + 20 || sy > H + 20) continue;
        ctx.font = '15px sans-serif';
        ctx.fillText(iconFor(p), sx, sy);
        if (V.zoom > 1.6) {
          ctx.font = '600 11px Inter, sans-serif';
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(10,14,22,0.9)';
          ctx.strokeText(p.name, sx, sy + 14);
          ctx.fillStyle = '#fff';
          ctx.fillText(p.name, sx, sy + 14);
        }
      }
    }
    const pin = (x, z, color, label) => {
      const [sx, sy] = toScreen(x, z);
      ctx.fillStyle = color;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy - 14, 8, 0, Math.PI * 2);
      ctx.moveTo(sx - 6, sy - 9);
      ctx.lineTo(sx, sy);
      ctx.lineTo(sx + 6, sy - 9);
      ctx.fill();
      ctx.stroke();
      if (label) {
        ctx.font = '700 12px Inter, sans-serif';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(10,14,22,0.9)';
        ctx.strokeText(label, sx, sy - 30);
        ctx.fillStyle = '#fff';
        ctx.fillText(label, sx, sy - 30);
      }
    };
    if (state.mission) pin(state.mission.x, state.mission.z, '#facc15', state.mission.name || 'Misi');
    if (state.waypoint) pin(state.waypoint.x, state.waypoint.z, '#c084fc', 'Waypoint');
    const [px, py] = toScreen(state.player.x, state.player.z);
    // Arrow points up for facing 0 = +z (south), so rotate by PI.
    drawArrow(ctx, px, py, Math.PI - state.player.face, 1.4);
  }

  const zoomAt = (f, sx, sy) => {
    const [wx, wz] = toWorld(sx, sy);
    V.zoom = Math.max(0.25, Math.min(6, V.zoom * f));
    V.cx = wx - (sx - cv.clientWidth / 2) / V.zoom;
    V.cz = wz - (sy - cv.clientHeight / 2) / V.zoom;
    draw();
  };
  on(cv, 'wheel', (e) => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.offsetX, e.offsetY); }, { passive: false });
  on(cv, 'pointerdown', (e) => {
    V.drag = { x: e.clientX, y: e.clientY, cx: V.cx, cz: V.cz };
    V.moved = false;
    cv.setPointerCapture(e.pointerId);
  });
  on(cv, 'pointermove', (e) => {
    if (!V.drag) return;
    const dx = e.clientX - V.drag.x, dy = e.clientY - V.drag.y;
    if (Math.hypot(dx, dy) > 4) V.moved = true;
    V.cx = V.drag.cx - dx / V.zoom;
    V.cz = V.drag.cz - dy / V.zoom;
    draw();
  });
  on(cv, 'pointerup', (e) => {
    const wasDrag = V.moved;
    V.drag = null;
    if (wasDrag) return;
    const [wx, wz] = toWorld(e.offsetX, e.offsetY);
    if (state.waypoint) {
      const [sx, sy] = toScreen(state.waypoint.x, state.waypoint.z);
      if (Math.hypot(sx - e.offsetX, sy - 14 - e.offsetY) < 18) {
        state.waypoint = null;
        onWaypoint(null);
        draw();
        return;
      }
    }
    const snap = M.roadIndex.nearest(wx, wz, 120);
    state.waypoint = snap ? { x: snap.x, z: snap.z } : { x: wx, z: wz };
    onWaypoint(state.waypoint);
    draw();
  });
  for (const b of el.querySelectorAll('.fm-buttons button')) {
    on(b, 'click', () => {
      const a = b.dataset.a;
      if (a === 'in') zoomAt(1.4, cv.clientWidth / 2, cv.clientHeight / 2);
      if (a === 'out') zoomAt(1 / 1.4, cv.clientWidth / 2, cv.clientHeight / 2);
      if (a === 'me') { V.cx = state.player.x; V.cz = state.player.z; draw(); }
      if (a === 'close') onClose();
    });
  }
  on(window, 'resize', draw);

  return {
    get open() {
      return !el.hidden;
    },
    show(s) {
      state = s;
      V.cx = s.player.x;
      V.cz = s.player.z;
      el.hidden = false;
      draw();
    },
    // Live data (route recalculated, etc.)
    refresh(s) {
      state = { ...state, ...s };
      draw();
    },
    hide() {
      el.hidden = true;
    },
    dispose() {
      listeners.forEach((f) => f());
      el.remove();
      baseCache = null;
    },
  };
}
