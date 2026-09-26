import * as T from 'three';

/** Skip only an identical frozen picture. Keep the owner's CPU updates so
 * input, weather/daylight easing and audio hooks can still settle normally. */
export function createIdleRendering(camera:T.Camera,uniforms:readonly {value:number}[]) {
 const view=new T.Matrix4(),projection=new T.Matrix4(),values=new Float64Array(uniforms.length);
 let valid=false,revision=-1;
 return {
  invalidate(){valid=false;},
  needsRender(frozen:boolean,pending:boolean,visualRevision=0){
   // The normal animated scene always keeps its existing render cadence.
   if(!frozen){valid=false;return true;}
   camera.updateWorldMatrix(true,false);
   const changed=!valid||revision!==visualRevision||!view.equals(camera.matrixWorld)||!projection.equals(camera.projectionMatrix)||uniforms.some((uniform,index)=>uniform.value!==values[index]);
   if(!changed&&!pending)return false;
   view.copy(camera.matrixWorld);projection.copy(camera.projectionMatrix);
   uniforms.forEach((uniform,index)=>{values[index]=uniform.value;});
   revision=visualRevision;valid=true;return true;
  },
 };
}
