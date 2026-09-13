/** A short, time-based follow shared by wheel and chapter navigation.
 * Always follow the latest page position; there is no queued animation or
 * weather-dependent delay. Use real elapsed time, not the physics time cap. */
export function followWalkProgress(current:number,target:number,elapsedSeconds:number,scrollRangePixels:number):number {
 const alpha=1-Math.exp(-30*Math.max(0,elapsedSeconds));
 const next=current+(target-current)*alpha;
 // Finish at the exact page position once less than a quarter CSS pixel
 // remains, so an imperceptible tail cannot keep the camera updating.
 return Math.abs(target-next)*Math.max(1,scrollRangePixels)<.25?target:next;
}
