// validation/browser/shims/fs.mjs: node:fs for the browser gate (gate.mjs).
//
// The validations read their fixtures and public/'s data synchronously,
// as Node's fs does, so each read here is a synchronous XMLHttpRequest
// to the gate's server, in a worker (where a binary one is allowed).
// Paths are URLs (new URL(..., import.meta.url)); a file that isn't there
// is ENOENT, as in Node.

/** Node's Buffer, as far as the validations use it. */
class ShimBuffer extends Uint8Array {
  toString(encoding = 'utf8') { return new TextDecoder(encoding === 'utf8' ? 'utf-8' : encoding).decode(this); }
}

function get(path, method = 'GET') {
  const x = new XMLHttpRequest();
  x.open(method, String(path), false);
  if (method === 'GET') x.responseType = 'arraybuffer';
  x.send();
  return x;
}

function enoent(path) {
  const err = new Error(`ENOENT: no such file or directory, open '${path}'`);
  err.code = 'ENOENT';
  return err;
}

export function existsSync(path) {
  return get(path, 'HEAD').status === 200;
}

export function readFileSync(path, options) {
  const x = get(path);
  if (x.status !== 200) throw enoent(path);
  const buf = new ShimBuffer(x.response);
  const encoding = typeof options === 'string' ? options : options?.encoding;
  return encoding ? buf.toString(encoding) : buf;
}

// Nothing the gate runs writes; a validation that tries says so.
const nowhere = (name) => () => { throw new Error(`fs.${name}: the browser gate writes no files`); };
export const writeFileSync = nowhere('writeFileSync');
export const mkdirSync = nowhere('mkdirSync');

export default { existsSync, readFileSync, writeFileSync, mkdirSync };
