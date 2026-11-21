import * as THREE from 'three';
import * as tex from '../../core/textures.js';

// Water surfaces: two layers of ripples scrolling over each other (rivers flow along their
// direction), sky reflections from the environment map, sun glints, and a Fresnel term that
// makes the water see-through when looking down and mirror-like at grazing angles.
// `rain` adds fast small ripples while it rains.

export function createWaterMaterials() {
  const normals = tex.waterNormals();
  const uniforms = { uTime: { value: 0 }, uRain: { value: 0 } };
  const make = (color, minAlpha, flow, scale) => {
    const m = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.07,
      metalness: 0.0,
      transparent: true,
      depthWrite: false,
      normalMap: normals,
      normalScale: new THREE.Vector2(scale, scale),
      envMapIntensity: 1.5,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uniforms.uTime;
      sh.uniforms.uRain = uniforms.uRain;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uRain;')
        .replace(
          'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
          `vec2 fl = vec2(0.0, ${flow.toFixed(3)});
          vec3 n1 = texture2D( normalMap, vNormalMapUv + uTime * (fl + vec2(0.011, 0.004)) ).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D( normalMap, vNormalMapUv * 1.83 + vec2(0.37, 0.11) + uTime * (fl * 1.4 - vec2(0.006, -0.013)) ).xyz * 2.0 - 1.0;
          vec3 n3 = texture2D( normalMap, vNormalMapUv * 7.1 + uTime * vec2(0.09, -0.07) ).xyz * 2.0 - 1.0;
          vec3 mapN = normalize( vec3( n1.xy + n2.xy * 0.7 + n3.xy * uRain * 1.4, 1.0 ) );`,
        )
        .replace(
          '#include <opaque_fragment>',
          `float fres = pow( 1.0 - clamp( dot( normalize( vViewPosition ), normal ), 0.0, 1.0 ), 4.0 );
          diffuseColor.a = mix( ${minAlpha.toFixed(2)}, 1.0, fres );
          #include <opaque_fragment>`,
        );
    };
    m.customProgramCacheKey = () => `water-${flow}-${minAlpha}`;
    return m;
  };
  return {
    river: make(0x3b5641, 0.8, 0.05, 0.45), // Sungai Maros: murky green-brown, flowing
    pond: make(0x2f5a4c, 0.74, 0.0, 0.35),
    drain: make(0x3e4a33, 0.9, 0.03, 0.3),
    uniforms,
    update(t, rain = 0) {
      uniforms.uTime.value = t;
      uniforms.uRain.value = rain;
    },
  };
}
