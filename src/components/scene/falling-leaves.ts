import * as T from 'three';
import { groundHeight, seeded, treePositions } from './config';
import { forestWindBend, forestWindGust, type CulmCurve } from './wind';
import { transformCulmCurve } from './culm-curve';
import type { WeatherUniforms } from './weather-state';

type Leaf={active:boolean;p:T.Vector3;v:T.Vector3;born:number;landedAt:number;phase:number;size:number;spin:number;groundRotation:T.Quaternion};
type Canopy={p:T.Vector3;root:T.Vector3;height:number;fullHeight:number;axis:[number,number,number];curve?:CulmCurve};

/** A small reusable pool: irregular arrivals, leaf drag/flutter, then a real
 * surface landing. The shared simulation clock freezes the entire lifecycle. */
export function createFallingLeaves(scene:T.Scene,camera:T.Camera,mobile:boolean,weather:WeatherUniforms,surfaceHeightAt=(x:number,z:number)=>groundHeight(x,z)){
 const random=seeded(67218),capacity=mobile?24:40,geometry=leafGeometry();
 const fade=new T.InstancedBufferAttribute(new Float32Array(capacity),1);geometry.setAttribute('aLeafFade',fade);
 const material=new T.MeshStandardMaterial({color:0x87925d,roughness:.89,side:T.DoubleSide,vertexColors:true,transparent:true,depthWrite:false});
 material.onBeforeCompile=shader=>{
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float aLeafFade;varying float vLeafFade;')
   .replace('#include <begin_vertex>','#include <begin_vertex>\nvLeafFade=aLeafFade;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float vLeafFade;')
   .replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.a*=vLeafFade;');
 };
 material.customProgramCacheKey=()=> 'falling-bamboo-leaves-v1';
 const mesh=new T.InstancedMesh(geometry,material,capacity);mesh.name='Occasional_falling_bamboo_leaves';mesh.frustumCulled=false;mesh.receiveShadow=true;mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
 const dummy=new T.Object3D(),axis=new T.Vector3(0,1,0),normal=new T.Vector3();
 const leaves:Leaf[]=Array.from({length:capacity},()=>({active:false,p:new T.Vector3(),v:new T.Vector3(),born:0,landedAt:-1,phase:0,size:1,spin:0,groundRotation:new T.Quaternion()}));
 dummy.scale.setScalar(0);dummy.updateMatrix();for(let i=0;i<capacity;i++)mesh.setMatrixAt(i,dummy.matrix);
 const canopies=sampleCanopies(scene,random);
 scene.add(mesh);
 const stats={active:0,emitted:0,landed:0,canopies:canopies.length};
 let disposed=false,last=weather.time.value,nextDrop=last+2.5+random()*3;
 const schedule=(now:number)=>{
  const autumn=T.MathUtils.clamp(weather.autumn?.value??0,0,1),gust=forestWindGust(now,camera.position.x,camera.position.z);
  // Exponential waiting keeps the leaves irregular; a passing autumn gust
  // briefly shortens the wait without turning the small pool into a shower.
  nextDrop=now+2.3*(1-autumn*.46)-Math.log(Math.max(.001,random()))*(5.5-weather.wind.value*2.7)*(1-autumn*.48)*(1-gust*autumn*.38);
 };
 const drop=(now:number)=>{
  const leaf=leaves.find(item=>!item.active);if(!leaf)return;
  const nearby=canopies.filter(item=>{
   const d=(item.p.x-camera.position.x)**2+(item.p.z-camera.position.z)**2;
   return d<17**2&&d>1.2**2&&item.p.y>surfaceHeightAt(item.p.x,item.p.z)+.45;
  });
  if(!nearby.length)return;
  const source=nearby[Math.floor(random()*nearby.length)];
  leaf.p.copy(source.p).add(new T.Vector3(...forestWindBend(now,source.root.x,source.root.z,source.height,source.fullHeight,weather.wind.value,source.axis,source.curve).offset));
  leaf.v.set(.03,0,0);leaf.active=true;leaf.born=now;leaf.landedAt=-1;leaf.phase=random()*Math.PI*2;leaf.size=.72+random()*.57;leaf.spin=(random()-.5)*2.4;
  stats.emitted++;
 };
 const renderLeaf=(leaf:Leaf,index:number,now:number)=>{
  if(!leaf.active){dummy.scale.setScalar(0);fade.setX(index,0);}else{
   dummy.position.copy(leaf.p);dummy.scale.setScalar(leaf.size);
   const age=now-leaf.born;
   if(leaf.landedAt>=0)dummy.quaternion.copy(leaf.groundRotation);
   else dummy.rotation.set(Math.sin(age*3.7+leaf.phase)*.85,leaf.phase+age*leaf.spin,Math.sin(age*2.3+leaf.phase)*.63);
   const appearance=T.MathUtils.smoothstep(age,0,.3),disappearance=leaf.landedAt>=0?1-T.MathUtils.smoothstep(now-leaf.landedAt,12,17):1;
   fade.setX(index,.94*appearance*disappearance);
  }
  dummy.updateMatrix();mesh.setMatrixAt(index,dummy.matrix);
 };
 return {
  stats,
  update(delta:number){
   if(disposed)return;
   const now=weather.time.value,elapsed=now-last;last=now;
   if(elapsed<=0||delta<=0)return;
   const dt=Math.min(elapsed,delta,.05),wind=T.MathUtils.clamp(weather.wind.value,0,1);
   if(now>=nextDrop){
    drop(now);
    const autumn=T.MathUtils.clamp(weather.autumn?.value??0,0,1),gust=forestWindGust(now,camera.position.x,camera.position.z);
    if(wind>.65&&random()<.16+autumn*gust*.14)drop(now);
    schedule(now);
   }
   stats.active=0;
   for(let i=0;i<leaves.length;i++){
    const leaf=leaves[i];if(!leaf.active)continue;
    if(now-leaf.born>42||(leaf.landedAt>=0&&now-leaf.landedAt>17)){leaf.active=false;renderLeaf(leaf,i,now);continue;}
    if(leaf.landedAt<0){
     const age=now-leaf.born,gust=forestWindGust(now,leaf.p.x,leaf.p.z),flutter=Math.sin(age*3.7+leaf.phase);
     const air=(.16+wind*3.5)*(.35+gust*.65),drag=1.7+.75*Math.abs(flutter);
     leaf.v.x+=((air-leaf.v.x)*drag+Math.sin(age*2.3+leaf.phase)*.58)*dt;
     leaf.v.z+=((air*.43-leaf.v.z)*drag+Math.cos(age*2.9+leaf.phase)*.39)*dt;
     // Quadratic drag gives a broad fluttering leaf a finite terminal speed;
     // wet leaves carry extra water and settle faster with less hanging lift.
     const verticalDrag=(3.8+flutter*flutter*5.2)*(1-weather.rain.value*.33);
     leaf.v.y+=(-9.81-leaf.v.y*Math.abs(leaf.v.y)*verticalDrag)*dt;
     leaf.p.addScaledVector(leaf.v,dt);
     const ground=surfaceHeightAt(leaf.p.x,leaf.p.z)+.025;
     if(leaf.p.y<=ground){
      leaf.p.y=ground;leaf.v.set(0,0,0);leaf.landedAt=now;stats.landed++;
      const sx=surfaceHeightAt(leaf.p.x+.05,leaf.p.z)-surfaceHeightAt(leaf.p.x-.05,leaf.p.z),sz=surfaceHeightAt(leaf.p.x,leaf.p.z+.05)-surfaceHeightAt(leaf.p.x,leaf.p.z-.05);
      normal.set(-sx,.1,-sz).normalize();leaf.groundRotation.setFromUnitVectors(axis,normal).multiply(new T.Quaternion().setFromAxisAngle(axis,leaf.phase));
     }
    }
    stats.active++;renderLeaf(leaf,i,now);
   }
   mesh.instanceMatrix.needsUpdate=true;fade.needsUpdate=true;
  },
  dispose(){
   if(disposed)return;disposed=true;leaves.forEach(leaf=>{leaf.active=false;});stats.active=0;
   mesh.removeFromParent();mesh.dispose();geometry.dispose();material.dispose();
  },
 };
}

