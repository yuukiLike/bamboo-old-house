import * as T from 'three';
import { DETAIL_VIEWS, groundHeight, pathClearance, positionPath, seeded } from './config';

// Copy beside config.ts when integrating. Fine, interlaced dead grass follows
// the red-earth slope; low brittle scrub and rotten twigs interrupt the mat.
type Point = [number, number, number];
type Support = { kind: string; x: number; z: number; minGroundGap: number };

class GeometryBatch {
  positions: number[] = [];
  colors: number[] = [];
  uvs: number[] = [];
  indices: number[] = [];
  vertex(p: T.Vector3 | Point, color: T.Color, u = 0, v = 0) {
    const i = this.positions.length / 3;
    this.positions.push(...(p instanceof T.Vector3 ? p.toArray() : p));
    this.colors.push(color.r, color.g, color.b);
    this.uvs.push(u, v);
    return i;
  }
  triangle(a: number, b: number, c: number) { this.indices.push(a, b, c); }
  geometry() {
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(this.colors, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(this.uvs, 2));
    g.setIndex(this.indices);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

function tube(batch: GeometryBatch, points: T.Vector3[], radius: number, color: T.Color, sides = 5) {
  const start = batch.positions.length / 3;
  const up = new T.Vector3(0, 1, 0);
  for (let i = 0; i < points.length; i++) {
    const direction = points[Math.min(i + 1, points.length - 1)].clone()
      .sub(points[Math.max(0, i - 1)]).normalize();
    const across = new T.Vector3().crossVectors(direction, Math.abs(direction.y) > .92 ? new T.Vector3(1, 0, 0) : up).normalize();
    const second = new T.Vector3().crossVectors(direction, across).normalize();
    const r = radius * (1 - .79 * i / (points.length - 1));
    for (let j = 0; j < sides; j++) {
      const angle = j / sides * Math.PI * 2;
      batch.vertex(points[i].clone().addScaledVector(across, Math.cos(angle) * r)
        .addScaledVector(second, Math.sin(angle) * r), color, j / sides, i / (points.length - 1));
    }
    if (i) for (let j = 0; j < sides; j++) {
      const a = start + (i - 1) * sides + j, b = start + (i - 1) * sides + (j + 1) % sides;
      const c = start + i * sides + j, d = start + i * sides + (j + 1) % sides;
      batch.triangle(a, b, c); batch.triangle(b, d, c);
    }
  }
}

function rottenLog() {
  const batch = new GeometryBatch(), random = seeded(17162), rings = 9, sides = 12;
  const dark = new T.Color(0x39382c), exposed = new T.Color(0x75654b);
  const radii = Array.from({ length: sides }, () => .76 + random() * .24);
  const broken = Array.from({ length: sides }, () => (random() - .5) * .14);
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1);
    for (let j = 0; j <= sides; j++) {
      const angle = j / sides * Math.PI * 2, k = j % sides;
      const r = .5 * radii[k] * (.97 + .05 * Math.sin(t * 12 + k));
      // The longitudinal grooves and missing bark run with the wood grain.
      const c = dark.clone().lerp(exposed, k === 2 || k === 8 ? .66 : .07 + random() * .20);
      batch.vertex([t - .5 + broken[k] * (Math.abs(t - .5) * 2) ** 8,
        Math.cos(angle) * r * .60, Math.sin(angle) * r], c, j / sides, t);
      if (i && j < sides) {
        const a = (i - 1) * (sides + 1) + j, b = a + 1, c = i * (sides + 1) + j, d = c + 1;
        batch.triangle(a, b, c); batch.triangle(b, d, c);
      }
    }
  }
  // Recessed ragged end grain. Separate rings keep bark edges crisp and leave
  // uneven splinters, rather than the perfect flat cap of a sawn cylinder.
  for (const end of [0, 1]) {
    const outer: number[] = [], inner: number[] = [];
    const sign = end ? 1 : -1, x = sign * .5;
    const center = batch.vertex([x - sign * .028, .008, -.018], new T.Color(0x514732), .5, .5);
    for (let j = 0; j < sides; j++) {
      const angle = j / sides * Math.PI * 2, r = .5 * radii[j];
      outer.push(batch.vertex([x + broken[j], Math.cos(angle) * r * .60, Math.sin(angle) * r],
        exposed.clone().multiplyScalar(.70 + random() * .20), j / sides, .04));
      inner.push(batch.vertex([x - sign * .024 + broken[j] * .3, Math.cos(angle) * r * .29, Math.sin(angle) * r * .49],
        exposed.clone().multiplyScalar(.58 + random() * .19), j / sides, .09));
    }
    for (let j = 0; j < sides; j++) {
      const k = (j + 1) % sides;
      const face = (a: number, b: number, c: number) => end ? batch.triangle(a, c, b) : batch.triangle(a, b, c);
      face(outer[j], inner[j], outer[k]); face(outer[k], inner[j], inner[k]); face(inner[j], center, inner[k]);
    }
  }
  return batch.geometry();
}

