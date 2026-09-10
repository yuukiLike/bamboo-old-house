import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FOREST_WIND_GLSL } from './wind';
import { groundHeight, treePositions, porchBranchPlacements } from './config';

const windCommon=FOREST_WIND_GLSL+`
vec3 sway(vec3 p,mat4 im){
 float strength=pow(max(p.y,0.)/14.,2.)*length(im[0].xyz);
 return p+windToLocal(im,forestWindOffset(im[3].xyz,strength));
}`;
export function addBamboo(scene:T.Scene,prototype:T.Group,time:{value:number},mobile:boolean,night:{value:number}){
 const trees=treePositions();const dummy=new T.Object3D(),c=new T.Color();
 const bases=new Map<string,T.BufferGeometry>();
 for(let variant=0;variant<4;variant++)for(const level of [0,1]){
  const positions=trees.filter(p=>p.variant===variant&&((Math.abs(p.x)>16||p.z<-9||p.z>34)?1:0)===level);
  for(const type of ['Stalk','Leaves']){
   const source=prototype.getObjectByName(`${type}_${variant}`) as T.Mesh;
   if(!source?.geometry)throw new Error('BAMBOO_ASSET_INVALID');
   const key=`${type}_${variant}`;
   let base=bases.get(key);if(!base){base=source.geometry.clone().applyMatrix4(source.matrixWorld);bases.set(key,base);}
   // LOD index buffers share the transformed vertex attributes. Identical
   // stalk geometry is uploaded once instead of once for each distance band.
   const geometry=type==='Stalk'?base:new T.BufferGeometry();
   if(type==='Leaves'){for(const [name,attribute] of Object.entries(base.attributes))geometry.setAttribute(name,attribute);geometry.setIndex(base.index);}
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
   material.onBeforeCompile=s=>{
    s.uniforms.uWindTime=time;s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\n'+windCommon).replace('#include <begin_vertex>',`#include <begin_vertex>
     #ifdef USE_INSTANCING
     transformed=sway(transformed,instanceMatrix);
     #endif
    `);
    if(type==='Leaves')addLeafLight(s,night);
   };
   material.customProgramCacheKey=()=>`bamboo-${type}`;
   const mesh=new T.InstancedMesh(geometry,material,positions.length);mesh.name=`${type}_${variant}_lod${level}`;
   positions.forEach((p,i)=>{dummy.position.set(p.x,groundHeight(p.x,p.z),p.z);dummy.rotation.set(p.leanX,p.rotation,p.leanZ);dummy.scale.setScalar(p.s);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);c.setHSL(type==='Leaves'?.27:.23,type==='Leaves'?.15:.08,.72+(i%7)*.024);mesh.setColorAt(i,c);});
   mesh.castShadow=level===0;mesh.receiveShadow=true;
   const depth=new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking,side:T.DoubleSide});depth.onBeforeCompile=s=>{s.uniforms.uWindTime=time;s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\n'+windCommon).replace('#include <begin_vertex>','#include <begin_vertex>\n#ifdef USE_INSTANCING\ntransformed=sway(transformed,instanceMatrix);\n#endif');};mesh.customDepthMaterial=depth;
   mesh.computeBoundingSphere();scene.add(mesh);
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

/** The hanging shoots stay connected to established bamboo at the court edge. */
export function addPorchBamboo(scene:T.Scene,prototype:T.Group,time:{value:number},night:{value:number},culms:T.Group) {
 prototype.updateMatrixWorld(true);
 const trees=treePositions(),placements=porchBranchPlacements(trees);
 const sourceBranch=prototype.getObjectByName('Branches')!;
 const attachmentY=Number(sourceBranch.userData.attachment_local_y)||4.217302302122117;
 const ringCache=new Map<number,T.Vector3[]>();
 const bindings=placements.map(({tree:treeIndex,height})=>{
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
  const localHeight=(height-groundHeight(tree.x,tree.z))/tree.s;
  const center=ringCache.get(tree.variant)!.reduce((a,b)=>Math.abs(a.y-localHeight)<Math.abs(b.y-localHeight)?a:b);
  const transform=new T.Object3D();transform.position.set(tree.x,groundHeight(tree.x,tree.z),tree.z);transform.rotation.set(tree.leanX,tree.rotation,tree.leanZ);transform.scale.setScalar(tree.s);transform.updateMatrix();
  return {center:center.clone().applyMatrix4(transform.matrix),windRoot:[tree.x,groundHeight(tree.x,tree.z),tree.z,(center.y/14)**2*tree.s]};
 });
 for(const type of ['Branches','Leaves']) {
  const source=prototype.getObjectByName(type) as T.Mesh;
  if(!source?.geometry)throw new Error('PORCH_BAMBOO_ASSET_INVALID');
  const material=(source.material as T.MeshStandardMaterial).clone();
  material.envMapIntensity=.55;
  if(type==='Leaves'){material.side=T.DoubleSide;material.roughness=.73;}
  const wind=FOREST_WIND_GLSL+`attribute vec4 aBranchRoot;\nvec3 porchSway(vec3 p,mat4 im){
   float weight=pow(clamp(1.-p.y/${attachmentY.toFixed(8)},0.,1.),1.3);
   float phase=im[3].x*.7+im[3].z*.4;
   p+=windToLocal(im,forestWindOffset(aBranchRoot.xyz,aBranchRoot.w));
   float gust=forestGust(aBranchRoot.xyz);
   p.x+=sin(uWindTime*1.45+phase+p.y*.9)*(.025+gust*.08)*weight;
   p.z+=sin(uWindTime*1.13+phase+p.y*.7)*(.035+gust*.10)*weight; return p;}`;
  const deform=(shader:T.WebGLProgramParametersWithUniforms)=>{
   shader.uniforms.uWindTime=time;
   shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\n'+wind)
    .replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed=porchSway(transformed,instanceMatrix);');
  };
  material.onBeforeCompile=shader=>{deform(shader);if(type==='Leaves')addLeafLight(shader,night);};
  material.customProgramCacheKey=()=>`porch-${type}`;
  const geometry=source.geometry.clone().applyMatrix4(source.matrixWorld);
  geometry.setAttribute('aBranchRoot',new T.InstancedBufferAttribute(new Float32Array(bindings.flatMap(b=>b.windRoot)),4));
  const mesh=new T.InstancedMesh(geometry,material,placements.length);
  const dummy=new T.Object3D();
  placements.forEach(({p,s,r,rx,rz},i)=>{dummy.position.set(...p as [number,number,number]);dummy.scale.setScalar(s);dummy.rotation.set(rx,r,rz);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);});
  const depth=new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking,side:T.DoubleSide});depth.onBeforeCompile=deform;
  mesh.customDepthMaterial=depth;mesh.castShadow=true;mesh.receiveShadow=true;mesh.name=`Porch_draping_${type}`;
  mesh.computeBoundingSphere();if(mesh.boundingSphere)mesh.boundingSphere.radius+=1.1;scene.add(mesh);
 }
 const branchMaterial=new T.MeshStandardMaterial({color:0x596443,roughness:.91});
 const connectorGeometry:T.BufferGeometry[]=[];
 for(let index=0;index<placements.length;index++){
  const {p,s,r,rx,rz}=placements[index];
  const start=bindings[index].center;
  const transform=new T.Object3D();transform.position.fromArray(p);transform.rotation.set(rx,r,rz);transform.scale.setScalar(s);transform.updateMatrix();
  const attachment=new T.Vector3(.98,attachmentY,-.05).applyMatrix4(transform.matrix);
  const middle=start.clone().lerp(attachment,.55);middle.y+=.55;
  const geometry=new T.TubeGeometry(new T.CatmullRomCurve3([start,middle,attachment]),20,.023,5,false);
  geometry.setAttribute('aBranchRoot',new T.Float32BufferAttribute(Array.from({length:geometry.attributes.position.count},()=>bindings[index].windRoot).flat(),4));
  connectorGeometry.push(geometry);
 }
 const deformConnector=(shader:T.WebGLProgramParametersWithUniforms)=>{
  shader.uniforms.uWindTime=time;
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\n'+FOREST_WIND_GLSL+'\nattribute vec4 aBranchRoot;')
   .replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed+=forestWindOffset(aBranchRoot.xyz,aBranchRoot.w);');
 };
 branchMaterial.onBeforeCompile=deformConnector;
 branchMaterial.customProgramCacheKey=()=> 'connected-wind-branches';
 const branch=new T.Mesh(mergeGeometries(connectorGeometry),branchMaterial);
 connectorGeometry.forEach(g=>g.dispose());
 branch.customDepthMaterial=new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking});branch.customDepthMaterial.onBeforeCompile=deformConnector;
 branch.name='Arching_bamboo_branches';branch.castShadow=true;branch.receiveShadow=true;scene.add(branch);
}
