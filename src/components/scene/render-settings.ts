import * as T from 'three';

export interface RenderSettings {
 resolution:'full'|'reduced';
 shadows:'full'|'alternate';
}
export const FULL_RENDER_SETTINGS:Readonly<RenderSettings>={resolution:'full',shadows:'full'};
// User-approved starting point; complete effects remain independently selectable.
export const DEFAULT_RENDER_SETTINGS:Readonly<RenderSettings>={resolution:'reduced',shadows:'alternate'};

/** The selected configuration controls resolution. Frame timings never
 * select a setting. CSS/UI resolution is unaffected. */
export function scenePixelRatio(deviceRatio:number,mobile:boolean,settings:RenderSettings){
 return Math.min(deviceRatio,mobile?1.25:1.6)*(settings.resolution==='reduced'?.85:1);
}

/** The scene's shadow casters have fixed placements. Their only animated
 * depth inputs are shared wind time and strength (rain and falling-leaf
 * particles cast no shadows). Camera movement does not change the fixed map.
 * New geometry/transform/depth inputs must invalidate this cache or join its
 * signature. The optional alternate mode may defer wind motion by one frame;
 * light movement and explicit invalidation always refresh immediately. */
export function createDirectionalShadowUpdates(light:T.DirectionalLight){
 const shadow=light.shadow,originalAutoUpdate=shadow.autoUpdate;
 shadow.autoUpdate=false;
 const position=new T.Vector3(),target=new T.Vector3();
 const previousPosition=new T.Vector3(),previousTarget=new T.Vector3();
 let previousTime=NaN,previousWind=NaN,previousProjection='',invalidated=true,skipped=false;
 return {
  invalidate(){invalidated=true;},
  update(time:number,wind:number,mode:RenderSettings['shadows']){
   if(!light.visible||!light.castShadow)return false;
   light.getWorldPosition(position);light.target.getWorldPosition(target);
   const camera=shadow.camera;
   const projection=[camera.left,camera.right,camera.top,camera.bottom,camera.near,camera.far,camera.zoom,
    shadow.mapSize.x,shadow.mapSize.y,shadow.normalBias].join(',');
   const lightChanged=!position.equals(previousPosition)||!target.equals(previousTarget)||projection!==previousProjection;
   const mandatory=invalidated||!shadow.map||shadow.needsUpdate||lightChanged||wind!==previousWind;
   const animated=time!==previousTime;
   if(!mandatory&&(!animated||(mode==='alternate'&&!skipped))){skipped=animated;return false;}
   shadow.needsUpdate=true;invalidated=false;skipped=false;
   previousPosition.copy(position);previousTarget.copy(target);previousProjection=projection;
   previousTime=time;previousWind=wind;
   return true;
  },
  dispose(){shadow.autoUpdate=originalAutoUpdate;shadow.needsUpdate=true;},
 };
}
