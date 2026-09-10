import * as T from 'three';

/** Standalone, metre-scaled woodland dressing. Web Y is up.
 * No camera, website, texture, animation, or terrain-module dependency.
 * Existing terrain supplies every ground contact; no new ground skin is made.
 */
export type WoodlandGround = (x: number, z: number) => number;
export type WoodlandTree = { x: number; z: number; s: number };
type Point = [number, number, number];
type Random = () => number;
type Kind = 'fern' | 'herb' | 'sedge' | 'shrub' | 'litter' | 'wood';
type Patch = { x: number; z: number; rx: number; rz: number; yaw: number };

export type WoodlandFinishStats = {
  triangles: number;
  drawCalls: number;
  plants: Record<Kind, number>;
  layers: { name: string; triangles: number; vertices: number; projectedAreaM2: number }[];
  protectedCourtyard: [number, number, number, number];
  minimumPathClearance: number;
  minimumRootGap: number;
  maximumRootGap: number;
  colonyBounds: { x: number; z: number; radiusX: number; radiusZ: number; yaw: number }[];
  reference: string;
};

function seeded(seed: number): Random {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let n = Math.imul(seed ^ seed >>> 15, 1 | seed);
    n = n + Math.imul(n ^ n >>> 7, 61 | n) ^ n;
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
}

function noise(x: number, z: number) {
  const ix = Math.floor(x), iz = Math.floor(z), u0 = x - ix, v0 = z - iz;
  const u = u0 * u0 * (3 - 2 * u0), v = v0 * v0 * (3 - 2 * v0);
  const hash = (a: number, b: number) => {
    let k = Math.imul(a, 374761393) + Math.imul(b, 668265263);
    k = Math.imul(k ^ k >>> 13, 1274126177);
    return ((k ^ k >>> 16) >>> 0) / 4294967296;
  };
  return T.MathUtils.lerp(T.MathUtils.lerp(hash(ix, iz), hash(ix + 1, iz), u),
    T.MathUtils.lerp(hash(ix, iz + 1), hash(ix + 1, iz + 1), u), v);
}

class Batch {
  positions: number[] = [];
  colors: number[] = [];
  indices: number[] = [];
  constructor(readonly name: string, readonly limit: number) {}
  get triangles() { return this.indices.length / 3; }
  fits(amount: number) { return this.triangles + amount <= this.limit; }
  vertex(p: Point, color: T.Color, shade = 1) {
    const index = this.positions.length / 3;
    this.positions.push(...p);
    this.colors.push(color.r * shade, color.g * shade, color.b * shade);
    return index;
  }
  triangle(a: number, b: number, c: number) { this.indices.push(a, b, c); }
  geometry() {
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new T.Float32BufferAttribute(this.colors, 3));
    geometry.setIndex(this.indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }
}

const PALETTE = {
  fern: [0x45543b, 0x4b5740, 0x596045, 0x69634e, 0x625e4a],
  herb: [0x454d38, 0x515b40, 0x5b6148, 0x66634e],
  sedge: [0x79705b, 0x6b6651, 0x77725d, 0x595e46, 0x5e654b],
  shrub: [0x3b4834, 0x48513b, 0x535a41, 0x62634b],
  litter: [0x756b57, 0x69614f, 0x5d5646, 0x807461, 0x514e40],
  wood: [0x534d40, 0x645a48, 0x49463a, 0x70634f],
};

/** An actual small, pointed leaf, with a folded midrib and curved margins.
 * Eight triangles, no alpha card, rectangular plane, or billboard.
 */
