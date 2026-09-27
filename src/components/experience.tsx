'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpDown, Footprints, House, Compass, RotateCcw, Sun, Moon, Scan, X, DoorOpen, Sunrise, Sunset, Volume2, VolumeX, SlidersHorizontal, Wind, CloudRain, Droplets, Monitor, Maximize, LoaderCircle } from 'lucide-react';
import { Tabs } from '@base-ui/react/tabs';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectGroup, SelectLabel } from '@/components/ui/select';
import { createSoundscape } from './scene/soundscape';
import { createSceneTransition } from './scene-transition';
import { useImmersiveView } from './use-immersive-view';
import { WALK_CHAPTERS as chapters, WALK_SCROLL_CYCLES, walkScrollPosition, walkScrollTop, walkChapter } from './walk-navigation';
import { beginPhase, phaseStatus, type FinishPhase } from '@/lib/performance';
import { usePerformancePanel } from '../../tools/scene-perf/react/use-performance-panel';
import { bambooPerformanceAdapter } from '../performance/bamboo-adapter';
import { DEFAULT_WEATHER, WEATHER_PRESETS, type WeatherSettings } from './scene/weather-state';
import { DEFAULT_RENDER_SETTINGS, FULL_RENDER_SETTINGS, PERFORMANCE_RENDER_SETTINGS, defaultRenderSettings, MOBILE_SCENE_QUERY, type RenderSettings } from './scene/render-settings';
import type { SceneHandle } from './scene/scene';
import { ROOM_VIEWS, OUTDOOR_VIEWS, PLACE_VIEWS, type PlaceId, type TimeOfDay, type ViewMode } from './scene/config';

