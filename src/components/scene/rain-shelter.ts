import * as T from 'three';
import { createRainOcclusion } from './rain-occlusion';

// The three sectors span gusts around the prevailing wind. The same sectors
// drive incoming rain and the retained water on open architectural edges.
export const RAIN_SECTORS = [-.80, .38, 1.32] as const;
const rainDirections=RAIN_SECTORS.map(angle=>({cos:Math.cos(angle),sin:Math.sin(angle)}));

/** Conservative, static voxel shells of the actual walls, floors and roofs.
 * Unlike a highest-roof height field this preserves the air under a balcony,
 * while a closed window, wall or lower floor still stops a slanted drop. */
export function createRainShelter(house:T.Group,roofAt:(x:number,z:number)=>number){
  const meshes:T.Mesh[]=[];
  house.traverse(o=>{
    if(!(o instanceof T.Mesh))return;
    // Furniture, cloth covers and closed glass also intercept water; omitting
    // a tabletop would incorrectly expose the floor hidden underneath it.
    meshes.push(o);
  });
  const bounds=new T.Box3();for(const mesh of meshes)bounds.expandByObject(mesh);
  const started=performance.now(),exact=createRainOcclusion(meshes,rainDirections.map(direction=>new T.Vector3(-direction.cos*.67,1,-direction.sin*.67))),triangleBuildMs=performance.now()-started;
  const voxelStarted=performance.now();
  const step=.20,origin=bounds.min.clone().addScalar(-step*2);
  const nx=Math.ceil((bounds.max.x-origin.x)/step)+3,ny=Math.ceil((bounds.max.y-origin.y)/step)+3,nz=Math.ceil((bounds.max.z-origin.z)/step)+3;
  const cells=new Uint8Array(nx*ny*nz);
  const triangle=new T.Triangle(),box=new T.Box3(),lo=new T.Vector3(),hi=new T.Vector3();
  let triangles=0,solidCells=0;
  for(const mesh of meshes){
    const p=mesh.geometry.attributes.position,index=mesh.geometry.index,count=index?.count??p.count;
    for(let i=0;i<count;i+=3){
      triangle.a.fromBufferAttribute(p,index?index.getX(i):i).applyMatrix4(mesh.matrixWorld);
      triangle.b.fromBufferAttribute(p,index?index.getX(i+1):i+1).applyMatrix4(mesh.matrixWorld);
      triangle.c.fromBufferAttribute(p,index?index.getX(i+2):i+2).applyMatrix4(mesh.matrixWorld);
      lo.copy(triangle.a).min(triangle.b).min(triangle.c).sub(origin).divideScalar(step).floor();
      hi.copy(triangle.a).max(triangle.b).max(triangle.c).sub(origin).divideScalar(step).floor();
      for(let z=Math.max(0,lo.z);z<=Math.min(nz-1,hi.z);z++)for(let y=Math.max(0,lo.y);y<=Math.min(ny-1,hi.y);y++)for(let x=Math.max(0,lo.x);x<=Math.min(nx-1,hi.x);x++){
        const key=(z*ny+y)*nx+x;if(cells[key])continue;
        box.min.set(origin.x+x*step,origin.y+y*step,origin.z+z*step);box.max.copy(box.min).addScalar(step);
        if(box.intersectsTriangle(triangle)){cells[key]=1;solidCells++;}
      }
      triangles++;
    }
  }
  const voxelBuildMs=performance.now()-voxelStarted;
  const solid=(x:number,y:number,z:number)=>{
    const ix=Math.floor((x-origin.x)/step),iy=Math.floor((y-origin.y)/step),iz=Math.floor((z-origin.z)/step);
    return ix>=0&&ix<nx&&iy>=0&&iy<ny&&iz>=0&&iz<nz&&cells[(iz*ny+iy)*nx+ix]===1;
  };
  // Short segments are used by the small edge-rain pool only. Sub-cell steps
  // are bounded and conservative; there are no GLB raycasts during animation.
  const clip=(x:number,y:number,z:number,dx:number,dy:number,dz:number)=>{
    const count=Math.max(1,Math.ceil(Math.hypot(dx,dy,dz)/(step*.30)));
    for(let i=0;i<=count;i++){
      const f=i/count;if(solid(x+dx*f,y+dy*f,z+dz*f))return Math.max(0,(i-1)/count);
    }
    return 1;
  };
  const cache=new Map<string,[number,number,number]>();
  const exposure=(x:number,y:number,z:number,nx=0,ny=1,nz=0):[number,number,number]=>{
    // Millimetres of face bias avoid self intersections without jumping through
    // a thin wall. Exact triangles retain the air between slender balusters;
    // the conservative particle voxels alone would close those openings.
    if(roofAt(x,z)<y+.16||ny+.67*Math.hypot(nx,nz)<.01)return[0,0,0];
    const px=x+nx*.008,py=y+ny*.008,pz=z+nz*.008;
    const key=`${Math.round(px/.10)},${Math.round(py/.10)},${Math.round(pz/.10)},${Math.round(nx*4)},${Math.round(ny*4)},${Math.round(nz*4)}`;
    let reach=cache.get(key);
    if(!reach){
      reach=[0,0,0];
      for(let sector=0;sector<3;sector++){
        const direction=rainDirections[sector],dx=-direction.cos*.67,dy=1,dz=-direction.sin*.67;
        let open=-1;
        // Beyond 3.5 m horizontal penetration, a sheltered room stays dry.
        for(let distance=0;distance<6.0;distance+=.09){
          const qx=px+dx*distance,qy=py+dy*distance,qz=pz+dz*distance;
          // Only the first opening contributes. The exact ray below still
          // checks the complete route for a wall, pane or further roof.
          if(roofAt(qx,qz)<qy+.12){open=distance*.67;break;}
          if(qy>bounds.max.y+.3)break;
        }
        if(open>=0&&open<3.2&&!exact.blocked(px,py,pz,sector))reach[sector]=Math.exp(-open/1.15);
      }
      cache.set(key,reach);
    }
    return reach.map((value,i)=>T.MathUtils.clamp(value*Math.max(.12,ny-nx*rainDirections[i].cos*.67-nz*rainDirections[i].sin*.67),0,1)) as [number,number,number];
  };
  return{solid,clip,exposure,stats:{step,triangles,solidCells,cells:cells.length,triangleBuildMs,voxelBuildMs,occlusion:exact.stats},dispose(){cache.clear();cells.fill(0);exact.dispose();}};
}

