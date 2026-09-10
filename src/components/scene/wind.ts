/** The same slow gust travels through culms and their attached crowns. */
export function forestWindGust(time:number,x=0,z=0){
 const front=.5+.5*Math.sin(time*.23-x*.035-z*.055);
 const second=.5+.5*Math.sin(time*.41+x*.019-z*.043+1.7);
 return .14+.65*front**3+.21*second**4;
}

export const FOREST_WIND_GLSL=`
uniform float uWindTime;
float forestGust(vec3 root){
 float front=.5+.5*sin(uWindTime*.23-root.x*.035-root.z*.055);
 float second=.5+.5*sin(uWindTime*.41+root.x*.019-root.z*.043+1.7);
 return .14+.65*pow(front,3.)+.21*pow(second,4.);
}
vec3 forestWindOffset(vec3 root,float strength){
 float gust=forestGust(root);
 float tremor=sin(uWindTime*1.17-root.x*.15+root.z*.11)*.038;
 return vec3((gust*.64+tremor)*strength,0.,
  (gust*.25+sin(uWindTime*.67+root.x*.07)*.06)*strength);
}
vec3 windToLocal(mat4 im,vec3 worldOffset){
 float scaleSquared=dot(im[0].xyz,im[0].xyz);
 return vec3(dot(im[0].xyz,worldOffset),dot(im[1].xyz,worldOffset),
  dot(im[2].xyz,worldOffset))/max(scaleSquared,.0001);
}
`;
