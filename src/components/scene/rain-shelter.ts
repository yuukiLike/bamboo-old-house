import * as T from 'three';

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
  const started=performance.now(),exact=createTriangleShelter(meshes),triangleBuildMs=performance.now()-started;
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
        if(open>=0&&open<3.2&&!exact.blocked(px,py,pz,dx,dy,dz))reach[sector]=Math.exp(-open/1.15);
      }
      cache.set(key,reach);
    }
    return reach.map((value,i)=>T.MathUtils.clamp(value*Math.max(.12,ny-nx*rainDirections[i].cos*.67-nz*rainDirections[i].sin*.67),0,1)) as [number,number,number];
  };
  return{solid,clip,exposure,stats:{step,triangles,solidCells,cells:cells.length,triangleBuildMs,voxelBuildMs},dispose(){cache.clear();cells.fill(0);exact.dispose();}};
}

/** A compact static triangle hierarchy is used only while authoring vertex
 * wetness (and explicit diagnostics). It is never traversed per animation frame.
 * Raster shells remain the more conservative, cheaper particle collider. */
function createTriangleShelter(meshes:T.Mesh[]){
  let count=0;for(const mesh of meshes)count+=(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3;
  let vertices=new Float32Array(count*9),centers=new Float32Array(count*3),ids=new Uint32Array(count);
  const point=new T.Vector3();let cursor=0;
  for(const mesh of meshes){
    const p=mesh.geometry.attributes.position,index=mesh.geometry.index;
    for(let i=0;i<(index?.count??p.count);i+=3){
      ids[cursor]=cursor;
      for(let j=0;j<3;j++){
        point.fromBufferAttribute(p,index?index.getX(i+j):i+j).applyMatrix4(mesh.matrixWorld);
        vertices.set(point.toArray(),cursor*9+j*3);
        centers[cursor*3]+=point.x/3;centers[cursor*3+1]+=point.y/3;centers[cursor*3+2]+=point.z/3;
      }
      cursor++;
    }
  }
  type Node={lo:number[];hi:number[];start:number;end:number;left?:Node;right?:Node};
  const build=(start:number,end:number,depth=0):Node=>{
    const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
    for(let i=start;i<end;i++)for(let j=0;j<9;j++){const axis=j%3,v=vertices[ids[i]*9+j];lo[axis]=Math.min(lo[axis],v);hi[axis]=Math.max(hi[axis],v);}
    const node:Node={lo,hi,start,end};if(end-start<=12||depth>=32)return node;
    const extents=hi.map((v,i)=>v-lo[i]),axis=extents.indexOf(Math.max(...extents)),middle=(lo[axis]+hi[axis])*.5;
    let left=start,right=end-1;
    while(left<=right){if(centers[ids[left]*3+axis]<middle)left++;else{const id=ids[left];ids[left]=ids[right];ids[right]=id;right--;}}
    if(left===start||left===end)left=(start+end)>>1;
    node.left=build(start,left,depth+1);node.right=build(left,end,depth+1);return node;
  };
  let root:Node|null=build(0,count);centers=new Float32Array(0);
  const ray=new T.Ray(),a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),hit=new T.Vector3();
  const blocked=(x:number,y:number,z:number,dx:number,dy:number,dz:number)=>{
    ray.origin.set(x,y,z);ray.direction.set(dx,dy,dz).normalize();
    const o=[x,y,z],d=ray.direction.toArray(),stack:Node[]=root?[root]:[];
    while(stack.length){
      const node=stack.pop()!;let near=0,far=12;
      for(let axis=0;axis<3;axis++){
        if(Math.abs(d[axis])<1e-8){if(o[axis]<node.lo[axis]||o[axis]>node.hi[axis])far=-1;continue;}
        const t1=(node.lo[axis]-o[axis])/d[axis],t2=(node.hi[axis]-o[axis])/d[axis];
        near=Math.max(near,Math.min(t1,t2));far=Math.min(far,Math.max(t1,t2));
      }
      if(far<near)continue;
      if(node.left&&node.right){stack.push(node.left,node.right);continue;}
      for(let i=node.start;i<node.end;i++){
        const offset=ids[i]*9;a.fromArray(vertices,offset);b.fromArray(vertices,offset+3);c.fromArray(vertices,offset+6);
        if(ray.intersectTriangle(a,b,c,false,hit)&&hit.distanceToSquared(ray.origin)>.000009&&hit.distanceToSquared(ray.origin)<144)return true;
      }
    }
    return false;
  };
  return{blocked,dispose(){root=null;vertices=new Float32Array(0);ids=new Uint32Array(0);}};
}

