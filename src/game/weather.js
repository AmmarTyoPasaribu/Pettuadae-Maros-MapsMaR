import * as THREE from 'three';
import { sfx } from '../core/audio.js';

// Tropical weather for Maros: clear spells, cloudy afternoons, rain showers and the odd
// thunderstorm. Drives a drifting cloud layer, rain streaks around the camera, thunder flashes,
// and gives the sky / fog / road wetness the values they need.

export const WEATHER = {
  cerah: { label: 'Cerah', cloud: 0.15, rain: 0 },
  berawan: { label: 'Berawan', cloud: 0.6, rain: 0 },
  hujan: { label: 'Hujan', cloud: 0.85, rain: 0.65 },
  badai: { label: 'Badai petir', cloud: 1, rain: 1 },
};
const ORDER = ['cerah', 'berawan', 'hujan', 'badai'];

function cloudTexture() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  // Soft puffs at several scales (wrapping at the edges so the texture tiles).
  const puff = (x, y, r, a) => {
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    }
  };
  for (let i = 0; i < 26; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    for (let k = 0; k < 9; k++) puff(x + (Math.random() - 0.5) * 90, y + (Math.random() - 0.5) * 40, 20 + Math.random() * 40, 0.16);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function createWeather({ scene, camera }) {
  const S = { kind: 'cerah', mode: 'auto', cloud: 0.15, rain: 0, wet: 0, next: 3 + Math.random() * 3, flash: 0, boltT: 8 };

  // ---------------- Cloud layer ----------------
  const ctex = cloudTexture();
  ctex.repeat.set(3, 3);
  const cloudMat = new THREE.MeshBasicMaterial({ map: ctex, transparent: true, opacity: 0.4, depthWrite: false, fog: false, side: THREE.DoubleSide, color: 0xffffff });
  const clouds = new THREE.Mesh(new THREE.PlaneGeometry(5200, 5200).rotateX(Math.PI / 2), cloudMat);
  clouds.position.y = 420;
  clouds.renderOrder = -1;
  clouds.frustumCulled = false;
  clouds.userData.dynamic = true;
  scene.add(clouds);
  // Second, denser overcast sheet that fades in with rain.
  const overMat = cloudMat.clone();
  overMat.map = ctex.clone();
  overMat.map.repeat.set(1.6, 1.6);
  overMat.opacity = 0;
  const over = new THREE.Mesh(new THREE.PlaneGeometry(5200, 5200).rotateX(Math.PI / 2), overMat);
  over.position.y = 360;
  over.frustumCulled = false;
  over.userData.dynamic = true;
  scene.add(over);

  // ---------------- Rain streaks (positions wrap around the camera in the shader) ----------------
  const N = 5000, BOX = 70, H = 40;
  const pos = new Float32Array(N * 6);
  const end = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    const x = Math.random() * BOX, y = Math.random() * H, z = Math.random() * BOX;
    pos.set([x, y, z, x, y, z], i * 6);
    end.set([0, 1], i * 2);
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  rg.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  const rainMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uAmt: { value: 0 }, uBright: { value: 1 } },
    vertexShader: `
      attribute float aEnd;
      uniform float uTime; uniform vec3 uCam; uniform float uAmt;
      varying float vA;
      void main() {
        vec3 p = position;
        p.y = mod(p.y - uTime * 22.0, ${H.toFixed(1)});
        p.x = mod(p.x - uCam.x + uTime * 2.0, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)};
        p.z = mod(p.z - uCam.z, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)};
        vec3 w = vec3(uCam.x + p.x, uCam.y + p.y - ${(H / 2).toFixed(1)}, uCam.z + p.z);
        w += aEnd * vec3(0.09, -0.75, 0.0);
        // Thin out the streaks when it only drizzles.
        vA = step(fract(position.x * 13.17 + position.z * 7.31), uAmt);
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }`,
    fragmentShader: `
      varying float vA; uniform float uBright;
      void main() { if (vA < 0.5) discard; gl_FragColor = vec4(vec3(0.72, 0.78, 0.86) * uBright, 0.32); }`,
  });
  const rain = new THREE.LineSegments(rg, rainMat);
  rain.frustumCulled = false;
  rain.userData.dynamic = true;
  rain.visible = false;
  scene.add(rain);

  function choose() {
    const r = Math.random();
    S.kind = r < 0.45 ? 'cerah' : r < 0.75 ? 'berawan' : r < 0.93 ? 'hujan' : 'badai';
  }

  return {
    state: S,
    get label() {
      return WEATHER[S.kind].label;
    },
    // 'auto' or a fixed kind (from the pause menu).
    cycleMode() {
      const modes = ['auto', ...ORDER];
      S.mode = modes[(modes.indexOf(S.mode) + 1) % modes.length];
      if (S.mode !== 'auto') S.kind = S.mode;
      return S.mode === 'auto' ? 'Otomatis' : WEATHER[S.mode].label;
    },
    set(kind) {
      S.kind = kind;
    },
    update(dt, t, hoursPassed, camPos, night, indoor) {
      if (S.mode === 'auto') {
        S.next -= hoursPassed;
        if (S.next <= 0) {
          choose();
          S.next = 2 + Math.random() * 4;
        }
      }
      const W = WEATHER[S.kind];
      const k = Math.min(1, dt * 0.05);
      S.cloud += (W.cloud - S.cloud) * k;
      S.rain += (W.rain - S.rain) * k * 1.6;
      if (S.rain < 0.01 && W.rain === 0) S.rain = Math.max(0, S.rain - dt * 0.01);
      S.wet = Math.max(0, Math.min(1, S.wet + (S.rain > 0.15 ? dt * 0.03 : -dt * 0.006)));
      // Clouds drift with the wind.
      ctex.offset.x = (t * 0.0012) % 1;
      ctex.offset.y = (t * 0.0005) % 1;
      overMat.map.offset.x = (t * 0.002) % 1;
      clouds.position.x = camPos.x;
      clouds.position.z = camPos.z;
      over.position.x = camPos.x;
      over.position.z = camPos.z;
      const lum = 1 - night * 0.85;
      cloudMat.opacity = 0.25 + S.cloud * 0.55;
      cloudMat.color.setScalar(lum * (1 - S.rain * 0.45));
      overMat.opacity = Math.max(0, S.cloud - 0.5) * 1.7;
      overMat.color.setScalar(lum * (0.75 - S.rain * 0.3));
      // Rain.
      rain.visible = S.rain > 0.02;
      rainMat.uniforms.uTime.value = t;
      rainMat.uniforms.uCam.value.copy(camPos);
      rainMat.uniforms.uAmt.value = S.rain * (indoor ? 0.25 : 1);
      rainMat.uniforms.uBright.value = 0.35 + 0.65 * (1 - night);
      // Lightning in storms.
      S.flash = Math.max(0, S.flash - dt * 4);
      if (S.kind === 'badai' && S.rain > 0.6) {
        S.boltT -= dt;
        if (S.boltT <= 0) {
          S.boltT = 6 + Math.random() * 14;
          S.flash = 1;
          const dist = 0.3 + Math.random() * 0.7;
          setTimeout(() => sfx.thunder(1.1 - dist * 0.6), dist * 2500);
        }
      }
      void camera;
    },
  };
}
