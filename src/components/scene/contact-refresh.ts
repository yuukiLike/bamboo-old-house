export type ContactQuality='motion'|'detail';

/** Keep camera-aligned contact shade cheap while moving, then refine it once.
 * The short settle window includes the small gaps between native wheel events. */
export class ContactRefresh {
 quality:ContactQuality='detail';
 refinement=0;
 private valid=false;
 private changedAt=0;
 private refinementStarted:number|undefined;
 private readonly settleSeconds:number;
 private readonly refinementSeconds:number;
 constructor(settleSeconds=.12,refinementSeconds=.1) {
  this.settleSeconds=settleSeconds;this.refinementSeconds=refinementSeconds;
 }
 get refining() {return this.refinementStarted!==undefined;}
 invalidate() {
  this.valid=false;this.quality='detail';this.refinement=0;this.refinementStarted=undefined;
 }
 next(cameraChanged:boolean,now:number):ContactQuality|undefined {
  if(!this.valid) {this.valid=true;return 'detail';}
  if(cameraChanged) {
   this.changedAt=now;this.quality='motion';this.refinement=0;this.refinementStarted=undefined;
   return 'motion';
  }
  if(this.quality==='motion'&&now-this.changedAt>=this.settleSeconds) {
   this.quality='detail';this.refinementStarted=now;this.refinement=0;
   return 'detail';
  }
  if(this.refinementStarted!==undefined) {
   this.refinement=Math.min(1,Math.max(0,(now-this.refinementStarted)/this.refinementSeconds));
   if(this.refinement===1)this.refinementStarted=undefined;
  }
  return undefined;
 }
}
