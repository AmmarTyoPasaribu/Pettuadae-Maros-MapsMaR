import { makeHumanoid } from '../core/humanoid.js';
import { env, clamp } from './util.js';

const WALK = 1.9;
const JOG = 4.3;
const SPRINT = 7.8;
const SWIM = 1.75;
const SWIM_FAST = 2.9;

// On-foot controller: camera-relative movement, jog/walk/sprint with stamina, jump,
// swimming in deep water, wall collisions, and a seated pose for riding motorbikes.
// `on` receives sound cues: step(sprinting), splash(strength), stroke().
export function createPlayer(scene, colliders) {
  // Avatar based on the owner's photo: medium-brown skin, curly black hair, black tunic and trousers.
  const hero = makeHumanoid({ style: 'mar', skin: '#b57c58', shirt: '#121016', pants: '#0e0c13', shoes: '#16141a', hair: '#0c0a0b' });
  scene.add(hero.root);

  const P = { x: 0, z: 0, y: 0, vy: 0, face: Math.PI, sp: 0, phase: 0, grounded: true, dirX: 0, dirZ: 1, hp: 100, speed: 0, lie: 0, stamina: 100, tired: false, sprinting: false, swimming: false, swimT: 0, tilt: 0, water: -Infinity };
  const probe = { x: 0, z: 0 };
  const on = { step() {}, splash() {}, stroke() {} };
  let stepPhase = 0;

  function resetPose() {
    hero.body.rotation.set(0, 0, 0);
    hero.body.position.set(0, 0, 0);
    for (const l of [hero.lArm, hero.rArm, hero.lLeg, hero.rLeg]) {
      l.pivot.rotation.set(0, 0, 0);
      l.lower.rotation.set(0, 0, 0);
    }
  }

  // y (optional): roughly where they were, to pick the right floor / deck.
  function place(x, z, face = P.face, y) {
    P.x = x;
    P.z = z;
    P.y = env.groundHeight(x, z, y === undefined ? undefined : y + 0.5);
    P.vy = 0;
    P.sp = 0;
    P.grounded = true;
    P.swimming = false;
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
      P.face += dy * Math.min(1, dt * (P.swimming ? 5 : 14));
    }

    // Deep water: start swimming once the water is about chest deep.
    const wl = env.waterAt(P.x, P.z);
    P.water = wl;
    const depth = wl - env.groundHeight(P.x, P.z, P.y);
    if (!P.swimming && depth > 1.35 && P.y < wl - 0.5) {
      P.swimming = true;
      on.splash(Math.min(1, 0.3 + Math.max(0, -P.vy) * 0.08));
      P.vy = 0;
      P.grounded = false;
    } else if (P.swimming && depth < 1.15) {
      P.swimming = false;
      P.grounded = true;
      resetPose();
    }

    // Stamina: sprinting (or fast swimming) drains it; once empty, recover to 30% first.
    P.sprinting = mv.sprint && mag > 0.3 && !P.tired && P.stamina > 0;
    if (P.sprinting) P.stamina = Math.max(0, P.stamina - (P.swimming ? 13 : 17) * dt);
    else P.stamina = Math.min(100, P.stamina + (P.swimming ? 5 : mag > 0.3 ? 9 : 16) * dt);
    if (P.stamina <= 0) P.tired = true;
    if (P.tired && P.stamina > 30) P.tired = false;

    const target = P.swimming ? (P.sprinting ? SWIM_FAST : SWIM) * mag : (P.sprinting ? SPRINT : mv.walk ? WALK : JOG) * mag;
    P.sp += (target - P.sp) * Math.min(1, dt * (P.swimming ? 3 : 8));
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
    if (P.swimming) {
      // Float with the head above water; bob gently.
      P.swimT += dt * (0.9 + P.sp * 0.9);
      const amount = Math.min(1, P.sp / SWIM);
      P.tilt = hero.swim(P.swimT * 2.4, amount);
      const fy = env.waterAt(P.x, P.z) + 0.22 - 1.86 * Math.cos(P.tilt) + Math.sin(P.swimT * 3) * 0.035;
      P.y += (Math.max(gh, fy) - P.y) * Math.min(1, dt * 3);
      const s = Math.floor((P.swimT * 2.4) / Math.PI);
      if (s !== stepPhase && amount > 0.25) on.stroke();
      stepPhase = s;
      P.speed = P.sp;
      sync();
      return;
    }
    if (mv.jump && P.grounded && P.stamina > 8) {
      P.vy = 5.8;
      P.grounded = false;
      P.stamina -= 8;
    }
    if (!P.grounded) {
      P.vy -= 17 * dt;
      P.y += P.vy * dt;
      if (P.y <= gh) {
        if (P.vy < -9) on.step(true);
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
      // Footsteps on each foot plant.
      const s = Math.floor(P.phase / Math.PI);
      if (s !== stepPhase && P.sp > 0.6) on.step(P.sprinting, depth > 0.05 && depth < 1.35);
      stepPhase = s;
    }
    sync();
  }

  // Seated on a scooter: parent the hero to the bike body.
  function mount(bikeBody, pose = 'moto') {
    resetPose();
    bikeBody.add(hero.root);
    hero.root.position.set(0, pose === 'bike' ? 0.05 : -0.1, pose === 'bike' ? -0.18 : -0.28);
    hero.root.rotation.set(0, 0, 0);
    hero.body.rotation.x = pose === 'bike' ? 0.32 : 0.18;
    hero.lLeg.pivot.rotation.x = -1.35;
    hero.rLeg.pivot.rotation.x = -1.35;
    hero.lLeg.lower.rotation.x = 1.25;
    hero.rLeg.lower.rotation.x = 1.25;
    hero.lArm.pivot.rotation.set(-1.15, 0, -0.12);
    hero.rArm.pivot.rotation.set(-1.15, 0, 0.12);
    hero.lArm.lower.rotation.x = -0.35;
    hero.rArm.lower.rotation.x = -0.35;
  }

  // Pedalling on a bicycle: legs follow the crank.
  function pedal(crank) {
    hero.lLeg.pivot.rotation.x = -1.05 + Math.sin(crank) * 0.45;
    hero.rLeg.pivot.rotation.x = -1.05 - Math.sin(crank) * 0.45;
    hero.lLeg.lower.rotation.x = 1.0 + Math.cos(crank) * 0.45;
    hero.rLeg.lower.rotation.x = 1.0 - Math.cos(crank) * 0.45;
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

  return { P, hero, root: hero.root, place, update, collapse, sync, probe, mount, dismount, pedal, resetPose, on };
}
