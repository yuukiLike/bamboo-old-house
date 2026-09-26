import assert from 'node:assert/strict';
import test from 'node:test';
import * as T from 'three';
const {createInstanceWind,forestWindBend,forestWindTip,forestBranchSecondary}:typeof import('../src/components/scene/wind')=
 await import(new URL('../src/components/scene/wind.ts',import.meta.url).href);

function branch(){
 const scene=new T.Scene(),geometry=new T.BoxGeometry(),material=new T.MeshStandardMaterial();
 const curve:[[number,number,number],[number,number,number],[number,number,number],[number,number,number],[number,number,number]]=[[.3,14,-.2],[.1,.01,-.12],[-.15,.002,.08],[.02,0,.02],[-.01,0,.005]];
 material.userData.instanceWind={height:14,branch:true,curves:[curve]};
 for(const [name,width] of [['tangent',4],['aLeafPivot',3],['aLeafTip',3]] as const)geometry.setAttribute(name,new T.BufferAttribute(new Float32Array(geometry.attributes.position.count*width),width));
 const rotation=new T.Quaternion().setFromEuler(new T.Euler(.07,.8,-.04)),axis=new T.Vector3(0,1,0).applyQuaternion(rotation);
 geometry.setAttribute('aBranchRoot',new T.InstancedBufferAttribute(new Float32Array([-3,0,7,8,14,0,-5,4]),4));
 geometry.setAttribute('aBranchFrame',new T.InstancedBufferAttribute(new Float32Array([...axis.toArray(),16,...axis.toArray(),9]),4));
 geometry.setAttribute('aBranchAnchor',new T.InstancedBufferAttribute(new Float32Array(8),4));
 geometry.setAttribute('aBranchShape',new T.InstancedBufferAttribute(new Float32Array([rotation.x,rotation.y,rotation.z,0,rotation.x,rotation.y,rotation.z,0]),4));
 const mesh=new T.InstancedMesh(geometry,material,2);mesh.customDepthMaterial=new T.MeshDepthMaterial();scene.add(mesh);
 return {scene,mesh,material,geometry,curve};
}
function close(actual:number,expected:number){assert.ok(Math.abs(actual-expected)<1e-6,`${actual} != ${expected}`);}

await test('bound branch cache preserves the analytic parent displacement, derivative and secondary motion within Float32 precision',()=>{
 const {scene,mesh,geometry,curve}=branch(),cache=createInstanceWind(scene,16);
 const attr=mesh.geometry.getAttribute('aInstanceWind') as T.InstancedBufferAttribute,secondary=mesh.geometry.getAttribute('aBranchWindSecondary');
 assert.equal(attr.itemSize,4);
 assert.equal(Object.values(mesh.geometry.attributes).length+4,16);
 const root=geometry.getAttribute('aBranchRoot'),frame=geometry.getAttribute('aBranchFrame'),shape=geometry.getAttribute('aBranchShape');
 for(const time of [0,3.4,5.2,18.39,18.4,24,55.3,183.9])for(const wind of [0,.28,.7,1]){
  cache.update(time,wind);
  for(let i=0;i<mesh.count;i++){
   const axis:[number,number,number]=[frame.getX(i),frame.getY(i),frame.getZ(i)],h=frame.getW(i),u=Math.min(1.12,root.getW(i)/h);
   const q=new T.Quaternion(shape.getX(i),shape.getY(i),shape.getZ(i),0);q.w=Math.sqrt(1-q.x*q.x-q.y*q.y-q.z*q.z);
   const worldCurve=curve.map(c=>new T.Vector3(...c).applyQuaternion(q).multiplyScalar(h/14).toArray());
   const expected=forestWindBend(time,root.getX(i),root.getZ(i),root.getW(i),h,wind,axis,worldCurve);
   const force=[attr.getX(i),0,attr.getY(i)],along=force.reduce((sum,v,k)=>sum+v*axis[k],0);
   for(let k=0;k<3;k++){
    const tip=force[k]-axis[k]*along;
    close(tip*u*u*(3-u)*.5-axis[k]*attr.getZ(i),expected.offset[k]);
    close(tip*(3*u-1.5*u*u)/h+axis[k]*attr.getW(i),expected.derivative[k]);
    close(secondary.array[i*3+k],forestBranchSecondary(time,root.getX(i),root.getZ(i),wind)[k]);
   }
  }
 }
 const version=attr.version;cache.update(183.9,1);assert.equal(attr.version,version,'paused state does not upload again');
 cache.dispose();assert.equal(mesh.geometry,geometry);assert.equal(geometry.hasAttribute('aInstanceWind'),false);
});

await test('attribute limits select full cache, root-only cache or analytic fallback for both beauty and shadows',()=>{
 for(const limit of [14,15,16]){
  const {scene,mesh,material}=branch(),originalKey=material.customProgramCacheKey();
  const cache=createInstanceWind(scene,limit);
  cache.update(4,.28);
  assert.equal(mesh.geometry.hasAttribute('aInstanceWind'),limit>=15);
  assert.equal(mesh.geometry.hasAttribute('aBranchWindSecondary'),limit>=16);
  for(const target of [material,mesh.customDepthMaterial!]){
   const shader={vertexShader:'void main(){}',fragmentShader:'',uniforms:{}} as T.WebGLProgramParametersWithUniforms;
   target.onBeforeCompile(shader,{} as T.WebGLRenderer);
   assert.equal(shader.vertexShader.includes('#define USE_CACHED_BRANCH_WIND'),limit===16);
   assert.equal(shader.vertexShader.includes('#define USE_CACHED_INSTANCE_WIND'),limit>=15);
  }
  cache.dispose();assert.equal(material.customProgramCacheKey(),originalKey);
 }
});

await test('visibility compaction refreshes root force for the new matrix order without modifying shared geometry',()=>{
 const scene=new T.Scene(),geometry=new T.BoxGeometry(),material=new T.MeshStandardMaterial();
 material.userData.instanceWind={height:14};
 const mesh=new T.InstancedMesh(geometry,material,2);scene.add(mesh);
 const cache=createInstanceWind(scene),attr=mesh.geometry.getAttribute('aInstanceWind');
 mesh.setMatrixAt(0,new T.Matrix4().makeTranslation(-20,0,10));mesh.instanceMatrix.needsUpdate=true;cache.update(4,.8);
 mesh.setMatrixAt(0,new T.Matrix4().makeTranslation(21,0,-11));mesh.instanceMatrix.needsUpdate=true;cache.update(4,.8);
 const expected=forestWindTip(4,21,-11,14,.8);close(attr.getX(0),expected[0]);close(attr.getY(0),expected[1]);
 assert.equal(geometry.hasAttribute('aInstanceWind'),false);cache.dispose();
});
