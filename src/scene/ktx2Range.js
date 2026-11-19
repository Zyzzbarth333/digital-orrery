// @ts-check
// src/scene/ktx2Range.js
//
// A KTX2 file's small mip levels as a KTX2 file of their own, so a map's
// 2048-wide preview can be shown from the first few per cent of its bytes
// (docs/frontend/textures.md#loading). A KTX2 file stores its levels
// smallest first: the header, the level index, the format descriptor, the
// key/values and the Basis codebooks, then level n-1, n-2, ... 0. The first
// bytes up to the end of level k therefore hold every level from k down,
// fetched with one byte range. Each level is compressed on its own (UASTC
// with Zstandard, or ETC1S against the shared codebooks), so they
// transcode without the larger ones.
//
//   ktx2Layout(head)      the header and level index, from the first bytes
//   previewLevel(layout)  the first level at most PREVIEW_WIDTH wide, or 0
//   previewFile(bytes, layout, k)   levels k.. as a valid KTX2 file
//
// The preview's header gives level k's size as the base size, its index
// lists levels k.. only, and for ETC1S (BasisLZ) its codebooks' image
// descriptors drop levels 0..k-1. Everything else is copied, the levels
// byte for byte at the same alignment.

/** The width a preview is cut at: 2048 x 1024, 1/16 of an 8k map's texels. */
export const PREVIEW_WIDTH = 2048;

/** Bytes that always hold the header and level index (80 + 24 a level). */
export const HEAD_BYTES = 4096;

/**
 * @typedef {object} Ktx2Layout
 * @property {number} width
 * @property {number} height
 * @property {number} levelCount
 * @property {number} layers     layerCount, 0 for one image
 * @property {number} faces
 * @property {number} scheme     supercompression: 0 none, 1 BasisLZ (ETC1S), 2 Zstandard
 * @property {{ offset: number, length: number, uncompressed: number }[]} levels  level 0 first
 * @property {[number, number]} dfd   offset, length
 * @property {[number, number]} kvd
 * @property {[number, number]} sgd
 */

const ID = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a];

/** @param {Uint8Array} b @returns {Ktx2Layout} */
export function ktx2Layout(b) {
  if (b.length < 80 || ID.some((x, i) => b[i] !== x)) throw new Error('not a KTX 2.0 file');
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u32 = (/** @type {number} */ o) => v.getUint32(o, true);
  const u64 = (/** @type {number} */ o) => Number(v.getBigUint64(o, true));
  const levelCount = Math.max(1, u32(40));
  if (b.length < 80 + 24 * levelCount) throw new Error('KTX2 level index past the bytes given');
  const levels = [];
  for (let i = 0; i < levelCount; i++) levels.push({ offset: u64(80 + 24 * i), length: u64(88 + 24 * i), uncompressed: u64(96 + 24 * i) });
  return {
    width: u32(20), height: u32(24), levelCount, layers: u32(32), faces: u32(36), scheme: u32(44), levels,
    dfd: [u32(48), u32(52)], kvd: [u32(56), u32(60)], sgd: [u64(64), u64(72)],
  };
}

/**
 * The level to cut a preview at: the first at most PREVIEW_WIDTH wide, or
 * 0 when the map is no larger (nothing to gain) or not a plain 2D map.
 * @param {Ktx2Layout} L @param {number} [width]
 */
export function previewLevel(L, width = PREVIEW_WIDTH) {
  if (L.layers > 1 || L.faces !== 1 || L.scheme === 0) return 0;
  const k = L.levels.findIndex((_, i) => Math.max(1, L.width >> i) <= width);
  return k > 0 ? k : 0;
}

/** The bytes up to the end of level k: every level from k down. @param {Ktx2Layout} L @param {number} k */
export function prefixBytes(L, k) {
  return Math.max(...L.levels.slice(k).map((l) => l.offset + l.length));
}

/**
 * Levels k.. of a KTX2 file, given at least its first prefixBytes(L, k)
 * bytes, as a KTX2 file.
 * @param {Uint8Array} b @param {Ktx2Layout} L @param {number} k
 * @returns {ArrayBuffer}
 */
export function previewFile(b, L, k) {
  const keep = L.levels.slice(k);
  const m = keep.length;
  const dataStart = Math.min(...keep.map((l) => l.offset)), dataEnd = prefixBytes(L, k);
  if (b.length < dataEnd) throw new Error('KTX2 preview past the bytes given');
  // The codebooks: for ETC1S, a 20-byte head, then one 20-byte image
  // descriptor a level (one layer, one face), level 0 first, then the tables.
  let sgd = b.subarray(L.sgd[0], L.sgd[0] + L.sgd[1]);
  if (L.scheme === 1 && sgd.length) {
    const head = sgd.subarray(0, 20), rest = sgd.subarray(20 + 20 * L.levelCount);
    const descs = sgd.subarray(20 + 20 * k, 20 + 20 * L.levelCount);
    const out = new Uint8Array(20 + descs.length + rest.length);
    out.set(head, 0); out.set(descs, 20); out.set(rest, 20 + descs.length);
    sgd = out;
  }
  const dfd = b.subarray(L.dfd[0], L.dfd[0] + L.dfd[1]);
  const kvd = b.subarray(L.kvd[0], L.kvd[0] + L.kvd[1]);
  const dfdOff = 80 + 24 * m;
  const kvdOff = dfdOff + dfd.length;
  const sgdOff = sgd.length ? Math.ceil((kvdOff + kvd.length) / 8) * 8 : 0;
  const afterSgd = sgd.length ? sgdOff + sgd.length : kvdOff + kvd.length;
  // The levels at the same offset modulo 16 as in the file, so every
  // level keeps its alignment.
  const levelsOff = afterSgd + ((dataStart - afterSgd) % 16 + 16) % 16;
  const shift = levelsOff - dataStart;
  const out = new Uint8Array(levelsOff + (dataEnd - dataStart));
  out.set(b.subarray(0, 80), 0);
  const v = new DataView(out.buffer);
  v.setUint32(20, Math.max(1, L.width >> k), true);
  v.setUint32(24, L.height ? Math.max(1, L.height >> k) : 0, true);
  v.setUint32(40, m, true);
  v.setUint32(48, dfdOff, true); v.setUint32(52, dfd.length, true);
  v.setUint32(56, kvd.length ? kvdOff : 0, true); v.setUint32(60, kvd.length, true);
  v.setBigUint64(64, BigInt(sgdOff), true); v.setBigUint64(72, BigInt(sgd.length), true);
  keep.forEach((l, i) => {
    v.setBigUint64(80 + 24 * i, BigInt(l.offset + shift), true);
    v.setBigUint64(88 + 24 * i, BigInt(l.length), true);
    v.setBigUint64(96 + 24 * i, BigInt(l.uncompressed), true);
  });
  out.set(dfd, dfdOff);
  out.set(kvd, kvdOff);
  if (sgd.length) out.set(sgd, sgdOff);
  out.set(b.subarray(dataStart, dataEnd), levelsOff);
  return out.buffer;
}
