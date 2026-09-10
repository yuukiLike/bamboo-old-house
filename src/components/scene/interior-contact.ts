import * as T from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

class HalfResolutionGTAO extends GTAOPass {
 override setSize(width:number,height:number) {
  super.setSize(Math.max(1,Math.round(width*.5)),Math.max(1,Math.round(height*.5)));
 }
}

/** Local contact shade for the rooms. Only the static house enters the normal
 * pass; the full bamboo scene still supplies the beauty image outside doors. */
export function createInteriorContact(renderer:T.WebGLRenderer,scene:T.Scene,camera:T.PerspectiveCamera,house:T.Group,mobile:boolean) {
 let pipeline:ReturnType<typeof build>|undefined;
 function build() {
  const occluders=new T.Scene();house.updateWorldMatrix(true,true);
  const copy=house.clone(true);copy.matrixAutoUpdate=false;copy.matrix.copy(house.matrixWorld);
  copy.traverse(object=>{
   if(!(object instanceof T.Mesh))return;
   const materials=Array.isArray(object.material)?object.material:[object.material];
   if(materials.some(material=>/glazing|old_clear_glass|lamp_glass|frosted_bare_bulb/i.test(material.name)))object.visible=false;
  });
  occluders.add(copy);occluders.updateMatrixWorld(true);
  const size=renderer.getSize(new T.Vector2()),ratio=renderer.getPixelRatio();
  const target=new T.WebGLRenderTarget(size.x*ratio,size.y*ratio,{type:T.HalfFloatType,samples:mobile?2:4});
  const composer=new EffectComposer(renderer,target);
  const beauty=new RenderPass(scene,camera);
  const contact=new HalfResolutionGTAO(occluders,camera,16,16);
  contact.output=GTAOPass.OUTPUT.Default;contact.blendIntensity=.38;
  contact.updateGtaoMaterial({radius:.25,thickness:.18,distanceExponent:1,distanceFallOff:1,scale:1,samples:mobile?12:16,screenSpaceRadius:false});
  contact.updatePdMaterial({radius:3,samples:mobile?8:16,rings:2,radiusExponent:2,lumaPhi:10,depthPhi:.18,normalPhi:3});
  const output=new OutputPass();composer.addPass(beauty);composer.addPass(contact);composer.addPass(output);
  // A supplied render target initially gives EffectComposer physical sizes;
  // explicitly establish logical viewport dimensions for correct DPR handling.
  composer.setSize(size.x,size.y);
  return {composer,contact,output,occluders};
 }
 return {
  render(delta=0) { pipeline??=build();pipeline.composer.render(delta); },
  resize() { if(!pipeline)return;const size=renderer.getSize(new T.Vector2());pipeline.composer.setPixelRatio(renderer.getPixelRatio());pipeline.composer.setSize(size.x,size.y); },
  dispose() {
   if(!pipeline)return;
   pipeline.contact.gtaoMaterial.dispose();pipeline.contact.blendMaterial.dispose();pipeline.contact.dispose();
   pipeline.output.dispose();pipeline.composer.dispose();pipeline.occluders.clear();pipeline=undefined;
  },
 };
}
