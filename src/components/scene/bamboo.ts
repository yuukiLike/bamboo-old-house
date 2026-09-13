import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FOREST_WIND_GLSL } from './wind';
import { fitCulmCurve } from './culm-curve';
import { addLeafHinges, LEAF_WIND_GLSL } from './leaf-motion';
import { groundHeight, treePositions, porchBranchPlacements } from './config';
import type { WeatherUniforms } from './weather-state';

const curveCommon=`
uniform vec3 uCulmCurves[20];
uniform int uCulmVariant;
void culmCurveDots(mat3 frame,vec3 tip,int variant,out vec4 dots,out float fifth){
 int i=variant*5;
 dots=vec4(dot(frame*uCulmCurves[i],tip),dot(frame*uCulmCurves[i+1],tip),dot(frame*uCulmCurves[i+2],tip),dot(frame*uCulmCurves[i+3],tip));
 fifth=dot(frame*uCulmCurves[i+4],tip);
}`;
const windCommon=FOREST_WIND_GLSL+curveCommon+`
vec3 sway(vec3 p,mat4 im){
 float scale=length(im[0].xyz);vec3 axis=normalize(im[1].xyz),tip=forestTipAlong(im[3].xyz,14.*scale,axis);
 vec4 dots;float fifth;culmCurveDots(mat3(im),tip,uCulmVariant,dots,fifth);
 return p+windToLocal(im,forestCurvedOffset(tip,max(p.y,0.)*scale,14.*scale,axis,dots,fifth));
}
vec3 swayNormal(vec3 p,vec3 n,mat4 im){
 float scale=length(im[0].xyz);vec3 axis=normalize(im[1].xyz),tip=forestTipAlong(im[3].xyz,14.*scale,axis);
 vec4 dots;float fifth;culmCurveDots(mat3(im),tip,uCulmVariant,dots,fifth);
 return windNormal(n,im,forestCurvedDerivative(tip,max(p.y,0.)*scale,14.*scale,axis,dots,fifth));
}`;
export function addBamboo(scene:T.Scene,prototype:T.Group,time:{value:number},mobile:boolean,night:{value:number},weather?:WeatherUniforms){
 prototype.updateMatrixWorld(true);
 const strength=weather?.wind??{value:.28},bases=new Map<string,T.BufferGeometry>();
 const curves=Array.from({length:4},(_,variant)=>{
  const source=prototype.getObjectByName(`Stalk_${variant}`) as T.Mesh;
  if(!source?.geometry)throw new Error('BAMBOO_ASSET_INVALID');
  const geometry=source.geometry.clone().applyMatrix4(source.matrixWorld);bases.set(`Stalk_${variant}`,geometry);
  return fitCulmCurve(geometry);
 });
 const curveUniform={value:curves.flat().map(c=>new T.Vector3(...c))};
 const deform=(shader:T.WebGLProgramParametersWithUniforms,variant=0,leaf=false)=>{
  shader.uniforms.uWindTime=time;shader.uniforms.uWindStrength=strength;shader.uniforms.uCulmCurves=curveUniform;shader.uniforms.uCulmVariant={value:variant};
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\n'+windCommon+(leaf?LEAF_WIND_GLSL:''))
   .replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
    #ifdef USE_INSTANCING
    objectNormal=swayNormal(${leaf?'leafHingePoint(position,instanceMatrix,instanceMatrix[3].xyz)':'position'},${leaf?'leafHingeRotate(objectNormal,instanceMatrix,instanceMatrix[3].xyz)':'objectNormal'},instanceMatrix);
    #endif`)
   .replace('#include <begin_vertex>',`#include <begin_vertex>
    #ifdef USE_INSTANCING
    transformed=sway(${leaf?'leafHingePoint(transformed,instanceMatrix,instanceMatrix[3].xyz)':'transformed'},instanceMatrix);
    #endif`);
 };
 const trees=treePositions();const dummy=new T.Object3D(),c=new T.Color();
 for(let variant=0;variant<4;variant++)for(const level of [0,1]){
  const positions=trees.filter(p=>p.variant===variant&&((Math.abs(p.x)>16||p.z<-9||p.z>34)?1:0)===level);
  for(const type of ['Stalk','Leaves']){
   const source=prototype.getObjectByName(`${type}_${variant}`) as T.Mesh;
   if(!source?.geometry)throw new Error('BAMBOO_ASSET_INVALID');
   const key=`${type}_${variant}`;
   let base=bases.get(key);if(!base){base=source.geometry.clone().applyMatrix4(source.matrixWorld);if(type==='Leaves')addLeafHinges(base,8);bases.set(key,base);}
   // LOD index buffers share the transformed vertex attributes. Identical
   // stalk geometry is uploaded once instead of once for each distance band.
   const geometry=type==='Stalk'?base:new T.BufferGeometry();
   if(type==='Leaves'){for(const [name,attribute] of Object.entries(base.attributes))geometry.setAttribute(name,attribute);geometry.setIndex(base.index);}
   geometry.userData.culmCurve=curves[variant];
   if(type==='Leaves'&&(level===1||mobile)){
    const index=geometry.index;
    if(index){const src=index.array,keep:number[]=[]; const stride=level===1?3:2;
      // Each complete leaf has eight triangles. Preserve whole leaves and edges.
      for(let i=0;i<src.length;i+=24*stride)for(let j=i;j<Math.min(i+24,src.length);j++)keep.push(src[j]);geometry.setIndex(keep);
    }
   }
   const original=Array.isArray(source.material)?source.material[0]:source.material;
   const material=(original as T.MeshStandardMaterial).clone();material.envMapIntensity=.65;
   if(type==='Leaves'){material.side=T.DoubleSide;material.roughness=.83;}
   material.onBeforeCompile=shader=>{deform(shader,variant,type==='Leaves');if(type==='Leaves')addLeafLight(shader,night);};
   material.customProgramCacheKey=()=>`bamboo-weather-${type}-v3`;
   const mesh=new T.InstancedMesh(geometry,material,positions.length);mesh.name=`${type}_${variant}_lod${level}`;
   positions.forEach((p,i)=>{dummy.position.set(p.x,groundHeight(p.x,p.z),p.z);dummy.rotation.set(p.leanX,p.rotation,p.leanZ);dummy.scale.setScalar(p.s);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);c.setHSL(type==='Leaves'?.27:.23,type==='Leaves'?.15:.08,.72+(i%7)*.024);mesh.setColorAt(i,c);});
   mesh.castShadow=level===0;mesh.receiveShadow=true;
   const depth=new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking,side:T.DoubleSide});depth.onBeforeCompile=shader=>deform(shader,variant,type==='Leaves');mesh.customDepthMaterial=depth;
   mesh.computeBoundingSphere();if(mesh.boundingSphere)mesh.boundingSphere.radius+=2.6;scene.add(mesh);
  }
 }
 return { count:trees.length };
}

