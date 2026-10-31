import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Procedural vehicle models typical for South Sulawesi streets: matic scooters, family MPVs,
// open pickups and pete-pete minibuses (plus a rare sports car). Geometry is merged per material
// and cached per type, so each vehicle is ~10 draw calls.

const merge = (list) => mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)));
const box = (w, h, d, x, y, z, rx = 0, ry = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  return g.translate(x, y, z);
};
const cyl = (r1, r2, h, x, y, z, seg = 12, rz = 0, rx = 0) => {
  const g = new THREE.CylinderGeometry(r1, r2, h, seg);
  if (rz) g.rotateZ(rz);
  if (rx) g.rotateX(rx);
  return g.translate(x, y, z);
};

// Side profile [z, y] extruded across the vehicle width.
function profile(pts, width, bevel = 0.06) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, steps: 1 });
  g.rotateY(-Math.PI / 2);
  g.translate(width / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}

let M = null;
function mats() {
  if (!M) {
    M = {
      glass: new THREE.MeshStandardMaterial({ color: 0x0b111a, metalness: 0.5, roughness: 0.08 }),
      black: new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.6 }),
      chrome: new THREE.MeshStandardMaterial({ color: 0xd5d8de, metalness: 1, roughness: 0.2 }),
      tire: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92 }),
      head: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xe8f2ff, emissiveIntensity: 2.2 }),
      seat: new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.75 }),
      rider: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }),
    };
  }
  return M;
}

const G = {};
const once = (k, f) => (G[k] ??= f());

// ---------------- Wheels ----------------
function wheelGeos(r, w) {
  return once(`wheel${r}${w}`, () => {
    const tire = cyl(r, r, w, 0, 0, 0, 24, Math.PI / 2);
    const hub = [cyl(r * 0.62, r * 0.62, w + 0.02, 0, 0, 0, 10, Math.PI / 2)];
    for (let k = 0; k < 3; k++) hub.push(box(w + 0.03, r * 1.15, 0.05, 0, 0, 0, (k * Math.PI) / 3));
    return { tire, hub: merge(hub) };
  });
}

