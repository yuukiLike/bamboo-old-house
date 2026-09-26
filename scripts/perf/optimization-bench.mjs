import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {cpus,platform,release} from 'node:os';
import {dirname,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';

// CPU-only, with the real architecture geometry and the production wetness
// builder. Images, WebGL, shaders and the rest of the scene are not measured.
const {values}=parseArgs({options:{ref:{type:'string'},out:{type:'string'},iterations:{type:'string',default:'3'}}});
const iterations=Number(values.iterations);
assert.ok(Number.isInteger(iterations)&&iterations>=1&&iterations<=10);
const root=fileURLToPath(new URL('../../',import.meta.url));
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const ref=values.ref?git('rev-parse',values.ref):null;
const modules=new Map(),sourceHashes={};
const hash=data=>createHash('sha256').update(data).digest('hex');

// Import exact source snapshots without checking out old files or adding
// exports to the app solely for measurements. Only weather's two CPU helpers
// are exposed here. All relative dependencies use the same requested ref.
async function moduleURL(file){
 if(modules.has(file))return modules.get(file);
 let source=ref?git('show',`${ref}:${file}`):readFileSync(resolve(root,file),'utf8');
 sourceHashes[file]=hash(source);
 if(file==='src/components/scene/weather.ts')source+='\nexport {makeHeightField,weatherSurfaces};';
 source=stripTypeScriptTypes(source,{mode:'transform'});
 const imports=[...source.matchAll(/\bfrom\s+(['"])([^'"]+)\1/g)];
 for(const match of imports.reverse()){
  const specifier=match[2];
  const url=specifier.startsWith('.')
   ?await moduleURL(relative(root,resolve(root,dirname(file),specifier+'.ts')))
   :import.meta.resolve(specifier);
  source=source.slice(0,match.index)+`from ${JSON.stringify(url)}`+source.slice(match.index+match[0].length);
 }
 const url=`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
 modules.set(file,url);return url;
}
const weather=await import(await moduleURL('src/components/scene/weather.ts'));
const {createRainShelter}=await import(await moduleURL('src/components/scene/rain-shelter.ts'));
const {createVegetationVisibility}=await import(await moduleURL('src/components/scene/vegetation-visibility.ts'));
const {stabilizeHouseSurfaces}=await import(await moduleURL('src/components/scene/house-surfaces.ts'));
const asset=readFileSync(resolve(root,'public/models/architecture.glb'));
const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
loader.register(()=>({name:'CPU_GEOMETRY_ONLY',loadTexture:()=>Promise.resolve(null)}));
const parsed=await loader.parseAsync(asset.buffer.slice(asset.byteOffset,asset.byteOffset+asset.byteLength),'');
stabilizeHouseSurfaces(parsed.scene);

function weatherRun(){
 const scene=new T.Scene(),house=parsed.scene.clone(true);
 house.traverse(object=>{if(object instanceof T.Mesh)object.material=Array.isArray(object.material)?object.material.map(m=>m.clone()):object.material.clone();});
 scene.add(house);scene.updateMatrixWorld(true);
 const roofs=[];let sourceTriangles=0;
 house.traverse(object=>{
  if(!(object instanceof T.Mesh))return;
  sourceTriangles+=(object.geometry.index?.count??object.geometry.attributes.position.count)/3;
  const names=(Array.isArray(object.material)?object.material:[object.material]).map(m=>m.name).join(' ');
  if(/Grey_clay_tile/.test(names)||/^Architecture__Reference_(dark|silvered)_aged_timber$/.test(object.name))roofs.push(object);
 });
 const roof=weather.makeHeightField(roofs,.24,true);
 const start=performance.now(),shelter=createRainShelter(house,roof.sample),built=performance.now();
 const surfaces=weather.weatherSurfaces(scene,roof,{}, {},shelter),end=performance.now();
 const digest=createHash('sha256');let vertices=0;
 house.traverse(object=>{
  if(!(object instanceof T.Mesh))return;
  for(const name of ['rainExposure','rainIngress']){
   const attribute=object.geometry.getAttribute(name);if(!attribute)continue;
   digest.update(object.name+'|'+name);
   digest.update(Buffer.from(attribute.array.buffer,attribute.array.byteOffset,attribute.array.byteLength));
   if(name==='rainExposure')vertices+=attribute.count;
  }
 });
 const result={totalMs:end-start,shelterMs:built-start,surfaceMs:end-built,stats:shelter.stats,sourceTriangles,vertices,exposedVertices:surfaces.exposedVertices,attributeHash:digest.digest('hex')};
 surfaces.dispose();shelter.dispose();return result;
}

function vegetationRun(){
 const scene=new T.Scene(),count=30000;
 const mesh=new T.InstancedMesh(new T.BoxGeometry(.15,.4,.15),new T.MeshBasicMaterial(),count);
 mesh.name='Curled_bamboo_leaf_litter';
 let seed=317;
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 const matrix=new T.Matrix4(),color=new T.Color();
 for(let i=0;i<count;i++){
  matrix.makeTranslation((random()-.5)*240,random()*.2,(random()-.5)*240);
  mesh.setMatrixAt(i,matrix);mesh.setColorAt(i,color.setRGB(random(),random(),random()));
 }
 scene.add(mesh);
 const start=performance.now(),visibility=createVegetationVisibility(scene),buildMs=performance.now()-start;
 const camera=new T.PerspectiveCamera(54,16/9,.12,150),digest=createHash('sha256');
 let totalMs=0,uploadBytes=0,visibleInstances=0;
 const samples=[];
 for(let frame=0;frame<180;frame++){
  const t=frame<120?frame/120:1;
  camera.position.set(Math.sin(t*4)*35,1.7,Math.cos(t*4)*35);
  camera.lookAt(Math.sin(t*8)*70,0,Math.cos(t*8)*70);
  if(frame===140){camera.fov=80;camera.updateProjectionMatrix();}
  // Model Three's upload queue consumption at the end of every frame.
  mesh.instanceMatrix.clearUpdateRanges();mesh.instanceColor.clearUpdateRanges();
  const version=mesh.instanceMatrix.version,colorVersion=mesh.instanceColor.version;
  const before=performance.now();visibility.update(camera);const elapsed=performance.now()-before;
  samples.push(elapsed);totalMs+=elapsed;visibleInstances+=mesh.count;
  for(const [attribute,old]of [[mesh.instanceMatrix,version],[mesh.instanceColor,colorVersion]])if(attribute.version!==old){
   uploadBytes+=(attribute.updateRanges.length?attribute.updateRanges.reduce((sum,range)=>sum+range.count,0):attribute.array.length)*4;
  }
  digest.update(`${frame}:${mesh.count}:${mesh.visible};`);
  for(const [attribute,size]of [[mesh.instanceMatrix,16],[mesh.instanceColor,3]])digest.update(Buffer.from(attribute.array.buffer,attribute.array.byteOffset,mesh.count*size*4));
 }
 samples.sort((a,b)=>a-b);
 const result={instances:count,frames:180,buildMs,totalMs,meanMs:totalMs/180,p95Ms:samples[Math.ceil(samples.length*.95)-1],uploadBytes,visibleInstances,outputHash:digest.digest('hex')};
 mesh.dispose();mesh.geometry.dispose();mesh.material.dispose();return result;
}

const result={kind:'CPU only; not browser startup or GPU/FPS',createdAt:new Date().toISOString(),ref:ref??'working-tree',head:git('rev-parse','HEAD'),environment:{node:process.version,three:T.REVISION,platform:platform(),release:release(),cpu:cpus()[0]?.model},assetHash:hash(asset),sourceHashes,iterations,weather:[],vegetation:[]};
for(let i=0;i<iterations;i++){
 result.weather.push(weatherRun());result.vegetation.push(vegetationRun());
 console.error(`iteration ${i+1}: weather ${result.weather[i].totalMs.toFixed(1)} ms; vegetation ${result.vegetation[i].totalMs.toFixed(1)} ms`);
}
for(const [key,field]of [['weather','attributeHash'],['vegetation','outputHash']])assert.equal(new Set(result[key].map(row=>row[field])).size,1,`${key} output changed across repeats`);
const json=JSON.stringify(result,null,2)+'\n';
if(values.out){const file=resolve(root,values.out);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,json,{flag:'wx'});}else console.log(json);
