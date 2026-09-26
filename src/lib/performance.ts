/** Bamboo-specific opt-in and compatibility bridge for the detachable recorder. */
import { createPhaseRecorder, type Diagnostics, type FinishPhase, type PhaseDetail, type PhaseStatus } from '../../tools/scene-perf/core/timings.ts';
export type { ActivePhase, Diagnostics, FinishPhase, Phase, PhaseDetail, PhaseStatus } from '../../tools/scene-perf/core/timings.ts';

declare global { interface Window { __BAMBOO_PERF__?: Diagnostics; } }

let enabled: boolean | undefined;
let stopped = false;
export function phaseStatus(error: unknown): PhaseStatus {
 return error instanceof Error && (error.name === 'AbortError' || error.message === 'SCENE_DISPOSED') ? 'cancelled' : 'error';
}
export const bambooTimings = createPhaseRecorder({
 namespace: 'bamboo',
 enabled: () => {
  if (typeof window === 'undefined') return false;
  return enabled ??= new URLSearchParams(window.location.search).get('perf') === '1';
 },
 readyPhase: 'startup.controls-ready',
 classifyError: phaseStatus,
});

export const performanceEnabled = () => bambooTimings.enabled();
/** The explicit stop also disables the scene's compatibility diagnostics. */
export const performanceCollectionStopped = () => stopped;
export function stopPerformanceCollection() {
 stopped = true;
 bambooTimings.stop();
}
export function beginPhase(name: string, detail?: PhaseDetail): FinishPhase {
 const finish = bambooTimings.beginPhase(name, detail);
 const data = bambooTimings.read();
 try { if (data && typeof window !== 'undefined') window.__BAMBOO_PERF__ = data; }
 catch { /* A diagnostic bridge must not affect the scene. */ }
 return finish;
}
/** Synchronous timing, retaining the original return value and thrown error. */
export function measurePhase<T>(name: string, run: () => T, detail?: PhaseDetail): T {
 const finish = beginPhase(name, detail);
 try { const result = run(); finish(); return result; }
 catch (error) { finish(phaseStatus(error)); throw error; }
}
