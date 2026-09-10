import type { MeshStandardMaterial } from 'three';

/** Approximate the loss of sky bounce inside the kitchen and the old upper rooms.
 * The shared hemisphere light otherwise lights their rear walls like outdoors.
 * Only indirect light is attenuated; actual sun and bulb shadows still apply.
 * Cycles obtains this falloff from the real room geometry in the editable scene.
 */
export function shadeWindowRecesses(material: MeshStandardMaterial, night: { value: number }) {
  if (material.userData.windowRecessLighting) return;
  material.userData.windowRecessLighting = true;
  const previous = material.onBeforeCompile.bind(material);
  const previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = function (shader, renderer) {
    previous(shader, renderer);
    shader.uniforms.oldHouseNight = night;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 windowRoomWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nwindowRoomWorld=(modelMatrix*vec4(transformed,1.)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 windowRoomWorld;
        uniform float oldHouseNight;
        // A broad aperture supplies diffuse sky/ground bounce. Its solid angle
        // falls with distance and its direction follows the real window. This
        // supplements the hemisphere approximation without emitting from walls.
        float apertureBounce(vec3 p, vec3 n, vec3 opening, float area) {
          vec3 delta = opening-p;
          float distance2 = max(dot(delta,delta),.12);
          return area/(area + 3.14159265*distance2) * max(dot(n,delta*inversesqrt(distance2)),0.);
        }
        vec3 oldHouseOpeningIrradiance(vec3 p,vec3 n) {
          float bounce=0.;
          if (p.y>3.22 && p.y<7.75 && p.z< -8.32 && p.z> -13.32) {
            if (p.x>-.82 && p.x<4.65) bounce=apertureBounce(p,n,vec3(2.25,4.83,-13.30),2.7)+apertureBounce(p,n,vec3(-.80,4.83,-11.25),2.7);
            else if (p.x>4.75 && p.x<10.08) bounce=apertureBounce(p,n,vec3(8.20,4.83,-13.30),2.7)+apertureBounce(p,n,vec3(10.06,4.83,-10.85),2.7);
          } else if (p.y>3.22 && p.y<6.70 && p.x>3.065 && ((p.z<-.28 && p.z>-4.64 && p.x<7.85)||(p.z<=-4.64 && p.z>-6.08 && p.x<10.08))) {
            bounce=apertureBounce(p,n,vec3(3.63,4.50,-.05),2.1)+apertureBounce(p,n,vec3(5.30,4.50,-.05),2.1)+apertureBounce(p,n,vec3(6.95,4.50,-.05),2.1);
          } else if (p.y>.18 && p.y<3.08 && p.x>-7.84 && ((p.z<-.285 && p.z>-2.805 && p.x<-2.35)||(p.z<=-2.805 && p.z>-8.605 && p.x<-3.065))) {
            bounce=apertureBounce(p,n,vec3(-4.42,1.735,-.10),1.1)+apertureBounce(p,n,vec3(-3.12,1.32,-.10),1.8)+apertureBounce(p,n,vec3(-5.80,1.76,-8.56),1.57);
          }
          return vec3(1.,.96,.88) * (8.0 * bounce * (1.-oldHouseNight));
        }
        float oldWindowSkyBounce(vec3 p) {
          // The rear bedrooms have real side and rear apertures. A small
          // sky contribution decreases away from each opening; direct sunlight
          // is still occluded by the actual roof, frame and open timber shutter.
          if (p.y > 3.22 && p.y < 7.75 && p.z < -8.32 && p.z > -13.32) {
            if (p.x > -.82 && p.x < 4.65) {
              float rear = distance(p,vec3(2.25,4.83,-13.30));
              float side = distance(p,vec3(-.80,4.83,-11.25));
              return min(.96,.62 + .29 * exp(-.40 * rear) + .27 * exp(-.42 * side));
            }
            if (p.x > 4.75 && p.x < 10.08) {
              float rear = distance(p,vec3(8.20,4.83,-13.30));
              float side = distance(p,vec3(10.06,4.83,-10.85));
              return min(.96,.62 + .29 * exp(-.40 * rear) + .27 * exp(-.42 * side));
            }
          }
          bool store = p.y > 3.22 && p.y < 6.70 && p.x > 3.065
            && ((p.z < -.28 && p.z > -4.64 && p.x < 7.85)
             || (p.z <= -4.64 && p.z > -6.08 && p.x < 10.08));
          if (store) {
            float front = min(min(distance(p,vec3(3.63,4.62,-.05)),distance(p,vec3(5.30,4.62,-.05))),distance(p,vec3(6.95,4.62,-.05)));
            float back = distance(p,vec3(6.00,4.62,-6.13));
            return min(.96,.61 + .36 * exp(-.34 * front) + .22 * exp(-.44 * back));
          }
          bool frontDepth = p.z < -.285 && p.z > -2.805;
          bool rearDepth = p.z <= -2.805 && p.z > -8.605;
          bool lower = p.y > .18 && p.y < 3.08;
          float distanceToOpening = -1.;
          float openDoorBounce = 0.;
          if (lower && ((frontDepth && p.x > -7.84 && p.x < -2.35) || (rearDepth && p.x > -7.84 && p.x < -3.065))) {
            distanceToOpening = distance(p,vec3(-4.42,1.735,-.10));
            openDoorBounce = .22 * exp(-.55 * distance(p,vec3(-3.12,1.32,-.10)));
            float rearWindowBounce = .34 * exp(-.38 * distance(p,vec3(-5.80,1.76,-8.56)));
            return min(.96,.49 + .43 * exp(-.65 * distanceToOpening) + openDoorBounce + rearWindowBounce);
          } else if (lower && ((frontDepth && p.x > 2.35 && p.x < 7.84) || (rearDepth && p.x > 3.065 && p.x < 7.84))) {
            distanceToOpening = min(distance(p,vec3(3.66,1.735,-.10)),distance(p,vec3(7.16,1.735,-.10)));
          } else if ((frontDepth || rearDepth) && p.y > 3.22 && p.y < 6.19 && p.x > -7.84 && p.x < -3.06) {
            distanceToOpening = min(distance(p,vec3(-6.68,4.78,-.10)),distance(p,vec3(-3.75,4.78,-.10)));
          }
          if (distanceToOpening < 0.) return 1.;
          return min(.80,.25 + .54 * exp(-.90 * distanceToOpening) + openDoorBounce);
        }
      `)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        float windowBounce = oldWindowSkyBounce(windowRoomWorld);
        reflectedLight.indirectDiffuse *= windowBounce;
        reflectedLight.indirectSpecular *= windowBounce;
        vec3 openingIrradiance=oldHouseOpeningIrradiance(windowRoomWorld,inverseTransformDirection(geometryNormal,viewMatrix));
        RE_IndirectDiffuse(openingIrradiance,geometryPosition,geometryNormal,geometryViewDir,geometryClearcoatNormal,material,reflectedLight);
      `);
  };
  material.customProgramCacheKey = () => previousKey + '|open-home-directional-window-bounce-v5';
}
