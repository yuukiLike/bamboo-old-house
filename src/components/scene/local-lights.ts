import * as T from 'three';

const include=/^[ \t]*#include +<([\w\d./]+)>/gm;
function expand(source:string):string{
 return source.replace(include,(directive,name:string)=>{
  const chunk=T.ShaderChunk[name as keyof typeof T.ShaderChunk];
  return typeof chunk==='string'?expand(chunk):directive;
 });
}

/** Fixed room lamps cannot illuminate plants beyond their finite ranges.
 * Prove that for every instance in a spatial batch, then share an unlit
 * material clone only between unreachable batches. Nearby batches retain
 * their original lights and shadows. */
export function excludeUnreachablePointLights(scene:T.Scene){
 scene.updateMatrixWorld(true);
 const lights:{position:T.Vector3;range:number}[]=[];
 scene.traverse(object=>{if(object instanceof T.PointLight)lights.push({position:object.getWorldPosition(new T.Vector3()),range:object.distance});});
 if(!lights.length||lights.some(light=>light.range===0))return;
 const variants=new Map<T.Material,T.Material>(),matrix=new T.Matrix4(),box=new T.Box3();
 scene.traverse(object=>{
  if(!(object instanceof T.Mesh))return;
  const materials:T.Material[]=Array.isArray(object.material)?object.material:[object.material];
  let unreachable=false;
  if(object instanceof T.InstancedMesh&&!object.name.includes('falling')){
   object.geometry.computeBoundingBox();
   const margin=/^(Stalk_|Leaves_|Porch_)/.test(object.name)?2.6:.55;
   unreachable=true;
   for(let i=0;i<object.count&&unreachable;i++){
    object.getMatrixAt(i,matrix);matrix.premultiply(object.matrixWorld);
    box.copy(object.geometry.boundingBox!).applyMatrix4(matrix).expandByScalar(margin);
    if(lights.some(light=>box.distanceToPoint(light.position)<=light.range))unreachable=false;
   }
  }
  if(!unreachable)return;
  const specializeMaterial=(material:T.Material)=>{
   let variant=variants.get(material);if(variant)return variant;
   variant=material.clone();
   const compile=material.onBeforeCompile.bind(material),key=material.customProgramCacheKey();
   variant.onBeforeCompile=(shader,renderer)=>{
    compile(shader,renderer);
    const specialize=(source:string)=>expand(source).replace(/NUM_POINT_LIGHT_SHADOWS|NUM_POINT_LIGHTS/g,'0');
    shader.vertexShader=specialize(shader.vertexShader);shader.fragmentShader=specialize(shader.fragmentShader);
   };
   variant.customProgramCacheKey=()=>key+'|no-reachable-room-lights';
   variants.set(material,variant);return variant;
  };
  object.material=Array.isArray(object.material)?materials.map(specializeMaterial):specializeMaterial(materials[0]);
 });
}
