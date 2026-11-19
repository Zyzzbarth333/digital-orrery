// src/scene/dataCheck.ts
//
// At start-up: is the data the app loads actually in public/ (ADR-0001)?
// public/manifest.json (always in git) lists every file by set; one file per
// set is asked for. A missing file comes back as an error, or, from the dev
// server, as the app's own index.html with a 200, so an HTML answer counts
// as missing too. The sets that are missing are returned, for the scene to
// say "run npm run data" instead of failing later with a parse error.

interface Manifest { sets: Record<string, { version: string }>; files: { path: string; set: string }[] }

export async function missingDataSets(base: string): Promise<string[]> {
  let m: Manifest;
  try {
    const r = await fetch(`${base}manifest.json`);
    if (!r.ok || (r.headers.get('content-type') ?? '').includes('text/html')) return [];   // no manifest: nothing to check against
    m = await r.json();
  } catch { return []; }
  const probes = Object.keys(m.sets).map((set) => [set, m.files.find((f) => f.set === set)?.path] as const);
  const missing: string[] = [];
  await Promise.all(probes.map(async ([set, path]) => {
    if (!path) return;
    try {
      const r = await fetch(`${base}${path}`, { method: 'HEAD' });
      if (!r.ok || (r.headers.get('content-type') ?? '').includes('text/html')) missing.push(set);
    } catch { missing.push(set); }
  }));
  return missing.sort();
}
