export const WALK_CHAPTERS = [
 { id:'bamboo', name:'竹林', eyebrow:'关于外婆家的记忆', title:'四时竹声', copy:'长大才知晓，\n外婆家的竹林，就是世外桃源。' },
 { id:'approach', name:'靠近', eyebrow:'竹影之间', title:'穿过竹影，\n一处人家。', copy:'' },
 { id:'courtyard', name:'屋前', eyebrow:'屋檐之下', title:'光落在旧木上。', copy:'' },
 { id:'forest-slope', name:'竹林坡地', eyebrow:'竹林坡地', title:'落叶贴着泥土，\n风从林间经过。', copy:'听见雨滴，也闻见夏天。' },
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
