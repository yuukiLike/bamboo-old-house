import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const modules = new Map<string, string>();
function moduleUrl(source: URL): string {
  const cached = modules.get(source.href);
  if (cached) return cached;
  const text = readFileSync(source, 'utf8');
  const code = source.pathname.endsWith('.json') ? `export default ${text}`
    : stripTypeScriptTypes(text, { mode: 'transform', sourceUrl: source.href })
      .replace(/from (['"])([^'"]+)\1/g, (_match, _quote, specifier: string) => {
        const url = specifier.startsWith('.')
          ? moduleUrl(new URL(specifier + (specifier.endsWith('.json') ? '' : '.ts'), source))
          : import.meta.resolve(specifier);
        return `from ${JSON.stringify(url)}`;
      });
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  modules.set(source.href, url); return url;
}
const load = (name: string) => import(moduleUrl(new URL(`../src/components/scene/${name}.ts`, import.meta.url)));
const { SUN_PRESETS, groundHeight, pathClearance, treePositions }: typeof import('../src/components/scene/config') = await load('config');
const { addBamboo, addPorchBamboo }: typeof import('../src/components/scene/bamboo') = await load('bamboo');
const { addBackgroundFoliage }: typeof import('../src/components/scene/understory') = await load('understory');
const { addDryFuel }: typeof import('../src/components/scene/dry-fuel') = await load('dry-fuel');
const { addForestRemains }: typeof import('../src/components/scene/forest-remains') = await load('forest-remains');
const { addWoodlandFinish }: typeof import('../src/components/scene/woodland-finish') = await load('woodland-finish');
const { addPineBank }: typeof import('../src/components/scene/pine-bank') = await load('pine-bank');
const { createWeatherState }: typeof import('../src/components/scene/weather-state') = await load('weather-state');
const { stabilizeHouseSurfaces }: typeof import('../src/components/scene/house-surfaces') = await load('house-surfaces');

// These points cover the right-hand facade, not just isolated gaps in the canopy.
const regions = [
  { name: 'lower wall', mesh: 'Reference_lime_facade_subtle_rain_and_chalk', xs: [3, 4.5, 5, 6.5, 7.5], ys: [1, 1.6, 2.2], samples: 13, minimumLit: 6 },
  { name: 'upper wall', mesh: 'Reference_lime_facade_subtle_rain_and_chalk', xs: [3.4, 4.5, 6, 6.5, 7.5], ys: [4.5, 5, 5.5], samples: 12, minimumLit: 6 },
  { name: 'railing', mesh: 'Reference_silvered_aged_timber', xs: [3.4, 4.2, 4.8, 6.2, 7, 7.6], ys: [3.75, 4.05], samples: 5, minimumLit: 4 },
  { name: 'piers', mesh: 'Reference_irregular_old_grey_brickwork', xs: [2.5, 5.5, 8], ys: [1.3, 4, 5.5], samples: 9, minimumLit: 8 },
];

for (const mobile of [false, true]) await test(`${mobile ? 'mobile' : 'desktop'} evening light reaches the right facade through the actual forest`, async context => {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder), sources: T.Group[] = [];
  const placeholder = new T.Texture();
  // Keep real compressed geometry and materials, without browser image decoding.
  loader.register(() => ({ name: 'CPU_GEOMETRY_ONLY', loadTexture: () => Promise.resolve(placeholder) }));
  const model = async (name: string) => {
    const bytes = readFileSync(new URL(`../public/models/${name}.glb`, import.meta.url));
    const group = (await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene;
    sources.push(group); return group;
  };
  const scene = new T.Scene(), time = { value: 0 }, night = { value: 0 };
  try {
    // Zero wind makes the authored geometry the same stationary pose as the GPU.
    // This checks occlusion, not texture colour or rendered pixel brightness.
    const weather = createWeatherState(time, night); weather.set({ wind: 0, rain: 0 }); weather.update(0, true);
    const house = await model('architecture'); stabilizeHouseSurfaces(house);
    house.traverse(object => {
      if (!(object instanceof T.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      object.castShadow = !materials.some(material => /^(Interior_frosted_lamp_glass|Kitchen_frosted_bare_bulb|Window_memory_old_clear_glass)/.test(material.name));
    });
    scene.add(house);
    const bamboo = await model('bamboo');
    addBamboo(scene, bamboo, time, mobile, night, weather.uniforms);
    addPorchBamboo(scene, await model('porch-bamboo'), time, night, bamboo, weather.uniforms);
    addBackgroundFoliage(scene, await model('background-foliage'), weather.uniforms);
    addDryFuel(scene, await model('dry-fuel')); addForestRemains(scene);
    addWoodlandFinish(scene, mobile, groundHeight, pathClearance, treePositions());
    addPineBank(scene, mobile, weather.uniforms);
    scene.updateMatrixWorld(true);
    const casters: T.Mesh[] = [], houseMeshes = new Set<T.Object3D>();
    house.traverse(object => houseMeshes.add(object));
    scene.traverse(object => {
      if (!(object instanceof T.Mesh) || !object.castShadow) return;
      // Test both triangle sides, as used by the foliage's shadow materials.
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.side = T.DoubleSide;
      casters.push(object);
    });
    assert.ok(casters.some(mesh => mesh.name === 'Porch_draping_Leaves'));
    assert.ok(casters.some(mesh => mesh.name === 'Leaves_0_lod0'));
    const direction = new T.Vector3(...SUN_PRESETS.dusk.position).sub(new T.Vector3(-1, 0, 3)).normalize();
    const ray = new T.Raycaster(undefined, undefined, .01, 100), hits: T.Intersection[] = [];
    const results: { name: string; samples: number; lit: number; buildingShade: number }[] = [];
    for (const region of regions) {
      const surface = house.getObjectByName(`Architecture__${region.mesh}`);
      assert.ok(surface);
      let samples = 0, lit = 0, buildingShade = 0;
      for (const x of region.xs) for (const y of region.ys) {
        const hit = new T.Raycaster(new T.Vector3(x, y, 12), new T.Vector3(0, 0, -1)).intersectObject(surface, true)[0];
        if (!hit?.face) continue;
        const normal = hit.face.normal.clone().applyNormalMatrix(new T.Matrix3().getNormalMatrix(hit.object.matrixWorld));
        if (normal.z < .7) continue;
        samples++;
        ray.ray.set(hit.point.clone().addScaledVector(normal, .02), direction);
        const blocker = casters.find(mesh => { hits.length = 0; mesh.raycast(ray, hits); return hits.length > 0; });
        if (!blocker && normal.dot(direction) > .6) lit++;
        if (blocker && houseMeshes.has(blocker)) buildingShade++;
      }
      results.push({ name: region.name, samples, lit, buildingShade });
    }
    context.diagnostic(JSON.stringify(results));
    for (const [index, result] of results.entries()) {
      assert.equal(result.samples, regions[index].samples, 'the real surface sampling must remain representative');
      assert.ok(result.lit >= regions[index].minimumLit, `${result.name}: only ${result.lit}/${result.samples} points receive direct evening light`);
    }
    assert.ok(results[1].buildingShade >= 2, 'the gallery roof and posts must retain real shadows');
  } finally {
    const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>();
    for (const root of [scene, ...sources]) root.traverse(object => {
      if (!(object instanceof T.Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      if (object.customDepthMaterial) materials.add(object.customDepthMaterial);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    placeholder.dispose();
  }
});
