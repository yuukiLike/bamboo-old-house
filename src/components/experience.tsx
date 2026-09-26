'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUpRight, Pause, Play, Compass, RotateCcw, Sun, SunMedium, Moon, Scan, X, DoorOpen, Sunrise, Sunset, Volume2, VolumeX, SlidersHorizontal, Wind, CloudRain, Droplets, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectGroup, SelectLabel } from '@/components/ui/select';
import { createSoundscape } from './scene/soundscape';
import { createSceneTransition } from './scene-transition';
import { beginPhase, phaseStatus, type FinishPhase } from '@/lib/performance';
import { usePerformancePanel } from '../../tools/scene-perf/react/use-performance-panel';
import { bambooPerformanceAdapter } from '../performance/bamboo-adapter';
import { DEFAULT_WEATHER, WEATHER_PRESETS, type WeatherSettings } from './scene/weather-state';
import { DEFAULT_RENDER_SETTINGS, FULL_RENDER_SETTINGS, type RenderSettings } from './scene/render-settings';
import type { SceneHandle } from './scene/scene';
import { ROOM_VIEWS, OUTDOOR_VIEWS, PLACE_VIEWS, type PlaceId, type TimeOfDay, type ViewMode } from './scene/config';

const chapters = [
 { id:'bamboo', name:'竹林', eyebrow:'一段水边的记忆', title:'竹林里的老屋', copy:'我曾走过这里。' },
 { id:'approach', name:'靠近', eyebrow:'竹影之间', title:'穿过竹影，\n老屋就在眼前。', copy:'' },
 { id:'courtyard', name:'屋前', eyebrow:'屋檐之下', title:'光落在旧木上。', copy:'' },
 { id:'forest-slope', name:'竹林坡地', eyebrow:'竹林坡地', title:'落叶贴着泥土，\n风从林间经过。', copy:'听见雨滴，也闻见夏天。' },
 { id:'return', name:'回望', eyebrow:'再听一会儿风', title:'把这一刻，\n留在这里。', copy:'' },
];