function blade(batch: GeometryBatch, origin: T.Vector3, direction: T.Vector3, length: number, width: number, color: T.Color, droop: number) {
  const side = new T.Vector3(-direction.z, 0, direction.x).normalize();
  const start = batch.positions.length / 3;
  for (let i = 0; i <= 4; i++) {
    const t = i / 4, p = origin.clone().addScaledVector(direction, length * t);
    p.y -= droop * t * t;
    const half = width * .5 * Math.sin((t * .92 + .06) * Math.PI);
    batch.vertex(p.clone().addScaledVector(side, half), color, 0, t);
    batch.vertex(p.clone().addScaledVector(side, -half), color.clone().multiplyScalar(.84), 1, t);
    if (i) {
      const a = start + (i - 1) * 2;
      batch.triangle(a, a + 2, a + 1); batch.triangle(a + 1, a + 2, a + 3);
    }
  }
}

function grassTuft() {
  const batch = new GeometryBatch(), random = seeded(81164);
  for (let i = 0; i < 9; i++) {
    const yaw = random() * Math.PI * 2, lean = .36 + random() * .58;
    const direction = new T.Vector3(Math.cos(yaw) * lean, .62 + random() * .38, Math.sin(yaw) * lean).normalize();
    blade(batch, new T.Vector3((random() - .5) * .022, 0, (random() - .5) * .022),
      direction, .15 + random() * .25, .003 + random() * .004,
      new T.Color([0x82755a, 0x776b50, 0x9a8d68, 0x69634b][i % 4]), .06 + random() * .14);
  }
  return batch.geometry();
}

function leaf() {
  const batch = new GeometryBatch();
  blade(batch, new T.Vector3(), new T.Vector3(.48, .22, .85).normalize(), .062, .016, new T.Color(0x786b4c), .027);
  return batch.geometry();
}

function interlacedStraw() {
  const batch = new GeometryBatch(), random = seeded(81697);
  for (let strand = 0; strand < 32; strand++) {
    const angle = random() * Math.PI * 2, length = .18 + random() * .33;
    const direction = new T.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const side = new T.Vector3(-direction.z, 0, direction.x);
    const root = new T.Vector3((random() - .5) * .27, .002 + random() * .004, (random() - .5) * .27);
    const width = .0017 + random() * .0011;
    const bend = (random() - .5) * .08;
    const middle = root.clone().addScaledVector(direction, length * .53).addScaledVector(side, bend);
    middle.y += (.031 + random() * .062) * (strand % 5 === 0 ? .40 : 1);
    const tip = root.clone().addScaledVector(direction, length).addScaledVector(side, bend * 1.5);
    tip.y += .006 + random() * .025;
    // Grey-brown dead fibre should sit within the humus, not read as a bright
    // wire mesh over the whole forest floor in the high noon sun.
    const color = new T.Color([0x9e9787, 0xaaa18e, 0x8f8a7b, 0xb3a891, 0x9a917d][strand % 5]).multiplyScalar(.62);
    const a = batch.vertex(root.clone().addScaledVector(side, width * .5), color);
    const b = batch.vertex(root.clone().addScaledVector(side, -width * .5), color.clone().multiplyScalar(.83));
    const c = batch.vertex(middle.clone().addScaledVector(side, width * .40), color);
    const d = batch.vertex(middle.clone().addScaledVector(side, -width * .40), color.clone().multiplyScalar(.87));
    const e = batch.vertex(tip, color.clone().multiplyScalar(.91));
    // Three narrow triangles describe a kinked arc with a tapered broken tip.
    // No large leaf card or alpha plane is hidden under these crossing stems.
    batch.triangle(a, c, b); batch.triangle(b, c, d); batch.triangle(c, e, d);
  }
  const geometry = batch.geometry();
  geometry.translate(-.02, 0, -.02);
  return geometry;
}

