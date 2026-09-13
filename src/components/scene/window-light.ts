import type { MeshStandardMaterial } from 'three';
import type { WeatherUniforms } from './weather-state';

/** Approximate the loss of sky bounce inside the kitchen and the old upper rooms.
 * The shared hemisphere light otherwise lights their rear walls like outdoors.
 * Only indirect light is attenuated; actual sun and bulb shadows still apply.
 * Cycles obtains this falloff from the real room geometry in the editable scene.
 */
export function shadeWindowRecesses(material: MeshStandardMaterial, night: { value: number }, dawn = { value: 0 }, dusk = { value: 0 }, noon = { value: 0 }, weather?:WeatherUniforms) {
  if (material.userData.windowRecessLighting) return;
  material.userData.windowRecessLighting = true;
  const previous = material.onBeforeCompile.bind(material);
  const previousKey = material.customProgramCacheKey();
  material.onBeforeCompile = function (shader, renderer) {
    previous(shader, renderer);
    shader.uniforms.oldHouseNight = night;
    shader.uniforms.oldHouseDawn = dawn;
    shader.uniforms.oldHouseDusk = dusk;
    shader.uniforms.oldHouseNoon = noon;
    shader.uniforms.oldHouseRain = weather?.rain ?? {value:0};
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 windowRoomWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nwindowRoomWorld=(modelMatrix*vec4(transformed,1.)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 windowRoomWorld;
        uniform float oldHouseNight;
        uniform float oldHouseDawn;
        uniform float oldHouseDusk;
        uniform float oldHouseNoon;
        uniform float oldHouseRain;
        // A broad aperture supplies diffuse sky/ground bounce. Its solid angle
        // falls with distance and its direction follows the real window. This
        // supplements the hemisphere approximation without emitting from walls.
        float apertureBounce(vec3 p, vec3 n, vec3 opening, float area) {
          vec3 delta = opening-p;
          float distance2 = max(dot(delta,delta),.12);
          return area/(area + 3.14159265*distance2) * max(dot(n,delta*inversesqrt(distance2)),0.);
        }
        vec3 windowIrradiance(vec3 p,vec3 n,vec3 opening,float area) {
          // The upper opening sees cool sky; its lower half sees sunlit earth
          // and plaster. Their different directions model grain and crockery.
          vec3 skylight=mix(vec3(.68,.80,1.),vec3(.63,.78,1.),oldHouseDawn);
          vec3 courtyard=mix(vec3(1.,.83,.62),vec3(1.,.65,.34),oldHouseDusk);
          courtyard=mix(courtyard,vec3(1.,.85,.70),oldHouseDawn);
          skylight=mix(skylight,vec3(.74,.81,.86),oldHouseRain);
          courtyard=mix(courtyard,vec3(.69,.75,.74),oldHouseRain);
          float upper=apertureBounce(p,n,opening+vec3(0.,.30,0.),area*.55);
          float lower=apertureBounce(p,n,opening-vec3(0.,.38,0.),area*.45);
          return (skylight*upper*12.+courtyard*lower*17.)*(1.+oldHouseNoon*.10)*(1.-oldHouseNight)*(1.-oldHouseRain*.48);
        }
        vec3 oldHouseOpeningIrradiance(vec3 p,vec3 n) {
          vec3 bounce=vec3(0.);
          if (p.y>3.22 && p.y<7.75 && p.z< -8.32 && p.z> -13.32) {
            if (p.x>-.82 && p.x<4.65) bounce=windowIrradiance(p,n,vec3(2.25,4.83,-13.30),2.7)+windowIrradiance(p,n,vec3(-.80,4.83,-11.25),2.7);
            else if (p.x>4.75 && p.x<10.08) bounce=windowIrradiance(p,n,vec3(8.20,4.83,-13.30),2.7)+windowIrradiance(p,n,vec3(10.06,4.83,-10.85),2.7);
          } else if (p.y>3.22 && p.y<6.70 && p.x>3.065 && ((p.z<-.28 && p.z>-4.64 && p.x<7.85)||(p.z<=-4.64 && p.z>-6.08 && p.x<10.08))) {
            bounce=windowIrradiance(p,n,vec3(3.63,4.50,-.05),2.1)+windowIrradiance(p,n,vec3(5.30,4.50,-.05),2.1)+windowIrradiance(p,n,vec3(6.95,4.50,-.05),2.1);
          } else if (p.y>.18 && p.y<3.08 && p.x>-7.84 && ((p.z<-.285 && p.z>-2.805 && p.x<-2.35)||(p.z<=-2.805 && p.z>-8.605 && p.x<-3.065))) {
            bounce=windowIrradiance(p,n,vec3(-4.42,1.735,-.10),1.1)+windowIrradiance(p,n,vec3(-3.12,1.32,-.10),1.8)+windowIrradiance(p,n,vec3(-5.80,1.76,-8.56),1.57);
          } else if (p.y>3.22 && p.y<6.19 && p.x>-3.065 && p.x<3.065 && p.z<-.28 && p.z>-8.2) {
            bounce=windowIrradiance(p,n,vec3(.0,4.75,.05),11.5);
          } else if (p.y>.18 && p.y<3.08 && p.x>-2.35 && p.x<2.35 && p.z<-.285 && p.z>-8.2) {
            bounce=windowIrradiance(p,n,vec3(.0,1.70,-.10),5.6);
          }
          return bounce;
        }
        float oldHouseRoomEdge(vec3 p) {
          // Broad room-scale contact shading supplements the existing GTAO,
          // which resolves chair feet and other small contacts. Darken only
          // intersections of two surfaces, never an entire flat wall.
          vec3 lower,upper;
          if (p.y>3.22 && p.y<7.75 && p.z< -8.32 && p.z> -13.32 && p.x>-.82 && p.x<10.08) {
            lower=vec3(p.x<4.70?-.82:4.75,3.22,-13.32);
            upper=vec3(p.x<4.70?4.65:10.08,6.64,-8.32);
          } else if (p.y>.18 && p.y<3.08 && p.x>-7.84 && p.x<-3.065 && p.z<-.285 && p.z>-8.605) {
            lower=vec3(-7.84,.18,-8.605); upper=vec3(-3.065,3.08,-.285);
          } else return 1.;
          vec3 distances=max(vec3(0.),min(p-lower,upper-p));
          float corner=min(max(distances.x,distances.y),min(max(distances.y,distances.z),max(distances.x,distances.z)));
          return mix(.73,1.,smoothstep(.0,.55,corner));
        }
        float oldWindowSkyBounce(vec3 p) {
          // The rear bedrooms have real side and rear apertures. A small
          // sky contribution decreases away from each opening; direct sunlight
          // is still occluded by the actual roof, frame and open timber shutter.
          if (p.y > 3.22 && p.y < 7.75 && p.z < -8.32 && p.z > -13.32) {
            if (p.x > -.82 && p.x < 4.65) {
              float rear = distance(p,vec3(2.25,4.83,-13.30));
              float side = distance(p,vec3(-.80,4.83,-11.25));
              float original=min(.96,.62 + .29 * exp(-.40 * rear) + .27 * exp(-.42 * side));
              return mix(min(.88,.28 + .40 * exp(-.44 * rear) + .38 * exp(-.46 * side)),original,oldHouseNight);
            }
            if (p.x > 4.75 && p.x < 10.08) {
              float rear = distance(p,vec3(8.20,4.83,-13.30));
              float side = distance(p,vec3(10.06,4.83,-10.85));
              float original=min(.96,.62 + .29 * exp(-.40 * rear) + .27 * exp(-.42 * side));
              return mix(min(.88,.28 + .40 * exp(-.44 * rear) + .38 * exp(-.46 * side)),original,oldHouseNight);
            }
          }
          bool store = p.y > 3.22 && p.y < 6.70 && p.x > 3.065
            && ((p.z < -.28 && p.z > -4.64 && p.x < 7.85)
             || (p.z <= -4.64 && p.z > -6.08 && p.x < 10.08));
          if (store) {
            float front = min(min(distance(p,vec3(3.63,4.62,-.05)),distance(p,vec3(5.30,4.62,-.05))),distance(p,vec3(6.95,4.62,-.05)));
            float back = distance(p,vec3(6.00,4.62,-6.13));
            float original=min(.96,.61 + .36 * exp(-.34 * front) + .22 * exp(-.44 * back));
            return mix(min(.88,.26 + .46 * exp(-.38 * front) + .26 * exp(-.48 * back)),original,oldHouseNight);
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
            float original=min(.96,.49 + .43 * exp(-.65 * distanceToOpening) + openDoorBounce + rearWindowBounce);
            return mix(min(.88,.24 + .50 * exp(-.65 * distanceToOpening) + openDoorBounce + rearWindowBounce),original,oldHouseNight);
          } else if (lower && ((frontDepth && p.x > 2.35 && p.x < 7.84) || (rearDepth && p.x > 3.065 && p.x < 7.84))) {
            distanceToOpening = min(distance(p,vec3(3.66,1.735,-.10)),distance(p,vec3(7.16,1.735,-.10)));
          } else if ((frontDepth || rearDepth) && p.y > 3.22 && p.y < 6.19 && p.x > -7.84 && p.x < -3.06) {
            distanceToOpening = min(distance(p,vec3(-6.68,4.78,-.10)),distance(p,vec3(-3.75,4.78,-.10)));
          }
          if (distanceToOpening < 0.) {
            if (p.x>-3.065 && p.x<3.065 && p.y>3.22 && p.y<6.19 && p.z<-.28 && p.z>-8.2)
              return mix(.32+.51*exp(-.24*distance(p,vec3(0.,4.75,.05))),1.,oldHouseNight);
            if (p.x>-2.35 && p.x<2.35 && lower && p.z<-.285 && p.z>-8.2)
              return mix(.27+.52*exp(-.32*distance(p,vec3(0.,1.70,-.10))),1.,oldHouseNight);
            return 1.;
          }
          return min(.80,.25 + .54 * exp(-.90 * distanceToOpening) + openDoorBounce);
        }
      `)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        float windowBounce = oldWindowSkyBounce(windowRoomWorld)*mix(oldHouseRoomEdge(windowRoomWorld),1.,oldHouseNight);
        reflectedLight.indirectDiffuse *= windowBounce;
        reflectedLight.indirectSpecular *= windowBounce;
        vec3 openingIrradiance=oldHouseOpeningIrradiance(windowRoomWorld,inverseTransformDirection(geometryNormal,viewMatrix));
        RE_IndirectDiffuse(openingIrradiance,geometryPosition,geometryNormal,geometryViewDir,geometryClearcoatNormal,material,reflectedLight);
      `);
  };
  material.customProgramCacheKey = () => previousKey + '|open-home-weather-window-bounce-v7';
}
