import { makeVehicleModel, VEHICLE_SPECS } from '../core/vehicles3d.js';
import { env, clamp } from './util.js';

export { VEHICLE_SPECS };

// Collision circles along a vehicle's length (spec.offs), for any heading.
export function vehicleCircles(spec, x, z, h) {
  const s = Math.sin(h);
  const c = Math.cos(h);
  return spec.offs.map((o) => [x + s * o, z + c * o]);
}

// Drivable vehicle with arcade physics (grip, handbrake slides, simple collisions).
// Works for cars and motorbikes; handling comes from VEHICLE_SPECS[type].
export class Vehicle {
  constructor(scene, type, color, x, z, h, opts = {}) {
    this.type = type;
    this.spec = VEHICLE_SPECS[type];
    this.model = makeVehicleModel(type, color, opts);
    this.car = this.model;
    this.root = this.model.root;
    scene.add(this.root);
    Object.assign(this, { x, z, h, y: 0, vx: 0, vz: 0, yaw: 0, steer: 0, wheelRot: 0, vF: 0, vS: 0, speed: 0, slip: 0, driver: false, braking: false, color, roll: 0, pitch: 0 });
    this.sync();
  }

  get r() {
    return this.spec.r;
  }

  circles() {
    return vehicleCircles(this.spec, this.x, this.z, this.h);
  }

  // Driver door opening: 0 = closed, 1 = fully open (about 66 degrees).
  setDoor(t) {
    for (const d of this.model.doors) d.rotation.y = t * 1.15;
  }

  // Where someone stands to get in: beside the driver door (or beside a scooter).
  doorPoint() {
    const d = this.model.door;
    const lx = d ? d.x - 0.75 : -0.85;
    const lz = d ? d.hinge - d.len * 0.65 : 0;
    const s = Math.sin(this.h);
    const c = Math.cos(this.h);
    return { x: this.x + lx * c + lz * s, z: this.z - lx * s + lz * c };
  }

  step(dt, ctl, colliders) {
    const sp = this.spec;
    const sin = Math.sin(this.h);
    const cos = Math.cos(this.h);
    let vF = this.vx * sin + this.vz * cos;
    let vS = this.vx * cos - this.vz * sin;
    const speed = Math.hypot(this.vx, this.vz);
    const { thr, brk, steer, hand } = ctl;

    if (thr) vF += (vF < -0.5 ? 24 : sp.accel * (1 - Math.max(0, vF) / sp.top)) * dt;
    if (brk) vF -= (vF > 0.5 ? 28 : 8 * Math.max(0, 1 + vF / sp.rev)) * dt;
    vF -= vF * (thr ? 0.06 : 0.5) * dt;
    if (hand) vF -= Math.sign(vF) * Math.min(Math.abs(vF), (sp.moto ? 14 : 9) * dt);
    if (!thr && !brk && Math.abs(vF) < 0.15 && Math.abs(vS) < 0.15) {
      vF = 0;
      vS = 0;
    }
    this.braking = !!(brk && vF > 0.5) || !!hand;

    const slip = speed > 3 ? Math.atan2(Math.abs(vS), Math.abs(vF)) : 0;
    // Motorbikes barely slide; cars can drift with the handbrake.
    const grip = sp.moto ? 12 : hand ? 1.1 : slip > 0.45 ? 3 : 8;
    vS *= Math.exp(-grip * dt);

    const steerMax = sp.steerMax / (1 + speed / 24);
    this.steer += (steer * steerMax - this.steer) * Math.min(1, dt * 9);
    let yawT = (vF * Math.tan(this.steer)) / sp.wheelbase;
    if (hand && !sp.moto) yawT += steer * 1.6 * Math.min(1, speed / 14);
    this.yaw += (yawT - this.yaw) * Math.min(1, dt * (hand ? 4 : 8));
    this.h += this.yaw * dt;

    // Velocity is rebuilt with the old heading so the body slips sideways.
    this.vx = vF * sin + vS * cos;
    this.vz = vF * cos - vS * sin;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    let impact = 0;
    if (colliders) {
      const s = Math.sin(this.h);
      const c = Math.cos(this.h);
      const p = { x: 0, z: 0 };
      for (const o of sp.offs) {
        p.x = this.x + s * o;
        p.z = this.z + c * o;
        const ox = p.x;
        const oz = p.z;
        const n = colliders.resolve(p, sp.r);
        if (!n) continue;
        this.x += p.x - ox;
        this.z += p.z - oz;
        const vn = this.vx * n.nx + this.vz * n.nz;
        if (vn < 0) {
          this.vx -= 1.25 * vn * n.nx;
          this.vz -= 1.25 * vn * n.nz;
          impact = Math.max(impact, -vn);
        }
      }
    }
    const L = env.limit;
    if (Math.abs(this.x) > L) { this.x = clamp(this.x, -L, L); this.vx *= -0.2; }
    if (Math.abs(this.z) > L) { this.z = clamp(this.z, -L, L); this.vz *= -0.2; }

    this.vF = this.vx * Math.sin(this.h) + this.vz * Math.cos(this.h);
    this.vS = this.vx * Math.cos(this.h) - this.vz * Math.sin(this.h);
    this.speed = Math.hypot(this.vx, this.vz);
    this.slip = slip;

    this.y += (env.groundHeight(this.x, this.z) - this.y) * Math.min(1, dt * 14);
    // Bikes lean into turns; cars roll away from them.
    const rollT = sp.moto ? clamp(-this.yaw * this.vF * 0.055, -0.55, 0.55) : -this.vS * 0.012;
    this.roll += (rollT - this.roll) * Math.min(1, dt * (sp.moto ? 5 : 6));
    this.pitch += ((brk ? 0.03 : 0) - (thr ? 0.02 : 0) - this.pitch) * Math.min(1, dt * 5);
    this.wheelRot += (this.vF / 0.33) * dt;
    this.sync();
    return impact;
  }

