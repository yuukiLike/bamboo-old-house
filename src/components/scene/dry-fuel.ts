import * as T from 'three';
import { FUEL_PLACEMENTS, groundHeight } from './config';

export function addDryFuel(scene:T.Scene,prototype:T.Group) {
 for (const [index,placement] of FUEL_PLACEMENTS.entries()) {
  const bundle=prototype.clone(true);
  bundle.name=`Courtyard_dry_fuel_${index+1}`;
  bundle.position.set(placement.x,groundHeight(placement.x,placement.z)+.008,placement.z);
  bundle.rotation.y=placement.rotation;bundle.scale.setScalar(placement.scale);
  bundle.traverse(object=>{
   if(object instanceof T.Mesh){object.castShadow=true;object.receiveShadow=true;
    for(const material of Array.isArray(object.material)?object.material:[object.material])
     if(material instanceof T.MeshStandardMaterial)material.envMapIntensity=.38;
   }
  });
  scene.add(bundle);
 }
}
