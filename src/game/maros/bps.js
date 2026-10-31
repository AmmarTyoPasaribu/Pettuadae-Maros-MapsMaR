import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// BPS Kabupaten Maros (Jl. Jenderal Sudirman, Pettuadae): a hand-built, enterable office.
// Known from data: OSM footprint (~12.6 x 16.7 m, 2 storeys), flat light-grey concrete roof and
// parking on the south side (satellite imagery). Facade details and the interior layout are an
// informed approximation based on the standard BPS "Pelayanan Statistik Terpadu" (PST) service room.

const merge = (list) => (list.length ? mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g))) : null);
const tmpC = new THREE.Color();

function colorize(g, color) {
  tmpC.set(color);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([tmpC.r, tmpC.g, tmpC.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Simplified BPS emblem: three slanted bars in blue, green and orange.
function drawLogo(ctx, x, y, s) {
  const bar = (dx, h, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x + dx * s, y + s);
    ctx.lineTo(x + (dx + 0.26) * s, y + s);
    ctx.lineTo(x + (dx + 0.34) * s, y + (1 - h) * s);
    ctx.lineTo(x + (dx + 0.08) * s, y + (1 - h) * s);
    ctx.closePath();
    ctx.fill();
  };
  bar(0.02, 0.5, '#2563c9');
  bar(0.33, 0.75, '#2fa84f');
  bar(0.64, 1.0, '#f08c1a');
}

const C = {
  paint: '#f3f0e9',
  paintIn: '#f7f6f2',
  blue: '#1d4f91',
  orange: '#ef7d14',
  granite: '#6b6f76',
  graniteLight: '#b9b6ae',
  frame: '#1e2f4f',
  wood: '#a8774a',
  woodDark: '#6b4527',
  metal: '#3a3d42',
  steel: '#b8bcc2',
  fabric: '#2b5aa6',
  black: '#16181b',
  white: '#fbfbf9',
  ceiling: '#eceae4',
  roof: '#c6c6c1',
};

export function buildBPS(scene, M, colliders) {
  const b = M.buildings.find((x) => /BPS Kabupaten Maros/i.test(x.name));
  if (!b) return null;

  // ---------------- Local frame: +x along the front facade, +z out of the front (towards the parking) ----------------
  const pts = b.pts;
  let cx = 0;
  let cz = 0;
  for (const p of pts) { cx += p[0]; cz += p[1]; }
  cx /= pts.length;
  cz /= pts.length;
  let front = null;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], q = pts[(i + 1) % pts.length];
    const len = Math.hypot(q[0] - a[0], q[1] - a[1]);
    let nx = (q[1] - a[1]) / len, nz = -(q[0] - a[0]) / len;
    if (nx * ((a[0] + q[0]) / 2 - cx) + nz * ((a[1] + q[1]) / 2 - cz) < 0) { nx = -nx; nz = -nz; }
    if (!front || nz > front.nz) front = { len, nx, nz };
  }
  const nx = front.nx, nz = front.nz;
  const ux = nz, uz = -nx;
  let depth = 0;
  for (const p of pts) depth = Math.max(depth, Math.abs((p[0] - cx) * nx + (p[1] - cz) * nz));
  const hw = front.len / 2;
  const hd = depth;
  const L2W = (lx, lz) => [cx + lx * ux + lz * nx, cz + lx * uz + lz * nz];
  const W2L = (x, z) => [(x - cx) * ux + (z - cz) * uz, (x - cx) * nx + (z - cz) * nz];

  const G = new THREE.Group();
  G.position.set(cx, 0, cz);
  G.rotation.y = Math.atan2(-uz, ux);
  scene.add(G);

  // ---------------- Builders ----------------
  const solids = [];
  const glassGeos = [];
  const screenGeos = [];
  const lightGeos = [];
  const tileGeos = [];
  const segs = [];
  const box = (x0, x1, y0, y1, z0, z1, color) => {
    if (x1 - x0 < 1e-3 || y1 - y0 < 1e-3 || z1 - z0 < 1e-3) return;
    solids.push(colorize(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), color));
  };
  // Object made of parts in its own frame, rotated by ry and placed at (x, y, z).
  const obj = (parts, x, y, z, ry = 0) => {
    for (const [geo, color] of parts) {
      geo.rotateY(ry).translate(x, y, z);
      if (color === 'screen') screenGeos.push(geo);
      else if (color === 'light') lightGeos.push(geo);
      else solids.push(colorize(geo, color));
    }
  };
  const B = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  const CY = (r, h, x, y, z, seg = 10) => new THREE.CylinderGeometry(r, r, h, seg).translate(x, y, z);
  const seg = (ax, az, bx, bz, y0, y1) => segs.push([ax, az, bx, bz, y0, y1]);
  const rectSegs = (x0, x1, z0, z1, y0, y1) => {
    seg(x0, z0, x1, z0, y0, y1);
    seg(x1, z0, x1, z1, y0, y1);
    seg(x1, z1, x0, z1, y0, y1);
    seg(x0, z1, x0, z0, y0, y1);
  };
  const glass = (x0, x1, y0, y1, z0, z1) => glassGeos.push(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2));

  // Wall along x at z (or along z at x) with openings {a, b, lo, hi, door, frame}.
  function wall(axis, at, s0, s1, y0, y1, t, ops, color, collide = [y0 - 0.5, y1]) {
    const B3 = (a0, a1, v0, v1) => (axis === 'x' ? box(a0, a1, v0, v1, at - t / 2, at + t / 2, color) : box(at - t / 2, at + t / 2, v0, v1, a0, a1, color));
    const sorted = [...ops].sort((p, q) => p.a - q.a);
    let s = s0;
    for (const o of sorted) {
      B3(s, o.a, y0, y1);
      B3(o.a, o.b, y0, o.lo);
      B3(o.a, o.b, o.hi, y1);
      if (!o.door) {
        if (axis === 'x') glass(o.a, o.b, o.lo, o.hi, at - 0.02, at + 0.02);
        else glass(at - 0.02, at + 0.02, o.lo, o.hi, o.a, o.b);
        if (o.frame) {
          const f = 0.06;
          const mid = (o.a + o.b) / 2;
          if (axis === 'x') {
            box(o.a, o.b, o.lo, o.lo + f, at - t / 2 - 0.03, at + t / 2 + 0.03, o.frame);
            box(o.a, o.b, o.hi - f, o.hi, at - t / 2 - 0.03, at + t / 2 + 0.03, o.frame);
            box(mid - f / 2, mid + f / 2, o.lo, o.hi, at - 0.05, at + 0.05, o.frame);
          } else {
            box(at - t / 2 - 0.03, at + t / 2 + 0.03, o.lo, o.lo + f, o.a, o.b, o.frame);
            box(at - t / 2 - 0.03, at + t / 2 + 0.03, o.hi - f, o.hi, o.a, o.b, o.frame);
            box(at - 0.05, at + 0.05, o.lo, o.hi, mid - f / 2, mid + f / 2, o.frame);
          }
        }
      }
      s = o.b;
    }
    B3(s, s1, y0, y1);
    if (!collide) return;
    let c0 = s0;
    for (const o of sorted.filter((q) => q.door)) {
      if (o.a > c0) axis === 'x' ? seg(c0, at, o.a, at, ...collide) : seg(at, c0, at, o.a, ...collide);
      c0 = o.b;
    }
    if (c0 < s1) axis === 'x' ? seg(c0, at, s1, at, ...collide) : seg(at, c0, at, s1, ...collide);
  }
  const win = (a, b2, lo, hi) => ({ a, b: b2, lo, hi, frame: C.frame });
  const door = (a, b2, lo, hi) => ({ a, b: b2, lo, hi, door: true });

  const T = 0.25;
  const F1 = 0.15; // ground floor level
  const S0 = 3.6; // underside of the first floor slab
  const F2 = 3.75; // first floor level
  const R0 = 7.2; // underside of the roof slab
  const iw = hw - T / 2; // inner half width (wall centre lines)
  const id = hd - T / 2;
  // Stairwell along the west wall: foot at z = 1.0, top at z = -6.0.
  const stair = { x0: -iw + 0.12, x1: -iw + 1.72, z0: -6.0, z1: 1.0 };

  // ---------------- Shell ----------------
  // Ground floor exterior walls (front has the entrance).
  wall('x', id, -hw, hw, 0, S0, T, [win(-iw + 0.4, -1.45, 0.6, 2.9), door(-0.95, 0.95, 0, 2.55), win(1.45, iw - 0.4, 0.6, 2.9)], C.paint);
  wall('x', -id, -hw, hw, 0, S0, T, [win(-3.7, -2.1, 1.1, 2.5), win(-0.8, 0.8, 1.1, 2.5), win(2.1, 3.4, 1.6, 2.4)], C.paint);
  wall('z', -iw, -hd, hd, 0, S0, T, [win(-5.2, -3.8, 1.0, 2.6), win(3.0, 4.6, 0.9, 2.7), win(5.6, 7.2, 0.9, 2.7)], C.paint);
  wall('z', iw, -hd, hd, 0, S0, T, [win(-7.6, -6.6, 1.7, 2.4), win(-4.4, -2.8, 1.0, 2.6), win(-1.6, 0.0, 1.0, 2.6), win(3.0, 4.6, 0.9, 2.7), win(5.6, 7.2, 0.9, 2.7)], C.paint);
  // First floor exterior walls.
  const up = [F2 - 0.5, R0 + 1];
  wall('x', id, -hw, hw, S0, R0, T, [win(-iw + 0.4, -1.65, 4.6, 6.6), win(1.65, iw - 0.4, 4.6, 6.6)], C.paint, up);
  wall('x', -id, -hw, hw, S0, R0, T, [win(-4.8, -3.0, 4.8, 6.4), win(-0.9, 0.9, 4.8, 6.4), win(3.0, 4.8, 4.8, 6.4)], C.paint, up);
  wall('z', -iw, -hd, hd, S0, R0, T, [win(-7.0, -5.4, 4.7, 6.4), win(-3.0, -1.4, 4.7, 6.4), win(2.0, 3.6, 4.7, 6.4), win(5.4, 7.0, 4.7, 6.4)], C.paint, up);
  wall('z', iw, -hd, hd, S0, R0, T, [win(-7.0, -5.4, 4.7, 6.4), win(-3.0, -1.4, 4.7, 6.4), win(2.0, 3.6, 4.7, 6.4), win(5.4, 7.0, 4.7, 6.4)], C.paint, up);

  // Plinth, blue band between floors, roof slab and parapet.
  const ring = (y0, y1, out, color) => {
    box(-hw - out, -0.95, y0, y1, hd, hd + out, color);
    box(0.95, hw + out, y0, y1, hd, hd + out, color);
    box(-hw - out, hw + out, y0, y1, -hd - out, -hd, color);
    box(-hw - out, -hw, y0, y1, -hd, hd, color);
    box(hw, hw + out, y0, y1, -hd, hd, color);
  };
  ring(0, 0.6, 0.05, C.granite);
  ring(3.5, 3.95, 0.07, C.blue);
  box(-0.95, 0.95, 3.5, 3.95, hd, hd + 0.07, C.blue);
  box(-hw - 0.1, hw + 0.1, R0, R0 + 0.25, -hd - 0.1, hd + 0.1, C.roof);
  box(-hw - 0.1, hw + 0.1, R0 + 0.25, R0 + 1.0, hd - 0.1, hd + 0.1, C.paint);
  box(-hw - 0.1, hw + 0.1, R0 + 0.25, R0 + 1.0, -hd - 0.1, -hd + 0.1, C.paint);
  box(-hw - 0.1, -hw + 0.1, R0 + 0.25, R0 + 1.0, -hd, hd, C.paint);
  box(hw - 0.1, hw + 0.1, R0 + 0.25, R0 + 1.0, -hd, hd, C.paint);
  box(-hw - 0.12, hw + 0.12, R0 + 0.95, R0 + 1.05, hd - 0.12, hd + 0.12, C.blue);
  // Roof clutter: water tank and AC condensers.
  obj([[CY(0.6, 1.4, 0, 0.7, 0, 16), '#2f6fd1'], [B(1.6, 0.4, 1.6, 0, 0.2, 0), C.metal]], hw - 2.2, R0 + 0.25, -hd + 2.2);
  for (const z of [-3, -1, 1]) obj([[B(0.8, 0.6, 0.35, 0, 0.3, 0), '#d9d9d6']], -hw + 1.0, R0 + 0.25, z);

  // Ground floor slab, first floor slab (with stairwell hole), ceilings.
  const tilePlane = (x0, x1, z0, z1, y) => {
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, y, (z0 + z1) / 2);
    const uv = g.attributes.uv;
    const pos = g.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 0.6, pos.getZ(i) / 0.6);
    tileGeos.push(g);
  };
  box(-hw, hw, 0, F1 - 0.01, -hd, hd, C.graniteLight);
  tilePlane(-iw, iw, -id, id, F1);
  const slabRects = [
    [stair.x1, iw, -id, id],
    [-iw, stair.x1, -id, stair.z0],
    [-iw, stair.x1, stair.z1, id],
  ];
  for (const [x0, x1, z0, z1] of slabRects) {
    box(x0, x1, S0, F2 - 0.01, z0, z1, C.ceiling);
    tilePlane(x0, x1, z0, z1, F2);
  }
  // Ceiling light panels.
  for (const [x, z] of [[-3, 5.5], [0, 5.5], [3, 5.5], [-3, 2.5], [3, 2.5], [-1.5, -1.5], [2.5, -1.5], [-1.5, -4.5], [2.5, -4.5], [5, -7]]) {
    lightGeos.push(new THREE.BoxGeometry(1.1, 0.04, 0.55).translate(x, S0 - 0.03, z));
    lightGeos.push(new THREE.BoxGeometry(1.1, 0.04, 0.55).translate(x, R0 - 0.03, z));
  }

  // ---------------- Entrance: canopy, terrace, steps, columns, sliding doors ----------------
  box(-2.7, 2.7, 0, F1, hd, hd + 2.9, C.graniteLight);
  box(-2.7, 2.7, 0, 0.07, hd + 2.9, hd + 3.4, C.graniteLight);
  box(-2.8, 2.8, 3.0, 3.25, hd, hd + 3.0, C.paint);
  box(-2.85, 2.85, 2.85, 3.5, hd + 2.95, hd + 3.12, C.blue);
  for (const x of [-2.4, 2.4]) {
    obj([[CY(0.18, 3.0, 0, 1.5, 0, 16), C.white]], x, 0, hd + 2.6);
    const [wx, wz] = L2W(x, hd + 2.6);
    colliders.addCircle(wx, wz, 0.25);
  }
  // Door frame.
  box(-1.0, -0.92, F1, 2.6, id - 0.12, id + 0.12, C.frame);
  box(0.92, 1.0, F1, 2.6, id - 0.12, id + 0.12, C.frame);
  box(-1.0, 1.0, 2.55, 2.65, id - 0.12, id + 0.12, C.frame);
  glass(-0.95, 0.95, 2.65, 3.3, id - 0.02, id + 0.02);
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x9fc3d8, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
  const doorPanels = [-1, 1].map((sgn) => {
    const g = new THREE.Group();
    const pane = new THREE.Mesh(new THREE.BoxGeometry(0.92, 2.38, 0.04), glassMat);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.6, 0.05), new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 1, roughness: 0.25 }));
    handle.position.set(-sgn * 0.38, 0, 0.05);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.06, 0.06), new THREE.MeshStandardMaterial({ color: 0x1e2f4f }));
    rail.position.y = -1.18;
    g.add(pane, handle, rail);
    g.position.set(sgn * 0.47, F1 + 1.2, id);
    g.userData.dynamic = true;
    G.add(g);
    return { g, sgn };
  });

  // ---------------- Signs ----------------
  const signMat = (tex, glow = 0.35) => new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: glow, roughness: 0.5 });
  const plane = (mat, w, h, x, y, z, ry = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    G.add(m);
    return m;
  };
  const fasciaTex = canvasTexture(2048, 256, (ctx, w, h) => {
    ctx.fillStyle = '#1d4f91';
    ctx.fillRect(0, 0, w, h);
    drawLogo(ctx, 40, 28, 200);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 104px Arial, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('BADAN PUSAT STATISTIK', 290, 92);
    ctx.font = 'bold 64px Arial, sans-serif';
    ctx.fillStyle = '#ffd08a';
    ctx.fillText('KABUPATEN MAROS', 292, 192);
  });
  plane(signMat(fasciaTex), 5.6, 0.7, 0, 3.17, hd + 3.13);
  const logoTex = canvasTexture(512, 640, (ctx, w, h) => {
    ctx.fillStyle = '#1d4f91';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(w / 2, 230, 190, 0, Math.PI * 2);
    ctx.fill();
    drawLogo(ctx, w / 2 - 130, 100, 260);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 120px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('BPS', w / 2, 560);
  });
  box(-1.45, 1.45, 4.2, 6.95, hd, hd + 0.08, C.blue);
  plane(signMat(logoTex, 0.25), 2.2, 2.6, 0, 5.55, hd + 0.09);

  // ---------------- Ground floor interior ----------------
  const yG = [F1 - 0.2, S0];
  // Partition between the PST room and the back offices (stair access + office door).
  wall('x', 1.2, -iw, iw, F1, S0, 0.14, [door(stair.x0, stair.x1, F1, 2.6), door(1.4, 2.4, F1, 2.3)], C.paintIn, yG);
  // Stair enclosure / back office separation, under-landing store.
  wall('z', stair.x1 + 0.1, -id, 1.2, F1, S0, 0.14, [], C.paintIn, yG);
  wall('x', stair.z0, -iw, stair.x1 + 0.1, F1, S0, 0.14, [], C.paintIn, yG);
  // Toilet in the back-east corner.
  wall('z', iw - 2.4, -id, -5.6, F1, S0, 0.12, [door(-7.3, -6.5, F1, 2.2)], C.paintIn, yG);
  wall('x', -5.6, iw - 2.4, iw, F1, S0, 0.12, [], C.paintIn, yG);

  // PST service counter (customers stand on the front side).
  obj([[B(7.2, 1.0, 0.7, 0, 0.5, 0), C.blue], [B(7.2, 0.12, 0.08, 0, 0.75, 0.36), C.orange], [B(7.4, 0.05, 0.85, 0, 1.03, 0), C.wood]], 0, F1, 3.35);
  rectSegs(-3.7, 3.7, 2.95, 3.8, ...yG);
  const officeChair = (color = C.black) => [
    [B(0.5, 0.08, 0.5, 0, 0.47, 0), color],
    [B(0.48, 0.55, 0.06, 0, 0.8, -0.23), color],
    [CY(0.03, 0.4, 0, 0.25, 0), C.metal],
    [B(0.6, 0.04, 0.06, 0, 0.04, 0), C.metal],
    [B(0.06, 0.04, 0.6, 0, 0.04, 0), C.metal],
  ];
  const monitor = () => [
    [B(0.55, 0.34, 0.03, 0, 0.32, 0), C.black],
    [B(0.5, 0.29, 0.005, 0, 0.32, 0.02), 'screen'],
    [B(0.05, 0.16, 0.05, 0, 0.08, -0.02), C.metal],
    [B(0.22, 0.02, 0.16, 0, 0.01, -0.02), C.metal],
  ];
  for (const x of [-2.4, 0, 2.4]) {
    obj(monitor(), x, F1 + 1.06, 3.15, Math.PI);
    obj([[B(0.45, 0.02, 0.15, 0, 0.01, 0), C.black]], x, F1 + 1.06, 3.45);
    obj(officeChair(), x, F1, 2.3, 0);
    obj([[CY(0.2, 0.05, 0, 0.62, 0), C.fabric], [CY(0.03, 0.6, 0, 0.3, 0), C.steel], [CY(0.22, 0.03, 0, 0.015, 0), C.steel]], x, F1, 4.25);
  }
  // Waiting area: two rows of linked chairs facing the counter.
  const gangChairs = (n) => {
    const parts = [[B(n * 0.6, 0.05, 0.08, 0, 0.42, 0), C.steel]];
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * 0.6;
      parts.push([B(0.5, 0.05, 0.46, x, 0.46, 0), C.fabric], [B(0.5, 0.45, 0.05, x, 0.72, -0.22), C.fabric]);
    }
    parts.push([B(0.05, 0.42, 0.4, -n * 0.3, 0.21, 0), C.steel], [B(0.05, 0.42, 0.4, n * 0.3, 0.21, 0), C.steel]);
    return parts;
  };
  obj(gangChairs(5), -3.6, F1, 5.4, Math.PI);
  obj(gangChairs(5), -3.6, F1, 6.7, Math.PI);
  rectSegs(-5.2, -2.0, 5.1, 7.0, ...yG);
  // Queue ticket kiosk next to the door.
  obj([[B(0.45, 1.3, 0.35, 0, 0.65, 0), C.white], [B(0.38, 0.28, 0.02, 0, 1.05, 0.18), 'screen'], [B(0.45, 0.05, 0.35, 0, 1.32, 0), C.orange]], 1.7, F1, id - 0.6, Math.PI);
  // Library corner: shelves on the east wall and a reading table.
  const books = canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#7a5434';
    ctx.fillRect(0, 0, w, h);
    const cols = ['#1d4f91', '#2fa84f', '#ef7d14', '#b91c1c', '#f5f5f0', '#0f766e', '#facc15', '#7c3aed'];
    for (let row = 0; row < 4; row++) {
      const y0 = row * 128 + 10;
      ctx.fillStyle = '#5a3a20';
      ctx.fillRect(0, y0 + 108, w, 10);
      let x = 6;
      while (x < w - 10) {
        const bw = 10 + Math.random() * 14;
        const bh = 70 + Math.random() * 34;
        ctx.fillStyle = cols[Math.floor(Math.random() * cols.length)];
        ctx.fillRect(x, y0 + 108 - bh, bw, bh);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillRect(x + 2, y0 + 108 - bh + 10, bw - 4, 4);
        x += bw + 1;
      }
    }
  });
  const bookMat = new THREE.MeshStandardMaterial({ map: books, roughness: 0.8 });
  for (const z of [4.2, 5.6, 7.0]) {
    obj([[B(0.4, 2.0, 1.3, 0, 1.0, 0), C.woodDark]], iw - 0.35, F1, z);
    plane(bookMat, 1.25, 1.9, iw - 0.56, F1 + 1.0, z, -Math.PI / 2);
  }
  rectSegs(iw - 0.6, iw, 3.5, 7.7, ...yG);
  obj([[B(1.6, 0.05, 0.9, 0, 0.75, 0), C.wood], [B(0.06, 0.72, 0.8, -0.7, 0.37, 0), C.metal], [B(0.06, 0.72, 0.8, 0.7, 0.37, 0), C.metal]], 3.6, F1, 6.0);
  for (const [x, z, r] of [[3.1, 5.3, 0], [4.1, 5.3, 0], [3.1, 6.7, Math.PI], [4.1, 6.7, Math.PI]]) obj(officeChair(C.fabric), x, F1, z, r);
  rectSegs(2.7, 4.5, 5.5, 6.5, ...yG);
  // Plants.
  const plant = () => [[CY(0.22, 0.45, 0, 0.22, 0, 12), '#8a5a3a'], [new THREE.IcosahedronGeometry(0.42, 0).translate(0, 0.85, 0), '#3f7d3a'], [new THREE.IcosahedronGeometry(0.3, 0).translate(0.1, 1.2, 0.05), '#4f9a45']];
  for (const [x, z] of [[-1.3, id - 0.5], [1.15, id - 0.5], [-iw + 0.5, 1.7], [iw - 0.5, 1.7]]) obj(plant(), x, F1, z);
  // Brochure rack and TV.
  obj([[B(0.7, 1.4, 0.3, 0, 0.7, 0), C.steel], [B(0.62, 0.3, 0.05, 0, 0.5, 0.15), '#ffffff'], [B(0.62, 0.3, 0.05, 0, 1.0, 0.15), '#dbe7f7']], -iw + 0.35, F1, 4.2, Math.PI / 2);

  // Banner + TV on the partition, facing customers.
  const bannerTex = canvasTexture(2048, 320, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#1d4f91');
    g.addColorStop(1, '#2563c9');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ef7d14';
    ctx.fillRect(0, h - 26, w, 26);
    drawLogo(ctx, 40, 50, 210);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 110px Arial, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('PELAYANAN STATISTIK TERPADU', 290, 120);
    ctx.font = '600 58px Arial, sans-serif';
    ctx.fillStyle = '#ffe2bf';
    ctx.fillText('BPS Kabupaten Maros · Konsultasi · Perpustakaan · Penjualan Publikasi', 294, 230);
  });
  plane(signMat(bannerTex, 0.2), 6.4, 1.0, 0, 2.75, 1.29);
  const tvTex = canvasTexture(1024, 576, (ctx, w, h) => {
    ctx.fillStyle = '#0b2a55';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 64px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Selamat Datang', w / 2, 120);
    ctx.font = '600 40px Arial, sans-serif';
    ctx.fillText('di PST BPS Kabupaten Maros', w / 2, 180);
    const bars = [0.45, 0.62, 0.55, 0.78, 0.7, 0.9];
    bars.forEach((v, i) => {
      ctx.fillStyle = ['#2563c9', '#2fa84f', '#ef7d14'][i % 3];
      ctx.fillRect(170 + i * 120, 520 - v * 280, 80, v * 280);
    });
    ctx.fillStyle = '#9fb7d8';
    ctx.font = '30px Arial, sans-serif';
    ctx.fillText('Data mencerdaskan bangsa', w / 2, 560);
  });
  obj([[B(1.5, 0.88, 0.06, 0, 0, 0), C.black]], 4.7, F1 + 2.05, 1.32);
  plane(signMat(tvTex, 0.8), 1.42, 0.8, 4.7, F1 + 2.05, 1.36);
  const posterTex = canvasTexture(512, 720, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1d4f91';
    ctx.fillRect(0, 0, w, 120);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 40px Arial';
    ctx.fillText('INDIKATOR', 30, 56);
    ctx.fillText('STRATEGIS', 30, 102);
    const v = [0.5, 0.7, 0.4, 0.85, 0.6];
    v.forEach((x, i) => {
      ctx.fillStyle = ['#2563c9', '#2fa84f', '#ef7d14'][i % 3];
      ctx.fillRect(40 + i * 90, 620 - x * 420, 60, x * 420);
    });
    ctx.fillStyle = '#333';
    ctx.font = '26px Arial';
    ctx.fillText('Kabupaten Maros', 30, 680);
  });
  plane(signMat(posterTex, 0.05), 0.7, 1.0, -iw + 0.15, F1 + 1.7, 6.0, Math.PI / 2);

  // Back office: staff desks with computers, cabinets, printer.
  for (const z of [-1.6, -4.3]) {
    for (const x of [-2.5, 0.2, 2.6]) {
      if (x > 2 && z < -4) continue;
      obj([[B(1.4, 0.05, 0.7, 0, 0.75, 0), C.wood], [B(0.05, 0.72, 0.65, -0.66, 0.37, 0), C.wood], [B(0.05, 0.72, 0.65, 0.66, 0.37, 0), C.wood], [B(1.3, 0.4, 0.03, 0, 0.5, -0.32), C.wood]], x, F1, z);
      obj(monitor(), x, F1 + 0.78, z - 0.15, 0);
      obj(officeChair(), x, F1, z + 0.75, Math.PI);
      rectSegs(x - 0.72, x + 0.72, z - 0.37, z + 0.37, ...yG);
    }
  }
  for (const z of [-7.6, -6.8]) obj([[B(0.5, 1.6, 0.75, 0, 0.8, 0), '#8b9099']], stair.x1 + 0.5, F1, z);
  obj([[B(0.6, 0.5, 0.5, 0, 0.25, 0), '#d6d6d2'], [B(0.4, 0.1, 0.3, 0, 0.55, 0), C.metal]], 2.9, F1, 0.6);
  // Toilet fixtures.
  obj([[B(0.4, 0.42, 0.6, 0, 0.21, 0), C.white], [B(0.4, 0.5, 0.18, 0, 0.55, -0.24), C.white]], iw - 0.6, F1, -7.6);
  obj([[B(0.5, 0.15, 0.4, 0, 0.82, 0), C.white], [B(0.4, 0.6, 0.03, 0, 1.4, -0.18), '#bfd4e6']], iw - 1.6, F1, -id + 0.3);

  // Stairs: 20 steps rising towards the back, handrail on the open side.
  const steps = 20;
  const run = (stair.z1 - stair.z0) / steps;
  const rise = (F2 - F1) / steps;
  for (let i = 0; i < steps; i++) {
    const z1 = stair.z1 - i * run;
    box(stair.x0, stair.x1, F1, F1 + (i + 1) * rise, z1 - run, z1, i % 2 ? '#d8d4ca' : '#dcd8ce');
  }
  const rail = new THREE.BoxGeometry(0.05, 0.05, Math.hypot(stair.z1 - stair.z0, F2 - F1));
  rail.rotateX(Math.atan2(F2 - F1, stair.z1 - stair.z0));
  solids.push(colorize(rail.translate(stair.x1 - 0.05, (F1 + F2) / 2 + 0.95, (stair.z0 + stair.z1) / 2), C.steel));
  for (let i = 0; i <= 6; i++) {
    const z = stair.z1 - (i / 6) * (stair.z1 - stair.z0);
    const y = F1 + ((stair.z1 - z) / (stair.z1 - stair.z0)) * (F2 - F1);
    box(stair.x1 - 0.07, stair.x1 - 0.03, y, y + 0.95, z - 0.02, z + 0.02, C.steel);
  }

  // ---------------- First floor interior ----------------
  const yU = [F2 - 0.2, R0];
  // Corridor wall with doors to the meeting room and the head's office.
  wall('x', -5.0, stair.x1, iw, F2, R0, 0.14, [door(-2.4, -1.4, F2, F2 + 2.15), door(2.9, 3.9, F2, F2 + 2.15)], C.paintIn, yU);
  wall('z', 1.2, -5.0, id, F2, R0, 0.14, [], C.paintIn, yU);
  // Glass partition beside the stairwell, low railings at the open edges.
  wall('z', stair.x1, -5.0, stair.z1, F2, R0, 0.08, [win(-4.9, stair.z1 - 0.1, F2 + 0.9, R0 - 0.2)], C.paintIn, yU);
  for (const [x0, x1, z0, z1] of [[stair.x1 - 0.04, stair.x1 + 0.04, stair.z0, -5.0], [stair.x0, stair.x1, stair.z1 - 0.04, stair.z1 + 0.04]]) {
    box(x0, x1, F2, F2 + 1.0, z0, z1, C.steel);
    glass(x0, x1, F2 + 0.1, F2 + 0.95, z0, z1);
  }
  seg(stair.x1, stair.z0, stair.x1, -5.0, F2 - 0.2, F2 + 1.6);
  seg(stair.x0, stair.z1, stair.x1, stair.z1, F2 - 0.2, F2 + 1.6);

  // Meeting room: long table, chairs, projector screen.
  obj([[B(1.5, 0.06, 4.8, 0, 0.75, 0), C.wood], [B(1.1, 0.7, 0.08, 0, 0.36, -1.8), C.woodDark], [B(1.1, 0.7, 0.08, 0, 0.36, 1.8), C.woodDark]], -2.0, F2, 3.3);
  rectSegs(-2.8, -1.2, 0.85, 5.75, ...yU);
  for (let i = 0; i < 5; i++) {
    const z = 1.4 + i * 0.95;
    obj(officeChair(C.fabric), -3.1, F2, z, Math.PI / 2);
    obj(officeChair(C.fabric), -0.9, F2, z, -Math.PI / 2);
  }
  obj([[B(2.6, 1.6, 0.03, 0, 0, 0), '#f4f4f2'], [B(2.7, 0.08, 0.08, 0, 0.84, 0), C.metal]], -2.0, F2 + 1.9, id - 0.15);
  obj([[B(0.35, 0.12, 0.3, 0, 0, 0), '#e5e5e1']], -2.0, R0 - 0.35, 3.0);
  // Head of office: desk, executive chair, guest chairs, sofa, flags.
  obj([[B(1.8, 0.06, 0.85, 0, 0.76, 0), C.woodDark], [B(1.8, 0.72, 0.06, 0, 0.37, -0.4), C.woodDark], [B(0.06, 0.72, 0.8, -0.87, 0.37, 0), C.woodDark], [B(0.06, 0.72, 0.8, 0.87, 0.37, 0), C.woodDark]], 3.7, F2, 5.4);
  rectSegs(2.75, 4.65, 4.95, 5.85, ...yU);
  obj(monitor(), 3.3, F2 + 0.79, 5.35, 0);
  obj([[B(0.6, 0.1, 0.6, 0, 0.5, 0), '#2a2420'], [B(0.6, 0.8, 0.1, 0, 0.95, -0.28), '#2a2420'], [CY(0.03, 0.4, 0, 0.25, 0), C.metal], [B(0.6, 0.04, 0.06, 0, 0.04, 0), C.metal]], 3.7, F2, 6.4, Math.PI);
  obj(officeChair('#6b4527'), 3.2, F2, 4.4, 0);
  obj(officeChair('#6b4527'), 4.2, F2, 4.4, 0);
  obj([[B(2.0, 0.42, 0.8, 0, 0.21, 0), '#3b3f46'], [B(2.0, 0.5, 0.18, 0, 0.6, -0.31), '#3b3f46'], [B(0.18, 0.3, 0.8, -0.91, 0.55, 0), '#3b3f46'], [B(0.18, 0.3, 0.8, 0.91, 0.55, 0), '#3b3f46']], 4.0, F2, -3.9);
  obj([[B(1.0, 0.04, 0.55, 0, 0.42, 0), C.wood], [B(0.06, 0.4, 0.5, 0, 0.2, 0), C.wood]], 4.0, F2, -2.8);
  for (const [x, red] of [[5.4, true], [5.8, false]]) {
    obj([[CY(0.025, 2.2, 0, 1.1, 0), '#d4af37'], [CY(0.18, 0.06, 0, 0.03, 0), '#d4af37']], x, F2, 6.9);
    obj([[B(0.02, 0.45, 0.9, 0, 1.75, 0.45), red ? '#d4141c' : '#1d4f91'], [B(0.02, 0.45, 0.9, 0, 1.3, 0.45), red ? '#f8f8f8' : '#1d4f91']], x, F2, 6.9);
  }
  obj([[B(1.6, 2.0, 0.45, 0, 1.0, 0), '#8b6a4a']], 1.95, F2, 7.7);
  // Corridor: water dispenser, plant.
  obj([[B(0.35, 1.0, 0.35, 0, 0.5, 0), C.white], [CY(0.16, 0.45, 0, 1.23, 0, 14), '#7fb6e8']], iw - 0.4, F2, -7.6);
  obj(plant(), -1.5, F2, -7.6);

  // ---------------- Outside: parking with bays, flagpole ----------------
  const pave = new THREE.PlaneGeometry(2 * hw + 4, 13).rotateX(-Math.PI / 2).translate(0, 0.012, hd + 3.4 + 6.5);
  solids.push(colorize(pave, '#8e9096'));
  for (let i = 0; i <= 5; i++) box(-hw + 1 + i * 2.6 - 0.06, -hw + 1 + i * 2.6 + 0.06, 0.013, 0.02, hd + 10.5, hd + 15.5, '#f2f2f2');
  obj([[CY(0.07, 9, 0, 4.5, 0, 10), '#d9dce1'], [CY(0.4, 0.3, 0, 0.15, 0, 12), C.graniteLight], [B(1.8, 0.6, 0.03, 0.92, 8.45, 0), '#d4141c'], [B(1.8, 0.6, 0.03, 0.92, 7.85, 0), '#f8f8f8']], hw + 1.2, 0, hd + 5);
  {
    const [wx, wz] = L2W(hw + 1.2, hd + 5);
    colliders.addCircle(wx, wz, 0.3);
  }

  // ---------------- Meshes ----------------
  const solidMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05 });
  const sm = new THREE.Mesh(merge(solids), solidMat);
  sm.castShadow = sm.receiveShadow = true;
  G.add(sm);
  const tileTex = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#ece6da';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(${150 + Math.random() * 60},${140 + Math.random() * 50},${120 + Math.random() * 40},0.12)`;
      ctx.fillRect(Math.random() * w, Math.random() * h, 3 + Math.random() * 10, 2 + Math.random() * 6);
    }
    ctx.fillStyle = '#bfb6a6';
    ctx.fillRect(0, 0, w, 4);
    ctx.fillRect(0, 0, 4, h);
  });
  tileTex.wrapS = tileTex.wrapT = THREE.RepeatWrapping;
  const tm = new THREE.Mesh(merge(tileGeos), new THREE.MeshStandardMaterial({ map: tileTex, roughness: 0.25, metalness: 0.05 }));
  tm.receiveShadow = true;
  G.add(tm);
  G.add(new THREE.Mesh(merge(glassGeos), glassMat));
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x3a6fb5, emissive: 0x4f8fe0, emissiveIntensity: 0.8 });
  if (screenGeos.length) G.add(new THREE.Mesh(merge(screenGeos.map((g) => { g.deleteAttribute('color'); return g; })), screenMat));
  const panelMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e6, emissiveIntensity: 1.6 });
  G.add(new THREE.Mesh(merge(lightGeos), panelMat));
  // Office lighting: one light per floor plus the back office.
  for (const [x, y, z, i] of [[0.5, S0 - 0.4, 1.0, 20], [0, R0 - 0.4, 1.5, 16]]) {
    const l = new THREE.PointLight(0xfff3e0, i, 15, 1.4);
    l.position.set(x, y, z);
    G.add(l);
  }

  // ---------------- Collision (local -> world) ----------------
  for (const [ax, az, bx, bz, y0, y1] of segs) {
    const [wax, waz] = L2W(ax, az);
    const [wbx, wbz] = L2W(bx, bz);
    colliders.addSegment(wax, waz, wbx, wbz, y1, y0);
  }

  // ---------------- Floors for the player (height-aware) ----------------
  const insideFoot = (lx, lz) => Math.abs(lx) < iw - 0.05 && Math.abs(lz) < id - 0.05;
  const onTerrace = (lx, lz) => Math.abs(lx) < 2.7 && lz >= hd - 0.2 && lz <= hd + 2.9;
  const inStair = (lx, lz) => lx > stair.x0 - 0.1 && lx < stair.x1 + 0.05 && lz > stair.z0 && lz < stair.z1;
  function heightAt(x, z, y = 0) {
    const [lx, lz] = W2L(x, z);
    if (!insideFoot(lx, lz)) return onTerrace(lx, lz) ? F1 : 0;
    let best = F1;
    if (inStair(lx, lz)) {
      const ramp = F1 + ((stair.z1 - lz) / (stair.z1 - stair.z0)) * (F2 - F1);
      if (ramp <= y + 0.65) best = Math.max(best, ramp);
    } else if (F2 <= y + 0.65) best = F2;
    return best;
  }
  function ceilingAt(x, z, y = 0) {
    const [lx, lz] = W2L(x, z);
    if (!insideFoot(lx, lz)) return Infinity;
    if (inStair(lx, lz)) return R0;
    return y < S0 - 0.5 ? S0 : R0;
  }

  // Parking bays (world position + heading facing the building).
  const parking = [0, 1, 2, 3, 4].map((i) => {
    const [x, z] = L2W(-hw + 2.3 + i * 2.6, hd + 13);
    return { x, z, h: Math.atan2(-nx, -nz) };
  });

  return {
    name: 'BPS Kabupaten Maros',
    // Local building frame (for tests/tools): +x along the facade, +z out of the front door.
    toWorld: L2W,
    toLocal: W2L,
    inward: Math.atan2(-nx, -nz),
    dims: { hw, hd, stair, F1, F2 },
    centre: [cx, cz],
    entrance: L2W(0, hd + 4.5),
    parking,
    heightAt,
    ceilingAt,
    // Keep trees, poles and lamps off the site.
    contains(x, z) {
      const [lx, lz] = W2L(x, z);
      return Math.abs(lx) < hw + 3 && lz > -hd - 2.5 && lz < hd + 17;
    },
    isInside(x, z) {
      const [lx, lz] = W2L(x, z);
      return insideFoot(lx, lz);
    },
    update(dt, fx, fz) {
      // Automatic sliding doors.
      const [lx, lz] = W2L(fx, fz);
      const near = Math.abs(lx) < 2.2 && Math.abs(lz - id) < 3.2;
      for (const d of doorPanels) {
        d.open = (d.open || 0) + ((near ? 1 : 0) - (d.open || 0)) * Math.min(1, dt * 5);
        d.g.position.x = d.sgn * (0.47 + d.open * 0.86);
      }
    },
  };
}
