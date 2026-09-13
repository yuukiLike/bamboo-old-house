import * as T from 'three';
import { FOREST_SLOPE_VIEW, groundHeight, pathClearance, positionPath, seeded } from './config';

type Point = [number, number, number];
class Batch {
  positions:number[]=[]; colors:number[]=[]; uvs:number[]=[]; indices:number[]=[];
  vertex(p:Point|T.Vector3,color:T.Color,uv:[number,number]=[0,0]) {
    const i=this.positions.length/3;
    this.positions.push(...(p instanceof T.Vector3?p.toArray():p));
    this.colors.push(color.r,color.g,color.b);this.uvs.push(...uv);return i;
  }
  triangle(a:number,b:number,c:number){this.indices.push(a,b,c);}
  geometry(){
    const g=new T.BufferGeometry();
    g.setAttribute('position',new T.Float32BufferAttribute(this.positions,3));
    g.setAttribute('normal',new T.Float32BufferAttribute(new Float32Array(this.positions.length),3));
    g.setAttribute('color',new T.Float32BufferAttribute(this.colors,3));
    g.setAttribute('uv',new T.Float32BufferAttribute(this.uvs,2));g.setIndex(this.indices);
    g.computeVertexNormals();g.computeBoundingSphere();return g;
  }
}
function periodicNoise(x:number,y:number,period:number){
  const hash=(a:number,b:number)=>{const n=Math.sin(((a%period+period)%period)*127.1+((b%period+period)%period)*311.7+42.2)*43758.5453;return n-Math.floor(n);};
  const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy);
  return T.MathUtils.lerp(T.MathUtils.lerp(hash(ix,iy),hash(ix+1,iy),u),T.MathUtils.lerp(hash(ix,iy+1),hash(ix+1,iy+1),u),v);
}
function clayTextures(){
  const n=256,color=new Uint8Array(n*n*4),normal=new Uint8Array(n*n*4),height=new Float32Array(n*n),random=seeded(713998);
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const u=x/n,v=y/n,broad=periodicNoise(u*7,v*7,7),patch=periodicNoise(u*23,v*23,23);
    const grit=periodicNoise(u*83,v*83,83),fine=random()-.5;
    const pock=Math.max(0,(grit-.64)/.36),skin=Math.max(0,(patch-.57)/.43);
    // Weak interrupted lifts, not mortar courses. The clay keeps coarse pores,
    // darker damp remnants and muted ochre grains after losing its outer skin.
    const lift=Math.pow(Math.max(0,Math.sin(v*Math.PI*26+broad*2.1)),18)*(patch>.4?1:0);
    const value=(broad-.5)*25+(patch-.5)*11+fine*8-pock*20-skin*7-lift*3;
    const i=(y*n+x)*4;
    color[i]=T.MathUtils.clamp(114+value,0,255);color[i+1]=T.MathUtils.clamp(81+value*.83,0,255);color[i+2]=T.MathUtils.clamp(57+value*.70,0,255);color[i+3]=255;
    height[y*n+x]=(broad-.5)*.0018+(grit-.5)*.0007+fine*.00022-pock*.0023-lift*.00025;
  }
  // Short broken straw fragments are embedded in the clay rather than lines
  // spanning the wall; most are subdued under soil and old surface staining.
  for(let i=0;i<340;i++){
    const x=Math.floor(random()*n),y=Math.floor(random()*n),length=2+Math.floor(random()*6),angle=(random()-.5)*1.3;
    for(let k=0;k<length;k++){
      const px=(x+Math.round(Math.cos(angle)*k))%n,py=(y+Math.round(Math.sin(angle)*k)+n)%n,o=(py*n+px)*4;
      const opacity=.10+random()*.16;color[o]=Math.round(color[o]*(1-opacity)+153*opacity);color[o+1]=Math.round(color[o+1]*(1-opacity)+132*opacity);color[o+2]=Math.round(color[o+2]*(1-opacity)+95*opacity);
    }
  }
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const dx=(height[y*n+(x+1)%n]-height[y*n+(x+n-1)%n])*n/2;
    const dy=(height[((y+1)%n)*n+x]-height[((y+n-1)%n)*n+x])*n/2;
    const v=new T.Vector3(-dx,-dy,1).normalize(),i=(y*n+x)*4;
    normal[i]=Math.round((v.x*.5+.5)*255);normal[i+1]=Math.round((v.y*.5+.5)*255);normal[i+2]=Math.round((v.z*.5+.5)*255);normal[i+3]=255;
  }
  const make=(pixels:Uint8Array,name:string,srgb:boolean)=>{const t=new T.DataTexture(pixels,n,n,T.RGBAFormat);t.name=name;t.colorSpace=srgb?T.SRGBColorSpace:T.NoColorSpace;t.wrapS=t.wrapT=T.RepeatWrapping;t.magFilter=T.LinearFilter;t.minFilter=T.LinearMipmapLinearFilter;t.generateMipmaps=true;t.needsUpdate=true;return t;};
  return {color:make(color,'Remnant_earthen_wall_weathered_clay',true),normal:make(normal,'Remnant_earthen_wall_fine_pores_normal',false)};
}
// Surviving wall courses end in short, steep fractures. Broad shoulders and
// two collapsed notches read as a cut wall, not one tapered mound of loose soil.
const knots:[number,number][]=[[0,1.29],[.18,1.31],[.226,1.25],[.238,.82],[.37,.78],
  [.382,1.08],[.58,1.04],[.592,.47],[.74,.49],[.752,.73],[1,.67]];
