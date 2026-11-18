// src/scene/ktx2.test.mjs: the KTX2 maps (python/textures/build_ktx2.py)
// match the WebP maps they stand in for, so the app can load either.
// Run: node src/scene/ktx2.test.mjs
//
// Each KTX2 listed in public/textures/manifest.json must:
// - be a KTX 2.0 file with Basis Universal data (ETC1S/BasisLZ or UASTC),
//   which is what the app's transcoder takes;
// - be the WebP's size, a multiple of 4 each way (whole 4 x 4 blocks);
// - carry the full mip chain (the sky tiles: one level, as they are used);
// - be sRGB for colour maps and linear for normal maps, as the WebP is
//   uploaded (SRGB8_ALPHA8 or RGBA8);
// - store rows from the south (KTXorientation "ru"), as the WebP is flipped
//   when it is decoded, so the shaders see the same layout.
// Reads headers only, in well under a second.

import assert from 'node:assert/strict';
import { openSync, readSync, closeSync, existsSync, readFileSync } from 'node:fs';

const ROOT = new URL('../../public/textures/', import.meta.url);
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`ok ${n} ${name}`); };

function head(path, bytes = 65536) {
  const fd = openSync(new URL(path, ROOT), 'r');
  const b = Buffer.alloc(bytes);
  const got = readSync(fd, b, 0, bytes, 0);
  closeSync(fd);
  return b.subarray(0, got);
}

// Width and height from a WebP's first chunk (lossy, lossless or extended).
function webpSize(path) {
  const b = head(path, 64);
  assert.equal(b.toString('latin1', 0, 4), 'RIFF');
  assert.equal(b.toString('latin1', 8, 12), 'WEBP');
  const chunk = b.toString('latin1', 12, 16);
  if (chunk === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  if (chunk === 'VP8L') {
    const v = b.readUInt32LE(21);
    return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1];
  }
  if (chunk === 'VP8X') return [b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1];
  throw new Error(`${path}: unknown WebP chunk ${chunk}`);
}

const KTX2_ID = Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
const MODEL = { 163: 'etc1s', 166: 'uastc' };      // KHR_DF_MODEL_ETC1S, KHR_DF_MODEL_UASTC
const TRANSFER = { 1: 'linear', 2: 'srgb' };

function ktx2(path) {
  const b = head(path);
  assert.ok(b.subarray(0, 12).equals(KTX2_ID), `${path}: not a KTX 2.0 file`);
  const u32 = (o) => b.readUInt32LE(o);
  const dfd = u32(48);
  const info = {
    vkFormat: u32(12), width: u32(20), height: u32(24), levels: u32(40), supercompression: u32(44),
    model: MODEL[b[dfd + 12]], transfer: TRANSFER[b[dfd + 14]], kv: {},
  };
  const kvOff = u32(56), kvLen = u32(60);
  for (let i = kvOff; i + 4 <= kvOff + kvLen;) {
    const size = u32(i);
    const s = b.subarray(i + 4, i + 4 + size);
    const z = s.indexOf(0);
    info.kv[s.toString('latin1', 0, z)] = s.toString('latin1', z + 1).replace(/\0+$/, '');
    i += 4 + size + ((4 - (size % 4)) % 4);
  }
  return info;
}

const manifest = JSON.parse(readFileSync(new URL('manifest.json', ROOT), 'utf8'));
const maps = Object.entries(manifest.ktx2 ?? {});
const detail = manifest.stars?.detail;
const tiles = [];
if (detail?.tilesKtx2) {
  for (let r = 0; r < detail.width / 2 / detail.tile; r++)
    for (let c = 0; c < detail.width / detail.tile; c++)
      tiles.push([detail.tiles, detail.tilesKtx2].map((p) => p.replace('{row}', r).replace('{col}', c)));
}

function check(webp, k, { mips, normal }) {
  assert.ok(existsSync(new URL(k, ROOT)), `${k} is missing`);
  const [w, h] = webpSize(webp);
  const x = ktx2(k);
  assert.equal(x.vkFormat, 0, `${k}: Basis data has no Vulkan format`);
  assert.ok(x.model, `${k}: neither ETC1S nor UASTC`);
  assert.equal(x.supercompression, x.model === 'etc1s' ? 1 : 2, `${k}: ETC1S is BasisLZ, UASTC Zstandard`);
  assert.deepEqual([x.width, x.height], [w, h], `${k}: ${x.width}x${x.height}, the WebP is ${w}x${h}`);
  assert.ok(w % 4 === 0 && h % 4 === 0, `${k}: not whole 4x4 blocks`);
  assert.equal(x.levels, mips ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1, `${k}: mip levels`);
  assert.equal(x.transfer, normal ? 'linear' : 'srgb', `${k}: transfer function`);
  assert.equal(x.kv.KTXorientation, 'ru', `${k}: rows must run from the south`);
  if (normal) assert.equal(x.model, 'uastc', `${k}: normal maps are UASTC`);
  return x.model;
}

ok(`every map listed has a KTX2 that matches its WebP (${maps.length} maps)`, () => {
  assert.ok(maps.length > 0, 'manifest.ktx2 is empty: run npm run build:textures');
  const count = { etc1s: 0, uastc: 0 };
  for (const [webp, k] of maps) count[check(webp, k, { mips: true, normal: /normal\.webp$/.test(webp) })]++;
  console.log(`   ${count.etc1s} ETC1S, ${count.uastc} UASTC`);
});

// Every body's map has a KTX2. The sky (the 8k Milky Way, its preview and
// its 16k tiles) ships as WebP only, so its download stays small; built
// with build_ktx2.py --sky, its files are checked below as well.
ok(`every body's map is listed`, () => {
  const want = [];
  for (const e of Object.values(manifest.bodies)) {
    want.push(...(e.dayMonthly ?? []));
    for (const key of ['day', 'night', 'normal']) if (e[key]) want.push(e[key]);
  }
  const listed = new Set(maps.map(([w]) => w));
  assert.deepEqual(want.filter((p) => !listed.has(p)), []);
});

ok(`the sky's 16k tiles, if they have KTX2s, are all there, in one codec for the texture array (${tiles.length} tiles)`, () => {
  if (!tiles.length) return;          // the sky ships as WebP only
  assert.equal(tiles.length, (detail.width / detail.tile) * (detail.width / 2 / detail.tile));
  const models = new Set(tiles.map(([webp, k]) => check(webp, k, { mips: false, normal: false })));
  assert.equal(models.size, 1, `tiles mix ${[...models]}`);
});

console.log(`${n} checks passed`);
