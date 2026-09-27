import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import * as T from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { ROOM_LIGHTS, SUN_PRESETS } from '../src/components/scene/config.ts';

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
const { addDayCycle }: typeof import('../src/components/scene/day-cycle') =
  await import(moduleUrl(new URL('../src/components/scene/day-cycle.ts', import.meta.url)));
const { createWeatherState }: typeof import('../src/components/scene/weather-state') =
  await import(new URL('../src/components/scene/weather-state.ts', import.meta.url).href);

function disposeScene(scene: T.Scene) {
  scene.traverse(object => {
    if (object instanceof T.Mesh || object instanceof T.Points) {
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
    }
    if (object instanceof T.Light && 'shadow' in object) (object as T.DirectionalLight).shadow.dispose();
  });
}

await test('hidden interiors disable all seven room lights but retain two porch lights throughout the night fade',()=>{
 const scene=new T.Scene(),sky=new Sky(),sun=new T.DirectionalLight(),ambient=new T.HemisphereLight();
 const renderer={getPixelRatio:()=>1} as unknown as T.WebGLRenderer;
 const night={value:1},time={value:0};scene.add(sky,sun,ambient);
 const bulb=new T.MeshStandardMaterial();bulb.name='Interior_frosted_lamp_glass';scene.add(new T.Mesh(new T.SphereGeometry(),bulb));
 const cycle=addDayCycle(scene,renderer,sky,sun,ambient,night,time,true);
 const rooms=ROOM_LIGHTS.map(spec=>scene.getObjectByName(spec.name) as T.PointLight);
 const porch=['Upper_floor_warm_light','Ground_floor_dim_light'].map(name=>scene.getObjectByName(name) as T.PointLight);
 try {
  assert.equal(rooms.length,7);assert.ok([...rooms,...porch].every(light=>light instanceof T.PointLight));
  cycle.update();
  for(const hidden of [true,false,true,false]){
   for(const light of [...rooms,...porch])light.shadow.needsUpdate=false;
   cycle.setInteriorDetailsHidden(hidden);
   assert.ok([...rooms,...porch].every(light=>light.shadow.needsUpdate),'invalidate cached shadows when furnishing visibility changes');
   for(const amount of [1,.7,.01,0,.01,.7,1]){
    night.value=amount;cycle.update();
    for(const [index,light] of rooms.entries()){
     assert.equal(light.visible,!hidden&&amount>0);
     assert.equal(light.intensity,hidden?0:ROOM_LIGHTS[index].power*amount);
     assert.equal(light.shadow.autoUpdate,false);
    }
    assert.ok(porch.every(light=>light.visible===(amount>0)));
    assert.equal(porch[0].intensity,34*amount);assert.equal(porch[1].intensity,6.5*amount);
    assert.equal(bulb.emissiveIntensity,hidden?0:amount*2.1);
   }
   for(const light of [...rooms,...porch])light.shadow.needsUpdate=false;
   cycle.setInteriorDetailsHidden(hidden);
   assert.ok([...rooms,...porch].every(light=>!light.shadow.needsUpdate),'unchanged settings do not keep refreshing lamp shadows');
  }
 } finally {disposeScene(scene);}
});

