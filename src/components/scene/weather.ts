import * as T from 'three';
import { pathClearance, seeded } from './config';
import { forestWindGust } from './wind';
import { footpathSurfaceHeight } from './footpath';
import { createRainShelter, refineRainFloor, RAIN_SECTORS } from './rain-shelter';
import type { WeatherUniforms } from './weather-state';

type HeightField = {
  x0:number; z0:number; step:number; columns:number; rows:number;
  maximum:number;
  heights:Float32Array;
  sample:(x:number,z:number)=>number;
};
type Drop = { x:number;y:number;z:number;speed:number;seed:number;runoff:boolean;released:number };
type Impact = { x:number;y:number;z:number;born:number;strength:number;hard:boolean;seed:number };
type SurfaceWeather = { rainTime:{value:number}; activity:{value:number}; ingressWater:{value:T.Vector3} };

/**
 * Rain is simulated in metres around the eye, not painted onto the camera.
 * Imported tiles and timber roof decks supply one shared field for rain, runoff and
 * wetness. No per-frame raycasts, extra image downloads or PBR texture units.
 */
export function createWeather(scene:T.Scene,house:T.Group,camera:T.PerspectiveCamera,mobile:boolean,weather:WeatherUniforms){
  house.updateMatrixWorld(true);
  const roofs:T.Mesh[]=[];
  const paving:T.Mesh[]=[];
  house.traverse(object=>{
    if(!(object instanceof T.Mesh))return;
    const names=(Array.isArray(object.material)?object.material:[object.material]).map(m=>m.name).join(' ');
    if(/Grey_clay_tile/.test(names)||/^Architecture__Reference_(dark|silvered)_aged_timber$/.test(object.name))roofs.push(object);
    if(/Main_veranda_decades_worn_cement|Annex_worn_cement_and_thin_earth_gutter|Memory_well_lid_rubbed_grey_brown_wood/.test(names))paving.push(object);
  });
  if(!roofs.length)throw new Error('WEATHER_ROOF_GEOMETRY_MISSING');
  const roof=makeHeightField(roofs,.24,true);
  const pavement=paving.length?makeHeightField(paving,.24):null;
  const eaves=makeEaves(roof);
  const shelter=createRainShelter(house,roof.sample);
  const exposureStarted=performance.now();
  const surfaceWeather:SurfaceWeather={rainTime:{value:0},activity:{value:weather.rain.value>.01?1:0},ingressWater:{value:new T.Vector3()}};
  const surfaces=weatherSurfaces(scene,roof,weather,surfaceWeather,shelter);
  const exposureBuildMs=performance.now()-exposureStarted;
  // weatherSurfaces completes its full synchronous traversal before returning.
  // All future rain/wind settings reuse those baked attributes and the voxels;
  // the large exact triangle index and exposure memoization can now be freed.
  shelter.releaseExposureData();
  const group=new T.Group();group.name='Rain_and_roof_runoff';scene.add(group);
  const random=seeded(832194);
  const maxDrops=mobile?2400:6500,maxImpacts=mobile?180:420;
  const radius=mobile?18:22;
  const runoffPerEave=mobile?6:9;
  const drops:Drop[]=Array.from({length:maxDrops},()=>({x:0,y:0,z:0,speed:0,seed:random(),runoff:false,released:0}));
  const impacts:Impact[]=Array.from({length:maxImpacts},()=>({x:0,y:0,z:0,born:-10,strength:0,hard:false,seed:random()}));
  const maxIngress=mobile?90:240;
  const edgeRain:Drop[]=Array.from({length:maxIngress},()=>({x:0,y:0,z:0,speed:0,seed:random(),runoff:false,released:0}));
  const maximumStreaks=maxDrops+eaves.length*runoffPerEave+maxIngress;
  const streakData=new Float32Array(maximumStreaks*6);
  const streakAlpha=new Float32Array(maximumStreaks*2);
  const streakWidth=new Float32Array(maximumStreaks);
  const rainGeometry=new T.BufferGeometry();
  rainGeometry.setAttribute('position',new T.BufferAttribute(streakData,3).setUsage(T.DynamicDrawUsage));
  rainGeometry.setAttribute('rainAlpha',new T.BufferAttribute(streakAlpha,1).setUsage(T.DynamicDrawUsage));
  const rainMaterial=new T.ShaderMaterial({
    uniforms:{weatherNight:weather.night,weatherRain:weather.rain},
    transparent:true,depthWrite:false,
    vertexShader:`attribute vec3 rainHead;attribute vec3 rainTail;attribute float rainOpacity;attribute float rainWidth;
      varying vec2 vRainUV;varying float vRainAlpha;varying float vRainDistance;
      void main(){vec4 head=modelViewMatrix*vec4(rainHead,1.),tail=modelViewMatrix*vec4(rainTail,1.);
        vec4 eye=mix(head,tail,uv.y);vRainDistance=length(eye.xyz);vRainAlpha=rainOpacity;vRainUV=uv;
        vec2 along=normalize(tail.xy-head.xy+vec2(.00001));
        // The tiny distance term models the finite footprint of a water
        // droplet on a sensor. It avoids sharp one-pixel wire-like GL lines.
        float width=rainWidth+vRainDistance*.00035+(.0035*(1.-smoothstep(2.,8.,vRainDistance)));
        eye.xy+=vec2(along.y,-along.x)*position.x*width;
        gl_Position=projectionMatrix*eye;}`,
    fragmentShader:`uniform float weatherNight;uniform float weatherRain;varying vec2 vRainUV;varying float vRainAlpha;varying float vRainDistance;
      void main(){float readable=smoothstep(5.,13.,vRainDistance);
        float fade=smoothstep(.8,3.5,vRainDistance)*(1.-smoothstep(35.,56.,vRainDistance));
        vec3 light=mix(vec3(.43,.49,.50),vec3(.16,.23,.31),weatherNight);
        float crossSection=exp(-pow((vRainUV.x-.5)*4.3,2.));
        float exposure=exp(-pow((vRainUV.y-.45)*2.7,2.))*smoothstep(0.,.12,vRainUV.y)*(1.-smoothstep(.76,1.,vRainUV.y));
        float nearVisibility=mix(.035,.11,weatherRain);
        // Fine rain remains a short, soft mark but is readable from a seated
        // eye. The gain fades out with distance and is absent in a downpour.
        float gentleBoost=1.+1.2*smoothstep(.03,.20,weatherRain)*(1.-smoothstep(.58,.85,weatherRain))*(1.-smoothstep(10.,18.,vRainDistance));
        gl_FragColor=vec4(light,vRainAlpha*fade*crossSection*exposure*mix(nearVisibility,.42+weatherRain*.13,readable)*gentleBoost);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  // Keep the exact physical centerlines available for geometry diagnostics;
  // rendering uses tapered, soft instanced ribbons sharing their positions.
  const centerlineMaterial=new T.LineBasicMaterial();centerlineMaterial.visible=false;
  const rain=new T.LineSegments(rainGeometry,centerlineMaterial);rain.frustumCulled=false;rain.name='Wind_slanted_world_rain';group.add(rain);
  const ribbonGeometry=new T.InstancedBufferGeometry(),ribbonQuad=new T.PlaneGeometry(2,1);
  ribbonGeometry.index=ribbonQuad.index;ribbonGeometry.attributes.position=ribbonQuad.attributes.position;ribbonGeometry.attributes.uv=ribbonQuad.attributes.uv;
  const ribbonPositions=new T.InstancedInterleavedBuffer(streakData,6).setUsage(T.DynamicDrawUsage);
  const ribbonOpacity=new T.InstancedInterleavedBuffer(streakAlpha,2).setUsage(T.DynamicDrawUsage);
  ribbonGeometry.setAttribute('rainHead',new T.InterleavedBufferAttribute(ribbonPositions,3,0));
  ribbonGeometry.setAttribute('rainTail',new T.InterleavedBufferAttribute(ribbonPositions,3,3));
  ribbonGeometry.setAttribute('rainOpacity',new T.InterleavedBufferAttribute(ribbonOpacity,1,0));
  ribbonGeometry.setAttribute('rainWidth',new T.InstancedBufferAttribute(streakWidth,1).setUsage(T.DynamicDrawUsage));
  const ribbons=new T.Mesh(ribbonGeometry,rainMaterial);ribbons.frustumCulled=false;ribbons.name='Soft_rain_at_multiple_depths';ribbons.renderOrder=4;group.add(ribbons);

  // Millimetre impacts have no decorative white rings. Porous ground receives
  // a low dark tap; a fully developed water film may catch one tiny glint.
  const impactGeometry=new T.InstancedBufferGeometry();
  const quad=new T.PlaneGeometry(2,2,4,4);
  impactGeometry.index=quad.index;
  impactGeometry.attributes.position=quad.attributes.position;
  impactGeometry.attributes.uv=quad.attributes.uv;
  const impactPositions=new Float32Array(maxImpacts*3),impactState=new Float32Array(maxImpacts*4);
  impactGeometry.setAttribute('impactCenter',new T.InstancedBufferAttribute(impactPositions,3).setUsage(T.DynamicDrawUsage));
  impactGeometry.setAttribute('impactState',new T.InstancedBufferAttribute(impactState,4).setUsage(T.DynamicDrawUsage));
  const impactMaterial=new T.ShaderMaterial({
    uniforms:{weatherTime:weather.time,weatherNight:weather.night,weatherWetness:weather.wetness},transparent:true,depthWrite:false,side:T.DoubleSide,
    vertexShader:`attribute vec3 impactCenter;attribute vec4 impactState;uniform float weatherTime;
      varying vec2 splashUV;varying vec4 splashState;
      void main(){float age=clamp((weatherTime-impactState.x)/.30,0.,1.);float scale=(.003+age*.012)*impactState.y;
        splashUV=uv*2.-1.;splashState=vec4(age,impactState.yzw);
        float crownHeight=sin(age*3.14159)*.009*impactState.y*impactState.z*(1.-smoothstep(.10,.9,length(position.xy)));
        vec3 p=impactCenter+vec3(position.x*scale,crownHeight,position.y*scale);
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
    fragmentShader:`uniform float weatherNight;uniform float weatherWetness;varying vec2 splashUV;varying vec4 splashState;
      void main(){float age=splashState.x,hard=splashState.z,r=length(splashUV);
        float irregular=sin(splashUV.x*9.+splashState.w*31.)*sin(splashUV.y*7.+splashState.w*13.);
        float tap=(1.-smoothstep(.20,.9,r+irregular*.055))*(1.-age);
        float film=smoothstep(.78,.97,weatherWetness)*hard;
        float bead=exp(-dot(splashUV-vec2(.12,-.10),splashUV-vec2(.12,-.10))*28.)*(1.-smoothstep(.08,.48,age));
        float alpha=tap*.11+bead*film*.13;
        vec3 c=mix(vec3(.022,.025,.020),vec3(.25,.30,.31),film*bead)*mix(1.,.30,weatherNight);
        gl_FragColor=vec4(c,alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const splashes=new T.Mesh(impactGeometry,impactMaterial);splashes.frustumCulled=false;splashes.name='Concrete_crowns_and_soil_absorption';splashes.renderOrder=3;group.add(splashes);

  // A few low, translucent wisps on warm initially dry ground. Heat is spent
  // by the first rain and slowly returns only in dry daylight; this cannot
  // become perpetual smoke or a blanket over the walking surface.
  const vaporCount=mobile?5:10,vaporQuad=new T.PlaneGeometry(2,2);
  const vaporGeometry=new T.InstancedBufferGeometry();vaporGeometry.index=vaporQuad.index;vaporGeometry.attributes.position=vaporQuad.attributes.position;vaporGeometry.attributes.uv=vaporQuad.attributes.uv;
  const vaporPositions=new Float32Array(vaporCount*3),vaporSeeds=Float32Array.from({length:vaporCount},()=>random());
  const vaporCycles=new Int32Array(vaporCount).fill(-1),vaporAmount={value:0},vaporDrift={value:new T.Vector2()};
  vaporGeometry.setAttribute('vaporCenter',new T.InstancedBufferAttribute(vaporPositions,3).setUsage(T.DynamicDrawUsage));vaporGeometry.setAttribute('vaporSeed',new T.InstancedBufferAttribute(vaporSeeds,1));
  const vaporMaterial=new T.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{weatherTime:weather.time,vaporAmount,vaporDrift},
    vertexShader:`attribute vec3 vaporCenter;attribute float vaporSeed;uniform float weatherTime;uniform vec2 vaporDrift;varying vec2 vaporUV;varying float vaporAge;
      void main(){float age=fract(weatherTime/(4.3+vaporSeed*3.)+vaporSeed*7.);vaporAge=age;vaporUV=uv;
        vec3 center=vaporCenter+vec3(vaporDrift.x*age,.045+age*.11,vaporDrift.y*age);
        vec4 eye=modelViewMatrix*vec4(center,1.);eye.xy+=position.xy*vec2(.15+age*.18,.075+age*.09);gl_Position=projectionMatrix*eye;}`,
    fragmentShader:`uniform float vaporAmount;varying vec2 vaporUV;varying float vaporAge;
      float h(vec2 p){return fract(sin(dot(p,vec2(113.1,279.3)))*43758.5453);}
      float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1.,0.)),f.x),mix(h(i+vec2(0.,1.)),h(i+1.),f.x),f.y);}
      void main(){vec2 p=vaporUV*2.-1.;float wisp=exp(-dot(p*vec2(1.,1.2),p*vec2(1.,1.2))*3.4);
        wisp*=.35+.65*n(vaporUV*4.+vec2(vaporAge*.8,-vaporAge*1.5));
        gl_FragColor=vec4(vec3(.34,.38,.38),wisp*sin(vaporAge*3.14159)*vaporAmount*.040);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`});
  const vapor=new T.Mesh(vaporGeometry,vaporMaterial);vapor.frustumCulled=false;vapor.name='First_rain_over_warm_ground';vapor.renderOrder=2;group.add(vapor);
  let storedWarmth=(1-weather.night.value)*Math.max(0,1-weather.wetness.value*5);

  const ground=(x:number,z:number)=>Math.max(footpathSurfaceHeight(x,z),pavement?.sample(x,z)??-100);
  const hardGround=(x:number,z:number)=>((x>-13&&x<10.1&&z>-5&&z<8.7)||pathClearance(x,z)<0);
  const forward=new T.Vector3(0,0,-1),right=new T.Vector3(1,0,0),up=new T.Vector3(0,1,0);
  let halfFov=Math.tan(camera.fov*Math.PI/360);
  const spawn=(drop:Drop,fill=false)=>{
    // Most drops occupy visible air ahead of the eye. A smaller all-around
    // field preserves distant rain and turning continuity. In the courtyard
    // prefer the open air before the facade, rather than spending nearly all
    // the pool above an opaque roof or behind the camera.
    const visible=random()<.84;
    let distance=0;
    if(visible){
      const near=random()<.22;
      for(let attempt=0;attempt<6;attempt++){
        distance=near?2.5+random()**.85*7.5:8+random()**.72*28;
        const side=(random()-.5)*2*(distance*halfFov*camera.aspect+1.2);
        drop.x=camera.position.x+forward.x*distance+right.x*side;
        drop.z=camera.position.z+forward.z*distance+right.z*side;
        if(!near||roof.sample(drop.x,drop.z)<camera.position.y+1.5)break;
      }
    }else{
      const angle=random()*Math.PI*2,r=Math.sqrt(random())*radius;
      drop.x=camera.position.x+Math.cos(angle)*r;drop.z=camera.position.z+Math.sin(angle)*r;
    }
    const floor=Math.max(ground(drop.x,drop.z),roof.sample(drop.x,drop.z));
    const center=camera.position.y+forward.y*distance;
    const bottom=visible?Math.max(floor+.06,center-distance*halfFov-1.5):floor+.06;
    const top=visible?Math.max(bottom+1.8,center+distance*halfFov+1.5):Math.max(floor+8,camera.position.y+10);
    drop.y=fill?bottom+random()*(top-bottom):top+random()*1.3;
    drop.speed=5.5+random()*4.7;drop.seed=random();drop.runoff=false;drop.released=weather.time.value-(fill?.05:0);
  };
  drops.forEach(drop=>spawn(drop,true));
  const runoff:Drop[]=Array.from({length:eaves.length*runoffPerEave},(_,i)=>({x:eaves[Math.floor(i/runoffPerEave)].x,y:eaves[Math.floor(i/runoffPerEave)].y,z:eaves[Math.floor(i/runoffPerEave)].z,speed:0,seed:random(),runoff:true,released:0}));
  let disposed=false,lastTime=weather.time.value,impactCursor=0,previousCount=0,collisionCount=0,runoffFlow=0,roofWater=0,runoffDrops=0,ingressDrops=0,visualRevision=0;
  const emitImpact=(x:number,y:number,z:number,strength:number,hard:boolean)=>{
    const impact=impacts[impactCursor++%maxImpacts];impact.x=x;impact.y=y+.012;impact.z=z;impact.born=weather.time.value;impact.strength=strength;impact.hard=hard;impact.seed=random();
  };
  const writeLine=(index:number,drop:Drop,dx:number,dz:number,verticalSpeed:number,shutter:number,alpha:number,width=.0022,allowInside=false)=>{
    // A streak represents a short shutter exposure, never a fixed length
    // divided by a freshly released drop's near-zero vertical velocity.
    const duration=Math.min(shutter,Math.max(0,weather.time.value-drop.released));
    const trailX=-dx*duration,trailZ=-dz*duration;
    const trailY=Math.max(0,verticalSpeed*duration-(drop.runoff?4.905*duration*duration:0));
    const fraction=allowInside?shelter.clip(drop.x,drop.y,drop.z,trailX,trailY,trailZ):clipRainTrail(roof,drop.x,drop.y,drop.z,trailX,trailY,trailZ);
    const offset=index*6;streakData[offset]=drop.x;streakData[offset+1]=drop.y;streakData[offset+2]=drop.z;
    streakData[offset+3]=drop.x+trailX*fraction;streakData[offset+4]=drop.y+trailY*fraction;streakData[offset+5]=drop.z+trailZ*fraction;
    streakAlpha[index*2]=alpha;streakAlpha[index*2+1]=alpha*.18;
    streakWidth[index]=width;
  };
  return {
    // Rare state changes can still happen with a frozen simulation clock:
    // a previously sheltered vapor sample succeeds, or an eave drop is culled.
    get visualRevision(){return visualRevision;},
    surfaceHeightAt:(x:number,z:number)=>Math.max(ground(x,z),roof.sample(x,z)),
    isSheltered:(x:number,y:number,z:number)=>roof.sample(x,z)>y+.12,
    update(_delta:number,staticWeather=false){
      if(disposed)return;
      // Pause, reduced motion and hidden tabs all freeze the owner's clock.
      const dt=staticWeather?0:Math.min(.075,Math.max(0,weather.time.value-lastTime));lastTime=weather.time.value;
      camera.getWorldDirection(forward);right.crossVectors(forward,up).normalize();halfFov=Math.tan(camera.fov*Math.PI/360);
      const amount=T.MathUtils.clamp(weather.rain.value,0,1);
      if(amount>.005)surfaceWeather.rainTime.value+=dt*(.77+amount*.76);
      surfaceWeather.activity.value=T.MathUtils.damp(surfaceWeather.activity.value,amount>.005?1:0,amount>.005?1.8:.024,dt);
      const count=amount>.005?Math.round(maxDrops*(.015+amount**2.3*.985)):0;
      if(count>previousCount)for(let i=previousCount;i<count;i++)spawn(drops[i],true);
      previousCount=count;
      const gust=forestWindGust(weather.time.value,camera.position.x,camera.position.z);
      const drift=(.25+weather.wind.value*5.8)*(.48+gust*.52);
      const angle=.38+Math.sin(weather.time.value*.23)*.78+Math.sin(weather.time.value*.71)*.24;
      const dx=drift*Math.cos(angle),dz=drift*Math.sin(angle);
      const storm=T.MathUtils.smoothstep(amount,.55,.95)*T.MathUtils.smoothstep(weather.wind.value,.30,.80);
      // Store each gust sector separately: previously wetted timber does not
      // become instantly dry when the wind veers to another opening.
      for(let sector=0;sector<3;sector++){
        const weight=Math.max(0,1-Math.abs(angle-RAIN_SECTORS[sector])/1.18);
        const value=surfaceWeather.ingressWater.value.getComponent(sector);
        surfaceWeather.ingressWater.value.setComponent(sector,staticWeather?storm*[.60,.85,.55][sector]:T.MathUtils.damp(value,storm*weight,storm*weight>value?.11:.012,dt));
      }
      storedWarmth=T.MathUtils.damp(storedWarmth,amount>.005?0:(1-weather.night.value)*Math.max(0,1-weather.wetness.value*5),amount>.005?.085:.006,dt);
      vaporAmount.value=storedWarmth*(1-weather.night.value)*Math.pow(amount,.4)*(1-weather.wetness.value);
      vaporDrift.value.set(dx*.055,dz*.055);
      vapor.visible=vaporAmount.value>.005;
      if(vapor.visible){
        for(let i=0;i<vaporCount;i++){
          const cycle=Math.floor(weather.time.value/(4.3+vaporSeeds[i]*3)+vaporSeeds[i]*7);
          const p=i*3;if(vaporCycles[i]===cycle&&(vaporPositions[p]-camera.position.x)**2+(vaporPositions[p+2]-camera.position.z)**2<12**2)continue;
          const oldX=vaporPositions[p],oldY=vaporPositions[p+1],oldZ=vaporPositions[p+2];
          vaporCycles[i]=cycle;
          vaporPositions[p+1]=-1000;
          for(let attempt=0;attempt<16;attempt++){
            const distance=1.5+random()*7,side=(random()-.5)*9;
            const x=camera.position.x+forward.x*distance+right.x*side,z=camera.position.z+forward.z*distance+right.z*side,y=ground(x,z)+.012;
            const sheltered=[[-.65,-.65],[-.65,.65],[.65,-.65],[.65,.65]].some(([ox,oz])=>roof.sample(x+ox,z+oz)>y+.16);
            if(sheltered)continue;
            vaporPositions[p]=x;vaporPositions[p+1]=y;vaporPositions[p+2]=z;break;
          }
          if(vaporPositions[p]!==oldX||vaporPositions[p+1]!==oldY||vaporPositions[p+2]!==oldZ)visualRevision++;
        }
        vaporGeometry.attributes.vaporCenter.needsUpdate=true;
      }
      for(let i=0;i<count;i++){
        const drop=drops[i];
        if(dt){
          const fall=drop.speed*(.82+amount*.32)*dt;
          // 20 cm substeps catch a drop crossing a sloped eave between frames.
          const steps=Math.max(1,Math.ceil(Math.max(fall,drift*dt)/.20));
          let hit=false;
          for(let step=0;step<steps;step++){
            drop.x+=dx*dt/steps;drop.z+=dz*dt/steps;drop.y-=fall/steps;
            const roofY=roof.sample(drop.x,drop.z),floor=ground(drop.x,drop.z),surface=Math.max(roofY,floor);
            if(drop.y<=surface+.018){
              if(random()<.30+amount*.25)emitImpact(drop.x,surface,drop.z,.48+amount*.65,roofY>floor||hardGround(drop.x,drop.z));
              collisionCount++;spawn(drop);hit=true;break;
            }
          }
          if(!hit&&((drop.x-camera.position.x)**2+(drop.z-camera.position.z)**2>(radius+17)**2))spawn(drop);
        }
        const distance=Math.hypot(drop.x-camera.position.x,drop.y-camera.position.y,drop.z-camera.position.z);
        const readable=T.MathUtils.smoothstep(distance,5,14);
        const shutter=T.MathUtils.lerp(.003,.011+amount*.009,readable)*(.46+drop.seed*.86);
        writeLine(i,drop,dx,dz,drop.speed*(.82+amount*.32),shutter,.20+drop.seed*.58);
      }
      // Accumulated roof water continues briefly after the rain stops. At
      // drizzle each tile edge drips separately; a downpour joins the drops
      // into broken narrow threads without turning the whole eave into glass.
      roofWater=staticWeather?amount*.88:T.MathUtils.clamp(roofWater+dt*(amount*.075-roofWater*.040-(roofWater>.08?.010:0)),0,1);
      const drain=T.MathUtils.smoothstep(roofWater,.08,.70);
      runoffFlow=staticWeather?drain:T.MathUtils.damp(runoffFlow,drain,2.4,dt);
      const flow=runoffFlow;
      let lineCount=count;
      runoffDrops=0;
      if(flow>.015||runoff.some(drop=>drop.speed>0)){
        for(let i=0;i<runoff.length;i++){
          const drop=runoff[i],source=eaves[Math.floor(i/runoffPerEave)];
          if(i%runoffPerEave>=Math.ceil(1+flow**1.5*(runoffPerEave-1))&&drop.speed===0)continue;
          if((source.x-camera.position.x)**2+(source.z-camera.position.z)**2>52**2)continue;
          const phase=weather.time.value*(.43+flow*1.8)+drop.seed*17;
          if(drop.speed===0){
            if(!dt||flow<=.015)continue;
            if(Math.sin(phase*2.21+i*1.71)<.72-flow*1.6)continue;
            drop.x=source.x;drop.y=source.y-.035;drop.z=source.z;drop.speed=.3+random()*.9;drop.released=weather.time.value-dt;
          }
          if(dt){drop.speed+=9.81*dt;drop.x+=dx*.26*dt;drop.z+=dz*.26*dt;drop.y-=drop.speed*dt;}
          const lowerRoof=roof.sample(drop.x,drop.z);
          // Wind can carry a leeward eave drop back against the building.
          // Consume it there; otherwise that runoff would cross walls into
          // rooms even though the main rain particles respect the roof.
          if(lowerRoof>=source.y-.25&&drop.y<lowerRoof-.12){if(drop.speed>0)visualRevision++;drop.speed=0;continue;}
          const floor=Math.max(ground(drop.x,drop.z),lowerRoof<source.y-.25?lowerRoof:-100);
          if(drop.y<=floor+.018){
            emitImpact(drop.x,floor,drop.z,.8+flow*.8,hardGround(drop.x,drop.z)||lowerRoof===floor);
            visualRevision++;
            drop.speed=0;continue;
          }
          writeLine(lineCount++,drop,dx*.26,dz*.26,drop.speed,.009+flow*.017,.28+flow*.38,.0016+flow*.0035);runoffDrops++;
        }
      }
      // A bounded secondary pool can pass below an open eave. It uses the
      // same actual wall/floor shells as material ingress, instead of bypassing
      // the roof test with a rectangular 'inside' exception.
      ingressDrops=0;
      const edgeCount=Math.round(maxIngress*storm);
      for(let i=0;i<edgeRain.length;i++){
        const drop=edgeRain[i];
        if(drop.speed===0){
          if(!dt||i>=edgeCount)continue;
          let accepted=false;
          for(let attempt=0;attempt<5;attempt++){
            const source=eaves[Math.floor(random()*eaves.length)];
            if((source.x-camera.position.x)**2+(source.z-camera.position.z)**2>40**2)continue;
            drop.x=source.x;drop.y=source.y-.31;drop.z=source.z;
            if(shelter.solid(drop.x,drop.y,drop.z))continue;
            drop.speed=5+random()*2;drop.released=weather.time.value;accepted=true;break;
          }
          if(!accepted)continue;
        }
        if(dt){
          const mx=dx*dt,my=-drop.speed*dt,mz=dz*dt;
          if(shelter.clip(drop.x,drop.y,drop.z,mx,my,mz)<1){drop.speed=0;continue;}
          drop.x+=mx;drop.y+=my;drop.z+=mz;
          if(drop.y<=ground(drop.x,drop.z)+.03||weather.time.value-drop.released>2.5){drop.speed=0;continue;}
        }
        writeLine(lineCount++,drop,dx,dz,drop.speed,.005,.28+drop.seed*.16,.0019,true);ingressDrops++;
      }
      rainGeometry.setDrawRange(0,lineCount*2);
      rainGeometry.attributes.position.needsUpdate=true;rainGeometry.attributes.rainAlpha.needsUpdate=true;
      ribbonGeometry.instanceCount=lineCount;ribbonPositions.needsUpdate=true;ribbonOpacity.needsUpdate=true;ribbonGeometry.attributes.rainWidth.needsUpdate=true;
      let visibleImpacts=0;
      for(const impact of impacts){
        if(weather.time.value-impact.born>.30)continue;
        const p=visibleImpacts*3,s=visibleImpacts*4;
        impactPositions[p]=impact.x;impactPositions[p+1]=impact.y;impactPositions[p+2]=impact.z;
        impactState[s]=impact.born;impactState[s+1]=impact.strength;impactState[s+2]=Number(impact.hard);impactState[s+3]=impact.seed;visibleImpacts++;
      }
      impactGeometry.instanceCount=visibleImpacts;
      impactGeometry.attributes.impactCenter.needsUpdate=true;impactGeometry.attributes.impactState.needsUpdate=true;
      group.visible=lineCount>0||visibleImpacts>0||vapor.visible;
    },
    // Audio depends on drainage even when performance collection is stopped.
    get runoffFlow(){return runoffFlow;},
    diagnostics(){return{rainDrops:previousCount,roofCells:roof.heights.length,runoffSources:eaves.length,collisions:collisionCount,localRainTime:surfaceWeather.rainTime.value,absorptionActivity:surfaceWeather.activity.value,roofWater,runoffFlow,runoffDrops,ingressWetness:Math.max(...surfaceWeather.ingressWater.value.toArray()),ingressDrops,ingressExposedVertices:surfaces.exposedVertices,solidRainCells:shelter.stats.solidCells,shelterTriangles:shelter.stats.triangles,triangleShelterBuildMs:shelter.stats.triangleBuildMs,voxelShelterBuildMs:shelter.stats.voxelBuildMs,surfaceExposureBuildMs:exposureBuildMs,solidAt:shelter.solid,shelterAt:(x:number,y:number,z:number)=>roof.sample(x,z)>y+.12};},
    dispose(){if(disposed)return;disposed=true;surfaces.dispose();shelter.dispose();scene.remove(group);rainGeometry.dispose();centerlineMaterial.dispose();ribbonGeometry.dispose();ribbonQuad.dispose();rainMaterial.dispose();impactGeometry.dispose();quad.dispose();impactMaterial.dispose();vaporGeometry.dispose();vaporQuad.dispose();vaporMaterial.dispose();},
  };
}

/** Rasterize the actual imported triangle heights once. Quantized glTF
 * attributes are read through Three, so normalized coordinates are respected. */
function makeHeightField(meshes:T.Mesh[],step:number,roofOnly=false):HeightField{
  const bounds=new T.Box3();for(const mesh of meshes)bounds.expandByObject(mesh);
  const x0=bounds.min.x-step*2,z0=bounds.min.z-step*2;
  const columns=Math.ceil((bounds.max.x-x0)/step)+3,rows=Math.ceil((bounds.max.z-z0)/step)+3;
  const heights=new Float32Array(columns*rows).fill(-100);
  const a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3();
  for(const mesh of meshes){
    const positions=mesh.geometry.attributes.position,index=mesh.geometry.index;
    const count=index?index.count:positions.count;
    const timberRoof=roofOnly&&!/Grey_clay_tile/.test(mesh.name);
    for(let i=0;i<count;i+=3){
      a.fromBufferAttribute(positions,index?index.getX(i):i).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(positions,index?index.getX(i+1):i+1).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(positions,index?index.getX(i+2):i+2).applyMatrix4(mesh.matrixWorld);
      // The sealed small roof connecting the rear hall is timber, not tile.
      // Its merged material also contains railings and floors; elevation
      // selects the actual roof boards without mistaking furniture for cover.
      if(timberRoof&&Math.min(a.y,b.y,c.y)<6.0)continue;
      const determinant=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);
      if(Math.abs(determinant)<.000001)continue;
      const minX=Math.max(0,Math.floor((Math.min(a.x,b.x,c.x)-x0)/step)),maxX=Math.min(columns-1,Math.ceil((Math.max(a.x,b.x,c.x)-x0)/step));
      const minZ=Math.max(0,Math.floor((Math.min(a.z,b.z,c.z)-z0)/step)),maxZ=Math.min(rows-1,Math.ceil((Math.max(a.z,b.z,c.z)-z0)/step));
      for(let iz=minZ;iz<=maxZ;iz++)for(let ix=minX;ix<=maxX;ix++){
        const x=x0+ix*step,z=z0+iz*step;
        const u=((b.z-c.z)*(x-c.x)+(c.x-b.x)*(z-c.z))/determinant;
        const v=((c.z-a.z)*(x-c.x)+(a.x-c.x)*(z-c.z))/determinant;
        if(u<-.006||v<-.006||u+v>1.006)continue;
        const key=iz*columns+ix;heights[key]=Math.max(heights[key],u*a.y+v*b.y+(1-u-v)*c.y);
      }
    }
  }
  const sample=(x:number,z:number)=>{
    const ix=Math.round((x-x0)/step),iz=Math.round((z-z0)/step);
    return ix<0||ix>=columns||iz<0||iz>=rows?-100:heights[iz*columns+ix];
  };
  return{x0,z0,step,columns,rows,maximum:bounds.max.y,heights,sample};
}

/** Traverse every crossed shelter cell, clipping at the first obstructed
 * interval. Testing only the tip misses a streak passing through an eave;
 * testing only its ends also misses a covered interval in the middle. */
function clipRainTrail(field:HeightField,x:number,y:number,z:number,dx:number,dy:number,dz:number){
  if(y>field.maximum+.12)return 1;
  const minX=field.x0-field.step*.5,maxX=field.x0+(field.columns-.5)*field.step;
  const minZ=field.z0-field.step*.5,maxZ=field.z0+(field.rows-.5)*field.step;
  if(Math.max(x,x+dx)<minX||Math.min(x,x+dx)>maxX||Math.max(z,z+dz)<minZ||Math.min(z,z+dz)>maxZ)return 1;
  const ix=Math.round((x-field.x0)/field.step),iz=Math.round((z-field.z0)/field.step);
  let nextX=dx?Math.max(0,(field.x0+(ix+(dx>0?.5:-.5))*field.step-x)/dx):Infinity;
  let nextZ=dz?Math.max(0,(field.z0+(iz+(dz>0?.5:-.5))*field.step-z)/dz):Infinity;
  const crossX=dx?field.step/Math.abs(dx):Infinity,crossZ=dz?field.step/Math.abs(dz):Infinity;
  let start=0;
  while(start<1){
    const end=Math.min(1,nextX,nextZ),middle=(start+end)*.5;
    const height=field.sample(x+dx*middle,z+dz*middle);
    if(height>y+dy*start+.105)return Math.max(0,start-.003/Math.max(.001,Math.hypot(dx,dz)));
    if(end===1)return 1;
    if(nextX<=end)nextX+=crossX;
    if(nextZ<=end)nextZ+=crossZ;
    start=end;
  }
  return 1;
}

function makeEaves(field:HeightField){
  const eaves:{x:number;y:number;z:number}[]=[];
  const {columns,rows,heights,step,x0,z0}=field;
  for(let z=2;z<rows-2;z++)for(let x=2;x<columns-2;x++){
    if((x+z)%2)continue;
    const y=heights[z*columns+x];if(y<-20)continue;
    for(const [dx,dz] of [[0,1],[0,-1],[1,0],[-1,0]]){
      const outer=heights[(z+dz)*columns+x+dx],inner=heights[(z-dz)*columns+x-dx];
      // Only the downhill perimeter drains a roof; high gable/ridge ends do not.
      if(outer>-20||inner<y+.013)continue;
      eaves.push({x:x0+x*step+dx*step*.73,y,z:z0+z*step+dz*step*.73});break;
    }
  }
  return eaves;
}

const WET_GLSL=/* glsl */`
varying vec3 weatherWorld;
varying float weatherExposure;
varying vec3 weatherIngress;
uniform vec3 weatherIngressWater;
uniform float weatherWetness;
uniform float weatherTime;
uniform float weatherRain;
uniform float weatherNight;

uniform float weatherRainTime;
uniform float weatherAbsorptionActivity;
float wetHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float wetNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(wetHash(i),wetHash(i+vec2(1.,0.)),f.x),mix(wetHash(i+vec2(0.,1.)),wetHash(i+1.),f.x),f.y);}
float wetAbsorptionDots(vec2 metres){
  // Each jittered event occupies centimetres, rather than a visible regular
  // circle grid. The nearest four cells cover points crossing cell edges.
  vec2 p=mat2(.936,.352,-.352,.936)*metres*49.;
  vec2 base=floor(p),towards=mix(vec2(-1.),vec2(1.),step(vec2(.5),fract(p)));
  float result=0.,edgeNoise=wetNoise(metres*187.);
  for(int y=0;y<2;y++)for(int x=0;x<2;x++){
    vec2 cell=base+vec2(float(x),float(y))*towards;
    float cellSeed=wetHash(cell+3.17),period=9.0+cellSeed*4.;
    float localPorosity=wetNoise(cell*.173+23.8);
    float localTime=weatherRainTime-wetHash(cell+81.3)*period;
    float generation=floor(max(0.,localTime)/period);
    // A former hit remains while its successor arrives. Independent phases,
    // four-second seepage tails and the persistent wet base avoid a reset.
    for(int previous=0;previous<2;previous++){
      float epoch=generation-float(previous),age=localTime-epoch*period;
      vec2 key=cell+vec2(epoch*17.13,epoch*9.71);
      float seed=wetHash(key+11.7);
      vec2 center=cell+.14+.72*vec2(wetHash(key+31.8),wetHash(key+63.2));
      vec2 local=p-center;local.x*=.83+wetHash(key+27.4)*.36;
      float growth=smoothstep(.04,7.5,age);
      float radius=(.06+(.10+seed*.26)*growth)*(1.+(edgeNoise-.5)*.18);
      float fringe=max(.029+radius*.16,fwidth(length(local))*.85);
      float mark=1.-smoothstep(radius-fringe,radius+fringe,length(local));
      float life=smoothstep(0.,.11,age)*(1.-smoothstep(period,period+4.6,age));
      float exists=step(0.,epoch)*step(0.,localTime)*step(.05+localPorosity*.44,seed);
      result=max(result,mark*life*exists*(.77+seed*.23));
    }
  }
  return result;
}
`;

/** Exposure is attached to vertices, leaving the material's sampler budget
 * and all existing wood, window, wind, shadow and terrain hooks intact. */
function weatherSurfaces(scene:T.Scene,roof:HeightField,weather:WeatherUniforms,surfaceWeather:SurfaceWeather,shelter:ReturnType<typeof createRainShelter>){
  const materials=new Map<T.MeshStandardMaterial,{compile:T.Material['onBeforeCompile'];key:()=>string}>();
  const geometries=new Set<T.BufferGeometry>();
  const usage=new Map<T.BufferGeometry,number>();scene.traverse(o=>{if(o instanceof T.Mesh)usage.set(o.geometry,(usage.get(o.geometry)??0)+1);});
  const point=new T.Vector3(),normal=new T.Vector3(),normalMatrix=new T.Matrix3();
  const refined=new Map<T.Mesh,T.BufferGeometry>();let exposedVertices=0;
  scene.updateMatrixWorld(true);
  scene.traverse(object=>{
    if(!(object instanceof T.Mesh))return;
    if(/Reservoir_water|lamp|bulb|flame|contact|Moon|sky/i.test(object.name))return;
    const candidates=(Array.isArray(object.material)?object.material:[object.material]).filter((material):material is T.MeshStandardMaterial=>material instanceof T.MeshStandardMaterial&&!/glass|bulb|lamp|flame|emissive/i.test(material.name));
    if(!candidates.length)return;
    // Instanced plants have always used exposure=1 and ingress=0. Keep those
    // constants in the shader, freeing two vertex inputs for their wind cache.
    if(!(object instanceof T.InstancedMesh)&&!geometries.has(object.geometry)){
      if(candidates.some(m=>m.name.startsWith('Interior_floor_'))||((object.name.startsWith('Architecture__')||object.name.startsWith('Props__'))&&object.geometry.attributes.position.count<12000&&candidates.some(m=>/lime|plaster|cement|cotton|linen/i.test(m.name)))){refined.set(object,object.geometry);object.geometry=refineRainFloor(object.geometry,object.matrixWorld);}
      else if(object.name.startsWith('Architecture__Reference_')&&candidates.some(m=>m.name.includes('aged_timber'))){refined.set(object,object.geometry);object.geometry=refineRainFloor(object.geometry,object.matrixWorld,true);}
      else if((usage.get(object.geometry)??0)>1){refined.set(object,object.geometry);object.geometry=object.geometry.clone();}
      const positions=object.geometry.attributes.position,exposure=new Float32Array(positions.count),ingress=new Float32Array(positions.count*3);
      const normals=object.geometry.attributes.normal;normalMatrix.getNormalMatrix(object.matrixWorld);
      // A floor's sparse outer vertices may lie just beyond a raster cell at
      // the wall. Its explicit interior designation takes precedence there.
      const interior=candidates.every(material=>/^(Interior_|Kitchen_)/.test(material.name));
      for(let i=0;i<positions.count;i++){
        point.fromBufferAttribute(positions,i).applyMatrix4(object.matrixWorld);
        const cover=roof.sample(point.x,point.z);
        exposure[i]=interior||cover>point.y+.16?0:1;
        if(exposure[i]===0&&point.y<7.5&&point.y>-.2){
          if(normals)normal.fromBufferAttribute(normals,i).applyMatrix3(normalMatrix).normalize();else normal.set(0,1,0);
          const reach=shelter.exposure(point.x,point.y,point.z,normal.x,normal.y,normal.z);
          ingress.set(reach,i*3);if(reach.some(v=>v>.01))exposedVertices++;
        }
      }
      object.geometry.setAttribute('rainIngress',new T.BufferAttribute(ingress,3));
      object.geometry.setAttribute('rainExposure',new T.BufferAttribute(exposure,1));geometries.add(object.geometry);
    }
    for(const material of candidates){
      if(materials.has(material))continue;
      const originalCompile=material.onBeforeCompile.bind(material),originalKey=material.customProgramCacheKey.bind(material);
      const key=originalKey(),names=object.name+' '+material.name;
      const terrain=/Reservoir_bank_and_courtyard/.test(names),path=/Worn_footpath/.test(names);
      const vegetation=/Leaves|leaves|grass|Grass|herb|rosette|foliage|Stalk|bamboo|Bamboo|fern/i.test(names);
      const wood=/wood|Wood|timber|Timber|board|Board|door|Door|faded|straw|Straw|fuel/i.test(names);
      const wellLid=/Memory_well_lid_rubbed_grey_brown_wood/.test(names);
      const surface=wellLid?4:terrain?0:path?1:vegetation?3:wood?2:1;
      materials.set(material,{compile:originalCompile,key:originalKey});
      material.onBeforeCompile=(shader,renderer)=>{
        originalCompile.call(material,shader,renderer);
        shader.uniforms.weatherWetness=weather.wetness;shader.uniforms.weatherTime=weather.time;
        shader.uniforms.weatherRain=weather.rain;shader.uniforms.weatherNight=weather.night;
        shader.uniforms.weatherIngressWater=surfaceWeather.ingressWater;shader.uniforms.weatherRainTime=surfaceWeather.rainTime;shader.uniforms.weatherAbsorptionActivity=surfaceWeather.activity;
        shader.vertexShader=shader.vertexShader
          .replace('#include <common>',`#include <common>
            #ifndef USE_INSTANCING
            attribute float rainExposure;attribute vec3 rainIngress;
            #endif
            varying vec3 weatherIngress;varying float weatherExposure;varying vec3 weatherWorld;`)
          .replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
            vec4 rainWorld=vec4(transformed,1.);
            #ifdef USE_INSTANCING
            rainWorld=instanceMatrix*rainWorld;
            weatherExposure=1.;weatherIngress=vec3(0.);
            #else
            weatherExposure=rainExposure;weatherIngress=rainIngress;
            #endif
            weatherWorld=(modelMatrix*rainWorld).xyz;`);
        shader.fragmentShader=shader.fragmentShader
          .replace('#include <common>','#include <common>\n#define weatherSurface '+surface.toFixed(1)+'\n'+WET_GLSL)
          // Terrain-art expands the roughness chunk with its final dry
          // palette and relief. Apply wetness after that complete expansion.
          .replace('#include <metalnessmap_fragment>',`
            float wetPuddle=0.;
            if(weatherWetness>0.||weatherAbsorptionActivity>0.||dot(weatherIngressWater,weatherIngressWater)>0.){
            float wetUp=clamp(normalize(cross(dFdx(weatherWorld),dFdy(weatherWorld))).y,0.,1.);
            float wetIncoming=min(.92,1.-exp(-max(0.,dot(weatherIngress,weatherIngressWater))*6.));
            // Sheltered walls/floors cannot receive open-air absorption marks.
            // Keep the surface derivative outside the exposure branch.
            if(weatherExposure>0.||wetIncoming>0.){
            float wetHard=weatherSurface==1.?1.:0.;
            if(weatherSurface==0.)wetHard=smoothstep(-13.,-12.5,weatherWorld.x)*(1.-smoothstep(9.6,10.2,weatherWorld.x))*smoothstep(-5.,-4.5,weatherWorld.z)*(1.-smoothstep(8.3,8.9,weatherWorld.z));
            float wetGrain=wetNoise(weatherWorld.xz*3.1);
            float wetSoil=weatherSurface==0.?1.-wetHard:0.;
            // Ordinary rain leaves a long readable early-rain stage: tiny dark
            // absorbed hits over mostly dry binder. Only sustained saturation
            // joins those marks into a continuous film; stopping never resets it.
            float wetBase=weatherWetness*(.17+.83*smoothstep(.50,.94,weatherWetness));
            float wetDots=0.;
            if(weatherAbsorptionActivity>.001&&weatherExposure>0.&&wetUp>0.&&(weatherSurface==0.||weatherSurface==1.))wetDots=wetAbsorptionDots(weatherWorld.xz);
            float wetAmount=max(wetBase,wetDots*weatherAbsorptionActivity*(.81+weatherWetness*.19)*wetUp)*weatherExposure;
            if(weatherSurface==2.||weatherSurface==3.)wetAmount=weatherWetness*weatherExposure;
            if(weatherSurface==4.)wetAmount=max(weatherWetness,sqrt(weatherWetness)*.88)*weatherExposure;
            // Retained incoming dose fills the wood pores progressively: even a
            // narrow opening eventually wets a board instead of imposing a
            // permanently faint tint proportional to the aperture size.
            wetAmount=max(wetAmount,wetIncoming);
            float wetAbsorb=mix(.38,.30,wetSoil);
            if(weatherSurface==3.)wetAbsorb=.81;
            if(weatherSurface==2.)wetAbsorb=.46;
            if(weatherSurface==4.)wetAbsorb=.35;
            diffuseColor.rgb*=mix(1.,wetAbsorb,wetAmount*(.83+wetGrain*.17));
            // The actual authored lid is rubbed grey-brown timber, with its
            // photographed grain retained. Water restores deeper warm wood
            // colour instead of applying the stone/soil response to the lid.
            if(weatherSurface==4.)diffuseColor.rgb*=mix(vec3(1.),vec3(.95,.85,.72),wetAmount);
            float wetTarget=(weatherSurface==2.||weatherSurface==4.)?.43:weatherSurface==3.?.31:mix(.76,.52,wetHard);
            roughnessFactor=mix(roughnessFactor,min(roughnessFactor,wetTarget),wetAmount);
            float wetDepression=wetNoise(weatherWorld.xz*1.37+17.);
            wetPuddle=smoothstep(.59,.83,wetDepression)*smoothstep(.76,.98,weatherWetness)*weatherExposure*wetHard*pow(wetUp,8.);
            roughnessFactor=mix(roughnessFactor,.085,wetPuddle);
            }
            }
            #include <metalnessmap_fragment>
          `)
          .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
            // Wavelets exist only after pooling. They perturb reflected light
            // over centimetres and never paint white circles onto dry cement.
            if(wetPuddle>0.&&weatherRain>0.){
            vec2 rainCell=floor(weatherWorld.xz*24.),rainLocal=fract(weatherWorld.xz*24.)-.5;
            float rainSeed=wetHash(rainCell);
            rainLocal-=vec2(wetHash(rainCell+8.1),wetHash(rainCell+21.7))*.34-.17;
            float rainAge=fract(weatherTime*(1.7+rainSeed*1.8)+rainSeed*13.);
            float rainR=length(rainLocal);
            float rainWave=cos((rainR-rainAge*.75)*48.)*exp(-abs(rainR-rainAge*.75)*18.)*(1.-rainAge);
            vec2 rainGradient=normalize(rainLocal+vec2(.0001))*rainWave*.006*weatherRain*wetPuddle;
            normal=normalize(normal+mat3(viewMatrix)*vec3(rainGradient.x,0.,rainGradient.y));
            }
          `)
          .replace('#include <opaque_fragment>',`if(wetPuddle>0.){float wetFresnel=.02+.98*pow(1.-clamp(dot(normal,normalize(vViewPosition)),0.,1.),5.);
            vec3 wetSky=mix(vec3(.38,.46,.48),vec3(.018,.029,.044),weatherNight);
            outgoingLight+=wetSky*wetFresnel*wetPuddle*.16;
            }
            #include <opaque_fragment>`);
      };
      material.customProgramCacheKey=()=>key+'|weather-open-edge-rain-6|'+surface;
      material.needsUpdate=true;
    }
  });
  return{exposedVertices,dispose(){
    for(const [material,original]of materials){material.onBeforeCompile=original.compile;material.customProgramCacheKey=original.key;material.needsUpdate=true;}
    for(const geometry of geometries){geometry.deleteAttribute('rainExposure');geometry.deleteAttribute('rainIngress');}
    for(const [mesh,original]of refined){mesh.geometry.dispose();mesh.geometry=original;}
  }};
}
