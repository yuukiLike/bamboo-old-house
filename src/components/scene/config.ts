import { Vector3, CatmullRomCurve3, MathUtils } from 'three';
export const BUILD_ID = 'bamboo-2026-09-13-grove-and-controls';
export type ViewMode = 'porch' | 'walk' | 'free' | 'moon' | 'breeze' | 'well-rain';
export type TimeOfDay = 'dawn' | 'day' | 'noon' | 'dusk' | 'night';
// Shared with the editable Blender environment export (metres, web Y up).
export const SUN_PRESETS = {
 dawn: { position: [-30, 12, 24], color: 0xffe1b5, intensity: 2.8 },
 day: { position: [22, 20, 30], color: 0xffedcc, intensity: 4.2 },
 noon: { position: [-16, 48, 30], color: 0xffe7c2, intensity: 5.0 },
 dusk: { position: [24, 10, 34], color: 0xffd393, intensity: 5.0 },
 night: { position: [-14, 27, 22], color: 0x8eb5e8, intensity: .72 },
} as const;
// Stand one step inside the open gallery: the eaves and end pier frame a
// gentle diagonal view, with no near column crossing the centre of the image.
// Keep this real floor-supported eye fixed in portrait and in 360° mode.
// Authored bare bulbs, shared by browser lighting and the editable scene export.
// The lamp geometry is built at these same positions; values are metres / candela.
export const ROOM_LIGHTS = [
 { name:'Upper_hall_porcelain_light', p:[1.72,5.72,-.75], power:11, range:5.3 },
 { name:'Store_enamel_light', p:[5.45,5.90,-3.10], power:22, range:8.0 },
 { name:'First_room_porcelain_light', p:[1.92,5.92,-10.70], power:26, range:8.0 },
 { name:'Second_room_porcelain_light', p:[7.40,5.92,-10.70], power:26, range:8.0 },
 { name:'Kitchen_table_bare_light', p:[-5.20,2.66,-2.15], power:12, range:6.5 },
 { name:'Kitchen_work_bare_light', p:[-5.45,2.66,-5.55], power:14, range:7.0 },
 { name:'Ground_hall_enamel_light', p:[.70,2.54,-1.70], power:4, range:4.2 },
] as const;
export const PORCH_VIEW = { p: [-1.10, 4.85, -.70], t: [3.0, 4.25, 18], fov: 58 };
// Stand 25 cm left of the path centre at a gap in the canopy. Aim slightly
// below the celestial moon so it rests above centre, framed by bamboo.
export const MOON_VIEW = { p: [11.060114400567672, 1.70, 31], direction: [-14, 20, 22], fov: 58 };
// Stand within the central grove, surrounded by culms and overhead leaves.
// A near-level gap reveals the house; the walking route stays over 19 m away.
export const BREEZE_VIEW = {p:[7,1.70,26],direction:[-7,2,-28],fov:64};
// Seated outside the kitchen beside the broom: real cement floor y=.200015,
// eye 1.15 m above it. This p.y is absolute; the well and courtyard remain in view.
export const WELL_RAIN_VIEW = {p:[-4.2,1.35,1.2],direction:[4,-2.2,10],fov:68};
export type RoomId = 'upstairs' | 'store' | 'room-one' | 'room-two' | 'hall' | 'kitchen';
export const ROOM_VIEWS: Record<RoomId, {label:string; p:number[]; t:number[]; fov:number}> = {
 upstairs: {label:'二层厅堂',p:[-1.3,4.85,-3.8],t:[.2,4.7,14],fov:66},
 store: {label:'仓库',p:[5.9,4.85,-5.35],t:[5,4.3,3.5],fov:74},
 'room-one': {label:'住屋一',p:[.65,4.85,-9.35],t:[2.25,4.8,-15],fov:66},
 'room-two': {label:'住屋二',p:[6.05,4.85,-9.35],t:[8.7,4.8,-15],fov:66},
 hall: {label:'一楼堂屋',p:[-1.65,1.75,-1.9],t:[2.2,1.4,.1],fov:74},
 kitchen: {label:'一楼厨房',p:[-4.2,1.80,-4.7],t:[-7,1.8,-12],fov:74},
};
// Outdoor places use absolute standing eye heights on the actual courtyard surface.
export const OUTDOOR_VIEWS = {
 courtyard: {label:'屋前空地',p:[-1.5,1.4274203222107813,11],t:[-.5,3,-.5],fov:68},
 'yard-edge': {label:'院边竹荫',p:[7.5,1.6034467727,8.3],t:[-2.7,2.6,.7],fov:64},
} as const;
export const PLACE_VIEWS = {...OUTDOOR_VIEWS,...ROOM_VIEWS};
export type PlaceId = keyof typeof PLACE_VIEWS;
export const FOREST_SLOPE_VIEW = {p:[-6.5,1.55,11.2],t:[-9,.1,17],fov:65};
export const FUEL_PLACEMENTS = [
 {x:5.2,z:6.7,rotation:.13,scale:1.18},
 {x:-3,z:6.1,rotation:-.21,scale:.72},
];
export const CAMERA_STOPS = [
 { p:[-16.9447,1.95,20.388689], t:[-.80035,6.849482,0] },
 { p:[-9.7,1.70,14.8], t:[-2.7,2.7,0] },
 { p:[-2.4,1.70,8.8], t:[-1.2,2.2,.2] },
 { p:FOREST_SLOPE_VIEW.p, t:FOREST_SLOPE_VIEW.t },
 { p:[-16.9447,1.95,20.388689], t:[-.80035,6.849482,0] },
];
export const positionPath=new CatmullRomCurve3(CAMERA_STOPS.map(s=>new Vector3(...s.p)),false,'centripetal');
export const targetPath=new CatmullRomCurve3(CAMERA_STOPS.map(s=>new Vector3(...s.t)),false,'centripetal');
export function cameraProgress(progress:number){
 const v=Math.min(.999999,Math.max(0,progress))*4, i=Math.floor(v), f=v-i;
 // Every destination has a gentle dwell; state is reconstructed from scroll.
 return (i+MathUtils.smootherstep(f,.08,.91))/4;
}
export function seeded(seed:number){return()=>{seed|=0; seed=seed+0x6D2B79F5|0; let n=Math.imul(seed^seed>>>15,1|seed); n=n+Math.imul(n^n>>>7,61|n)^n; return ((n^n>>>14)>>>0)/4294967296;};}
export const SHORE={waterY:-1.65, rightX:38, frontZ:68, waterStartZ:18};
export function pathCenter(z:number){
 const forest=12.25+1.05*Math.sin((z+3)*.14)+.22*Math.sin(z*.49);
 const descending=15.5+6.3*MathUtils.smoothstep(-z,-6,10)+.20*Math.sin(z*.24);
 return MathUtils.lerp(descending,forest,MathUtils.smoothstep(z,7,21));
}
export function pathWidth(z:number){
 const forest=1.45+.14*Math.sin(z*.83)+.12*Math.sin(z*1.71);
 return MathUtils.lerp(.78+.065*Math.sin(z*.61),forest,MathUtils.smoothstep(z,7,19));
}
export function pathClearance(x:number,z:number){if(z < -12 || z > 44)return 100;return Math.abs(x-pathCenter(z))-pathWidth(z)*.5;}
export const TERRAIN_GRID={x0:-130,z0:-110,width:190,depth:180,columns:150,rows:140};
function terrainHeight(x:number,z:number){
 const right=SHORE.rightX+3.2*Math.sin(z*.09)+Math.sin(z*.22);
 const front=SHORE.frontZ+4*Math.sin(x*.07);
 const edge=Math.max(x-right,z-front);
 const drop=MathUtils.smoothstep(edge,-6,3)*3.2;
 // Begin the distant rise beyond the rear foundations. A near hill multiplied
 // by the house footing mask previously made a sheer, untextured earth wall.
 const back=MathUtils.smoothstep(-z,24,88)*(4.2+.8*Math.sin(x*.04+1))*(1-MathUtils.smoothstep(x,0,48));
 const side=MathUtils.smoothstep(-x,13,48)*(14+6*Math.cos(z*.035));
 // The house-side foreground is a weed bank. Beyond its crest the narrow
 // path turns right and descends out of view; it does not climb a new hill.
 const rightBank=MathUtils.smoothstep(x,10.5,18.5);
 const valley=rightBank*(1-MathUtils.smoothstep(z,6,14));
 const crest=.58*Math.exp(-1*((x-13.1)/2.8)**2-((z+1)/9)**2);
 const descent=(2.8*MathUtils.smoothstep(-z,-3,13)+.22)*valley;
 const hill=Math.max(back,side)+Math.min(back,side)*.22+crest-descent;
 const courtyard=x>-13 && x<10 && z>-5 && z<8.7;
 const rough=courtyard?0:(Math.sin(x*.84+z*.7)*Math.sin(z*.47-x*.3)*.075+Math.sin(x*.19-z*.27)*.1);
 const woodland=MathUtils.smoothstep(z,8.8,11)*(1-MathUtils.smoothstep(z,31,38))*(1-MathUtils.smoothstep(x,10.5,15));
 const hummocks=woodland*(.16*Math.sin(x*1.37+z*.44)*Math.sin(z*.81-x*.21)+.18*Math.sin(x*.49-z*.61));
 const forestFall=.52*MathUtils.smoothstep(z,9,28)*(1-MathUtils.smoothstep(x,9,17));
 // The remembered rear rooms sit on the house's existing ground datum.
 // Ease their hidden footing into the uphill soil; do not leave terrain
 // triangles crossing the new downstairs support or the upper timber floor.
 const rearFooting=MathUtils.smoothstep(x,-10.2,-8.7)*(1-MathUtils.smoothstep(x,10.75,12.1))
  *MathUtils.smoothstep(z,-15.8,-14.1)*(1-MathUtils.smoothstep(z,-2.9,-2.10));
 return -.10+(hill-drop+rough+hummocks-forestFall)*(1-rearFooting);
}
// Every object samples the triangles the GPU actually draws. Sampling the
// smooth function between coarse terrain vertices made the path disappear
// through the hillside and left some plants hovering above it.
export function groundHeight(x:number,z:number){
 const g=TERRAIN_GRID,dx=g.width/g.columns,dz=g.depth/g.rows;
 const ix=Math.floor((x-g.x0)/dx),iz=Math.floor((z-g.z0)/dz);
 const x0=g.x0+ix*dx,z0=g.z0+iz*dz,u=(x-x0)/dx,v=(z-z0)/dz;
 const a=terrainHeight(x0,z0),b=terrainHeight(x0,z0+dz),d=terrainHeight(x0+dx,z0);
 if(u+v<=1)return a+(d-a)*u+(b-a)*v;
 const c=terrainHeight(x0+dx,z0+dz);return c+(b-c)*(1-u)+(d-c)*(1-v);
}
export function treePositions(){
 const rand=seeded(38216); const items:{x:number;z:number;s:number;rotation:number;variant:number;leanX:number;leanZ:number;relocatedFrom?:number[]}[]=[];
 const paths=Array.from({length:81},(_,i)=>positionPath.getPoint(i/80));
 const add=(x:number,z:number,s:number,variant:number)=>{
  const inlandDescent=x>10.5&&x<35&&z<20;
  if((groundHeight(x,z)<-1.2&&!inlandDescent) || (x>-13&&x<10.5&&z>-5&&z<9))return;
  if(pathClearance(x,z)<.6)return;
  if(x>10.5&&x<25&&z>-18&&z<8)return; // leave the meadow bank and descending lane open
  if(z<13.1&&z>9&&x>-3&&x<3)return;
  if(paths.some(p=>(p.x-x)**2+(p.z-z)**2<.72**2))return;
  if([FOREST_SLOPE_VIEW, BREEZE_VIEW, MOON_VIEW].some(view=>(view.p[0]-x)**2+(view.p[2]-z)**2<.85**2))return;
  const anchored=(z<24&&x>-14&&x<12)||paths.some(p=>(p.x-x)**2+(p.z-z)**2<3.5**2)||[FOREST_SLOPE_VIEW, BREEZE_VIEW, MOON_VIEW].some(view=>(view.p[0]-x)**2+(view.p[2]-z)**2<3.5**2);
  const lean=anchored?0:(.025+.045*Math.abs(Math.sin(x*3.47+z*1.18)));
  items.push({x,z,s,rotation:rand()*Math.PI*2,variant,leanX:Math.sin(x*4.12-z)*lean,leanZ:Math.sin(z*2.35+x)*lean});
 };
 // Uneven foreground positions based on the upright bands in photograph 2.
 [[-9.4,22,1.06],[-2.6,22,.83],[2.9,24,1.03],[6,21,.88],[-11,17,1],[-7.9,15,.82],[-3.1,14,.85],[3.8,15,.91],[8.9,13,1.03],[-.2,19,.8],[.9,10.9,.9],[-12.9,10,.8]].forEach((v,i)=>add(v[0],v[1],v[2],i%4));
 for(let i=0;i<760;i++){
  const x=-47+rand()*82,z=-45+rand()*100;
  // Dense banks, open existing hard courtyard, irregular understory.
  if(z>9&&z<28&&x>-10&&x<9&&rand()>.7)continue;
  add(x,z,1.0+rand()*.52,i%4);
 }
 // The reference is clumping bamboo: close, dark culms supporting a leaf curtain.
 // Preserve the courtyard and every existing camera corridor.
 const clumpRandom=seeded(9108);
 for(const [cx,cz,count] of [[-4.7,10.2,9],[5.4,10.1,14]] ){
  for(let i=0;i<count;i++){
   const angle=clumpRandom()*Math.PI*2,radius=.22+clumpRandom()*.65;
   add(cx+Math.cos(angle)*radius,cz+Math.sin(angle)*radius,1.1+clumpRandom()*.24,i%4);
  }
 }
 for(const [cx,cz] of [[-11.4,12.9],[-8.7,18.5],[-5.4,23.3],[-1.5,17.0],[2.9,19.4],[7.1,16.1],[9.0,22.8],[-12.8,25.1],[.6,26.4],[5.7,27.9],[-7.8,27.1],[9.4,11.1]]){
  for(let j=0;j<8;j++){
   const a=clumpRandom()*Math.PI*2,r=.10+clumpRandom()*.64;
   add(cx+Math.cos(a)*r,cz+Math.sin(a)*r,.68+clumpRandom()*.36,j%4);
  }
 }
 // An uneven second bank interrupts the bright horizon. Preserve narrow
 // glimpses of the reservoir between culms, as in the sunny humid reference.
 for(let clump=0;clump<60;clump++){
  const cx=-29+clumpRandom()*63,cz=30+clumpRandom()*36;
  for(let j=0;j<5;j++){
   const angle=clumpRandom()*Math.PI*2,radius=.18+clumpRandom()*1.05;
   add(cx+Math.cos(angle)*radius,cz+Math.sin(angle)*radius,.92+clumpRandom()*.49,(clump+j)%4);
  }
 }
 // Younger bamboo beyond the hidden descending bend closes the middle
 // layer. Mature stems alone left the inferred rear terrain against white sky.
 const bankRandom=seeded(488921);
 for(const [cx,cz] of [[26,-6],[27,-14],[29,-24],[32,-5],[33,-14],[25.5,-29]]){
  for(let j=0;j<12;j++){
   const angle=bankRandom()*Math.PI*2,r=.12+bankRandom()*1.45;
   add(cx+Math.cos(angle)*r,cz+Math.sin(angle)*r,.28+bankRandom()*.25,j%4);
  }
 }
 // Younger culms bring leaves into the middle layer where the photographs
 // show the lake being screened; the high mature canopy alone left a stripe.
 for(let i=0;i<82;i++)add(-23+clumpRandom()*55,27+clumpRandom()*32,.40+clumpRandom()*.30,i%4);
 for(let cluster=0;cluster<60;cluster++){
  const cx=-28+clumpRandom()*61,cz=35+clumpRandom()*7.5;
  for(let j=0;j<4;j++){
   const angle=clumpRandom()*Math.PI*2,r=.14+clumpRandom()*.66;
   add(cx+Math.cos(angle)*r,cz+Math.sin(angle)*r,.22+clumpRandom()*.16,j===3?cluster%4:3);
  }
 }
 const phonePath=Array.from({length:501},(_,i)=>{
  const progress=i/500,p=positionPath.getPoint(cameraProgress(progress)),t=targetPath.getPoint(cameraProgress(progress));
  const factor=1.08;p.x=t.x+(p.x-t.x)*factor;p.z=t.z+(p.z-t.z)*factor;return p;
 });
 return items.filter(tree=>!phonePath.some(p=>(p.x-tree.x)**2+(p.z-tree.z)**2<.75**2)).map((tree,i)=>{
  // Old culms break above the uneven crown; younger, lower crowns still screen
  // eye level. Change selected stands, rather than uniformly raising the wood.
  const mature=tree.s>.72&&tree.z>9&&tree.z<37&&tree.x>-19&&tree.x<23;
  if(mature){
   const age=Math.abs(Math.sin(tree.x*1.719+tree.z*.851));
   if(i%7===0)tree.s=1.55+age*.48;
   else if(i%5===0)tree.s=.73+age*.24;
   else if(i%3===0)tree.s=1.13+age*.36;
   const corridor=paths.some(p=>(p.x-tree.x)**2+(p.z-tree.z)**2<3.5**2)||phonePath.some(p=>(p.x-tree.x)**2+(p.z-tree.z)**2<3.5**2);
   if(!corridor&&pathClearance(tree.x,tree.z)>2){
    tree.leanX=Math.sin(tree.x*2.19+tree.z)*.052;
    tree.leanZ=Math.sin(tree.z*1.71-tree.x)*.073;
   }
  }
  // Preserve the bamboo identities and every foreground branch attachment.
  // Rear roots and their broad crowns must clear the expanded kitchen,
  // warehouse and bedrooms. Preserve their identities and foreground bindings.
  if(tree.x>-10.5&&tree.x<12.0&&tree.z<-4.82&&tree.z>-17.7) {
   tree.relocatedFrom=[tree.x,tree.z];
   tree.z=-19.5-Math.abs(Math.sin(tree.x*7.1+tree.z*2.3))*3.1;
  }
  return tree;
 });
}

