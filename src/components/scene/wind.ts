const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const smooth=(a:number,b:number,v:number)=>{const u=clamp((v-a)/(b-a),0,1);return u*u*(3-2*u);};
const GUST_PERIOD=18.4,GUST_DURATION=5.2;
const gustAge=(time:number,x:number,z:number)=>time+3.4-x*.105-z*.042;
const gustAmplitude=(cycle:number)=>.8+.17*Math.sin(cycle*1.71+.8);

/** Shared air-pressure envelope, 0..1. A five-second gust travels through the
 * grove at about 9 m/s, then leaves room for quiet. Its strength changes each
 * pass. Audio samples this same function at the listener, using the scene clock. */
export function forestWindGust(time:number,x=0,z=0){
 const t=gustAge(time,x,z),cycle=Math.floor(t/GUST_PERIOD),age=t-cycle*GUST_PERIOD;
 const pulse=age<GUST_DURATION?.5-.5*Math.cos(age*Math.PI*2/GUST_DURATION):0;
 return gustAmplitude(cycle)*pulse;
}

// Exact response to a raised-cosine load for x'' + .86 x' + 1.5625 x = 1.5625 f.
// After the load passes, stored elastic energy makes one visible return swing
// and progressively smaller rebounds. The last sub-millimetre tail fades away.
function gustResponse(age:number){
 if(age<0||age>=24)return 0;
 if(age<5.2){
  return .5*(1-.146887933005*Math.cos(1.208304866765*age)-1.48915529002*Math.sin(1.208304866765*age))
   +.5*Math.exp(-.43*age)*(-.853112066995*Math.cos(1.17371206009*age)+1.220499851883*Math.sin(1.17371206009*age));
 }
 const t=age-5.2;
 return Math.exp(-.43*t)*(.370029188724*Math.cos(1.17371206009*t)-.55423284125*Math.sin(1.17371206009*t))*(1-smooth(22,24,age));
}
/** Signed elastic response. Negative values are the natural return past rest,
 * not a second wind blowing in the opposite direction. Adjacent event tails
 * overlap, keeping position and velocity continuous at a new gust's start. */
export function forestWindResponse(time:number,x=0,z=0){
 const t=gustAge(time,x,z),cycle=Math.floor(t/GUST_PERIOD),age=t-cycle*GUST_PERIOD;
 return gustAmplitude(cycle)*gustResponse(age)+gustAmplitude(cycle-1)*gustResponse(age+GUST_PERIOD);
}
/** Fine branch flex follows the same gust with a short additional delay. */
export function forestBranchSecondary(time:number,x:number,z:number,wind:number){
 const phase=x*.39+z*.21,response=wind*(.3+.7*wind),gust=forestWindGust(time-.8,x,z),bend=forestWindResponse(time-1.1,x,z);
 return [(bend*.075+Math.sin(time*2.7+phase)*gust*.025)*response,-Math.abs(bend)*.025*response,
  (bend*.030+Math.sin(time*3.3+phase*1.4)*gust*.025)*response] as [number,number,number];
}
/** A sheltered, bounded displacement budget in metres, derived from the root
 * rather than instance IDs so visibility compaction cannot change the motion. */
export function forestWindEnvelope(x:number,z:number){
 const house=Math.hypot(Math.max(-13-x,0,x-10.5),Math.max(-17.7-z,0,z-9));
 return .68+1.12*smooth(1.0,7,house);
}
export type CulmCurve=ReadonlyArray<readonly [number,number,number]>;

function curveStrain(u:number,squaredTip:number,curveDots:readonly number[],h:number){
 const slope=3*u-1.5*u*u;
 const rest=curveDots.reduceRight((sum,value,index)=>sum*u+(index+1)*value,0);
 return (2*rest*slope+squaredTip*slope*slope)/(h*h);
}
function curvedShortening(u:number,squaredTip:number,curveDots:readonly number[],h:number){
 const shorteningAt=(fraction:number)=>{const s=curveStrain(u*fraction,squaredTip,curveDots,h);return s*.5+s*s*.125;};
 return u*h*(.173927422569*(shorteningAt(.069431844203)+shorteningAt(.930568155797))
  +.326072577431*(shorteningAt(.330009478208)+shorteningAt(.669990521792)));
}

/** CPU counterpart used for dropping attached leaves and geometry verification.
 * The shape is the cantilever end-load curve u²(3-u)/2. Integrating its squared
 * slope supplies vertical shortening through fourth order instead of stretching culms.
 * This is a bounded visual response to a wind field, not a structural solver. */