const wallSamples=Array.from(new Set([...Array.from({length:36},(_,i)=>i/35),...knots.map(k=>k[0])])).sort((a,b)=>a-b);
function wallProfile(t:number){
  const pair=knots.findIndex((_,i)=>i<knots.length-1&&t<=knots[i+1][0]);
  const [a,b]=[knots[Math.max(0,pair)],knots[Math.max(0,pair)+1]];
  return T.MathUtils.lerp(a[1],b[1],(t-a[0])/(b[0]-a[0]))+.026*Math.sin(t*91)+.019*Math.sin(t*213);
}
function wallCenter(t:number){return {x:-15.65+t*4.10,z:1.91+.37*t+.075*Math.sin(t*6.3),half:.25+.014*Math.sin(t*4.6+.4)};}
function clayWall(batch:Batch){
  const random=seeded(617126),rows=wallSamples.length-1,levels=7,front:number[][]=[],back:number[][]=[];
  for(let i=0;i<=rows;i++){
    const t=wallSamples[i],p=wallCenter(t),height=Math.max(.03,wallProfile(t));front[i]=[];back[i]=[];
    for(let j=0;j<=levels;j++)for(const side of [1,-1]){
      const v=j/levels;
      const z=p.z+side*(p.half*(1-v*.015)+.006*Math.sin(i*1.91+j*2.6))+(random()-.5)*.006*v;
      const x=p.x+(i===0||i===rows?0:(random()-.5)*.014*Math.sin(v*Math.PI)),ground=groundHeight(x,z);
      const y=ground-.045+height*v+((random()-.5)*.028)*v;
      const damp=(1-v)*(.78+.22*Math.sin(t*16)**2),mottle=.89+random()*.14;
      const c=new T.Color().setRGB(mottle*(1-damp*.13),mottle*(1-damp*.08),mottle*(1-damp*.02));
      const index=batch.vertex([x,y,z],c,[(x+15.65)/1.12,(y-ground)/1.06]);
      (side===1?front:back)[i][j]=index;
    }
  }
  for(let i=0;i<rows;i++){
    for(let j=0;j<levels;j++){
      for(const [grid,reverse] of [[front,false],[back,true]] as const){
        const a=grid[i][j],b=grid[i+1][j],c=grid[i][j+1],d=grid[i+1][j+1];
        if(reverse){batch.triangle(a,c,b);batch.triangle(b,c,d);}else{batch.triangle(a,b,c);batch.triangle(b,d,c);}
      }
    }
  }
  // Give the torn top its own planar UVs. Sharing facade UVs across the
  // thickness collapsed V and smeared the clay pores into straight stripes.
  const top:number[][]=[];
  for(let i=0;i<=rows;i++){
    top[i]=[];
    const a=new T.Vector3().fromArray(batch.positions,front[i][levels]*3);
    const b=new T.Vector3().fromArray(batch.positions,back[i][levels]*3);
    for(let j=0;j<=4;j++){
      const v=j/4,p=a.clone().lerp(b,v);
      p.y+=Math.sin(v*Math.PI)*(.008*Math.sin(i*2.03)-.006);
      const c=new T.Color(.88,.86,.82).multiplyScalar(.94+random()*.1);
      top[i][j]=batch.vertex(p,c,[(p.x+15.65)/1.12,p.z/1.12]);
    }
    if(i)for(let j=0;j<4;j++){
      const [a,b,c,d]=[top[i-1][j],top[i][j],top[i-1][j+1],top[i][j+1]];
      batch.triangle(a,b,c);batch.triangle(b,d,c);
    }
  }
  for(const i of [0,rows]){
    // Separate normals and YZ UVs keep the freshly exposed abrupt end visibly
    // planar. Sharing side vertices previously rounded the silhouette into rock.
    const cap:number[][]=[];
    for(let j=0;j<=levels;j++){
      cap[j]=[front[i][j],back[i][j]].map(source=>{
        const p=new T.Vector3().fromArray(batch.positions,source*3);
        return batch.vertex(p,new T.Color(.85,.84,.80),[p.z/1.12,p.y/1.06]);
      });
      if(j){
        const [a,b]=cap[j-1],[c,d]=cap[j];
        if(i===0){batch.triangle(a,c,b);batch.triangle(b,c,d);}else{batch.triangle(a,b,c);batch.triangle(b,d,c);}
      }
    }
  }
}
function brokenStone(batch:Batch,center:T.Vector3,scale:T.Vector3,color:T.Color,random:()=>number){
  const g=new T.IcosahedronGeometry(1,1),pos=g.attributes.position,turn=new T.Quaternion().setFromEuler(new T.Euler((random()-.5)*.4,(random()-.5)*.65,(random()-.5)*.55));
  const start=batch.positions.length/3;
  for(let i=0;i<pos.count;i++){
    const p=new T.Vector3().fromBufferAttribute(pos,i);
    // Deterministic coordinate noise keeps duplicated triangle corners joined.
    const wobble=.92+.085*Math.sin(p.x*19.3+p.y*13.9+p.z*7.4);
    p.multiply(scale).multiplyScalar(wobble).applyQuaternion(turn).add(center);
    const c=color.clone().multiplyScalar(.86+.20*Math.abs(Math.sin(p.x*21+p.z*17)));
    batch.vertex(p,c,[(p.x+16)/1.12,(p.y+.3)/1.06]);
  }
  for(let i=0;i<pos.count;i+=3)batch.triangle(start+i,start+i+1,start+i+2);
  g.dispose();
}
function dryBlade(batch:Batch,root:T.Vector3,height:number,angle:number,random:()=>number){
  const lean=.09+random()*.20,width=.004+random()*.004,c=new T.Color().setHSL(.105+random()*.035,.17+random()*.12,.15+random()*.13);
  const across=new T.Vector3(-Math.sin(angle),0,Math.cos(angle));const rings:number[][]=[];
  for(let j=0;j<4;j++){
    const t=j/3,p=root.clone().add(new T.Vector3(Math.cos(angle)*lean*t*t,height*t,Math.sin(angle)*lean*t*t));
    const w=width*(1-t)+.0003;rings.push([batch.vertex(p.clone().addScaledVector(across,-w),c),batch.vertex(p.clone().addScaledVector(across,w),c)]);
    if(j){const [a,b]=rings[j-1],[d,e]=rings[j];batch.triangle(a,b,d);batch.triangle(b,e,d);}
  }
}

