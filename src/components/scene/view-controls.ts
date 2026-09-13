import * as T from 'three';

/** Fixed-eye spherical viewing. Horizontal angles have no boundary. */
export class ViewControls {
  active = false;
  yaw = 0;
  pitch = 0;
  zoom = 0;
  dragging = false;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDistance = 0;
  private gestureScale = 0;
  private keys = new Set<string>();
  private removeEvents: () => void;
  private setGestureEvents: (active: boolean) => void;
  private canvas: HTMLCanvasElement;
  private onExit: () => void;

  constructor(canvas: HTMLCanvasElement, onExit: () => void) {
    this.canvas = canvas; this.onExit = onExit;
    const release = (event: PointerEvent) => {
      this.pointers.delete(event.pointerId);
      this.pinchDistance = this.pointerDistance();
      this.dragging = this.pointers.size > 0;
      this.updateCursor();
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    const down = (event: PointerEvent) => {
      if (!this.active || (event.pointerType === 'mouse' && event.button !== 0)) return;
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this.dragging = true;
      this.pinchDistance = this.pointerDistance();
      this.updateCursor();
      canvas.setPointerCapture(event.pointerId);
      canvas.focus({ preventScroll: true });
    };
    const move = (event: PointerEvent) => {
      const previous = this.pointers.get(event.pointerId);
      if (!this.active || !previous) return;
      const dx = event.clientX - previous.x, dy = event.clientY - previous.y;
      previous.x = event.clientX; previous.y = event.clientY;
      if (this.pointers.size === 2) {
        const distance = this.pointerDistance();
        if (this.pinchDistance > 0) this.changeZoom(-(distance - this.pinchDistance) * .12);
        this.pinchDistance = distance;
        return;
      }
      if (this.pointers.size > 2) return;
      // Drag the picture with the pointer, like a native panorama viewer.
      this.rotate(dx * .004, dy * .003);
    };
    const wheel = (event: WheelEvent) => {
      if (!this.active) return;
      event.preventDefault();
      if (this.gestureScale || this.pointers.size > 1) return;
      // macOS supplies accelerated pixel deltas, including its momentum tail.
      // Consume them directly: a second inertia filter makes reversals lag.
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1;
      if (event.ctrlKey || event.metaKey) this.changeZoom(event.deltaY * unit * .2);
      else if (event.deltaMode !== 0) this.changeZoom(event.deltaY * unit * .025);
      else this.rotate(-event.deltaX * .003, -event.deltaY * .003);
    };
    // Safari delivers trackpad magnification as cumulative GestureEvent scale.
    // Touchscreen pinch already belongs to the pointer handlers above.
    const gestureStart = (event: Event) => {
      if (!this.active) return;
      event.preventDefault(); this.gestureScale = 1;
    };
    const gestureChange = (event: Event) => {
      if (!this.active || !this.gestureScale) return;
      event.preventDefault();
      const scale = (event as Event & { scale: number }).scale;
      if (!Number.isFinite(scale) || scale <= 0) return;
      if (this.pointers.size < 2) this.changeZoom(-Math.log(scale / this.gestureScale) * 35);
      this.gestureScale = scale;
    };
    const gestureEnd = (event: Event) => {
      if (this.active && this.gestureScale) event.preventDefault();
      this.gestureScale = 0;
    };
    const keyboard = (event: KeyboardEvent) => {
      if (!this.active) return;
      if (event.key === 'Escape') { this.onExit(); return; }
      if (document.activeElement !== canvas) return;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault(); this.keys.add(event.key);
      }
      if (event.key === 'Home') { event.preventDefault(); this.reset(); }
      if (event.key === '+' || event.key === '=') this.zoom = Math.max(-25, this.zoom - 3);
      if (event.key === '-') this.zoom = Math.min(15, this.zoom + 3);
    };
    const keyup = (event: KeyboardEvent) => this.keys.delete(event.key);
    const blur = () => this.cancelInput();
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) canvas.addEventListener(name, release);
    let listening = false;
    this.setGestureEvents = active => {
      if (listening === active) return;
      listening = active;
      // Even a handler that immediately returns forces the compositor to wait
      // if it is non-passive. Walking must have no blocking wheel listener.
      if (active) {
        canvas.addEventListener('wheel', wheel, { passive: false });
        canvas.addEventListener('gesturestart', gestureStart, { passive: false });
        canvas.addEventListener('gesturechange', gestureChange, { passive: false });
        canvas.addEventListener('gestureend', gestureEnd);
      } else {
        canvas.removeEventListener('wheel', wheel);
        canvas.removeEventListener('gesturestart', gestureStart);
        canvas.removeEventListener('gesturechange', gestureChange);
        canvas.removeEventListener('gestureend', gestureEnd);
      }
    };
    canvas.addEventListener('blur', blur);
    window.addEventListener('keydown', keyboard);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    this.removeEvents = () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) canvas.removeEventListener(name, release);
      this.setGestureEvents(false);
      canvas.removeEventListener('blur', blur);
      window.removeEventListener('keydown', keyboard);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
    };
  }

  private pointerDistance() {
    if (this.pointers.size !== 2) return 0;
    const values = this.pointers.values(), a = values.next().value!, b = values.next().value!;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private changeZoom(delta: number) { this.zoom = T.MathUtils.clamp(this.zoom + delta, -25, 15); }
  private updateCursor() { this.canvas.style.cursor = this.active ? (this.dragging ? 'grabbing' : 'grab') : ''; }

  rotate(yaw: number, pitch: number) {
    this.yaw += yaw;
    this.pitch = T.MathUtils.clamp(this.pitch + pitch, -Math.PI * .42, Math.PI * .42);
  }

  setActive(active: boolean) {
    this.active = active;
    this.setGestureEvents(active);
    this.reset();
    this.canvas.style.touchAction = active ? 'none' : 'pan-y';
    this.canvas.style.cursor = active ? 'grab' : '';
    this.canvas.tabIndex = active ? 0 : -1;
    this.canvas.setAttribute('aria-label', '360 度老屋与竹林视角，双指滑动或拖动环顾，捏合缩放，方向键环顾，加减号缩放，Home 复位，Escape 退出');
    if (active) this.canvas.focus({ preventScroll: true });
  }

  reset() {
    this.yaw = this.pitch = this.zoom = 0;
    this.cancelInput();
  }

  cancelInput() {
    for (const id of this.pointers.keys()) if (this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
    this.dragging = false;
    this.pointers.clear(); this.keys.clear(); this.pinchDistance = 0; this.gestureScale = 0;
    this.updateCursor();
  }

  update(delta: number) {
    if (!this.active) return;
    const horizontal = Number(this.keys.has('ArrowLeft')) - Number(this.keys.has('ArrowRight'));
    const vertical = Number(this.keys.has('ArrowUp')) - Number(this.keys.has('ArrowDown'));
    this.rotate(horizontal * delta * .8, vertical * delta * .65);
  }

  apply(position: T.Vector3, target: T.Vector3) {
    const x = target.x - position.x, y = target.y - position.y, z = target.z - position.z;
    const distance = Math.max(.1, Math.hypot(x, y, z));
    const yaw = Math.atan2(x, z) + this.yaw;
    const pitch = T.MathUtils.clamp(Math.asin(y / distance) + this.pitch, -Math.PI * .46, Math.PI * .46);
    target.set(position.x + Math.sin(yaw) * Math.cos(pitch) * distance,
      position.y + Math.sin(pitch) * distance, position.z + Math.cos(yaw) * Math.cos(pitch) * distance);
  }

  get bearing() { return ((T.MathUtils.radToDeg(this.yaw) % 360) + 360) % 360; }
  dispose() { this.cancelInput(); this.removeEvents(); }
}
