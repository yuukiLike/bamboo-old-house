import * as T from 'three';

/** Rain only queries three fixed, upward directions. Projecting parallel rays
 * onto x/y and z/y shears makes each ray a single point, so a static grid can
 * reject distant triangles before the unchanged, exact triangle test.
 * Grid size changes candidate counts only; it never rounds the ray or hit. */
export function createRainOcclusion(meshes:T.Mesh[],directions:readonly T.Vector3[]){
 let count=0;
 for(const mesh of meshes)count+=(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3;
 let vertices=new Float32Array(count*9),minY=new Float32Array(count),maxY=new Float32Array(count);
 const point=new T.Vector3();let cursor=0;
 for(const mesh of meshes){
  const positions=mesh.geometry.attributes.position,index=mesh.geometry.index;
  for(let i=0;i<(index?.count??positions.count);i+=3){
   for(let j=0;j<3;j++){
    point.fromBufferAttribute(positions,index?index.getX(i+j):i+j).applyMatrix4(mesh.matrixWorld);
    vertices.set(point.toArray(),cursor*9+j*3);
   }
   minY[cursor]=Math.min(vertices[cursor*9+1],vertices[cursor*9+4],vertices[cursor*9+7]);
   maxY[cursor]=Math.max(vertices[cursor*9+1],vertices[cursor*9+4],vertices[cursor*9+7]);
   cursor++;
  }
 }
 const cellSize=.125,padding=.000001;
 const grids=directions.map(input=>{
  const direction=input.clone().normalize();
  if(direction.y<=0)throw new Error('RAIN_DIRECTION_MUST_POINT_UP');
  const sx=direction.x/direction.y,sz=direction.z/direction.y;
  let x0=Infinity,z0=Infinity,x1=-Infinity,z1=-Infinity;
  for(let i=0;i<vertices.length;i+=3){
   const x=vertices[i]-sx*vertices[i+1],z=vertices[i+2]-sz*vertices[i+1];
   x0=Math.min(x0,x);z0=Math.min(z0,z);x1=Math.max(x1,x);z1=Math.max(z1,z);
  }
  x0=Math.floor((x0-padding)/cellSize);z0=Math.floor((z0-padding)/cellSize);
  const columns=count?Math.floor((x1+padding)/cellSize)-x0+1:0;
  const rows=count?Math.floor((z1+padding)/cellSize)-z0+1:0;
  const cells=new Map<number,number[]>();
  for(let triangle=0;triangle<count;triangle++){
   let loX=Infinity,loZ=Infinity,hiX=-Infinity,hiZ=-Infinity;
   for(let corner=0;corner<3;corner++){
    const offset=triangle*9+corner*3;
    const x=vertices[offset]-sx*vertices[offset+1],z=vertices[offset+2]-sz*vertices[offset+1];
    loX=Math.min(loX,x);loZ=Math.min(loZ,z);hiX=Math.max(hiX,x);hiZ=Math.max(hiZ,z);
   }
   const left=Math.floor((loX-padding)/cellSize)-x0,right=Math.floor((hiX+padding)/cellSize)-x0;
   const bottom=Math.floor((loZ-padding)/cellSize)-z0,top=Math.floor((hiZ+padding)/cellSize)-z0;
   for(let z=bottom;z<=top;z++)for(let x=left;x<=right;x++){
    const key=z*columns+x,cell=cells.get(key);
    if(cell)cell.push(triangle);else cells.set(key,[triangle]);
   }
  }
  // The nearest roof or partition usually stops rain. Height order permits
  // early exit and skips geometry beyond the original 12 m ray range.
  // Pack all buckets into two arrays. Keeping tens of thousands of small
  // JS arrays or typed-array objects would add avoidable retained heap.
  const offsets=new Uint32Array(columns*rows+1);
  for(const [key,cell] of cells)offsets[key+1]=cell.length;
  for(let i=1;i<offsets.length;i++)offsets[i]+=offsets[i-1];
  const triangles=new Uint32Array(offsets[offsets.length-1]);
  for(const [key,cell] of cells){cell.sort((a,b)=>minY[a]-minY[b]);triangles.set(cell,offsets[key]);}
  return {direction,sx,sz,x0,z0,columns,rows,offsets,triangles,cellCount:cells.size};
 });
 const cellCount=grids.reduce((sum,grid)=>sum+grid.cellCount,0);
 const references=grids.reduce((sum,grid)=>sum+grid.triangles.length,0);
 const bufferBytes=vertices.byteLength+minY.byteLength+maxY.byteLength+grids.reduce((sum,grid)=>sum+grid.offsets.byteLength+grid.triangles.byteLength,0);
 const ray=new T.Ray(),a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),hit=new T.Vector3();
 return {
  stats:{cellSize,cellCount,references,bufferBytes},
  blocked(x:number,y:number,z:number,sector:number){
   const grid=grids[sector];
   if(!grid.columns)return false;
   const ix=Math.floor((x-grid.sx*y)/cellSize)-grid.x0,iz=Math.floor((z-grid.sz*y)/cellSize)-grid.z0;
   if(ix<0||ix>=grid.columns||iz<0||iz>=grid.rows)return false;
   const key=iz*grid.columns+ix,start=grid.offsets[key],end=grid.offsets[key+1];
   ray.origin.set(x,y,z);ray.direction.copy(grid.direction);
   const endY=y+grid.direction.y*12+padding;
   for(let i=start;i<end;i++){
    const triangle=grid.triangles[i];
    if(minY[triangle]>endY)break;
    if(maxY[triangle]<y-padding)continue;
    const offset=triangle*9;
    a.fromArray(vertices,offset);b.fromArray(vertices,offset+3);c.fromArray(vertices,offset+6);
    if(ray.intersectTriangle(a,b,c,false,hit)){
     const distance=hit.distanceToSquared(ray.origin);
     if(distance>.000009&&distance<144)return true;
    }
   }
   return false;
  },
  dispose(){
   for(const grid of grids){grid.columns=0;grid.offsets=new Uint32Array(0);grid.triangles=new Uint32Array(0);}
   vertices=new Float32Array(0);minY=new Float32Array(0);maxY=new Float32Array(0);
  },
 };
}
