import * as T from 'three';

export function stabilizeHouseSurfaces(house: T.Object3D): number {
  house.updateMatrixWorld(true);
  function moveFace(name: string, contains: (point: T.Vector3) => boolean, axis: 'x' | 'z', depth: number) {
    const mesh = house.getObjectByName(name);
    if (!(mesh instanceof T.Mesh)) return 0;
    const geometry = mesh.geometry, original = geometry.getAttribute('position');
    const world = new T.Vector3(), inverse = mesh.matrixWorld.clone().invert();
    const changed: number[] = [];
    for (let i = 0; i < original.count; i++) {
      world.fromBufferAttribute(original, i).applyMatrix4(mesh.matrixWorld);
      if (contains(world)) changed.push(i);
    }
    if (!changed.length) return 0;

    // Decode quantized positions before a millimetre adjustment. Move duplicated
    // edge vertices together, preserving topology, UVs and all unrelated faces.
    const position = new T.Float32BufferAttribute(original.count * 3, 3);
    for (let i = 0; i < original.count; i++) position.setXYZ(i, original.getX(i), original.getY(i), original.getZ(i));
    for (const i of changed) {
      world.fromBufferAttribute(original, i).applyMatrix4(mesh.matrixWorld);
      world[axis] = depth;
      world.applyMatrix4(inverse);
      position.setXYZ(i, world.x, world.y, world.z);
    }
    geometry.setAttribute('position', position);
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    return changed.length;
  }

  // Entrance jambs are only 0.016 mm ahead of the facade. Keep them 3 mm ahead.
  const doorway = moveFace('Architecture__Reference_damp_lime_wall_foot', point =>
    Math.abs(point.x) >= 2.15 && Math.abs(point.x) <= 2.35
      && point.y >= .19 && point.y <= 3.01 && Math.abs(point.z) < .0001, 'z', .003);
  // The room-one post and lining differ by 0.010 mm. Recess only this post face.
  const room = moveFace('Architecture__Reference_old_soft_lime_plaster', point =>
    Math.abs(point.x + .8) < .0001 && point.z >= -9.613 && point.z <= -9.307
      && point.y >= .202 && point.y <= 6.273, 'x', -.803);
  return doorway + room;
}
