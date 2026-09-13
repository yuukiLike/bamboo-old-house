// Keep Retina/fullscreen rendering bounded. Adjust only after sustained slow
// frames, with a long recovery window so changing rooms does not cause flicker.
export function createRenderBudget() {
 let maximum=1,minimum=.75,ratio=1,total=0,samples=0,elapsed=0,fastTime=0;
 const reset=()=>{total=0;samples=0;elapsed=0;fastTime=0;};
 return {
  resize(width:number,height:number,dpr:number,mobile:boolean) {
   maximum=Math.min(dpr,mobile?1.25:1.6,Math.sqrt(2_000_000/Math.max(1,width*height)));
   minimum=Math.min(.75,maximum*.75);ratio=maximum;reset();return ratio;
  },
  reset,
  sample(milliseconds:number) {
   // Limit a single compilation stall's weight, but still recover from
   // consistently very slow frames. Visibility changes reset the window.
   if(milliseconds<=0)return ratio;
   milliseconds=Math.min(milliseconds,100);
   total+=milliseconds;samples++;elapsed+=milliseconds;
   if(elapsed<2000||samples<30)return ratio;
   const average=total/samples,windowTime=elapsed;
   total=0;samples=0;elapsed=0;
   if(average>24) {
    ratio=Math.max(minimum,ratio*.85);fastTime=0;
   }else if(average<18) {
    fastTime+=windowTime;
    if(fastTime>=12000){ratio=Math.min(maximum,ratio+.1);fastTime=0;}
   }else fastTime=0;
   return ratio;
  },
 };
}
