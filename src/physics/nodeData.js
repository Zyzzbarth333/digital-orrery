// src/physics/nodeData.js
//
// The physics' loader under Node (dataLoad.js): each path read from the
// data root on disk, at once. A file that is not there throws an error
// marked `missing`, which says to run npm run data.

import { existsSync, readFileSync } from 'node:fs';

/** @param {URL} root the data root, ending in a slash @returns {import('./dataLoad.js').DataLoader} */
export function fsLoader(root) {
  const read = (path, what, encoding) => {
    const url = new URL(path, root);
    if (!existsSync(url)) {
      const err = new Error(`${what ? `${what}: ` : ''}${url.pathname} is missing (run npm run data)`);
      err.missing = true;
      throw err;
    }
    return readFileSync(url, encoding);
  };
  return {
    buffer: (path, what) => {
      const b = read(path, what);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    },
    json: (path, what) => JSON.parse(read(path, what, 'utf8')),
    text: (path, what) => read(path, what, 'utf8'),
  };
}

// This repository's public/, where npm run data puts the files.
export const nodeLoader = fsLoader(new URL('../../public/', import.meta.url));
