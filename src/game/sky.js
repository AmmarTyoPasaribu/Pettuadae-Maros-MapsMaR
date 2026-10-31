import * as THREE from 'three';
import { addSky } from '../core/engine.js';

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Dynamic time of day: physical sky, sun/moon light with shadows, fog, stars.
export function createSky(engine) {
  const { scene, renderer } = engine;
  const { sky } = addSky(engine, { elevation: 45, azimuth: 160, turbidity: 6, rayleigh: 1.4, envIntensity: 0.7 });
  const sunUniform = sky.material.uniforms.sunPosition.value;

  scene.fog = new THREE.Fog(0xbcd0e6, 150, 1100);

  const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x6a6a5a, 0.6);
  scene.add(hemi);

  const light = new THREE.DirectionalLight(0xffffff, 3);
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  const sc = light.shadow.camera;
  sc.left = -70;
  sc.right = 70;
  sc.top = 70;
  sc.bottom = -70;
  sc.near = 1;
  sc.far = 400;
  light.shadow.bias = -0.0004;
  light.shadow.normalBias = 0.04;
  scene.add(light, light.target);

  // Stars + moon
  const starPos = new Float32Array(1800 * 3);
  for (let i = 0; i < 1800; i++) {
    const u = Math.random();
    const v = Math.random() * 0.5 + 0.02;
    const th = u * Math.PI * 2;
    const r = Math.sqrt(1 - v * v);
    starPos.set([Math.cos(th) * r * 900, v * 900, Math.sin(th) * r * 900], i * 3);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
  stars.frustumCulled = false;
  scene.add(stars);
  const moon = new THREE.Mesh(new THREE.CircleGeometry(30, 40), new THREE.MeshBasicMaterial({ color: 0xe9efff, fog: false }));
  scene.add(moon);

  const dir = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const cDay = new THREE.Color(0xc0d4ea);
  const cDusk = new THREE.Color(0xf2905a);
  const cNight = new THREE.Color(0x04060c);
  const sunDay = new THREE.Color(0xffffff);
  const sunLow = new THREE.Color(0xffa860);
  const moonCol = new THREE.Color(0x8fa8ff);
  const hDay = new THREE.Color(0xbfd8ff);
  const hNight = new THREE.Color(0x1d2845);
  const gDay = new THREE.Color(0x6a6a5a);
  const gNight = new THREE.Color(0x08080e);

  const state = { night: 0, day: 1, dir };

  return {
    state,
    light,
    update(timeH, focus, camPos) {
      const a = ((timeH - 6) / 24) * Math.PI * 2;
      dir.set(Math.cos(a), Math.sin(a), 0.32).normalize();
      sunUniform.copy(dir);
      const y = dir.y;
      const day = smooth(-0.04, 0.3, y);
      const night = 1 - smooth(-0.14, 0.08, y);
      state.night = night;
      state.day = day;

      if (y >= 0) {
        tmp.copy(dir);
        light.intensity = 2.5 * smooth(0, 0.28, y);
        light.color.copy(sunLow).lerp(sunDay, smooth(0, 0.45, y));
      } else {
        tmp.copy(dir).negate();
        light.intensity = 0.6 * smooth(0, 0.3, -y);
        light.color.copy(moonCol);
      }
      light.position.copy(focus).addScaledVector(tmp, 160);
      light.target.position.copy(focus);

      hemi.intensity = 0.14 + 0.32 * day;
      hemi.color.copy(hNight).lerp(hDay, day);
      hemi.groundColor.copy(gNight).lerp(gDay, day);
      scene.environmentIntensity = 0.05 + 0.3 * day;

      scene.fog.color.copy(cNight).lerp(cDay, day).lerp(cDusk, (1 - smooth(0, 0.22, Math.abs(y))) * 0.65 * (1 - night * 0.6));
      renderer.toneMappingExposure = 0.62 + 0.6 * night;

      stars.material.opacity = Math.max(0, night - 0.2) / 0.8;
      stars.visible = stars.material.opacity > 0.01;
      stars.position.copy(camPos);
      moon.visible = y < 0.15;
      moon.position.copy(camPos).addScaledVector(dir, -700);
      moon.lookAt(camPos);
    },
    label(timeH) {
      const h = Math.floor(timeH) % 24;
      const m = Math.floor((timeH % 1) * 60);
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    },
  };
}
