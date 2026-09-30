/** Opt-in, local timings. Rendering spans describe CPU submission, never GPU completion. */
export type PhaseStatus = 'success' | 'error' | 'cancelled' | 'superseded' | 'skipped';
export type PhaseDetail = Record<string, string | number | boolean | null | undefined>;
export type FinishPhase = (status?: PhaseStatus, detail?: PhaseDetail) => void;
export interface Phase {
 name: string;
 startTime: number;
 duration: number;
 detail: PhaseDetail & { phase: string; operationId: number; status: PhaseStatus };
 entryName: string;
}
export interface ActivePhase {
 name: string;
 entryName: string;
 startTime: number;
 detail: PhaseDetail & { phase: string; operationId: number };
}
export interface Diagnostics {
 version: 1;
 enabled: boolean;
 phases: Phase[];
 droppedPhases: number;
 activePhases?: ActivePhase[];
 droppedActivePhases?: number;
 /** First successful readyPhase boundary, relative to navigation start. */
 startupReadyAt?: number;
}
export interface PhaseRecorderOptions {
 namespace: string;
 enabled: boolean | (() => boolean);
 readyPhase?: string;
 classifyError?: (error: unknown) => PhaseStatus;
}
export interface PhaseRecorder {
 enabled(): boolean;
 beginPhase(name: string, detail?: PhaseDetail): FinishPhase;
 /** Measures synchronous work only; returned promises are not awaited. */
 measurePhase<T>(name: string, run: () => T, detail?: PhaseDetail): T;
 /** The owned live store, or the final frozen store after stop(). */
 read(): Diagnostics | null;
 /** Preserve exportable history and discard unfinished spans. */
 stop(): void;
 /** Discard history and start a fresh collection. Disposal remains terminal. */
 restart(): void;
 dispose(): void;
}

const MAX_PHASES = 500;
const MAX_ACTIVE_PHASES = 100;
const noop: FinishPhase = () => {};
// Unique names let separate recorder instances use the same namespace safely.
let nextOperationId = 0;

export function createPhaseRecorder(options: PhaseRecorderOptions): PhaseRecorder {
 let disposed = false;
 let stopped = false;
 let generation = 0;
 let diagnostics: Diagnostics | null = null;

 function enabled(): boolean {
  if (disposed || stopped) return false;
  try { return typeof options.enabled === 'function' ? options.enabled() : options.enabled; }
  catch { return false; }
 }
 function beginPhase(name: string, detail: PhaseDetail = {}): FinishPhase {
  if (!enabled()) return noop;
  try {
   const startTime = performance.now(), id = ++nextOperationId, startedGeneration = generation;
   const entryName = `${options.namespace}:${name}#${id}`;
   const data = diagnostics ??= { version: 1, enabled: true, phases: [], droppedPhases: 0 };
   const active = data.activePhases ??= [];
   active.push({ name: `${options.namespace}:${name}`, entryName, startTime, detail: { ...detail, phase: name, operationId: id } });
   if (active.length > MAX_ACTIVE_PHASES) {
    active.shift();
    data.droppedActivePhases = (data.droppedActivePhases ?? 0) + 1;
   }
   let finished = false;
   return (status = 'success', extra = {}) => {
    if (finished || disposed || stopped || startedGeneration !== generation) return;
    finished = true;
    // Monitoring must never turn a completed operation into a product failure.
    try {
     const end = performance.now();
     const activeIndex = active.findIndex(phase => phase.entryName === entryName);
     if (activeIndex !== -1) active.splice(activeIndex, 1);
     const phase: Phase = {
      name: `${options.namespace}:${name}`, entryName, startTime, duration: end - startTime,
      detail: { ...detail, ...extra, phase: name, operationId: id, status },
     };
     data.phases.push(phase);
     if (name === options.readyPhase && status === 'success') data.startupReadyAt ??= end;
     try { performance.measure(entryName, { start: startTime, end, detail: phase.detail }); }
     catch { /* Older browsers still expose the bounded local store. */ }
     if (data.phases.length > MAX_PHASES) {
      const oldest = data.phases.shift();
      data.droppedPhases++;
      if (oldest) performance.clearMeasures(oldest.entryName);
     }
    } catch { /* Collection is optional. */ }
   };
  } catch { return noop; }
 }
 return {
  enabled,
  beginPhase,
  measurePhase<T>(name: string, run: () => T, detail?: PhaseDetail): T {
   const finish = beginPhase(name, detail);
   try { const result = run(); finish(); return result; }
   catch (error) {
    let status: PhaseStatus = error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'error';
    try { status = options.classifyError?.(error) ?? status; } catch { /* Preserve the original error. */ }
    finish(status);
    throw error;
   }
  },
  read() {
   if (disposed) return null;
   if (stopped) return diagnostics;
   if (!enabled()) return null;
   return diagnostics ??= { version: 1, enabled: true, phases: [], droppedPhases: 0 };
  },
  stop() {
   if (disposed || stopped) return;
   stopped = true;
   generation++;
   if (!diagnostics) return;
   diagnostics.enabled = false;
   if (diagnostics.activePhases) diagnostics.activePhases.length = 0;
   for (const phase of diagnostics.phases) {
    try { performance.clearMeasures(phase.entryName); } catch { /* Leave unrelated recorders alone. */ }
   }
  },
  restart() {
   if (disposed) return;
   generation++;
   for (const phase of diagnostics?.phases ?? []) {
    try { performance.clearMeasures(phase.entryName); } catch { /* Only clear owned entries. */ }
   }
   diagnostics = null;
   stopped = false;
  },
  dispose() {
   if (disposed) return;
   disposed = true;
   if (!diagnostics) return;
   for (const phase of diagnostics.phases) {
    try { performance.clearMeasures(phase.entryName); } catch { /* Continue clearing other owned entries. */ }
   }
   diagnostics.phases.length = 0;
   if (diagnostics.activePhases) diagnostics.activePhases.length = 0;
   diagnostics.droppedPhases = 0;
   diagnostics.droppedActivePhases = 0;
   delete diagnostics.startupReadyAt;
   diagnostics = null;
  },
 };
}