function leaf(batch: Batch, ground: WoodlandGround, origin: Point, yaw: number,
  length: number, width: number, rise: number, curl: number, color: T.Color,
  random: Random, lying = false) {
  if (!batch.fits(8)) return;
  const dx = Math.cos(yaw), dz = Math.sin(yaw), sx = -dz, sz = dx;
  const bend = (random() - .5) * length * .24;
  const point = (t: number, side = 0): Point => {
    const w = width * .5 * Math.sin(Math.PI * t) * side;
    const x = origin[0] + dx * length * t + sx * (bend * t * t + w);
    const z = origin[2] + dz * length * t + sz * (bend * t * t + w);
    const spine = Math.sin(t * Math.PI) * width * .10 * (1 - Math.abs(side));
    const y = origin[1] + rise * t + curl * Math.sin(t * Math.PI) + spine;
    return [x, lying ? ground(x, z) + .0025 + Math.max(0, y - origin[1]) : Math.max(ground(x, z) + .002, y), z];
  };
  const base = batch.vertex(point(0), color, .77);
  const rings: number[][] = [];
  for (const t of [.30, .68]) {
    rings.push([-1, 0, 1].map(side => batch.vertex(point(t, side), color,
      (side === 0 ? 1.045 : side < 0 ? .88 : .95) * (1 - t * .055))));
  }
  const tip = batch.vertex(point(1), color, .87);
  batch.triangle(base, rings[0][0], rings[0][1]);
  batch.triangle(base, rings[0][1], rings[0][2]);
  for (let i = 0; i < 2; i++) {
    batch.triangle(rings[0][i], rings[1][i], rings[0][i + 1]);
    batch.triangle(rings[0][i + 1], rings[1][i], rings[1][i + 1]);
  }
  batch.triangle(rings[1][0], tip, rings[1][1]);
  batch.triangle(rings[1][1], tip, rings[1][2]);
}

function blade(batch: Batch, ground: WoodlandGround, origin: Point, yaw: number,
  length: number, width: number, height: number, color: T.Color, random: Random) {
  if (!batch.fits(3)) return;
  const dx = Math.cos(yaw), dz = Math.sin(yaw), sx = -dz, sz = dx;
  const lean = .45 + random() * .50, bend = (random() - .5) * .12;
  const at = (t: number, side: number): Point => {
    const x = origin[0] + dx * length * t * lean + sx * (side * width * (1 - t * .8) + bend * t * t);
    const z = origin[2] + dz * length * t * lean + sz * (side * width * (1 - t * .8) + bend * t * t);
    return [x, Math.max(ground(x, z) + .002, origin[1] + height * Math.sin(t * 2.05)), z];
  };
  const a = batch.vertex(at(0, -.5), color, .74), b = batch.vertex(at(0, .5), color, .80);
  const c = batch.vertex(at(.54, -.38), color, .90), d = batch.vertex(at(.54, .38), color);
  const e = batch.vertex(at(1, 0), color, .88);
  batch.triangle(a, c, b); batch.triangle(b, c, d); batch.triangle(c, e, d);
}

/** Small, soil-following rhizome or branch. Buried underside supplies contact. */
function woodTube(batch: Batch, points: Point[], radius: number, color: T.Color,
  random: Random, sides = 5) {
  const triangles = (points.length - 1) * sides * 2;
  if (!batch.fits(triangles)) return;
  const start = batch.positions.length / 3, axis = new T.Vector3(), across = new T.Vector3(), second = new T.Vector3();
  const irregular = Array.from({ length: sides }, () => .78 + random() * .24);
  points.forEach((p, i) => {
    const before = points[Math.max(0, i - 1)], after = points[Math.min(points.length - 1, i + 1)];
    axis.set(after[0] - before[0], after[1] - before[1], after[2] - before[2]).normalize();
    across.crossVectors(axis, Math.abs(axis.y) > .94 ? new T.Vector3(1, 0, 0) : new T.Vector3(0, 1, 0)).normalize();
    second.crossVectors(axis, across).normalize();
    for (let j = 0; j < sides; j++) {
      const angle = j / sides * Math.PI * 2, r = radius * irregular[j] * (1 - i / (points.length - 1) * .76);
      batch.vertex([p[0] + across.x * Math.cos(angle) * r + second.x * Math.sin(angle) * r,
        p[1] + across.y * Math.cos(angle) * r + second.y * Math.sin(angle) * r,
        p[2] + across.z * Math.cos(angle) * r + second.z * Math.sin(angle) * r], color, .75 + j / sides * .21);
      if (i) {
        const a = start + (i - 1) * sides + j, b = start + (i - 1) * sides + (j + 1) % sides;
        const c = start + i * sides + j, d = start + i * sides + (j + 1) % sides;
        batch.triangle(a, b, c); batch.triangle(b, d, c);
      }
    }
  });
}