await test('HDR-safe environment preserves natural evening light, moon, stars and rain', context => {
  const scene = new T.Scene();
  const renderer = { getPixelRatio: () => 1.25 } as unknown as T.WebGLRenderer;
  const target = new T.WebGLRenderTarget(1, 1, { type: T.HalfFloatType });
  const time = { value: 0 }, night = { value: 0 }, dawn = { value: 0 }, dusk = { value: 0 };
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
    dawn, dusk, weather.uniforms);
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
    assert.doesNotMatch(pmrem, /moonDisc|rainSky|uDawnHorizon|uDuskHorizon/,
      'environment lighting is generated before the live day/night/weather blend');

    const finalShader = compact(capturedSky.material.fragmentShader);
    const gradient = finalShader.match(/nightColor=mix\(vec3\(([^)]+)\),vec3\(([^)]+)\),/);
    assert.ok(gradient, 'night sky keeps its horizon-to-zenith gradient');
    for (const colour of gradient.slice(1).map(value => value.split(',').map(Number))) {
      const [red, green, blue] = colour;
      assert.ok(blue > green * 2 && green > red, 'moonlit sky should read as deep blue');
      assert.ok(.2126 * red + .7152 * green + .0722 * blue >= .025,
        'even the zenith must retain visible colour instead of near-black');
    }
    assert.ok(finalShader.includes(limit));
    assert.match(finalShader, /floatmoonDisc=/, 'the composed shader must render the moon');
    assert.match(finalShader, /nightColor\+=vec3\([^;]+step\(\.9991,star\)/,
      'the composed shader must add stars to night colour');
    assert.match(finalShader, /clearSky=mix\(clearSky,nightColor,uNight\)/);
    assert.match(finalShader, /morningSky=mix\(texColor,uDawnHorizon,lowSky\)/);
    assert.match(finalShader, /eveningSky=mix\(uDuskHorizon,uDuskZenith,smoothstep\(0\.0,\.65,height\)\)/);
    assert.match(finalShader, /sunSide=smoothstep\(0\.0,\.7,dot\(azimuth,normalize\(vSunDirection.xz\)\)\)/,
      'gold stays on the sun-facing half of the sky with a feathered boundary');
    assert.match(finalShader, /goldBand=\(1\.0-smoothstep\(0\.0,\.22,height\)\)\*sunSide/,
      'the gold band occupies half the previous vertical extent');
    assert.match(finalShader, /goldBand\*=1\.0-smoothstep\(0\.0,\.6,uNight\)/,
      'gold must recede to blue before nightfall, without a muddy colour midpoint');
    assert.match(finalShader, /morning=min\(uDawn\/daylight,1\.0\)/);
    assert.match(finalShader, /evening=min\(uDusk\/daylight,1\.0\)/);
    assert.match(finalShader, /clearSky=texColor\*max\(0\.0,1\.0-morning-evening\)\+morningSky\*morning\+eveningSky\*evening/);
    assert.ok(finalShader.indexOf('eveningSky*evening') < finalShader.indexOf('clearSky=mix(clearSky,nightColor,uNight)'),
      'moonlight must replace the warm horizon during the night transition');
    assert.ok(finalShader.indexOf('eveningSky*evening') < finalShader.indexOf('clearSky=mix(clearSky,rainSky,cover)'),
      'overcast weather must replace the clear-sky horizon');
    assert.doesNotMatch(finalShader, /sunsetDisc|sunsetGradient|sunsetSky|sunsetDistance/,
      'evening has no painted red halo or replacement sun');
    assert.match(finalShader, /floatsundisc=[^;]+\*showSunDisc;/,
      'the native sky uniform must control the visible solar disc');
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
    assert.equal(uniforms.uDawn, dawn);
    assert.equal(uniforms.uDusk, dusk);
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
    for (const amount of [0, .25, .75, 1]) {
      dusk.value = amount; environment.update();
      assert.equal(uniforms.showSunDisc.value, 1-amount,
        'the evening sun disappears smoothly without removing the actual directional light');
    }
    night.value=0;weather.set({wind:.28,rain:0});weather.update(1/60,true);environment.update();
    assert.equal(environment.sun.color.getHex(),SUN_PRESETS.dusk.color);
    assert.deepEqual(environment.sun.position.toArray(),[...SUN_PRESETS.dusk.position]);
    assert.equal(environment.sun.intensity,SUN_PRESETS.dusk.intensity);
    assert.ok(environment.sun.color.r>environment.sun.color.g&&environment.sun.color.g>environment.sun.color.b);
    const ambient = scene.children.find((object): object is T.HemisphereLight => object instanceof T.HemisphereLight);
    assert.ok(ambient);
    const shade = ambient.color.clone().add(ambient.groundColor).multiplyScalar(.5 * ambient.intensity);
    assert.ok(shade.r > shade.g * 1.1 && shade.r < shade.g * 1.3 && shade.b > shade.r * .55,
      'shaded plaster keeps mild reflected warmth without the former broad amber wash');
    assert.ok(ambient.intensity < .83, 'soft warm fill must retain the side-lit sun/shade contrast');
    assert.ok(ambient.groundColor.r > ambient.groundColor.g && ambient.groundColor.g > ambient.groundColor.b);
    assert.ok(scene.environmentIntensity <= .02, 'cached daylight-white reflections must not wash out the golden-hour fill');
    assert.ok(renderer.toneMappingExposure <= 1, 'brighter facade lighting must not come from raising global exposure');
    const eveningHorizon: T.Color = uniforms.uDuskHorizon.value;
    const eveningZenith: T.Color = uniforms.uDuskZenith.value;
    const eveningGold: T.Color = uniforms.uDuskGold.value;
    const morningHorizon: T.Color = uniforms.uDawnHorizon.value;
    for (const horizon of [morningHorizon, eveningHorizon, eveningZenith, eveningGold]) {
      assert.ok(horizon.toArray().every(channel => channel > 0 && channel <= 1),
        'the horizon must retain colour below HDR clipping');
    }
    for (const blue of [eveningHorizon, eveningZenith]) {
      assert.ok(blue.b > blue.g && blue.g > blue.r);
      assert.ok(.2126*blue.r+.7152*blue.g+.0722*blue.b > .3,
        'both levels of the evening sky stay clear and luminous, not dark and grey');
    }
    assert.ok(eveningGold.r > eveningGold.g && eveningGold.g > eveningGold.b * 1.8);
    assert.ok(morningHorizon.b > morningHorizon.g * 1.5 && morningHorizon.g > morningHorizon.r * 1.5);
    assert.ok(scene.fog && scene.fog.color.b > scene.fog.color.r,
      'distant evening foliage retains the cool autumn air instead of an all-over gold tint');

    weather.set({wind:.28,rain:0,autumn:1});weather.update(1/60,true);environment.update();
    assert.equal(environment.sun.color.getHex(),SUN_PRESETS.dusk.color,
      'autumn weather must not whiten the golden-hour side light');
    weather.set({wind:.28,rain:1,autumn:0});weather.update(1/60,true);environment.update();
    assert.ok(ambient.color.b > ambient.color.r, 'storm fill still replaces the dry evening warmth');
    assert.ok(environment.sun.intensity < .3, 'rain still suppresses direct golden sunlight');

    weather.set({wind:.28,rain:0});weather.update(1/60,true);dusk.value=0;dawn.value=1;environment.update();
    assert.ok(scene.fog && scene.fog.color.b > scene.fog.color.g && scene.fog.color.g > scene.fog.color.r,
      'morning distance haze continues the blue horizon');
    assert.ok(uniforms.rayleigh.value > 2 && uniforms.mieCoefficient.value < .002,
      'clear morning air reduces white forward haze and retains blue scattering');
    assert.equal(environment.sun.color.getHex(),SUN_PRESETS.dawn.color);
    assert.deepEqual(environment.sun.position.toArray(),[...SUN_PRESETS.dawn.position]);

    dawn.value=0;environment.update();
    assert.equal(environment.sun.color.getHex(),SUN_PRESETS.day.color);
    assert.equal(uniforms.showSunDisc.value,1);
    assert.equal(uniforms.uDawn.value,0);assert.equal(uniforms.uDusk.value,0);
    assert.equal(fromScene.mock.callCount(),1,'time and weather changes must not regenerate the environment map');
    assert.equal(scene.children.filter(object => object instanceof T.DirectionalLight).length,1);
  } finally {
    environment.dispose();
    disposeScene(scene);
  }
});

