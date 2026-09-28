export const WALK_CHAPTERS = [
 { id:'bamboo' },
 { id:'approach' },
 { id:'courtyard' },
 { id:'forest-slope' },
] as const;

export const WALK_SCROLL_CYCLES = 3;
export const wrapWalkProgress = (value:number) => ((value % 1) + 1) % 1;

/** Leave a native scroll runway on both sides of the opening viewpoint. */
export function walkScrollPosition(scrollTop:number,scrollRange:number) {
 const cycle=Math.max(1,scrollRange)/WALK_SCROLL_CYCLES;
 const progress=wrapWalkProgress(scrollTop/cycle);
 const recenter=scrollTop<cycle*.25||scrollTop>cycle*2.75;
 return {progress,scrollTop:recenter?(1+progress)*cycle:scrollTop};
}

export function walkScrollTop(progress:number,scrollRange:number) {
 return (1+wrapWalkProgress(progress))*Math.max(1,scrollRange)/WALK_SCROLL_CYCLES;
}

export function walkChapter(progress:number) {
 return Math.round(wrapWalkProgress(progress)*WALK_CHAPTERS.length)%WALK_CHAPTERS.length;
}
