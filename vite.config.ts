import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';

export default defineConfig(({ isPreview }) => {
  // Preview must serve the exported files without framework middleware.
  if (isPreview) {
    return {
      build: { outDir: 'dist/client' },
      preview: { host: '127.0.0.1', port: 4175 },
    };
  }

  return {
    // Performance recordings can resolve production call stacks without
    // changing the regular release build or the scene's loading behavior.
    build: { sourcemap: process.env.PERF_SOURCEMAP === '1' },
    css: { postcss: { plugins: [tailwindcss()] } },
    plugins: [vinext(), sites()],
  };
});