function brittleScrub() {
  const batch = new GeometryBatch(), random = seeded(965120);
  for (let stem = 0; stem < 7; stem++) {
    const angle = random() * Math.PI * 2, spread = .12 + random() * .19;
    const root = new T.Vector3((random() - .5) * .035, 0, (random() - .5) * .035);
    const tip = root.clone().add(new T.Vector3(Math.cos(angle) * spread, .15 + random() * .25, Math.sin(angle) * spread));
    const middle = root.clone().lerp(tip, .58).add(new T.Vector3(.017, .048, -.024));
    tube(batch, [root, middle, tip], .0027 + random() * .0017, new T.Color(0x716550), 3);
    if (stem % 2 === 0) {
      const fork = root.clone().lerp(middle, .83);
      const end = fork.clone().add(new T.Vector3(Math.cos(angle + .8) * .14, .07 + random() * .06, Math.sin(angle + .8) * .14));
      tube(batch, [fork, fork.clone().lerp(end, .48).add(new T.Vector3(0, .012, 0)), end], .0019, new T.Color(0x81735a), 3);
    }
  }
  return batch.geometry();
}

function barkTexture() {
  const width = 64, height = 256, data = new Uint8Array(width * height * 4), random = seeded(42865);
  const grain = Array.from({ length: width }, () => random());
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const drift = Math.round(Math.sin(y / 43) * 1.7 + Math.sin(y / 19) * .5);
    const thread = grain[(x + drift + width) % width];
    const value = Math.round(184 + thread * 54 + random() * 11);
    const i = (y * width + x) * 4;
    data[i] = value; data[i + 1] = value; data[i + 2] = value; data[i + 3] = 255;
  }
  const texture = new T.DataTexture(data, width, height, T.RGBAFormat);
  texture.name = 'Fine_longitudinal_rotten_bark_grain';
  texture.colorSpace = T.SRGBColorSpace;
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.magFilter = T.LinearFilter; texture.minFilter = T.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
}