function addLeafLight(shader:T.WebGLProgramParametersWithUniforms,night:{value:number}) {
 shader.uniforms.uNight=night;
 shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform float uNight;');
 shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
  float leafLuminance=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
  diffuseColor.rgb=mix(vec3(leafLuminance),diffuseColor.rgb,.70)*vec3(1.08,1.,.90);
 `);
 shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
  #if NUM_DIR_LIGHTS > 0
  vec3 leafLight=normalize(directionalLights[0].direction);
  float scatter=pow(max(0.,dot(normalize(vViewPosition),-leafLight)),3.);
  float lamina=.28+.72*abs(dot(normal,leafLight));
  reflectedLight.indirectDiffuse+=diffuseColor.rgb*(.095+scatter*.48)*lamina*(1.-uNight*.97);
  #endif
 `);
}

/** Hanging shoots share a root, parent tangent and continuous deformation field
 * with their connector. Every seam gets exactly the same world-space mapping. */
export function addPorchBamboo(scene:T.Scene,prototype:T.Group,time:{value:number},night:{value:number},culms:T.Group,weather?:WeatherUniforms) {
 prototype.updateMatrixWorld(true);culms.updateMatrixWorld(true);
 const trees=treePositions(),placements=porchBranchPlacements(trees),strength=weather?.wind??{value:.28};
 const sourceBranch=prototype.getObjectByName('Branches');
 if(!sourceBranch)throw new Error('PORCH_BAMBOO_ASSET_INVALID');
 const attachmentY=Number(sourceBranch.userData.attachment_local_y)||4.217302302122117;
 const curves=Array.from({length:4},(_,variant)=>{const source=culms.getObjectByName(`Stalk_${variant}`) as T.Mesh,geometry=source.geometry.clone().applyMatrix4(source.matrixWorld),curve=fitCulmCurve(geometry);geometry.dispose();return curve;});
 const curveUniform={value:curves.flat().map(c=>new T.Vector3(...c))};
 const ringCache=new Map<number,T.Vector3[]>();
 const bindings=placements.map(({tree:treeIndex,height,p,s,r,rx,rz})=>{
  const tree=trees[treeIndex],source=culms.getObjectByName(`Stalk_${tree.variant}`) as T.Mesh;
  if(!ringCache.has(tree.variant)){
   const points=source.geometry.attributes.position,rings=new Map<number,T.Vector3[]>();
   for(let i=0;i<points.count;i++){
    const v=new T.Vector3().fromBufferAttribute(points,i).applyMatrix4(source.matrixWorld),key=Math.round(v.y*10000);
    const ring=rings.get(key);if(ring)ring.push(v);else rings.set(key,[v]);
   }
   const centers:T.Vector3[]=[];
   for(const ring of rings.values()){
    if(ring.length<8)continue;const box=new T.Box3().setFromPoints(ring),size=box.getSize(new T.Vector3());
    if(size.x>=.38||size.z>=.38)continue;
    centers.push(ring.reduce((sum,v)=>sum.add(v),new T.Vector3()).multiplyScalar(1/ring.length));
   }
   if(!centers.length)throw new Error('BAMBOO_CULM_RINGS_MISSING');
   ringCache.set(tree.variant,centers);
  }
  const rootY=groundHeight(tree.x,tree.z),localHeight=(height-rootY)/tree.s;
  const center=ringCache.get(tree.variant)!.reduce((a,b)=>Math.abs(a.y-localHeight)<Math.abs(b.y-localHeight)?a:b);
  const transform=new T.Object3D();transform.position.set(tree.x,rootY,tree.z);transform.rotation.set(tree.leanX,tree.rotation,tree.leanZ);transform.scale.setScalar(tree.s);transform.updateMatrix();
  const anchor=center.clone().applyMatrix4(transform.matrix),axis=new T.Vector3(0,1,0).applyEuler(transform.rotation);
  const crown=new T.Object3D();crown.position.fromArray(p);crown.rotation.set(rx,r,rz);crown.scale.setScalar(s);crown.updateMatrix();
  const attachment=new T.Vector3(.98,attachmentY,-.05).applyMatrix4(crown.matrix);
  const quaternion=transform.quaternion.clone();if(quaternion.w<0)quaternion.set(-quaternion.x,-quaternion.y,-quaternion.z,-quaternion.w);
  return {shape:[quaternion.x,quaternion.y,quaternion.z,tree.variant],center:anchor,attachment,root:[tree.x,rootY,tree.z,center.y*tree.s],frame:[axis.x,axis.y,axis.z,14*tree.s],anchor:[...anchor.toArray(),Math.max(3,anchor.distanceTo(attachment))]};
 });
 const branchWind=FOREST_WIND_GLSL+curveCommon+`
 attribute vec4 aBranchRoot;
 attribute vec4 aBranchFrame;
 attribute vec4 aBranchAnchor;
 attribute vec4 aBranchShape;
 vec3 branchCulmRotate(vec3 v){
  vec3 q=aBranchShape.xyz;float w=sqrt(max(0.,1.-dot(q,q)));
  return (v+2.*cross(q,cross(q,v)+w*v))*(aBranchFrame.w/14.);
 }
 void branchCulmState(out vec3 offset,out vec3 derivative){
  vec3 tip=forestTipAlong(aBranchRoot.xyz,aBranchFrame.w,aBranchFrame.xyz);
  mat3 frame=mat3(branchCulmRotate(vec3(1.,0.,0.)),branchCulmRotate(vec3(0.,1.,0.)),branchCulmRotate(vec3(0.,0.,1.)));
  vec4 dots;float fifth;culmCurveDots(frame,tip,int(aBranchShape.w+.5),dots,fifth);
  offset=forestCurvedOffset(tip,aBranchRoot.w,aBranchFrame.w,aBranchFrame.xyz,dots,fifth);
  derivative=forestCurvedDerivative(tip,aBranchRoot.w,aBranchFrame.w,aBranchFrame.xyz,dots,fifth);
 }
 vec3 branchSecondary(){return forestBranchSecondary(aBranchRoot.xyz);}
 vec3 branchWindPoint(vec3 p){
  vec3 offset,derivative;branchCulmState(offset,derivative);
  vec3 v=windRotate(p-aBranchAnchor.xyz,aBranchFrame.xyz,derivative);
  float u=min(length(v)/aBranchAnchor.w,1.6);
  return aBranchAnchor.xyz+offset+v+branchSecondary()*u*u;
 }
 vec3 branchWindNormal(vec3 p,vec3 n){
  vec3 offset,derivative;branchCulmState(offset,derivative);
  vec3 v=windRotate(p-aBranchAnchor.xyz,aBranchFrame.xyz,derivative);
  n=windRotate(n,aBranchFrame.xyz,derivative);
  vec3 gradient=length(v)<aBranchAnchor.w*1.6?2.*v/(aBranchAnchor.w*aBranchAnchor.w):vec3(0.);
  vec3 secondary=branchSecondary();
  return normalize(n-gradient*(dot(secondary,n)/max(.6,1.+dot(gradient,secondary))));
 }`;
 const deform=(shader:T.WebGLProgramParametersWithUniforms,leaf=false)=>{
  shader.uniforms.uWindTime=time;shader.uniforms.uWindStrength=strength;shader.uniforms.uCulmCurves=curveUniform;
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\n'+branchWind+(leaf?LEAF_WIND_GLSL:''))
   .replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
    #ifdef USE_INSTANCING
    objectNormal=normalize(windToLocal(instanceMatrix,branchWindNormal((instanceMatrix*vec4(${leaf?'leafHingePoint(position,instanceMatrix,aBranchRoot.xyz)':'position'},1.)).xyz,normalize(mat3(instanceMatrix)*${leaf?'leafHingeRotate(objectNormal,instanceMatrix,aBranchRoot.xyz)':'objectNormal'}))));
    #else
    objectNormal=branchWindNormal(position,objectNormal);
    #endif`)
   .replace('#include <begin_vertex>',`#include <begin_vertex>
    #ifdef USE_INSTANCING
    ${leaf?'transformed=leafHingePoint(transformed,instanceMatrix,aBranchRoot.xyz);':''}
    transformed+=windToLocal(instanceMatrix,branchWindPoint((instanceMatrix*vec4(transformed,1.)).xyz)-(instanceMatrix*vec4(transformed,1.)).xyz);
    #else
    transformed=branchWindPoint(transformed);
    #endif`);
 };
 const setBindings=(geometry:T.BufferGeometry,instance:boolean,index=0)=>{
  for(const [name,key] of [['aBranchRoot','root'],['aBranchFrame','frame'],['aBranchAnchor','anchor'],['aBranchShape','shape']] as const){
   const values=instance?bindings.flatMap(b=>b[key]):Array.from({length:geometry.attributes.position.count},()=>bindings[index][key]).flat();
   geometry.setAttribute(name,instance?new T.InstancedBufferAttribute(new Float32Array(values),4):new T.Float32BufferAttribute(values,4));
  }
 };
 for(const type of ['Branches','Leaves']) {
  const source=prototype.getObjectByName(type) as T.Mesh;
  if(!source?.geometry)throw new Error('PORCH_BAMBOO_ASSET_INVALID');
  const material=(source.material as T.MeshStandardMaterial).clone();material.envMapIntensity=.55;
  if(type==='Leaves'){material.side=T.DoubleSide;material.roughness=.73;}
  material.onBeforeCompile=shader=>{deform(shader,type==='Leaves');if(type==='Leaves')addLeafLight(shader,night);};
  material.customProgramCacheKey=()=>`porch-weather-${type}-v3`;
  const geometry=source.geometry.clone().applyMatrix4(source.matrixWorld);if(type==='Leaves')addLeafHinges(geometry,20);setBindings(geometry,true);
  const mesh=new T.InstancedMesh(geometry,material,placements.length),dummy=new T.Object3D();
  placements.forEach(({p,s,r,rx,rz},i)=>{dummy.position.set(...p as [number,number,number]);dummy.scale.setScalar(s);dummy.rotation.set(rx,r,rz);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);});
  const depth=new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking,side:T.DoubleSide});depth.onBeforeCompile=shader=>deform(shader,type==='Leaves');
  mesh.customDepthMaterial=depth;mesh.castShadow=true;mesh.receiveShadow=true;mesh.name=`Porch_draping_${type}`;
  mesh.computeBoundingSphere();if(mesh.boundingSphere)mesh.boundingSphere.radius+=2.6;scene.add(mesh);
 }
 const branchMaterial=new T.MeshStandardMaterial({color:0x596443,roughness:.91});
 const connectorGeometry:T.BufferGeometry[]=[];
 for(let index=0;index<bindings.length;index++){
  const {center:start,attachment}=bindings[index],middle=start.clone().lerp(attachment,.55);middle.y+=.55;
  const geometry=new T.TubeGeometry(new T.CatmullRomCurve3([start,middle,attachment]),20,.023,5,false);
  setBindings(geometry,false,index);connectorGeometry.push(geometry);
 }
 branchMaterial.onBeforeCompile=shader=>deform(shader);branchMaterial.customProgramCacheKey=()=> 'connected-weather-branches-v3';
 const branch=new T.Mesh(mergeGeometries(connectorGeometry),branchMaterial);
 connectorGeometry.forEach(g=>g.dispose());
 branch.customDepthMaterial=new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking});branch.customDepthMaterial.onBeforeCompile=shader=>deform(shader);
 branch.geometry.computeBoundingSphere();if(branch.geometry.boundingSphere)branch.geometry.boundingSphere.radius+=2.6;
 branch.name='Arching_bamboo_branches';branch.castShadow=true;branch.receiveShadow=true;scene.add(branch);
}
