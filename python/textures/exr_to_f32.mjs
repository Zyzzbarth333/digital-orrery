// Decode an OpenEXR image with three.js's EXRLoader and write raw float32
// RGB (row 0 at the top) plus its size, for build_textures.py to read.
// Usage: node python/textures/exr_to_f32.mjs <in.exr> <out.f32>
import fs from 'node:fs';
import * as THREE from 'three';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';

const [, , input, output] = process.argv;
const buf = fs.readFileSync(input);
const loader = new EXRLoader();
loader.setDataType(THREE.FloatType);
const tex = loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const { width, height, data } = tex;
const ch = data.length / (width * height);
const rgb = new Float32Array(width * height * 3);
// EXRLoader returns rows bottom-up; write them top-down.
for (let y = 0; y < height; y++) {
  const src = (height - 1 - y) * width, dst = y * width;
  for (let x = 0; x < width; x++) {
    for (let c = 0; c < 3; c++) rgb[3 * (dst + x) + c] = data[ch * (src + x) + c];
  }
}
fs.writeFileSync(output, Buffer.from(rgb.buffer));
fs.writeFileSync(`${output}.json`, JSON.stringify({ width, height }));
console.log(`decoded ${input}: ${width}x${height}, ${ch} channels`);