export default function Experience() {
 const performancePanel = usePerformancePanel(bambooPerformanceAdapter);
 const {active:immersive,enter:enterImmersive,exit:exitImmersive}=useImmersiveView();
 const mount = useRef<HTMLDivElement>(null);
 const transitionVeil = useRef<HTMLDivElement>(null);
 const engine = useRef<SceneHandle | null>(null);
 const sceneTransition = useRef<ReturnType<typeof createSceneTransition> | null>(null);
 const requestedPlace = useRef<{view:ViewMode;place:PlaceId;panorama:boolean}>({view:'walk',place:'courtyard',panorama:false});
 const pendingViewTiming = useRef<FinishPhase | undefined>(undefined);
 const committedPlace = useRef({view:'walk' as ViewMode,place:'courtyard' as PlaceId});
 const pendingNavigation = useRef<{revision:number;run:()=>void}|undefined>(undefined);
 const navigationCounter = useRef(0);
 const [navigationRevision,setNavigationRevision] = useState(0);
 const [chapter, setChapter] = useState(0);
 const walkPosition = useRef(0);
 const walkStarted = useRef(false);
 const pendingSceneFrame = useRef<(()=>void)|undefined>(undefined);
 const [sceneBusy,setSceneBusy] = useState(false);
 const progressLabel = useRef<HTMLDivElement>(null);
 const progressBar = useRef<HTMLElement>(null);
 const [reduced, setReduced] = useState(false);
 const [failureMessage,setFailureMessage] = useState('');
 const [entryLabel,setEntryLabel] = useState('正在走进竹林');
 const [ready,setReady] = useState(false);
 const [error,setError] = useState(false);
 const [staticMode,setStaticMode] = useState(false);
 const [attempt,setAttempt] = useState(0);
 const [view,setView] = useState<ViewMode>('walk');
 const [place,setPlace] = useState<PlaceId>('courtyard');
 const [selectedDestination,setSelectedDestination] = useState({view:'walk' as ViewMode,place:'courtyard' as PlaceId});
 const inside=Object.hasOwn(ROOM_VIEWS,place);
 const [timeOfDay,setTimeOfDay] = useState<TimeOfDay>('dusk');
 const [panorama,setPanorama] = useState(false);
 const bearingLabel = useRef<HTMLSpanElement>(null);
 const soundscape = useRef<ReturnType<typeof createSoundscape> | null>(null);
 const [soundEnabled,setSoundEnabled] = useState(false);
 const [soundBusy,setSoundBusy] = useState(false);
 const [soundError,setSoundError] = useState(false);
 const [settingsPanel,setSettingsPanel] = useState<'weather' | 'preferences' | null>(null);
 const [renderSettings,setRenderSettings] = useState<RenderSettings>({...DEFAULT_RENDER_SETTINGS});
 const matchesProfile=(profile:Readonly<RenderSettings>)=>Object.entries(profile).every(([key,value])=>key==='freeMode'||renderSettings[key as keyof RenderSettings]===value);
 const renderProfile=matchesProfile(PERFORMANCE_RENDER_SETTINGS)?'performance':matchesProfile(DEFAULT_RENDER_SETTINGS)?'balanced':matchesProfile(FULL_RENDER_SETTINGS)?'full':null;
 const selectedPlace=selectedDestination.place;
 const [weather,setWeather] = useState<WeatherSettings>({...DEFAULT_WEATHER});
 const [weatherBusy,setWeatherBusy] = useState(false);
 const [weatherError,setWeatherError] = useState(false);
 const weatherRequest = useRef(0);
 const roofRunoff = useRef(0);
 const weatherButton = useRef<HTMLButtonElement>(null);
 const weatherPanel = useRef<HTMLDialogElement>(null);
 const settingsButton = useRef<HTMLButtonElement>(null);
 const preferencesPanel = useRef<HTMLDialogElement>(null);
 const [volume,setVolume] = useState(.55);
 const soundRequest = useRef(0);
 const panoramaButton = useRef<HTMLButtonElement>(null);
 const finishSceneFeedback=useCallback(()=>{pendingSceneFrame.current?.();pendingSceneFrame.current=undefined;setSceneBusy(false);},[]);
 useEffect(()=>{
   const transition=createSceneTransition(()=>engine.current?.transition,{
     element:()=>transitionVeil.current,
     waitForFrame:complete=>engine.current?engine.current.afterNextFrame(complete):(complete(),()=>{}),
   });sceneTransition.current=transition;
   const visibility=()=>{if(document.hidden){transition.finish();finishSceneFeedback();}};
   const resize=()=>transition.finish();
   const media=matchMedia('(prefers-reduced-motion: reduce)');
   const change=()=>{if(media.matches)transition.finish();};
   document.addEventListener('visibilitychange',visibility);window.addEventListener('resize',resize);media.addEventListener('change',change);
   return()=>{pendingSceneFrame.current?.();pendingViewTiming.current?.('cancelled');transition.dispose();sceneTransition.current=null;pendingNavigation.current=undefined;document.removeEventListener('visibilitychange',visibility);window.removeEventListener('resize',resize);media.removeEventListener('change',change);};
 },[finishSceneFeedback]);
 useEffect(()=>{if(!ready||staticMode)sceneTransition.current?.finish();},[ready,staticMode]);
 useEffect(() => {
   const media=matchMedia('(prefers-reduced-motion: reduce)');
   const change=()=>setReduced(media.matches); change(); media.addEventListener('change',change);
   return ()=>media.removeEventListener('change',change);
 },[]);
 useEffect(() => {
   if(view!=='walk'||panorama)return;
   let frame=0,previousChapter=-1;
   let range=Math.max(1,document.documentElement.scrollHeight-innerHeight);
   if(!walkStarted.current){
     const index=chapters.findIndex(item=>`#${item.id}`===location.hash);
     walkPosition.current=Math.max(0,index)/chapters.length;walkStarted.current=true;
   }
   const restore=()=>window.scrollTo({top:staticMode?walkPosition.current*chapters.length/(chapters.length-1)*range:walkScrollTop(walkPosition.current,range),behavior:'instant'});
   restore();
   const update=()=>{
     frame=0;
     const nextRange=Math.max(1,document.documentElement.scrollHeight-innerHeight);
     if(nextRange!==range){range=nextRange;restore();}
     const position=walkScrollPosition(window.scrollY,range);
     const p=staticMode?Math.min(1,Math.max(0,window.scrollY/range)):position.progress;
     if(!staticMode&&position.scrollTop!==window.scrollY)window.scrollTo({top:position.scrollTop,behavior:'instant'});
     walkPosition.current=staticMode?p*(chapters.length-1)/chapters.length:p;
     const nextChapter=staticMode?Math.min(chapters.length-1,Math.round(p*(chapters.length-1))):walkChapter(p);
     // Continuous input only updates the small HUD, not the whole control tree.
     if(nextChapter!==previousChapter){previousChapter=nextChapter;setChapter(nextChapter);}
     progressLabel.current?.setAttribute('aria-label',`探索进度 ${Math.round(p*100)}%`);
     if(progressBar.current)progressBar.current.style.transform=`scaleX(${Math.max(.02,p)})`;
   };
   const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
   update();window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule);
   return()=>{cancelAnimationFrame(frame);window.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule);};
 },[view,panorama,staticMode]);
 useEffect(()=>{ let disposed=false,failed=false;const controller=new AbortController();
   const finishStartup=beginPhase('startup.experience',{attempt});
   let finishStage:FinishPhase|undefined;
   let stageTimer:ReturnType<typeof setTimeout>|undefined;
   let pendingStage='',lastStageAt=performance.now();
   // Coalesce short stages so the copy stays readable without delaying readiness.
   const showStage=(label:string)=>{
     if(disposed||failed)return;
     pendingStage=label;
     if(stageTimer!==undefined)return;
     stageTimer=setTimeout(()=>{
       stageTimer=undefined;
       if(disposed||failed)return;
       lastStageAt=performance.now();setEntryLabel(pendingStage);
     },Math.max(0,1600-(performance.now()-lastStageAt)));
   };
   const resetRoof=()=>{roofRunoff.current=0;soundscape.current?.setRoofRunoff(0);};
   resetRoof();
   const start=async()=>{ try {
     finishStage=beginPhase('startup.scene-import',{attempt});
     const { createScene } = await import('./scene/scene');
     finishStage(disposed?'cancelled':'success');
     if(disposed || !mount.current){finishStartup('cancelled');return;}
     if(attempt===0)setRenderSettings(defaultRenderSettings(matchMedia(MOBILE_SCENE_QUERY).matches));
     finishStage=beginPhase('startup.create-scene',{attempt});
     const scene=await createScene(mount.current,{onStage:showStage,onPanorama:(value)=>{if(!disposed){requestedPlace.current={...requestedPlace.current,panorama:value};setPanorama(value);if(!value)panoramaButton.current?.focus({preventScroll:true});}},onGust:(strength)=>{if(!disposed&&!failed)soundscape.current?.setGust(strength);},onRunoff:(flow)=>{if(disposed||failed)return;roofRunoff.current=flow;soundscape.current?.setRoofRunoff(flow);},onBearing:(value)=>{if(!disposed&&bearingLabel.current){const label=`${String(value).padStart(3,'0')}°`;if(bearingLabel.current.textContent!==label)bearingLabel.current.textContent=label;}},onFailure:()=>{if(!disposed){failed=true;clearTimeout(stageTimer);exitImmersive();finishStage?.('error',{reason:'webgl-context-lost'});finishStartup('error',{reason:'webgl-context-lost'});engine.current=null;finishSceneFeedback();resetRoof();soundRequest.current++;weatherRequest.current++;void soundscape.current?.setEnabled(false);setSoundEnabled(false);setSoundBusy(false);setWeatherBusy(false);setSettingsPanel(null);setReady(false);setError(true);setPanorama(false);setStaticMode(true);setFailureMessage('实时画面已暂停，可重新载入。');}}},controller.signal);
     finishStage(disposed?'cancelled':failed?'error':'success');
     if(disposed||failed){finishStartup(disposed?'cancelled':'error');scene.dispose();return;}
     engine.current=scene;setReady(true);
     finishStartup('success',{boundary:'ready-state-requested'});
   } catch(e){ finishStage?.(disposed?'cancelled':phaseStatus(e));finishStartup(disposed?'cancelled':phaseStatus(e));if(!disposed&&!failed){console.error('Scene failed:',e);finishSceneFeedback();setError(true);setStaticMode(true);setFailureMessage(e instanceof Error && e.message==='WEBGL_UNAVAILABLE'?'此设备使用静态观看模式。':'竹林暂时没有载入，仍可继续阅读。');} }
   finally{clearTimeout(stageTimer);} };
   void start();
   return ()=>{disposed=true;clearTimeout(stageTimer);finishStage?.('cancelled');finishStartup('cancelled');resetRoof();controller.abort();engine.current?.dispose();engine.current=null;};
 },[attempt,finishSceneFeedback,exitImmersive]);
 useEffect(()=>{if(ready)beginPhase('startup.controls-ready',{attempt,boundary:'react-committed'})();},[ready,attempt]);
 useEffect(()=>{engine.current?.setPaused(reduced);},[reduced,ready]);
 useEffect(()=>{
   // Capture the current view before disabling free mode moves back outside.
   if(!renderSettings.freeMode&&committedPlace.current.view==='free')return;
   engine.current?.setRenderSettings(renderSettings);
 },[renderSettings,ready,place,view]);
 useEffect(()=>{engine.current?.setView(view);},[view,ready]);
 useEffect(()=>{engine.current?.setPlace(place);},[place,ready]);
 useEffect(()=>{engine.current?.setTimeOfDay(timeOfDay);},[timeOfDay,ready]);
 useEffect(()=>{engine.current?.setWeather(weather);},[weather,ready]);
 useEffect(()=>{engine.current?.setPanorama(panorama);},[panorama,ready]);
 useEffect(()=>()=>{soundRequest.current++;weatherRequest.current++;soundscape.current?.dispose();soundscape.current=null;},[]);
 useEffect(()=>{soundscape.current?.setTimeOfDay(timeOfDay);},[timeOfDay]);
 useEffect(()=>{soundscape.current?.setSheltered(inside);soundscape.current?.setView(view);},[view,inside]);
 useEffect(()=>{soundscape.current?.setVolume(volume);},[volume]);
 useEffect(()=>{
   if(!settingsPanel)return;
   const panel=(settingsPanel==='weather'?weatherPanel:preferencesPanel).current;
   const trigger=(settingsPanel==='weather'?weatherButton:settingsButton).current;
   panel?.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true});
   const outside=(event:PointerEvent)=>{
     if(event.target instanceof Node&&!panel?.contains(event.target)&&!trigger?.contains(event.target))setSettingsPanel(null);
   };
   const escape=(event:KeyboardEvent)=>{
     if(event.key!=='Escape')return;
     event.preventDefault();event.stopPropagation();setSettingsPanel(null);trigger?.focus({preventScroll:true});
   };
   document.addEventListener('pointerdown',outside);
   document.addEventListener('keydown',escape,true);
   return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape,true);};
 },[settingsPanel]);
 const chooseWeather=(next:WeatherSettings)=>{
   setWeather(next);engine.current?.setWeather(next);
   const request=++weatherRequest.current;
   setWeatherError(false);
   const sound=soundscape.current;
   if(!sound){setWeatherBusy(false);return;}
   setWeatherBusy(soundEnabled&&next.rain>0);
   void sound.setWeather(next).catch(error=>{
     if(request===weatherRequest.current){console.error('Rain ambience failed:',error);setWeatherError(true);}
   }).finally(()=>{if(request===weatherRequest.current)setWeatherBusy(false);});
 };
 const playSound=async(value:boolean,nextView=view,nextTime=timeOfDay,nextWeather=weather)=>{
   const request=++soundRequest.current;
   setSoundError(false);setSoundBusy(true);
   if(!value){weatherRequest.current++;setWeatherBusy(false);setWeatherError(false);setSettingsPanel(panel=>panel==='weather'?null:panel);}
   try {
     const sound=soundscape.current??(soundscape.current=createSoundscape());
     sound.setTimeOfDay(nextTime);sound.setSheltered(inside);sound.setView(nextView);sound.setVolume(volume);sound.setRoofRunoff(roofRunoff.current);
     // Configure weather first, then resume synchronously in the same user gesture.
     const weatherLoading=value?sound.setWeather(nextWeather):Promise.resolve();
     const playback=sound.setEnabled(value);
     await Promise.all([weatherLoading,playback]);
     if(request===soundRequest.current){setSoundEnabled(value);if(value)setWeatherError(false);}
   } catch(error){if(request===soundRequest.current){console.error('Ambience failed:',error);setSoundError(true);setSoundEnabled(false);}}
   finally{if(request===soundRequest.current)setSoundBusy(false);}
 };
 const toggleSound=()=>{void playSound(soundBusy?false:!soundEnabled);};
 const chooseTime=(next:TimeOfDay)=>{if(requestedPlace.current.view==='moon'&&next!=='night')chooseView('walk',undefined,{timeOfDay:next,weather});else setTimeOfDay(next);};
 const watchMoon=()=>{setSettingsPanel(null);chooseView('moon',undefined,{timeOfDay:'night',weather:{...DEFAULT_WEATHER}});};
 const listenInGrove=()=>{
   const nextWeather={...WEATHER_PRESETS.autumn};
   setSettingsPanel(null);chooseView('breeze',undefined,{timeOfDay:'day',weather:nextWeather});
   // This dedicated listening action is itself the explicit playback gesture.
   if(!soundEnabled)void playSound(true,'breeze','day',nextWeather);
 };
 const listenByWell=()=>{
   const nextWeather=weather.rain>0?weather:{...WEATHER_PRESETS.drizzle};
   setSettingsPanel(null);chooseView('well-rain',undefined,{timeOfDay:'day',weather:nextWeather});
   if(!soundEnabled)void playSound(true,'well-rain','day',nextWeather);
 };
 useEffect(()=>{
   const previous=document.body.style.overflow;
   if(view!=='walk'||panorama)document.body.style.overflow='hidden';
   return()=>{document.body.style.overflow=previous;};
 },[view,panorama]);
 useEffect(()=>{
   // This runs after React commits the destination and the overflow effect
   // above restores walking. A frame callback alone can precede that commit.
   const navigate=pendingNavigation.current;
   if(!navigate||navigate.revision!==navigationRevision)return;
   pendingNavigation.current=undefined;navigate.run();
 },[navigationRevision]);
 const commitPlace=()=>{
   const next=requestedPlace.current;
   committedPlace.current={view:next.view,place:next.place};
   soundscape.current?.setSheltered(Object.hasOwn(ROOM_VIEWS,next.place));soundscape.current?.setView(next.view);
   setView(next.view);setPlace(next.place);setPanorama(next.panorama);
   engine.current?.setView(next.view);engine.current?.setPlace(next.place);engine.current?.setPanorama(next.panorama);
 };
 const changePlace=(next:typeof requestedPlace.current,afterCommit?:()=>void,environment?:{timeOfDay:TimeOfDay;weather:WeatherSettings})=>{
   pendingSceneFrame.current?.();pendingSceneFrame.current=undefined;
   pendingViewTiming.current?.('superseded');
   const finish=beginPhase('view.request-to-commit',{view:next.view,place:next.place});pendingViewTiming.current=finish;
   const previous=requestedPlace.current;requestedPlace.current=next;
   setSelectedDestination({view:next.view,place:next.place});
   pendingNavigation.current=undefined;
   const apply=()=>{
     try{
       if(environment){setTimeOfDay(environment.timeOfDay);engine.current?.setTimeOfDay(environment.timeOfDay);soundscape.current?.setTimeOfDay(environment.timeOfDay);chooseWeather(environment.weather);}
       commitPlace();
       if(afterCommit){const revision=++navigationCounter.current;pendingNavigation.current={revision,run:afterCommit};setNavigationRevision(revision);}
       if(ready&&!staticMode&&!document.hidden&&engine.current)pendingSceneFrame.current=engine.current.afterNextFrame(finishSceneFeedback);
       else finishSceneFeedback();
       finish('success',{boundary:'state-and-scene-committed'});
     }catch(error){finishSceneFeedback();finish(phaseStatus(error));throw error;}
   };
   if(!environment&&previous.view===next.view&&previous.place===next.place&&committedPlace.current.view===next.view&&committedPlace.current.place===next.place&&!sceneTransition.current?.covering) {finishSceneFeedback();apply();return;}
   setSceneBusy(ready&&!staticMode&&!document.hidden);
   const animate=ready&&!staticMode&&!document.hidden&&!matchMedia('(prefers-reduced-motion: reduce)').matches;
   if(sceneTransition.current)sceneTransition.current.request(apply,animate);else apply();
 };
 const chooseView=(next:ViewMode,afterCommit?:()=>void,environment?:{timeOfDay:TimeOfDay;weather:WeatherSettings})=>{
   if(next==='free'&&!renderSettings.freeMode)return;
   changePlace({view:next,place:next==='yard'?'yard-edge':next==='free'?requestedPlace.current.place:'courtyard',panorama:next==='free'},afterCommit,environment);
 };
 const placeArea=!inside?'屋外':place==='hall'||place==='kitchen'?'楼下':'楼上';
 const choosePlace=(next:PlaceId)=>{if(renderSettings.freeMode)changePlace({view:'free',place:next,panorama:true});};
 const chooseRenderSettings=(next:RenderSettings)=>{
   setRenderSettings(next);
   if(!next.freeMode&&(requestedPlace.current.view==='free'||committedPlace.current.view==='free')){
     changePlace({view:'yard',place:'yard-edge',panorama:false});
   }
 };
 const choosePanorama=()=>{const value=!requestedPlace.current.panorama;requestedPlace.current={...requestedPlace.current,panorama:value};setPanorama(value);engine.current?.setPanorama(value);};
 const returnHome=useCallback(()=>{engine.current?.reset();const range=document.documentElement.scrollHeight-innerHeight;window.scrollTo({top:staticMode?0:walkScrollTop(0,range),behavior:reduced?'instant':'smooth'});},[reduced,staticMode]);
 const navigate=(index:number)=>{const range=document.documentElement.scrollHeight-innerHeight;window.scrollTo({top:staticMode?range*index/(chapters.length-1):walkScrollTop(index/chapters.length,range),behavior:reduced?'instant':'smooth'});};
 const weatherLabel=weather.rain>.7?'暴雨':weather.rain>0?'细雨':(weather.autumn??0)>.5?'大风':weather.wind===0?'无风':'晴风';
 const listeningCopy=weather.rain>.7?'雨落屋檐 · 一场夏日大雨':weather.rain>0?(view==='well-rain'?'井边细雨 · 檐下滴答':'细雨轻落 · 叶间滴答'):(weather.autumn??0)>.5?'风起竹海 · 带一点秋凉':view==='breeze'?'风从身旁经过 · 叶片轻轻响':{dawn:'晨鸟初醒 · 叶间微风',day:'风过竹叶 · 远处鸟鸣',dusk:'晚风渐柔 · 虫声初起',night:'月下虫鸣 · 风过竹梢'}[timeOfDay];
 const entering=!ready&&!error;
 const activityBusy=ready&&(sceneBusy||soundBusy||weatherBusy);
 const pendingView=sceneBusy?selectedDestination.view:null;
 const soundLoading=soundBusy||weatherBusy;
 return <div className={`experience is-${view} ${panorama?'is-panorama':''} ${staticMode?'is-static':''} ${immersive?'is-immersive':''} ${soundEnabled?'is-listening':''} ${activityBusy?'is-busy':''} ${settingsPanel?'settings-open':''}`} data-entering={entering} data-time={timeOfDay} data-resolution={renderSettings.resolution} data-shadows={renderSettings.shadows} data-frame-rate={renderSettings.frameRate} data-house-detail={renderSettings.houseDetail} data-free-mode={renderSettings.freeMode}>
  {performancePanel}
  <a className="skip-link" href="#view-controls" onClick={(e)=>{e.preventDefault();document.querySelector<HTMLButtonElement>('#view-controls button')?.focus({preventScroll:true});}}>跳到观看方式</a>
  <div className="scene-shell" aria-hidden={!panorama} aria-busy={entering||sceneBusy}>
   <picture><source media="(max-width:700px)" srcSet="/scene-poster-mobile.webp"/><img className="fallback-view" src="/scene-poster.webp" alt="" /></picture>
   <div ref={mount} className={`scene-mount ${ready?'ready':''}`} />
   <div ref={transitionVeil} className="scene-loading-veil" />
  </div>
  <div className="scene-shade" />
  <output className="scene-entry" data-active={entering} data-failed={error} aria-live="polite" aria-atomic="true" aria-hidden={!entering} inert={!entering}>
   <span className="scene-entry-panel">
    <span className="scene-entry-logo" aria-hidden="true" />
    <span key={entryLabel} className="scene-entry-caption">{entryLabel}</span>
    <span className="scene-entry-track" aria-hidden="true"><span /></span>
   </span>
  </output>
  <header className="site-header">
   <a className="wordmark" href="#bamboo" onClick={(e)=>{e.preventDefault();chooseView('walk',returnHome);}} aria-label="竹林里的老屋，回到竹林"><span className="wordmark-icon" aria-hidden="true" /><span>竹林老屋</span></a>
   <div className="header-aside"><span className="memory-label">一处老屋 · 四时竹声</span>
   <ToggleGroup className="day-switch" value={[timeOfDay]} onValueChange={(values)=>{if(values[0]==='dawn'||values[0]==='day'||values[0]==='dusk'||values[0]==='night')chooseTime(values[0]);}} aria-label="选择清晨、白天、傍晚或夜晚" disabled={!ready||staticMode}>
    <ToggleGroupItem value="dawn" aria-label="清晨"><Sunrise size={15} strokeWidth={1.5}/><span>清晨</span></ToggleGroupItem>
    <ToggleGroupItem value="day" aria-label="白天"><Sun size={15} strokeWidth={1.5}/><span>白天</span></ToggleGroupItem>
    <ToggleGroupItem value="dusk" aria-label="傍晚" title="金色晚光"><Sunset size={15} strokeWidth={1.5}/><span>傍晚</span></ToggleGroupItem>
    <ToggleGroupItem value="night" aria-label="夜晚"><Moon size={15} strokeWidth={1.5}/><span>夜晚</span></ToggleGroupItem>
   </ToggleGroup>
   <div className="weather-controls">
    <Button ref={weatherButton} className="control-button weather-toggle" onClick={()=>setSettingsPanel(settingsPanel==='weather'?null:'weather')} aria-label="调整风雨" aria-expanded={settingsPanel==='weather'} aria-controls="weather-settings" disabled={!ready||staticMode}>{weather.rain>0?<CloudRain size={16}/>:<Wind size={16}/>}<span>{weatherLabel}</span></Button>
    {settingsPanel==='weather'&&<dialog open ref={weatherPanel} id="weather-settings" className="settings-panel weather-panel" aria-labelledby="weather-title" onKeyDown={event=>event.stopPropagation()}>
     <div className="settings-heading"><h2 id="weather-title">风雨</h2><Button className="settings-close" variant="ghost" aria-label="收起天气设置" onClick={()=>{setSettingsPanel(null);weatherButton.current?.focus({preventScroll:true});}}><X size={15}/></Button></div>
     <p className="settings-description">{weather.rain>.7?'雨渐渐密了，去屋檐下坐一会儿。':weather.rain>0?'听雨落在竹叶上，一滴又一滴。':(weather.autumn??0)>.5?'一阵大风过，竹海里有了秋凉。':'给竹林一点风，留一片清凉。'}</p>
     <fieldset className="weather-presets" aria-label="选择天气">{Object.entries(WEATHER_PRESETS).map(([key,preset])=><Button key={key} variant="ghost" aria-pressed={Math.abs(weather.wind-preset.wind)<.005&&Math.abs(weather.rain-preset.rain)<.005&&Math.abs((weather.autumn??0)-('autumn' in preset?preset.autumn:0))<.005} onClick={()=>chooseWeather({...preset})}>{preset.rain===0?<Wind size={14}/>:<CloudRain size={14}/>}<span>{preset.label}</span></Button>)}</fieldset>
     <output className="weather-listening-note">{weatherError||soundError?<><span>{soundError?'声音暂未载入。':'雨声暂未载入。'}</span><Button variant="ghost" disabled={soundBusy} onClick={()=>soundError?toggleSound():chooseWeather(weather)}>{soundError?'重试声音':'重试雨声'}</Button></>:weatherBusy||soundBusy?'自然声正在靠近…':soundEnabled?'声音远近，可在音量里调整。':<><span>开启声音，听见风雨。</span><Button variant="ghost" disabled={soundBusy} onClick={toggleSound}>开启声音</Button></>}</output>
    </dialog>}
   </div>
   <div className="sound-controls">
    <Button className="control-button sound-toggle" onClick={toggleSound} aria-busy={soundLoading} aria-label={soundBusy?'取消载入自然声':soundEnabled?'关闭环境声音':soundError?'重试环境声音':'开启环境声音'} aria-pressed={soundEnabled} disabled={!ready||staticMode}>{soundLoading?<LoaderCircle className="loading-spinner" size={16}/>:soundEnabled?<Volume2 size={16}/>:<VolumeX size={16}/>}<span>{soundEnabled?'正在聆听':soundError?'重试声音':'聆听竹林'}</span></Button>
   </div>
   <div className="render-controls">
    <Button ref={settingsButton} className="control-button render-toggle header-icon" aria-label="画面与声音设置" title="画面与声音设置" aria-expanded={settingsPanel==='preferences'} aria-controls="experience-settings" disabled={!ready||staticMode} onClick={()=>setSettingsPanel(settingsPanel==='preferences'?null:'preferences')}><SlidersHorizontal size={17}/></Button>
    {settingsPanel==='preferences'&&<dialog open ref={preferencesPanel} id="experience-settings" className="settings-panel render-panel" aria-labelledby="settings-title" onKeyDown={event=>event.stopPropagation()}>
     <div className="settings-heading"><h2 id="settings-title">设置</h2>
      <Button className="settings-close" variant="ghost" aria-label="收起设置" title="收起设置" onClick={()=>{setSettingsPanel(null);settingsButton.current?.focus({preventScroll:true});}}><X size={16}/></Button>
     </div>
     <Tabs.Root defaultValue="render">
      <Tabs.List className="settings-tabs" aria-label="设置分类">
       <Tabs.Tab value="render"><Monitor size={15}/><span>画面</span></Tabs.Tab>
       <Tabs.Tab value="sound"><Volume2 size={15}/><span>声音</span></Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="render">
       <div className="settings-section-heading"><span>画面与性能</span><Button className="render-reset" variant="ghost" aria-label="恢复默认画面" title="恢复默认画面" onClick={()=>chooseRenderSettings({...defaultRenderSettings(matchMedia(MOBILE_SCENE_QUERY).matches),freeMode:renderSettings.freeMode})}><RotateCcw size={15}/></Button></div>
     <div className="render-row render-profile"><span id="render-profile-label">画面档位</span>
      <ToggleGroup className="render-segments" value={renderProfile?[renderProfile]:[]} aria-labelledby="render-profile-label" onValueChange={values=>{
       const profile=values[0]==='performance'?PERFORMANCE_RENDER_SETTINGS:values[0]==='balanced'?DEFAULT_RENDER_SETTINGS:values[0]==='full'?FULL_RENDER_SETTINGS:null;
       if(profile)chooseRenderSettings({...profile,freeMode:renderSettings.freeMode});
      }}>
       <ToggleGroupItem value="performance" aria-label="性能优先">性能</ToggleGroupItem>
       <ToggleGroupItem value="balanced">均衡</ToggleGroupItem>
       <ToggleGroupItem value="full">完整</ToggleGroupItem>
      </ToggleGroup>
     </div>
     <div className="render-row"><span id="render-resolution-label">清晰度</span>
      <ToggleGroup className="render-segments" value={[renderSettings.resolution]} aria-labelledby="render-resolution-label" onValueChange={values=>{const resolution=values[0];if(resolution==='reduced'||resolution==='balanced'||resolution==='full')setRenderSettings(value=>({...value,resolution}));}}>
       <ToggleGroupItem value="reduced" aria-label="稍柔和">柔和</ToggleGroupItem>
       <ToggleGroupItem value="balanced" aria-label="均衡清晰">均衡</ToggleGroupItem>
       <ToggleGroupItem value="full" aria-label="完整清晰">清晰</ToggleGroupItem>
      </ToggleGroup>
     </div>
     <div className="render-row"><span id="render-frame-label">帧率上限</span>
      <ToggleGroup className="render-segments" value={[renderSettings.frameRate]} aria-labelledby="render-frame-label" onValueChange={values=>{const frameRate=values[0];if(frameRate==='30'||frameRate==='60'||frameRate==='display')setRenderSettings(value=>({...value,frameRate}));}}>
       <ToggleGroupItem value="30" aria-label="省电 30 帧">30</ToggleGroupItem>
       <ToggleGroupItem value="60" aria-label="60 帧">60</ToggleGroupItem>
       <ToggleGroupItem value="display" aria-label="跟随屏幕">屏幕</ToggleGroupItem>
      </ToggleGroup>
     </div>
     <div className="render-row"><span id="render-shadow-label">实时阴影</span>
      <ToggleGroup className="render-segments" value={[renderSettings.shadows]} aria-labelledby="render-shadow-label" onValueChange={values=>{const shadows=values[0];if(shadows==='off'||shadows==='alternate'||shadows==='full')setRenderSettings(value=>({...value,shadows}));}}>
       <ToggleGroupItem value="off" aria-label="关闭实时阴影">关闭</ToggleGroupItem>
       <ToggleGroupItem value="alternate" aria-label="隔帧更新">隔帧</ToggleGroupItem>
       <ToggleGroupItem value="full" aria-label="每帧跟随">每帧</ToggleGroupItem>
      </ToggleGroup>
     </div>
     <div className="render-row"><span id="render-house-label">老屋远景</span>
      <ToggleGroup className="render-segments" value={[renderSettings.houseDetail]} aria-labelledby="render-house-label" onValueChange={values=>{const houseDetail=values[0];if(houseDetail==='lean'||houseDetail==='balanced'||houseDetail==='full')setRenderSettings(value=>({...value,houseDetail}));}}>
       <ToggleGroupItem value="lean" aria-label="精简老屋远景">精简</ToggleGroupItem>
       <ToggleGroupItem value="balanced" aria-label="均衡老屋远景">均衡</ToggleGroupItem>
       <ToggleGroupItem value="full" aria-label="原始老屋远景">原始</ToggleGroupItem>
      </ToggleGroup>
     </div>
     <label className="render-detail-toggle" htmlFor="enable-free-mode"><span>自由模式</span><input id="enable-free-mode" type="checkbox" role="switch" aria-checked={renderSettings.freeMode} checked={renderSettings.freeMode} onChange={event=>chooseRenderSettings({...renderSettings,freeMode:event.target.checked})}/></label>
      </Tabs.Panel>
      <Tabs.Panel value="sound" className="sound-settings-content">
       <label className="render-detail-toggle" htmlFor="enable-sound"><span>自然声</span><input id="enable-sound" type="checkbox" role="switch" aria-checked={soundEnabled} checked={soundEnabled} disabled={soundBusy} onChange={event=>{void playSound(event.target.checked);}}/></label>
       <p className="settings-description">{soundBusy?'自然声正在靠近…':listeningCopy}{view==='free'&&inside?' · 隔窗听见':''}</p>
       {soundError&&<output className="weather-listening-note"><span>声音暂未载入。</span><Button variant="ghost" onClick={toggleSound}>重试声音</Button></output>}
       <label htmlFor="ambience-volume">声音远近 <output>{Math.round(volume*100)}%</output></label>
       <input id="ambience-volume" type="range" min="0" max="100" value={Math.round(volume*100)} onChange={event=>setVolume(Number(event.target.value)/100)} aria-label="环境音量"/>
       <a href="/audio/credits.md" target="_blank" rel="noreferrer">自然录音与来源</a>
      </Tabs.Panel>
     </Tabs.Root>
    </dialog>}
   </div>
   <Button className="control-button header-icon fullscreen-toggle" aria-label="全屏欣赏，Esc 或双击画面退出" title="全屏欣赏" disabled={!ready||staticMode||sceneBusy} onClick={event=>{setSettingsPanel(null);enterImmersive(event.currentTarget);}}><Maximize size={17}/></Button>
   </div>
  </header>
  {soundError&&settingsPanel===null&&<output className="sound-message">声音暂未载入，点击声音按钮可重试。</output>}
  {weatherError&&!soundError&&settingsPanel===null&&<output className="sound-message weather-message"><span>雨声暂未载入。</span><Button variant="ghost" onClick={()=>chooseWeather(weather)}>重试雨声</Button></output>}
  {(staticMode || reduced) && <output className="mode-message">{staticMode?'静态观看 · 可沿路阅读': '已减少动态 · 仍可主动环顾和切换昼夜'}</output>}
  {error&&<div className="scene-error" role="alert"><p>{failureMessage}</p><Button className="control-button" onClick={()=>{setEntryLabel('正在走进竹林');setReady(false);setError(false);setStaticMode(false);setAttempt(attempt+1);}}><RotateCcw size={14}/>重新载入</Button></div>}
  {view==='porch'&&<main id="porch" className="porch-story" aria-label="从木廊望向竹林">
   <div className="porch-copy"><p className="chapter-kicker">木廊望竹 / {{dawn:'清晨初醒',day:'日光正好',dusk:'夕阳渐暖',night:'月色渐深'}[timeOfDay]}</p>
    <h1>{{dawn:<>天刚亮，<br/>风已过竹梢。</>,day:<>风过竹林，<br/>就是家乡。</>,dusk:<>晚光穿过竹叶，<br/>落在旧木上。</>,night:<>灯还亮着，<br/>竹林已入夜。</>}[timeOfDay]}</h1>
    <p>{{dawn:'山色还凉，远处的鸟先醒了。',day:'站在老屋里，听竹叶轻轻响。',dusk:'沿着照片里的光，慢慢想起那一年。',night:'楼下留着一盏灯，竹林里有点点萤光。'}[timeOfDay]}</p>
   </div>
  </main>}
  {view==='moon'&&<main className="porch-story moon-story" aria-label="竹林望月"><div className="porch-copy"><p className="chapter-kicker">竹林望月 / 今夜有风</p><h1>抬头是月亮，<br/>身旁是竹声。</h1><p>沿着小路停一停，让眼睛慢慢习惯月色。</p></div></main>}
  {view==='breeze'&&<main className="porch-story breeze-story" aria-label="林间的风"><div className="porch-copy"><p className="chapter-kicker">林间的风 / {weather.autumn?'秋意渐起':'清风徐来'}</p><h1>{weather.autumn?<>风过竹海，<br/>满身清凉。</>:<>站进竹影里，<br/>让风轻轻经过。</>}</h1><p>{weather.autumn?'竹梢弯下又回转，叶声一阵近、一阵远。':'听叶片轻响，让呼吸慢下来。'}</p></div></main>}
  {view==='well-rain'&&<main className="porch-story well-story" aria-label="井旁听雨"><div className="porch-copy"><p className="chapter-kicker">井旁听雨 / 扫把旁边</p><h1>坐在井旁，<br/>听雨慢慢落下。</h1><p>看雨落在院坝上，竹林就在眼前。</p></div></main>}
  {view==='free'&&renderSettings.freeMode&&<main className="interior-story" aria-label="自由模式">
   <aside id="free-viewpoints" className="room-panel" inert={settingsPanel!==null} aria-label="选择停留位置">
    <div className="room-heading"><Compass size={15} strokeWidth={1.3}/><span>自由模式 · {placeArea}</span></div>
    <Select value={selectedPlace} disabled={!ready||staticMode} onValueChange={(value)=>{if(value&&Object.hasOwn(PLACE_VIEWS,value))choosePlace(value as PlaceId);}}>
     <SelectTrigger className="room-selector" aria-label="选择停留位置"><SelectValue>{PLACE_VIEWS[selectedPlace].label}</SelectValue></SelectTrigger>
     <SelectContent className="room-options" alignItemWithTrigger={false} onKeyDown={event=>event.stopPropagation()}>
      <SelectGroup><SelectLabel>屋外</SelectLabel>{Object.entries(OUTDOOR_VIEWS).map(([id,item])=><SelectItem key={id} value={id} onClick={()=>choosePlace(id as PlaceId)}>{item.label}</SelectItem>)}</SelectGroup>
      <SelectGroup><SelectLabel>屋内</SelectLabel>{Object.entries(ROOM_VIEWS).map(([id,item])=><SelectItem key={id} value={id} onClick={()=>choosePlace(id as PlaceId)}>{item.label}</SelectItem>)}</SelectGroup>
     </SelectContent>
    </Select>
    <Button variant="ghost" className="floor-link" disabled={!ready||staticMode} onClick={()=>choosePlace(inside?'courtyard':'upstairs')}>{inside?<Compass size={14}/>:<DoorOpen size={14}/>}<span>{inside?'去屋前':'到厅堂'}</span></Button>
   </aside>
  </main>}
  <main className="narrative" hidden={view!=='walk'} aria-label="竹林老屋的四段记忆" style={staticMode?undefined:{height:`calc(${chapters.length*WALK_SCROLL_CYCLES*100}svh + 100dvh)`}}>
   {chapters.map((item,index)=><section id={item.id} key={item.id} className={`chapter ${chapter===index?'active':''}`} aria-labelledby={`${item.id}-heading`}>
    <div className="chapter-copy" aria-hidden={chapter!==index}>
     <p className="chapter-kicker">0{index+1} / {item.eyebrow}</p>
     {index===0?<h1 id={`${item.id}-heading`}>{item.title}</h1>:<h2 id={`${item.id}-heading`}>{item.title.split('\n').map((line,i)=><span key={line}>{i>0&&<br/>}{line}</span>)}</h2>}
     {item.copy&&<p>{item.copy}</p>}
    </div>
   </section>)}
  </main>
  {view==='walk'&&!panorama&&<nav className="exploration-nav" aria-label="探索章节">{chapters.map((item,i)=><a key={item.id} href={`#${item.id}`} className="chapter-link" aria-current={chapter===i?'step':undefined} onClick={(e)=>{e.preventDefault();chooseView('walk',()=>navigate(i));}}><span>{item.name}</span><i className="dot"/></a>)}</nav>}
  {panorama&&<div className="panorama-info"><span className="view-bearing"><Scan size={15}/><span ref={bearingLabel}>000°</span></span><span className="panorama-help"><span className="desktop-help">双指滑动或拖动环顾 · 捏合缩放</span><span className="touch-help">拖动环顾 · 双指缩放</span></span><Button className="reset-view" variant="ghost" onClick={()=>engine.current?.reset()} aria-label="复位环顾视角"><RotateCcw size={15}/><span>复位</span></Button></div>}
  <fieldset id="view-controls" className="view-toolbar" aria-label="观看方式" aria-busy={sceneBusy}>
   <div className="view-modes">
    <ToggleGroup className="view-switch" value={[selectedDestination.view]} onValueChange={(values)=>{if(values[0]==='porch'||values[0]==='walk'||values[0]==='yard'||values[0]==='free')chooseView(values[0]);}} aria-label="观看模式">
     <ToggleGroupItem value="walk" aria-busy={pendingView==='walk'} onClick={()=>chooseView('walk')}>{pendingView==='walk'?<LoaderCircle className="loading-spinner" size={16}/>:<Footprints size={16}/>}<span>沿路走走</span></ToggleGroupItem>
     <ToggleGroupItem value="porch" aria-busy={pendingView==='porch'} onClick={()=>chooseView('porch')}>{pendingView==='porch'?<LoaderCircle className="loading-spinner" size={16}/>:<House size={16}/>}<span>廊下望竹</span></ToggleGroupItem>
     <ToggleGroupItem value="yard" aria-busy={pendingView==='yard'} onClick={()=>chooseView('yard')} className="yard-toggle" disabled={!ready||staticMode}>{pendingView==='yard'?<LoaderCircle className="loading-spinner" size={16}/>:<Compass size={16}/>}<span>院内竹荫</span></ToggleGroupItem>
     {renderSettings.freeMode&&<ToggleGroupItem value="free" onClick={()=>chooseView('free')} className="free-toggle" aria-busy={pendingView==='free'} aria-expanded={view==='free'} aria-controls={view==='free'?'free-viewpoints':undefined} disabled={!ready||staticMode}>{pendingView==='free'?<LoaderCircle className="loading-spinner" size={16}/>:<Compass size={16}/>}<span>自由模式</span></ToggleGroupItem>}
    </ToggleGroup>
   </div>
   <span className="toolbar-divider"/>
   <div className="view-actions"><Button className="moon-toggle" variant="ghost" aria-pressed={selectedDestination.view==='moon'} aria-busy={pendingView==='moon'} disabled={!ready||staticMode} onClick={watchMoon}>{pendingView==='moon'?<LoaderCircle className="loading-spinner" size={16}/>:<Moon size={16}/>}<span>竹林望月</span></Button>
   <Button className="breeze-toggle" variant="ghost" aria-pressed={selectedDestination.view==='breeze'} aria-busy={pendingView==='breeze'} disabled={!ready||staticMode} onClick={listenInGrove}>{pendingView==='breeze'?<LoaderCircle className="loading-spinner" size={16}/>:<Wind size={16}/>}<span>林间的风</span></Button>
   <Button className="well-toggle" variant="ghost" aria-pressed={selectedDestination.view==='well-rain'} aria-busy={pendingView==='well-rain'} disabled={!ready||staticMode} onClick={listenByWell}>{pendingView==='well-rain'?<LoaderCircle className="loading-spinner" size={16}/>:<Droplets size={16}/>}<span>井旁听雨</span></Button>
   <Button ref={panoramaButton} className="panorama-toggle" variant="ghost" aria-pressed={panorama} disabled={!ready||staticMode} onClick={choosePanorama}>{panorama?<X size={16}/>:<Scan size={16}/>}<span>{panorama?'退出环顾':'360° 环顾'}</span></Button></div>
  </fieldset>
  <footer className="site-footer">
   <div><div className="scroll-hint">{view==='walk'?<ArrowUpDown size={18} strokeWidth={1.2}/>:<span className="living-dot"/>}<span>{panorama?'换个方向，也是一处风景':view==='well-rain'?'坐在井边，雨声还是小时候的雨声':view==='breeze'?'清风过竹叶，把心放轻一点':view==='moon'?'月光穿过竹梢，风从身旁走过':view==='porch'?'望向竹林，让时间慢一点':'走走停停，竹林总在这里'}</span></div><div className="footer-note">{panorama?'方向键环顾 · Home 复位 · Esc 退出':'竹影 · 旧木 · 家乡'}</div></div>
   {view==='walk'&&<div ref={progressLabel} className="footer-progress" aria-label="探索进度 0%"><span>0{chapter+1}</span><span className="progress-track"><i ref={progressBar} style={{transform:'scaleX(.02)'}}/></span><span>{String(chapters.length).padStart(2,'0')}</span></div>}
  </footer>
 </div>;
}