export function addForestFloor(scene: T.Scene, mobile: boolean) {
  const group = new T.Group();
  group.name = 'Continuous_weathered_forest_floor';
  const random = seeded(927190), supports: Support[] = [];
  const cameraPath = Array.from({ length: 161 }, (_, i) => positionPath.getPoint(i / 160));
  const canPlace = (x: number, z: number, radius: number) => {
    if (groundHeight(x, z) < -.95 || pathClearance(x, z) < radius + .55) return false;
    if (x > -13 - radius && x < 10.5 + radius && z > -5 - radius && z < 9 + radius) return false;
    if (z < 13.1 + radius && z > 9 - radius && x > -3 - radius && x < 3 + radius) return false;
    if (cameraPath.some(p => (p.x - x) ** 2 + (p.z - z) ** 2 < (radius + .72) ** 2)) return false;
    return !Object.values(DETAIL_VIEWS).some(v => (v.p[0] - x) ** 2 + (v.p[2] - z) ** 2 < (radius + .85) ** 2);
  };
  // Low dead grass is a walkable surface. Virtual camera routes and detail
  // viewpoints must not carve empty circles through it; only real concrete
  // and the hard courtyard exclude this thin, compressible ground covering.
  const surfaceCanPlace = (x: number, z: number) => groundHeight(x, z) >= -.95
    && pathClearance(x, z) >= .12
    && !(x > -13 && x < 10.5 && z > -5 && z < 9);
  const clusters = [
    [6.2, 10.9, 1.25], [-4.8, 14.0, 1.10], [9.3, 14.0, 1.40], [-9.2, 12.8, 1.35],
    [7.5, 18.2, 1.65], [-9.0, 17.2, 1.70], [4.4, 22.0, 1.85], [-12.6, 15.0, 1.45],
    [9.4, 24.7, 1.60], [-5.2, 22.0, 1.70], [5.8, 28.0, 1.70], [-10.5, 25.0, 1.85],
    [1.8, 16.2, 1.35], [-1.5, 26.0, 1.80], [10.2, 19.7, 1.25], [-13.4, 28.0, 1.60],
    [2.7, 27.0, 1.70], [6.3, 13.9, 1.35],
  ];
  const texture = barkTexture();
  const woodMaterial = new T.MeshStandardMaterial({ map: texture, vertexColors: true, roughness: .98 });
  const plantMaterial = new T.MeshStandardMaterial({ vertexColors: true, roughness: .96, side: T.DoubleSide, forceSinglePass: true });
  const logGeometry = rottenLog(), grassGeometry = grassTuft(), leafGeometry = leaf();
  const strawGeometry = interlacedStraw(), scrubGeometry = brittleScrub();
  const logs = new T.InstancedMesh(logGeometry, woodMaterial, mobile ? 14 : 22);
  const grass = new T.InstancedMesh(grassGeometry, plantMaterial, mobile ? 38 : 70);
  const leaves = new T.InstancedMesh(leafGeometry, plantMaterial, mobile ? 70 : 120);
  const straw = new T.InstancedMesh(strawGeometry, plantMaterial, mobile ? 900 : 2400);
  const scrub = new T.InstancedMesh(scrubGeometry, woodMaterial, mobile ? 18 : 38);
  logs.name = 'Flattened_rotten_logs_with_splintered_ends';
  grass.name = 'Fine_bent_dry_grass_tufts';
  leaves.name = 'Sparse_curled_dead_leaves_on_brittle_stems';
  straw.name = 'Dense_interlaced_dry_grass_mat';
  scrub.name = 'Low_brittle_leafless_scrub';
  const branches = new GeometryBatch(), dummy = new T.Object3D(), up = new T.Vector3(0, 1, 0);
  const local = new T.Vector3(), color = new T.Color();
  let logCount = 0, grassCount = 0, leafCount = 0;

  const rooted = (x: number, z: number, yaw: number) => {
    const normal = new T.Vector3(groundHeight(x - .06, z) - groundHeight(x + .06, z), .12,
      groundHeight(x, z - .06) - groundHeight(x, z + .06)).normalize();
    dummy.position.set(x, groundHeight(x, z) + .001, z);
    dummy.quaternion.setFromUnitVectors(up, normal).multiply(new T.Quaternion().setFromAxisAngle(up, yaw));
  };
  for (const [cx, cz, radius] of clusters) {
    let clusterLogs = 0;
    for (let i = 0; i < 10 && logCount < logs.instanceMatrix.count; i++) {
      const yaw = random() * Math.PI * 2, length = .38 + random() * .65, r = .031 + random() * .046;
      const x = cx + (random() - .5) * radius, z = cz + (random() - .5) * radius;
      if (!canPlace(x, z, length * .54)) continue;
      const dx = Math.cos(yaw) * length, dz = Math.sin(yaw) * length;
      const direction = new T.Vector3(dx, groundHeight(x + dx / 2, z + dz / 2) - groundHeight(x - dx / 2, z - dz / 2), dz).normalize();
      dummy.position.set(x, 0, z);
      dummy.quaternion.setFromUnitVectors(new T.Vector3(1, 0, 0), direction);
      dummy.scale.set(length, r * 2, r * 2); dummy.updateMatrix();
      let lift = -Infinity;
      const vertices = logGeometry.getAttribute('position');
      for (let v = 0; v < vertices.count; v++) {
        local.fromBufferAttribute(vertices, v).applyMatrix4(dummy.matrix);
        lift = Math.max(lift, groundHeight(local.x, local.z) - local.y);
      }
      dummy.position.y = lift - .008; dummy.updateMatrix();
      logs.setMatrixAt(logCount, dummy.matrix);
      color.setRGB(.82 + random() * .15, .84 + random() * .13, .79 + random() * .17);
      logs.setColorAt(logCount++, color);
      supports.push({ kind: 'rotten-log', x, z, minGroundGap: -.008 });
      if (++clusterLogs >= 1) break;
    }
    for (let i = 0; i < (mobile ? 3 : 5) && grassCount < grass.instanceMatrix.count; i++) {
      const angle = random() * Math.PI * 2, distance = Math.sqrt(random()) * radius;
      const x = cx + Math.cos(angle) * distance, z = cz + Math.sin(angle) * distance;
      if (!canPlace(x, z, .23)) continue;
      rooted(x, z, random() * Math.PI * 2);
      const scale = .55 + random() * .53;
      dummy.scale.setScalar(scale); dummy.updateMatrix();
      grass.setMatrixAt(grassCount++, dummy.matrix);
      supports.push({ kind: 'dry-grass-root', x, z, minGroundGap: .001 });
    }
    for (let i = 0; i < (mobile ? 2 : 4); i++) {
      const angle = random() * Math.PI * 2, length = .26 + random() * .48;
      const x = cx + (random() - .5) * radius * 2, z = cz + (random() - .5) * radius * 2;
      if (!canPlace(x, z, length)) continue;
      const points = [0, .38, .72, 1].map(t => {
        const px = x + Math.cos(angle) * length * t, pz = z + Math.sin(angle) * length * t + Math.sin(t * 4) * .038;
        return new T.Vector3(px, groundHeight(px, pz) + .010 + Math.sin(t * Math.PI) * .018, pz);
      });
      tube(branches, points, .010 + random() * .008, new T.Color(0x534b39));
      const fork = points[2].clone(), end = fork.clone().add(new T.Vector3(Math.cos(angle + .9) * .19, 0, Math.sin(angle + .9) * .19));
      end.y = groundHeight(end.x, end.z) + .008;
      tube(branches, [fork, fork.clone().lerp(end, .55).add(new T.Vector3(0, .012, 0)), end], .006, new T.Color(0x665b44), 4);
      supports.push({ kind: 'fallen-twig', x, z, minGroundGap: -.008 });
    }
    // The reference has mostly dead scrub, with only occasional curled leaves
    // still attached. Uneven omissions prevent rows of regular green seedlings.
    for (let shrub = 0; shrub < 1; shrub++) {
      const x = cx + (random() - .5) * radius, z = cz + (random() - .5) * radius;
      if (!canPlace(x, z, .33)) continue;
      const base = new T.Vector3(x, groundHeight(x, z), z), height = .30 + random() * .20;
      supports.push({ kind: 'shrub-root', x, z, minGroundGap: 0 });
      for (let stem = 0; stem < 3; stem++) {
        const angle = random() * Math.PI * 2, bend = .10 + random() * .18;
        const tip = base.clone().add(new T.Vector3(Math.cos(angle) * bend, height * (.60 + random() * .40), Math.sin(angle) * bend));
        const middle = base.clone().lerp(tip, .56).add(new T.Vector3(0, .036, 0));
        tube(branches, [base, middle, tip], .0037, new T.Color(0x625b46), 4);
        for (let j = 0; j < 5 && leafCount < leaves.instanceMatrix.count; j++) {
          if (random() > .35) continue;
          const t = .28 + j * .105, side = j % 2 ? 1 : -1;
          const p = base.clone().lerp(tip, t); p.y += Math.sin(t * Math.PI) * .034;
          dummy.position.copy(p);
          dummy.rotation.set((random() - .5) * .50, angle + side * 1.1, (random() - .5) * .36);
          dummy.scale.setScalar(.57 + random() * .44); dummy.updateMatrix();
          leaves.setMatrixAt(leafCount, dummy.matrix);
          color.setHex([0xa79a79, 0xb6a27b, 0x94896b, 0xa99b7c][j % 4]);
          leaves.setColorAt(leafCount++, color);
        }
      }
    }
  }
  // A continuous mat with broad gaps and denser tangled drifts. Sampling is
  // independent of the accent-cluster list above, so the floor does not break
  // into isolated islands. +X is the left side of the outward porch view.
  const carpetRandom = seeded(885619);
  const habitat = (x: number, z: number) => Math.max(.18, Math.min(.97,
    .57 + .20 * Math.sin(x * .49 + z * .38) + .16 * Math.sin(z * .91 - x * .22)
    + .09 * Math.cos(x * 1.8 + z * .68)));
  const floorSample = () => ({
    x: carpetRandom() < .61 ? carpetRandom() * 11.8 : -15 + carpetRandom() * 15,
    z: 9.25 + Math.pow(carpetRandom(), 1.31) * 20.5,
  });
  let strawCount = 0, scrubCount = 0, positiveStraw = 0;
  const strawPositions = strawGeometry.getAttribute('position');
  for (let attempt = 0; attempt < straw.instanceMatrix.count * 10 && strawCount < straw.instanceMatrix.count; attempt++) {
    const { x, z } = floorSample();
    const scale = .85 + carpetRandom() * .22;
    if (!surfaceCanPlace(x, z) || carpetRandom() > habitat(x, z)) continue;
    rooted(x, z, carpetRandom() * Math.PI * 2);
    dummy.scale.set(scale, .85 + carpetRandom() * .40, scale * (.92 + carpetRandom() * .16));
    dummy.updateMatrix();
    let groundGap = Infinity, highGap = -Infinity, onSoil = true;
    for (let fit = 0; fit < 3; fit++) {
      groundGap = Infinity; highGap = -Infinity; onSoil = true;
      for (let vertex = 0; vertex < strawPositions.count; vertex++) {
        local.fromBufferAttribute(strawPositions, vertex).applyMatrix4(dummy.matrix);
        if (!surfaceCanPlace(local.x, local.z)) { onSoil = false; break; }
        const gap = local.y - groundHeight(local.x, local.z);
        groundGap = Math.min(groundGap, gap); highGap = Math.max(highGap, gap);
      }
      if (!onSoil || highGap - groundGap <= .123) break;
      // Shorten and compress a bundle at a sharp terrain-triangle crease;
      // long rigid tangles otherwise bridge the hollow and float too high.
      if (fit < 2) { dummy.scale.multiply(new T.Vector3(.83, .84, .83)); dummy.updateMatrix(); }
    }
    if (!onSoil || highGap - groundGap > .123) continue;
    // A few millimetres disappear into the existing duff; the actual terrain
    // triangles determine the height, including the bank's irregular slope.
    dummy.position.y -= groundGap + .003; dummy.updateMatrix();
    straw.setMatrixAt(strawCount, dummy.matrix);
    const shade = .86 + carpetRandom() * .14;
    color.setRGB(shade, shade * (.97 + carpetRandom() * .03), shade * (.93 + carpetRandom() * .06));
    straw.setColorAt(strawCount++, color);
    if (x > 0) positiveStraw++;
    supports.push({ kind: 'interlaced-straw-ground-contact', x, z, minGroundGap: -.003 });
  }
  for (let attempt = 0; attempt < scrub.instanceMatrix.count * 8 && scrubCount < scrub.instanceMatrix.count; attempt++) {
    const { x, z } = floorSample();
    if (!canPlace(x, z, .42) || carpetRandom() > habitat(x, z) * .77) continue;
    rooted(x, z, carpetRandom() * Math.PI * 2);
    const s = .54 + carpetRandom() * .72;
    dummy.scale.set(s, s * (.65 + carpetRandom() * .46), s); dummy.updateMatrix();
    scrub.setMatrixAt(scrubCount, dummy.matrix);
    const shade = .72 + carpetRandom() * .27;
    color.setRGB(shade, shade * .97, shade * .91); scrub.setColorAt(scrubCount++, color);
    supports.push({ kind: 'low-dead-scrub-root', x, z, minGroundGap: .001 });
  }
  logs.count = logCount; grass.count = grassCount; leaves.count = leafCount;
  straw.count = strawCount; scrub.count = scrubCount;
  const branchGeometry = branches.geometry(), branchMesh = new T.Mesh(branchGeometry, woodMaterial);
  branchMesh.name = 'Grounded_broken_branches_and_shrub_stems';
  for (const mesh of [logs, grass, leaves, branchMesh, straw, scrub]) {
    mesh.castShadow = false; mesh.receiveShadow = true;
    if (mesh instanceof T.InstancedMesh) { mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); }
    group.add(mesh);
  }
  group.userData = {
    referenceNote: 'Continuous grey-brown interlaced dead grass on the red-earth bamboo slope, with brittle scrub and decayed thin wood; geometry interpreted from the supplied close forest photograph.',
    supportSampler: 'config.groundHeight', supports, drawCalls: 6,
    surfacePlacement: 'Dry straw crosses virtual camera routes and detail feet; only the physical concrete path and hard courtyard are excluded.',
    coverage: { x: [-15, 12], z: [9, 30], positiveXStrawBundles: positiveStraw, negativeXStrawBundles: strawCount - positiveStraw },
    counts: { rottenLogs: logCount, dryGrassTufts: grassCount, shrubLeaves: leafCount,
      interlacedStrawBundles: strawCount, individualDryStrands: strawCount * 32, lowDeadScrub: scrubCount },
    triangles: logGeometry.index!.count / 3 * logCount + grassGeometry.index!.count / 3 * grassCount
      + leafGeometry.index!.count / 3 * leafCount + branchGeometry.index!.count / 3
      + strawGeometry.index!.count / 3 * strawCount + scrubGeometry.index!.count / 3 * scrubCount,
  };
  scene.add(group);
  return {
    group,
    dispose() {
      scene.remove(group);
      logs.dispose(); grass.dispose(); leaves.dispose(); straw.dispose(); scrub.dispose();
      for (const geometry of [logGeometry, grassGeometry, leafGeometry, branchGeometry, strawGeometry, scrubGeometry]) geometry.dispose();
      woodMaterial.dispose(); plantMaterial.dispose(); texture.dispose();
    },
  };
}
