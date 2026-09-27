import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {register} from 'node:module';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {MeshoptEncoder} from 'meshoptimizer/encoder';
import {MeshoptSimplifier} from 'meshoptimizer/simplifier';
import {createInteriorDetails} from '../src/components/scene/interior-details.ts';

register('./scene-module-loader.mjs',import.meta.url);
const {createWeather}=await import('../src/components/scene/weather.ts');
const {createWeatherState}=await import('../src/components/scene/weather-state.ts');
const {stabilizeHouseSurfaces}=await import('../src/components/scene/house-surfaces.ts');

// Run with node --experimental-strip-types scripts/generate-house-lod.mjs.
// Index-only LODs reuse the source UVs, normals, materials and textures.
const input=readFileSync(new URL('../public/models/architecture.glb',import.meta.url));
const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder),texture=new T.Texture();
loader.register(()=>({name:'CPU_GEOMETRY_ONLY',loadTexture:()=>Promise.resolve(texture)}));
const house=(await loader.parseAsync(input.buffer.slice(input.byteOffset,input.byteOffset+input.byteLength),'')).scene;
const scene=new T.Scene();scene.add(house);stabilizeHouseSurfaces(house);
const weather=createWeather(scene,house,new T.PerspectiveCamera(),true,createWeatherState({value:0},{value:0}).uniforms);
house.updateMatrixWorld(true);createInteriorDetails(house).setHidden(true);
await MeshoptSimplifier.ready;await MeshoptEncoder.ready;
const entries=[],chunks=[],point=new T.Vector3();let offset=0;
house.traverseVisible(object=>{
 if(!(object instanceof T.Mesh)||!object.geometry.index||object.geometry.index.count<6000)return;
 const geometry=object.geometry,source=geometry.attributes.position;
 const positions=new Float32Array(source.count*3);
 for(let i=0;i<source.count;i++){
  point.fromBufferAttribute(source,i).applyMatrix4(object.matrixWorld);point.toArray(positions,i*3);
 }
 const indices=Uint32Array.from(geometry.index.array),exposure=geometry.attributes.rainExposure,ingress=geometry.attributes.rainIngress;
 const attributes=new Float32Array(source.count*4);
 for(let i=0;i<source.count;i++)attributes.set([exposure?.getX(i)??1,ingress?.getX(i)??0,ingress?.getY(i)??0,ingress?.getZ(i)??0],i*4);
 for(const [level,ratio,budget] of [['balanced',.12,.02],['lean',.055,.05]]){
  // Preserve baked rain exposure as well as shape. Flattening refined floors
  // without these attributes would change where rain enters the house.
  const [lod,error]=MeshoptSimplifier.simplifyWithAttributes(indices,positions,3,attributes,4,[1,1,1,1],null,Math.floor(indices.length*ratio/3)*3,budget,['ErrorAbsolute','Prune']);
  if(!lod.length||lod.length>indices.length*.85)continue;
  assert.ok(Number.isFinite(error)&&error<=budget+.000001,`${object.name}: ${error}`);
  // Optimize the post-transform cache, then undo only its vertex remapping so
  // both levels can keep sharing the original attributes and weather data.
  const ordered=Uint32Array.from(lod),[remap]=MeshoptEncoder.reorderMesh(ordered,true,false),inverse=new Uint32Array(remap.length);
  for(let i=0;i<remap.length;i++)if(remap[i]!==0xffffffff)inverse[remap[i]]=i;
  for(let i=0;i<ordered.length;i++)ordered[i]=inverse[ordered[i]];
  const compressed=MeshoptEncoder.encodeIndexBuffer(new Uint8Array(ordered.buffer),ordered.length,4);
  chunks.push(compressed);
  entries.push({name:object.name,level,sourceVertices:source.count,sourceIndices:indices.length,count:ordered.length,error,offset,bytes:compressed.length});
  offset+=compressed.length;
 }
});
const binary=Buffer.concat(chunks),hash=value=>createHash('sha256').update(value).digest('hex');
const metadata=JSON.stringify({sourceHash:hash(input),hash:hash(binary),bytes:binary.length,entries})+'\n';
const binaryPath=new URL('../public/models/architecture-lod.bin',import.meta.url);
const metadataPath=new URL('../src/components/scene/generated/house-lod.json',import.meta.url);
if(process.argv.includes('--check')){
 assert.deepEqual(readFileSync(binaryPath),binary,'Regenerate the house LOD after changing architecture.glb');
 assert.equal(readFileSync(metadataPath,'utf8'),metadata);
}else {writeFileSync(binaryPath,binary);writeFileSync(metadataPath,metadata);}
for(const level of ['balanced','lean']){
 const meshes=entries.filter(entry=>entry.level===level);
 console.log(`House ${level}: ${meshes.reduce((sum,item)=>sum+item.sourceIndices/3,0)} -> ${meshes.reduce((sum,item)=>sum+item.count/3,0)} triangles in ${meshes.length} meshes`);
}
console.log(`House LOD compressed indices: ${binary.length} bytes`);
weather.dispose();texture.dispose();