/** Photo 2 and the close reference put these remains outside the shed's left
 * flank. Existing net: Blender(-12.8,-3,-.1) == Web(-12.8,-.1,+3).
 * The placement is inferred from that relationship, not a surveyed dimension. */
export function addForestRemains(scene:T.Scene){
  const group=new T.Group();group.name='Old_earthen_wall_at_shed_forest_edge';
  const earth=new Batch(),stone=new Batch(),grass=new Batch(),random=seeded(191731);
  clayWall(earth);
  let embedded=0,collapsed=0;
  for(let i=0;i<24;i++){
    const t=.015+random()*.94,p=wallCenter(t),height=Math.max(.04,wallProfile(t));
    const sx=.10+random()*.12,sy=.06+random()*.07,sz=.07+random()*.06;
    const z=p.z+p.half*.97-.06,x=p.x;
    const y=groundHeight(x,z)+Math.min(height*.32,.10+random()*.15);
    brokenStone(stone,new T.Vector3(x,y,z),new T.Vector3(sx,sy,sz),new T.Color(0x5d503d),random);embedded++;
  }
  for(let i=0;i<10;i++){
    const t=.44+random()*.56,p=wallCenter(t),x=p.x+(random()-.5)*.38,z=p.z+p.half+.16+random()*.33;
    // Most of each dark fragment remains in the dirt, leaving only a torn cap.
    brokenStone(i%3===0?stone:earth,new T.Vector3(x,groundHeight(x,z)+.025,z),new T.Vector3(.09+random()*.14,.07+random()*.065,.085+random()*.11),i%3===0?new T.Color(0x574934):new T.Color(.74,.70,.63),random);collapsed++;
  }
  const roots:Point[]=[];
  for(let tuft=0;tuft<29;tuft++){
    const t=random(),p=wallCenter(t),x=p.x+(random()-.5)*.48,z=p.z+p.half+.10+random()*.39;
    for(let i=0;i<8;i++){
      const a=random()*Math.PI*2,r=random()*.075,px=x+Math.cos(a)*r,pz=z+Math.sin(a)*r;
      const root=new T.Vector3(px,groundHeight(px,pz)+.002,pz);roots.push(root.toArray() as Point);
      dryBlade(grass,root,.08+random()*.23,a,random);
    }
  }
  const textures=clayTextures();
  const clayMaterial=new T.MeshStandardMaterial({map:textures.color,normalMap:textures.normal,normalScale:new T.Vector2(.8,.8),vertexColors:true,roughness:.99});clayMaterial.name='Warm_pitted_earthen_wall_remains';
  const stoneMaterial=new T.MeshStandardMaterial({vertexColors:true,roughness:1});stoneMaterial.name='Dark_earth_embedded_wall_stones';
  const grassMaterial=new T.MeshStandardMaterial({vertexColors:true,roughness:.98,side:T.DoubleSide,forceSinglePass:true});grassMaterial.name='Dry_trampled_wall_foot_grass';
  const meshes=[new T.Mesh(earth.geometry(),clayMaterial),new T.Mesh(stone.geometry(),stoneMaterial),new T.Mesh(grass.geometry(),grassMaterial)];
  ['Eroded_rammed_red_earth_with_broken_top','Dark_stones_partly_buried_in_wall','Unequal_dry_grass_at_remnant_foot'].forEach((name,i)=>{meshes[i].name=name;meshes[i].receiveShadow=true;meshes[i].castShadow=i<2;group.add(meshes[i]);});
  const route=Array.from({length:201},(_,i)=>positionPath.getPoint(i/200));
  let minPath=Infinity,minCamera=Infinity,minDetail=Infinity;
  for(const mesh of meshes){const p=mesh.geometry.attributes.position;for(let i=0;i<p.count;i++){
    const x=p.getX(i),z=p.getZ(i);minPath=Math.min(minPath,pathClearance(x,z));
    for(const eye of route)minCamera=Math.min(minCamera,Math.hypot(x-eye.x,z-eye.z));
    for(const view of [FOREST_SLOPE_VIEW])minDetail=Math.min(minDetail,Math.hypot(x-view.p[0],z-view.p[2]));
  }}
  const triangles=meshes.reduce((sum,m)=>sum+m.geometry.index!.count/3,0);
  group.userData={referenceNote:'Photo 2 + new net/wall close crop; inferred shed-side remnant behind existing old green net at Web(-12.8,+3).',
    placement:{webXZBounds:[[-15.9,1.4],[-11.1,3.4]],existingNetWeb:[-12.8,-.1,3]},drawCalls:3,triangles,
    counts:{embeddedDarkStones:embedded,collapsedFragments:collapsed,dryBlades:roots.length},
    wallStructure:{rows:wallSamples.length-1,verticalLevels:7,nominalThickness:.50,steepFractures:4,nearEndHeight:.67,farEndHeight:1.29},
    minPathClearance:minPath,minCameraRouteClearance:minCamera,minDetailClearance:minDetail,grassRootGroundOffset:.002,
    supportSampler:'config.groundHeight; earthen body buried45mm; collapsed stone fragments partly buried; grass +2mm'};
  if(triangles>12000||minPath<.6||minCamera<.75||minDetail<.85)throw new Error('FOREST_REMAINS_CLEARANCE_OR_BUDGET');
  scene.add(group);
  return {group,dispose:()=>{group.removeFromParent();meshes.forEach(mesh=>mesh.geometry.dispose());[clayMaterial,stoneMaterial,grassMaterial].forEach(m=>m.dispose());textures.color.dispose();textures.normal.dispose();}};
}