// ---------------- Body definitions per type ----------------
const BODIES = {
  mpv: () => ({
    paint: merge([
      profile([[-2.1, 0.32], [2.1, 0.32], [2.17, 0.62], [2.07, 0.86], [1.25, 1.02], [-2.0, 1.04], [-2.12, 0.62]], 1.72),
      box(1.66, 0.06, 2.55, 0, 1.63, -0.55),
      box(0.06, 0.6, 0.12, 0.82, 1.32, 0.05),
      box(0.06, 0.6, 0.12, -0.82, 1.32, 0.05),
      box(0.16, 0.1, 0.12, 0.95, 1.08, 1.05),
      box(0.16, 0.1, 0.12, -0.95, 1.08, 1.05),
    ]),
    glass: profile([[1.25, 1.0], [0.72, 1.6], [-1.86, 1.62], [-2.03, 1.05]], 1.6, 0.03),
    black: merge([box(1.6, 0.2, 0.06, 0, 0.42, 2.16), box(1.6, 0.18, 0.06, 0, 0.42, -2.13), box(0.9, 0.16, 0.05, 0, 0.66, 2.16)]),
    head: merge([box(0.38, 0.12, 0.05, 0.6, 0.76, 2.12, -0.3), box(0.38, 0.12, 0.05, -0.6, 0.76, 2.12, -0.3)]),
    tail: merge([box(0.18, 0.4, 0.05, 0.74, 0.95, -2.11), box(0.18, 0.4, 0.05, -0.74, 0.95, -2.11)]),
    wheels: [[-0.76, 1.35], [0.76, 1.35], [-0.76, -1.35], [0.76, -1.35]],
    wheel: [0.33, 0.24],
    door: { x: -0.9, hinge: 1.2, len: 1.15, y0: 0.4, y1: 1.0, w0: 1.03, w1: 1.52 },
  }),
  pickup: () => ({
    paint: merge([
      profile([[0.2, 0.36], [2.15, 0.36], [2.2, 0.66], [2.12, 0.92], [1.5, 1.06], [0.25, 1.08]], 1.7),
      box(1.62, 0.06, 1.0, 0, 1.68, 0.7),
      box(1.7, 0.12, 2.2, 0, 0.62, -1.0),
      box(0.07, 0.45, 2.2, 0.82, 0.9, -1.0),
      box(0.07, 0.45, 2.2, -0.82, 0.9, -1.0),
      box(1.7, 0.45, 0.07, 0, 0.9, -2.08),
      box(1.7, 0.45, 0.07, 0, 0.9, 0.08),
    ]),
    glass: profile([[1.5, 1.04], [1.12, 1.66], [0.25, 1.66], [0.25, 1.06]], 1.58, 0.03),
    black: merge([box(1.7, 0.18, 0.08, 0, 0.42, 2.18), box(1.72, 0.12, 2.2, 0, 0.45, -1.0), box(1.4, 0.04, 0.04, 0, 1.15, 0.12)]),
    head: merge([box(0.34, 0.14, 0.05, 0.6, 0.8, 2.15), box(0.34, 0.14, 0.05, -0.6, 0.8, 2.15)]),
    tail: merge([box(0.14, 0.26, 0.05, 0.76, 0.86, -2.12), box(0.14, 0.26, 0.05, -0.76, 0.86, -2.12)]),
    wheels: [[-0.74, 1.45], [0.74, 1.45], [-0.74, -1.25], [0.74, -1.25]],
    wheel: [0.33, 0.22],
    door: { x: -0.89, hinge: 1.45, len: 1.1, y0: 0.42, y1: 1.05, w0: 1.08, w1: 1.58 },
  }),
  angkot: () => ({
    paint: merge([
      profile([[-1.95, 0.34], [1.95, 0.34], [2.0, 0.64], [1.98, 0.98], [1.8, 1.08], [-1.95, 1.1]], 1.62),
      box(1.62, 0.07, 3.55, 0, 1.86, -0.15),
      box(0.06, 0.78, 0.1, 0.79, 1.48, 1.0),
      box(0.06, 0.78, 0.1, -0.79, 1.48, 1.0),
      box(0.06, 0.78, 0.1, 0.79, 1.48, -1.92),
      box(0.06, 0.78, 0.1, -0.79, 1.48, -1.92),
      box(0.06, 0.78, 0.1, -0.79, 1.48, -0.5),
    ]),
    glass: profile([[1.8, 1.07], [1.58, 1.84], [-1.93, 1.84], [-1.95, 1.09]], 1.56, 0.03),
    black: merge([box(1.62, 0.18, 0.06, 0, 0.42, 1.99), box(1.62, 0.18, 0.06, 0, 0.42, -1.97), box(1.3, 0.05, 2.6, 0, 1.93, -0.2), box(0.05, 1.0, 0.75, 0.82, 1.2, 0.35)]),
    head: merge([box(0.3, 0.16, 0.05, 0.58, 0.82, 2.0), box(0.3, 0.16, 0.05, -0.58, 0.82, 2.0)]),
    tail: merge([box(0.14, 0.3, 0.05, 0.7, 0.9, -1.97), box(0.14, 0.3, 0.05, -0.7, 0.9, -1.97)]),
    wheels: [[-0.72, 1.25], [0.72, 1.25], [-0.72, -1.25], [0.72, -1.25]],
    wheel: [0.31, 0.2],
    door: { x: -0.85, hinge: 1.75, len: 0.85, y0: 0.4, y1: 1.08, w0: 1.12, w1: 1.78 },
  }),
  sport: () => ({
    paint: merge([
      profile([[-2.15, 0.3], [2.2, 0.3], [2.28, 0.55], [2.15, 0.82], [1.15, 1.0], [-1.3, 1.02], [-2.1, 0.98], [-2.22, 0.6]], 1.8, 0.09),
      box(1.5, 0.05, 0.95, 0, 1.47, -0.15),
    ]),
    glass: profile([[-1.35, 0.98], [1.05, 0.98], [0.35, 1.42], [-0.65, 1.44]], 1.5),
    black: merge([box(1.8, 0.05, 0.35, 0, 1.22, -2.0), box(0.06, 0.22, 0.12, 0.6, 1.1, -2.0), box(0.06, 0.22, 0.12, -0.6, 1.1, -2.0), box(1.0, 0.16, 0.05, 0, 0.5, 2.3)]),
    head: merge([box(0.42, 0.1, 0.06, 0.62, 0.72, 2.22, -0.4), box(0.42, 0.1, 0.06, -0.62, 0.72, 2.22, -0.4)]),
    tail: merge([box(0.5, 0.1, 0.05, 0.6, 0.82, -2.2), box(0.5, 0.1, 0.05, -0.6, 0.82, -2.2)]),
    wheels: [[-0.86, 1.35], [0.86, 1.35], [-0.86, -1.4], [0.86, -1.4]],
    wheel: [0.36, 0.28],
    door: { x: -0.94, hinge: 1.1, len: 1.25, y0: 0.35, y1: 0.98, w0: 1.0, w1: 1.36 },
  }),
  // Matic scooter.
  moto: () => ({
    paint: merge([
      box(0.36, 0.42, 0.7, 0, 0.62, -0.38),
      box(0.3, 0.3, 0.5, 0, 0.5, -0.55),
      box(0.42, 0.62, 0.12, 0, 0.72, 0.42, -0.25),
      box(0.28, 0.08, 0.55, 0, 0.32, 0.1),
      box(0.3, 0.16, 0.32, 0, 1.08, 0.5),
    ]),
    glass: box(0.22, 0.06, 0.12, 0, 1.2, 0.62, -0.5),
    black: merge([
      box(0.34, 0.1, 0.62, 0, 0.9, -0.3),
      cyl(0.03, 0.03, 0.78, 0, 1.12, 0.52, 8, Math.PI / 2),
      cyl(0.035, 0.035, 0.62, 0, 0.62, 0.62, 8, 0, -0.35),
      cyl(0.04, 0.05, 0.35, 0.14, 0.3, -0.62, 8, 0, Math.PI / 2),
      box(0.02, 0.22, 0.02, 0.3, 1.25, 0.52),
      box(0.02, 0.22, 0.02, -0.3, 1.25, 0.52),
    ]),
    head: box(0.18, 0.1, 0.05, 0, 1.1, 0.67),
    tail: box(0.16, 0.06, 0.05, 0, 0.82, -0.73),
    wheels: [[0, 0.62], [0, -0.6]],
    wheel: [0.28, 0.09],
  }),
};