/** Authored floors and lime walls contain metre-wide sparse triangles.
 * Subdivide their own runtime clones so a wet aperture vertex cannot
 * interpolate wetness over an entire protected wall or floor. */
export function refineRainFloor(source:T.BufferGeometry,matrix:T.Matrix4,balconyOnly=false){
  const attributes=Object.entries(source.attributes),vertices:Record<string,number[]>={};
  const positions=source.attributes.position,index=source.index;
  for(const [name,attribute]of attributes){
    const values:number[]=[];
    for(let i=0;i<attribute.count;i++)for(let j=0;j<attribute.itemSize;j++)values.push(attribute.getComponent(i,j));
    vertices[name]=values;
  }
  const va=new T.Vector3(),vb=new T.Vector3(),vc=new T.Vector3();
  const midpoints=new Map<string,number>(),indices:number[]=[];
  const midpoint=(a:number,b:number)=>{
    const key=a<b?`${a}:${b}`:`${b}:${a}`;
    const cached=midpoints.get(key);if(cached!==undefined)return cached;
    const id=vertices.position.length/3;
    for(const [name,attribute]of attributes){
      const values=vertices[name],size=attribute.itemSize;
      for(let j=0;j<size;j++)values.push((values[a*size+j]+values[b*size+j])*.5);
    }
    midpoints.set(key,id);return id;
  };
  const split=(a:number,b:number,c:number,depth=0)=>{
    va.fromArray(vertices.position,a*3).applyMatrix4(matrix);vb.fromArray(vertices.position,b*3).applyMatrix4(matrix);vc.fromArray(vertices.position,c*3).applyMatrix4(matrix);
    const ab=va.distanceToSquared(vb),bc=vb.distanceToSquared(vc),ca=vc.distanceToSquared(va);
    const floor=!balconyOnly||([va,vb,vc].every(p=>p.y>3.20&&p.y<3.31&&p.z>-.25&&p.z<2.31)&&Math.max(va.y,vb.y,vc.y)-Math.min(va.y,vb.y,vc.y)<.002);
    if(floor&&Math.max(ab,bc,ca)>.35**2&&depth<15){
      if(ab>=bc&&ab>=ca){const m=midpoint(a,b);split(a,m,c,depth+1);split(m,b,c,depth+1);}
      else if(bc>=ca){const m=midpoint(b,c);split(a,b,m,depth+1);split(a,m,c,depth+1);}
      else{const m=midpoint(c,a);split(a,b,m,depth+1);split(m,b,c,depth+1);}return;
    }
    indices.push(a,b,c);
  };
  const count=index?.count??positions.count,offsets:number[]=[];
  for(let i=0;i<count;i+=3){offsets.push(indices.length);split(index?index.getX(i):i,index?index.getX(i+1):i+1,index?index.getX(i+2):i+2);}
  offsets.push(indices.length);
  const geometry=new T.BufferGeometry();for(const [name,a]of attributes)geometry.setAttribute(name,new T.Float32BufferAttribute(vertices[name],a.itemSize));
  geometry.setIndex(indices);
  const boundary=(offset:number)=>offsets[Math.min(offsets.length-1,Math.max(0,Math.ceil(offset/3)))];
  for(const group of source.groups)geometry.addGroup(boundary(group.start),boundary(group.start+group.count)-boundary(group.start),group.materialIndex);
  const start=boundary(source.drawRange.start);
  geometry.setDrawRange(start,source.drawRange.count===Infinity?Infinity:boundary(source.drawRange.start+source.drawRange.count)-start);
  geometry.computeBoundingBox();geometry.computeBoundingSphere();return geometry;
}
