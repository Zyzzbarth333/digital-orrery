import { dirname, join } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// satellite.js's index also exports a WebAssembly build with a top-level
// await, which the workers' bundle can't hold and the app never uses
// (packages/physics/src/sgp4.js). Its package exports only the index, so its files
// can't be imported by subpath: this resolves the package as usual (from
// any checkout) and serves 'satellite.js' as the two files the app uses.
function satelliteLite() {
  const ID = '\0satellite-lite';
  let dist = null;
  return {
    name: 'satellite-lite',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (source !== 'satellite.js') return null;
      const r = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!r) return null;
      dist = dirname(r.id);
      return ID;
    },
    load(id) {
      if (id !== ID) return null;
      return `export { json2satrec } from ${JSON.stringify(join(dist, 'io.js'))};\nexport { sgp4 } from ${JSON.stringify(join(dist, 'propagation', 'sgp4.js'))};\n`;
    },
  };
}

// main.tsx waits for the DE442 tables (3 MB) before it imports the app, so
// that nothing caches an astronomy-engine position for the Earth or the
// Moon first. That kept the app's own code (0.9 MB) from being asked for
// until the tables were in: on fast 4G the first frame came a second
// later. A modulepreload link fetches the app's chunks alongside the
// tables without running them (docs/performance.md#loading).
function preloadApp() {
  let base = '/';
  return {
    name: 'preload-app',
    apply: 'build',
    configResolved(c) { base = c.base; },
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const bundle = ctx.bundle ?? {};
        const chunks = Object.values(bundle).filter((c) => c.type === 'chunk');
        const app = chunks.find((c) => c.facadeModuleId?.endsWith('/src/app/App.tsx'));
        if (!app) return [];
        const entry = new Set(chunks.filter((c) => c.isEntry).flatMap((c) => [c.fileName, ...c.imports]));
        const files = new Set();
        const walk = (name) => {
          if (files.has(name) || entry.has(name)) return;
          files.add(name);
          for (const i of bundle[name]?.imports ?? []) walk(i);
        };
        walk(app.fileName);
        return [...files].map((f) => ({ tag: 'link', attrs: { rel: 'modulepreload', crossorigin: true, href: `${base}${f}` }, injectTo: 'head' }));
      },
    },
  };
}

export default defineConfig({
  // '/' locally; the Pages workflow builds for /digital-orrery/ (VITE_BASE).
  base: process.env.VITE_BASE ?? '/',
  plugins: [satelliteLite(), react(), preloadApp()],
  worker: { plugins: () => [satelliteLite()] },
  optimizeDeps: { exclude: ['satellite.js'] },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    hmr: { clientPort: 5173 },
  },
  resolve: { dedupe: ['three'] },
});
