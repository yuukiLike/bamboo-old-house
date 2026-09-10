import { Vector3, CatmullRomCurve3, MathUtils } from 'three';
export const BUILD_ID = 'bamboo-2026-09-10-open-warm-home';
export type ViewMode = 'porch' | 'walk' | 'interior' | 'detail';
export type TimeOfDay = 'day' | 'noon' | 'night';
// Shared with the editable Blender environment export (metres, web Y up).
export const SUN_PRESETS = {
 day: { position: [22, 20, 30], color: 0xffedcc, intensity: 4.2 },
 noon: { position: [-16, 48, 30], color: 0xffe7c2, intensity: 5.0 },
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
export type RoomId = 'upstairs' | 'store' | 'room-one' | 'room-two' | 'hall' | 'kitchen';
export const ROOM_VIEWS: Record<RoomId, {label:string; p:number[]; t:number[]; fov:number}> = {
 upstairs: {label:'二层厅堂',p:[0,4.85,-.60],t:[1.35,3.90,-3.80],fov:66},
 store: {label:'仓库',p:[4.08,4.85,-1.35],t:[5.25,4.10,-4.80],fov:68},
 'room-one': {label:'住屋一',p:[.65,4.85,-9.35],t:[1.15,4.20,-11.85],fov:66},
 'room-two': {label:'住屋二',p:[6.05,4.85,-9.35],t:[8.30,4.25,-11.75],fov:66},
 hall: {label:'一楼堂屋',p:[-1.68,1.75,-1.1],t:[0,1.65,-2.67],fov:72},
 kitchen: {label:'一楼厨房',p:[-2.85,1.80,-1.15],t:[-5.45,1.12,-2.50],fov:74},
};
export const DETAIL_VIEWS = {
 wall: {label:'柴房墙脚',p:[-5.1,1.5,5.8],t:[-6.9,.8,2.8],fov:64,note:'近看红泥墙、旧竹竿和路沿的小草。'},
 pail: {label:'旧桶与院坝',p:[-4.30,1.10,4.00],t:[-5.08,.20,2.69],fov:55,note:'旧木桶搁在院坝上，木条和箍带都磨旧了。'},
 window: {label:'窗前旧物',p:[-3.05,1.68,2.80],t:[-4.72,1.13,-1.68],fov:48,note:'日光透过旧窗，屋里是老电视和吃饭的木桌。'},
 hall: {label:'祠堂旧门',p:[-.55,1.7,3.6],t:[0,1.65,-2.60],fov:59,note:'在门前停一停，看囍字、旧对联和柴草。'},
 slope: {label:'屋旁小山',p:[9.2,1.65,3.2],t:[14.5,1.2,-4.5],fov:67,note:'水泥地渐渐接进坡脚的泥土、落叶和草。'},
 remains: {label:'林边残墙',p:[-10,1.6,6.5],t:[-13.4,.6,2.5],fov:62,note:'残破红土墙旁，枯草和朽木压在旧坡上。'},
 forest: {label:'竹林坡地',p:[-6.5,1.55,11.2],t:[-9,.1,17],fov:65,note:'竹叶落在缓坡上，细根沿着土面伸展。'},
} as const;
export type DetailId = keyof typeof DETAIL_VIEWS;
export const FUEL_PLACEMENTS = [
 {x:5.2,z:6.7,rotation:.13,scale:1.18},
 {x:-3,z:6.1,rotation:-.21,scale:.72},
];
export const CAMERA_STOPS = [
 { p:[-16.9447,1.95,20.388689], t:[-.80035,6.849482,0] },
 { p:[-9.7,1.70,14.8], t:[-2.7,2.7,0] },
 { p:[-2.4,1.70,8.8], t:[-1.2,2.2,.2] },
 { p:[-4.7,1.65,6.1], t:[-7.2,1.4,1.7] },
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
export const SHORE={waterY:-1.65, rightX:38, frontZ:68};
export function pathCenter(z:number){return 12.25+1.05*Math.sin((z+3)*.14)+.22*Math.sin(z*.49);}
export function pathWidth(z:number){return 1.45+.14*Math.sin(z*.83)+.12*Math.sin(z*1.71);}
export function pathClearance(x:number,z:number){if(z < -12 || z > 44)return 100;return Math.abs(x-pathCenter(z))-pathWidth(z)*.5;}
export const TERRAIN_GRID={x0:-130,z0:-110,width:190,depth:180,columns:150,rows:140};
function terrainHeight(x:number,z:number){
 const right=SHORE.rightX+3.2*Math.sin(z*.09)+Math.sin(z*.22);
 const front=SHORE.frontZ+4*Math.sin(x*.07);
 const edge=Math.max(x-right,z-front);
 const drop=MathUtils.smoothstep(edge,-6,3)*3.2;
 const back=MathUtils.smoothstep(-z,5,40)*(13+5*Math.sin(x*.04+1));
 const side=MathUtils.smoothstep(-x,13,48)*(14+6*Math.cos(z*.035));
 // A nearby hill rises beyond a low shoulder. The photographed footpath and
 // house footing stay at the courtyard level instead of crossing a tall mound.
 const shoulder=MathUtils.smoothstep(x,10.4,17.5);
 const pathShoulder=.08+.92*MathUtils.smoothstep(pathClearance(x,z),.45,3.2);
 const mound=4.1*Math.exp(-1*((x-20)/9)**2-((z+10)/13)**2)*shoulder*pathShoulder;
 const hill=Math.max(back,side)+Math.min(back,side)*.22+mound;
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
  if(groundHeight(x,z)<-1.2 || (x>-13&&x<10.5&&z>-5&&z<9))return;
  if(pathClearance(x,z)<.6)return;
  if(z<13.1&&z>9&&x>-3&&x<3)return;
  if(paths.some(p=>(p.x-x)**2+(p.z-z)**2<.72**2))return;
  if(Object.values(DETAIL_VIEWS).some(view=>(view.p[0]-x)**2+(view.p[2]-z)**2<.85**2))return;
  const anchored=(z<24&&x>-14&&x<12)||paths.some(p=>(p.x-x)**2+(p.z-z)**2<3.5**2)||Object.values(DETAIL_VIEWS).some(view=>(view.p[0]-x)**2+(view.p[2]-z)**2<3.5**2);
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