await test('dusk and night crossfade without leaking daylight, a solar disc or a moving daylight sky', () => {
  const scene = new T.Scene(), sky = new Sky(), sun = new T.DirectionalLight(), ambient = new T.HemisphereLight();
  const renderer = { getPixelRatio: () => 1 } as unknown as T.WebGLRenderer;
  const fog = new T.FogExp2(0xffffff);
  scene.fog = fog;
  scene.add(sky, sun, ambient);
  sun.target.position.set(-1,0,3);
  const time = {value:0}, night = {value:0}, dawn = {value:0}, dusk = {value:1};
  const cycle = addDayCycle(scene,renderer,sky,sun,ambient,night,time,false,dawn,dusk);
  const sample = (n:number, a:number, e:number) => {
    night.value=n;dawn.value=a;dusk.value=e;cycle.update();
    return [...sun.color.toArray(), ...sun.position.toArray(), sun.intensity,
      ...ambient.color.toArray(), ...ambient.groundColor.toArray(), ambient.intensity,
      ...fog.color.toArray(), fog.density, scene.environmentIntensity, renderer.toneMappingExposure];
  };
  try {
    const evening=sample(0,0,1), eveningDirection=sky.material.uniforms.sunPosition.value.clone();
    const moonlit=sample(1,0,0), morning=sample(0,1,0);
    const close=(actual:number[],expected:number[],label:string)=>actual.forEach((value,index)=>
      assert.ok(Math.abs(value-expected[index])<1e-10, `${label}, channel ${index}: ${value} != ${expected[index]}`));
    sample(0,0,1);
    for (const reverse of [false,true]) for (let step=0;step<=60;step++) {
      const n=reverse?1-step/60:step/60;
      close(sample(n,0,1-n),evening.map((value,index)=>T.MathUtils.lerp(value,moonlit[index],n)),`night ${n}`);
      assert.equal(sky.material.uniforms.showSunDisc.value,0,'dusk/night transitions must never bring back the solar disc');
      assert.ok(sky.material.uniforms.sunPosition.value.distanceTo(eveningDirection)<1e-10,
        'physical daylight scattering must not follow the directional light as it moves to the moon');
    }
    close(sample(.3,.2,.5), evening.map((value,index)=>value*.5+morning[index]*.2+moonlit[index]*.3),
      'an interrupted transition retains only the three active periods');
  } finally { disposeScene(scene); }
});

