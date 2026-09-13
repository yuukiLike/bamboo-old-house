import * as T from 'three';
import { groundHeight, pathCenter, pathWidth, TERRAIN_GRID } from './config';

type PathPoint = {x:number;z:number;u:number;lift:number};
type GroundPoint = {x:number;y:number;z:number;normal:T.Vector3};
const ROWS=240,COLUMNS=8,Z_START=-12,Z_LENGTH=56;

// All erosion stays inside the established path boundary. Vegetation, camera
// corridors and the paved/earth distinction retain their original clearances.
function rowEdges(z:number){
 const erosion=(side:number)=>.008+.017*(.5+.5*Math.sin(z*2.43+side*2.7))
  +.011*(.5+.5*Math.sin(z*7.13+side*4.9))**4;
 const center=pathCenter(z),width=pathWidth(z);
 return {left:center-width*.5+erosion(0),right:center+width*.5-erosion(1)};
}
const strip=Array.from({length:ROWS+1},(_,row)=>{
 const z=Z_START+row/ROWS*Z_LENGTH,{left,right}=rowEdges(z);
 return Array.from({length:COLUMNS+1},(_,column):PathPoint=>{
  const u=column/COLUMNS;
  return {x:T.MathUtils.lerp(left,right,u),z,u,lift:.003+Math.sin(u*Math.PI)*.010*(.88+.12*Math.sin(z*.61+.2))};
 });
});
function weights(x:number,z:number,a:{x:number;z:number},b:{x:number;z:number},c:{x:number;z:number}){
 const divisor=(b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);
 const first=((b.z-c.z)*(x-c.x)+(c.x-b.x)*(z-c.z))/divisor;
 const second=((c.z-a.z)*(x-c.x)+(a.x-c.x)*(z-c.z))/divisor;
 return [first,second,1-first-second];
}

/** Shared with rain/leaf landing. The road's small crown is affine on its
 * original triangles; clipping those against terrain keeps this exact lift. */
export function footpathSurfaceHeight(x:number,z:number){
 const ground=groundHeight(x,z);
 if(z<Z_START||z>Z_START+Z_LENGTH)return ground;
 const coordinate=(z-Z_START)/Z_LENGTH*ROWS,row=Math.min(ROWS-1,Math.floor(coordinate)),t=coordinate-row;
 const lower=strip[row],upper=strip[row+1];
 const left=T.MathUtils.lerp(lower[0].x,upper[0].x,t),right=T.MathUtils.lerp(lower[COLUMNS].x,upper[COLUMNS].x,t);
 // Submitted positions are Float32; tolerate their sub-millimetre edge
 // rounding so a landed leaf never drops through the last road vertex.
 if(x<left-.00001||x>right+.00001)return ground;
 // Float32 edge vertices can land a fraction of a micron outside a narrow
 // lane. Project that tolerated margin onto its edge before barycentrics.
 const sampleX=T.MathUtils.clamp(x,left,right);
 const column=Math.min(COLUMNS-1,Math.floor((sampleX-left)/(right-left)*COLUMNS));
 const a=lower[column],b=upper[column],c=lower[column+1],d=upper[column+1];
 for(const triangle of [[a,b,c],[c,b,d]]){
  const w=weights(sampleX,z,...triangle as [PathPoint,PathPoint,PathPoint]);
  if(w.every(value=>value>=-.00001))return ground+w.reduce((sum,value,i)=>sum+value*triangle[i].lift,0);
 }
 return ground;
}

/** Cut at every submitted terrain triangle boundary instead of bridging two
 * differently sloped planes. Smooth terrain normals prevent a denser overlay
 * from exposing coarse triangular lighting patches on otherwise smooth soil.
 * The optional input reuses the runtime ground; export/QA can construct alone. */
