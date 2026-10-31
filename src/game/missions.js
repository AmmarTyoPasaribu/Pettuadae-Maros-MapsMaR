import * as THREE from 'three';

// Delivery jobs: drive any vehicle to the yellow beacon before time runs out.
// `pick(px, pz)` returns { x, z, name } so each map decides where jobs can go.
export function createMissions(scene, rnd, pick) {
  const group = new THREE.Group();
  group.visible = false;
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 110, 28, 1, true), beamMat);
  beam.position.y = 55;
  const ring = new THREE.Mesh(new THREE.RingGeometry(5.4, 6.6, 56), new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.08;
  group.add(beam, ring);
  scene.add(group);

  const M = { active: false, x: 0, z: 0, time: 0, total: 0, reward: 0, cooldown: 1, dist: 0, name: '' };

  function create(px, pz) {
    const d = pick(px, pz);
    if (!d) return;
    const dist = Math.hypot(d.x - px, d.z - pz);
    M.x = d.x;
    M.z = d.z;
    M.name = d.name || '';
    M.total = M.time = dist / 8.5 + 25;
    M.reward = Math.round(80 + dist * 0.5);
    M.active = true;
    group.position.set(d.x, 0, d.z);
    group.visible = true;
  }

  return {
    state: M,
    reset() {
      M.active = false;
      M.cooldown = 1;
      group.visible = false;
    },
    // ctx: { px, pz, inCar, onDone(reward, bonus), onFail() }
    update(dt, t, ctx) {
      beamMat.opacity = 0.16 + Math.sin(t * 3) * 0.05;
      ring.scale.setScalar(1 + Math.sin(t * 3) * 0.04);
      if (!M.active) {
        M.cooldown -= dt;
        if (M.cooldown <= 0) create(ctx.px, ctx.pz);
        return;
      }
      M.dist = Math.hypot(M.x - ctx.px, M.z - ctx.pz);
      M.time -= dt;
      if (ctx.inCar && M.dist < 8) {
        const bonus = Math.round(Math.max(0, M.time) * 0.8);
        M.active = false;
        M.cooldown = 3;
        group.visible = false;
        ctx.onDone(M.reward, bonus);
      } else if (M.time <= 0) {
        M.active = false;
        M.cooldown = 4;
        group.visible = false;
        ctx.onFail();
      }
    },
  };
}
