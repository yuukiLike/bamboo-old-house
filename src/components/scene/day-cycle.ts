import * as T from 'three';
import type { WeatherUniforms } from './weather-state';
import type { Sky } from 'three/addons/objects/Sky.js';
import { groundHeight, seeded, SUN_PRESETS, ROOM_LIGHTS } from './config';

export function addDayCycle(scene: T.Scene, renderer: T.WebGLRenderer, sky: Sky,
  sun: T.DirectionalLight, ambient: T.HemisphereLight, night: { value: number }, time: { value: number }, mobile: boolean, noon = { value: 0 }, dawn = { value: 0 }, dusk = { value: 0 }, weather?:WeatherUniforms) {
  // Blend the physical daylight into a separate moonlit sky before tone mapping.
  sky.material.uniforms.uNight = night;
  sky.material.uniforms.uWeatherRain = weather?.rain ?? {value:0};
  sky.material.uniforms.uWeatherTime = time;
  sky.material.fragmentShader = sky.material.fragmentShader.replace('uniform float time;', `uniform float time;
    uniform float uNight;
    uniform float uWeatherRain;
    uniform float uWeatherTime;
    float lunarNoise(vec2 p) {
      vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
      vec4 h=fract(sin(vec4(dot(i,vec2(127.1,311.7)),dot(i+vec2(1.,0.),vec2(127.1,311.7)),dot(i+vec2(0.,1.),vec2(127.1,311.7)),dot(i+1.,vec2(127.1,311.7))))*43758.5453);
      return mix(mix(h.x,h.y,f.x),mix(h.z,h.w,f.x),f.y);
    }
    float lunarSea(vec2 p,vec2 centre,vec2 size) {
      return 1.-smoothstep(.58,1.15,length((p-centre)/size));
    }
  `)
    // The physical sky's solar disc is HDR-bright; even a 0.1% daylight
    // remainder looked like a second moon during the last part of the fade.
    .replace('L0 += ( vSunE * 19000.0 * Fex ) * sundisc;',
      'L0 += ( vSunE * 19000.0 * Fex ) * sundisc * (1.0 - smoothstep(0.0, 0.15, uNight));')
    .replace('gl_FragColor = vec4( texColor, 1.0 );', `
      vec3 nightDirection = normalize(vWorldPosition - cameraPosition);
      float elevation = max(nightDirection.y, 0.0);
      vec3 nightColor = mix(vec3(.018, .033, .050), vec3(.003, .009, .024), pow(elevation, .45));
      vec3 moonDirection = normalize(vec3(-14., 27., 22.));
      float moonDistance = distance(nightDirection, moonDirection);
      float moonRadius=.014;
      float moonDisc = 1.0 - smoothstep(moonRadius-.00035, moonRadius+.00035, moonDistance);
      vec3 moonRight=normalize(cross(moonDirection,vec3(0.,1.,0.)));
      vec3 moonUp=cross(moonRight,moonDirection);
      vec2 lunarUV=vec2(dot(nightDirection,moonRight),dot(nightDirection,moonUp))/moonRadius;
      // Broad basalt seas and fine crater variation belong to the disc, not
      // its glow. Keep the highlights below clipping so this survives ACES.
      float seas=lunarSea(lunarUV,vec2(-.28,.31),vec2(.44,.39))*.36
        +lunarSea(lunarUV,vec2(.20,.24),vec2(.32,.40))*.29
        +lunarSea(lunarUV,vec2(-.34,-.17),vec2(.36,.24))*.28
        +lunarSea(lunarUV,vec2(.47,-.04),vec2(.19,.25))*.20;
      float lunarDetail=lunarNoise(lunarUV*19.)*.055+lunarNoise(lunarUV*53.)*.025;
      float limb=sqrt(max(0.,1.-dot(lunarUV,lunarUV)));
      float lunarSurface=(.82-seas+lunarDetail)*(.74+.26*limb);
      float moonHalo=exp(-moonDistance*38.)*.031+exp(-moonDistance*9.)*.009;
      nightColor += vec3(.78,.83,.88)*lunarSurface*moonDisc*1.14;
      nightColor += vec3(.43,.56,.76)*moonHalo;
      vec2 starCell = floor(nightDirection.xz / max(.15, nightDirection.y + 1.0) * 820.0);
      float star = fract(sin(dot(starCell, vec2(127.1, 311.7))) * 43758.5453);
      nightColor += vec3(.38, .46, .58) * step(.9991, star) * smoothstep(.12, .55, elevation);
      vec3 clearSky = mix(texColor, nightColor, uNight);
      vec2 cloudUV=nightDirection.xz/max(.16,nightDirection.y+.22)*2.4;
      cloudUV+=vec2(uWeatherTime*.018,uWeatherTime*.007);
      float cloudForm=lunarNoise(cloudUV)*.65+lunarNoise(cloudUV*2.31)*.25+lunarNoise(cloudUV*5.17)*.10;
      float cover=smoothstep(0.,.32,uWeatherRain);
      vec3 rainSky=mix(vec3(.31,.37,.39),vec3(.105,.145,.16),uWeatherRain);
      rainSky*=mix(.74,1.18,cloudForm)*mix(1.,.035,uNight);
      gl_FragColor = vec4(mix(clearSky,rainSky,cover), 1.0);
    `);
  sky.material.needsUpdate = true;

  const iron = new T.MeshStandardMaterial({ color: 0x29271f, metalness: .72, roughness: .5 });
  const brass = new T.MeshStandardMaterial({ color: 0x756046, metalness: .7, roughness: .58 });
  const bulbMaterial = new T.MeshStandardMaterial({ color: 0xf4d8a0, roughness: .23, emissive: 0xffb454, emissiveIntensity: 0 });
  const lamp = new T.Group(); lamp.name = 'Warm_veranda_pendant'; lamp.position.set(-1.65, 5.72, .3);
  const wire = new T.Mesh(new T.CylinderGeometry(.009, .009, .6, 7), iron); wire.position.y = .36;
  const shade = new T.Mesh(new T.ConeGeometry(.21, .13, 32, 1, true), brass); shade.position.y = .05;
  const rim = new T.Mesh(new T.TorusGeometry(.21, .013, 6, 32), iron); rim.rotation.x = Math.PI / 2; rim.position.y = -.015;
  const bulb = new T.Mesh(new T.SphereGeometry(.07, 16, 12), bulbMaterial); bulb.position.y = -.045;
  lamp.add(wire, shade, rim, bulb); scene.add(lamp);
  const warm = new T.PointLight(0xffb563, 0, 11, 2); warm.name='Upper_floor_warm_light'; warm.position.set(-1.65, 5.5, .3); scene.add(warm);

  const downstairsBulbMaterial = new T.MeshStandardMaterial({ color:0xe5cfaa, roughness:.38, emissive:0xffba71, emissiveIntensity:0 });
  const downstairsFixture = new T.Group(); downstairsFixture.name='Ground_floor_pendant'; downstairsFixture.position.set(-.7,2.66,.4);
  const downstairsCord = new T.Mesh(new T.CylinderGeometry(.007,.007,.45,6),iron); downstairsCord.position.y=.225;
  const downstairsSocket = new T.Mesh(new T.CylinderGeometry(.024,.028,.05,12),brass); downstairsSocket.position.y=-.015;
  const downstairsBulb = new T.Mesh(new T.SphereGeometry(.045,14,10),downstairsBulbMaterial); downstairsBulb.position.y=-.062;
  downstairsFixture.add(downstairsCord,downstairsSocket,downstairsBulb);scene.add(downstairsFixture);
  const downstairs = new T.PointLight(0xffc48a,0,5.5,2); downstairs.name='Ground_floor_dim_light'; downstairs.position.set(-.7,2.55,.4);scene.add(downstairs);
  // Fixed fixtures cache their shadows once; the solid floors and partitions block light.
  for (const light of [warm,downstairs]) {
    light.castShadow=true;
    const size=light===warm?(mobile?256:512):(mobile?128:256);
    light.shadow.mapSize.set(size,size);light.shadow.camera.near=.08;
    light.shadow.camera.far=light.distance;light.shadow.bias=-.0003;
    light.shadow.normalBias=.025;light.shadow.autoUpdate=false;light.shadow.needsUpdate=true;
  }

  // These positions match the small porcelain/enamel fixtures in the editable
  // interior asset. Cached real shadows stop glow passing through partitions.
  const roomLights = ROOM_LIGHTS.map(spec => {
    const light = new T.PointLight(0xffc487,0,spec.range,2);
    light.name=spec.name; light.position.set(spec.p[0],spec.p[1],spec.p[2]); light.castShadow=true;
    light.shadow.mapSize.setScalar(mobile?256:512); light.shadow.camera.near=.035;
    light.shadow.camera.far=spec.range; light.shadow.bias=-.00025;
    light.shadow.normalBias=.012; light.shadow.autoUpdate=false;light.shadow.needsUpdate=true;
    scene.add(light); return { light, power:spec.power };
  });

  // A few low fireflies, with world-space paths and independently pulsing light.
  const rand = seeded(9402), count = mobile ? 30 : 64, positions: number[] = [], seeds: number[] = [];
  for (let i = 0; i < count; i++) {
    const x = -13 + rand() * 28, z = 9 + rand() * 21;
    positions.push(x, groundHeight(x, z) + .8 + rand() * 4, z); seeds.push(rand() * 30);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new T.Float32BufferAttribute(seeds, 1));
  const material = new T.ShaderMaterial({
    uniforms: { uTime: time, uNight: night, uPixelRatio: { value: renderer.getPixelRatio() } },
    transparent: true, depthWrite: false, blending: T.AdditiveBlending,
    vertexShader: `uniform float uTime; uniform float uPixelRatio; attribute float aSeed; varying float vPulse;
      void main() { vec3 p = position; p.x += sin(uTime*.21+aSeed)*.75;
        p.y += sin(uTime*.42+aSeed*2.)*.28; p.z += cos(uTime*.19+aSeed)*.55;
        vec4 mv = modelViewMatrix * vec4(p, 1.); gl_Position=projectionMatrix*mv;
        gl_PointSize=clamp(70./max(1.,-mv.z),2.,10.)*uPixelRatio;
        vPulse=pow(max(0.,sin(uTime*.8+aSeed)),3.); }`,
    fragmentShader: `uniform float uNight; varying float vPulse;
      void main() { float d=length(gl_PointCoord-.5)*2.; if(d>1.) discard;
        float glow=exp(-d*d*5.)*(1.-smoothstep(.65,1.,d));
        gl_FragColor=vec4(.78,1.,.34,glow*vPulse*uNight*.85); }`,
  });
  const fireflies = new T.Points(geometry, material); fireflies.name = 'Fireflies_in_the_bamboo'; scene.add(fireflies);

  const daySky = new T.Color(0xb4d0ed), nightSky = new T.Color(0x57789f);
  const dayGround = new T.Color(0x715946), nightGround = new T.Color(0x172825);
  const daySun = new T.Color(SUN_PRESETS.day.color), moon = new T.Color(SUN_PRESETS.night.color);
  const dayFog = new T.Color(0x8ba998), nightFog = new T.Color(0x0b1a27);
  const dayPosition = new T.Vector3(...SUN_PRESETS.day.position), moonPosition = new T.Vector3(...SUN_PRESETS.night.position);
  // A high sun and warm reflected courtyard light, with blue skylight in the
  // eaves. Noon has its own direction and luminance, not a screen tint.
  const noonPosition = new T.Vector3(...SUN_PRESETS.noon.position);
  const noonSky = new T.Color(0xc9ddf5), noonGround = new T.Color(0x9d805e);
  const noonSun = new T.Color(SUN_PRESETS.noon.color), noonFog = new T.Color(0xc0ccc0);
  const dawnPosition = new T.Vector3(...SUN_PRESETS.dawn.position), duskPosition = new T.Vector3(...SUN_PRESETS.dusk.position);
  const dawnSky = new T.Color(0xb5cce1), duskSky = new T.Color(0x9ebee7);
  const dawnGround = new T.Color(0x594b43), duskGround = new T.Color(0x8d6742);
  const dawnSun = new T.Color(SUN_PRESETS.dawn.color), duskSun = new T.Color(SUN_PRESETS.dusk.color);
  const dawnFog = new T.Color(0x99ada8), duskFog = new T.Color(0xb7b7a1);
  const skyDirection = new T.Vector3();
  const stormSky=new T.Color(0xbac6cb),stormGround=new T.Color(0x43504b),stormFog=new T.Color(0x687d80),stormNightFog=new T.Color(0x0a151c),rainFog=new T.Color();
  const autumnSky=new T.Color(0xa8cce5),autumnSun=new T.Color(0xfff4df),autumnFog=new T.Color(0xb6cbc9);
  const interiorBulbs = new Set<T.MeshStandardMaterial>();
  return {
    update() {
      material.uniforms.uPixelRatio.value=renderer.getPixelRatio();
      const n = night.value, h = noon.value, a = dawn.value, e = dusk.value;
      if (!interiorBulbs.size) scene.traverse(object => {
        if (!(object instanceof T.Mesh)) return;
        for (const material of Array.isArray(object.material)?object.material:[object.material]) {
          if (material instanceof T.MeshStandardMaterial && (material.name.startsWith('Interior_frosted_lamp_glass') || material.name.startsWith('Kitchen_frosted_bare_bulb'))) interiorBulbs.add(material);
        }
      });
      for (const bulb of interiorBulbs) { bulb.emissive.setHex(0xffbf79); bulb.emissiveIntensity=n*2.1; }
      // Sunlit plaster is warm while the covered gallery keeps blue skylight.
      // A lower indirect/direct ratio preserves the photographed eave shadows.
      ambient.color.copy(daySky).lerp(noonSky, h).lerp(dawnSky,a).lerp(duskSky,e).lerp(nightSky, n);
      ambient.groundColor.copy(dayGround).lerp(noonGround, h).lerp(dawnGround,a).lerp(duskGround,e).lerp(nightGround, n);
      const blend=(day:number,high:number,morning:number,evening:number,moonlit:number)=>
        T.MathUtils.lerp(T.MathUtils.lerp(T.MathUtils.lerp(T.MathUtils.lerp(day,high,h),morning,a),evening,e),moonlit,n);
      ambient.intensity = blend(.83,1.0,.72,.76,.5);
      sun.color.copy(daySun).lerp(noonSun, h).lerp(dawnSun,a).lerp(duskSun,e).lerp(moon, n);
      sun.intensity = blend(SUN_PRESETS.day.intensity,SUN_PRESETS.noon.intensity,SUN_PRESETS.dawn.intensity,SUN_PRESETS.dusk.intensity,SUN_PRESETS.night.intensity);
      sun.position.copy(dayPosition).lerp(noonPosition, h).lerp(dawnPosition,a).lerp(duskPosition,e).lerp(moonPosition, n);
      skyDirection.copy(sun.position).sub(sun.target.position).normalize();
      sky.material.uniforms.sunPosition.value.copy(skyDirection);
      sky.material.uniforms.turbidity.value = blend(2.8,2.2,3.5,2.1,2.8);
      sky.material.uniforms.rayleigh.value = blend(1.5,2.2,1.7,1.8,1.25);
      if (scene.fog) scene.fog.color.copy(dayFog).lerp(noonFog, h).lerp(dawnFog,a).lerp(duskFog,e).lerp(nightFog, n);
      if (scene.fog instanceof T.FogExp2) scene.fog.density = blend(.0045,.0035,.0062,.0038,.010);
      scene.environmentIntensity = blend(.026,.044,.021,.028,.009);
      renderer.toneMappingExposure = blend(1.0,1.04,1.01,.98,1.08);
      const rain=weather?.rain.value ?? 0, cover=Math.pow(rain,.44);
      const autumn=T.MathUtils.clamp(weather?.autumn?.value ?? 0,0,1)*(1-cover)*(1-n);
      if(autumn>0){
        // Clear cool air and a slightly cleaner sun/shade distinction. Keep
        // the plants' authored greens; the seasonal cue comes from the light.
        ambient.color.lerp(autumnSky,autumn*.26);
        ambient.intensity*=1-autumn*.045;
        sun.color.lerp(autumnSun,autumn*.30);
        sun.intensity*=1+autumn*.025;
        sky.material.uniforms.turbidity.value=T.MathUtils.lerp(sky.material.uniforms.turbidity.value,1.65,autumn*.65);
        sky.material.uniforms.rayleigh.value=T.MathUtils.lerp(sky.material.uniforms.rayleigh.value,1.95,autumn*.42);
        if(scene.fog)scene.fog.color.lerp(autumnFog,autumn*.30);
        if(scene.fog instanceof T.FogExp2)scene.fog.density*=1-autumn*.23;
      }
      sky.material.uniforms.cloudCoverage.value=.4+cover*.55;
      sky.material.uniforms.cloudDensity.value=.4+cover*.46;
      sky.material.uniforms.cloudCoverage.value*=1-autumn*.36;
      sky.material.uniforms.cloudDensity.value*=1-autumn*.18;
      sky.material.uniforms.time.value=time.value*(.3+(weather?.wind.value ?? .28)*.8);
      ambient.color.lerp(stormSky,cover*(1-n));
      ambient.groundColor.lerp(stormGround,cover);
      // Diffuse overcast light remains readable; direct sun/moon and sharp
      // shadows recede together, including all material shading, not a tint.
      ambient.intensity=T.MathUtils.lerp(ambient.intensity,blend(1.45,1.5,1.24,1.28,.45),cover);
      sun.intensity*=1-cover*.96;
      if(scene.fog)scene.fog.color.lerp(rainFog.copy(stormFog).lerp(stormNightFog,n),cover*.82);
      if(scene.fog instanceof T.FogExp2)scene.fog.density+=Math.pow(rain,2)*.04;
      scene.environmentIntensity*=1-cover*.5;
      renderer.toneMappingExposure*=1-cover*.035;
      warm.intensity = 34 * n;
      downstairs.intensity = 6.5 * n;
      // Fully extinguished fixtures must leave Three's light list: zero power
      // alone retains seven point-light loops and shadow-coordinate varyings
      // in every leaf shader. Keep them present throughout the visible fade.
      warm.visible = downstairs.visible = n > 0;
      for (const {light,power} of roomLights) { light.intensity=power*n; light.visible=n>0; }
      downstairsBulbMaterial.emissiveIntensity = n * 1.5;
      bulbMaterial.emissiveIntensity = n * 4;
      fireflies.visible = n > .005 && rain < .45;
    },
  };
}