// Seated rider merged into one mesh (vertex colours) for traffic scooters.
const RIDER_COLORS = [
  ['#1d4ed8', '#1f2937', '#111827'], ['#b91c1c', '#374151', '#f8fafc'], ['#f8fafc', '#1f2937', '#dc2626'],
  ['#15803d', '#3b4a63', '#111827'], ['#7c3aed', '#1f2937', '#facc15'], ['#ea580c', '#374151', '#1d4ed8'],
];
function riderGeo(variant) {
  return once(`rider${variant}`, () => {
    const [shirt, pants, helmet] = RIDER_COLORS[variant % RIDER_COLORS.length];
    const parts = [];
    const add = (g, color) => {
      const c = new THREE.Color(color);
      const n = g.attributes.position.count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      parts.push(g);
    };
    add(box(0.42, 0.55, 0.26, 0, 1.25, -0.28, 0.25), shirt);
    add(new THREE.SphereGeometry(0.15, 12, 10).translate(0, 1.66, -0.16), '#c58c5c');
    add(new THREE.SphereGeometry(0.17, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.62).translate(0, 1.7, -0.17), helmet);
    for (const s of [-1, 1]) {
      add(box(0.15, 0.15, 0.48, s * 0.13, 0.98, -0.12), pants);
      add(box(0.13, 0.45, 0.13, s * 0.17, 0.72, 0.1), pants);
      add(box(0.1, 0.1, 0.48, s * 0.24, 1.32, 0.18, 0.55), shirt);
      add(box(0.12, 0.08, 0.2, s * 0.17, 0.5, 0.16), '#1b1b1d');
    }
    return merge(parts);
  });
}