/** Sample actual authored leaves, rather than releasing particles from empty
 * sky. Keep front woodland candidates outdoors, clear of the open galleries. */
function sampleCanopies(scene:T.Scene,random:()=>number):Canopy[]{
 const geometries=new Map<number,T.BufferGeometry>();
 scene.traverse(object=>{
  if(!(object instanceof T.InstancedMesh))return;
  const match=object.name.match(/^Leaves_(\d)_/);if(match&&!geometries.has(Number(match[1])))geometries.set(Number(match[1]),object.geometry);
 });
 const samples:Canopy[]=[],transform=new T.Object3D();
 for(const tree of treePositions()){
  if(tree.z<9||tree.z>42||tree.x<-30||tree.x>29)continue;
  const positions=geometries.get(tree.variant)?.attributes.position;if(!positions)continue;
  const y=groundHeight(tree.x,tree.z);transform.position.set(tree.x,y,tree.z);transform.rotation.set(tree.leanX,tree.rotation,tree.leanZ);transform.scale.setScalar(tree.s);transform.updateMatrix();
  for(let i=0;i<3;i++){
   const point=new T.Vector3().fromBufferAttribute(positions,Math.floor(random()*positions.count)),height=point.y*tree.s;
   point.applyMatrix4(transform.matrix);
   if(point.z<5.3||point.y-groundHeight(point.x,point.z)<1.4)continue;
   samples.push({p:point,root:new T.Vector3(tree.x,y,tree.z),height,fullHeight:14*tree.s,curve:geometries.get(tree.variant)?.userData.culmCurve?transformCulmCurve(geometries.get(tree.variant)!.userData.culmCurve,transform.matrix):undefined,axis:new T.Vector3(0,1,0).applyEuler(transform.rotation).toArray() as [number,number,number]});
  }
 }
 return samples;
}
function leafGeometry(){
 const positions:number[]=[],colors:number[]=[],indices:number[]=[];
 for(let row=0;row<5;row++){
  const z=-.14+row*.07,width=[0,.021,.028,.019,0][row];
  for(let side=0;side<3;side++){
   positions.push((side-1)*width,side===1?.004:0,z);
   colors.push(...(side===1?[1.07,1.02,.79]:[.86+row*.035,.96,.83]));
  }
 }
 for(let row=0;row<4;row++)for(let side=0;side<2;side++){
  const a=row*3+side,b=a+3;indices.push(a,b,a+1,b,b+1,a+1);
 }
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}