export function addWoodlandFinish(scene: T.Scene, mobile: boolean,
  groundHeight: WoodlandGround, pathClearance: WoodlandGround, trees: readonly WoodlandTree[]) {
  const group = new T.Group();
  group.name = 'Finished_woodland_ground_and_middle_growth';
  const random = seeded(991836);
  const budget: Record<Kind, number> = mobile
    ? { fern: 9000, herb: 12000, sedge: 11500, shrub: 13500, litter: 3500, wood: 7500 }
    : { fern: 22000, herb: 28000, sedge: 27000, shrub: 35000, litter: 8000, wood: 15000 };
  const batches = Object.fromEntries(Object.entries(budget).map(([kind, limit]) =>
    [kind, new Batch('Woodland_' + kind, limit)])) as Record<Kind, Batch>;
  const plants: Record<Kind, number> = { fern: 0, herb: 0, sedge: 0, shrub: 0, litter: 0, wood: 0 };
  const roots: Point[] = [];
  let minimumPathClearance = Infinity;
  const color = (kind: Kind) => new T.Color(PALETTE[kind][Math.floor(random() * PALETTE[kind].length)])
    .multiplyScalar(.91 + random() * .15);

  const allowed = (x: number, z: number, radius = .1) => {
    if (x < -44 || x > 30.5 || z < 9.1 + radius || z > 60.5) return false;
    if (x > -13 - radius && x < 10.5 + radius && z > -5 - radius && z < 9 + radius) return false;
    if (pathClearance(x, z) < radius + .23 || groundHeight(x, z) < -1.12) return false;
    return [[-radius, 0], [radius, 0], [0, -radius], [0, radius]].every(([dx, dz]) =>
      groundHeight(x + dx, z + dz) > -1.12 && pathClearance(x + dx, z + dz) >= .23);
  };
  const register = (kind: Kind, x: number, z: number) => {
    plants[kind]++;
    roots.push([x, groundHeight(x, z) + .002, z]);
    minimumPathClearance = Math.min(minimumPathClearance, pathClearance(x, z));
  };

  // Narrow, overlapping colonies cross the far slope. The previous wide
  // ellipses diluted a finite geometry budget into isolated distant dots.
  // Most leaf area now belongs to connected 2–4 m wide tongues of growth;
  // empty humus between those tongues stays legible at the porch distance.
  const patchSpecs = [
    [-9, 15.7, 1.2, 2.6], [5.8, 17, 1.15, 2.8], [-4.8, 23.2, 1.35, 3.0],
    [7, 26.5, 1.3, 3.4], [-14.5, 24, 1.9, 3.8], [-19.5, 18.5, 1.8, 3.6],
    [-21, 33, 2.1, 4.2], [-29, 28, 1.5, 4.2], [-32, 43, 2.2, 4.6],
    [-13.5, 42, 1.8, 4.6], [-5, 35, 1.6, 3.8], [5, 42, 2.0, 4.2],
    [19.1, 23, 1.8, 4.3], [22, 36, 2.2, 5.0], [13.7, 49, 1.9, 4.5],
    [-13, 54, 2.2, 4.3], [-29, 55, 2.1, 4.5], [26, 53, 1.9, 4.3],
  ];
  const patches: Patch[] = patchSpecs.map(([x, z, rx, rz]) => ({ x, z, rx, rz, yaw: random() * Math.PI }));
  const forestTrees = trees.filter(t => t.s > .36 && allowed(t.x, t.z, .30));
  const sample = (kind: Kind = 'wood') => {
    const rootAffinity = kind === 'litter' || kind === 'wood' ? .72 : kind === 'sedge' ? .06 : .015;
    if (random() < rootAffinity && forestTrees.length) {
      const tree = forestTrees[Math.floor(random() * forestTrees.length)];
      const yaw = random() * Math.PI * 2, spread = .18 + random() ** .72 * (kind === 'litter' ? .82 : 1.75);
      return [tree.x + Math.cos(yaw) * spread, tree.z + Math.sin(yaw) * spread];
    }
    // Distant shrub/groundcover detail is grouped in the same colonies. A few
    // fringe plants remain; no regular grid or repeated grass stamps are used.
    const near = kind === 'litter' || kind === 'fern';
    const pool = near ? patches.slice(0, 8) : kind === 'shrub' ? patches.slice(4, 15) : patches.slice(2, 15);
    const patch = pool[Math.floor(random() * pool.length)];
    const yaw = random() * Math.PI * 2, distance = random() ** .68;
    const a = Math.cos(yaw) * distance * patch.rx, b = Math.sin(yaw) * distance * patch.rz;
    return [patch.x + a * Math.cos(patch.yaw) - b * Math.sin(patch.yaw),
      patch.z + a * Math.sin(patch.yaw) + b * Math.cos(patch.yaw)];
  };
  const habitat = (x: number, z: number) => .16 + noise(x * .24 + 3, z * .24 - 8) * .54
    + noise(x * .79 - 8, z * .79 + 21) * .30;
  const each = (kind: Kind, count: number, radius: number, make: (x: number, z: number) => boolean) => {
    for (let attempt = 0; attempt < count * 24 && plants[kind] < count; attempt++) {
      if (!batches[kind].fits(kind === 'fern' ? 240 : 32)) break;
      const [x, z] = sample(kind);
      if (!allowed(x, z, radius) || random() > habitat(x, z)) continue;
      if (make(x, z)) register(kind, x, z);
    }
  };

  each('fern', mobile ? 70 : 165, .64, (x, z) => {
    if (groundHeight(x, z) > 8 || (z > 42 && random() > .44)) return false;
    const origin: Point = [x, groundHeight(x, z) + .002, z];
    const scale = .73 + random() * .43, baseYaw = random() * Math.PI * 2;
    const fronds = 3 + Math.floor(random() * 3), baseColor = color('fern');
    for (let f = 0; f < fronds; f++) {
      const yaw = baseYaw + f * 2.4 + random() * .7;
      const length = (.28 + random() * .26) * scale, rise = (.14 + random() * .19) * scale;
      const dx = Math.cos(yaw), dz = Math.sin(yaw);
      const pinnae = 4 + Math.floor(random() * 2);
      blade(batches.fern, groundHeight, origin, yaw, length, .0021, rise * .8, baseColor, random);
      for (let k = 0; k < pinnae; k++) {
        const t = .21 + k / pinnae * .71;
        const ax = x + dx * length * t, az = z + dz * length * t;
        const ay = Math.max(groundHeight(ax, az) + .018, origin[1] + rise * Math.sin(t * 2.4));
        const pinnaLength = length * (.26 * Math.sin(t * Math.PI) + .035);
        for (const sign of [-1, 1]) leaf(batches.fern, groundHeight, [ax, ay, az],
          yaw + sign * (1.04 + random() * .18), pinnaLength, pinnaLength * (.19 + random() * .06),
          -.014 - random() * .025, .008, baseColor, random);
      }
    }
    return true;
  });

  each('herb', mobile ? 315 : 730, .47, (x, z) => {
    const origin: Point = [x, groundHeight(x, z) + .002, z], baseYaw = random() * Math.PI * 2;
    const amount = 4 + Math.floor(random() * 3), baseColor = color('herb');
    // Ground-hugging broadleaf herbs have enough actual leaf area to join
    // adjacent rosettes. Individual blades remain real 16–31 cm leaves.
    const scale = .72 + random() * .39;
    for (let i = 0; i < amount; i++) leaf(batches.herb, groundHeight, origin,
      baseYaw + i * 2.37 + random() * .5, (.16 + random() * .15) * scale,
      (.050 + random() * .039) * scale, .014 + random() * .045, .025 + random() * .028,
      baseColor, random);
    return true;
  });

  each('sedge', mobile ? 570 : 1320, .48, (x, z) => {
    const baseYaw = random() * Math.PI * 2, baseColor = color('sedge');
    const amount = 6 + Math.floor(random() * 5), scale = .60 + random() * .65;
    for (let i = 0; i < amount; i++) {
      const px = x + (random() - .5) * .055, pz = z + (random() - .5) * .055;
      blade(batches.sedge, groundHeight, [px, groundHeight(px, pz) + .002, pz],
        baseYaw + i * 2.38 + random() * .9, (.22 + random() * .20) * scale,
        .0042 + random() * .0049, (.15 + random() * .18) * scale, baseColor, random);
    }
    return true;
  });

  each('shrub', mobile ? 51 : 132, 1.02, (x, z) => {
    // Low broken banks make middle-distance depth, with a clear centre view.
    if ((z < 27 && x > -13 && x < 16) || (Math.abs(x) < 4.8 && z > 35)) return false;
    const origin: Point = [x, groundHeight(x, z) + .002, z];
    const height = .33 + random() * .39, baseYaw = random() * Math.PI * 2;
    const stems = 3 + Math.floor(random() * 2), foliage = color('shrub');
    for (let stem = 0; stem < stems; stem++) {
      const yaw = baseYaw + stem * 2.4 + random() * .8, spread = .28 + random() * .29;
      const tip: Point = [x + Math.cos(yaw) * spread, origin[1] + height * (.60 + random() * .40), z + Math.sin(yaw) * spread];
      tip[1] = Math.max(tip[1], groundHeight(tip[0], tip[2]) + .10);
      const middle: Point = [T.MathUtils.lerp(x, tip[0], .54), T.MathUtils.lerp(origin[1], tip[1], .54) + .022,
        T.MathUtils.lerp(z, tip[2], .54)];
      middle[1] = Math.max(middle[1], groundHeight(middle[0], middle[2]) + .05);
      woodTube(batches.wood, [origin, middle, tip], .0035 + random() * .003, color('wood'), random, 3);
      for (let node = 0; node < 5; node++) {
        const t = .29 + node * .137, sign = node % 2 ? -1 : 1;
        const joint: Point = [T.MathUtils.lerp(x, tip[0], t), T.MathUtils.lerp(origin[1], tip[1], t), T.MathUtils.lerp(z, tip[2], t)];
        joint[1] = Math.max(joint[1], groundHeight(joint[0], joint[2]) + .055);
        const branchYaw = yaw + sign * (1.12 + random() * .42), reach = node % 2 ? 0 : .09 + random() * .17;
        const end: Point = [joint[0] + Math.cos(branchYaw) * reach, joint[1] + .025 + random() * .06,
          joint[2] + Math.sin(branchYaw) * reach];
        end[1] = Math.max(end[1], groundHeight(end[0], end[2]) + .045);
        if (reach) woodTube(batches.wood, [joint, end], .0017, color('wood'), random, 3);
        for (let j = 0; j < 2; j++) {
          const at: Point = [T.MathUtils.lerp(joint[0], end[0], .56 + j * .44),
            T.MathUtils.lerp(joint[1], end[1], .56 + j * .44), T.MathUtils.lerp(joint[2], end[2], .56 + j * .44)];
          leaf(batches.shrub, groundHeight, at, branchYaw + (j ? .34 : -.63),
            .080 + random() * .080, .040 + random() * .036, -.025 + random() * .049, .008, foliage, random);
        }
      }
    }
    return true;
  });

  // Litter follows small drifts and culm bases. Each leaf is independently
  // conformed to the actual terrain triangles, even across a slope crease.
  each('litter', mobile ? 450 : 1030, .24, (x, z) => {
    const yaw = random() * Math.PI * 2, length = .058 + random() * .10;
    leaf(batches.litter, groundHeight, [x, groundHeight(x, z) + .0025, z], yaw,
      length, .012 + random() * .016, .001, .002 + random() * .008, color('litter'), random, true);
    return true;
  });

  const rootTrees = forestTrees.filter(t => t.z < 44 && t.x > -32 && t.x < 26);
  for (let i = 0; i < rootTrees.length && plants.wood < (mobile ? 65 : 150); i += mobile ? 5 : 3) {
    if (!batches.wood.fits(105)) break;
    const tree = rootTrees[i], count = random() < .6 ? 2 : 3;
    for (let strand = 0; strand < count; strand++) {
      const yaw = random() * Math.PI * 2, length = .28 + random() * .53;
      const radius = .007 + random() * .010, points: Point[] = [];
      for (let step = 0; step < 4; step++) {
        const t = step / 3, x = tree.x + Math.cos(yaw) * (.08 + length * t) + Math.sin(t * 5) * .036;
        const z = tree.z + Math.sin(yaw) * (.08 + length * t) + Math.sin(t * 4) * .038;
        points.push([x, groundHeight(x, z) + radius * .45 * (1 - t * .7), z]);
      }
      if (!points.every(p => allowed(p[0], p[2], .025))) continue;
      woodTube(batches.wood, points, radius, color('wood'), random, 5);
      register('wood', tree.x, tree.z);
    }
  }
  for (let i = 0; i < (mobile ? 28 : 70) && batches.wood.fits(90); i++) {
    const [x, z] = sample(), yaw = random() * Math.PI * 2, length = .31 + random() * .63;
    if (!allowed(x, z, length + .08)) continue;
    const radius = .012 + random() * .027;
    const points: Point[] = [0, .28, .65, 1].map(t => {
      const px = x + Math.cos(yaw) * length * t, pz = z + Math.sin(yaw) * length * t;
      return [px, groundHeight(px, pz) + radius * .49 * (1 - t * .76), pz];
    });
    woodTube(batches.wood, points, radius, color('wood'), random, 6);
    register('wood', x, z);
  }

  const plantMaterial = new T.MeshStandardMaterial({ vertexColors: true, roughness: .94,
    side: T.DoubleSide, forceSinglePass: true, metalness: 0 });
  plantMaterial.name = 'Muted_woodland_leaf_and_dry_fibre';
  const woodMaterial = new T.MeshStandardMaterial({ vertexColors: true, roughness: .99,
    side: T.DoubleSide, forceSinglePass: true });
  woodMaterial.name = 'Grey_brown_decomposing_wood';
  const layers: WoodlandFinishStats['layers'] = [];
  for (const [kind, batch] of Object.entries(batches) as [Kind, Batch][]) {
    if (!batch.triangles) continue;
    const geometry = batch.geometry();
    const mesh = new T.Mesh(geometry, kind === 'wood' ? woodMaterial : plantMaterial);
    mesh.name = batch.name;
    mesh.receiveShadow = true;
    mesh.castShadow = !mobile && (kind === 'shrub' || kind === 'fern' || kind === 'wood');
    mesh.userData.surfaceKind = kind === 'wood' ? 'Buried underside and per-ring soil contact' : 'Actual small folded leaves; roots on terrain triangles';
    group.add(mesh);
    let projectedAreaM2 = 0;
    for (let i = 0; i < batch.indices.length; i += 3) {
      const a = batch.indices[i] * 3, b = batch.indices[i + 1] * 3, c = batch.indices[i + 2] * 3, p = batch.positions;
      projectedAreaM2 += Math.abs((p[b] - p[a]) * (p[c + 2] - p[a + 2]) - (p[c] - p[a]) * (p[b + 2] - p[a + 2])) * .5;
    }
    layers.push({ name: mesh.name, triangles: batch.triangles, vertices: batch.positions.length / 3, projectedAreaM2 });
  }
  const rootGaps = roots.map(([x, y, z]) => y - groundHeight(x, z));
  const stats: WoodlandFinishStats = {
    triangles: layers.reduce((sum, layer) => sum + layer.triangles, 0),
    drawCalls: layers.length,
    plants,
    layers,
    protectedCourtyard: [-13, 10.5, -5, 9],
    minimumPathClearance: Number.isFinite(minimumPathClearance) ? minimumPathClearance : 0,
    minimumRootGap: rootGaps.length ? Math.min(...rootGaps) : 0,
    maximumRootGap: rootGaps.length ? Math.max(...rootGaps) : 0,
    colonyBounds: patches.map(p => ({ x: p.x, z: p.z, radiusX: p.rx, radiusZ: p.rz, yaw: p.yaw })),
    reference: 'pic/8.jpg: uneven low grey-brown bamboo litter, local dark green fern/herb colonies, small irregular woodland shrubs',
  };
  group.userData.woodlandFinish = stats;
  group.userData.rootPositions = roots;
  scene.add(group);
  let disposed = false;
  return {
    group,
    stats,
    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      for (const child of group.children) if (child instanceof T.Mesh) child.geometry.dispose();
      plantMaterial.dispose(); woodMaterial.dispose();
    },
  };
}
