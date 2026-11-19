import { dirname, join } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// satellite.js's index also exports a WebAssembly build with a top-level
// await, which the workers' bundle can't hold and the app never uses
// (src/physics/sgp4.js). Its package exports only the index, so its files
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

export default defineConfig({
  // '/' locally; the Pages workflow builds for /digital-orrery/ (VITE_BASE).
  base: process.env.VITE_BASE ?? '/',
  plugins: [satelliteLite(), react()],
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
