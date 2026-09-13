import * as T from 'three';

/** Keep the original entrance jambs in front of the overlapping facade skin.
 * The quantized GLB puts their front faces only 0.016 mm ahead of the plaster:
 * both resolve to the same depth from the courtyard, producing moving blocks.
 * Move every copy of those face-edge vertices together so the jamb stays closed.
 * This runs before upload; topology, UVs, materials and other damp patches stay intact. */
export function stabilizeDoorSurfaces(house: T.Object3D): number {
  const jambs = house.getObjectByName('Architecture__Reference_damp_lime_wall_foot');
  if (!(jambs instanceof T.Mesh)) return 0;
  house.updateMatrixWorld(true);
  const geometry = jambs.geometry, original = geometry.getAttribute('position');
  const world = new T.Vector3(), inverse = jambs.matrixWorld.clone().invert();
  const changed: number[] = [];
  for (let i = 0; i < original.count; i++) {
    world.fromBufferAttribute(original, i).applyMatrix4(jambs.matrixWorld);
    if (Math.abs(world.x) >= 2.15 && Math.abs(world.x) <= 2.35
      && world.y >= .19 && world.y <= 3.01 && Math.abs(world.z) < .0001) changed.push(i);
  }
  if (!changed.length) return 0;

  // A normalized 16-bit attribute cannot represent a millimetre adjustment
  // reliably across this 18.75 m batch. Decode once, preserving all other values.
  const position = new T.Float32BufferAttribute(original.count * 3, 3);
  for (let i = 0; i < original.count; i++) position.setXYZ(i, original.getX(i), original.getY(i), original.getZ(i));
  for (const i of changed) {
    world.fromBufferAttribute(original, i).applyMatrix4(jambs.matrixWorld);
    world.z = .003;
    world.applyMatrix4(inverse);
    position.setXYZ(i, world.x, world.y, world.z);
  }
  geometry.setAttribute('position', position);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return changed.length;
}
