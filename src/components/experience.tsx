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
import type { SceneHandle, SceneStage } from './scene/scene';
import { ROOM_VIEWS, OUTDOOR_VIEWS, PLACE_VIEWS, type PlaceId, type TimeOfDay, type ViewMode } from './scene/config';

import { useLanguage } from './use-language';
import { HTML_LANG, LOCALES, LOCALE_NAMES, localePath, type Locale } from '@/content/locale';
import type { Content } from '@/content';

function StoryCopy({ story }: { story: Content['moon'] }) {
 return <div className="porch-copy"><p className="chapter-kicker">{story.eyebrow}</p><h1>{story.title}</h1><p>{story.copy}</p></div>;
}

export default function Experience({ initialLocale }: { initialLocale: Locale }) {
 const { locale, changeLanguage, showLanguageSwitch, t } = useLanguage(initialLocale);
 const progressText = useRef(t.ui.progress);
 const progressPercent = useRef(0);
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
 const [failure,setFailure] = useState<keyof Content['failures']>('load');
 const [entryStage,setEntryStage] = useState<SceneStage>('entering');
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
 useEffect(() => {
   progressText.current = t.ui.progress;
   progressLabel.current?.setAttribute('aria-label', t.ui.progress.replace('{percent}', String(progressPercent.current)));
 }, [t.ui.progress]);
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
     progressPercent.current=Math.round(p*100);
     progressLabel.current?.setAttribute('aria-label',progressText.current.replace('{percent}',String(progressPercent.current)));
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
   let pendingStage:SceneStage='entering';let lastStageAt=performance.now();
   // Coalesce short stages so the copy stays readable without delaying readiness.
   const showStage=(label:SceneStage)=>{
     if(disposed||failed)return;
     pendingStage=label;
     if(stageTimer!==undefined)return;
     stageTimer=setTimeout(()=>{
       stageTimer=undefined;
       if(disposed||failed)return;
       lastStageAt=performance.now();setEntryStage(pendingStage);
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
     const scene=await createScene(mount.current,{onStage:showStage,onPanorama:(value)=>{if(!disposed){requestedPlace.current={...requestedPlace.current,panorama:value};setPanorama(value);if(!value)panoramaButton.current?.focus({preventScroll:true});}},onGust:(strength)=>{if(!disposed&&!failed)soundscape.current?.setGust(strength);},onRunoff:(flow)=>{if(disposed||failed)return;roofRunoff.current=flow;soundscape.current?.setRoofRunoff(flow);},onBearing:(value)=>{if(!disposed&&bearingLabel.current){const label=`${String(value).padStart(3,'0')}°`;if(bearingLabel.current.textContent!==label)bearingLabel.current.textContent=label;}},onFailure:()=>{if(!disposed){failed=true;clearTimeout(stageTimer);exitImmersive();finishStage?.('error',{reason:'webgl-context-lost'});finishStartup('error',{reason:'webgl-context-lost'});engine.current=null;finishSceneFeedback();resetRoof();soundRequest.current++;weatherRequest.current++;void soundscape.current?.setEnabled(false);setSoundEnabled(false);setSoundBusy(false);setWeatherBusy(false);setSettingsPanel(null);setReady(false);setError(true);setPanorama(false);setStaticMode(true);setFailure('stopped');}}},controller.signal);
     finishStage(disposed?'cancelled':failed?'error':'success');
     if(disposed||failed){finishStartup(disposed?'cancelled':'error');scene.dispose();return;}
     engine.current=scene;setReady(true);
     finishStartup('success',{boundary:'ready-state-requested'});
   } catch(e){ finishStage?.(disposed?'cancelled':phaseStatus(e));finishStartup(disposed?'cancelled':phaseStatus(e));if(!disposed&&!failed){console.error('Scene failed:',e);finishSceneFeedback();setError(true);setStaticMode(true);setFailure(e instanceof Error && e.message==='WEBGL_UNAVAILABLE'?'unsupported':'load');} }
   finally{clearTimeout(stageTimer);} };
   void start();
   return ()=>{disposed=true;clearTimeout(stageTimer);finishStage?.('cancelled');finishStartup('cancelled');resetRoof();controller.abort();engine.current?.dispose();engine.current=null;};
 },[attempt,finishSceneFeedback,exitImmersive]);
 useEffect(()=>{if(ready)beginPhase('startup.controls-ready',{attempt,boundary:'react-committed'})();},[ready,attempt]);
 useEffect(()=>{engine.current?.setDescription(t.ui.canvas);},[t.ui.canvas,ready]);
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
 const placeArea=!inside?t.ui.outside:place==='hall'||place==='kitchen'?t.ui.downstairs:t.ui.upstairs;
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
 const weatherKey=weather.rain>.7?'storm':weather.rain>0?'drizzle':(weather.autumn??0)>.5?'autumn':weather.wind===0?'calm':'breeze';
 const weatherLabel=t.weather[weatherKey];
 const listeningKey=weather.rain>.7?'storm':weather.rain>0?(view==='well-rain'?'well':'drizzle'):(weather.autumn??0)>.5?'autumn':view==='breeze'?'breeze':timeOfDay;
 const listeningCopy=t.listening[listeningKey];
 const entering=!ready&&!error;
 const activityBusy=ready&&(sceneBusy||soundBusy||weatherBusy);
 const pendingView=sceneBusy?selectedDestination.view:null;
 const soundLoading=soundBusy||weatherBusy;
 return <div className={`experience is-${view} ${panorama?'is-panorama':''} ${staticMode?'is-static':''} ${immersive?'is-immersive':''} ${soundEnabled?'is-listening':''} ${activityBusy?'is-busy':''} ${settingsPanel?'settings-open':''}`} lang={HTML_LANG[locale]} data-locale={locale} data-entering={entering} data-time={timeOfDay} data-resolution={renderSettings.resolution} data-shadows={renderSettings.shadows} data-frame-rate={renderSettings.frameRate} data-house-detail={renderSettings.houseDetail} data-free-mode={renderSettings.freeMode}>
  {performancePanel}
  <a className="skip-link" href="#view-controls" onClick={(e)=>{e.preventDefault();document.querySelector<HTMLButtonElement>('#view-controls button')?.focus({preventScroll:true});}}>{t.ui.skip}</a>
  <div className="scene-shell" aria-hidden={!panorama} aria-busy={entering||sceneBusy}>
   <picture><source media="(max-width:700px)" srcSet="/scene-poster-mobile.webp"/><img className="fallback-view" src="/scene-poster.webp" alt="" /></picture>
   <div ref={mount} className={`scene-mount ${ready?'ready':''}`} />
   <div ref={transitionVeil} className="scene-loading-veil" />
  </div>
  <div className="scene-shade" />
  <output className="scene-entry" data-active={entering} data-failed={error} aria-live="polite" aria-atomic="true" aria-hidden={!entering} inert={!entering}>
   <span className="scene-entry-panel">
    <span className="scene-entry-logo" aria-hidden="true" />
    <span key={entryStage} className="scene-entry-caption">{t.stages[entryStage]}</span>
    <span className="scene-entry-track" aria-hidden="true"><span /></span>
   </span>
  </output>
  <header className="site-header" data-locale-test={showLanguageSwitch}>
   <a className="wordmark" href="#bamboo" onClick={(e)=>{e.preventDefault();chooseView('walk',returnHome);}} aria-label={t.ui.home}><span className="wordmark-icon" aria-hidden="true" /><span>{t.brand}</span></a>
   {showLanguageSwitch&&<nav className="language-switch" aria-label={t.ui.language}>{LOCALES.map(next=><a key={next} href={`${localePath(next)}?localeTest=1`} hrefLang={HTML_LANG[next]} lang={HTML_LANG[next]} aria-current={locale===next?'page':undefined} onClick={event=>{
    if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();changeLanguage(next);
   }}>{LOCALE_NAMES[next]}</a>)}</nav>}
   <div className="header-aside">
   <ToggleGroup className="day-switch" value={[timeOfDay]} onValueChange={(values)=>{if(values[0]==='dawn'||values[0]==='day'||values[0]==='dusk'||values[0]==='night')chooseTime(values[0]);}} aria-label={t.ui.time} disabled={!ready||staticMode}>
    <ToggleGroupItem value="dawn" aria-label={t.ui.dawn}><Sunrise size={15} strokeWidth={1.5}/><span>{t.ui.dawn}</span></ToggleGroupItem>
    <ToggleGroupItem value="day" aria-label={t.ui.day}><Sun size={15} strokeWidth={1.5}/><span>{t.ui.day}</span></ToggleGroupItem>
    <ToggleGroupItem value="dusk" aria-label={t.ui.dusk} title={t.ui.goldenLight}><Sunset size={15} strokeWidth={1.5}/><span>{t.ui.dusk}</span></ToggleGroupItem>
    <ToggleGroupItem value="night" aria-label={t.ui.night}><Moon size={15} strokeWidth={1.5}/><span>{t.ui.night}</span></ToggleGroupItem>
   </ToggleGroup>
   <div className="weather-controls">
    <Button ref={weatherButton} className="control-button weather-toggle" onClick={()=>setSettingsPanel(settingsPanel==='weather'?null:'weather')} aria-label={t.ui.adjustWeather} aria-expanded={settingsPanel==='weather'} aria-controls="weather-settings" disabled={!ready||staticMode}>{weather.rain>0?<CloudRain size={16}/>:<Wind size={16}/>}<span>{weatherLabel}</span></Button>
    {settingsPanel==='weather'&&<dialog open ref={weatherPanel} id="weather-settings" className="settings-panel weather-panel" aria-labelledby="weather-title" onKeyDown={event=>event.stopPropagation()}>
     <div className="settings-heading"><h2 id="weather-title">{t.ui.weather}</h2><Button className="settings-close" variant="ghost" aria-label={t.ui.closeWeather} onClick={()=>{setSettingsPanel(null);weatherButton.current?.focus({preventScroll:true});}}><X size={15}/></Button></div>
     <p className="settings-description">{t.weatherDescription[weatherKey==='calm'?'breeze':weatherKey]}</p>
     <fieldset className="weather-presets" aria-label={t.ui.chooseWeather}>{Object.entries(WEATHER_PRESETS).map(([key,preset])=><Button key={key} variant="ghost" aria-pressed={Math.abs(weather.wind-preset.wind)<.005&&Math.abs(weather.rain-preset.rain)<.005&&Math.abs((weather.autumn??0)-('autumn' in preset?preset.autumn:0))<.005} onClick={()=>chooseWeather({...preset})}>{preset.rain===0?<Wind size={14}/>:<CloudRain size={14}/>}<span>{t.weather[key as keyof typeof WEATHER_PRESETS]}</span></Button>)}</fieldset>
     <output className="weather-listening-note">{weatherError||soundError?<><span>{soundError?t.ui.soundFailure:t.ui.rainFailure}</span><Button variant="ghost" disabled={soundBusy} onClick={()=>soundError?toggleSound():chooseWeather(weather)}>{soundError?t.ui.retrySound:t.ui.retryRain}</Button></>:weatherBusy||soundBusy?t.ui.soundLoading:soundEnabled?t.ui.adjustVolume:<><span>{t.ui.enableSoundHint}</span><Button variant="ghost" disabled={soundBusy} onClick={toggleSound}>{t.ui.enableSound}</Button></>}</output>
    </dialog>}
   </div>
   <div className="sound-controls">
    <Button className="control-button sound-toggle" onClick={toggleSound} aria-busy={soundLoading} aria-label={soundBusy?t.ui.cancelSound:soundEnabled?t.ui.disableAmbience:soundError?t.ui.retryAmbience:t.ui.enableAmbience} aria-pressed={soundEnabled} disabled={!ready||staticMode}>{soundLoading?<LoaderCircle className="loading-spinner" size={16}/>:soundEnabled?<Volume2 size={16}/>:<VolumeX size={16}/>}<span>{soundEnabled?t.ui.listening:soundError?t.ui.retrySound:t.ui.listen}</span></Button>
   </div>
   <div className="render-controls">
    <Button ref={settingsButton} className="control-button render-toggle header-icon" aria-label={t.ui.settingsLabel} title={t.ui.settingsLabel} aria-expanded={settingsPanel==='preferences'} aria-controls="experience-settings" disabled={!ready||staticMode} onClick={()=>setSettingsPanel(settingsPanel==='preferences'?null:'preferences')}><SlidersHorizontal size={17}/></Button>
    {settingsPanel==='preferences'&&<dialog open ref={preferencesPanel} id="experience-settings" className="settings-panel render-panel" aria-labelledby="settings-title" onKeyDown={event=>event.stopPropagation()}>
     <div className="settings-heading"><h2 id="settings-title">{t.ui.settings}</h2>
      <Button className="settings-close" variant="ghost" aria-label={t.ui.closeSettings} title={t.ui.closeSettings} onClick={()=>{setSettingsPanel(null);settingsButton.current?.focus({preventScroll:true});}}><X size={16}/></Button>
     </div>
     <Tabs.Root defaultValue="render">
      <Tabs.List className="settings-tabs" aria-label={t.ui.settingsCategory}>
       <Tabs.Tab value="render"><Monitor size={15}/><span>{t.ui.graphics}</span></Tabs.Tab>
       <Tabs.Tab value="sound"><Volume2 size={15}/><span>{t.ui.sound}</span></Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="render">
       <div className="settings-section-heading"><span>{t.ui.performance}</span><Button className="render-reset" variant="ghost" aria-label={t.ui.resetGraphics} title={t.ui.resetGraphics} onClick={()=>chooseRenderSettings({...defaultRenderSettings(matchMedia(MOBILE_SCENE_QUERY).matches),freeMode:renderSettings.freeMode})}><RotateCcw size={15}/></Button></div>
     <div className="render-row render-profile"><span id="render-profile-label">{t.ui.quality}</span>
      <ToggleGroup className="render-segments" value={renderProfile?[renderProfile]:[]} aria-labelledby="render-profile-label" onValueChange={values=>{
       const profile=values[0]==='performance'?PERFORMANCE_RENDER_SETTINGS:values[0]==='balanced'?DEFAULT_RENDER_SETTINGS:values[0]==='full'?FULL_RENDER_SETTINGS:null;
       if(profile)chooseRenderSettings({...profile,freeMode:renderSettings.freeMode});
      }}>
       <ToggleGroupItem value="performance" aria-label={t.ui.preferPerformance}>{t.ui.fast}</ToggleGroupItem>
       <ToggleGroupItem value="balanced">{t.ui.balanced}</ToggleGroupItem>
       <ToggleGroupItem value="full">{t.ui.full}</ToggleGroupItem>
      </ToggleGroup>
     </div>
     <div className="render-row"><span id="render-resolution-label">{t.ui.resolution}</span>
      <ToggleGroup className="render-segments" value={[renderSettings.resolution]} aria-labelledby="render-resolution-label" onValueChange={values=>{const resolution=values[0];if(resolution==='reduced'||resolution==='balanced'||resolution==='full')setRenderSettings(value=>({...value,resolution}));}}>
       <ToggleGroupItem value="reduced" aria-label={t.ui.softer}>{t.ui.soft}</ToggleGroupItem>
       <ToggleGroupItem value="balanced" aria-label={t.ui.balancedResolution}>{t.ui.balanced}</ToggleGroupItem>
       <ToggleGroupItem value="full" aria-label={t.ui.fullResolution}>{t.ui.sharp}</ToggleGroupItem>
      </ToggleGroup>
     </div>
     <div className="render-row"><span id="render-frame-label">{t.ui.frameRate}</span>
      <ToggleGroup className="render-segments" value={[renderSettings.frameRate]} aria-labelledby="render-frame-label" onValueChange={values=>{const frameRate=values[0];if(frameRate==='30'||frameRate==='60'||frameRate==='display')setRenderSettings(value=>({...value,frameRate}));}}>
       <ToggleGroupItem value="30" aria-label={t.ui.fps30}>30</ToggleGroupItem>
       <ToggleGroupItem value="60" aria-label={t.ui.fps60}>60</ToggleGroupItem>
       <ToggleGroupItem value="display" aria-label={t.ui.followDisplay}>{t.ui.display}</ToggleGroupItem>
      </ToggleGroup>
     </div>
     <div className="render-row"><span id="render-shadow-label">{t.ui.shadows}</span>
      <ToggleGroup className="render-segments" value={[renderSettings.shadows]} aria-labelledby="render-shadow-label" onValueChange={values=>{const shadows=values[0];if(shadows==='off'||shadows==='alternate'||shadows==='full')setRenderSettings(value=>({...value,shadows}));}}>
       <ToggleGroupItem value="off" aria-label={t.ui.disableShadows}>{t.ui.off}</ToggleGroupItem>
       <ToggleGroupItem value="alternate" aria-label={t.ui.alternateFrames}>{t.ui.alternate}</ToggleGroupItem>
       <ToggleGroupItem value="full" aria-label={t.ui.everyFrame}>{t.ui.eachFrame}</ToggleGroupItem>
      </ToggleGroup>
     </div>
     <div className="render-row"><span id="render-house-label">{t.ui.houseDetail}</span>
      <ToggleGroup className="render-segments" value={[renderSettings.houseDetail]} aria-labelledby="render-house-label" onValueChange={values=>{const houseDetail=values[0];if(houseDetail==='lean'||houseDetail==='balanced'||houseDetail==='full')setRenderSettings(value=>({...value,houseDetail}));}}>
       <ToggleGroupItem value="lean" aria-label={t.ui.leanHouse}>{t.ui.lean}</ToggleGroupItem>
       <ToggleGroupItem value="balanced" aria-label={t.ui.balancedHouse}>{t.ui.balanced}</ToggleGroupItem>
       <ToggleGroupItem value="full" aria-label={t.ui.originalHouse}>{t.ui.original}</ToggleGroupItem>
      </ToggleGroup>
     </div>
     <label className="render-detail-toggle" htmlFor="enable-free-mode"><span>{t.ui.freeMode}</span><input id="enable-free-mode" type="checkbox" role="switch" aria-checked={renderSettings.freeMode} checked={renderSettings.freeMode} onChange={event=>chooseRenderSettings({...renderSettings,freeMode:event.target.checked})}/></label>
      </Tabs.Panel>
      <Tabs.Panel value="sound" className="sound-settings-content">
       <label className="render-detail-toggle" htmlFor="enable-sound"><span>{t.ui.natureSounds}</span><input id="enable-sound" type="checkbox" role="switch" aria-checked={soundEnabled} checked={soundEnabled} disabled={soundBusy} onChange={event=>{void playSound(event.target.checked);}}/></label>
       <p className="settings-description">{soundBusy?t.ui.soundLoading:listeningCopy}{view==='free'&&inside?t.listening.inside:''}</p>
       {soundError&&<output className="weather-listening-note"><span>{t.ui.soundFailure}</span><Button variant="ghost" onClick={toggleSound}>{t.ui.retrySound}</Button></output>}
       <label htmlFor="ambience-volume">{t.ui.volume} <output>{Math.round(volume*100)}%</output></label>
       <input id="ambience-volume" type="range" min="0" max="100" value={Math.round(volume*100)} onChange={event=>setVolume(Number(event.target.value)/100)} aria-label={t.ui.ambienceVolume}/>
       <a href={t.creditsPath} target="_blank" rel="noreferrer">{t.ui.credits}</a>
      </Tabs.Panel>
     </Tabs.Root>
    </dialog>}
   </div>
   <Button className="control-button header-icon fullscreen-toggle" aria-label={t.ui.fullscreenLabel} title={t.ui.fullscreen} disabled={!ready||staticMode||sceneBusy} onClick={event=>{setSettingsPanel(null);enterImmersive(event.currentTarget);}}><Maximize size={17}/></Button>
   </div>
  </header>
  {soundError&&settingsPanel===null&&<output className="sound-message">{t.ui.soundRetryHint}</output>}
  {weatherError&&!soundError&&settingsPanel===null&&<output className="sound-message weather-message"><span>{t.ui.rainFailure}</span><Button variant="ghost" onClick={()=>chooseWeather(weather)}>{t.ui.retryRain}</Button></output>}
  {(staticMode || reduced) && <output className="mode-message">{staticMode?t.ui.still: t.ui.reducedMotion}</output>}
  {error&&<div className="scene-error" role="alert"><p>{t.failures[failure]}</p><Button className="control-button" onClick={()=>{setEntryStage('entering');setReady(false);setError(false);setStaticMode(false);setAttempt(attempt+1);}}><RotateCcw size={14}/>{t.ui.reload}</Button></div>}
  {view==='porch'&&<main id="porch" className="porch-story" aria-label={t.ui.porchView}><StoryCopy story={t.porch[timeOfDay]}/></main>}
  {view==='moon'&&<main className="porch-story moon-story" aria-label={t.ui.moon}><StoryCopy story={t.moon}/></main>}
  {view==='breeze'&&<main className="porch-story breeze-story" aria-label={t.ui.breeze}><StoryCopy story={weather.autumn?t.autumn:t.breeze}/></main>}
  {view==='well-rain'&&<main className="porch-story well-story" aria-label={t.ui.well}><StoryCopy story={t.well}/></main>}
  {view==='free'&&renderSettings.freeMode&&<main className="interior-story" aria-label={t.ui.freeMode}>
   <aside id="free-viewpoints" className="room-panel" inert={settingsPanel!==null} aria-label={t.ui.choosePlace}>
    <div className="room-heading"><Compass size={15} strokeWidth={1.3}/><span>{t.ui.viewpoints} · {placeArea}</span></div>
    <Select value={selectedPlace} disabled={!ready||staticMode} onValueChange={(value)=>{if(value&&Object.hasOwn(PLACE_VIEWS,value))choosePlace(value as PlaceId);}}>
     <SelectTrigger className="room-selector" aria-label={t.ui.choosePlace}><SelectValue>{t.places[selectedPlace]}</SelectValue></SelectTrigger>
     <SelectContent className="room-options" alignItemWithTrigger={false} onKeyDown={event=>event.stopPropagation()}>
      <SelectGroup><SelectLabel>{t.ui.outside}</SelectLabel>{Object.keys(OUTDOOR_VIEWS).map(id=><SelectItem key={id} value={id} onClick={()=>choosePlace(id as PlaceId)}>{t.places[id as PlaceId]}</SelectItem>)}</SelectGroup>
      <SelectGroup><SelectLabel>{t.ui.inside}</SelectLabel>{Object.keys(ROOM_VIEWS).map(id=><SelectItem key={id} value={id} onClick={()=>choosePlace(id as PlaceId)}>{t.places[id as PlaceId]}</SelectItem>)}</SelectGroup>
     </SelectContent>
    </Select>
    <Button variant="ghost" className="floor-link" disabled={!ready||staticMode} onClick={()=>choosePlace(inside?'courtyard':'upstairs')}>{inside?<Compass size={14}/>:<DoorOpen size={14}/>}<span>{inside?t.ui.goOutside:t.ui.goInside}</span></Button>
   </aside>
  </main>}
  <main className="narrative" hidden={view!=='walk'} aria-label={t.ui.narrative} style={staticMode?undefined:{height:`calc(${chapters.length*WALK_SCROLL_CYCLES*100}svh + 100dvh)`}}>
   {chapters.map((item,index)=><section id={item.id} key={item.id} className={`chapter ${chapter===index?'active':''}`} aria-labelledby={`${item.id}-heading`}>
    <div className="chapter-copy" aria-hidden={chapter!==index}>
     <p className="chapter-kicker">0{index+1} / {t.chapters[item.id].eyebrow}</p>
     {index===0?<h1 id={`${item.id}-heading`}>{t.chapters[item.id].title}</h1>:<h2 id={`${item.id}-heading`}>{t.chapters[item.id].title}</h2>}
     {t.chapters[item.id].copy&&<p>{t.chapters[item.id].copy}</p>}
    </div>
   </section>)}
  </main>
  {view==='walk'&&!panorama&&<nav className="exploration-nav" aria-label={t.ui.chapters}>{chapters.map((item,i)=><a key={item.id} href={`#${item.id}`} className="chapter-link" aria-current={chapter===i?'step':undefined} onClick={(e)=>{e.preventDefault();chooseView('walk',()=>navigate(i));}}><span>{t.chapters[item.id].name}</span><i className="dot"/></a>)}</nav>}
  {panorama&&<div className="panorama-info"><span className="view-bearing"><Scan size={15}/><span ref={bearingLabel}>000°</span></span><span className="panorama-help"><span className="desktop-help">{t.ui.desktopHelp}</span><span className="touch-help">{t.ui.touchHelp}</span></span><Button className="reset-view" variant="ghost" onClick={()=>engine.current?.reset()} aria-label={t.ui.resetViewLabel}><RotateCcw size={15}/><span>{t.ui.resetView}</span></Button></div>}
  <fieldset id="view-controls" className="view-toolbar" aria-label={t.ui.viewControls} aria-busy={sceneBusy}>
   <div className="view-modes">
    <ToggleGroup className="view-switch" value={[selectedDestination.view]} onValueChange={(values)=>{if(values[0]==='porch'||values[0]==='walk'||values[0]==='yard'||values[0]==='free')chooseView(values[0]);}} aria-label={t.ui.viewMode}>
     <ToggleGroupItem value="walk" aria-busy={pendingView==='walk'} onClick={()=>chooseView('walk')}>{pendingView==='walk'?<LoaderCircle className="loading-spinner" size={16}/>:<Footprints size={16}/>}<span>{t.ui.walk}</span></ToggleGroupItem>
     <ToggleGroupItem value="porch" aria-busy={pendingView==='porch'} onClick={()=>chooseView('porch')}>{pendingView==='porch'?<LoaderCircle className="loading-spinner" size={16}/>:<House size={16}/>}<span>{t.ui.porch}</span></ToggleGroupItem>
     <ToggleGroupItem value="yard" aria-busy={pendingView==='yard'} onClick={()=>chooseView('yard')} className="yard-toggle" disabled={!ready||staticMode}>{pendingView==='yard'?<LoaderCircle className="loading-spinner" size={16}/>:<Compass size={16}/>}<span>{t.ui.yard}</span></ToggleGroupItem>
     {renderSettings.freeMode&&<ToggleGroupItem value="free" onClick={()=>chooseView('free')} className="free-toggle" aria-busy={pendingView==='free'} aria-expanded={view==='free'} aria-controls={view==='free'?'free-viewpoints':undefined} disabled={!ready||staticMode}>{pendingView==='free'?<LoaderCircle className="loading-spinner" size={16}/>:<Compass size={16}/>}<span>{t.ui.viewpoints}</span></ToggleGroupItem>}
    </ToggleGroup>
   </div>
   <span className="toolbar-divider"/>
   <div className="view-actions"><Button className="moon-toggle" variant="ghost" aria-pressed={selectedDestination.view==='moon'} aria-busy={pendingView==='moon'} disabled={!ready||staticMode} onClick={watchMoon}>{pendingView==='moon'?<LoaderCircle className="loading-spinner" size={16}/>:<Moon size={16}/>}<span>{t.ui.moon}</span></Button>
   <Button className="breeze-toggle" variant="ghost" aria-pressed={selectedDestination.view==='breeze'} aria-busy={pendingView==='breeze'} disabled={!ready||staticMode} onClick={listenInGrove}>{pendingView==='breeze'?<LoaderCircle className="loading-spinner" size={16}/>:<Wind size={16}/>}<span>{t.ui.breeze}</span></Button>
   <Button className="well-toggle" variant="ghost" aria-pressed={selectedDestination.view==='well-rain'} aria-busy={pendingView==='well-rain'} disabled={!ready||staticMode} onClick={listenByWell}>{pendingView==='well-rain'?<LoaderCircle className="loading-spinner" size={16}/>:<Droplets size={16}/>}<span>{t.ui.well}</span></Button>
   <Button ref={panoramaButton} className="panorama-toggle" variant="ghost" aria-pressed={panorama} disabled={!ready||staticMode} onClick={choosePanorama}>{panorama?<X size={16}/>:<Scan size={16}/>}<span>{panorama?t.ui.exitPanorama:t.ui.panorama}</span></Button></div>
  </fieldset>
  <footer className="site-footer">
   <div><div className="scroll-hint">{view==='walk'?<ArrowUpDown size={18} strokeWidth={1.2}/>:<span className="living-dot"/>}<span>{t.footer[panorama?'panorama':view==='well-rain'?'well':view==='breeze'?'breeze':view==='moon'?'moon':view==='porch'?'porch':'walk']}</span></div><div className="footer-note">{panorama?t.ui.keyboardHelp:t.footer.note}</div></div>
   {view==='walk'&&<div ref={progressLabel} className="footer-progress" aria-label={t.ui.progress.replace('{percent}','0')}><span>0{chapter+1}</span><span className="progress-track"><i ref={progressBar} style={{transform:'scaleX(.02)'}}/></span><span>{String(chapters.length).padStart(2,'0')}</span></div>}
  </footer>
 </div>;
}
