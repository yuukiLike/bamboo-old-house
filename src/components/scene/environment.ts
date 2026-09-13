import * as T from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { groundHeight, pathClearance, seeded, SHORE, TERRAIN_GRID } from './config';
import { addDayCycle } from './day-cycle';
import type { WeatherUniforms } from './weather-state';
import { addTerrainArt } from './terrain-art';
import { addReservoirWater } from './water';
import { createFootpathGeometry } from './footpath';

const noise=`
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){return noise(p)*.5+noise(p*2.13)*.25+noise(p*4.07)*.125+noise(p*8.31)*.0625;}
`;
export function addEnvironment(scene:T.Scene,renderer:T.WebGLRenderer,mobile:boolean,time:{value:number},night:{value:number},noon={value:0},dawn={value:0},dusk={value:0},weather?:WeatherUniforms) {
 const sky=new Sky(); sky.scale.setScalar(450000);
 sky.material.uniforms.turbidity.value=2.8; sky.material.uniforms.rayleigh.value=1.25;
 sky.material.uniforms.mieCoefficient.value=.002;
 sky.material.uniforms.mieDirectionalG.value=.77;
 const sunPosition=new T.Vector3(22,20,30).normalize();
 sky.material.uniforms.sunPosition.value.copy(sunPosition); scene.add(sky);
 const pmrem=new T.PMREMGenerator(renderer); const env=pmrem.fromScene(sky as unknown as T.Scene,.04,1,100000);scene.environment=env.texture;scene.environmentIntensity=.026;pmrem.dispose();
 scene.fog=new T.FogExp2(0x8ba998,.0045);
 const ambient=new T.HemisphereLight(0xc6dbed,0x514733,.9);scene.add(ambient);
 const sun=new T.DirectionalLight(0xffedcc,4.2);sun.position.set(22,20,30);sun.target.position.set(-1,0,3);
 // Include the far bank in actual bamboo shadows; the earlier short frustum
 // left a conspicuous uniformly lit strip beyond the detailed foreground.
 sun.castShadow=true;sun.shadow.mapSize.setScalar(mobile?1536:3072);sun.shadow.camera.left=-38;sun.shadow.camera.right=56;sun.shadow.camera.top=38;sun.shadow.camera.bottom=-58;sun.shadow.camera.near=1;sun.shadow.camera.far=115;sun.shadow.bias=-.00025;sun.shadow.normalBias=.022;sun.shadow.radius=2;scene.add(sun,sun.target);
 const g=TERRAIN_GRID,terrain=new T.PlaneGeometry(g.width,g.depth,g.columns,g.rows);terrain.rotateX(-Math.PI/2);terrain.translate(g.x0+g.width/2,0,g.z0+g.depth/2);
 const pos=terrain.attributes.position; for(let i=0;i<pos.count;i++)pos.setY(i,groundHeight(pos.getX(i),pos.getZ(i)));terrain.computeVertexNormals();
 const mat=new T.MeshStandardMaterial({color:0x8c886e,roughness:1});
 mat.onBeforeCompile=s=>{
  s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vGround;').replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nvGround=(modelMatrix*vec4(transformed,1.)).xyz;');
  s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vGround;\n'+noise).replace('#include <color_fragment>',`#include <color_fragment>
  vec2 p=vGround.xz; float broad=fbm(p*.6); float grain=noise(p*80.); float moss=fbm(p*.85+23.);
  float yard=smoothstep(-13.,-12.5,p.x)*(1.-smoothstep(9.6,10.2,p.x))*smoothstep(-5.,-4.5,p.y)*(1.-smoothstep(8.3+noise(p.xx)*.5,8.9,p.y));
  vec3 soil=mix(vec3(.052,.037,.017),vec3(.155,.123,.054),broad+.18);
  vec3 concrete=mix(vec3(.22,.25,.23),vec3(.44,.43,.365),broad+.18);
  vec3 base=mix(soil,concrete,yard);base=mix(base,vec3(.13,.205,.075),smoothstep(.55,.69,moss)*.8);
  base*=.88+grain*.22; base=mix(base,vec3(.048,.085,.022)*(.72+broad*.55),smoothstep(.2,3.,vGround.y)*.85); diffuseColor.rgb=base;
  `);
 };
 const ground=new T.Mesh(terrain,mat);ground.name='Reservoir_bank_and_courtyard';ground.receiveShadow=true;scene.add(ground);
 const reservoirWater=addReservoirWater(scene,SHORE.waterY,time,night,sun,weather);
 addFootpath(scene,terrain);
 addUnderstory(scene,mobile);
 const terrainArt=addTerrainArt(scene,mobile,groundHeight,pathClearance);
 const cycle=addDayCycle(scene,renderer,sky,sun,ambient,night,time,mobile,noon,dawn,dusk,weather);
 return {update:()=>{cycle.update();reservoirWater.update();},dispose:()=>{terrainArt.dispose();env.dispose();}};
}
export function addUnderstory(scene:T.Scene,mobile:boolean){
 const rand=seeded(207),dummy=new T.Object3D();
 const leaf=new T.BufferGeometry();leaf.setAttribute('position',new T.Float32BufferAttribute([0,0,0,-.016,.012,.1,0,.025,.19,.018,.008,.095],3));leaf.setIndex([0,1,2,0,2,3]);leaf.computeVertexNormals();
 const fallen=new T.InstancedMesh(leaf,new T.MeshStandardMaterial({color:0x92713a,roughness:1,side:T.DoubleSide}),mobile?2500:5000);
 const c=new T.Color();let count=0;
 for(let i=0;i<fallen.count;i++){
  const x=-32+rand()*56,z=-13+rand()*51;if((groundHeight(x,z)<-1.3&&!(x>10.5&&x<35&&z<14))||(pathClearance(x,z)<.06&&rand()>.06))continue;
  if(x>-8.5&&x<10.7&&z>-14.0&&z<-2.8)continue;
  const yard=x>-12&&x<9.8&&z<8.3&&z>-4.8;if(yard&&rand()>.07)continue;
  dummy.position.set(x,groundHeight(x,z)+.015,z);dummy.rotation.set((rand()-.5)*.3,rand()*Math.PI*2,(rand()-.5)*.2);dummy.scale.setScalar(.65+rand()*1.1);dummy.updateMatrix();fallen.setMatrixAt(count,dummy.matrix);c.setHSL(.10+rand()*.06,.25+rand()*.25,.2+rand()*.2);fallen.setColorAt(count,c);count++;
 }fallen.count=count;fallen.receiveShadow=true;fallen.name='Fallen_bamboo_leaves';scene.add(fallen);
 // Finely tapered blades, leaning in groups around the edge of the court.
 const bladeVertices:number[]=[],bladeFaces:number[]=[];
 for(let i=0;i<=6;i++){const f=i/6,w=.011*(1-f)+.00025;bladeVertices.push(f*f*.065-w,f*.28,f*f*.10,f*f*.065+w,f*.28,f*f*.10);if(i<6){const k=i*2;bladeFaces.push(k,k+1,k+2,k+1,k+3,k+2);}}
 const grassGeom=new T.BufferGeometry();grassGeom.setAttribute('position',new T.Float32BufferAttribute(bladeVertices,3));grassGeom.setIndex(bladeFaces);grassGeom.computeVertexNormals();
 const grass=new T.InstancedMesh(grassGeom,new T.MeshStandardMaterial({color:0xb0a68b,roughness:.86,side:T.DoubleSide}),mobile?6000:11000); count=0;
 for(let i=0;i<grass.count;i++){
  const angle=rand()*Math.PI*2,r=rand(),cluster=Math.floor(i/24);
  const cx=Math.sin(cluster*32.43)*24-2,cz=Math.cos(cluster*17.83)*23+8;
  const x=cx+Math.cos(angle)*r*.85,z=cz+Math.sin(angle)*r*.85;
  if(groundHeight(x,z)<-1.05||pathClearance(x,z)<.05||((x>-12.7&&x<10&&z>-4.8&&z<8.7)||(x>-8.5&&x<10.7&&z>-14.0&&z<-2.8)))continue;
  dummy.position.set(x,groundHeight(x,z),z);dummy.rotation.set(0,angle,0);dummy.scale.set(.6+rand()*.65,.32+rand()*.75,.6+rand()*.65);dummy.updateMatrix();grass.setMatrixAt(count,dummy.matrix);c.setHSL(.10+rand()*.04,.16+rand()*.18,.27+rand()*.16);grass.setColorAt(count,c);count++;
 }grass.count=count;grass.receiveShadow=true;grass.name='Bank_grasses';scene.add(grass);

}
function addFootpath(scene:T.Scene,terrain?:T.BufferGeometry){
 const geometry=createFootpathGeometry(terrain);
 const mat=new T.MeshStandardMaterial({color:0x6b7262,roughness:.98,transparent:true,depthWrite:false});mat.onBeforeCompile=s=>{
  s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vFootUV;').replace('#include <begin_vertex>','#include <begin_vertex>\nvFootUV=uv;');
  s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nvarying vec2 vFootUV;\n'+noise).replace('#include <color_fragment>',`#include <color_fragment>
   vec2 p=vFootUV;float edge=smoothstep(.24,.49,abs(p.x-.5)+noise(p*22.)*.04);
   float age=fbm(vec2(p.x*5.,p.y*2.)); float grit=noise(p*130.);
   vec3 worn=mix(vec3(.12,.145,.129),vec3(.29,.31,.266),age*.8+grit*.12);
   diffuseColor.rgb=mix(worn,vec3(.066,.099,.038),edge*(.55+noise(p*9.)*.45));
   float pathZ=p.y*4.;
   float chippedEdge=min(p.x,1.-p.x)+(noise(vec2(p.x*7.,p.y*11.))-.5)*.018;
   diffuseColor.a*=smoothstep(.008,.055,chippedEdge)*smoothstep(-9.,-2.5,pathZ)*(1.-smoothstep(40.,44.,pathZ));
  `);
 };const path=new T.Mesh(geometry,mat);path.name='Worn_footpath_from_courtyard';path.receiveShadow=true;scene.add(path);
}