export function createFootpathGeometry(submittedTerrain?:T.BufferGeometry){
 const g=TERRAIN_GRID;
 const terrain=submittedTerrain??new T.PlaneGeometry(g.width,g.depth,g.columns,g.rows);
 if(!submittedTerrain){
  terrain.rotateX(-Math.PI/2);terrain.translate(g.x0+g.width/2,0,g.z0+g.depth/2);
  const points=terrain.attributes.position;
  for(let i=0;i<points.count;i++)points.setY(i,groundHeight(points.getX(i),points.getZ(i)));
  terrain.computeVertexNormals();
 }
 try{
  const terrainPositions=terrain.attributes.position,terrainNormals=terrain.attributes.normal,terrainIndex=terrain.index;
  if(!terrainIndex||!terrainNormals||terrainIndex.count!==g.columns*g.rows*6)throw new Error('FOOTPATH_TERRAIN_TOPOLOGY_INVALID');
  const positions:number[]=[],normals:number[]=[],uvs:number[]=[],indices:number[]=[];
  const dx=g.width/g.columns,dz=g.depth/g.rows;
  const groundTriangle=(index:number):GroundPoint[]=>[0,1,2].map(corner=>{
   const id=terrainIndex.getX(index*3+corner);
   return {x:terrainPositions.getX(id),y:terrainPositions.getY(id),z:terrainPositions.getZ(id),normal:new T.Vector3().fromBufferAttribute(terrainNormals,id)};
  });
  const append=(polygon:PathPoint[],ground:GroundPoint[])=>{
   if(polygon.length<3)return;
   // Boundary intersections can produce duplicate/collinear corners. Keep
   // only nonzero fans; Float32 noise must not create thin dark seam triangles.
   const base=positions.length/3;
   for(const point of polygon){
    const w=weights(point.x,point.z,...ground as [GroundPoint,GroundPoint,GroundPoint]);
    const normal=new T.Vector3();w.forEach((value,i)=>normal.addScaledVector(ground[i].normal,value));normal.normalize();
    positions.push(point.x,w.reduce((sum,value,i)=>sum+value*ground[i].y,0)+point.lift,point.z);
    normals.push(normal.x,normal.y,normal.z);uvs.push(point.u,point.z*.25);
   }
   for(let corner=1;corner<polygon.length-1;corner++){
    if(Math.abs(cross(polygon[0],polygon[corner],polygon[corner+1]))>1e-10)indices.push(base,base+corner,base+corner+1);
   }
  };
  for(let row=0;row<ROWS;row++)for(let column=0;column<COLUMNS;column++){
   const a=strip[row][column],b=strip[row+1][column],c=strip[row][column+1],d=strip[row+1][column+1];
   for(const road of [[a,b,c],[c,b,d]]){
    const minX=Math.max(0,Math.floor((Math.min(...road.map(p=>p.x))-g.x0)/dx)-1),maxX=Math.min(g.columns-1,Math.floor((Math.max(...road.map(p=>p.x))-g.x0)/dx)+1);
    const minZ=Math.max(0,Math.floor((Math.min(...road.map(p=>p.z))-g.z0)/dz)-1),maxZ=Math.min(g.rows-1,Math.floor((Math.max(...road.map(p=>p.z))-g.z0)/dz)+1);
    for(let iz=minZ;iz<=maxZ;iz++)for(let ix=minX;ix<=maxX;ix++)for(let half=0;half<2;half++){
     const ground=groundTriangle((iz*g.columns+ix)*2+half);
     append(clip(road,ground),ground);
    }
   }
  }
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new T.Float32BufferAttribute(normals,3));geometry.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));geometry.setIndex(indices);geometry.computeBoundingSphere();
  return geometry;
 }finally{if(!submittedTerrain)terrain.dispose();}
}
function cross(a:{x:number;z:number},b:{x:number;z:number},p:{x:number;z:number}){
 return (b.x-a.x)*(p.z-a.z)-(b.z-a.z)*(p.x-a.x);
}
function clip(road:PathPoint[],ground:GroundPoint[]){
 const sign=Math.sign(cross(ground[0],ground[1],ground[2]));let polygon=road;
 for(let edge=0;edge<3&&polygon.length;edge++){
  const a=ground[edge],b=ground[(edge+1)%3],result:PathPoint[]=[];
  for(let i=0;i<polygon.length;i++){
   const start=polygon[i],end=polygon[(i+1)%polygon.length],ds=sign*cross(a,b,start),de=sign*cross(a,b,end);
   if(ds>=-1e-12)result.push(start);
   if((ds< -1e-12)!==(de< -1e-12)){
    const t=ds/(ds-de);result.push({x:T.MathUtils.lerp(start.x,end.x,t),z:T.MathUtils.lerp(start.z,end.z,t),u:T.MathUtils.lerp(start.u,end.u,t),lift:T.MathUtils.lerp(start.lift,end.lift,t)});
   }
  }
  polygon=result;
 }
 return polygon;
}