export function forestWindBend(time:number,x:number,z:number,height:number,length:number,wind=.28,axis:[number,number,number]=[0,1,0],curve?:CulmCurve){
 const h=Math.max(length,.25),u=clamp(height/h,0,1.12),phase=x*.17+z*.11;
 const delayed=time-(.45+h*.024+.18*Math.sin(phase));
 const response=forestWindResponse(delayed,x,z),w=clamp(wind,0,1);
 // Perceptual control: an ordinary breeze remains visible, while the storm
 // endpoint keeps the same safe displacement budget.
 const amplitude=w*(1.65-.65*w)*forestWindEnvelope(x,z)*Math.min(1,h/10);
 const dx=(.045+response*.94+Math.sin(time*.81+phase)*.014)*amplitude;
 const dz=(.025+response*.37+Math.sin(time*.63+phase*1.27)*.012)*amplitude;
 const along=dx*axis[0]+dz*axis[2],tip=[dx-axis[0]*along,-axis[1]*along,dz-axis[2]*along];
 const shape=u*u*(3-u)*.5,slope=(3*u-1.5*u*u)/h;
 const squaredTip=tip[0]**2+tip[1]**2+tip[2]**2,squaredSlope=squaredTip*slope*slope;
 const fourthIntegral=u**5*(16.2+u*(-27+u*(121.5/7+u*(-5.0625+.5625*u))));
 let shortening=squaredTip/(2*h)*(3*u**3-2.25*u**4+.45*u**5)+squaredTip*squaredTip/(8*h**3)*fourthIntegral;
 let verticalSlope=-squaredSlope*.5-squaredSlope*squaredSlope*.125;
 if(curve){
  const dots=curve.map(c=>c[0]*tip[0]+c[1]*tip[1]+c[2]*tip[2]),strain=curveStrain(u,squaredTip,dots,h);
  shortening=curvedShortening(u,squaredTip,dots,h);verticalSlope=-strain*.5-strain*strain*.125;
 }
 return {offset:tip.map((v,i)=>v*shape-axis[i]*shortening) as [number,number,number],derivative:tip.map((v,i)=>v*slope+axis[i]*verticalSlope) as [number,number,number]};
}

