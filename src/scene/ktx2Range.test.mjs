// src/scene/ktx2Range.test.mjs: a map's preview, cut from the first bytes
// of its KTX2 file (ktx2Range.js), transcodes to exactly the levels the
// whole file gives, for UASTC (Zstandard) and ETC1S (BasisLZ) maps.
// Run: node src/scene/ktx2Range.test.mjs
//
// Each file is cut at its preview level from no more bytes than the
// preview needs, then the preview and the whole file are transcoded to BC7
// with three.js's Basis transcoder, and every level of the preview must
// equal the whole file's level of the same size, byte for byte. Needs the
// maps (npm run data).

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { HEAD_BYTES, ktx2Layout, prefixBytes, previewFile, previewLevel } from './ktx2Range.js';

const ROOT = new URL('../../public/textures/', import.meta.url);
const BASIS_DIR = fileURLToPath(new URL('../../node_modules/three/examples/jsm/libs/basis/', import.meta.url));
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`ok ${n} ${name}`); };

if (!existsSync(new URL('manifest.json', ROOT))) {
  console.log('ok 0 # SKIP no maps (npm run data)');
  process.exit(0);
}

// The transcoder is an Emscripten script that expects require and __dirname.
const src = readFileSync(`${BASIS_DIR}basis_transcoder.js`, 'utf8');
const BASIS = new Function('require', '__dirname', `${src}\nreturn BASIS;`)(createRequire(import.meta.url), BASIS_DIR);
const M = await BASIS({ wasmBinary: readFileSync(`${BASIS_DIR}basis_transcoder.wasm`) });
M.initializeBasis();
const BC7 = M.transcoder_texture_format.cTFBC7_RGBA.value;

// Levels from..levelCount-1 of a KTX2 file, transcoded to BC7.
function transcode(bytes, from = 0) {
  const f = new M.KTX2File(new Uint8Array(bytes));
  try {
    assert.ok(f.isValid(), 'the transcoder takes the file');
    assert.ok(f.startTranscoding(), 'transcoding starts');
    const out = [];
    for (let level = from; level < f.getLevels(); level++) {
      const info = f.getImageLevelInfo(level, 0, 0);
      const dst = new Uint8Array(f.getImageTranscodedSizeInBytes(level, 0, 0, BC7));
      assert.ok(f.transcodeImage(dst, level, 0, 0, BC7, 0, -1, -1), `level ${level} transcodes`);
      out.push({ width: info.origWidth, height: info.origHeight, data: dst });
    }
    return out;
  } finally {
    f.close();
    f.delete();
  }
}

// Every KTX2 the manifest lists that is cut for a preview, by scheme.
const manifest = JSON.parse(readFileSync(new URL('manifest.json', ROOT), 'utf8'));
const files = [...new Set(Object.values(manifest.ktx2 ?? {}))].filter((p) => !p.includes('/milky-way-16k/'));
const cut = files.map((p) => {
  const b = readFileSync(new URL(p, ROOT));
  const L = ktx2Layout(b.subarray(0, HEAD_BYTES));
  return { p, b, L, k: previewLevel(L) };
}).filter((f) => f.k > 0);
// The smallest few of each scheme, so the test stays quick.
const pick = [1, 2].flatMap((s) => cut.filter((f) => f.L.scheme === s).sort((a, b) => a.b.length - b.b.length).slice(0, 3));

ok('the maps cut for a preview include UASTC and ETC1S ones', () => {
  assert.ok(pick.some((f) => f.L.scheme === 1) && pick.some((f) => f.L.scheme === 2), pick.map((f) => f.p).join(', '));
});

ok('the header and level index fit in the first bytes asked for', () => {
  for (const f of files) {
    const L = ktx2Layout(readFileSync(new URL(f, ROOT)).subarray(0, HEAD_BYTES));
    assert.ok(80 + 24 * L.levelCount <= HEAD_BYTES, f);
  }
});

for (const { p, b, L, k } of pick) {
  ok(`${p}: the preview is levels ${k}.. from the first ${(prefixBytes(L, k) / 1e6).toFixed(2)} of ${(b.length / 1e6).toFixed(1)} MB`, () => {
    const pre = previewFile(b.subarray(0, prefixBytes(L, k)), L, k);
    const P = ktx2Layout(new Uint8Array(pre));
    assert.equal(P.levelCount, L.levelCount - k);
    assert.equal(P.width, Math.max(1, L.width >> k));
    assert.ok(P.width <= 2048);
    const got = transcode(pre), want = transcode(b, k);
    assert.equal(got.length, want.length);
    got.forEach((g, i) => {
      assert.equal(g.width, want[i].width, `level ${i} width`);
      assert.equal(g.height, want[i].height, `level ${i} height`);
      assert.ok(Buffer.from(g.data).equals(Buffer.from(want[i].data)), `level ${i} (${g.width} x ${g.height}) differs`);
    });
  });
}

ok('a map no wider than the preview is not cut', () => {
  const small = files.map((p) => ktx2Layout(readFileSync(new URL(p, ROOT)).subarray(0, HEAD_BYTES))).find((L) => L.width <= 2048);
  assert.ok(small);
  assert.equal(previewLevel(small), 0);
});
