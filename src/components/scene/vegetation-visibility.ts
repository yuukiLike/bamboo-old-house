import * as T from 'three';

const groundDetails=new Set([
 'Fallen_bamboo_leaves','Curled_bamboo_leaf_litter','Small_margin_rosettes',
 'Flattened_rotten_logs_with_splintered_ends','Fine_bent_dry_grass_tufts',
 'Sparse_curled_dead_leaves_on_brittle_stems','Dense_interlaced_dry_grass_mat','Low_brittle_leafless_scrub',
 'Pine_needle_duff_along_descending_lane',
]);

// Global instance batches defeat Three's object frustum culling. Compact only
// non-shadow casters; real shadow casters use spatial batches so offscreen
// bamboo can still cast its shadow into the courtyard.
export function createVegetationVisibility(scene:T.Scene) {
 const vegetation:T.InstancedMesh[]=[];
 scene.updateMatrixWorld(true);
 scene.traverse(object=>{
  if(!(object instanceof T.InstancedMesh))return;
  // Nearby stones and meadow grass are already small shadow-casting batches.
  // Splitting them adds beauty + shadow draws with almost no geometry saved.
  if(!groundDetails.has(object.name)&&!/^(Stalk_|Leaves_|Bank_|Hillside_|Background_)/.test(object.name))return;
  // These static placements only use instance matrices/colors. Do not reorder
  // bound branches, particles or future batches with their own instance data.
  if(object.morphTexture||Object.values(object.geometry.attributes).some(attribute=>
   attribute instanceof T.InstancedBufferAttribute||
   (attribute instanceof T.InterleavedBufferAttribute&&attribute.data instanceof T.InstancedInterleavedBuffer)))return;
  vegetation.push(object);
 });
 const compactors:ReturnType<typeof compactInstances>[]=[];
 for(const mesh of vegetation) {
  const windMargin=/^(Stalk_|Leaves_)/.test(mesh.name)?2.6:groundDetails.has(mesh.name)?.05:.55;
  if(mesh.castShadow)splitShadowBatches(mesh,16,windMargin);
  else compactors.push(compactInstances(mesh,windMargin));
 }
 const frustum=new T.Frustum(),matrix=new T.Matrix4(),previous=new T.Matrix4();
 let initial=true;
 return {
  update(camera:T.Camera) {
   camera.updateMatrixWorld(true);
   matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
   if(!initial&&matrix.equals(previous))return;
   initial=false;previous.copy(matrix);frustum.setFromProjectionMatrix(matrix);
   for(const compact of compactors)compact(frustum);
  },
 };
}

function compactInstances(mesh:T.InstancedMesh,margin:number) {
 const count=mesh.count;
 const matrices=Float32Array.from(mesh.instanceMatrix.array.subarray(0,count*16));
 const colors=mesh.instanceColor?Float32Array.from(mesh.instanceColor.array.subarray(0,count*3)):null;
 const selected=new Int32Array(count),previous=new Int32Array(count).fill(-1);
 const matrix=new T.Matrix4(),sphere=new T.Sphere();
 mesh.geometry.computeBoundingSphere();
 const bounds:T.Sphere[]=[],cells=new Map<string,{box:T.Box3;indices:number[]}>();
 const radius=new T.Vector3(),cellSize=8;
 for(let i=0;i<count;i++) {
  matrix.fromArray(matrices,i*16).premultiply(mesh.matrixWorld);
  sphere.copy(mesh.geometry.boundingSphere!).applyMatrix4(matrix);sphere.radius+=margin;
  bounds.push(sphere.clone());
  const key=`${Math.floor(sphere.center.x/cellSize)}_${Math.floor(sphere.center.z/cellSize)}`;
  let cell=cells.get(key);
  if(!cell){cell={box:new T.Box3(),indices:[]};cells.set(key,cell);}
  cell.indices.push(i);radius.setScalar(sphere.radius);
  cell.box.expandByPoint(sphere.center.clone().sub(radius));cell.box.expandByPoint(sphere.center.clone().add(radius));
 }
 // Visibility is now exact per instance; the old whole-field sphere is unused.
 mesh.frustumCulled=false;
 mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);mesh.instanceColor?.setUsage(T.DynamicDrawUsage);
 let previousCount=-1;
 const visibleFlags=new Uint8Array(count);
 return (frustum:T.Frustum)=>{
  visibleFlags.fill(0);
  for(const cell of cells.values()){
   const visibility=boxVisibility(frustum,cell.box);
   if(visibility<0)continue;
   for(const index of cell.indices)if(visibility>0||frustum.intersectsSphere(bounds[index]))visibleFlags[index]=1;
  }
  let visible=0;
  // Source order keeps matrices, colors and root-based wind in agreement.
  for(let i=0;i<count;i++)if(visibleFlags[i])selected[visible++]=i;
  let first=0;
  while(first<visible&&first<previousCount&&selected[first]===previous[first])first++;
  let end=visible;
  while(end>first&&end<=previousCount&&selected[end-1]===previous[end-1])end--;
  previousCount=visible;mesh.count=visible;mesh.visible=visible>0;
  // Removing a suffix changes the draw count only. The remaining GPU slots
  // already contain the exact matrices and colors; no upload is needed.
  if(first===end)return;
  for(let i=first;i<end;i++) {
   const index=selected[i];previous[i]=index;
   for(let k=0;k<16;k++)mesh.instanceMatrix.array[i*16+k]=matrices[index*16+k];
   if(colors&&mesh.instanceColor)for(let k=0;k<3;k++)mesh.instanceColor.array[i*3+k]=colors[index*3+k];
  }
  // Retain pending ranges if another camera update happens before a draw.
  // Three merges overlapping ranges and clears them after the actual upload.
  mesh.instanceMatrix.addUpdateRange(first*16,(end-first)*16);mesh.instanceMatrix.needsUpdate=true;
  if(mesh.instanceColor){mesh.instanceColor.addUpdateRange(first*3,(end-first)*3);mesh.instanceColor.needsUpdate=true;}
 };
}

