export interface WeatherSettings { wind: number; rain: number; autumn?: number; }
export interface WeatherUniforms {
 time: {value:number};
 night: {value:number};
 wind: {value:number};
 rain: {value:number};
 wetness: {value:number};
 autumn: {value:number};
}
export const WEATHER_PRESETS = {
 breeze: {label:'晴风',wind:.28,rain:0},
 autumn: {label:'大风',wind:.9,rain:0,autumn:1},
 drizzle: {label:'细雨',wind:.34,rain:.42},
 storm: {label:'暴雨',wind:.86,rain:1},
} as const;
export const DEFAULT_WEATHER: WeatherSettings = {wind:WEATHER_PRESETS.breeze.wind,rain:0};

/** Atmosphere responds quickly, while soil absorbs water and dries gradually. */
export function createWeatherState(time:{value:number},night:{value:number}) {
 const uniforms:WeatherUniforms={time,night,wind:{value:DEFAULT_WEATHER.wind},rain:{value:0},wetness:{value:0},autumn:{value:0}};
 let settings:WeatherSettings={...DEFAULT_WEATHER};
 return {
  uniforms,
  set(value:WeatherSettings) {
   if(!Number.isFinite(value.wind)||!Number.isFinite(value.rain)||!Number.isFinite(value.autumn??0))return;
   settings={wind:Math.max(0,Math.min(1,value.wind)),rain:Math.max(0,Math.min(1,value.rain)),autumn:Math.max(0,Math.min(1,value.autumn??0))};
  },
  update(delta:number,reduced=false) {
   const duration=Math.max(0,Math.min(delta,.10));
   const approach=(current:number,target:number,rate:number)=>{
    const next=target+(current-target)*Math.exp(-duration*rate);
    return Math.abs(next-target)<.0005?target:next;
   };
   uniforms.wind.value=reduced?settings.wind:approach(uniforms.wind.value,settings.wind,1.8);
   uniforms.rain.value=reduced?settings.rain:approach(uniforms.rain.value,settings.rain,1.65);
   uniforms.autumn.value=reduced?(settings.autumn??0):approach(uniforms.autumn.value,settings.autumn??0,1.15);
   const saturation=settings.rain>0?Math.min(1,.20+settings.rain*.88):0;
   // Reduced-motion users can still inspect the material response immediately.
   uniforms.wetness.value=reduced?saturation:approach(uniforms.wetness.value,saturation,settings.rain>0?.095:.012);
  },
 };
}

/** Mud increases camera travel resistance only on earth, never the paved yard. */
export function mudResistance(x:number,z:number,wetness:number,pavedPathClearance:number) {
 const onCourtyard=x>-13&&x<10.5&&z>-5&&z<9;
 if(onCourtyard||pavedPathClearance<.12)return 0;
 return Math.max(0,Math.min(1,wetness))*.68;
}
