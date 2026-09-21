/** Opt-in, local-only timings. Rendering timings describe CPU submission, never
 * GPU completion. Numeric boundaries keep concurrent operations independent. */
export type PhaseStatus = 'success' | 'error' | 'cancelled' | 'superseded' | 'skipped';
type PhaseDetail = Record<string, string | number | boolean | null | undefined>;
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
interface Diagnostics {
 version: 1;
 enabled: true;
 phases: Phase[];
 droppedPhases: number;
 activePhases?: ActivePhase[];
 droppedActivePhases?: number;
 /** First successful controls-ready boundary, relative to navigation start. */
 startupReadyAt?: number;
}
declare global { interface Window { __BAMBOO_PERF__?: Diagnostics; } }

const MAX_PHASES = 500;
const MAX_ACTIVE_PHASES = 100;
const noop: FinishPhase = () => {};
let enabled: boolean | undefined;
let operationId = 0;

export function performanceEnabled(): boolean {
 if (typeof window === 'undefined') return false;
 try {
  return enabled ??= new URLSearchParams(window.location.search).get('perf') === '1';
 } catch { return false; }
}

export function phaseStatus(error: unknown): PhaseStatus {
 return error instanceof Error && (error.name === 'AbortError' || error.message === 'SCENE_DISPOSED') ? 'cancelled' : 'error';
}

export function beginPhase(name: string, detail: PhaseDetail = {}): FinishPhase {
 if (!performanceEnabled()) return noop;
 try {
  const startTime = performance.now(), id = ++operationId;
  const entryName = `bamboo:${name}#${id}`;
  const diagnostics = window.__BAMBOO_PERF__ ??= { version: 1, enabled: true, phases: [], droppedPhases: 0 };
  const active = diagnostics.activePhases ??= [];
  active.push({ name: `bamboo:${name}`, entryName, startTime, detail: { ...detail, phase: name, operationId: id } });
  if (active.length > MAX_ACTIVE_PHASES) {
   active.shift();
   diagnostics.droppedActivePhases = (diagnostics.droppedActivePhases ?? 0) + 1;
  }
  let finished = false;
  return (status = 'success', extra = {}) => {
   if (finished) return;
   finished = true;
   // Collection is optional: unsupported timing APIs must not affect the scene.
   try {
    const end = performance.now();
    const activeIndex = active.findIndex(phase => phase.entryName === entryName);
    if (activeIndex !== -1) active.splice(activeIndex, 1);
    const phase: Phase = {
     name: `bamboo:${name}`, entryName, startTime, duration: end - startTime,
     detail: { ...detail, ...extra, phase: name, operationId: id, status },
    };
    diagnostics.phases.push(phase);
    if (name === 'startup.controls-ready' && status === 'success') diagnostics.startupReadyAt ??= end;
    try { performance.measure(entryName, { start: startTime, end, detail: phase.detail }); }
    catch { /* Older browsers still expose the bounded local diagnostics. */ }
    // A unique native entry name removes only the evicted operation. Observers
    // receive each entry when it is made; snapshots expose truncation explicitly.
    if (diagnostics.phases.length > MAX_PHASES) {
     const oldest = diagnostics.phases.shift();
     diagnostics.droppedPhases++;
     if (oldest) performance.clearMeasures(oldest.entryName);
    }
   } catch { /* Monitoring failure must not turn into a product failure. */ }
  };
 } catch { return noop; }
}

export function measurePhase<T>(name: string, run: () => T, detail?: PhaseDetail): T {
 const finish = beginPhase(name, detail);
 try { const result = run(); finish(); return result; }
 catch (error) { finish(phaseStatus(error)); throw error; }
}
