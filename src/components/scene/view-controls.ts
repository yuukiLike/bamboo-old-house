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
  private keys = new Set<string>();
  private removeEvents: () => void;
  private canvas: HTMLCanvasElement;
  private onExit: () => void;

  constructor(canvas: HTMLCanvasElement, onExit: () => void) {
    this.canvas = canvas; this.onExit = onExit;
    const release = (event: PointerEvent) => {
      this.pointers.delete(event.pointerId);
      this.pinchDistance = 0;
      this.dragging = this.pointers.size > 0;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    const down = (event: PointerEvent) => {
      if (!this.active || (event.pointerType === 'mouse' && event.button !== 0)) return;
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this.dragging = true;
      canvas.setPointerCapture(event.pointerId);
      canvas.focus({ preventScroll: true });
    };
    const move = (event: PointerEvent) => {
      const previous = this.pointers.get(event.pointerId);
      if (!this.active || !previous) return;
      const dx = event.clientX - previous.x, dy = event.clientY - previous.y;
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinchDistance > 0) this.zoom = T.MathUtils.clamp(this.zoom - (distance - this.pinchDistance) * .12, -25, 15);
        this.pinchDistance = distance;
        return;
      }
      this.rotate(-dx * .004, dy * .003);
    };
    const wheel = (event: WheelEvent) => {
      if (!this.active) return;
      event.preventDefault();
      this.zoom = T.MathUtils.clamp(this.zoom + event.deltaY * .025, -25, 15);
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
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('blur', blur);
    window.addEventListener('keydown', keyboard);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    this.removeEvents = () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) canvas.removeEventListener(name, release);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('blur', blur);
      window.removeEventListener('keydown', keyboard);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
    };
  }

  rotate(yaw: number, pitch: number) {
    this.yaw += yaw;
    this.pitch = T.MathUtils.clamp(this.pitch + pitch, -Math.PI * .42, Math.PI * .42);
  }

  setActive(active: boolean) {
    this.active = active;
    this.reset();
    this.canvas.style.touchAction = active ? 'none' : 'pan-y';
    this.canvas.style.cursor = active ? 'grab' : '';
    this.canvas.tabIndex = active ? 0 : -1;
    this.canvas.setAttribute('aria-label', '360 度老屋与竹林视角，方向键环顾，Home 复位，Escape 退出');
    if (active) this.canvas.focus({ preventScroll: true });
  }

  reset() {
    this.yaw = this.pitch = this.zoom = 0;
    this.cancelInput();
  }

  cancelInput() {
    for (const id of this.pointers.keys()) if (this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
    this.dragging = false;
    this.pointers.clear(); this.keys.clear(); this.pinchDistance = 0;
  }

  update(delta: number) {
    if (!this.active) return;
    const horizontal = Number(this.keys.has('ArrowLeft')) - Number(this.keys.has('ArrowRight'));
    const vertical = Number(this.keys.has('ArrowUp')) - Number(this.keys.has('ArrowDown'));
    this.rotate(horizontal * delta * .8, vertical * delta * .65);
    this.canvas.style.cursor = this.dragging ? 'grabbing' : 'grab';
  }

  apply(position: T.Vector3, target: T.Vector3) {
    const direction = target.clone().sub(position);
    const distance = Math.max(.1, direction.length());
    const yaw = Math.atan2(direction.x, direction.z) + this.yaw;
    const pitch = T.MathUtils.clamp(Math.asin(direction.y / distance) + this.pitch, -Math.PI * .46, Math.PI * .46);
    target.set(position.x + Math.sin(yaw) * Math.cos(pitch) * distance,
      position.y + Math.sin(pitch) * distance, position.z + Math.cos(yaw) * Math.cos(pitch) * distance);
  }

  get bearing() { return ((T.MathUtils.radToDeg(this.yaw) % 360) + 360) % 360; }
  dispose() { this.cancelInput(); this.removeEvents(); }
}
