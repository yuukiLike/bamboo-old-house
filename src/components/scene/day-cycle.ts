import * as T from 'three';
import type { WeatherUniforms } from './weather-state';
import type { Sky } from 'three/addons/objects/Sky.js';
import { groundHeight, seeded, SUN_PRESETS, ROOM_LIGHTS } from './config';

export function addDayCycle(scene: T.Scene, renderer: T.WebGLRenderer, sky: Sky,
  sun: T.DirectionalLight, ambient: T.HemisphereLight, night: { value: number }, time: { value: number }, mobile: boolean, dawn = { value: 0 }, dusk = { value: 0 }, weather?:WeatherUniforms) {
  // Blend the physical daylight into a separate moonlit sky before tone mapping.
  sky.material.uniforms.uNight = night;
  sky.material.uniforms.uDawn = dawn;
  sky.material.uniforms.uDusk = dusk;
  sky.material.uniforms.uDawnHorizon = { value: new T.Color(0x82b9ed) };
  sky.material.uniforms.uDuskHorizon = { value: new T.Color(0xa9cde9) };
  sky.material.uniforms.uDuskZenith = { value: new T.Color(0x7ba9d6) };
  sky.material.uniforms.uDuskGold = { value: new T.Color(0xffe3a1) };
  sky.material.uniforms.uWeatherRain = weather?.rain ?? {value:0};
  sky.material.uniforms.uWeatherTime = time;
  sky.material.fragmentShader = sky.material.fragmentShader.replace('uniform float time;', `uniform float time;
    uniform float uNight;
    uniform float uDawn;
    uniform float uDusk;
    uniform vec3 uDawnHorizon;
    uniform vec3 uDuskHorizon;
    uniform vec3 uDuskZenith;
    uniform vec3 uDuskGold;
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
    // The simple evening sky, moonlight and rain replace daylight clouds.
    // Retain clouds while another daytime component can still contribute.
    .replace('if ( direction.y > 0.0 && cloudCoverage > 0.0 ) {',
      'if ( direction.y > 0.0 && cloudCoverage > 0.0 && uDusk < 1.0 - uNight && uWeatherRain < 0.32 ) {')
    .replace('gl_FragColor = vec4( texColor, 1.0 );', `
      vec3 nightDirection = normalize(vWorldPosition - cameraPosition);
      vec3 clearSky = texColor;
      // Blend daytime colours once, then fade to night. Sequential fades would
      // briefly reintroduce the white daytime horizon between dusk and night.
      if (uDawn > 0.0 || uDusk > 0.0) {
        float height = max(nightDirection.y, 0.0);
        float lowSky = 1.0 - smoothstep(.06, .42, height);
        vec3 morningSky = mix(texColor, uDawnHorizon, lowSky);
        vec3 eveningSky = mix(uDuskHorizon, uDuskZenith, smoothstep(0.0, .65, height));
        vec2 azimuth = nightDirection.xz / max(length(nightDirection.xz), .0001);
        float sunSide = smoothstep(0.0, .7, dot(azimuth, normalize(vSunDirection.xz)));
        float goldBand = (1.0 - smoothstep(0.0, .22, height)) * sunSide;
        // Gold recedes into clear blue before the blue deepens, avoiding a
        // muddy yellow/blue midpoint. No disc, halo, or extra cloud layer.
        goldBand *= 1.0 - smoothstep(0.0, .6, uNight);
        eveningSky = mix(eveningSky, uDuskGold, goldBand);
        float daylight = max(1.0 - uNight, .0001);
        float morning = min(uDawn / daylight, 1.0);
        float evening = min(uDusk / daylight, 1.0);
        clearSky = texColor * max(0.0, 1.0 - morning - evening)
          + morningSky * morning + eveningSky * evening;
      }
      if (uNight > 0.0) {
      float elevation = max(nightDirection.y, 0.0);
      vec3 nightColor = mix(vec3(.026, .060, .145), vec3(.010, .028, .080), pow(elevation, .45));
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
      clearSky = mix(clearSky, nightColor, uNight);
      }
      if (uWeatherRain > 0.0) {
      vec2 cloudUV=nightDirection.xz/max(.16,nightDirection.y+.22)*2.4;
      cloudUV+=vec2(uWeatherTime*.018,uWeatherTime*.007);
      float cloudForm=lunarNoise(cloudUV)*.65+lunarNoise(cloudUV*2.31)*.25+lunarNoise(cloudUV*5.17)*.10;
      float cover=smoothstep(0.,.32,uWeatherRain);
      vec3 rainSky=mix(vec3(.31,.37,.39),vec3(.105,.145,.16),uWeatherRain);
      rainSky*=mix(.74,1.18,cloudForm)*mix(1.,.035,uNight);
      clearSky = mix(clearSky,rainSky,cover);
      }
      gl_FragColor = vec4(clearSky, 1.0);
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
  const dayFog = new T.Color(0x8ba998), nightFog = new T.Color(0x162c49);
  const dayPosition = new T.Vector3(...SUN_PRESETS.day.position), moonPosition = new T.Vector3(...SUN_PRESETS.night.position);
  const dawnPosition = new T.Vector3(...SUN_PRESETS.dawn.position), duskPosition = new T.Vector3(...SUN_PRESETS.dusk.position);
  const dawnSky = new T.Color(0xb5cce1), duskSky = new T.Color(0xdcd4cb);
  const dawnGround = new T.Color(0x594b43), duskGround = new T.Color(0xad8f5c);
  const dawnSun = new T.Color(SUN_PRESETS.dawn.color), duskSun = new T.Color(SUN_PRESETS.dusk.color);
  const dawnFog = new T.Color(0x91bfe8), duskFog = new T.Color(0xb7cbd3);
  const skyDirection = new T.Vector3();
  const stormSky=new T.Color(0xbac6cb),stormGround=new T.Color(0x43504b),stormFog=new T.Color(0x687d80),stormNightFog=new T.Color(0x0a151c),rainFog=new T.Color();
  const autumnSky=new T.Color(0xa8cce5),autumnSun=new T.Color(0xfff4df),autumnFog=new T.Color(0xb6cbc9);
  const interiorBulbs = new Set<T.MeshStandardMaterial>();
  return {
    update() {
      material.uniforms.uPixelRatio.value=renderer.getPixelRatio();
      const n = night.value, a = dawn.value, e = dusk.value, d = Math.max(0,1-n-a-e);
      const blend=(day:number,morning:number,evening:number,moonlit:number)=>day*d+morning*a+evening*e+moonlit*n;
      const blendColor=(target:T.Color,day:T.Color,morning:T.Color,evening:T.Color,moonlit:T.Color)=>
        target.setRGB(blend(day.r,morning.r,evening.r,moonlit.r),blend(day.g,morning.g,evening.g,moonlit.g),blend(day.b,morning.b,evening.b,moonlit.b));
      if (!interiorBulbs.size) scene.traverse(object => {
        if (!(object instanceof T.Mesh)) return;
        for (const material of Array.isArray(object.material)?object.material:[object.material]) {
          if (material instanceof T.MeshStandardMaterial && (material.name.startsWith('Interior_frosted_lamp_glass') || material.name.startsWith('Kitchen_frosted_bare_bulb'))) interiorBulbs.add(material);
        }
      });
      for (const bulb of interiorBulbs) { bulb.emissive.setHex(0xffbf79); bulb.emissiveIntensity=n*2.1; }
      // Mild reflected warmth leaves most of the gold on directly lit walls.
      // Absolute weights avoid mixing daytime back into a dusk/night crossfade.
      blendColor(ambient.color,daySky,dawnSky,duskSky,nightSky);
      blendColor(ambient.groundColor,dayGround,dawnGround,duskGround,nightGround);
      ambient.intensity = blend(.83,.72,.82,.5);
      blendColor(sun.color,daySun,dawnSun,duskSun,moon);
      sun.intensity = blend(SUN_PRESETS.day.intensity,SUN_PRESETS.dawn.intensity,SUN_PRESETS.dusk.intensity,SUN_PRESETS.night.intensity);
      sun.position.set(blend(dayPosition.x,dawnPosition.x,duskPosition.x,moonPosition.x),
        blend(dayPosition.y,dawnPosition.y,duskPosition.y,moonPosition.y),blend(dayPosition.z,dawnPosition.z,duskPosition.z,moonPosition.z));
      // The physical sky's sun stays at the fading daylight position. Only
      // the shared scene light moves to the moon, avoiding sweeping sky haze.
      const daylight=d+a+e;
      if(daylight>0){
        skyDirection.copy(dayPosition).multiplyScalar(d).addScaledVector(dawnPosition,a).addScaledVector(duskPosition,e)
          .multiplyScalar(1/daylight).sub(sun.target.position).normalize();
        sky.material.uniforms.sunPosition.value.copy(skyDirection);
      }
      // Keep the physical sky, without a visible evening sun or painted halo.
      sky.material.uniforms.showSunDisc.value = d+a;
      sky.material.uniforms.turbidity.value = blend(2.8,2.1,2.1,2.8);
      sky.material.uniforms.rayleigh.value = blend(1.5,2.25,1.8,1.25);
      sky.material.uniforms.mieCoefficient.value = blend(.002,.0014,.0015,.002);
      if (scene.fog) blendColor(scene.fog.color,dayFog,dawnFog,duskFog,nightFog);
      if (scene.fog instanceof T.FogExp2) scene.fog.density = blend(.0045,.0062,.0038,.010);
      // The cached environment map is daylight-white; reduce its evening
      // contribution instead of rebuilding PMREM during time changes.
      scene.environmentIntensity = blend(.026,.021,.018,.009);
      renderer.toneMappingExposure = blend(1.0,1.01,.98,1.08);
      const rain=weather?.rain.value ?? 0, cover=Math.pow(rain,.44);
      const autumn=T.MathUtils.clamp(weather?.autumn?.value ?? 0,0,1)*(1-cover)*(1-n);
      if(autumn>0){
        // Clear cool air and a slightly cleaner sun/shade distinction. Keep
        // the plants' authored greens; the seasonal cue comes from the light.
        ambient.color.lerp(autumnSky,autumn*.26*(d+a));
        ambient.intensity*=1-autumn*.045;
        sun.color.lerp(autumnSun,autumn*.30*(d+a));
        sun.intensity*=1+autumn*.025;
        sky.material.uniforms.turbidity.value=T.MathUtils.lerp(sky.material.uniforms.turbidity.value,1.65,autumn*.65);
        sky.material.uniforms.rayleigh.value=T.MathUtils.lerp(sky.material.uniforms.rayleigh.value,1.95,autumn*.42);
        if(scene.fog)scene.fog.color.lerp(autumnFog,autumn*.30*(d+a));
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
      ambient.intensity=T.MathUtils.lerp(ambient.intensity,blend(1.45,1.24,1.28,.45),cover);
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