/** Branch origins are bound to real scattered culms. p is the lower end of
 * each hanging crown, not its attachment; root height snaps to a culm ring. */
export function porchBranchPlacements(trees=treePositions()){
 const specs=[
  // Near hanging sprays: intentionally denser on the lake-facing (+X) side.
  [-2.8,2.6,5.9,1.08,.25,0,0,-4.7,10.2,8.3],
  [2.8,2.3,6.5,1.2,-.3,0,0,5.4,10.1,8.5],
  [.7,3.6,8,1,.15,0,0,.9,10.9,8.6],
  [-4.3,3,9,1.05,.6,0,0,-7.9,15,8.5],
  [6.6,3.8,11.3,1.05,-.6,0,0,8.9,13,9.3],
  [-.6,3.9,15.4,.9,.7,0,0,-.2,19,8.5],
  [4.9,3.0,6.1,1.0,.9,.12,-.12,5.4,10.1,8.0],
  [6.5,3.6,7.8,1.2,-.45,-.12,.14,8.9,13,9.7],
  [3.6,4.7,6.4,.92,-.82,.18,.37,5.4,10.1,9.1],
  [-4.7,4.2,6.7,.94,.85,-.16,-.31,-4.7,10.2,9.6],
  [-2.0,5.1,7.7,.9,-.48,.1,-.45,-3.1,14,10.6],
  // Long side branches overlap overhead, with small irregular light holes.
  [2.0,7.3,7.2,1.20,.40,.22,.65,5.4,10.1,12.2],
  [-1.6,7.6,7.8,1.12,-.58,-.15,-.65,-4.7,10.2,12.6],
  [5.8,7.0,10.3,1.30,-.38,.15,.27,8.9,13,13.8],
  [-5.3,7.6,10.6,1.18,.75,-.16,-.22,-7.9,15,13.6],
  [.5,8.8,12.0,1.18,.92,.12,-.45,-.2,19,15.0],
  // Middle growth supplies overlapping leaf layers below the tall crown.
  [8.4,1.5,13.2,.88,.4,.1,-.3,9.4,14.1,7.2],
  [6.3,2.0,14.9,1.0,-.8,-.15,.25,7.1,16.1,7.0],
  [3.6,2.7,14.0,.82,.9,.08,-.20,3.8,15,7.1],
  [10.6,3.6,17.2,1.25,-.35,.1,.32,9.0,22.8,10.8],
  [7.0,4.3,18.9,1.1,.95,-.12,-.18,7.1,16.1,10.4],
  [-8.2,2.3,16.4,1.0,-.65,.16,.14,-8.7,18.5,8.7],
  [-4.9,2.9,19.0,.96,.7,-.08,-.21,-5.4,23.3,8.8],
  [-.2,4.4,21.0,1.16,-.4,.1,.32,-1.5,17,11.1],
  [3.8,3.2,23.5,1.15,.45,-.13,-.23,2.9,19.4,10.0],
  [11.9,2.8,25.2,1.16,-.75,.12,.15,9.0,22.8,9.5],
  [-9.8,5.7,22.0,1.25,.68,.16,-.18,-11.4,12.9,11.0],
  [6.0,8.9,20.8,1.34,-.1,.1,.4,7.1,16.1,15.8],
 ];
 return specs.map(([x,y,z,s,r,rx,rz,tx,tz,height])=>{
  let tree=0,distance=Infinity;
  trees.forEach((t,i)=>{const top=groundHeight(t.x,t.z)+[12.8,11.5,13.65,10.6][t.variant]*t.s;const d=(t.x-tx)**2+(t.z-tz)**2+(t.s<.9?40:0)+(top<height+.4?1000:0);if(d<distance){distance=d;tree=i;}});
  return {p:[x,y,z],s,r,rx,rz,tree,height};
 });
}
