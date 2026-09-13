import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import * as T from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

// Resolve the real module graph for Node's test runner without changing the
// application's extensionless imports or adding test-only production exports.
const modules = new Map<string, string>();
function moduleUrl(source: URL): string {
  const cached = modules.get(source.href);
  if (cached) return cached;
  const code = stripTypeScriptTypes(readFileSync(source, 'utf8'), { mode: 'transform', sourceUrl: source.href })
    .replace(/from (['"])([^'"]+)\1/g, (_match, _quote, specifier: string) => {
      const url = specifier.startsWith('.')
        ? moduleUrl(new URL(`${specifier}.ts`, source))
        : import.meta.resolve(specifier);
      return `from ${JSON.stringify(url)}`;
    });
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  modules.set(source.href, url);
  return url;
}
const { addEnvironment }: typeof import('../src/components/scene/environment') =
  await import(moduleUrl(new URL('../src/components/scene/environment.ts', import.meta.url)));
const { createWeatherState }: typeof import('../src/components/scene/weather-state') =
  await import(new URL('../src/components/scene/weather-state.ts', import.meta.url).href);

await test('HDR-safe environment generation preserves the live moon, stars and rain sky', context => {
  const scene = new T.Scene();
  const renderer = { getPixelRatio: () => 1.25 } as unknown as T.WebGLRenderer;
  const target = new T.WebGLRenderTarget(1, 1, { type: T.HalfFloatType });
  const time = { value: 0 }, night = { value: 0 };
  const weather = createWeatherState(time, night);
  let pmremShader = '';
  let capturedSky: Sky | undefined;
  // No GPU is needed: capture exactly what PMREM would render, while keeping
  // addEnvironment, Three's Sky and addDayCycle on their real production path.
  const fromScene = context.mock.method(T.PMREMGenerator.prototype, 'fromScene', (object: T.Object3D) => {
    assert.ok(object instanceof Sky);
    capturedSky = object;
    pmremShader = object.material.fragmentShader;
    return target;
  });
  const environment = addEnvironment(scene, renderer, true, time, night,
    { value: 0 }, { value: 0 }, { value: 0 }, weather.uniforms);
  try {
    assert.equal(fromScene.mock.callCount(), 1);
    assert.equal(scene.environment, target.texture);
    assert.ok(capturedSky);
    const compact = (shader: string) => shader.replace(/\s+/g, '');
    const pmrem = compact(pmremShader);
    const limit = 'gl_FragColor.rgb=min(gl_FragColor.rgb,vec3(60000.0));';
    assert.ok(pmrem.includes(limit),
      'PMREM must receive the half-float limit before generating environment lighting');
    assert.ok(pmrem.indexOf(limit) > pmrem.indexOf('gl_FragColor=vec4(texColor,1.0);'),
      'PMREM must limit the assigned daylight output');
    assert.ok(pmrem.indexOf(limit) < pmrem.indexOf('#include<tonemapping_fragment>'),
      'the HDR limit must run before tone mapping');
    assert.doesNotMatch(pmrem, /moonDisc|rainSky/,
      'environment lighting is generated before the live day/night/weather blend');

    const finalShader = compact(capturedSky.material.fragmentShader);
    assert.ok(finalShader.includes(limit));
    assert.match(finalShader, /floatmoonDisc=/, 'the composed shader must render the moon');
    assert.match(finalShader, /nightColor\+=vec3\([^;]+step\(\.9991,star\)/,
      'the composed shader must add stars to night colour');
    assert.match(finalShader, /clearSky=mix\(texColor,nightColor,uNight\)/);
    assert.match(finalShader, /clearSky=mix\(clearSky,rainSky,cover\)/);
    assert.match(finalShader, /gl_FragColor=vec4\(clearSky,1\.0\)/,
      'the final output must use the blended sky rather than raw daylight');
    assert.equal(finalShader.match(/gl_FragColor=/g)?.length, 1,
      'a later daylight assignment must not overwrite the moon and rain blend');
    assert.ok(finalShader.indexOf(limit) > finalShader.indexOf('gl_FragColor=vec4(clearSky,1.0);'),
      'the HDR limit must apply to the final night and rain blend');
    assert.ok(finalShader.indexOf(limit) < finalShader.indexOf('#include<tonemapping_fragment>'),
      'the live sky must be limited before tone mapping');

    const uniforms = capturedSky.material.uniforms;
    assert.equal(uniforms.uNight, night);
    assert.equal(uniforms.uWeatherRain, weather.uniforms.rain);
    assert.equal(uniforms.uWeatherTime, time);
    for (const [nightAmount, rainAmount] of [[1, 0], [1, 1], [0, 1], [0, 0]]) {
      night.value = nightAmount;
      time.value += 10;
      weather.set({ wind: .28, rain: rainAmount });
      weather.update(1 / 60, true);
      environment.update();
      assert.equal(uniforms.uNight.value, nightAmount);
      assert.equal(uniforms.uWeatherRain.value, rainAmount);
      assert.equal(uniforms.uWeatherTime.value, time.value);
    }
  } finally {
    environment.dispose();
    scene.traverse(object => {
      if (object instanceof T.Mesh || object instanceof T.Points) {
        object.geometry.dispose();
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
      }
      if (object instanceof T.Light && 'shadow' in object) (object as T.DirectionalLight).shadow.dispose();
    });
  }
});
