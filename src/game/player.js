import { makeHumanoid } from '../core/humanoid.js';
import { env, clamp } from './util.js';

const WALK = 1.9;
const JOG = 4.3;
const SPRINT = 7.8;

// On-foot controller: camera-relative movement, jog/walk/sprint with stamina, jump,
// wall collisions, and a seated pose for riding motorbikes.
export function createPlayer(scene, colliders) {
  const hero = makeHumanoid({ skin: '#c58c5c', shirt: '#b91c1c', pants: '#1f2937', shoes: '#f1f5f9', hair: '#120c08', cap: '#111827' });
  scene.add(hero.root);

  const P = { x: 0, z: 0, y: 0, vy: 0, face: Math.PI, sp: 0, phase: 0, grounded: true, dirX: 0, dirZ: 1, hp: 100, speed: 0, lie: 0, stamina: 100, tired: false, sprinting: false };
  const probe = { x: 0, z: 0 };

  function resetPose() {
    hero.body.rotation.set(0, 0, 0);
    hero.body.position.set(0, 0, 0);
    for (const l of [hero.lArm, hero.rArm, hero.lLeg, hero.rLeg]) {
      l.pivot.rotation.set(0, 0, 0);
      l.lower.rotation.set(0, 0, 0);
    }
  }

  function place(x, z, face = P.face) {
    P.x = x;
    P.z = z;
    P.y = env.groundHeight(x, z, P.y);
    P.vy = 0;
    P.sp = 0;
    P.grounded = true;
    P.face = face;
    P.lie = 0;
    resetPose();
    sync();
  }

  function sync() {
    hero.root.position.set(P.x, P.y, P.z);
    hero.root.rotation.set(0, P.face, 0);
  }

  // mv: { fwd, right, sprint, walk, jump }
  function update(dt, mv, camYaw) {
    const fx = Math.sin(camYaw);
    const fz = Math.cos(camYaw);
    let dx = fx * mv.fwd - fz * mv.right;
    let dz = fz * mv.fwd + fx * mv.right;
    const len = Math.hypot(dx, dz);
    if (len > 1) { dx /= len; dz /= len; }
    const mag = Math.min(1, len);
    if (mag > 0.05) {
      P.dirX = dx / mag;
      P.dirZ = dz / mag;
      let dy = Math.atan2(P.dirX, P.dirZ) - P.face;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      P.face += dy * Math.min(1, dt * 14);
    }

    // Stamina: sprinting drains it; once empty you must recover to 30% before sprinting again.
    P.sprinting = mv.sprint && mag > 0.3 && !P.tired && P.stamina > 0;
    if (P.sprinting) P.stamina = Math.max(0, P.stamina - 17 * dt);
    else P.stamina = Math.min(100, P.stamina + (mag > 0.3 ? 9 : 16) * dt);
    if (P.stamina <= 0) P.tired = true;
    if (P.tired && P.stamina > 30) P.tired = false;

    const target = (P.sprinting ? SPRINT : mv.walk ? WALK : JOG) * mag;
    P.sp += (target - P.sp) * Math.min(1, dt * 8);
    P.x += P.dirX * P.sp * dt;
    P.z += P.dirZ * P.sp * dt;

    probe.x = P.x;
    probe.z = P.z;
    probe.y = P.y + 0.9;
    if (colliders.resolve(probe, 0.42)) {
      P.x = probe.x;
      P.z = probe.z;
    }
    P.x = clamp(P.x, -env.limit, env.limit);
    P.z = clamp(P.z, -env.limit, env.limit);

    const gh = env.groundHeight(P.x, P.z, P.y);
    if (mv.jump && P.grounded && P.stamina > 8) {
      P.vy = 5.8;
      P.grounded = false;
      P.stamina -= 8;
    }
    if (!P.grounded) {
      P.vy -= 17 * dt;
      P.y += P.vy * dt;
      if (P.y <= gh) {
        P.y = gh;
        P.vy = 0;
        P.grounded = true;
      }
    } else {
      P.y += (gh - P.y) * Math.min(1, dt * 18);
      if (P.y > gh + 0.3) P.grounded = false;
    }
    P.speed = P.sp;

    if (!P.grounded) hero.pose('jump');
    else {
      if (P.sp > 0.2) P.phase += dt * (P.sp * 1.75 + 1);
      hero.run(P.phase, Math.min(1, P.sp / 6.8));
      // Sprinting leans forward a little more.
      hero.body.rotation.x += P.sprinting ? 0.12 : 0;
    }
    sync();
  }

  // Seated on a scooter: parent the hero to the bike body.
  function mount(bikeBody) {
    resetPose();
    bikeBody.add(hero.root);
    hero.root.position.set(0, -0.1, -0.28);
    hero.root.rotation.set(0, 0, 0);
    hero.body.rotation.x = 0.18;
    hero.lLeg.pivot.rotation.x = -1.35;
    hero.rLeg.pivot.rotation.x = -1.35;
    hero.lLeg.lower.rotation.x = 1.25;
    hero.rLeg.lower.rotation.x = 1.25;
    hero.lArm.pivot.rotation.set(-1.15, 0, -0.12);
    hero.rArm.pivot.rotation.set(-1.15, 0, 0.12);
    hero.lArm.lower.rotation.x = -0.35;
    hero.rArm.lower.rotation.x = -0.35;
  }

  function dismount() {
    scene.add(hero.root);
    resetPose();
    sync();
  }

  // Lying on the ground after being wasted.
  function collapse(dt) {
    P.lie = Math.min(1, P.lie + dt * 2.5);
    hero.body.rotation.x = -P.lie * 1.5;
    hero.body.position.y = -P.lie * 0.85;
  }

  return { P, hero, root: hero.root, place, update, collapse, sync, probe, mount, dismount };
}
