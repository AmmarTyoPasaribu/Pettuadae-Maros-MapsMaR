import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

// Shared renderer/scene/camera/loop with PBR-friendly defaults.
export function createEngine(container, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = opts.exposure ?? 1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.className = 'game-canvas';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    opts.fov ?? 60,
    container.clientWidth / container.clientHeight,
    opts.near ?? 0.1,
    opts.far ?? 1000
  );
  const pmrem = new THREE.PMREMGenerator(renderer);
  const extraDisposables = [];

  let update = null;
  let raf = 0;
  let running = true;
  const clock = new THREE.Clock();

  function loop() {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 1 / 20);
    if (running && update) update(dt, clock.elapsedTime);
    renderer.render(scene, camera);
  }

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  const onVisibility = () => clock.getDelta();
  document.addEventListener('visibilitychange', onVisibility);

  return {
    renderer,
    scene,
    camera,
    pmrem,
    onUpdate(fn) {
      update = fn;
    },
    start() {
      clock.start();
      loop();
    },
    setRunning(v) {
      running = v;
    },
    track(...items) {
      extraDisposables.push(...items);
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      const seen = new Set();
      const disposeMat = (m) => {
        if (!m || seen.has(m)) return;
        seen.add(m);
        for (const k in m) {
          const v = m[k];
          if (v && v.isTexture && !seen.has(v)) {
            seen.add(v);
            v.dispose();
          }
        }
        m.dispose();
      };
      scene.traverse((o) => {
        if (o.geometry && !seen.has(o.geometry)) {
          seen.add(o.geometry);
          o.geometry.dispose();
        }
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(disposeMat);
      });
      for (const d of extraDisposables) {
        if (d && !seen.has(d) && d.dispose) d.dispose();
      }
      if (scene.environment) scene.environment.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}

// Physically based sky + matching image-based lighting. Returns the sun direction.
export function addSky(engine, { elevation = 30, azimuth = 180, turbidity = 6, rayleigh = 1.5, mie = 0.005, mieG = 0.8, envIntensity = 1 } = {}) {
  const { scene, pmrem, renderer } = engine;
  const makeSky = () => {
    const sky = new Sky();
    sky.scale.setScalar(10000);
    const u = sky.material.uniforms;
    u.turbidity.value = turbidity;
    u.rayleigh.value = rayleigh;
    u.mieCoefficient.value = mie;
    u.mieDirectionalG.value = mieG;
    return sky;
  };
  const sun = new THREE.Vector3();
  const phi = THREE.MathUtils.degToRad(90 - elevation);
  const theta = THREE.MathUtils.degToRad(azimuth);
  sun.setFromSphericalCoords(1, phi, theta);

  const sky = makeSky();
  sky.material.uniforms.sunPosition.value.copy(sun);
  scene.add(sky);

  const envScene = new THREE.Scene();
  const envSky = makeSky();
  envSky.material.uniforms.sunPosition.value.copy(sun);
  envScene.add(envSky);
  const prevExposure = renderer.toneMappingExposure;
  const rt = pmrem.fromScene(envScene, 0.02);
  renderer.toneMappingExposure = prevExposure;
  scene.environment = rt.texture;
  scene.environmentIntensity = envIntensity;
  envSky.geometry.dispose();
  envSky.material.dispose();
  return { sky, sun };
}

// Directional "sun" with a soft shadow frustum that can follow a target.
export function addSun(scene, dir, { color = 0xffffff, intensity = 3, size = 30, mapSize = 2048, distance = 60 } = {}) {
  const light = new THREE.DirectionalLight(color, intensity);
  light.castShadow = true;
  light.shadow.mapSize.set(mapSize, mapSize);
  const c = light.shadow.camera;
  c.left = -size;
  c.right = size;
  c.top = size;
  c.bottom = -size;
  c.near = 1;
  c.far = distance * 3;
  light.shadow.bias = -0.0004;
  light.shadow.normalBias = 0.03;
  scene.add(light);
  scene.add(light.target);
  const offset = dir.clone().normalize().multiplyScalar(distance);
  light.position.copy(offset);
  return {
    light,
    follow(p) {
      light.target.position.copy(p);
      light.position.copy(p).add(offset);
    },
  };
}
