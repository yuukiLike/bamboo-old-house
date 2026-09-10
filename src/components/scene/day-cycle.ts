import * as T from 'three';
import type { Sky } from 'three/addons/objects/Sky.js';
import { groundHeight, seeded, SUN_PRESETS, ROOM_LIGHTS } from './config';

export function addDayCycle(scene: T.Scene, renderer: T.WebGLRenderer, sky: Sky,
  sun: T.DirectionalLight, ambient: T.HemisphereLight, night: { value: number }, time: { value: number }, mobile: boolean, noon = { value: 0 }) {
  // Blend the physical daylight into a separate moonlit sky before tone mapping.
  sky.material.uniforms.uNight = night;
  sky.material.fragmentShader = sky.material.fragmentShader.replace('uniform float time;', 'uniform float time;\nuniform float uNight;')
    .replace('gl_FragColor = vec4( texColor, 1.0 );', `
      vec3 nightDirection = normalize(vWorldPosition - cameraPosition);
      float elevation = max(nightDirection.y, 0.0);
      vec3 nightColor = mix(vec3(.018, .033, .050), vec3(.003, .009, .024), pow(elevation, .45));
      vec3 moonDirection = normalize(vec3(-14., 27., 22.));
      float moonDistance = distance(nightDirection, moonDirection);
      float moonDisc = 1.0 - smoothstep(.011, .014, moonDistance);
      float moonHalo = exp(-moonDistance * 24.0) * .07;
      nightColor += vec3(.55, .68, .86) * (moonDisc * 1.8 + moonHalo);
      vec2 starCell = floor(nightDirection.xz / max(.15, nightDirection.y + 1.0) * 820.0);
      float star = fract(sin(dot(starCell, vec2(127.1, 311.7))) * 43758.5453);
      nightColor += vec3(.38, .46, .58) * step(.9991, star) * smoothstep(.12, .55, elevation);
      gl_FragColor = vec4(mix(texColor, nightColor, uNight), 1.0);
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

  const daySky = new T.Color(0xc6dbed), nightSky = new T.Color(0x57789f);
  const dayGround = new T.Color(0x514733), nightGround = new T.Color(0x172825);
  const daySun = new T.Color(SUN_PRESETS.day.color), moon = new T.Color(SUN_PRESETS.night.color);
  const dayFog = new T.Color(0x8ba998), nightFog = new T.Color(0x0b1a27);
  const dayPosition = new T.Vector3(...SUN_PRESETS.day.position), moonPosition = new T.Vector3(...SUN_PRESETS.night.position);
  // A high sun and warm reflected courtyard light, with blue skylight in the
  // eaves. Noon has its own direction and luminance, not a screen tint.
  const noonPosition = new T.Vector3(...SUN_PRESETS.noon.position);
  const noonSky = new T.Color(0xd3e1ef), noonGround = new T.Color(0xbc9974);
  const noonSun = new T.Color(SUN_PRESETS.noon.color), noonFog = new T.Color(0xc0ccc0);
  const skyDirection = new T.Vector3();
  const interiorBulbs = new Set<T.MeshStandardMaterial>();
  return {
    update() {
      const n = night.value, h = noon.value;
      if (!interiorBulbs.size) scene.traverse(object => {
        if (!(object instanceof T.Mesh)) return;
        for (const material of Array.isArray(object.material)?object.material:[object.material]) {
          if (material instanceof T.MeshStandardMaterial && (material.name.startsWith('Interior_frosted_lamp_glass') || material.name.startsWith('Kitchen_frosted_bare_bulb'))) interiorBulbs.add(material);
        }
      });
      for (const bulb of interiorBulbs) { bulb.emissive.setHex(0xffbf79); bulb.emissiveIntensity=n*2.1; }
      ambient.color.copy(daySky).lerp(noonSky, h).lerp(nightSky, n);
      ambient.groundColor.copy(dayGround).lerp(noonGround, h).lerp(nightGround, n);
      ambient.intensity = T.MathUtils.lerp(T.MathUtils.lerp(.9, 1.28, h), .5, n);
      sun.color.copy(daySun).lerp(noonSun, h).lerp(moon, n);
      sun.intensity = T.MathUtils.lerp(T.MathUtils.lerp(SUN_PRESETS.day.intensity, SUN_PRESETS.noon.intensity, h), SUN_PRESETS.night.intensity, n);
      sun.position.copy(dayPosition).lerp(noonPosition, h).lerp(moonPosition, n);
      skyDirection.copy(sun.position).sub(sun.target.position).normalize();
      sky.material.uniforms.sunPosition.value.copy(skyDirection);
      sky.material.uniforms.turbidity.value = T.MathUtils.lerp(2.8, 2.2, h);
      sky.material.uniforms.rayleigh.value = T.MathUtils.lerp(1.25, 2.2, h);
      if (scene.fog) scene.fog.color.copy(dayFog).lerp(noonFog, h).lerp(nightFog, n);
      if (scene.fog instanceof T.FogExp2) scene.fog.density = T.MathUtils.lerp(T.MathUtils.lerp(.0045, .0035, h), .010, n);
      scene.environmentIntensity = T.MathUtils.lerp(T.MathUtils.lerp(.026, .075, h), .009, n);
      renderer.toneMappingExposure = T.MathUtils.lerp(T.MathUtils.lerp(1.05, 1.12, h), 1.08, n);
      warm.intensity = 34 * n;
      downstairs.intensity = 6.5 * n;
      // Fully extinguished fixtures must leave Three's light list: zero power
      // alone retains seven point-light loops and shadow-coordinate varyings
      // in every leaf shader. Keep them present throughout the visible fade.
      warm.visible = downstairs.visible = n > 0;
      for (const {light,power} of roomLights) { light.intensity=power*n; light.visible=n>0; }
      downstairsBulbMaterial.emissiveIntensity = n * 1.5;
      bulbMaterial.emissiveIntensity = n * 4;
      fireflies.visible = n > .005;
    },
  };
}
