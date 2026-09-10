import * as T from 'three';

type GroundSampler = (x: number, z: number) => number;
type GroundMesh = T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>;

/**
 * Fine ground detail from pic/2.jpg, pic/7.jpg and pic/8.jpg.
 * The bamboo floor is predominantly crushed brown leaves and dark soil. The
 * small green plants collect at damp margins; the concrete walking surface has
 * eroded aggregate and flattened, sundried moss. All geometry is sampled
 * against the same terrain as the camera.
 * No image plane, external texture, unlit material or additional light is used.
 */
export function addTerrainArt(
  scene: T.Scene,
  mobile: boolean,
  sampleGroundHeight: GroundSampler,
  pathClearance: GroundSampler,
) {
  const group = new T.Group();
  group.name = 'Photographic_terrain_detail';
  const random = seeded(927421);
  const textures: T.Texture[] = [];
  const materials: T.Material[] = [];
  const restored: { mesh: GroundMesh; original: T.MeshStandardMaterial; enhanced: T.MeshStandardMaterial }[] = [];
  const surfaceTexture = makeSurfaceTexture();
  const duffTexture = makeDuffTexture(mobile ? 512 : 1024);
  textures.push(surfaceTexture, duffTexture);

  // Enhance the actual terrain rather than overlaying a second terrain skin.
  // This preserves the existing geography, cast shadows and dusk/night cycle.
  for (const [name, isPath] of [
    ['Reservoir_bank_and_courtyard', false],
    ['Worn_footpath_from_courtyard', true],
  ] as const) {
    const mesh = scene.getObjectByName(name) as GroundMesh | undefined;
    if (!mesh?.isMesh || !mesh.material?.isMeshStandardMaterial) continue;
    const original = mesh.material;
    const enhanced = original.clone();
    const previousCompile = original.onBeforeCompile.bind(enhanced);
    enhanced.roughness = 1;
    // The texture is repeated in world coordinates in the shader. The small
    // relief is derivative based, so it cannot create floating geometry.
    enhanced.onBeforeCompile = function (shader, renderer) {
      previousCompile(shader, renderer);
      shader.uniforms.taSurface = { value: surfaceTexture };
      shader.uniforms.taDuffAtlas = { value: duffTexture };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 taWorld;\nvarying vec2 taUV;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\ntaWorld=(modelMatrix*vec4(transformed,1.0)).xyz;\ntaUV=uv;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 taWorld;\nvarying vec2 taUV;\nuniform sampler2D taSurface;\nuniform sampler2D taDuffAtlas;\n' + SURFACE_NOISE)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${isPath ? PATH_SURFACE : GROUND_SURFACE}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          // Relief and colour share the same erosion and moss masks. Fine
          // pebbles stand proud, missing mortar lies lower, living moss has a
          // little loft and trampled dead moss is practically flush.
          float taBump=taRelief;
          vec3 taDx=dFdx(-vViewPosition),taDy=dFdy(-vViewPosition);
          vec3 taR1=cross(taDy,normal),taR2=cross(normal,taDx);
          float taDet=dot(taDx,taR1);
          float taFace=gl_FrontFacing?1.0:-1.0;
          normal=normalize(abs(taDet)*normal-taFace*sign(taDet)*(dFdx(taBump)*taR1+dFdy(taBump)*taR2));
        `);
    };
    enhanced.customProgramCacheKey = () => `${original.customProgramCacheKey()}|photo-terrain-7-red-earth-decay|${isPath}`;
    mesh.material = enhanced;
    materials.push(enhanced);
    restored.push({ mesh, original, enhanced });
  }

  const dummy = new T.Object3D();
  const normal = new T.Vector3();
  const up = new T.Vector3(0, 1, 0);
  const rotation = new T.Quaternion();
  const color = new T.Color();
  const setOnGround = (x: number, z: number, yaw: number, lift = .005) => {
    const delta = .045;
    normal.set(
      sampleGroundHeight(x - delta, z) - sampleGroundHeight(x + delta, z),
      delta * 2,
      sampleGroundHeight(x, z - delta) - sampleGroundHeight(x, z + delta),
    ).normalize();
    dummy.position.set(x, sampleGroundHeight(x, z) + lift, z);
    dummy.quaternion.setFromUnitVectors(up, normal);
    rotation.setFromAxisAngle(up, yaw);
    dummy.quaternion.multiply(rotation);
  };

  const leafTexture = makeLeafTexture(false);
  const herbTexture = makeLeafTexture(true);
  textures.push(leafTexture, herbTexture);
  const leafMaterial = new T.MeshStandardMaterial({
    map: leafTexture, color: 0xffffff, roughness: .96,
    side: T.DoubleSide, alphaTest: .38, forceSinglePass: true,
  });
  const herbMaterial = new T.MeshStandardMaterial({
    map: herbTexture, color: 0xffffff, roughness: .91,
    side: T.DoubleSide, alphaTest: .38, forceSinglePass: true,
  });
  materials.push(leafMaterial, herbMaterial);

  const leafCount = mobile ? 2600 : 6300;
  const litter = new T.InstancedMesh(makeLeafGeometry(false), leafMaterial, leafCount);
  litter.name = 'Curled_bamboo_leaf_litter';
  litter.receiveShadow = true;
  let count = 0;
  // Uneven, overlapping accumulations, not a uniform field of isolated leaves.
  for (let cluster = 0; cluster < 1100 && count < leafCount; cluster++) {
    const cx = -25 + random() * 51;
    const cz = -13 + random() * 49;
    if (!canDress(cx, cz, sampleGroundHeight, pathClearance, .07)) continue;
    const moisture = habitat(cx, cz);
    if (random() > .43 + moisture * .55) continue;
    const radius = .22 + random() * .92;
    const amount = 5 + Math.floor(random() * 28);
    const drift = random() * Math.PI * 2;
    for (let j = 0; j < amount && count < leafCount; j++) {
      const angle = random() * Math.PI * 2;
      const r = Math.sqrt(random()) * radius;
      const x = cx + Math.cos(angle) * r;
      const z = cz + Math.sin(angle) * r * (.36 + random() * .58);
      if (!canDress(x, z, sampleGroundHeight, pathClearance, .015)) continue;
      const yaw = drift + (random() - .5) * 4;
      setOnGround(x, z, yaw, .003 + random() * .004);
      const length = .6 + random() * .86;
      dummy.scale.set(.68 + random() * .66, .5 + random() * .9, length);
      dummy.updateMatrix();
      litter.setMatrixAt(count, dummy.matrix);
      // Grey wet leaves, faded yellow leaves and dark half-decayed fragments.
      const shade = .48 + random() * .48;
      color.setRGB(shade, shade * (.82 + random() * .18), shade * (.65 + random() * .24));
      litter.setColorAt(count++, color);
    }
  }
  litter.count = count;
  litter.computeBoundingSphere();
  group.add(litter);

  const herbs = new T.InstancedMesh(makeLeafGeometry(true), herbMaterial, mobile ? 850 : 1950);
  herbs.name = 'Small_margin_rosettes';
  herbs.receiveShadow = true;
  count = 0;
  for (let plant = 0; plant < 1900 && count < herbs.instanceMatrix.count; plant++) {
    const edgePlant = random() < .44;
    const x = edgePlant ? -13.3 + random() * 24.6 : -23 + random() * 47;
    const z = edgePlant ? 8.52 + random() * 1.13 : -11 + random() * 43;
    if (!canDress(x, z, sampleGroundHeight, pathClearance, .25)) continue;
    if (random() > habitat(x, z) * .54 + .13) continue;
    const s = .4 + random() * .75;
    const angle = random() * Math.PI * 2;
    const number = 4 + Math.floor(random() * 5);
    for (let j = 0; j < number && count < herbs.instanceMatrix.count; j++) {
      setOnGround(x + (random() - .5) * .024, z + (random() - .5) * .024, angle + j * 2.399, .002);
      dummy.scale.set(s * (.64 + random() * .58), s * (.6 + random() * .62), s * (.66 + random() * .71));
      dummy.updateMatrix();
      herbs.setMatrixAt(count, dummy.matrix);
      color.setHex([0xb8c29b, 0x9fb280, 0x82906c, 0xc2bb8d, 0xa0ad7b][Math.floor(random() * 5)]);
      herbs.setColorAt(count++, color);
    }
  }
  herbs.count = count;
  herbs.computeBoundingSphere();
  group.add(herbs);

  const stoneGeometry = new T.IcosahedronGeometry(1, 0);
  const vertices = stoneGeometry.attributes.position;
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i), y = vertices.getY(i), z = vertices.getZ(i);
    // Weathered, flaked stones rather than equally rounded decorative pebbles.
    vertices.setXYZ(i, x * (1 + .13 * Math.sin(z * 7)), y * (.8 + .15 * Math.cos(x * 5)), z * (1 + .18 * Math.sin(x * 6)));
  }
  stoneGeometry.computeVertexNormals();
  const stoneTexture = surfaceTexture.clone();
  stoneTexture.repeat.set(2.8, 2.8);
  stoneTexture.needsUpdate = true;
  textures.push(stoneTexture);
  const stoneMaterial = new T.MeshStandardMaterial({ color: 0x645944, roughness: 1, bumpMap: stoneTexture, bumpScale: .009 });
  materials.push(stoneMaterial);
  const stones = new T.InstancedMesh(stoneGeometry, stoneMaterial, mobile ? 78 : 155);
  stones.name = 'Embedded_angular_bank_stones';
  stones.castShadow = true;
  stones.receiveShadow = true;
  count = 0;
  for (let i = 0; i < 1400 && count < stones.instanceMatrix.count; i++) {
    const margin = random() < .57;
    const x = margin ? 9.7 + random() * 7 : -24 + random() * 48;
    const z = margin ? -5 + random() * 23 : -10 + random() * 44;
    if (!canDress(x, z, sampleGroundHeight, pathClearance, .15)) continue;
    const s = .022 + random() ** 2 * .08;
    setOnGround(x, z, random() * Math.PI * 2, -.035 * s / .16);
    dummy.scale.set(s * (.8 + random() * .5), s * (.23 + random() * .28), s * (.65 + random() * .6));
    dummy.updateMatrix();
    stones.setMatrixAt(count, dummy.matrix);
    color.setHex([0xb0aa96, 0x837a65, 0x7e8173, 0xa3957c, 0x746c58][Math.floor(random() * 5)]);
    stones.setColorAt(count++, color);
  }
  stones.count = count;
  stones.computeBoundingSphere();
  group.add(stones);

  // One merged mesh includes partly buried roots, broken leaf stems and fine
  // twigs. Ground-following centerlines keep them seated on steep banks too.
  const branchGeometry = makeRootAndTwigGeometry(random, mobile, sampleGroundHeight, pathClearance);
  const branchMaterial = new T.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 1 });
  materials.push(branchMaterial);
  const branches = new T.Mesh(branchGeometry, branchMaterial);
  branches.name = 'Buried_roots_and_fine_fallen_twigs';
  branches.receiveShadow = true;
  group.add(branches);
  scene.add(group);

  const triangles = [litter, herbs, stones].reduce((sum, mesh) => sum + mesh.count * (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3, 0)
    + (branchGeometry.index?.count ?? branchGeometry.attributes.position.count) / 3;
  group.userData.detailBudget = { additionalDrawCalls: 4, triangles, leafInstances: litter.count, herbLeaves: herbs.count, stones: stones.count };

  return {
    group,
    dispose() {
      group.removeFromParent();
      group.traverse(object => { if ((object as T.Mesh).isMesh) (object as T.Mesh).geometry.dispose(); });
      for (const { mesh, original, enhanced } of restored) {
        if (mesh.material === enhanced) mesh.material = original;
      }
      materials.forEach(material => material.dispose());
      textures.forEach(texture => texture.dispose());
    },
  };
}

function seeded(seed: number) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let n = Math.imul(seed ^ seed >>> 15, 1 | seed);
    n = n + Math.imul(n ^ n >>> 7, 61 | n) ^ n;
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
}

function habitat(x: number, z: number) {
  const shade = .5 + .25 * Math.sin(x * .63 + z * .41) + .2 * Math.cos(x * 1.29 - z * .79);
  const margin = Math.exp(-(((z - 9) / 1.6) ** 2)) * .35;
  const toe = Math.exp(-(((x - 10.3) / 2.3) ** 2) - ((z - 2.4) / 9) ** 2) * .28;
  return T.MathUtils.clamp(shade + margin + toe, 0, 1);
}

function canDress(x: number, z: number, ground: GroundSampler, path: GroundSampler, clearance: number) {
  // Do not intrude into the architecture, doorstep props or main hard court.
  // The annex soil, bucket and weeds are authored independently in the asset.
  if (x > -13.25 && x < 10.05 && z > -5.35 && z < 8.72) return false;
  if (x > -3 && x < 3 && z > 8.72 && z < 13.15) return false;
  return ground(x, z) > -1.2 && path(x, z) > clearance;
}

function makeLeafGeometry(herb: boolean) {
  const geometry = new T.BufferGeometry();
  if (herb) {
    geometry.setAttribute('position', new T.Float32BufferAttribute([
      0, 0, 0, -.028, .035, .055, 0, .051, .073,
      .027, .028, .056, 0, .037, .131,
    ], 3));
    geometry.setAttribute('uv', new T.Float32BufferAttribute([.5, 0, 0, .42, .5, .55, 1, .42, .5, 1], 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3, 1, 4, 2, 2, 4, 3]);
  } else {
    geometry.setAttribute('position', new T.Float32BufferAttribute([
      0, 0, 0, -.013, .002, .055, 0, .008, .064,
      .013, .001, .054, -.008, .005, .131, .007, .002, .138,
      -.006, .014, .191,
    ], 3));
    geometry.setAttribute('uv', new T.Float32BufferAttribute([.5, 0, 0, .28, .5, .34, 1, .28, .14, .7, .85, .73, .37, 1], 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3, 1, 4, 2, 2, 5, 3, 2, 4, 6, 2, 6, 5]);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function makeSurfaceTexture() {
  // A packed physical detail atlas, not four copies of white noise:
  // R = micro relief; G = exposed aggregate; B = flattened organic fibres;
  // A = missing mortar, tiny fissures and erosion pits. A is surface data here,
  // never transparency. Multiple world-space scales break visible repetition.
  const size = 512, data = new Uint8Array(size * size * 4), random = seeded(1813);
  const grain = new Float32Array(size * size);
  const aggregate = new Float32Array(size * size);
  const fibre = new Float32Array(size * size);
  const pits = new Float32Array(size * size);
  const index = (x: number, y: number) => ((y + size * 4) % size) * size + (x + size * 4) % size;
  for (let i = 0; i < grain.length; i++) grain[i] = random();

  const dab = (target: Float32Array, cx: number, cy: number, rx: number, ry: number, strength: number, angle: number) => {
    const extent = Math.ceil(Math.max(rx, ry) + 1), sine = Math.sin(angle), cosine = Math.cos(angle);
    for (let y = -extent; y <= extent; y++) for (let x = -extent; x <= extent; x++) {
      const dx = (x * cosine + y * sine) / rx, dy = (-x * sine + y * cosine) / ry;
      const d = dx * dx + dy * dy;
      if (d >= 1) continue;
      const i = index(Math.floor(cx + x), Math.floor(cy + y));
      target[i] = Math.max(target[i], strength * Math.min(1, (1 - d) * 3.2));
    }
  };
  // Unequal angular mineral chips, from sand grit to a few-millimetre grain.
  for (let i = 0; i < 4900; i++) {
    const radius = .55 + random() ** 2 * 3.7;
    dab(aggregate, random() * size, random() * size, radius, radius * (.43 + random() * .62), .48 + random() * .52, random() * Math.PI);
  }
  for (let i = 0; i < 2100; i++) {
    const radius = .6 + random() ** 2 * 4.4;
    dab(pits, random() * size, random() * size, radius, radius * (.51 + random() * .51), .3 + random() * .7, random() * Math.PI);
  }
  // Broken matted leaf/old moss filaments have coherent little centerlines.
  // Short arcs overlap; they do not form a regular striped texture.
  for (let i = 0; i < 1300; i++) {
    const x = random() * size, y = random() * size, angle = random() * Math.PI * 2;
    const length = 3 + random() * 20, bend = (random() - .5) * 4;
    for (let step = 0; step <= length; step += .85) {
      const t = step / length, curve = Math.sin(t * Math.PI) * bend;
      dab(fibre, x + Math.cos(angle) * step - Math.sin(angle) * curve,
        y + Math.sin(angle) * step + Math.cos(angle) * curve, .68, .68, .36 + Math.sin(t * Math.PI) * .54, 0);
    }
  }
  // Sparse, discontinuous hairline fissures with small branches. Their shader
  // visibility is additionally gated by the broad damaged-mortar mask.
  for (let crack = 0; crack < 42; crack++) {
    let x = random() * size, y = random() * size, direction = random() * Math.PI * 2;
    const length = 13 + random() * 43;
    for (let step = 0; step < length; step++) {
      direction += (random() - .5) * .27;
      x += Math.cos(direction); y += Math.sin(direction);
      if (random() > .08) dab(pits, x, y, .63, .63, .83, 0);
      if (step % 11 === 0) {
        const branchAngle = direction + (random() > .5 ? .8 : -.8);
        for (let branch = 0; branch < 4 + random() * 7; branch++) {
          dab(pits, x + Math.cos(branchAngle) * branch, y + Math.sin(branchAngle) * branch, .51, .51, .62, 0);
        }
      }
    }
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const j = y * size + x, i = j * 4;
    const smooth = (grain[j] + grain[index(x - 1, y)] + grain[index(x + 1, y)] + grain[index(x, y - 1)] + grain[index(x, y + 1)]) / 5;
    data[i] = Math.round(255 * T.MathUtils.clamp(.32 + smooth * .33 + aggregate[j] * .24 - pits[j] * .22 + fibre[j] * .055, 0, 1));
    data[i + 1] = Math.round(255 * aggregate[j]);
    data[i + 2] = Math.round(255 * T.MathUtils.clamp(.14 + fibre[j] * .68 + smooth * .14, 0, 1));
    data[i + 3] = Math.round(255 * pits[j]);
  }
  const texture = new T.DataTexture(data, size, size, T.RGBAFormat);
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.magFilter = T.LinearFilter;
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function makeDuffTexture(size: number) {
  // A seamless 2 × 2 m mat of actual narrow leaf silhouettes. Colour variation,
  // coverage and relief are stored independently (R/G/B); A distinguishes fine
  // woody stems. These are flattened litter shapes, without photographed light
  // or shadows, so they still respond to the scene's real day/night lighting.
  const data = new Uint8Array(size * size * 4), random = seeded(361901);
  const pixelsPerMetre = size / 2;
  const wrapped = (x: number, y: number) => (((y + size * 2) % size) * size + (x + size * 2) % size) * 4;
  const draw = (twig: boolean) => {
    const cx = random() * size, cy = random() * size;
    const length = (twig ? .055 + random() * .13 : .04 + random() * .10) * pixelsPerMetre;
    const halfWidth = (twig ? .00055 + random() * .0011 : .0028 + random() * .0045) * pixelsPerMetre;
    const angle = random() * Math.PI * 2, sine = Math.sin(angle), cosine = Math.cos(angle);
    const bend = (random() - .5) * length * (twig ? .07 : .22);
    const extentX = Math.ceil(Math.abs(cosine) * length * .5 + Math.abs(sine) * (halfWidth + Math.abs(bend)) + 2);
    const extentY = Math.ceil(Math.abs(sine) * length * .5 + Math.abs(cosine) * (halfWidth + Math.abs(bend)) + 2);
    const shade = .24 + random() * .55;
    for (let y = -extentY; y <= extentY; y++) for (let x = -extentX; x <= extentX; x++) {
      const t = (x * cosine + y * sine) / length + .5;
      if (t <= 0 || t >= 1) continue;
      const across = -x * sine + y * cosine - Math.sin(t * Math.PI) * bend;
      const width = halfWidth * (twig ? 1 - t * .62 : Math.sin(t * Math.PI) ** .76);
      const coverage = T.MathUtils.clamp(width + .55 - Math.abs(across), 0, 1);
      if (!coverage) continue;
      const edge = Math.min(1, Math.abs(across) / Math.max(.25, width));
      const rib = Math.exp(-Math.abs(across) * 3.8);
      const color = T.MathUtils.clamp(shade * (1 - edge * .13) + rib * .10 + Math.sin(t * 59 + edge * 7) * .027, 0, 1);
      const height = twig ? .38 + (1 - edge) * .45 : .17 + (1 - edge) * .39 + rib * .14;
      const i = wrapped(Math.floor(cx + x), Math.floor(cy + y));
      data[i] = Math.round(data[i] * (1 - coverage) + color * 255 * coverage);
      data[i + 1] = Math.max(data[i + 1], Math.round(coverage * 255));
      data[i + 2] = Math.round(data[i + 2] * (1 - coverage) + height * 255 * coverage);
      data[i + 3] = Math.round(data[i + 3] * (1 - coverage) + (twig ? 255 : 0) * coverage);
    }
  };
  // The reference has dense interwoven duff between culms, not a scattering of
  // large isolated leaves on bare earth. A second rotated sample supplies the
  // partly decomposed lower layer and breaks the visible two-metre repeat.
  for (let i = 0; i < 3400; i++) draw(false);
  for (let i = 0; i < 410; i++) draw(true);
  const texture = new T.DataTexture(data, size, size, T.RGBAFormat);
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.magFilter = T.LinearFilter;
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function makeLeafTexture(herb: boolean) {
  const width = 64, height = 256, data = new Uint8Array(width * height * 4);
  const random = seeded(herb ? 723 : 563);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const u = x / (width - 1), v = y / (height - 1);
    const ridge = Math.exp(-(((u - .5) * 41) ** 2));
    const fibre = Math.sin(u * 195 + Math.sin(v * 33) * 1.4) * .065;
    const sideVein = Math.pow(.5 + .5 * Math.sin(v * 109 - Math.abs(u - .5) * 38), 15) * .14;
    const brownSpot = Math.exp(-(((u - .3) * 13) ** 2) - ((v - .61) * 30) ** 2) * .4;
    const shade = .77 + fibre + random() * .18 - brownSpot - Math.abs(u - .5) * .18;
    const rgb = herb ? [72, 103, 38] : [180, 153, 100];
    data[i] = Math.min(255, rgb[0] * shade + ridge * (herb ? 25 : 31));
    data[i + 1] = Math.min(255, rgb[1] * shade + ridge * 23 - sideVein * 31);
    data[i + 2] = Math.min(255, rgb[2] * shade + ridge * 17);
    // Tiny torn nicks are restricted to a tip/edge; most leaves remain intact.
    data[i + 3] = !herb && v > .7 && Math.abs(u - .5) > .28 && random() > .92 ? 0 : 255;
  }
  const texture = new T.DataTexture(data, width, height, T.RGBAFormat);
  texture.colorSpace = T.SRGBColorSpace;
  texture.magFilter = T.LinearFilter;
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function makeRootAndTwigGeometry(random: () => number, mobile: boolean, ground: GroundSampler, path: GroundSampler) {
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  const palette = [0x63513b, 0x756a4f, 0x8d7b56, 0x4e4331].map(hex => new T.Color(hex));
  const axis = new T.Vector3(), cross = new T.Vector3(), side = new T.Vector3();
  const append = (points: T.Vector3[], radius: number, tint: T.Color) => {
    const first = positions.length / 3, sides = 4;
    for (let j = 0; j < points.length; j++) {
      axis.copy(points[Math.min(j + 1, points.length - 1)]).sub(points[Math.max(0, j - 1)]).normalize();
      cross.set(0, 1, 0).cross(axis).normalize();
      side.crossVectors(axis, cross).normalize();
      const r = radius * (1 - j / points.length * .77);
      for (let k = 0; k < sides; k++) {
        const a = k / sides * Math.PI * 2;
        positions.push(points[j].x + (cross.x * Math.cos(a) + side.x * Math.sin(a)) * r,
          points[j].y + (cross.y * Math.cos(a) + side.y * Math.sin(a)) * r,
          points[j].z + (cross.z * Math.cos(a) + side.z * Math.sin(a)) * r);
        const shade = .78 + k % 2 * .19;
        colors.push(tint.r * shade, tint.g * shade, tint.b * shade);
        if (j < points.length - 1) {
          const p = first + j * sides + k, q = first + j * sides + (k + 1) % sides;
          indices.push(p, p + sides, q, q, p + sides, q + sides);
        }
      }
    }
  };
  const total = mobile ? 160 : 330;
  for (let i = 0; i < total; i++) {
    const root = i % 5 === 0;
    const x = root ? 9.5 + random() * 13 : -24 + random() * 49;
    const z = root ? -8 + random() * 24 : -12 + random() * 47;
    const angle = random() * Math.PI * 2;
    const length = root ? .4 + random() * 1.2 : .14 + random() * .65;
    const radius = root ? .009 + random() * .016 : .0024 + random() * .003;
    const points: T.Vector3[] = [];
    const segments = root ? 7 : 3;
    let valid = true;
    for (let j = 0; j <= segments; j++) {
      const t = j / segments;
      const bend = Math.sin(t * Math.PI) * length * (root ? .13 : .037);
      const px = x + Math.sin(angle) * t * length + Math.cos(angle) * bend;
      const pz = z + Math.cos(angle) * t * length - Math.sin(angle) * bend;
      if (!canDress(px, pz, ground, path, root ? .2 : .04)) { valid = false; break; }
      points.push(new T.Vector3(px, ground(px, pz) + radius * .37 + Math.sin(t * Math.PI) * radius * .6, pz));
    }
    if (valid) append(points, radius, palette[Math.floor(random() * palette.length)]);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

const SURFACE_NOISE = `
  float taHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float taNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(taHash(i),taHash(i+vec2(1,0)),f.x),mix(taHash(i+vec2(0,1)),taHash(i+vec2(1,1)),f.x),f.y);}
  float taFbm(vec2 p){return taNoise(p)*.57+taNoise(p*2.09)*.28+taNoise(p*4.21)*.15;}

  // Decades of weather affect separate physical layers. The same masks drive
  // pigment, relief and roughness rather than merely multiplying a noise map.
  void taOldConcrete(vec2 p,float traffic,float margin,float humidity,
    out vec3 pigment,out float relief,out float surfaceRoughness){
    vec4 micro=texture2D(taSurface,p*1.73);
    vec4 fractured=texture2D(taSurface,mat2(.798,.603,-.603,.798)*p*.41+vec2(.13,.38));
    vec2 warp=vec2(taFbm(p*.72+14.6),taFbm(p*.66-9.7))-.5;
    float broad=taFbm(p*.43+warp*1.8);
    float broken=taFbm(p*2.7+warp*.9);
    float mortarLoss=smoothstep(.31,.72,broken*.73+broad*.27);
    float colonies=smoothstep(.425,.565,taFbm(p*1.08+warp*2.8)+(micro.b-.4)*.15+(taNoise(p*10.7)-.5)*.085);
    float fibre=smoothstep(.27,.67,micro.b)*.61+smoothstep(.27,.67,fractured.b)*.39;
    float dryExposure=1.-smoothstep(.40,.70,humidity);
    float organic=clamp(colonies*(.76+margin*.43+humidity*.16)*(1.-dryExposure*.70),0.,.96);
    float dried=clamp(traffic*.9+(1.-humidity)*.38+smoothstep(.49,.69,broad)*.14,0.,1.);
    float damp=clamp(humidity*.63+margin*.24-traffic*.24,0.,.93);
    // Grit is visible close up, while the coarser 5–20 mm chips survive the
    // oblique walking view. Both are discontinuous shapes, not soft clouds.
    float coarseChip=smoothstep(.31,.82,fractured.g);
    float aggregate=clamp(smoothstep(.28,.80,micro.g)*.53+coarseChip*.79,0.,1.)*(.40+mortarLoss*.60)*(1.-organic*.63);
    float paleChip=max(smoothstep(.64,.92,micro.g)*.43,smoothstep(.54,.88,fractured.g)*.83)*(1.-organic*.72);
    float pits=(micro.a*.52+fractured.a*.48)*mortarLoss;
    float limeCrust=smoothstep(.51,.65,taFbm(p*11.3+warp*2.1))*smoothstep(.45,.63,broad)*mortarLoss;
    float sand=smoothstep(.29,.75,broad+fractured.b*.09)*traffic;

    vec3 oldBinder=mix(vec3(.067,.073,.061),vec3(.154,.155,.129),broad*.71+broken*.22);
    oldBinder=mix(oldBinder,vec3(.186,.178,.144),sand*.36);
    oldBinder=mix(oldBinder,vec3(.028,.034,.024),damp*.29);
    oldBinder=mix(oldBinder,vec3(.267,.273,.231),aggregate*.87);
    oldBinder=mix(oldBinder,vec3(.378,.388,.339),paleChip*.69);
    oldBinder=mix(oldBinder,vec3(.292,.307,.262),limeCrust*.48);
    // Sun-dried courtyard binder is warm grey; green-black organic matter
    // belongs to sheltered margins. Humid forest paths keep their wet patina.
    oldBinder=mix(oldBinder,vec3(.205,.199,.178),dryExposure*.48);

    // Green-black remnants survive at moist edges and low spots. Across the
    // walking line the same colonies are compressed into grey-brown dry felt.
    vec3 living=mix(vec3(.021,.029,.017),vec3(.052,.062,.033),broken*.62+fibre*.21);
    vec3 dead=mix(vec3(.085,.073,.052),vec3(.177,.158,.119),broken*.69+fibre*.23);
    vec3 moss=mix(living,dead,dried);
    float frayed=4.*colonies*(1.-colonies)*fibre;
    moss+=vec3(.048,.043,.031)*frayed*dried;
    moss*=.88+micro.r*.24;
    pigment=mix(oldBinder,moss,organic);
    // Pits are recesses, with a little impacted dark organic sediment.
    pigment=mix(pigment,vec3(.025,.027,.019),pits*(.37+organic*.16));
    pigment*=.94+micro.r*.13;
    float liveMat=organic*(1.-dried),dryMat=organic*dried;
    relief=(micro.r*.0021+aggregate*.0032-pits*.0038)*(1.-dryExposure*.44)+liveMat*.0034+dryMat*.00065;
    surfaceRoughness=clamp(.973-damp*.086-aggregate*.042+dryMat*.026,.83,1.);
  }
`;

const GROUND_SURFACE = `
  vec2 taP=taWorld.xz;
  vec4 taMicro=texture2D(taSurface,taP*1.73);
  vec4 taMeso=texture2D(taSurface,mat2(.798,.603,-.603,.798)*taP*.41+vec2(.13,.38));
  float taBroad=taFbm(taP*.61);
  float taEdgeNoise=(taFbm(taP*2.1)-.5)*.25;
  float taYard=smoothstep(-13.1,-12.65,taP.x+taEdgeNoise)*(1.-smoothstep(9.6,10.02,taP.x+taEdgeNoise))
    *smoothstep(-5.05,-4.65,taP.y)*(1.-smoothstep(8.12,8.81,taP.y+taEdgeNoise));
  float taToe=exp(-pow((taP.x-10.25)/1.4,2.))*exp(-pow((taP.y-1.6)/9.,2.));
  float taDamp=smoothstep(.33,.69,taFbm(taP*.82+15.));
  float taMargin=exp(-pow((taP.y-8.6)/.64,2.))*(1.-smoothstep(10.,11.5,abs(taP.x)));
  float taSheltered=1.-smoothstep(1.5,7.8,taP.y);
  float taDryFibre=smoothstep(.30,.73,taMicro.b)*.43+smoothstep(.30,.73,taMeso.b)*.57;
  float taDuff=smoothstep(.34,.70,taFbm(taP*.92+vec2(taMeso.b,taMeso.r)*1.6));

  vec3 taClay=mix(vec3(.100,.048,.023),vec3(.224,.110,.048),taBroad*.73+taMicro.g*.16);
  vec3 taHumus=mix(vec3(.025,.025,.016),vec3(.087,.076,.048),taBroad);
  float taForest=smoothstep(9.,18.,taP.y)*(1.-smoothstep(31.,39.,taP.x));
  vec3 taEarth=mix(taHumus,taClay,smoothstep(.35,.70,taFbm(taP*.38-11.))*mix(.84,.30,taForest));
  // Uneven mats of flattened old bamboo litter sit over darker damp humus.
  // Only their broken fibres catch light, leaving broad areas of dark duff.
  vec3 taOldDuff=mix(vec3(.043,.040,.026),mix(vec3(.129,.105,.065),vec3(.108,.101,.078),taForest),taBroad*.72+taDryFibre*.23);
  taEarth=mix(taEarth,taOldDuff,taDuff*.77);
  taEarth=mix(taEarth,vec3(.188,.154,.094),taDryFibre*taDuff*.20);
  float taRill=1.-smoothstep(.022,.071,abs(taNoise(vec2(taP.x*2.7+taNoise(taP*1.9)*1.6,taP.y*.18))-.52));
  taEarth=mix(taEarth,taClay*.64,taRill*taToe*.42);
  taEarth=mix(taEarth,vec3(.021,.026,.016),taDamp*(.16+taToe*.13));
  float taMossMask=taDamp*(.09+taToe*.40+taMargin*.47)*smoothstep(.31,.65,taFbm(taP*4.2));
  vec3 taMoss=mix(vec3(.018,.031,.013),vec3(.058,.076,.030),taMicro.r);
  taEarth=mix(taEarth,taMoss,clamp(taMossMask,0.,.78));
  taEarth*=.91+taMicro.r*.18;

  // Flattened bamboo litter reads as many crossing 4–14 cm lanceolate leaves
  // with fine ribs and short woody splinters. It belongs only to forest soil;
  // the courtyard and separate footpath retain their concrete material.
  vec4 taLowerLitter=texture2D(taDuffAtlas,mat2(.681,.732,-.732,.681)*taP*.5+vec2(.237,.713));
  vec4 taUpperLitter=texture2D(taDuffAtlas,taP*.5);
  float taLitterRetention=.71+taDuff*.26;
  vec3 taLowerPigment=mix(vec3(.029,.029,.020),vec3(.091,.082,.057),taLowerLitter.r);
  vec3 taUpperPigment=mix(vec3(.052,.049,.034),vec3(.155,.139,.095),taUpperLitter.r);
  vec3 taTwigPigment=mix(vec3(.036,.031,.022),vec3(.102,.089,.059),taUpperLitter.r);
  taUpperPigment=mix(taUpperPigment,taTwigPigment,taUpperLitter.a*.77);
  taUpperPigment*=1.-taDamp*.13;
  taEarth=mix(taEarth,taLowerPigment,taLowerLitter.g*taLitterRetention*.76);
  taEarth=mix(taEarth,taUpperPigment,taUpperLitter.g*taLitterRetention*.86);
  float taLitterRelief=taLowerLitter.g*taLowerLitter.b*.0011+taUpperLitter.g*taUpperLitter.b*.0023;

  float taCourtTraffic=.46+smoothstep(.29,.69,taFbm(vec2(taP.x*.23,taP.y*.62)+21.))*.33;
  float taCourtHumidity=clamp(.27+taSheltered*.27+taToe*.17+taDamp*.10,0.,1.);
  vec3 taCement;float taCementRelief;float taCementRoughness;
  taOldConcrete(taP,taCourtTraffic,taMargin,taCourtHumidity,taCement,taCementRelief,taCementRoughness);
  vec3 taBase=mix(taEarth,taCement,taYard);
  float taSoilRelief=taMicro.r*.0038+taMeso.r*.0054+taDuff*.004+taMossMask*.003+taLitterRelief;
  float taRelief=mix(taSoilRelief,taCementRelief,taYard);
  // Keep the same humus and leaf pigment through the visible distant banks;
  // the former short cutoff exposed a flat pale base halfway up the forest.
  float taRegion=(1.-smoothstep(60.,85.,abs(taP.x)))*(1.-smoothstep(80.,105.,abs(taP.y-6.)));
  diffuseColor.rgb=mix(diffuseColor.rgb,taBase,taRegion);
  roughnessFactor=mix(roughnessFactor,mix(.97-taDamp*.045,taCementRoughness,taYard),taRegion);
`;

const PATH_SURFACE = `
  vec2 taP=taWorld.xz;
  // UV.x is width-normalized on the existing path. Worn traffic meanders down
  // its center; the margins retain old damp colonies. There are no literal
  // repeating footprint decals or an immaculate painted center stripe.
  float taWander=(taFbm(vec2(taP.y*.31,7.2))-.5)*.19;
  float taCross=abs(taUV.x-.5+taWander);
  float taEdge= smoothstep(.24,.49,taCross+(taFbm(taP*3.9)-.5)*.11);
  float taTraffic=(1.-smoothstep(.09,.46,taCross))*(.65+taFbm(taP*.71+4.)*.31);
  float taHumidity=clamp(.55+taEdge*.23+taFbm(taP*.36+27.)*.17,0.,1.);
  vec3 taWorn;float taRelief;float taRoughness;
  taOldConcrete(taP,taTraffic,taEdge,taHumidity,taWorn,taRelief,taRoughness);
  // Accumulated dark soil merges into crumbling edges in intermittent patches.
  float taInvasion=taEdge*smoothstep(.39,.72,taFbm(taP*2.9+16.))*.59;
  taWorn=mix(taWorn,vec3(.036,.034,.020),taInvasion);
  diffuseColor.rgb=taWorn;
  roughnessFactor=taRoughness;
`;