// -1 outside, 0 crossing a plane, 1 fully inside. Every cell bounds complete
// world-space instance spheres, including wind, so only boundary cells need
// the original per-instance test. No distance threshold or delayed refresh.
function boxVisibility(frustum:T.Frustum,box:T.Box3){
 let inside=true;
 for(const plane of frustum.planes){
  const {x,y,z}=plane.normal;
  const far=x*(x>=0?box.max.x:box.min.x)+y*(y>=0?box.max.y:box.min.y)+z*(z>=0?box.max.z:box.min.z)+plane.constant;
  if(far<0)return -1;
  const near=x*(x>=0?box.min.x:box.max.x)+y*(y>=0?box.min.y:box.max.y)+z*(z>=0?box.min.z:box.max.z)+plane.constant;
  if(near<0)inside=false;
 }
 return inside?1:0;
}

function splitShadowBatches(source:T.InstancedMesh,cellSize:number,margin:number) {
 const parent=source.parent;if(!parent)return;
 const cells=new Map<string,number[]>(),matrix=new T.Matrix4(),position=new T.Vector3();
 for(let i=0;i<source.count;i++) {
  source.getMatrixAt(i,matrix);position.setFromMatrixPosition(matrix);
  const key=`${Math.floor(position.x/cellSize)}_${Math.floor(position.z/cellSize)}`;
  const indices=cells.get(key);if(indices)indices.push(i);else cells.set(key,[i]);
 }
 for(const [key,indices] of cells) {
  // Buffers and materials are shared across cells, including the animated
  // custom depth material. The light's own frustum culls these batches.
  const batch=new T.InstancedMesh(source.geometry,source.material,indices.length);
  batch.name=source.name+'_cell_'+key;batch.position.copy(source.position);
  batch.quaternion.copy(source.quaternion);batch.scale.copy(source.scale);
  batch.castShadow=source.castShadow;batch.receiveShadow=source.receiveShadow;
  batch.customDepthMaterial=source.customDepthMaterial;batch.customDistanceMaterial=source.customDistanceMaterial;
  const color=new T.Color();
  indices.forEach((index,i)=>{source.getMatrixAt(index,matrix);batch.setMatrixAt(i,matrix);if(source.instanceColor){source.getColorAt(index,color);batch.setColorAt(i,color);}});
  batch.computeBoundingSphere();if(batch.boundingSphere)batch.boundingSphere.radius+=margin;
  parent.add(batch);
 }
 parent.remove(source);
 // It has not been rendered yet; dispose only the old instance allocation.
 // Shared geometry, material and textures belong to the live spatial batches.
 source.dispose();
}
