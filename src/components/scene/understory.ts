import * as T from 'three';
import { groundHeight, pathClearance, seeded } from './config';
export function addUnderstoryAssets(scene:T.Scene,group:T.Group,mobile:boolean){
 const rand=seeded(919);const dummy=new T.Object3D(),color=new T.Color();
 for(const name of ['Fern_0','Fern_1','Grass_0','Grass_1']){
  const source=group.getObjectByName(name) as T.Mesh;const material=(source.material as T.MeshStandardMaterial).clone();material.envMapIntensity=.45;ageGroundGrass(material,name);
  const amount=mobile?270:470;const plants=new T.InstancedMesh(source.geometry,material,amount);let count=0;
  for(let i=0;i<amount*3&&count<amount;i++){
   const x=-40+rand()*75,z=-32+rand()*78,y=groundHeight(x,z);
   if(y<-1.1||((x>-12.7&&x<10&&z>-5&&z<9.2)||(x>-8.5&&x<10.7&&z>-14.0&&z<-2.8))||pathClearance(x,z)<.3)continue;
   dummy.position.set(x,y-.015,z);dummy.rotation.set(0,rand()*Math.PI*2,0);
   const s=z>9 && x>-20 && x<15?.22+rand()*.34:.36+rand()*.65;dummy.scale.set(s,s*(.7+rand()*.4),s);dummy.updateMatrix();plants.setMatrixAt(count,dummy.matrix);
   color.setHSL(.27+(rand()-.5)*.05,.12,.73+rand()*.2);plants.setColorAt(count,color);count++;
  }
  plants.count=count;plants.name=`Bank_${name}`;plants.receiveShadow=true;plants.castShadow=false;scene.add(plants);
 }
 // Tall reeds and brambles soften the adjacent hillside, as in photos 1 and 8.
 for(const name of ['Grass_0','Grass_1']){
  const source=group.getObjectByName(name) as T.Mesh;
  const material=(source.material as T.MeshStandardMaterial).clone();material.envMapIntensity=.4;ageGroundGrass(material,name);
  const stand=new T.InstancedMesh(source.geometry,material,mobile?360:640);let count=0;
  for(let i=0;i<stand.count*3&&count<stand.count;i++){
   const x=-33+rand()*58,z=-20+rand()*31,y=groundHeight(x,z);
   if(y<.7 || pathClearance(x,z)<.55 || ((x>-12.7&&x<10&&z>-5&&z<9.2)||(x>-8.5&&x<10.7&&z>-14.0&&z<-2.8)))continue;
   const thickRightBank=x>14&&z>-15&&z<4&&pathClearance(x,z)>.9;
   const s=thickRightBank?1.25+rand()*.85:.65+rand()*.65;dummy.position.set(x,y-.018,z);dummy.rotation.set(0,rand()*6.283,0);dummy.scale.set(s,s*(.68+rand()*.3),s);dummy.updateMatrix();stand.setMatrixAt(count,dummy.matrix);
   color.setHSL(.21+rand()*.06,.13,.65+rand()*.23);stand.setColorAt(count,color);count++;
  }
  stand.count=count;stand.receiveShadow=true;stand.name='Hillside_'+name;scene.add(stand);
 }

}

export function addBackgroundFoliage(scene:T.Scene,group:T.Group){
 const rand=seeded(8091),dummy=new T.Object3D();
 const treeSpots=[[-13,-10,1.3],[-23,-11,1.55],[-29,-7,1.4],[-11.5,-18.5,1.2],[15.0,-18.8,1.2],[19,-14,1.55],[-22,10,1.25],[-32,18,1.5],[-6,-25,1.5],[5,-27,1.6],[-39,-9,1.7],[28,-7,1.3]];
 const shrubs:number[][]=[];for(let i=0;i<130;i++){const x=-37+rand()*69,z=-25+rand()*47;if(groundHeight(x,z)<.2||pathClearance(x,z)<1.3||((x>-13&&x<10&&z>-5&&z<9.3)||(x>-8.7&&x<10.9&&z>-14.2&&z<-2.8)))continue;const s=.7+rand()*.55;
  // The broad leaves extend well beyond a root-only exclusion. Reposition
  // the whole branch/leaf pair while preserving the random sequence and IDs.
  const crownRadius=2.8*s;
  const nearRearHouse=x+crownRadius>-8.6&&x-crownRadius<10.8&&z+crownRadius>-14.2&&z-crownRadius<-2.8;
  shrubs.push([x,nearRearHouse?-14.2-crownRadius-.65:z,s]);}
 for(const name of ['Trunk_0','Crown_0','Branch_0','Shrub_0']){
  const source=group.getObjectByName(name) as T.Mesh;const material=(source.material as T.MeshStandardMaterial).clone();material.envMapIntensity=.45;
  const spots=name.includes('Trunk')||name.includes('Crown')?treeSpots:shrubs;
  const mesh=new T.InstancedMesh(source.geometry,material,spots.length);
  spots.forEach(([x,z,s],i)=>{dummy.position.set(x,groundHeight(x,z),z);dummy.scale.setScalar(s);dummy.rotation.set(0,(i*2.399)%6.283,0);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);});
  mesh.name='Background_'+name;mesh.castShadow=true;mesh.receiveShadow=true;scene.add(mesh);
 }
}

function ageGroundGrass(material:T.MeshStandardMaterial,name:string){
 if(!name.startsWith('Grass'))return;
 material.onBeforeCompile=shader=>{
  shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
   float dryLuminance=dot(diffuseColor.rgb,vec3(.299,.587,.114));
   diffuseColor.rgb=mix(diffuseColor.rgb,vec3(dryLuminance)*vec3(1.40,1.12,.70),.83);
  `);
 };
 material.customProgramCacheKey=()=> 'weathered-understory-grass';
}
