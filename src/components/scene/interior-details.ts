import * as T from 'three';

// The export batches by material, not by room. Keep all Architecture meshes,
// the kitchen chimney, and mixed indoor/outdoor batches (timber and iron).
const detailMaterials = new Set([
 'Interior_faded_grey_blue_workshirt',
 'Interior_frosted_lamp_glass',
 'Interior_handwoven_aged_bamboo',
 'Interior_old_muted_madder_quilt',
 'Interior_undyed_washed_cotton',
 'Interior_used_brown_stoneware',
 'Kitchen_frosted_bare_bulb',
 'Kitchen_old_lime_and_soot_hearth',
 'Kitchen_still_water_in_washing_basin',
 'Kitchen_used_black_iron_wok',
 'Owner_aged_unbleached_cotton_batting_cover',
 'Owner_dull_worn_furniture_end_grain',
 'Owner_faded_small_check_old_blanket',
 'Owner_individual_unpolished_white_rice_grain',
 'Owner_natural_rice_bulk_fine_grains',
 'Owner_old_brown_earthenware_rice_crock',
 'Owner_old_brown_rice_wine_storage_jar',
 'Owner_old_dark_amber_rice_crock',
 'Owner_old_grey_brown_wool_blanket',
 'Owner_old_muted_red_cotton_quilt',
 'Owner_repeatedly_washed_indigo_quilt',
 'Owner_rubbed_old_furniture_board_edges',
 'Owner_used_warm_grey_brown_furniture_wood',
 'Owner_worn_earthenware_crock_inner_wall',
 'Window_memory_crt_closed_dark_screen',
 'Window_memory_crt_dull_controls',
 'Window_memory_crt_recess_and_vents',
 'Window_memory_crt_worn_charcoal_case',
 'Window_memory_old_power_cord',
]);

/** Index once. Visibility also removes these meshes from Three's shadow
 * traversal, while keeping geometry and textures reusable without a reload. */
export function createInteriorDetails(house:T.Object3D) {
 const details:{mesh:T.Mesh;visible:boolean}[]=[];
 house.traverse(object=>{
  if(object instanceof T.Mesh&&object.name.startsWith('Props__')&&detailMaterials.has(object.name.slice('Props__'.length))) {
   details.push({mesh:object,visible:object.visible});
  }
 });
 let hidden:boolean|undefined;
 return {
  setHidden(value:boolean) {
   if(hidden===value)return;
   hidden=value;
   for(const {mesh,visible} of details)mesh.visible=value?false:visible;
  },
 };
}
