import * as T from 'three';
import { groundHeight, pathCenter, pathClearance, seeded } from './config';
import { footpathSurfaceHeight } from './footpath';
import { addPlantWind } from './understory';
import type { WeatherUniforms } from './weather-state';

// The remembered bank is carried by wild grasses. The experimental pine
// trees were removed after full-scene visual review; only a few shed needles
// remain beside the bend, mixed with the existing bamboo litter.
class BankGeometry {
 positions:number[]=[];colors:number[]=[];indices:number[]=[];
 vertex(p:T.Vector3,c:T.Color){const i=this.positions.length/3;this.positions.push(p.x,p.y,p.z);this.colors.push(c.r,c.g,c.b);return i;}
 face(a:number,b:number,c:number){this.indices.push(a,b,c);}
 build(){const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(this.positions,3));g.setAttribute('color',new T.Float32BufferAttribute(this.colors,3));g.setIndex(this.indices);g.computeVertexNormals();return g;}
}
function needle(batch:BankGeometry,root:T.Vector3,direction:T.Vector3,length:number,color:T.Color,droop=true){
 const side=new T.Vector3().crossVectors(direction,new T.Vector3(.13,1,.07)).normalize();
 const start=batch.positions.length/3;
 for(let i=0;i<4;i++){
  const u=i/3,p=root.clone().addScaledVector(direction,length*u);p.y-=droop?u*u*length*.10:0;
  const width=.0020*(1-u)+.00008;
  batch.vertex(p.clone().addScaledVector(side,-width),color);batch.vertex(p.clone().addScaledVector(side,width),color.clone().multiplyScalar(.88));
  if(i){const k=start+(i-1)*2;batch.face(k,k+1,k+2);batch.face(k+1,k+3,k+2);}
 }
}
/** Tall wild grass has individual culms and leaves at different nodes. The
 * stem supplies the height; short ground blades are never stretched upright. */