await test('four distinct times retain the approved low golden side light',()=>{
 assert.deepEqual(Object.keys(SUN_PRESETS),['dawn','day','dusk','night']);
 assert.deepEqual(SUN_PRESETS.dusk.position,[30,9.3,34]);
 const direction=new T.Vector3(...SUN_PRESETS.dusk.position).sub(new T.Vector3(-1,0,3)).normalize();
 assert.ok(direction.z>.65,'the +Z courtyard facade must receive direct light, not a backlit silhouette');
 assert.ok(direction.x>.65,'light enters beside the foreground canopy through the open +X bank');
 assert.ok(direction.y>.15&&direction.y<.25,'keep evening light below the deep gallery roof');
 const colour=new T.Color(SUN_PRESETS.dusk.color).getRGB({r:0,g:0,b:0},T.SRGBColorSpace);
 assert.ok(colour.r>colour.g&&colour.g>colour.b);
 assert.ok(colour.g>=.84&&colour.g<=.9,'golden evening light must retain enough green to stay yellow rather than orange-red');
 assert.ok(colour.b>=.48&&colour.b<=.58,'clear gold retains more blue than the former dull amber without becoming pale cream');
 assert.ok(SUN_PRESETS.dusk.intensity<=SUN_PRESETS.day.intensity*1.1,'lift the side-lit highlights without overpowering daylight');
});
