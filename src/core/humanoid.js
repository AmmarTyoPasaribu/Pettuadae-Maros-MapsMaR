import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Articulated low-poly humanoid (~1.9 units tall). Parts are merged with vertex colours into
// 9 meshes per character (body+head, and upper/lower segment of each limb) that all share one
// material, which keeps draw calls low with many pedestrians on screen.

const merge = (list) => mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)));
const tmp = new THREE.Color();
let sharedMat = null;
const material = () => (sharedMat ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }));

function paint(g, color) {
  tmp.set(color);
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set([tmp.r, tmp.g, tmp.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

export function makeHumanoid({ skin = '#e0ac69', shirt = '#2563eb', pants = '#1f2937', shoes = '#111111', hair = '#2b1a0e', cap = null } = {}) {
  const mat = material();
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const geos = [];
  const mesh = (parent, parts) => {
    const g = merge(parts);
    geos.push(g);
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  // Torso, neck, head, hair, eyes (and cap) in one mesh.
  const torso = new THREE.CapsuleGeometry(0.24, 0.42, 4, 10);
  torso.scale(1.15, 1, 0.75).translate(0, 1.33, 0);
  const headParts = [
    paint(torso, shirt),
    paint(new THREE.CylinderGeometry(0.075, 0.09, 0.12, 8).translate(0, 1.7, 0), skin),
    paint(new THREE.SphereGeometry(0.17, 14, 10).scale(1, 1.12, 1).translate(0, 1.86, 0), skin),
    paint(new THREE.SphereGeometry(0.178, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(1.02, 1.1, 1.05).translate(0, 1.89, -0.01), hair),
    paint(new THREE.SphereGeometry(0.022, 6, 6).translate(-0.06, 1.89, 0.155), '#111111'),
    paint(new THREE.SphereGeometry(0.022, 6, 6).translate(0.06, 1.89, 0.155), '#111111'),
  ];
  if (cap) {
    headParts.push(paint(new THREE.SphereGeometry(0.185, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.45).translate(0, 1.9, 0), cap));
    headParts.push(paint(new THREE.BoxGeometry(0.22, 0.02, 0.16).translate(0, 1.93, 0.2), cap));
  }
  mesh(body, headParts);
  const head = new THREE.Group();
  head.position.set(0, 1.86, 0);
  body.add(head);

  const limb = (x, y, r, len, color, end) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    body.add(pivot);
    mesh(pivot, [paint(new THREE.CapsuleGeometry(r, len * 0.5, 3, 8).translate(0, -len * 0.3, 0), color)]);
    const lower = new THREE.Group();
    lower.position.set(0, -len * 0.55, 0);
    pivot.add(lower);
    const parts = [paint(new THREE.CapsuleGeometry(r * 0.85, len * 0.45, 3, 8).translate(0, -len * 0.25, 0), color)];
    if (end === 'hand') parts.push(paint(new THREE.SphereGeometry(r * 0.95, 8, 6).translate(0, -len * 0.52, 0), skin));
    if (end === 'shoe') parts.push(paint(new THREE.BoxGeometry(0.15, 0.1, 0.28).translate(0, -0.47, 0.05), shoes));
    mesh(lower, parts);
    return { pivot, lower };
  };
  const lArm = limb(-0.33, 1.56, 0.075, 0.62, shirt, 'hand');
  const rArm = limb(0.33, 1.56, 0.075, 0.62, shirt, 'hand');
  const lLeg = limb(-0.13, 0.98, 0.1, 0.9, pants, 'shoe');
  const rLeg = limb(0.13, 0.98, 0.1, 0.9, pants, 'shoe');

  return {
    root,
    body,
    head,
    lArm,
    rArm,
    lLeg,
    rLeg,
    setShadow(on) {
      root.traverse((o) => {
        if (o.isMesh) o.castShadow = on;
      });
    },
    disposeMaterials() {
      geos.forEach((g) => g.dispose());
    },
    // phase in radians, amount 0..1 (walk -> sprint)
    run(phase, amount = 1) {
      const s = Math.sin(phase);
      const legA = 0.9 * amount;
      lLeg.pivot.rotation.x = s * legA;
      rLeg.pivot.rotation.x = -s * legA;
      lLeg.lower.rotation.x = Math.max(0, -Math.cos(phase)) * 1.3 * amount;
      rLeg.lower.rotation.x = Math.max(0, Math.cos(phase)) * 1.3 * amount;
      lArm.pivot.rotation.x = -s * 0.8 * amount;
      rArm.pivot.rotation.x = s * 0.8 * amount;
      lArm.lower.rotation.x = -0.9 * amount;
      rArm.lower.rotation.x = -0.9 * amount;
      body.position.y = Math.abs(Math.cos(phase)) * 0.08 * amount;
      body.rotation.x = 0.12 * amount;
    },
    // Standing still: gentle breathing and arm sway.
    idle(t) {
      lLeg.pivot.rotation.x = rLeg.pivot.rotation.x = 0;
      lLeg.lower.rotation.x = rLeg.lower.rotation.x = 0;
      lArm.pivot.rotation.x = Math.sin(t * 1.3) * 0.04;
      rArm.pivot.rotation.x = -Math.sin(t * 1.3) * 0.04;
      lArm.lower.rotation.x = rArm.lower.rotation.x = -0.08;
      body.position.y = Math.sin(t * 2.2) * 0.008;
      body.rotation.x = 0;
    },
    pose(name) {
      if (name === 'jump') {
        lLeg.pivot.rotation.x = -0.9; lLeg.lower.rotation.x = 1.4;
        rLeg.pivot.rotation.x = 0.3; rLeg.lower.rotation.x = 0.6;
        lArm.pivot.rotation.x = -2.4; rArm.pivot.rotation.x = -2.4;
        lArm.lower.rotation.x = 0; rArm.lower.rotation.x = 0;
        body.rotation.x = 0;
      }
    },
  };
}