// Physics/handling per type (used by game/vehicles.js and the AI).
export const VEHICLE_SPECS = {
  mpv: { r: 1.0, offs: [1.35, 0, -1.35], accel: 13, top: 36, rev: 8, steerMax: 0.55, wheelbase: 2.65, cam: 7.4, label: 'Mobil' },
  pickup: { r: 1.0, offs: [1.4, 0, -1.4], accel: 11, top: 33, rev: 7, steerMax: 0.52, wheelbase: 2.7, cam: 7.6, label: 'Pickup' },
  angkot: { r: 1.0, offs: [1.25, 0, -1.25], accel: 10, top: 30, rev: 7, steerMax: 0.55, wheelbase: 2.5, cam: 7.6, label: 'Pete-pete' },
  sport: { r: 1.05, offs: [1.45, 0, -1.45], accel: 17, top: 48, rev: 9, steerMax: 0.55, wheelbase: 2.75, cam: 7.4, label: 'Mobil sport' },
  moto: { r: 0.45, offs: [0.55, -0.55], accel: 12, top: 27, rev: 3, steerMax: 0.7, wheelbase: 1.25, cam: 4.8, label: 'Motor', moto: true },
};

export function makeVehicleModel(type, color, { rider = -1 } = {}) {
  const m = mats();
  const B = once(`body:${type}`, BODIES[type]);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const paint = new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.3 });
  const tail = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1a1a, emissiveIntensity: 1.2 });
  const add = (parent, geo, mat, shadow = true) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = shadow;
    mesh.receiveShadow = shadow;
    parent.add(mesh);
    return mesh;
  };
  add(body, B.paint, paint);
  add(body, B.glass, m.glass);
  add(body, B.black, type === 'moto' ? m.seat : m.black);
  add(body, B.head, m.head, false);
  add(body, B.tail, tail, false);
  if (rider >= 0) add(body, riderGeo(rider), m.rider);

  // Driver door on a hinge so it can swing open (see Vehicle.setDoor).
  const doors = [];
  if (B.door) {
    const d = B.door;
    const pivot = new THREE.Group();
    pivot.position.set(d.x, 0, d.hinge);
    const panel = once(`door:${type}`, () => new THREE.BoxGeometry(0.06, d.y1 - d.y0, d.len).translate(0, (d.y0 + d.y1) / 2, -d.len / 2));
    const pane = once(`doorglass:${type}`, () => new THREE.BoxGeometry(0.04, d.w1 - d.w0, d.len * 0.86).translate(0.01, (d.w0 + d.w1) / 2, -d.len * 0.5));
    add(pivot, panel, paint);
    add(pivot, pane, m.glass, false);
    add(pivot, once('handle', () => new THREE.BoxGeometry(0.03, 0.04, 0.18).translate(-0.04, 0.88, -0.85)), m.chrome, false);
    body.add(pivot);
    doors.push(pivot);
  }

  const { tire, hub } = wheelGeos(...B.wheel);
  const wheels = B.wheels.map(([x, z]) => {
    const steerG = new THREE.Group();
    steerG.position.set(x, B.wheel[0], z);
    const spin = new THREE.Group();
    steerG.add(spin);
    add(spin, tire, m.tire);
    add(spin, hub, m.chrome, false);
    (type === 'moto' ? body : root).add(steerG);
    return { steerG, spin, front: z > 0, x, z };
  });
  return { root, body, wheels, tail, paint, type, doors, door: B.door || null };
}