export default function Experience() {
 const performancePanel = usePerformancePanel(bambooPerformanceAdapter);
 const mount = useRef<HTMLDivElement>(null);
 const engine = useRef<SceneHandle | null>(null);
 const sceneTransition = useRef<ReturnType<typeof createSceneTransition> | null>(null);
 const requestedPlace = useRef<{view:ViewMode;place:PlaceId;panorama:boolean}>({view:'walk',place:'courtyard',panorama:false});
 const pendingViewTiming = useRef<FinishPhase | undefined>(undefined);
 const committedPlace = useRef({view:'walk' as ViewMode,place:'courtyard' as PlaceId});
 const pendingNavigation = useRef<{revision:number;run:()=>void}|undefined>(undefined);
 const navigationCounter = useRef(0);
 const [navigationRevision,setNavigationRevision] = useState(0);
 const [chapter, setChapter] = useState(0);
 const progressLabel = useRef<HTMLDivElement>(null);
 const progressBar = useRef<HTMLElement>(null);
 const [paused, setPaused] = useState(false);
 const [reduced, setReduced] = useState(false);
 const [loading, setLoading] = useState<{state:string; progress:number | null}>({state:'正在走进竹林…',progress:null});
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
 const [settingsPanel,setSettingsPanel] = useState<'sound' | 'weather' | 'render' | null>(null);
 const [renderSettings,setRenderSettings] = useState<RenderSettings>({...DEFAULT_RENDER_SETTINGS});
 const [weather,setWeather] = useState<WeatherSettings>({...DEFAULT_WEATHER});
 const [weatherBusy,setWeatherBusy] = useState(false);
 const [weatherError,setWeatherError] = useState(false);
 const weatherRequest = useRef(0);
 const roofRunoff = useRef(0);
 const weatherButton = useRef<HTMLButtonElement>(null);
 const soundSettingsButton = useRef<HTMLButtonElement>(null);
 const weatherPanel = useRef<HTMLDialogElement>(null);
 const soundPanel = useRef<HTMLDialogElement>(null);
 const renderButton = useRef<HTMLButtonElement>(null);
 const renderPanel = useRef<HTMLDialogElement>(null);
 const [volume,setVolume] = useState(.55);
 const soundRequest = useRef(0);
 const panoramaButton = useRef<HTMLButtonElement>(null);
 useEffect(()=>{
   const transition=createSceneTransition(()=>engine.current?.transition);sceneTransition.current=transition;
   const visibility=()=>{if(document.hidden)transition.finish();};
   const resize=()=>transition.finish();
   const media=matchMedia('(prefers-reduced-motion: reduce)');
   const change=()=>{if(media.matches)transition.finish();};
   document.addEventListener('visibilitychange',visibility);window.addEventListener('resize',resize);media.addEventListener('change',change);
   return()=>{pendingViewTiming.current?.('cancelled');transition.dispose();sceneTransition.current=null;pendingNavigation.current=undefined;document.removeEventListener('visibilitychange',visibility);window.removeEventListener('resize',resize);media.removeEventListener('change',change);};
 },[]);
 useEffect(()=>{if(!ready||staticMode)sceneTransition.current?.finish();},[ready,staticMode]);
 useEffect(() => {
   const media=matchMedia('(prefers-reduced-motion: reduce)');
   const change=()=>setReduced(media.matches); change(); media.addEventListener('change',change);
   return ()=>media.removeEventListener('change',change);
 },[]);
 useEffect(() => {
   let frame=0,previousChapter=-1;
   const update=()=>{
     frame=0;
     const p=Math.min(1,Math.max(0,window.scrollY/Math.max(1,document.documentElement.scrollHeight-innerHeight)));
     const nextChapter=Math.min(4,Math.floor(p*4+.5));
     // Continuous input only updates the small HUD, not the whole control tree.
     if(nextChapter!==previousChapter){previousChapter=nextChapter;setChapter(nextChapter);}
     progressLabel.current?.setAttribute('aria-label',`探索进度 ${Math.round(p*100)}%`);
     if(progressBar.current)progressBar.current.style.transform=`scaleX(${Math.max(.02,p)})`;
     if(mount.current)mount.current.style.transition=p>0?'none':'';
   };
   const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
   update();window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule);
   return()=>{cancelAnimationFrame(frame);window.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule);};
 },[view]);
 useEffect(()=>{ let disposed=false,failed=false;const controller=new AbortController();
   const finishStartup=beginPhase('startup.experience',{attempt});
   let finishStage:FinishPhase|undefined;
   const resetRoof=()=>{roofRunoff.current=0;soundscape.current?.setRoofRunoff(0);};
   resetRoof();
   const start=async()=>{ try {
     finishStage=beginPhase('startup.scene-import',{attempt});
     const { createScene } = await import('./scene/scene');
     finishStage(disposed?'cancelled':'success');
     if(disposed || !mount.current){finishStartup('cancelled');return;}
     finishStage=beginPhase('startup.create-scene',{attempt});
     const scene=await createScene(mount.current,{onProgress:(state,value)=>{if(!disposed)setLoading({state,progress:value});},onPanorama:(value)=>{if(!disposed){requestedPlace.current={...requestedPlace.current,panorama:value};setPanorama(value);if(!value)panoramaButton.current?.focus({preventScroll:true});}},onGust:(strength)=>{if(!disposed&&!failed)soundscape.current?.setGust(strength);},onRunoff:(flow)=>{if(disposed||failed)return;roofRunoff.current=flow;soundscape.current?.setRoofRunoff(flow);},onBearing:(value)=>{if(!disposed&&bearingLabel.current){const label=`${String(value).padStart(3,'0')}°`;if(bearingLabel.current.textContent!==label)bearingLabel.current.textContent=label;}},onFailure:()=>{if(!disposed){failed=true;finishStage?.('error',{reason:'webgl-context-lost'});finishStartup('error',{reason:'webgl-context-lost'});engine.current=null;resetRoof();soundRequest.current++;weatherRequest.current++;void soundscape.current?.setEnabled(false);setSoundEnabled(false);setSoundBusy(false);setWeatherBusy(false);setSettingsPanel(null);setReady(false);setError(true);setStaticMode(true);setPanorama(false);setLoading({state:"实时画面已暂停，可重新载入。",progress:null});}}},controller.signal);
     finishStage(disposed?'cancelled':failed?'error':'success');
     if(disposed||failed){finishStartup(disposed?'cancelled':'error');scene.dispose();return;}
     engine.current=scene; setReady(true);setLoading({state:'',progress:100});
     finishStartup('success',{boundary:'ready-state-requested'});
   } catch(e){ finishStage?.(disposed?'cancelled':phaseStatus(e));finishStartup(disposed?'cancelled':phaseStatus(e));if(!disposed&&!failed){console.error('Scene failed:',e);setError(true);setStaticMode(true);setLoading({state:e instanceof Error && e.message==='WEBGL_UNAVAILABLE'?'此设备使用静态观看模式。':'竹林暂时没有载入，仍可继续阅读。',progress:null});} } };
   void start();
   return ()=>{disposed=true;finishStage?.('cancelled');finishStartup('cancelled');resetRoof();controller.abort();engine.current?.dispose();engine.current=null;};
 },[attempt]);
 useEffect(()=>{if(ready)beginPhase('startup.controls-ready',{attempt,boundary:'react-committed'})();},[ready,attempt]);
 useEffect(()=>{engine.current?.setPaused(paused || reduced);},[paused,reduced,ready]);
 useEffect(()=>{engine.current?.setView(view);},[view,ready]);
 useEffect(()=>{engine.current?.setPlace(place);},[place,ready]);
 useEffect(()=>{engine.current?.setTimeOfDay(timeOfDay);},[timeOfDay,ready]);
 useEffect(()=>{engine.current?.setWeather(weather);},[weather,ready]);
 useEffect(()=>{engine.current?.setRenderSettings(renderSettings);},[renderSettings,ready]);
 useEffect(()=>{engine.current?.setPanorama(panorama);},[panorama,ready]);
 useEffect(()=>()=>{soundRequest.current++;weatherRequest.current++;soundscape.current?.dispose();soundscape.current=null;},[]);
 useEffect(()=>{soundscape.current?.setTimeOfDay(timeOfDay);},[timeOfDay]);
 useEffect(()=>{soundscape.current?.setSheltered(inside);soundscape.current?.setView(view);},[view,inside]);
 useEffect(()=>{soundscape.current?.setVolume(volume);},[volume]);
 useEffect(()=>{
   if(!settingsPanel)return;
   const panel={weather:weatherPanel,sound:soundPanel,render:renderPanel}[settingsPanel].current;
   const trigger={weather:weatherButton,sound:soundSettingsButton,render:renderButton}[settingsPanel].current;
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
   if(!value){weatherRequest.current++;setWeatherBusy(false);setWeatherError(false);setSettingsPanel(null);}
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
 const chooseTime=(next:TimeOfDay)=>{setTimeOfDay(next);if(requestedPlace.current.view==='moon'&&next!=='night')chooseView('walk');};
 const watchMoon=()=>{setSettingsPanel(null);setTimeOfDay('night');chooseWeather({...DEFAULT_WEATHER});chooseView('moon');};
 const listenInGrove=()=>{
   const nextWeather={...WEATHER_PRESETS.autumn};
   setSettingsPanel(null);setTimeOfDay('day');chooseView('breeze');
   soundscape.current?.setTimeOfDay('day');
   chooseWeather(nextWeather);
   // This dedicated listening action is itself the explicit playback gesture.
   if(!soundEnabled)void playSound(true,'breeze','day',nextWeather);
 };
 const listenByWell=()=>{
   const nextWeather=weather.rain>0?weather:{...WEATHER_PRESETS.drizzle};
   setSettingsPanel(null);setTimeOfDay('day');chooseView('well-rain');
   soundscape.current?.setTimeOfDay('day');
   chooseWeather(nextWeather);
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
 const changePlace=(next:typeof requestedPlace.current,afterCommit?:()=>void)=>{
   pendingViewTiming.current?.('superseded');
   const finish=beginPhase('view.request-to-commit',{view:next.view,place:next.place});pendingViewTiming.current=finish;
   const previous=requestedPlace.current;requestedPlace.current=next;
   setSelectedDestination({view:next.view,place:next.place});
   pendingNavigation.current=undefined;
   const apply=()=>{try{commitPlace();if(afterCommit){const revision=++navigationCounter.current;pendingNavigation.current={revision,run:afterCommit};setNavigationRevision(revision);}finish('success',{boundary:'state-and-scene-committed'});}catch(error){finish(phaseStatus(error));throw error;}};
   if(previous.view===next.view&&previous.place===next.place&&committedPlace.current.view===next.view&&committedPlace.current.place===next.place&&!sceneTransition.current?.covering) {apply();return;}
   const animate=ready&&!staticMode&&!document.hidden&&!matchMedia('(prefers-reduced-motion: reduce)').matches;
   if(sceneTransition.current)sceneTransition.current.request(apply,animate);else apply();
 };
 const chooseView=(next:ViewMode,afterCommit?:()=>void)=>changePlace({...requestedPlace.current,view:next,panorama:next==='free'},afterCommit);
 const placeArea=!inside?'屋外':place==='hall'||place==='kitchen'?'楼下':'楼上';
 const choosePlace=(next:PlaceId)=>changePlace({view:'free',place:next,panorama:true});
 const choosePanorama=()=>{const value=!requestedPlace.current.panorama;requestedPlace.current={...requestedPlace.current,panorama:value};setPanorama(value);engine.current?.setPanorama(value);};
 const returnHome=useCallback(()=>{engine.current?.reset();window.scrollTo({top:0,behavior:reduced?'instant':'smooth'});setChapter(0);},[reduced]);
 const navigate=(index:number)=>{window.scrollTo({top:(document.documentElement.scrollHeight-innerHeight)*index/4,behavior:reduced?'instant':'smooth'});};
 const weatherLabel=weather.rain>.7?'暴雨':weather.rain>0?'细雨':(weather.autumn??0)>.5?'大风':weather.wind===0?'无风':'晴风';
 const listeningCopy=weather.rain>.7?'雨落屋檐 · 一场夏日大雨':weather.rain>0?(view==='well-rain'?'井边细雨 · 檐下滴答':'细雨轻落 · 叶间滴答'):(weather.autumn??0)>.5?'风起竹海 · 带一点秋凉':view==='breeze'?'风从身旁经过 · 叶片轻轻响':{dawn:'晨鸟初醒 · 叶间微风',day:'风过竹叶 · 远处鸟鸣',noon:'竹荫正浓 · 远处夏声',dusk:'晚风渐柔 · 虫声初起',night:'月下虫鸣 · 风过竹梢'}[timeOfDay];
 return <div className={`experience is-${view} ${panorama?'is-panorama':''} ${staticMode?'is-static':''} ${soundEnabled?'is-listening':''} ${settingsPanel?'settings-open':''}`} data-time={timeOfDay} data-resolution={renderSettings.resolution} data-shadows={renderSettings.shadows} data-frame-rate={renderSettings.frameRate}>
  {performancePanel}
  <a className="skip-link" href="#return" onClick={(e)=>{e.preventDefault();chooseView('walk',()=>navigate(4));}}>跳到结束</a>
  <div className="scene-shell" aria-hidden={!panorama}>
   <picture><source media="(max-width:700px)" srcSet="/scene-poster-mobile.webp"/><img className="fallback-view" src="/scene-poster.webp" alt="" /></picture>
   <div ref={mount} className={`scene-mount ${ready?'ready':''}`} />
  </div>
  <div className="scene-shade" />
  <header className="site-header">
   <a className="wordmark" href="#bamboo" onClick={(e)=>{e.preventDefault();chooseView('walk',returnHome);}} aria-label="竹林里的老屋，回到竹林"><svg className="wordmark-icon" data-icon="bamboo-house" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m2 13 9-6 9 6M5 12v12h12V12M9 24v-7h4v7"/><path d="M24 3v21m-1.5-13h3m-3 7h3M24 8c-3.4 0-5-1.7-5-4 3.1.2 5 1.7 5 4Z"/></svg><span>竹林老屋</span></a>
   <div className="header-aside"><span className="memory-label">一处老屋 · 四时竹声</span>
   <ToggleGroup className="day-switch" value={[timeOfDay]} onValueChange={(values)=>{if(values[0]==='dawn'||values[0]==='day'||values[0]==='noon'||values[0]==='dusk'||values[0]==='night')chooseTime(values[0]);}} aria-label="选择清晨、白天、正午、傍晚或夜晚" disabled={!ready||staticMode}>
    <ToggleGroupItem value="dawn" aria-label="清晨"><Sunrise size={15} strokeWidth={1.5}/><span>清晨</span></ToggleGroupItem>
    <ToggleGroupItem value="day" aria-label="白天"><Sun size={15} strokeWidth={1.5}/><span>白天</span></ToggleGroupItem>
    <ToggleGroupItem value="noon" aria-label="正午"><SunMedium size={15} strokeWidth={1.5}/><span>正午</span></ToggleGroupItem>
    <ToggleGroupItem value="dusk" aria-label="傍晚" title="贴近原照的暖光"><Sunset size={15} strokeWidth={1.5}/><span>傍晚</span></ToggleGroupItem>
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
    <Button className="control-button sound-toggle" onClick={toggleSound} aria-label={soundBusy?'取消载入自然声':soundEnabled?'关闭环境声音':soundError?'重试环境声音':'开启环境声音'} aria-pressed={soundEnabled} disabled={!ready||staticMode}>{soundEnabled?<Volume2 size={16}/>:<VolumeX size={16}/>}<span>{soundBusy?'取消载入':soundEnabled?'正在聆听':soundError?'重试声音':'聆听竹林'}</span></Button>
    {soundEnabled&&<Button ref={soundSettingsButton} variant="ghost" className="sound-settings-toggle" aria-label="调整环境音量" aria-expanded={settingsPanel==='sound'} aria-controls="sound-settings" onClick={()=>setSettingsPanel(settingsPanel==='sound'?null:'sound')}><SlidersHorizontal size={15}/></Button>}
    {settingsPanel==='sound'&&soundEnabled&&<dialog open ref={soundPanel} id="sound-settings" className="settings-panel sound-panel" aria-labelledby="sound-title" onKeyDown={event=>event.stopPropagation()}><div className="settings-heading"><h2 id="sound-title">听得近一点</h2><Button className="settings-close" variant="ghost" aria-label="收起声音设置" onClick={()=>{setSettingsPanel(null);soundSettingsButton.current?.focus({preventScroll:true});}}><X size={15}/></Button></div><p className="settings-description">{listeningCopy}{view==='free'&&inside?' · 隔窗听见':''}</p><label htmlFor="ambience-volume">声音远近 <output>{Math.round(volume*100)}%</output></label><input id="ambience-volume" type="range" min="0" max="100" value={Math.round(volume*100)} onChange={event=>setVolume(Number(event.target.value)/100)} aria-label="环境音量"/><a href="/audio/credits.md" target="_blank" rel="noreferrer">自然录音与来源</a></dialog>}
   </div>
   <div className="render-controls">
    <Button ref={renderButton} className="control-button render-toggle" aria-label="画面设置" title="画面设置" aria-expanded={settingsPanel==='render'} aria-controls="render-settings" disabled={!ready||staticMode} onClick={()=>setSettingsPanel(settingsPanel==='render'?null:'render')}><Monitor size={16}/></Button>
    {settingsPanel==='render'&&<dialog open ref={renderPanel} id="render-settings" className="settings-panel render-panel" aria-labelledby="render-title" onKeyDown={event=>event.stopPropagation()}>
     <div className="settings-heading"><h2 id="render-title">画面设置</h2><Button className="settings-close" variant="ghost" aria-label="收起画面设置" onClick={()=>{setSettingsPanel(null);renderButton.current?.focus({preventScroll:true});}}><X size={15}/></Button></div>
     <p className="settings-description">默认兼顾清晰度与绘制负担，也可随时恢复完整效果。以下选择适用于所有视角、时段与天气，不会自动调整。</p>
     <fieldset className="render-options" aria-describedby="resolution-note"><legend>画面清晰度</legend>
      <Button variant="ghost" aria-pressed={renderSettings.resolution==='full'} onClick={()=>setRenderSettings(value=>({...value,resolution:'full'}))}>完整清晰</Button>
      <Button variant="ghost" aria-pressed={renderSettings.resolution==='balanced'} onClick={()=>setRenderSettings(value=>({...value,resolution:'balanced'}))}>均衡清晰（默认）</Button>
      <Button variant="ghost" aria-pressed={renderSettings.resolution==='reduced'} onClick={()=>setRenderSettings(value=>({...value,resolution:'reduced'}))}>稍柔和</Button>
     </fieldset>
     <p id="resolution-note" className="settings-description">移动端“均衡清晰”提高竹叶和纹理细节；“完整清晰”更锐利，耗电也更高。“稍柔和”保留较低绘制负担。</p>
     <fieldset className="render-options" aria-describedby="frame-rate-note"><legend>画面更新上限</legend>
      <Button variant="ghost" aria-pressed={renderSettings.frameRate==='60'} onClick={()=>setRenderSettings(value=>({...value,frameRate:'60'}))}>60 帧（默认）</Button>
      <Button variant="ghost" aria-pressed={renderSettings.frameRate==='30'} onClick={()=>setRenderSettings(value=>({...value,frameRate:'30'}))}>省电 30 帧</Button>
      <Button variant="ghost" aria-pressed={renderSettings.frameRate==='display'} onClick={()=>setRenderSettings(value=>({...value,frameRate:'display'}))}>跟随屏幕</Button>
     </fieldset>
     <p id="frame-rate-note" className="settings-description">发热时可选“省电 30 帧”，保持清晰度，运动连贯性会降低。“跟随屏幕”允许更高刷新率，耗电更高；这些是上限，不保证达到。</p>
     <fieldset className="render-options" aria-describedby="shadows-note"><legend>日光与月光下的动态阴影</legend>
      <Button variant="ghost" aria-pressed={renderSettings.shadows==='full'} onClick={()=>setRenderSettings(value=>({...value,shadows:'full'}))}>每帧跟随</Button>
      <Button variant="ghost" aria-pressed={renderSettings.shadows==='alternate'} onClick={()=>setRenderSettings(value=>({...value,shadows:'alternate'}))}>隔帧更新（默认）</Button>
     </fieldset>
     <p id="shadows-note" className="settings-description">“隔帧更新”可减轻阴影绘制负担，大风时竹影可能稍显不连贯。</p>
     <Button className="render-reset" variant="ghost" onClick={()=>setRenderSettings({...FULL_RENDER_SETTINGS})}>恢复完整效果</Button>
    </dialog>}
   </div>
   <Button className="control-button" onClick={()=>setPaused(!paused)} aria-label={reduced?'已减少动态':paused?'让风继续':'静止观看'} aria-pressed={paused || reduced} disabled={reduced || staticMode}>
    {paused || reduced ? <Play size={14}/> : <Pause size={14}/>}<span>{reduced?'已减少动态':paused?'让风继续':'静止观看'}</span>
   </Button></div>
  </header>
  {soundError&&settingsPanel!=='weather'&&<output className="sound-message">声音暂未载入，点击声音按钮可重试。</output>}
  {weatherError&&!soundError&&settingsPanel===null&&<output className="sound-message weather-message"><span>雨声暂未载入。</span><Button variant="ghost" onClick={()=>chooseWeather(weather)}>重试雨声</Button></output>}
  {(staticMode || reduced) && <output className="mode-message">{staticMode?'静态观看 · 可沿路阅读': '已减少动态 · 仍可主动环顾和切换昼夜'}</output>}
  {!ready && <div className="loading-panel" role={error?'alert':'status'}><p>{loading.state}</p>{!error?<Progress aria-label="场景加载进度" value={loading.progress}/>:<Button className="control-button" onClick={()=>{setReady(false);setError(false);setStaticMode(false);setLoading({state:"重新走进竹林…",progress:null});setAttempt(attempt+1);}}><RotateCcw size={14}/>重新载入</Button>}</div>}
  {view==='porch'&&<main id="porch" className="porch-story" aria-label="从木廊望向竹林">
   <div className="porch-copy"><p className="chapter-kicker">木廊望竹 / {{dawn:'清晨初醒',day:'日光正好',noon:'暖阳正午',dusk:'原照里的暖光',night:'月色渐深'}[timeOfDay]}</p>
    <h1>{{dawn:<>天刚亮，<br/>风已过竹梢。</>,day:<>风过竹林，<br/>就是家乡。</>,noon:<>日头正暖，<br/>老屋如常。</>,dusk:<>晚光穿过竹叶，<br/>落在旧木上。</>,night:<>灯还亮着，<br/>竹林已入夜。</>}[timeOfDay]}</h1>
    <p>{{dawn:'山色还凉，远处的鸟先醒了。',day:'站在老屋里，听竹叶轻轻响。',noon:'竹影落在木廊上，院坝静静晒着太阳。',dusk:'沿着照片里的光，慢慢想起那一年。',night:'楼下留着一盏灯，竹林里有点点萤光。'}[timeOfDay]}</p>
   </div>
  </main>}
  {view==='moon'&&<main className="porch-story moon-story" aria-label="竹林望月"><div className="porch-copy"><p className="chapter-kicker">竹林望月 / 今夜有风</p><h1>抬头是月亮，<br/>身旁是竹声。</h1><p>沿着小路停一停，让眼睛慢慢习惯月色。</p></div></main>}
  {view==='breeze'&&<main className="porch-story breeze-story" aria-label="林间的风"><div className="porch-copy"><p className="chapter-kicker">林间的风 / {weather.autumn?'秋意渐起':'清风徐来'}</p><h1>{weather.autumn?<>风过竹海，<br/>满身清凉。</>:<>站进竹影里，<br/>让风轻轻经过。</>}</h1><p>{weather.autumn?'竹梢弯下又回转，叶声一阵近、一阵远。':'听叶片轻响，让呼吸慢下来。'}</p></div></main>}
  {view==='well-rain'&&<main className="porch-story well-story" aria-label="井旁听雨"><div className="porch-copy"><p className="chapter-kicker">井旁听雨 / 扫把旁边</p><h1>坐在井旁，<br/>听雨慢慢落下。</h1><p>看雨落在院坝上，竹林就在眼前。</p></div></main>}
  {view==='free'&&<main className="interior-story" aria-label="自由看看">
   <aside id="free-viewpoints" className="room-panel" inert={settingsPanel!==null} aria-label="选择停留位置">
    <div className="room-heading"><Compass size={15} strokeWidth={1.3}/><span>自由看看 · {placeArea}</span></div>
    <Select value={selectedDestination.place} disabled={!ready||staticMode} onValueChange={(value)=>{if(value&&Object.hasOwn(PLACE_VIEWS,value))choosePlace(value as PlaceId);}}>
     <SelectTrigger className="room-selector" aria-label="选择停留位置"><SelectValue>{PLACE_VIEWS[selectedDestination.place].label}</SelectValue></SelectTrigger>
     <SelectContent className="room-options" alignItemWithTrigger={false} onKeyDown={event=>event.stopPropagation()}>
      <SelectGroup><SelectLabel>屋外</SelectLabel>{Object.entries(OUTDOOR_VIEWS).map(([id,item])=><SelectItem key={id} value={id} onClick={()=>choosePlace(id as PlaceId)}>{item.label}</SelectItem>)}</SelectGroup>
      <SelectGroup><SelectLabel>屋内</SelectLabel>{Object.entries(ROOM_VIEWS).map(([id,item])=><SelectItem key={id} value={id} onClick={()=>choosePlace(id as PlaceId)}>{item.label}</SelectItem>)}</SelectGroup>
     </SelectContent>
    </Select>
    <p className="room-note">选个屋内或屋外的位置，拖动看看四周。</p>
    <Button variant="ghost" className="floor-link" disabled={!ready||staticMode} onClick={()=>choosePlace(inside?'courtyard':'upstairs')}>{inside?<Compass size={14}/>:<DoorOpen size={14}/>}<span>{inside?'去屋前':'到厅堂'}</span></Button>
   </aside>
  </main>}
  <main className="narrative" hidden={view!=='walk'} aria-label="竹林老屋的五段记忆">
   {chapters.map((item,index)=><section id={item.id} key={item.id} className={`chapter ${chapter===index?'active':''}`} aria-labelledby={`${item.id}-heading`}>
    <div className="chapter-copy" aria-hidden={chapter!==index}>
     <p className="chapter-kicker">0{index+1} / {item.eyebrow}</p>
     {index===0?<h1 id={`${item.id}-heading`}>{item.title}</h1>:<h2 id={`${item.id}-heading`}>{item.title.split('\n').map((line,i)=><span key={line}>{i>0&&<br/>}{line}</span>)}</h2>}
     {item.copy&&<p>{item.copy}</p>}
     {index===4&&<button className="return-button" onClick={()=>chooseView('walk',returnHome)} tabIndex={chapter===4?0:-1}>回到竹林 <ArrowUpRight size={18} strokeWidth={1.2}/></button>}
    </div>
   </section>)}
  </main>
  {view==='walk'&&!panorama&&<nav className="exploration-nav" aria-label="探索章节">{chapters.map((item,i)=><a key={item.id} href={`#${item.id}`} className="chapter-link" aria-current={chapter===i?'step':undefined} onClick={(e)=>{e.preventDefault();chooseView('walk',()=>navigate(i));}}><span>{item.name}</span><i className="dot"/></a>)}</nav>}
  {panorama&&<div className="panorama-info"><span className="view-bearing"><Scan size={15}/><span ref={bearingLabel}>000°</span></span><span className="panorama-help"><span className="desktop-help">双指滑动或拖动环顾 · 捏合缩放</span><span className="touch-help">拖动环顾 · 双指缩放</span></span><Button className="reset-view" variant="ghost" onClick={()=>engine.current?.reset()} aria-label="复位环顾视角"><RotateCcw size={15}/><span>复位</span></Button></div>}
  <fieldset className="view-toolbar" aria-label="观看方式">
   <div className="view-modes">
    <ToggleGroup className="view-switch" value={[selectedDestination.view]} onValueChange={(values)=>{if(values[0]==='porch'||values[0]==='walk'||values[0]==='free')chooseView(values[0]);}} aria-label="观看模式">
     <ToggleGroupItem value="walk" onClick={()=>chooseView('walk')}>沿路走走</ToggleGroupItem>
     <ToggleGroupItem value="porch" onClick={()=>chooseView('porch')}>廊下望竹</ToggleGroupItem>
     <ToggleGroupItem value="free" onClick={()=>chooseView('free')} className="free-toggle" aria-expanded={view==='free'} aria-controls={view==='free'?'free-viewpoints':undefined} disabled={!ready||staticMode}><Compass size={15}/><span>自由看看</span></ToggleGroupItem>
    </ToggleGroup>
   </div>
   <span className="toolbar-divider"/>
   <div className="view-actions"><Button className="moon-toggle" variant="ghost" aria-pressed={selectedDestination.view==='moon'} disabled={!ready||staticMode} onClick={watchMoon}><Moon size={16}/><span>竹林望月</span></Button>
   <Button className="breeze-toggle" variant="ghost" aria-pressed={selectedDestination.view==='breeze'} disabled={!ready||staticMode} onClick={listenInGrove}><Wind size={16}/><span>林间的风</span></Button>
   <Button className="well-toggle" variant="ghost" aria-pressed={selectedDestination.view==='well-rain'} disabled={!ready||staticMode} onClick={listenByWell}><Droplets size={16}/><span>井旁听雨</span></Button>
   <Button ref={panoramaButton} className="panorama-toggle" variant="ghost" aria-pressed={panorama} disabled={!ready||staticMode} onClick={choosePanorama}>{panorama?<X size={16}/>:<Scan size={16}/>}<span>{panorama?'退出环顾':'360° 环顾'}</span></Button></div>
  </fieldset>
  <footer className="site-footer">
   <div><div className="scroll-hint">{view==='walk'?<ArrowDown size={18} strokeWidth={1.2}/>:<span className="living-dot"/>}<span>{panorama?'换个方向，也是一处风景':view==='well-rain'?'坐在井边，雨声还是小时候的雨声':view==='breeze'?'清风过竹叶，把心放轻一点':view==='moon'?'月光穿过竹梢，风从身旁走过':view==='porch'?'望向竹林，让时间慢一点':chapter===4?'在竹林里，多停留一会儿':'慢慢向下，走进这段记忆'}</span></div><div className="footer-note">{panorama?'方向键环顾 · Home 复位 · Esc 退出':'竹影 · 旧木 · 家乡'}</div></div>
   {view==='walk'&&<div ref={progressLabel} className="footer-progress" aria-label="探索进度 0%"><span>0{chapter+1}</span><span className="progress-track"><i ref={progressBar} style={{transform:'scaleX(.02)'}}/></span><span>05</span></div>}
  </footer>
 </div>;
}