  sync() {
    this.root.position.set(this.x, this.y, this.z);
    this.root.rotation.y = this.h;
    this.model.body.rotation.z = this.roll;
    this.model.body.rotation.x = this.pitch;
    for (const w of this.model.wheels) {
      w.spin.rotation.x = this.wheelRot;
      if (w.front) w.steerG.rotation.y = this.steer * 1.4;
    }
    this.model.tail.emissiveIntensity = this.braking ? 4 : 1.2;
  }

  dispose(scene) {
    scene.remove(this.root);
    this.model.paint.dispose();
    this.model.tail.dispose();
  }
}

// Vehicle-vs-vehicle pushes between drivable vehicles. Returns the strongest impact.
export function collideVehicles(list) {
  let impact = 0;
  for (let a = 0; a < list.length; a++) {
    for (let b = a + 1; b < list.length; b++) {
      const A = list[a];
      const B = list[b];
      const dx = B.x - A.x;
      const dz = B.z - A.z;
      if (dx * dx + dz * dz > 36) continue;
      const min = A.r + B.r;
      for (const [ax, az] of A.circles()) {
        for (const [bx, bz] of B.circles()) {
          let nx = bx - ax;
          let nz = bz - az;
          const d = Math.hypot(nx, nz);
          if (d >= min) continue;
          if (d < 1e-4) { nx = 1; nz = 0; } else { nx /= d; nz /= d; }
          const push = (min - d) / 2;
          A.x -= nx * push; A.z -= nz * push;
          B.x += nx * push; B.z += nz * push;
          const approach = (A.vx - B.vx) * nx + (A.vz - B.vz) * nz;
          if (approach > 0) {
            const j = (1.3 * approach) / 2;
            A.vx -= j * nx; A.vz -= j * nz;
            B.vx += j * nx; B.vz += j * nz;
            impact = Math.max(impact, approach);
          }
        }
      }
    }
  }
  return impact;
}

// Stops a drivable vehicle from penetrating an immovable agent (AI traffic).
export function blockVehicle(v, circles, r2) {
  let impact = 0;
  const min = v.r + r2;
  for (const [ax, az] of v.circles()) {
    for (const [bx, bz] of circles) {
      let nx = ax - bx;
      let nz = az - bz;
      const d = Math.hypot(nx, nz);
      if (d >= min) continue;
      if (d < 1e-4) { nx = 1; nz = 0; } else { nx /= d; nz /= d; }
      v.x += nx * (min - d);
      v.z += nz * (min - d);
      const vn = v.vx * nx + v.vz * nz;
      if (vn < 0) {
        v.vx -= 1.2 * vn * nx;
        v.vz -= 1.2 * vn * nz;
        impact = Math.max(impact, -vn);
      }
    }
  }
  return impact;
}
