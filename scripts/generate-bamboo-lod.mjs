import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {MeshoptSimplifier} from 'meshoptimizer/simplifier';

// Build-time only: keep original vertices, UVs, normals and culm curves.
// The distant band gets an index-only LOD with a 5 mm absolute error budget.
const input=new URL('../public/models/bamboo.glb',import.meta.url);
const output=new URL('../src/components/scene/generated/bamboo-lod.json',import.meta.url);
const data=readFileSync(input),length=data.readUInt32LE(12);
assert.equal(data.readUInt32LE(0),0x46546c67);assert.equal(data.readUInt32LE(4),2);
const gltf=JSON.parse(data.subarray(20,20+length).toString());
const binary=data.subarray(28+length);
function accessor(id,position=false){
 const a=gltf.accessors[id],view=gltf.bufferViews[a.bufferView];
 assert.ok(!a.sparse&&!view.extensions,'Re-export bamboo as uncompressed GLB before generating LODs');
 const width=position?3:1,Type=position?Float32Array:a.componentType===5123?Uint16Array:Uint32Array;
 assert.equal(a.type,position?'VEC3':'SCALAR');
 assert.ok(position?a.componentType===5126:[5123,5125].includes(a.componentType));
 const start=(view.byteOffset??0)+(a.byteOffset??0),stride=view.byteStride??width*Type.BYTES_PER_ELEMENT;
 const values=new Type(a.count*width);
 for(let i=0;i<a.count;i++)values.set(new Type(binary.buffer,binary.byteOffset+start+i*stride,width),i*width);
 return values;
}
await MeshoptSimplifier.ready;
const variants={};
for(let variant=0;variant<4;variant++){
 const name=`Stalk_${variant}`,node=gltf.nodes.find(n=>n.name===name);
 assert.ok(node);const mesh=gltf.meshes[node.mesh];assert.equal(mesh.primitives.length,1);
 const primitive=mesh.primitives[0],positions=accessor(primitive.attributes.POSITION,true),indices=Uint32Array.from(accessor(primitive.indices));
 const [lod,error]=MeshoptSimplifier.simplify(indices,positions,3,Math.floor(indices.length*.2/3)*3,.005,['ErrorAbsolute']);
 assert.ok(lod.length>0&&lod.length<indices.length&&error<=.005);
 variants[name]={sourceVertices:positions.length/3,sourceIndices:indices.length,error,indices:Array.from(lod)};
}
const content=JSON.stringify({sourceHash:createHash('sha256').update(data).digest('hex'),variants})+'\n';
if(process.argv.includes('--check'))assert.equal(readFileSync(output,'utf8'),content,'Run pnpm generate:lod after changing bamboo.glb');
else writeFileSync(output,content);
console.log('Bamboo distant LOD: '+Object.values(variants).map(v=>`${v.sourceIndices/3} → ${v.indices.length/3}`).join(', ')+' triangles');
