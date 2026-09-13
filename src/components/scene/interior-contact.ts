import * as T from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { ContactRefresh } from './contact-refresh';

class ScaledGTAO extends GTAOPass {
 // Three exposes this target, but the installed declaration omits it.
 declare normalRenderTarget:T.WebGLRenderTarget;
 constructor(scene:T.Scene,camera:T.PerspectiveCamera,private readonly resolutionScale:number) {
  super(scene,camera,16,16);
 }
 override setSize(width:number,height:number) {
  super.setSize(Math.max(1,Math.round(width*this.resolutionScale)),Math.max(1,Math.round(height*this.resolutionScale)));
 }
}

/** The house is static, so its contact shade changes only with the camera. */
class CachedContactPass extends ShaderPass {
 private readonly refresh=new ContactRefresh();
 private readonly view=new T.Matrix4();
 private readonly projection=new T.Matrix4();
 private warmed=false;
 constructor(readonly contact:ScaledGTAO,readonly motionContact:ScaledGTAO,private readonly camera:T.PerspectiveCamera) {
  super({
   name:'CachedInteriorContact',
   uniforms:{tDiffuse:{value:null},tContact:{value:null},tRefined:{value:null},refinement:{value:0},intensity:{value:contact.blendIntensity}},
   vertexShader:`varying vec2 vUv;
    void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
   // This is the same multiplication as GTAOPass's copy + DstColor blend,
   // including its destination-alpha factor, in one fullscreen draw.
   fragmentShader:`uniform sampler2D tDiffuse;uniform sampler2D tContact;uniform sampler2D tRefined;
    uniform float refinement;uniform float intensity;varying vec2 vUv;
    void main(){vec4 beauty=texture2D(tDiffuse,vUv);vec4 shade=texture2D(tContact,vUv);
     if(refinement>0.)shade=mix(shade,texture2D(tRefined,vUv),refinement);
     gl_FragColor=beauty*vec4(mix(vec3(1.),shade.rgb,intensity),shade.a);}`,
  });
  // ShaderPass clones its uniform definitions; render-target textures must
  // be attached afterwards so Three does not replace them with null.
  this.uniforms.tContact.value=contact.gtaoMap;
  this.uniforms.tRefined.value=contact.gtaoMap;
  this.material.depthTest=false;this.material.depthWrite=false;
  contact.output=motionContact.output=GTAOPass.OUTPUT.Off;
 }
 override setSize(width:number,height:number) {
  this.contact.setSize(width,height);this.motionContact.setSize(width,height);this.refresh.invalidate();this.warmed=false;
 }
 resetForViewChange() {
  // A destination jump is already settled. Render its full contact detail
  // on the first frame instead of treating the new room as an ongoing pan.
  this.refresh.invalidate();
 }
 warm(renderer:T.WebGLRenderer,writeBuffer:T.WebGLRenderTarget,readBuffer:T.WebGLRenderTarget) {
  if(this.warmed)return;
  this.camera.updateWorldMatrix(true,false);
  // Drivers can defer work until the first draw. Warm both fixed variants
  // under the loading cover, rather than allocating a new pass during input.
  this.contact.render(renderer,writeBuffer,readBuffer,0,false);
  this.motionContact.render(renderer,writeBuffer,readBuffer,0,false);
  this.view.copy(this.camera.matrixWorld);this.projection.copy(this.camera.projectionMatrix);
  this.refresh.invalidate();this.refresh.next(false,performance.now()/1000);this.warmed=true;
 }
 override render(renderer:T.WebGLRenderer,writeBuffer:T.WebGLRenderTarget,readBuffer:T.WebGLRenderTarget,deltaTime:number,maskActive:boolean) {
  this.camera.updateWorldMatrix(true,false);
  const changed=!this.view.equals(this.camera.matrixWorld)||!this.projection.equals(this.camera.projectionMatrix);
  const quality=this.refresh.next(changed,performance.now()/1000);
  if(quality) {
   (quality==='motion'?this.motionContact:this.contact).render(renderer,writeBuffer,readBuffer,deltaTime,maskActive);
   this.view.copy(this.camera.matrixWorld);this.projection.copy(this.camera.projectionMatrix);
  }
  this.uniforms.tContact.value=this.refresh.refining||this.refresh.quality==='motion'?this.motionContact.gtaoMap:this.contact.gtaoMap;
  this.uniforms.refinement.value=this.refresh.refining?this.refresh.refinement:0;
  this.uniforms.intensity.value=this.contact.blendIntensity;
  super.render(renderer,writeBuffer,readBuffer,deltaTime,maskActive);
 }
 override dispose() {
  super.dispose();
  for(const contact of [this.contact,this.motionContact]) {contact.gtaoMaterial.dispose();contact.blendMaterial.dispose();contact.dispose();}
 }
}

/** Local contact shade for the rooms. Only the static house enters the normal
 * pass; the full bamboo scene still supplies the beauty image outside doors. */
export function createInteriorContact(renderer:T.WebGLRenderer,scene:T.Scene,camera:T.PerspectiveCamera,house:T.Group,mobile:boolean) {
 let pipeline:ReturnType<typeof build>|undefined;
 let preparing:Promise<void>|undefined,preparationPending=false,disposed=false;
 function build() {
  const occluders=new T.Scene();house.updateWorldMatrix(true,true);
  const copy=house.clone(true);copy.matrixAutoUpdate=false;copy.matrix.copy(house.matrixWorld);
  copy.traverse(object=>{
   if(!(object instanceof T.Mesh))return;
   const materials=Array.isArray(object.material)?object.material:[object.material];
   if(materials.some(material=>/glazing|old_clear_glass|lamp_glass|frosted_bare_bulb/i.test(material.name)))object.visible=false;
  });
  occluders.add(copy);occluders.updateMatrixWorld(true);occluders.matrixWorldAutoUpdate=false;
  const size=renderer.getSize(new T.Vector2()),ratio=renderer.getPixelRatio();
  const target=new T.WebGLRenderTarget(size.x*ratio,size.y*ratio,{type:T.HalfFloatType,samples:mobile?2:4});
  const composer=new EffectComposer(renderer,target);
  const beauty=new RenderPass(scene,camera);
  const contact=new ScaledGTAO(occluders,camera,.5);
  contact.blendIntensity=.38;
  contact.updateGtaoMaterial({radius:.25,thickness:.18,distanceExponent:1,distanceFallOff:1,scale:1,samples:mobile?12:16,screenSpaceRadius:false});
  contact.updatePdMaterial({radius:3,samples:mobile?8:16,rings:2,radiusExponent:2,lumaPhi:10,depthPhi:.18,normalPhi:3});
  // Only the ambient contact layer is lighter during movement: the beauty
  // image keeps its full resolution, materials, geometry and antialiasing.
  const motionContact=new ScaledGTAO(occluders,camera,.25);
  motionContact.blendIntensity=contact.blendIntensity;
  motionContact.updateGtaoMaterial({radius:.25,thickness:.18,distanceExponent:1,distanceFallOff:1,scale:1,samples:mobile?6:8,screenSpaceRadius:false});
  motionContact.updatePdMaterial({radius:1.5,samples:mobile?4:8,rings:2,radiusExponent:2,lumaPhi:10,depthPhi:.18,normalPhi:3});
  const cachedContact=new CachedContactPass(contact,motionContact,camera);
  const output=new OutputPass();composer.addPass(beauty);composer.addPass(cachedContact);composer.addPass(output);
  // A supplied render target initially gives EffectComposer physical sizes;
  // explicitly establish logical viewport dimensions for correct DPR handling.
  composer.setSize(size.x,size.y);
  return {composer,contact,motionContact,cachedContact,output,occluders};
 }
 function release() {
  if(!pipeline)return;
  pipeline.cachedContact.dispose();pipeline.output.dispose();pipeline.composer.dispose();pipeline.occluders.clear();pipeline=undefined;
 }
 async function prepare() {
  const {composer,contact,motionContact,cachedContact,output,occluders}=pipeline??=build();
  const geometry=new T.PlaneGeometry(2,2),shaders=new T.Scene();
  const fullscreenCamera=new T.OrthographicCamera(-1,1,1,-1,0,1);
  // OutputPass configures these defines on its first render. Compile that
  // same variant now, without drawing the full beauty scene during loading.
  output.material.defines={SRGB_TRANSFER:'',ACES_FILMIC_TONE_MAPPING:''};
  for(const material of [contact.gtaoMaterial,contact.pdMaterial,motionContact.gtaoMaterial,motionContact.pdMaterial,cachedContact.material,output.material])shaders.add(new T.Mesh(geometry,material));
  // compileAsync traverses each mesh's material rather than scene.overrideMaterial.
  // Temporarily expose the normal-pass material, restoring it before yielding.
  const materials=new Map<T.Mesh,T.Material|T.Material[]>();
  const previousTarget=renderer.getRenderTarget();
  let compilation:Promise<unknown>;
  try {
   try {
    occluders.traverse(object=>{if(object instanceof T.Mesh){materials.set(object,object.material);object.material=contact.normalMaterial;}});
    for(const target of [composer.readBuffer,composer.writeBuffer,contact.normalRenderTarget,contact.gtaoRenderTarget,contact.pdRenderTarget,motionContact.normalRenderTarget,motionContact.gtaoRenderTarget,motionContact.pdRenderTarget])renderer.initRenderTarget(target);
    renderer.setRenderTarget(composer.readBuffer);
    // The beauty pass writes linear HDR into this target, so it needs a
    // different material variant from the main canvas's direct ACES render.
    compilation=Promise.all([renderer.compileAsync(scene,camera),renderer.compileAsync(occluders,camera),renderer.compileAsync(shaders,fullscreenCamera)]);
   } finally {
    materials.forEach((material,mesh)=>{mesh.material=material;});renderer.setRenderTarget(previousTarget);
   }
   await compilation;
   if(!disposed) {
    const target=renderer.getRenderTarget();
    try {cachedContact.warm(renderer,composer.writeBuffer,composer.readBuffer);}
    finally {renderer.setRenderTarget(target);}
   }
  } finally {geometry.dispose();shaders.clear();}
 }
 return {
  prepare() {
   if(disposed)return Promise.resolve();
   if(!preparationPending){preparationPending=true;preparing=prepare().finally(()=>{preparationPending=false;if(disposed)release();});}
   return preparing;
  },
  render(delta=0) { if(disposed)return;pipeline??=build();pipeline.composer.render(delta); },
  resetForViewChange() { if(!disposed)pipeline?.cachedContact.resetForViewChange(); },
  resize() { if(!pipeline)return;const size=renderer.getSize(new T.Vector2());pipeline.composer.setPixelRatio(renderer.getPixelRatio());pipeline.composer.setSize(size.x,size.y); },
  dispose() {
   if(disposed)return;disposed=true;
   if(!preparationPending)release();
  },
 };
}
