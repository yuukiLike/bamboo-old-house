import * as T from 'three';

type ScalarUniform = { value: number };

const WATER_GLSL = /* glsl */ `
uniform float uWaterTime;
uniform float uWaterNight;
uniform vec3 uWaterSunDirection;
varying vec3 vReservoirWorld;

float reservoirNoise(vec2 p) {
  vec2 cell = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  vec4 corners = vec4(dot(cell, vec2(127.1,311.7)),
    dot(cell + vec2(1.0,0.0), vec2(127.1,311.7)),
    dot(cell + vec2(0.0,1.0), vec2(127.1,311.7)),
    dot(cell + vec2(1.0,1.0), vec2(127.1,311.7)));
  vec4 values = fract(sin(corners) * 43758.5453);
  return mix(mix(values.x, values.y, f.x), mix(values.z, values.w, f.x), f.y);
}

// Sum analytic height derivatives in world metres. Short waves fade before
// their footprint becomes subpixel, so silver glints do not turn into noise.
vec2 reservoirWave(vec2 p, vec2 direction, float frequency, float speed, float slope, float phase) {
  float angle = dot(p, direction) * frequency + uWaterTime * speed + phase;
  float resolved = 1.0 - smoothstep(0.7, 2.9, fwidth(angle));
  return direction * cos(angle) * slope * resolved;
}

vec3 reservoirNormal(vec2 p) {
  float gust = reservoirNoise(p * 0.036 + vec2(uWaterTime * 0.006, 0.0));
  vec2 gradient = reservoirWave(p, vec2(0.8944,0.4472), 0.74, 0.30, 0.033, 0.0);
  gradient += reservoirWave(p, vec2(-0.3162,0.9487), 1.31, -0.41, 0.026, 1.7);
  gradient += reservoirWave(p, vec2(0.9806,-0.1961), 5.8, 0.69, 0.048, 2.4);
  gradient += reservoirWave(p, vec2(0.4472,0.8944), 9.7, -0.82, 0.033, 4.1);
  gradient += reservoirWave(p, vec2(-0.6247,0.7809), 28.0, 1.17, 0.025, 0.8);
  gradient += reservoirWave(p, vec2(0.9487,0.3162), 47.0, -1.43, 0.019, 3.2);
  gradient *= 0.70 + gust * 0.55;
  return normalize(vec3(-gradient.x, 1.0, -gradient.y));
}

vec3 reservoirReflection(vec3 surfaceNormal, vec3 viewToEye) {
  float day = 1.0 - uWaterNight;
  float noV = clamp(dot(surfaceNormal, viewToEye), 0.0, 1.0);
  float fresnel = 0.0204 + 0.9796 * pow(1.0 - noV, 5.0);
  vec3 reflectedView = reflect(-viewToEye, surfaceNormal);
  float elevation = clamp(reflectedView.y, 0.0, 1.0);
  // Neutral, luminous low sky reflected by grazing water; never cyan pigment.
  // Values remain HDR until the scene's existing ACES/exposure stage.
  float horizon = exp(-elevation * 3.8);
  vec3 daySky = mix(vec3(0.48,0.60,0.67), vec3(3.7,3.85,3.72), horizon);
  vec3 nightSky = mix(vec3(0.006,0.011,0.020), vec3(0.036,0.050,0.069), horizon);
  float reflectedSun = max(dot(reflectedView, uWaterSunDirection), 0.0);
  float sunVeil = pow(reflectedSun, 3.0);
  float sunTrack = pow(reflectedSun, 24.0);
  float sunFacet = pow(reflectedSun, 180.0);
  float rippleBreakup = 0.78 + reservoirNoise(vReservoirWorld.xz * 0.43
    + vec2(uWaterTime * 0.025, -uWaterTime * 0.019)) * 0.30;
  // A broad sunlit sheen plus smaller moving facets. The reflected direction
  // changes with both the eye and the wave normal; this is not a white overlay.
  vec3 sunlight = vec3(1.0,0.982,0.923)
    * (sunVeil * 3.2 + sunTrack * 12.0 + sunFacet * 20.0) * rippleBreakup;
  vec3 moonlight = vec3(0.42,0.57,0.77)
    * (pow(reflectedSun, 22.0) * 0.12 + pow(reflectedSun, 110.0) * 0.8);
  return fresnel * (mix(nightSky, daySky, day)
    + sunlight * day + moonlight * uWaterNight);
}
`;

/** One existing-size water plane and one draw call; scene disposal owns resources. */
export function addReservoirWater(
  scene: T.Scene,
  waterY: number,
  time: ScalarUniform,
  night: ScalarUniform,
  sun: T.DirectionalLight,
) {
  const lightDirection = { value: new T.Vector3().subVectors(sun.position, sun.target.position).normalize() };
  const material = new T.MeshPhysicalMaterial({
    color: 0x182321,
    metalness: 0,
    roughness: 0.26,
    ior: 1.333,
    clearcoat: 0,
    envMapIntensity: 0.035,
  });
  material.name = 'Reservoir_silver_ripple_reflection';
  material.onBeforeCompile = shader => {
    shader.uniforms.uWaterTime = time;
    shader.uniforms.uWaterNight = night;
    shader.uniforms.uWaterSunDirection = lightDirection;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vReservoirWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvReservoirWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + WATER_GLSL)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec3 reservoirWorldNormal = reservoirNormal(vReservoirWorld.xz);
        normal = normalize(mat3(viewMatrix) * reservoirWorldNormal);
      `)
      .replace('#include <opaque_fragment>', `
        vec3 reservoirViewToEye = normalize(cameraPosition - vReservoirWorld);
        outgoingLight += reservoirReflection(reservoirWorldNormal, reservoirViewToEye);
        #include <opaque_fragment>
      `);
  };
  material.customProgramCacheKey = () => 'reservoir-silver-ripples-1';
  const water = new T.Mesh(new T.PlaneGeometry(1200, 1200), material);
  water.name = 'Reservoir_water';
  water.rotation.x = -Math.PI / 2;
  water.position.y = waterY;
  water.receiveShadow = true;
  scene.add(water);
  return {
    water,
    update() {
      lightDirection.value.subVectors(sun.position, sun.target.position).normalize();
    },
  };
}