// GPU formulation follows the CPU counterpart above. Shared by foliage,
// culms, bound branches and their depth materials; no per-vertex CPU work.
export const FOREST_WIND_GLSL=`
uniform float uWindTime;
uniform float uWindStrength;
float forestGustAge(vec3 root,float t){return t+3.4-root.x*.105-root.z*.042;}
float forestGustAmplitude(float cycle){return .8+.17*sin(cycle*1.71+.8);}
float forestGustAt(vec3 root,float t){
 float localTime=forestGustAge(root,t),cycle=floor(localTime/18.4),age=localTime-cycle*18.4;
 float pulse=age<5.2?.5-.5*cos(age*1.208304866765):0.;
 return forestGustAmplitude(cycle)*pulse;
}
float forestGust(vec3 root){return forestGustAt(root,uWindTime);}
float forestGustResponse(float age){
 if(age<0.||age>=24.)return 0.;
 if(age<5.2){
  return .5*(1.-.146887933005*cos(1.208304866765*age)-1.48915529002*sin(1.208304866765*age))
   +.5*exp(-.43*age)*(-.853112066995*cos(1.17371206009*age)+1.220499851883*sin(1.17371206009*age));
 }
 float t=age-5.2;
 return exp(-.43*t)*(.370029188724*cos(1.17371206009*t)-.55423284125*sin(1.17371206009*t))*(1.-smoothstep(22.,24.,age));
}
float forestResponseAt(vec3 root,float t){
 float localTime=forestGustAge(root,t),cycle=floor(localTime/18.4),age=localTime-cycle*18.4;
 return forestGustAmplitude(cycle)*forestGustResponse(age)+forestGustAmplitude(cycle-1.)*forestGustResponse(age+18.4);
}
vec3 forestBranchSecondary(vec3 root){
 float phase=root.x*.39+root.z*.21,response=uWindStrength*(.3+.7*uWindStrength);
 float gust=forestGustAt(root,uWindTime-.8),bend=forestResponseAt(root,uWindTime-1.1);
 return vec3(bend*.075+sin(uWindTime*2.7+phase)*gust*.025,-abs(bend)*.025,
  bend*.030+sin(uWindTime*3.3+phase*1.4)*gust*.025)*response;
}
float forestWindEnvelope(vec3 root){
 vec2 outside=max(max(vec2(-13.,-17.7)-root.xz,root.xz-vec2(10.5,9.)),vec2(0.));
 return .68+1.12*smoothstep(1.,7.,length(outside));
}
vec2 forestWindTip(vec3 root,float fullHeight){
 float phase=root.x*.17+root.z*.11;
 float delayed=uWindTime-(.45+fullHeight*.024+.18*sin(phase));
 float response=forestResponseAt(root,delayed);
 float w=clamp(uWindStrength,0.,1.);
 float amplitude=w*(1.65-.65*w)*forestWindEnvelope(root)*min(1.,fullHeight/10.);
 return vec2(.045+response*.94+sin(uWindTime*.81+phase)*.014,
  .025+response*.37+sin(uWindTime*.63+phase*1.27)*.012)*amplitude;
}
vec3 forestTipAlong(vec3 root,float fullHeight,vec3 axis){
 vec2 force=forestWindTip(root,max(fullHeight,.25));vec3 tip=vec3(force.x,0.,force.y);
 return tip-axis*dot(tip,axis);
}
// Rest curvature contributes to arc length too. Integrate the axial correction
// with four-point Gauss quadrature, keeping the artist's unequal internodes.
float forestCurveStrain(float u,float squaredTip,vec4 dots,float fifth,float h){
 float slope=3.*u-1.5*u*u;
 float rest=dots.x+u*(2.*dots.y+u*(3.*dots.z+u*(4.*dots.w+5.*fifth*u)));
 return (2.*rest*slope+squaredTip*slope*slope)/(h*h);
}
float forestCurveShorteningAt(float u,float squaredTip,vec4 dots,float fifth,float h){
 float strain=forestCurveStrain(u,squaredTip,dots,fifth,h);
 return strain*.5+strain*strain*.125;
}
vec3 forestCurvedOffset(vec3 tip,float height,float fullHeight,vec3 axis,vec4 dots,float fifth){
 float h=max(fullHeight,.25),u=clamp(height/h,0.,1.12),squaredTip=dot(tip,tip);
 float shortening=u*h*(.173927422569*(forestCurveShorteningAt(u*.069431844203,squaredTip,dots,fifth,h)+forestCurveShorteningAt(u*.930568155797,squaredTip,dots,fifth,h))
  +.326072577431*(forestCurveShorteningAt(u*.330009478208,squaredTip,dots,fifth,h)+forestCurveShorteningAt(u*.669990521792,squaredTip,dots,fifth,h)));
 return tip*(u*u*(3.-u)*.5)-axis*shortening;
}
vec3 forestCurvedDerivative(vec3 tip,float height,float fullHeight,vec3 axis,vec4 dots,float fifth){
 float h=max(fullHeight,.25),u=clamp(height/h,0.,1.12),strain=forestCurveStrain(u,dot(tip,tip),dots,fifth,h);
 return tip*((3.*u-1.5*u*u)/h)-axis*(strain*.5+strain*strain*.125);
}
vec3 forestBendOffsetAlong(vec3 root,float height,float fullHeight,vec3 axis){
 float h=max(fullHeight,.25),u=clamp(height/h,0.,1.12);
 vec2 force=forestWindTip(root,h);
 vec3 tip=vec3(force.x,0.,force.y);tip-=axis*dot(tip,axis);
 float shape=u*u*(3.-u)*.5;
 float squaredTip=dot(tip,tip);
 float fourthIntegral=(u*u*u*u*u)*(16.2+u*(-27.+u*(17.35714285714+u*(-5.0625+.5625*u))));
 float shortening=squaredTip/(2.*h)*(3.*(u*u*u)-2.25*(u*u*u*u)+.45*(u*u*u*u*u))+squaredTip*squaredTip/(8.*h*h*h)*fourthIntegral;
 return tip*shape-axis*shortening;
}
vec3 forestBendDerivativeAlong(vec3 root,float height,float fullHeight,vec3 axis){
 float h=max(fullHeight,.25),u=clamp(height/h,0.,1.12);
 vec2 force=forestWindTip(root,h);
 vec3 tip=vec3(force.x,0.,force.y);tip-=axis*dot(tip,axis);
 float slope=(3.*u-1.5*u*u)/h;
 float squaredSlope=dot(tip,tip)*slope*slope;
 return tip*slope-axis*(squaredSlope*.5+squaredSlope*squaredSlope*.125);
}
vec3 forestBendOffset(vec3 root,float height,float fullHeight){return forestBendOffsetAlong(root,height,fullHeight,vec3(0.,1.,0.));}
vec3 forestBendDerivative(vec3 root,float height,float fullHeight){return forestBendDerivativeAlong(root,height,fullHeight,vec3(0.,1.,0.));}
// Instance columns are orthogonal, but grass blades may be stretched in Y.
// Invert each scale separately; normals use the inverse transpose.
vec3 windToLocal(mat4 im,vec3 worldOffset){
 vec3 squared=max(vec3(dot(im[0].xyz,im[0].xyz),dot(im[1].xyz,im[1].xyz),dot(im[2].xyz,im[2].xyz)),vec3(.0001));
 return vec3(dot(im[0].xyz,worldOffset),dot(im[1].xyz,worldOffset),dot(im[2].xyz,worldOffset))/squared;
}
vec3 windNormal(vec3 normal,mat4 im,vec3 derivative){
 vec3 squared=max(vec3(dot(im[0].xyz,im[0].xyz),dot(im[1].xyz,im[1].xyz),dot(im[2].xyz,im[2].xyz)),vec3(.0001));
 vec3 axis=normalize(im[1].xyz),worldNormal=normalize(mat3(im)*(normal/squared));
 worldNormal-=axis*(dot(derivative,worldNormal)/max(.6,1.+dot(axis,derivative)));
 return normalize(vec3(dot(im[0].xyz,worldNormal),dot(im[1].xyz,worldNormal),dot(im[2].xyz,worldNormal)));
}
// Minimal rotation carries a branch's whole frame with its bent parent.
vec3 windRotate(vec3 v,vec3 axis,vec3 derivative){
 vec3 target=normalize(axis+derivative),k=cross(axis,target);
 return v+cross(k,v)+cross(k,cross(k,v))/max(.5,1.+dot(axis,target));
}
`;
