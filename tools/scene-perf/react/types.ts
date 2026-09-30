import type { ActivePhase, Phase } from '../core/timings';
import type { RuntimeAdapter, RuntimeCollector, RuntimeState } from '../core/runtime';

/** Keep this object stable while a panel is mounted. Project labels and state
 * access belong here; the collector and panel do not depend on scene internals. */
export interface PerformanceAdapter extends RuntimeAdapter {
 id: string;
 phaseLabels?: Record<string, string>;
 startupPhase?: string;
 readyLabel?: string;
 formatPhaseDetail?: (phase: Phase | ActivePhase) => string;
 describeState?: (state: RuntimeState) => string;
 rendererDescription?: string;
 /** Stop host-owned markers/diagnostics too; retained data may still be read. */
 stopCollection?: () => void;
 /** Clear host history and reopen collection without remounting the scene. */
 restartCollection?: () => void;
 /** Optional host integration. Return a disposer for any host-owned binding. */
 onCollector?: (collector: RuntimeCollector) => void | (() => void);
}