/** Authored floors and lime walls contain metre-wide sparse triangles.
 * Subdivide their own runtime clones so a wet aperture vertex cannot
 * interpolate wetness over an entire protected wall or floor. */
export function refineRainFloor(source:T.BufferGeometry,matrix:T.Matrix4,balconyOnly=false){
  const attributes=Object.entries(source.attributes),vertices:Record<string,number[]>={};
  for(const [name]of attributes)vertices[name]=[];
  const positions=source.attributes.position,index=source.index;
  const va=new T.Vector3(),vb=new T.Vector3(),vc=new T.Vector3();
  type Vertex=Record<string,number[]>;
  const samples=new Map<number,Vertex>(),vertexIndices=new Map<Vertex,number>(),indices:number[]=[];
  const sample=(i:number):Vertex=>{
    let vertex=samples.get(i);
    if(!vertex){vertex=Object.fromEntries(attributes.map(([name,a])=>[name,Array.from({length:a.itemSize},(_,j)=>a.getComponent(i,j))]));samples.set(i,vertex);}
    return vertex;
  };
  const midpoint=(a:Vertex,b:Vertex):Vertex=>Object.fromEntries(attributes.map(([name])=>[name,a[name].map((v,j)=>(v+b[name][j])*.5)]));
  const split=(a:Vertex,b:Vertex,c:Vertex,depth=0)=>{
    va.fromArray(a.position).applyMatrix4(matrix);vb.fromArray(b.position).applyMatrix4(matrix);vc.fromArray(c.position).applyMatrix4(matrix);
    const ab=va.distanceToSquared(vb),bc=vb.distanceToSquared(vc),ca=vc.distanceToSquared(va);
    const floor=!balconyOnly||([va,vb,vc].every(p=>p.y>3.20&&p.y<3.31&&p.z>-.25&&p.z<2.31)&&Math.max(va.y,vb.y,vc.y)-Math.min(va.y,vb.y,vc.y)<.002);
    if(floor&&Math.max(ab,bc,ca)>.35**2&&depth<15){
      if(ab>=bc&&ab>=ca){const m=midpoint(a,b);split(a,m,c,depth+1);split(m,b,c,depth+1);}
      else if(bc>=ca){const m=midpoint(b,c);split(a,b,m,depth+1);split(a,m,c,depth+1);}
      else{const m=midpoint(c,a);split(a,b,m,depth+1);split(m,b,c,depth+1);}return;
    }
    // Sibling triangles share the same immutable endpoint/midpoint objects.
    // Index those exact vertices rather than repeating their wetness raycasts.
    for(const v of [a,b,c]){
      let id=vertexIndices.get(v);
      if(id===undefined){id=vertexIndices.size;vertexIndices.set(v,id);for(const [name]of attributes)vertices[name].push(...v[name]);}
      indices.push(id);
    }
  };
  const count=index?.count??positions.count,offsets:number[]=[];
  for(let i=0;i<count;i+=3){offsets.push(indices.length);split(sample(index?index.getX(i):i),sample(index?index.getX(i+1):i+1),sample(index?index.getX(i+2):i+2));}
  offsets.push(indices.length);
  const geometry=new T.BufferGeometry();for(const [name,a]of attributes)geometry.setAttribute(name,new T.Float32BufferAttribute(vertices[name],a.itemSize));
  geometry.setIndex(indices);
  const boundary=(offset:number)=>offsets[Math.min(offsets.length-1,Math.max(0,Math.ceil(offset/3)))];
  for(const group of source.groups)geometry.addGroup(boundary(group.start),boundary(group.start+group.count)-boundary(group.start),group.materialIndex);
  const start=boundary(source.drawRange.start);
  geometry.setDrawRange(start,source.drawRange.count===Infinity?Infinity:boundary(source.drawRange.start+source.drawRange.count)-start);
  geometry.computeBoundingBox();geometry.computeBoundingSphere();return geometry;
}
