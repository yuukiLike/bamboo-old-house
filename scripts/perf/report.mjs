import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runReport } from '../../tools/scene-perf/cli/report.mjs';

export { generateReport, runReport } from '../../tools/scene-perf/cli/report.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runReport().catch(error => { console.error(error.message); process.exitCode = 1; });
}