function createTallMeadow(){
 const random=seeded(812709),batch=new BankGeometry();
 for(let shoot=0;shoot<11;shoot++){
  const angle=random()*Math.PI*2,radius=Math.sqrt(random())*.29;
  const root=new T.Vector3(Math.cos(angle)*radius,0,Math.sin(angle)*radius);
  const height=shoot%4===0?1.8+random()*.6:2.3+random()*.85;
  const lean=new T.Vector3((random()-.5)*.58,0,(random()-.5)*.58);
  const stemAt=(u:number)=>root.clone().addScaledVector(lean,u*u).add(new T.Vector3(0,height*u,0));
  const stemColor=new T.Color().setHSL(.18+random()*.035,.30,.21+random()*.09);
  const stemStart=batch.positions.length/3,stemSegments=16,sides=5;
  for(let j=0;j<=stemSegments;j++){
   const u=j/stemSegments,center=stemAt(u),r=(.0042+shoot%3*.00045)*(1-u*.73);
   for(let side=0;side<sides;side++){
    const a=side/sides*Math.PI*2;
    batch.vertex(center.clone().add(new T.Vector3(Math.cos(a)*r,0,Math.sin(a)*r)),stemColor.clone().multiplyScalar(.77+.23*Math.cos(a)));
    if(j){const k=stemStart+(j-1)*sides+side,next=stemStart+(j-1)*sides+(side+1)%sides;batch.face(k,next,k+sides);batch.face(next,next+sides,k+sides);}
   }
  }
  const nodes=7+Math.floor(random()*3);
  for(let node=0;node<nodes;node++){
   const along=.13+node/nodes*.77+(random()-.5)*.035,origin=stemAt(along);
   const azimuth=angle+node*2.75+(random()-.5)*.8,outward=new T.Vector3(Math.cos(azimuth),0,Math.sin(azimuth)),side=new T.Vector3(-Math.sin(azimuth),0,Math.cos(azimuth));
   const length=(.70+random()*.55)*(.62+.38*Math.sin(Math.PI*along)),width=.010+random()*.008;
   const dry=random()<.21,initial=.48+random()*.42,flex=1.7+random()*.55;
   const color=new T.Color().setHSL(dry?.11+random()*.02:.195+random()*.045,dry?.27:.32+random()*.12,dry?.29+random()*.09:.20+random()*.11);
   const tipColor=color.clone().lerp(new T.Color('#b6a96c'),dry?.18:.12),position=origin.clone(),first=batch.positions.length/3,segments=15;
   for(let j=0;j<=segments;j++){
    const u=j/segments;
    if(j){const t=(j-.5)/segments,theta=initial+flex*Math.pow(t,1.45);position.addScaledVector(outward,Math.sin(theta)*length/segments);position.y+=Math.cos(theta)*length/segments;}
    const half=width*Math.pow(Math.sin(Math.PI*u),.65)+.00002,shade=color.clone().lerp(tipColor,u*u),across=side.clone().applyAxisAngle(outward,u*.15);
    batch.vertex(position.clone().addScaledVector(across,-half),shade.clone().multiplyScalar(.90));
    batch.vertex(position.clone().add(new T.Vector3(0,half*.16,0)),shade);
    batch.vertex(position.clone().addScaledVector(across,half),shade.clone().multiplyScalar(.96));
    if(j){const k=first+(j-1)*3;batch.face(k,k+1,k+3);batch.face(k+1,k+4,k+3);batch.face(k+1,k+2,k+4);batch.face(k+2,k+5,k+4);}
   }
  }
 }
 return batch.build();
}
function createMeadowClump(variant:number){
 const random=seeded(93012+variant*719),batch=new BankGeometry(),lengths=[.72,1.22,1.95],blades=[38,52,47];
 for(let blade=0;blade<blades[variant];blade++){
  const angle=random()*Math.PI*2,radius=Math.sqrt(random())*.23,root=new T.Vector3(Math.cos(angle)*radius,0,Math.sin(angle)*radius),outward=new T.Vector3(Math.cos(angle),0,Math.sin(angle)),side=new T.Vector3(-Math.sin(angle),0,Math.cos(angle));
  const length=lengths[variant]*(.48+random()*.72),lean=.16+random()*.66,flex=(1.35+random()*.85)*(1-.26*lean),width=(.006+random()*.009)*(variant===0?.65:1),dry=random()<.23;
  const color=new T.Color().setHSL(dry?.105+random()*.025:.22+random()*.045,dry?.22+random()*.12:.30+random()*.20,dry?.25+random()*.10:.145+random()*.14);
  const tipColor=dry?color.clone().multiplyScalar(1.18):color.clone().lerp(new T.Color('#7b7744'),.15+random()*.23);
  const start=batch.positions.length/3,segments=13,position=root.clone(),twist=(random()-.5)*.25;
  for(let j=0;j<=segments;j++){
   const u=j/segments;
   if(j){const t=(j-.5)/segments,theta=lean+flex*Math.pow(t,1.6);position.addScaledVector(outward,Math.sin(theta)*length/segments);position.y+=Math.cos(theta)*length/segments;}
   const p=position.clone().addScaledVector(side,Math.sin(u*2.8+angle)*u*u*.045);
   // Integrating the turning tangent preserves blade length and gives a
   // gradually hanging tip rather than stretching grass into a vertical wall.
   const half=width*(.36+.64*Math.sin(Math.PI*Math.pow(u,.65)))*Math.pow(1-u,.6)+.000025,shade=color.clone().lerp(tipColor,u*u).multiplyScalar(.62+.38*Math.min(1,u*4)),ridge=side.clone().applyAxisAngle(outward,twist*u);
   batch.vertex(p.clone().addScaledVector(ridge,-half),shade.clone().multiplyScalar(.87));batch.vertex(p.clone().add(new T.Vector3(0,half*.20,0)),shade);batch.vertex(p.clone().addScaledVector(ridge,half),shade.clone().multiplyScalar(.96));
   if(j){const k=start+(j-1)*3;batch.face(k,k+1,k+3);batch.face(k+1,k+4,k+3);batch.face(k+1,k+2,k+4);batch.face(k+2,k+5,k+4);}
  }
 }
 return batch.build();
}
function addMeadowBank(scene:T.Scene,mobile:boolean,weather:WeatherUniforms){
 const random=seeded(849015),dummy=new T.Object3D(),patches=[[11.85,-8.2,.60,1.2],[13.3,-4.7,.85,1.15],[12.0,-.5,.72,1.05],[13.9,2.0,.74,1.3],[13.2,5.3,.62,.82]],amounts=mobile?[60,52,30]:[86,78,45];
 for(let variant=0;variant<3;variant++){
  const windHeight=variant===2?3.6:2.2;
  const material=new T.MeshStandardMaterial({vertexColors:true,roughness:.91,side:T.DoubleSide,forceSinglePass:true,envMapIntensity:.4});material.name='Meadow_curved_green_and_straw_blades';addPlantWind(material,weather,windHeight,.65);
  const count=amounts[variant],mesh=new T.InstancedMesh(variant===2?createTallMeadow():createMeadowClump(variant),material,count),bounds=new T.Box3();mesh.geometry.computeBoundingBox();let placed=0;
  for(let attempt=0;attempt<count*8&&placed<count;attempt++){
   const patch=patches[Math.floor(random()*patches.length)],outer=variant===0?1.3:variant===1?1:.66,gaussian=()=>random()+random()+random()-1.5;
   const x=patch[0]+gaussian()*patch[2]*outer,z=patch[1]+gaussian()*patch[3]*outer;if(x<10.9||pathClearance(x,z)<.6)continue;
   const scale=variant===2?.86+random()*.24:.68+random()*.64,normal=new T.Vector3(groundHeight(x-.12,z)-groundHeight(x+.12,z),.24,groundHeight(x,z-.12)-groundHeight(x,z+.12)).normalize();
   dummy.position.set(x,groundHeight(x,z)-.018,z);dummy.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),normal);dummy.rotateY(random()*Math.PI*2);dummy.scale.setScalar(scale);dummy.updateMatrix();
   // The blade tips, not merely the roots, must stay outside the house.
   bounds.copy(mesh.geometry.boundingBox!).applyMatrix4(dummy.matrix);if(bounds.min.x<10.92)continue;
   let laneClear=true;
   for(let j=0;j<=6;j++){const along=T.MathUtils.lerp(bounds.min.z,bounds.max.z,j/6);if(bounds.max.x>pathCenter(along)||pathClearance(bounds.max.x,along)<.30){laneClear=false;break;}}
   if(!laneClear)continue;
   mesh.setMatrixAt(placed++,dummy.matrix);
  }
  mesh.count=placed;mesh.name='Meadow_grass_beside_house_'+variant;mesh.receiveShadow=true;mesh.castShadow=true;mesh.customDepthMaterial=new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking,side:T.DoubleSide});addPlantWind(mesh.customDepthMaterial,weather,windHeight,.65);scene.add(mesh);
 }
}
export function addPineBank(scene:T.Scene,mobile:boolean,weather:WeatherUniforms){
 addMeadowBank(scene,mobile,weather);
 const random=seeded(224905),dummy=new T.Object3D(),color=new T.Color();
 const duff=new BankGeometry();
 for(const pair of [-1,1])needle(duff,new T.Vector3(),new T.Vector3(pair*.12,0,1).normalize(),.14,new T.Color('#b19765'),false);
 const litter=new T.InstancedMesh(duff.build(),new T.MeshStandardMaterial({vertexColors:true,roughness:.96,side:T.DoubleSide,forceSinglePass:true}),mobile?100:180);
 let count=0;
 for(let i=0;i<litter.count*3&&count<litter.count;i++){
  const z=-5.5-random()*8,x=pathCenter(z)+(random()-.35)*2.2,clearance=pathClearance(x,z);
  if(clearance<0&&random()>.16)continue;
  const y=footpathSurfaceHeight(x,z)??groundHeight(x,z);
  const normal=new T.Vector3(groundHeight(x-.03,z)-groundHeight(x+.03,z),.06,groundHeight(x,z-.03)-groundHeight(x,z+.03)).normalize();
  dummy.position.set(x,y+.003,z);dummy.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),normal);dummy.rotateY(random()*Math.PI*2);dummy.scale.setScalar(.58+random()*.7);dummy.updateMatrix();litter.setMatrixAt(count,dummy.matrix);
  color.setHSL(.08+random()*.06,.20+random()*.25,.30+random()*.25);litter.setColorAt(count,color);count++;
 }
 litter.count=count;litter.name='Pine_needle_duff_along_descending_lane';litter.receiveShadow=true;scene.add(litter);
 return {trees:0,needleLitter:count};
}
