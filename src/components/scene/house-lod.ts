import * as T from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import metadata from './generated/house-lod.json';
import { createInteriorDetails } from './interior-details';

export async function decodeHouseLod(bytes:Uint8Array){
 if(bytes.length!==metadata.bytes)throw new Error('HOUSE_LOD_ASSET_MISMATCH');
 await MeshoptDecoder.ready;
 const indices=new Map<string,T.BufferAttribute>();
 for(const entry of metadata.entries){
  const array=new Uint32Array(entry.count);
  MeshoptDecoder.decodeIndexBuffer(new Uint8Array(array.buffer),entry.count,4,bytes.subarray(entry.offset,entry.offset+entry.bytes));
  if(array.some(index=>index>=entry.sourceVertices))throw new Error('HOUSE_LOD_INDEX_INVALID');
  indices.set(`${entry.level}:${entry.name}`,new T.BufferAttribute(array,1));
 }
 return indices;
}

export async function loadHouseLod(signal:AbortSignal){
 signal.throwIfAborted();
 const download=new AbortController(),cancel=()=>download.abort(signal.reason);
 signal.addEventListener('abort',cancel,{once:true});
 const timeout=setTimeout(()=>download.abort(new Error('HOUSE_LOD_TIMEOUT')),5000);
 try{
  const response=await fetch(`/models/architecture-lod.bin?v=${metadata.hash}`,{signal:download.signal});
  if(!response.ok)throw new Error(`HOUSE_LOD_HTTP_${response.status}`);
  const indices=await decodeHouseLod(new Uint8Array(await response.arrayBuffer()));
  signal.throwIfAborted();return indices;
 }catch(error){
  signal.throwIfAborted();
  // An optional optimization must never prevent the original house loading.
  console.warn('Distant house detail unavailable; using the original model.',error);
  return new Map<string,T.BufferAttribute>();
 }finally {clearTimeout(timeout);signal.removeEventListener('abort',cancel);}
}

export function createHouseLod(house:T.Group,indices:ReadonlyMap<string,T.BufferAttribute>){
 const root=new T.LOD(),decisionCamera=new T.PerspectiveCamera();
 root.name='House_distance_detail';root.autoUpdate=false;
 // Clone only after weather/material setup, then share its attributes and hooks.
 if(indices.size)for(const [level,distance] of [['balanced',24],['lean',Infinity]] as const){
  const far=house.clone(true);far.name=`House_distant_${level}`;
  // Only distant copies omit furnishings. The original stays complete for
  // nearby views, zooming in and entering any room.
  createInteriorDetails(far).setHidden(true);
  far.traverse(object=>{
   if(!(object instanceof T.Mesh))return;
   const index=indices.get(`${level}:${object.name}`),entry=metadata.entries.find(item=>item.name===object.name&&item.level===level);
   const source:T.BufferGeometry=object.geometry;
   // Rain may refine some surfaces. Keep those exact meshes rather than apply
   // indices authored for a different topology.
   if(!index||!entry||source.groups.length||source.attributes.position.count!==entry.sourceVertices||source.index?.count!==entry.sourceIndices)return;
   const geometry=new T.BufferGeometry();
   for(const [name,attribute] of Object.entries(source.attributes))geometry.setAttribute(name,attribute);
   geometry.setIndex(index);geometry.boundingBox=source.boundingBox;geometry.boundingSphere=source.boundingSphere;
   object.geometry=geometry;
  });
  far.visible=false;root.addLevel(far,distance,.2);
 }
 root.addLevel(house,0);
 return {
  root,
  get distant(){return root.getCurrentLevel()>0;},
  update(camera:T.PerspectiveCamera,enabled:boolean,lean=false){
   const previous=root.getCurrentLevel();
   if(root.levels.length>1)root.levels[1].distance=lean?16:24;
   if(root.levels.length>2)root.levels[2].distance=lean?24:Infinity;
   camera.updateWorldMatrix(true,false);root.updateWorldMatrix(true,false);
   decisionCamera.matrixWorld.copy(camera.matrixWorld);
   // Zooming in restores detail at the same distance without changing the
   // visible camera. Three's native hysteresis stabilizes distance crossings.
   decisionCamera.zoom=enabled?Math.tan(T.MathUtils.degToRad(60/2))/Math.tan(T.MathUtils.degToRad(camera.getEffectiveFOV()/2)):Infinity;
   root.update(decisionCamera);
   return previous!==root.getCurrentLevel();
  },
 };
}
