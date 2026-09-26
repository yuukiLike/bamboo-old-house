import * as T from 'three';

/** Three already omits shadow samples when a point light contributes exactly
 * zero. Its standard/physical BRDF still runs in that case. Keep all nonzero
 * lights, attenuation and shadow filtering; skip only that zero contribution.
 * Apply before per-object light specialization expands the shader includes. */
export function skipZeroPointLightContributions(scene:T.Scene){
 const info='getPointLightInfo( pointLight, geometryPosition, directLight );';
 const direct='RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
 const original=T.ShaderChunk.lights_fragment_begin;
 // Fail open after a dependency change: keep Three's rendering if this exact
 // point-light block is no longer present, instead of patching another light.
 const start=original.indexOf(info),end=original.indexOf(direct,start);
 if(start<0||end<start||end>original.indexOf('#if ( NUM_SPOT_LIGHTS'))return;
 const chunk=original.slice(0,start)+original.slice(start,end+direct.length)
  .replace(info,info+'\n\t\tif ( directLight.visible ) {')+'\n\t\t}\n'+original.slice(end+direct.length);
 const seen=new Set<T.Material>();
 scene.traverse(object=>{
  if(!(object instanceof T.Mesh))return;
  for(const material of Array.isArray(object.material)?object.material:[object.material]){
   if(!(material instanceof T.MeshStandardMaterial)||seen.has(material))continue;
   seen.add(material);
   const compile=material.onBeforeCompile.bind(material),key=material.customProgramCacheKey();
   material.onBeforeCompile=(shader,renderer)=>{
    compile(shader,renderer);
    shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_begin>',chunk);
   };
   material.customProgramCacheKey=()=>key+'|nonzero-point-light-contributions';
  }
 });
}
