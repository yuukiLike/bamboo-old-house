import * as T from 'three';
import type { CulmCurve } from './wind';

/** Fit the actual authored culm, excluding branch vertices by its longitudinal
 * UVs. Five smooth terms retain its natural bend without baking variant data
 * separately from the asset. This runs once when each prototype is loaded. */
export function fitCulmCurve(geometry:T.BufferGeometry):CulmCurve {
 const position=geometry.attributes.position,uv=geometry.attributes.uv,rows=new Map<number,T.Vector3[]>();
 if(!uv)throw new Error('BAMBOO_CULM_UV_MISSING');
 for(let i=0;i<position.count;i++){
  const y=position.getY(i);
  if(Math.abs(1-uv.getY(i)-y/1.6)>.00002||uv.getX(i)>.9999)continue;
  const key=Math.round(y*10000),p=new T.Vector3().fromBufferAttribute(position,i);
  if(!rows.has(key))rows.set(key,[]);rows.get(key)!.push(p);
 }
 const centers=[...rows.values()].filter(row=>row.length>=8).map(row=>row.reduce((sum,p)=>sum.add(p),new T.Vector3()).divideScalar(row.length));
 if(centers.length<20)throw new Error('BAMBOO_CULM_PROFILE_MISSING');
 const matrix=Array.from({length:5},()=>Array(7).fill(0));
 for(const p of centers){
  const u=p.y/14,powers=Array.from({length:5},(_,i)=>u**(i+1));
  for(let i=0;i<5;i++){
   for(let j=0;j<5;j++)matrix[i][j]+=powers[i]*powers[j];
   matrix[i][5]+=powers[i]*p.x;matrix[i][6]+=powers[i]*p.z;
  }
 }
 // Pivoted elimination solves both horizontal coordinates together.
 for(let col=0;col<5;col++){
  let pivot=col;for(let row=col+1;row<5;row++)if(Math.abs(matrix[row][col])>Math.abs(matrix[pivot][col]))pivot=row;
  [matrix[col],matrix[pivot]]=[matrix[pivot],matrix[col]];
  const divisor=matrix[col][col];if(Math.abs(divisor)<1e-12)throw new Error('BAMBOO_CULM_PROFILE_SINGULAR');
  for(let j=col;j<7;j++)matrix[col][j]/=divisor;
  for(let row=0;row<5;row++)if(row!==col){const factor=matrix[row][col];for(let j=col;j<7;j++)matrix[row][j]-=factor*matrix[col][j];}
 }
 return matrix.map(row=>[row[5],0,row[6]]);
}

export function transformCulmCurve(curve:CulmCurve,matrix:T.Matrix4):CulmCurve {
 const rotationScale=new T.Matrix3().setFromMatrix4(matrix);
 return curve.map(coefficient=>new T.Vector3(...coefficient).applyMatrix3(rotationScale).toArray() as [number,number,number]);
}
