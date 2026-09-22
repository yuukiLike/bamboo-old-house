#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { run } from '../../tools/scene-perf/cli/run.mjs';

const local = file => fileURLToPath(new URL(file, import.meta.url));

export function runProject(argv = process.argv.slice(2)) {
  return run(argv, {
    usage: 'pnpm perf',
    flow: 'journey',
    instrumentation: 'on',
    adapter: local('./adapters/bamboo.cjs'),
    instrumentationSources: [
      local('../../src/lib/performance.ts'),
      local('../../tools/scene-perf/core/timings.ts'),
    ],
    flows: {
      journey: { scenario: local('./scene-journey.cjs'), adapterId: 'bamboo' },
      system: { scenario: local('./system-journey.cjs'), adapterId: 'bamboo' },
      views: { scenario: local('./view-journey.cjs'), adapterId: 'bamboo' },
    },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runProject().catch(error => {
    console.error(`[scene-perf] ${error.message}`);
    process.exitCode = 1;
  });
}
