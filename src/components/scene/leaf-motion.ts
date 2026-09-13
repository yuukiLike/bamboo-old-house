import * as T from 'three';
import { forestWindGust } from './wind';

/** A hinge per complete authored blade. The petiole never leaves its twig;
 * rotating its blade and normal together keeps the vein and outline intact. */
export function addLeafHinges(geometry:T.BufferGeometry,trianglesPerLeaf:number){
 const positions=geometry.attributes.position,uv=geometry.attributes.uv,index=geometry.index;
 if(!index||!uv)throw new Error('BAMBOO_LEAF_TOPOLOGY_MISSING');
 const pivot=new Float32Array(positions.count*3),tip=new Float32Array(positions.count*3);
 for(let first=0;first<index.count;first+=trianglesPerLeaf*3){
  const vertices=new Set<number>();for(let i=first;i<Math.min(first+trianglesPerLeaf*3,index.count);i++)vertices.add(index.getX(i));
  let root=-1,end=-1;
  for(const i of vertices){if(root<0||uv.getY(i)>uv.getY(root))root=i;if(end<0||uv.getY(i)<uv.getY(end))end=i;}
  if(root<0||end<0||uv.getY(root)-uv.getY(end)<.99)throw new Error('BAMBOO_LEAF_HINGE_INVALID');
  for(const i of vertices)for(let axis=0;axis<3;axis++){
   pivot[i*3+axis]=positions.array[root*3+axis];tip[i*3+axis]=positions.array[end*3+axis];
  }
 }
 geometry.setAttribute('aLeafPivot',new T.BufferAttribute(pivot,3));geometry.setAttribute('aLeafTip',new T.BufferAttribute(tip,3));
}

export function forestLeafAngle(time:number,root:readonly number[],pivot:readonly number[],wind:number){
 const phase=pivot[0]*1.47+pivot[1]*.83+pivot[2]*1.13;
 const gust=forestWindGust(time-2.3-.08*Math.sin(phase),root[0],root[2]);
 const flutter=Math.sin(time*7.1+phase)+.4*Math.sin(time*10.7+phase*1.3);
 return wind*(.19*gust+.032*gust*flutter);
}

export const LEAF_WIND_GLSL=`
attribute vec3 aLeafPivot;
attribute vec3 aLeafTip;
vec3 leafHingeAxis(mat4 im){
 vec3 direction=normalize(aLeafTip-aLeafPivot),air=normalize(windToLocal(im,vec3(.94,0.,.37)));
 vec3 hinge=cross(direction,air);
 if(dot(hinge,hinge)<.0001)hinge=cross(direction,abs(direction.y)<.9?vec3(0.,1.,0.):vec3(1.,0.,0.));
 return normalize(hinge);
}
float leafHingeAngle(mat4 im,vec3 root){
 vec3 pivot=(im*vec4(aLeafPivot,1.)).xyz;
 float phase=dot(pivot,vec3(1.47,.83,1.13));
 float gust=forestGustAt(root,uWindTime-2.3-.08*sin(phase));
 float flutter=sin(uWindTime*7.1+phase)+.4*sin(uWindTime*10.7+phase*1.3);
 return uWindStrength*(.19*gust+.032*gust*flutter);
}
vec3 leafHingeRotate(vec3 v,mat4 im,vec3 root){
 vec3 axis=leafHingeAxis(im);float angle=leafHingeAngle(im,root),c=cos(angle),s=sin(angle);
 return v*c+cross(axis,v)*s+axis*dot(axis,v)*(1.-c);
}
vec3 leafHingePoint(vec3 p,mat4 im,vec3 root){return aLeafPivot+leafHingeRotate(p-aLeafPivot,im,root);}
`;
