'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUpRight, Pause, Play, Sprout, RotateCcw, Sun, SunMedium, Moon, Scan, X, DoorOpen, ArrowUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import type { SceneHandle } from './scene/scene';
import { ROOM_VIEWS, DETAIL_VIEWS, type DetailId, type RoomId, type TimeOfDay, type ViewMode } from './scene/config';

const chapters = [
 { id:'bamboo', name:'竹林', eyebrow:'一段水边的记忆', title:'竹林里的老屋', copy:'我曾走过这里。' },
 { id:'approach', name:'靠近', eyebrow:'竹影之间', title:'穿过竹影，\n老屋就在眼前。', copy:'' },
 { id:'courtyard', name:'屋前', eyebrow:'屋檐之下', title:'光落在旧木上。', copy:'' },
 { id:'earth-wall', name:'墙边', eyebrow:'岁月的纹理', title:'一面土墙，\n几根旧木。', copy:'' },
 { id:'return', name:'回望', eyebrow:'再听一会儿风', title:'把这一刻，\n留在这里。', copy:'' },
];

export default function Experience() {
 const mount = useRef<HTMLDivElement>(null);
 const engine = useRef<SceneHandle | null>(null);
 const [chapter, setChapter] = useState(0);
 const [progress, setProgress] = useState(0);
 const [paused, setPaused] = useState(false);
 const [reduced, setReduced] = useState(false);
 const [loading, setLoading] = useState<{state:string; progress:number | null}>({state:'正在走进竹林…',progress:null});
 const [ready,setReady] = useState(false);
 const [error,setError] = useState(false);
 const [staticMode,setStaticMode] = useState(false);
 const [attempt,setAttempt] = useState(0);
 const [view,setView] = useState<ViewMode>('porch');
 const [room,setRoom] = useState<RoomId>('upstairs');
 const [detail,setDetail] = useState<DetailId>('wall');
 const [timeOfDay,setTimeOfDay] = useState<TimeOfDay>('noon');
 const [panorama,setPanorama] = useState(false);
 const [bearing,setBearing] = useState(0);
 const panoramaButton = useRef<HTMLButtonElement>(null);
 useEffect(() => {
   const media=matchMedia('(prefers-reduced-motion: reduce)');
   const change=()=>setReduced(media.matches); change(); media.addEventListener('change',change);
   const scroll=()=>{const p=Math.min(1,Math.max(0,window.scrollY/Math.max(1,document.documentElement.scrollHeight-innerHeight))); setProgress(p); setChapter(Math.min(4,Math.floor(p*4+.5)));};
   scroll(); window.addEventListener('scroll',scroll,{passive:true}); window.addEventListener('resize',scroll);
   return ()=>{media.removeEventListener('change',change);window.removeEventListener('scroll',scroll);window.removeEventListener('resize',scroll);};
 },[]);
 useEffect(()=>{ let disposed=false;const controller=new AbortController();
   const start=async()=>{ try {
     const { createScene } = await import('./scene/scene');
     if(disposed || !mount.current)return;
     const scene=await createScene(mount.current,{onProgress:(state,value)=>{if(!disposed)setLoading({state,progress:value});},onPanorama:(value)=>{if(!disposed){setPanorama(value);if(!value)panoramaButton.current?.focus({preventScroll:true});}},onBearing:(value)=>{if(!disposed)setBearing(value);},onFailure:()=>{if(!disposed){setReady(false);setError(true);setStaticMode(true);setPanorama(false);setLoading({state:"实时画面已暂停，可重新载入。",progress:null});}}},controller.signal);
     if(disposed){scene.dispose();return;}
     engine.current=scene; setReady(true);setLoading({state:'',progress:100});
   } catch(e){ if(!disposed){console.error('Scene failed:',e);setError(true);setStaticMode(true);setLoading({state:e instanceof Error && e.message==='WEBGL_UNAVAILABLE'?'此设备使用静态观看模式。':'竹林暂时没有载入，仍可继续阅读。',progress:null});} } };
   void start();
   return ()=>{disposed=true;controller.abort();engine.current?.dispose();engine.current=null;};
 },[attempt]);
 useEffect(()=>{engine.current?.setPaused(paused || reduced);},[paused,reduced,ready]);
 useEffect(()=>{engine.current?.setView(view);},[view,ready]);
 useEffect(()=>{engine.current?.setRoom(room);},[room,ready]);
 useEffect(()=>{engine.current?.setDetail(detail);},[detail,ready]);
 useEffect(()=>{engine.current?.setTimeOfDay(timeOfDay);},[timeOfDay,ready]);
 useEffect(()=>{engine.current?.setPanorama(panorama);},[panorama,ready]);
 useEffect(()=>{
   const previous=document.body.style.overflow;
   if(view!=='walk'||panorama)document.body.style.overflow='hidden';
   return()=>{document.body.style.overflow=previous;};
 },[view,panorama]);
 const chooseView=(next:ViewMode)=>{setPanorama(next==='interior'||next==='detail');setView(next);engine.current?.setView(next);};
 const downstairs=room==='hall'||room==='kitchen';
 const chooseRoom=(next:RoomId)=>{setRoom(next);setPanorama(true);engine.current?.setRoom(next);engine.current?.setPanorama(true);};
 const returnHome=useCallback(()=>{engine.current?.reset();window.scrollTo({top:0,behavior:reduced?'instant':'smooth'});setChapter(0);},[reduced]);
 const navigate=(index:number)=>{window.scrollTo({top:(document.documentElement.scrollHeight-innerHeight)*index/4,behavior:reduced?'instant':'smooth'});};
 return <div className={`experience is-${view} ${panorama?'is-panorama':''} ${staticMode?'is-static':''}`} data-time={timeOfDay}>
  <a className="skip-link" href="#return" onClick={(e)=>{e.preventDefault();chooseView('walk');requestAnimationFrame(()=>navigate(4));}}>跳到结束</a>
  <div className="scene-shell" aria-hidden={!panorama}>
   <picture><source media="(max-width:700px)" srcSet="/scene-poster-mobile.webp"/><img className="fallback-view" src="/scene-poster.webp" alt="" /></picture>
   <div ref={mount} className={`scene-mount ${ready?'ready':''}`} style={{transition:progress>0?'none':undefined}} />
  </div>
  <div className="scene-shade" />
  <header className="site-header">
   <a className="wordmark" href="#porch" onClick={(e)=>{e.preventDefault();chooseView('porch');engine.current?.reset();}} aria-label="竹林里的老屋，回到木廊"><span className="wordmark-icon"><Sprout size={17} strokeWidth={1.2}/></span><span>竹林里的老屋</span></a>
   <div className="header-aside"><span className="memory-label">一处老屋 · 四时竹声</span>
   <ToggleGroup className="day-switch" value={[timeOfDay]} onValueChange={(values)=>{if(values[0]==='day'||values[0]==='noon'||values[0]==='night')setTimeOfDay(values[0]);}} aria-label="选择白天、正午或夜晚" disabled={!ready||staticMode}>
    <ToggleGroupItem value="day" aria-label="白天"><Sun size={15} strokeWidth={1.5}/><span>白天</span></ToggleGroupItem>
    <ToggleGroupItem value="noon" aria-label="正午"><SunMedium size={15} strokeWidth={1.5}/><span>正午</span></ToggleGroupItem>
    <ToggleGroupItem value="night" aria-label="夜晚"><Moon size={15} strokeWidth={1.5}/><span>夜晚</span></ToggleGroupItem>
   </ToggleGroup>
   <Button className="control-button" onClick={()=>setPaused(!paused)} aria-label={reduced?'已减少动态':paused?'让风继续':'静止观看'} aria-pressed={paused || reduced} disabled={reduced || staticMode}>
    {paused || reduced ? <Play size={14}/> : <Pause size={14}/>}<span>{reduced?'已减少动态':paused?'让风继续':'静止观看'}</span>
   </Button></div>
  </header>
  {(staticMode || reduced) && <output className="mode-message">{staticMode?'静态观看 · 可沿路阅读': '已减少动态 · 仍可主动环顾和切换昼夜'}</output>}
  {!ready && <div className="loading-panel" role={error?'alert':'status'}><p>{loading.state}</p>{!error?<Progress aria-label="场景加载进度" value={loading.progress}/>:<Button className="control-button" onClick={()=>{setReady(false);setError(false);setStaticMode(false);setLoading({state:"重新走进竹林…",progress:null});setAttempt(attempt+1);}}><RotateCcw size={14}/>重新载入</Button>}</div>}
  {view==='porch'&&<main id="porch" className="porch-story" aria-label="从木廊望向竹林">
   <div className="porch-copy"><p className="chapter-kicker">木廊望竹 / {{day:'日光正好',noon:'暖阳正午',night:'月色渐深'}[timeOfDay]}</p>
    <h1>{timeOfDay==='night'?<>灯还亮着，<br/>竹林已入夜。</>:timeOfDay==='noon'?<>日头正暖，<br/>老屋如常。</>:<>风过竹林，<br/>就是家乡。</>}</h1>
    <p>{{day:'站在老屋里，听竹叶轻轻响。',noon:'竹影落在木廊上，院坝静静晒着太阳。',night:'楼下留着一盏灯，竹林里有点点萤光。'}[timeOfDay]}</p>
   </div>
  </main>}
  {view==='interior'&&<main className="interior-story" aria-label="老屋内部环顾">
   <aside className="room-panel" aria-label="选择屋内位置">
    <div className="room-heading"><DoorOpen size={15} strokeWidth={1.3}/><span>{room==='kitchen'?'一楼 · 旧厨房':room==='hall'?'一楼 · 老屋堂屋':'二层 · 木廊与住屋'}</span></div>
    <Select value={room} disabled={!ready||staticMode} onValueChange={(value)=>{if(value&&value in ROOM_VIEWS)chooseRoom(value as RoomId);}}>
     <SelectTrigger className="room-selector" aria-label="选择房间"><SelectValue>{ROOM_VIEWS[room].label}</SelectValue></SelectTrigger>
     <SelectContent className="room-options" alignItemWithTrigger={false}>{(Object.keys(ROOM_VIEWS) as RoomId[]).map(id=><SelectItem key={id} value={id}>{ROOM_VIEWS[id].label}</SelectItem>)}</SelectContent>
    </Select>
    {room==='upstairs'&&<p className="room-note">木梯接着厅堂，后面的宽门厅通向仓库和两间住屋。</p>}
    <Button variant="ghost" className="floor-link" disabled={!ready||staticMode} onClick={()=>chooseRoom(downstairs?'upstairs':'hall')}>{downstairs?<ArrowUp size={14}/>:<ArrowDown size={14}/>}<span>{downstairs?'回到二楼':'去一楼堂屋'}</span></Button>
   </aside>
  </main>}
  {view==='detail'&&<main className="interior-story" aria-label="近看老屋与坡地">
   <aside className="room-panel detail-panel" aria-label="选择近看位置">
    <div className="room-heading"><Scan size={15}/><span>走近看看</span></div>
    <Select value={detail} onValueChange={value=>{if(value&&value in DETAIL_VIEWS){setDetail(value as DetailId);setPanorama(true);engine.current?.setDetail(value as DetailId);}}}>
     <SelectTrigger className="room-selector" aria-label="选择近看位置"><SelectValue>{DETAIL_VIEWS[detail].label}</SelectValue></SelectTrigger>
     <SelectContent className="room-options" alignItemWithTrigger={false}>{(Object.keys(DETAIL_VIEWS) as DetailId[]).map(id=><SelectItem key={id} value={id}>{DETAIL_VIEWS[id].label}</SelectItem>)}</SelectContent>
    </Select>
    <p className="room-note">{DETAIL_VIEWS[detail].note}</p>
    <Button variant="ghost" className="floor-link" onClick={()=>chooseView('walk')}><ArrowUpRight size={14}/><span>回到来时的路</span></Button>
   </aside>
  </main>}
  <main className="narrative" hidden={view!=='walk'} aria-label="竹林老屋的五段记忆">
   {chapters.map((item,index)=><section id={item.id} key={item.id} className={`chapter ${chapter===index?'active':''}`} aria-labelledby={`${item.id}-heading`}>
    <div className="chapter-copy" aria-hidden={chapter!==index}>
     <p className="chapter-kicker">0{index+1} / {item.eyebrow}</p>
     {index===0?<h1 id={`${item.id}-heading`}>{item.title}</h1>:<h2 id={`${item.id}-heading`}>{item.title.split('\n').map((line,i)=><span key={line}>{i>0&&<br/>}{line}</span>)}</h2>}
     {item.copy&&<p>{item.copy}</p>}
     {index===4&&<button className="return-button" onClick={returnHome} tabIndex={chapter===4?0:-1}>回到竹林 <ArrowUpRight size={18} strokeWidth={1.2}/></button>}
    </div>
   </section>)}
  </main>
  {view==='walk'&&!panorama&&<nav className="exploration-nav" aria-label="探索章节">{chapters.map((item,i)=><a key={item.id} href={`#${item.id}`} className="chapter-link" aria-current={chapter===i?'step':undefined} onClick={(e)=>{e.preventDefault();navigate(i);}}><span>{item.name}</span><i className="dot"/></a>)}</nav>}
  {panorama&&<div className="panorama-info"><span className="view-bearing"><Scan size={15}/>{String(bearing).padStart(3,'0')}°</span><span>拖动环顾 · 滚轮或双指缩放</span><Button className="reset-view" variant="ghost" onClick={()=>engine.current?.reset()} aria-label="复位环顾视角"><RotateCcw size={15}/><span>复位</span></Button></div>}
  <fieldset className="view-toolbar" aria-label="观看方式">
   <ToggleGroup className="view-switch" value={[view]} onValueChange={(values)=>{if(values[0]==='porch'||values[0]==='walk'||values[0]==='interior'||values[0]==='detail')chooseView(values[0]);}} aria-label="选择观察位置">
    <ToggleGroupItem value="porch">廊下望竹</ToggleGroupItem>
    <ToggleGroupItem value="interior" disabled={!ready||staticMode}>进屋看看</ToggleGroupItem>
    <ToggleGroupItem value="walk">沿路走走</ToggleGroupItem>
    <ToggleGroupItem value="detail" disabled={!ready||staticMode}>走近看看</ToggleGroupItem>
   </ToggleGroup>
   <span className="toolbar-divider"/>
   <Button ref={panoramaButton} className="panorama-toggle" variant="ghost" aria-pressed={panorama} disabled={!ready||staticMode} onClick={()=>setPanorama(!panorama)}>{panorama?<X size={16}/>:<Scan size={16}/>}<span>{panorama?'退出环顾':'360° 环顾'}</span></Button>
  </fieldset>
  <footer className="site-footer">
   <div><div className="scroll-hint">{view==='walk'?<ArrowDown size={18} strokeWidth={1.2}/>:<span className="living-dot"/>}<span>{panorama?'换个方向，也是一处风景':view==='porch'?'望向竹林，让时间慢一点':chapter===4?'在竹林里，多停留一会儿':'慢慢向下，走进这段记忆'}</span></div><div className="footer-note">{panorama?'方向键环顾 · Home 复位 · Esc 退出':'竹影 · 旧木 · 家乡'}</div></div>
   {view==='walk'&&<div className="footer-progress" aria-label={`探索进度 ${Math.round(progress*100)}%`}><span>0{chapter+1}</span><span className="progress-track"><i style={{transform:`scaleX(${Math.max(.02,progress)})`}}/></span><span>05</span></div>}
  </footer>
 </div>;
}
