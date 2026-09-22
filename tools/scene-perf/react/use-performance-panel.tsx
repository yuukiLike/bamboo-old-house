'use client';

import { useEffect, useState, type ComponentType, type ReactElement } from 'react';
import type { PerformanceAdapter } from './types';

export type { PerformanceAdapter } from './types';

interface LoadedPanel {
 adapter: PerformanceAdapter;
 Component: ComponentType<{ adapter: PerformanceAdapter }>;
}

function enabledAtStartup() {
 if (typeof window === 'undefined') return false;
 const params = new URLSearchParams(window.location.search);
 return params.get('perf') === '1' && params.get('perfUI') === '1';
}

/** Lazy, opt-in UI. False unmounts the collector; enabling again starts a new
 * runtime window. Early business timings are owned by the host's recorder. */
export function usePerformancePanel(adapter: PerformanceAdapter, options: { enabled?: boolean } = {}): ReactElement | null {
 const [startupEnabled] = useState(enabledAtStartup);
 const enabled = options.enabled ?? startupEnabled;
 const [loaded, setLoaded] = useState<LoadedPanel | null>(null);

 useEffect(() => {
  if (!enabled) return;
  let active = true;
  import('./performance-panel').then(module => {
   if (active) setLoaded({ adapter, Component: module.default });
  }).catch(() => { /* Diagnostics must never prevent the host from rendering. */ });
  return () => { active = false; };
 }, [adapter, enabled]);

 // A new adapter never renders with the old collector, even while the lazy
 // import is pending. The module (and its CSS) is absent from normal pages.
 if (!enabled || loaded?.adapter !== adapter) return null;
 return <loaded.Component adapter={adapter} />;
}
