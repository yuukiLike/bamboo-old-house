'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export function useImmersiveView() {
 const [active,setActive]=useState(false);
 const requested=useRef(false);
 const nativeTarget=useRef<HTMLElement|null>(null);
 const trigger=useRef<HTMLElement|null>(null);
 const leaveNative=useCallback(()=>{
  const target=nativeTarget.current;
  nativeTarget.current=null;
  if(target&&document.fullscreenElement===target){
   void document.exitFullscreen().catch(()=>{ /* The browser may already be exiting. */ });
  }
 },[]);
 const exit=useCallback(()=>{requested.current=false;setActive(false);leaveNative();},[leaveNative]);
 const enter=useCallback((opener:HTMLElement)=>{
  trigger.current=opener;requested.current=true;setActive(true);
  const target=document.documentElement;
  if(document.fullscreenElement||!document.fullscreenEnabled||!target.requestFullscreen)return;
  nativeTarget.current=target;
  void target.requestFullscreen().then(()=>{
   // Escape or unmount can happen before the native request completes.
   if(!requested.current&&document.fullscreenElement===target){
    void document.exitFullscreen().catch(()=>{ /* The browser may already be exiting. */ });
   }
  }).catch(()=>{
   nativeTarget.current=null;
   // Keep the UI-free view when the browser does not allow native fullscreen.
  });
 },[]);
 useEffect(()=>{
  const change=()=>{if(requested.current&&!document.fullscreenElement)exit();};
  document.addEventListener('fullscreenchange',change);
  return()=>{requested.current=false;document.removeEventListener('fullscreenchange',change);leaveNative();};
 },[exit,leaveNative]);
 useEffect(()=>{
  if(!active){trigger.current?.focus({preventScroll:true});trigger.current=null;return;}
  let touch:{id:number;x:number;y:number;time:number}|undefined;
  let lastTap:{x:number;y:number;time:number}|undefined;
  const cancel=()=>{touch=undefined;lastTap=undefined;};
  const down=(event:PointerEvent)=>{
   if(event.pointerType!=='touch')return;
   if(!event.isPrimary){cancel();return;}
   touch={id:event.pointerId,x:event.clientX,y:event.clientY,time:event.timeStamp};
  };
  const move=(event:PointerEvent)=>{
   if(touch?.id===event.pointerId&&Math.hypot(event.clientX-touch.x,event.clientY-touch.y)>12)cancel();
  };
  const up=(event:PointerEvent)=>{
   if(touch?.id!==event.pointerId)return;
   const start=touch;touch=undefined;
   if(event.timeStamp-start.time>300){lastTap=undefined;return;}
   if(lastTap&&event.timeStamp-lastTap.time<400&&Math.hypot(event.clientX-lastTap.x,event.clientY-lastTap.y)<24){
    event.preventDefault();exit();return;
   }
   lastTap={x:event.clientX,y:event.clientY,time:event.timeStamp};
  };
  const keydown=(event:KeyboardEvent)=>{
   if(event.key!=='Escape')return;
   event.preventDefault();event.stopImmediatePropagation();exit();
  };
  const doubleClick=()=>exit();
  window.addEventListener('keydown',keydown,true);
  window.addEventListener('dblclick',doubleClick);
  window.addEventListener('pointerdown',down,{passive:true});
  window.addEventListener('pointermove',move,{passive:true});
  window.addEventListener('pointerup',up);
  window.addEventListener('pointercancel',cancel);
  return()=>{
   window.removeEventListener('keydown',keydown,true);window.removeEventListener('dblclick',doubleClick);
   window.removeEventListener('pointerdown',down);window.removeEventListener('pointermove',move);
   window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',cancel);
  };
 },[active,exit]);
 return {active,enter,exit};
}
