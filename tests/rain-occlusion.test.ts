import assert from 'node:assert/strict';
import test from 'node:test';
import * as T from 'three';

const {createRainOcclusion}:typeof import('../src/components/scene/rain-occlusion')=
 await import(new URL('../src/components/scene/rain-occlusion.ts',import.meta.url).href);
const directions=[-.80,.38,1.32].map(angle=>new T.Vector3(-Math.cos(angle)*.67,1,-Math.sin(angle)*.67));

// Independent oracle: every world-space Float32 triangle, with no broad
// phase. This is intentionally slow and used only for bounded fixtures.
function bruteForce(meshes:T.Mesh[],direction:T.Vector3,origin:T.Vector3){
 const ray=new T.Ray(origin,direction.clone().normalize()),hit=new T.Vector3();
 for(const mesh of meshes){
  const geometry=mesh.geometry.clone().applyMatrix4(mesh.matrixWorld),positions=geometry.attributes.position,index=geometry.index;
  const points=[new T.Vector3(),new T.Vector3(),new T.Vector3()];
  for(let i=0;i<(index?.count??positions.count);i+=3){
   points.forEach((point,j)=>point.fromBufferAttribute(positions,index?index.getX(i+j):i+j));
   if(ray.intersectTriangle(points[0],points[1],points[2],false,hit)){
    const distance=hit.distanceToSquared(origin);
    if(distance>.000009&&distance<144){geometry.dispose();return true;}
   }
  }
  geometry.dispose();
 }
 return false;
}

await test('directional broad phase agrees with brute force through transformed walls and thin gaps',()=>{
 const group=new T.Group();
 group.position.set(-2.75,.35,1.125);group.rotation.y=.37;group.scale.set(1.2,.8,.7);
 for(const x of [-2,-.505,.505,2]){
  const mesh=new T.Mesh(new T.BoxGeometry(.99,3,.0125),new T.MeshBasicMaterial());
  mesh.position.set(x,1.5,0);group.add(mesh);
 }
 const roof=new T.Mesh(new T.PlaneGeometry(8,6),new T.MeshBasicMaterial());
 roof.rotation.x=Math.PI/2;roof.position.y=3;group.add(roof);group.updateMatrixWorld(true);
 const meshes=group.children as T.Mesh[],occlusion=createRainOcclusion(meshes,directions);
 let seed=71;
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 let hits=0,misses=0;
 for(let i=0;i<1800;i++){
  const origin=new T.Vector3(random()*14-8,random()*5-1,random()*12-5),sector=i%3;
  const expected=bruteForce(meshes,directions[sector],origin);
  assert.equal(occlusion.blocked(origin.x,origin.y,origin.z,sector),expected,`ray ${i}`);
  if(expected)hits++;else misses++;
 }
 assert.ok(hits>100&&misses>100);
 occlusion.dispose();
});

await test('cell borders, back faces, small apertures and the original ray limits remain exact',()=>{
 const direction=new T.Vector3(0,1,0),directions=[direction];
 const left=new T.Mesh(new T.PlaneGeometry(1,1),new T.MeshBasicMaterial());
 left.rotation.x=Math.PI/2;left.position.set(-.505,0,0);left.updateMatrixWorld(true);
 const right=left.clone();right.position.x=.505;right.updateMatrixWorld(true);
 const occlusion=createRainOcclusion([left,right],directions);
 for(const x of [-1.005,-.875,-.125,-.005001,-.004999,0,.004999,.005001,.125,.875,1.005]){
  for(const y of [-12.001,-12,-11.999,-.003001,-.003,-.002999,.1]){
   const origin=new T.Vector3(x,y,.125);
   assert.equal(occlusion.blocked(x,y,.125,0),bruteForce([left,right],direction,origin),`origin ${origin.toArray().join(',')}`);
  }
 }
 assert.equal(occlusion.blocked(0,-1,0,0),false,'the 1 cm aperture stays open');
 assert.equal(occlusion.blocked(.125,-1,0,0),true,'the back face still blocks rain');
 occlusion.dispose();
 assert.equal(occlusion.blocked(.125,-1,0,0),false);
 assert.equal(createRainOcclusion([],directions).blocked(0,0,0,0),false);
});
