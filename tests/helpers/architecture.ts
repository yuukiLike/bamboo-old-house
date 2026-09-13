import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export async function loadArchitecture() {
  const file = readFileSync(new URL('../../public/models/architecture.glb', import.meta.url));
  const jsonLength = file.readUInt32LE(12), binary = file.subarray(28 + jsonLength);
  const gltf = JSON.parse(file.subarray(20, 20 + jsonLength).toString());
  // Keep the actual compressed geometry; omit textures so acceptance checks
  // do not require browser image decoding or a WebGL context.
  gltf.materials = gltf.materials.map((material: { name: string }) => ({ name: material.name, doubleSided: true }));
  delete gltf.textures; delete gltf.images;
  const json = Buffer.from(JSON.stringify(gltf));
  const padding = Buffer.alloc((4 - json.length % 4) % 4, 32);
  const result = Buffer.alloc(28 + json.length + padding.length + binary.length);
  result.writeUInt32LE(0x46546c67, 0); result.writeUInt32LE(2, 4); result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(json.length + padding.length, 12); result.writeUInt32LE(0x4e4f534a, 16);
  json.copy(result, 20); padding.copy(result, 20 + json.length);
  result.writeUInt32LE(binary.length, 20 + json.length + padding.length);
  result.writeUInt32LE(0x004e4942, 24 + json.length + padding.length);
  binary.copy(result, 28 + json.length + padding.length);
  return (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(result.buffer, '')).scene;
}
