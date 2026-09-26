import * as T from 'three';

export interface RenderSettings {
 resolution:'full'|'balanced'|'reduced';
 shadows:'full'|'alternate';
 frameRate:'display'|'60'|'30';
}
export const FULL_RENDER_SETTINGS:Readonly<RenderSettings>={resolution:'full',shadows:'full',frameRate:'display'};
// Balanced startup; complete effects and the lighter option stay selectable.
export const DEFAULT_RENDER_SETTINGS:Readonly<RenderSettings>={resolution:'balanced',shadows:'alternate',frameRate:'60'};

/** The selected configuration controls resolution. Frame timings never
 * select a setting. CSS/UI resolution is unaffected. */
export function scenePixelRatio(deviceRatio:number,mobile:boolean,settings:RenderSettings){
 if(settings.resolution==='reduced')return Math.min(deviceRatio,mobile?1.25:1.6)*.85;
 if(mobile)return Math.min(deviceRatio,settings.resolution==='full'?2:1.5);
 return Math.min(deviceRatio,1.6)*(settings.resolution==='balanced'?.85:1);
}

/** Limit submissions, not animation time. Skipped callbacks do no scene/audio
 * work; the next render receives elapsed wall time. No catch-up draw bursts. */
export function createFramePacer(){
 let previous=-Infinity,previousMode:RenderSettings['frameRate']|undefined;
 return (now:number,mode:RenderSettings['frameRate'])=>{
  const interval=mode==='display'?0:1000/Number(mode);
  const elapsed=now-previous;
  // Half a millisecond tolerates browser timestamp rounding at 60/120 Hz.
  if(mode===previousMode&&elapsed>=0&&elapsed<interval-.5)return false;
  // Carry small scheduling jitter rather than adding it to every interval.
  // Long gaps reset the clock so old deadlines cannot trigger catch-up work.
  previous=mode===previousMode&&elapsed>=0&&elapsed<interval*1.5?Math.min(now,previous+interval):now;
  previousMode=mode;return true;
 };
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
