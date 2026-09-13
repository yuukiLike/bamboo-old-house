import * as T from 'three';

/** The original full-height post and the newer room-one lining share x=-.8.
 * Export quantization separates them by only 0.010 mm, so rotating reveals
 * competing plaster fragments. Recess just this post face behind the lining;
 * preserve its outer face, the room lining, window opening and all other rooms. */
export function stabilizeRoomSurfaces(house: T.Object3D): number {
  const plaster = house.getObjectByName('Architecture__Reference_old_soft_lime_plaster');
  if (!(plaster instanceof T.Mesh)) return 0;
  house.updateMatrixWorld(true);
  const geometry = plaster.geometry, original = geometry.getAttribute('position');
  const world = new T.Vector3(), inverse = plaster.matrixWorld.clone().invert();
  const changed: number[] = [];
  for (let i = 0; i < original.count; i++) {
    world.fromBufferAttribute(original, i).applyMatrix4(plaster.matrixWorld);
    if (Math.abs(world.x + .8) < .0001 && world.z >= -9.613 && world.z <= -9.307
      && world.y >= .202 && world.y <= 6.273) changed.push(i);
  }
  if (!changed.length) return 0;

  const position = new T.Float32BufferAttribute(original.count * 3, 3);
  for (let i = 0; i < original.count; i++) position.setXYZ(i, original.getX(i), original.getY(i), original.getZ(i));
  // Include duplicated edge vertices so the post remains closed. The existing
  // normalized 16-bit positions cannot encode this offset accurately enough.
  for (const i of changed) {
    world.fromBufferAttribute(original, i).applyMatrix4(plaster.matrixWorld);
    world.x = -.803;
    world.applyMatrix4(inverse);
    position.setXYZ(i, world.x, world.y, world.z);
  }
  geometry.setAttribute('position', position);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return changed.length;
}
