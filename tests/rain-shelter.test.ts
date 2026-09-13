import assert from 'node:assert/strict';
import test from 'node:test';
import * as T from 'three';
const {createRainShelter}:typeof import('../src/components/scene/rain-shelter')=
 await import(new URL('../src/components/scene/rain-shelter.ts',import.meta.url).href);

function room(closed:boolean){
 const house=new T.Group(),roof=new T.Mesh(new T.BoxGeometry(4,.1,4));roof.position.y=3;house.add(roof);
 if(closed){const glass=new T.Mesh(new T.BoxGeometry(.01,3,4));glass.position.set(-2,1.5,0);house.add(glass);}
 house.updateMatrixWorld(true);
 const shelter=createRainShelter(house,(x,z)=>Math.abs(x)<=2&&Math.abs(z)<=2?3.05:-Infinity);
 return shelter;
}
await test('nearest-first traversal preserves open eaves and thin closed-window rain barriers',()=>{
 const open=room(false),closed=room(true);
 const exposed=open.exposure(-1.8,.1,0);
 assert.ok(exposed.every(amount=>amount>0));
 assert.deepEqual(closed.exposure(-1.8,.1,0),[0,0,0]);
 // A downward-facing surface and an outdoor point never receive indoor ingress.
 assert.deepEqual(open.exposure(-1.8,.1,0,0,-1,0),[0,0,0]);
 assert.deepEqual(open.exposure(-4,.1,0),[0,0,0]);
 // Repeated rays do not retain pending nodes from a previous early hit.
 for(let i=0;i<20;i++){
  closed.exposure(-1.8,.1,i%2?.4:-.4);
  assert.deepEqual(closed.exposure(-1.8,.1,0),[0,0,0]);
  assert.deepEqual(open.exposure(-1.8,.1,0),exposed);
 }
 open.dispose();closed.dispose();
});

await test('floor refinement shares edge vertices while retaining surfaces, UVs and material groups',async()=>{
 const {refineRainFloor}:typeof import('../src/components/scene/rain-shelter')=
  await import(new URL('../src/components/scene/rain-shelter.ts',import.meta.url).href);
 const source=new T.PlaneGeometry(2,2);source.rotateX(-Math.PI/2);source.addGroup(0,3,0);source.addGroup(3,3,1);source.setDrawRange(3,3);
 const refined=refineRainFloor(source,new T.Matrix4()),index=refined.index!,position=refined.attributes.position,uv=refined.attributes.uv;
 assert.equal(index.count,768);assert.equal(position.count,145);assert.deepEqual(refined.groups,[{start:0,count:384,materialIndex:0},{start:384,count:384,materialIndex:1}]);
 assert.deepEqual(refined.drawRange,{start:384,count:384});
 let area=0;const a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),triangle=new T.Triangle(a,b,c);
 for(let i=0;i<index.count;i+=3){a.fromBufferAttribute(position,index.getX(i));b.fromBufferAttribute(position,index.getX(i+1));c.fromBufferAttribute(position,index.getX(i+2));area+=triangle.getArea();}
 assert.ok(Math.abs(area-4)<1e-10);
 for(let i=0;i<position.count;i++){assert.ok(Math.abs(uv.getX(i)-(position.getX(i)+1)/2)<1e-7);assert.ok(Math.abs(uv.getY(i)-(1-position.getZ(i))/2)<1e-7);}
 assert.equal(source.attributes.position.count,4);refined.dispose();source.dispose();
});
