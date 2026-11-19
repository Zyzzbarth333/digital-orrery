// scripts/lib/netshape.mjs
//
// A slow network for load benchmarks (scripts/bench-load.mjs), and a local
// HTTPS server for a build that answers as GitHub Pages does.
//
// - shaper(profile): an HTTP proxy for the browser (--proxy-server). HTTPS
//   goes through it as CONNECT tunnels, and every tunnel shares one link:
//   each direction is served round robin across the tunnels at the
//   profile's rate, then held for half the round trip. A tunnel stops
//   being read while its share is queued, so a big file cannot fill the
//   link ahead of a small one asked for later. The page's requests and
//   its workers' all go through it, whoever makes them.
// - staticServer(dir, { cache }): HTTP/2 over TLS with a self-signed key
//   (the browser is given its hash, spki), with byte ranges, ETags, gzip
//   where Pages uses it, and Cache-Control as Pages sends it (max-age=600)
//   or as a CDN with immutable data would (cache: 'immutable').

import { execFileSync } from 'node:child_process';
import { createHash, createPublicKey } from 'node:crypto';
import { createReadStream, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import http from 'node:http';
import http2 from 'node:http2';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import zlib from 'node:zlib';

// Download and upload in bits per second, round trip in ms.
// fast4g: Chrome DevTools' "Fast 4G" preset (9 Mbit/s and 1.5 Mbit/s at 90 %,
// 60 ms x 2.75), cable: an NBN 50 service (50 / 20 Mbit/s), 20 ms.
export const PROFILES = {
  fast4g: { down: 9e6 * 0.9, up: 1.5e6 * 0.9, rttMs: 165 },
  cable: { down: 50e6, up: 20e6, rttMs: 20 },
  none: null,
};

// One direction of the link: chunks from many tunnels, sent round robin
// at `bps`, each written `delayMs` after it has gone out.
function link(bps, delayMs) {
  const queues = [];           // { q: Buffer[], bytes, out, src, ended }
  let busy = false;
  // An ended source's queue is closed once its last chunk has gone out
  // (timers of the same delay fire in the order they were set).
  const finish = (s) => {
    const i = queues.indexOf(s);
    if (i >= 0) queues.splice(i, 1);
    setTimeout(() => { if (!s.out.destroyed) s.out.end(); }, delayMs);
  };
  const pump = () => {
    if (busy) return;
    const s = queues.find((x) => x.q.length);
    if (!s) return;
    queues.push(queues.splice(queues.indexOf(s), 1)[0]);   // to the back: round robin
    const chunk = s.q.shift();
    s.bytes -= chunk.length;
    s.inflight = true;
    if (s.bytes < 32 * 1024 && !s.ended) s.src.resume();
    busy = true;
    setTimeout(() => {
      busy = false;
      s.inflight = false;
      setTimeout(() => { if (!s.out.destroyed) s.out.write(chunk); }, delayMs);
      if (s.ended && !s.q.length) finish(s);
      pump();
    }, (chunk.length * 8 * 1000) / bps);
  };
  return {
    // src's data goes to out through the link.
    attach(src, out) {
      const s = { q: [], bytes: 0, out, src, ended: false, inflight: false };
      queues.push(s);
      src.on('data', (d) => {
        // At most 16 KiB a turn, so the round robin is fine-grained.
        for (let i = 0; i < d.length; i += 16384) s.q.push(d.subarray(i, i + 16384));
        s.bytes += d.length;
        if (s.bytes > 128 * 1024) src.pause();
        pump();
      });
      const end = () => { if (s.ended) return; s.ended = true; if (!s.q.length && !s.inflight) finish(s); };
      src.on('end', end);
      src.on('close', end);
    },
  };
}

// The proxy, on a free loopback port: { port, bytesDown, close() }.
export async function shaper(profile) {
  const p = PROFILES[profile] ?? profile;
  const down = p && link(p.down, p.rttMs / 2), up = p && link(p.up, p.rttMs / 2);
  const stats = { bytesDown: 0 };
  const server = http.createServer((_req, res) => { res.writeHead(405); res.end('CONNECT only'); });
  server.on('connect', (req, client, head) => {
    const [host, port] = req.url.split(':');
    const target = net.connect(Number(port) || 443, host, () => {
      const open = () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head?.length) target.write(head);
        target.on('data', (d) => { stats.bytesDown += d.length; });
        if (p) { down.attach(target, client); up.attach(client, target); }
        else { target.pipe(client); client.pipe(target); }
      };
      // The tunnel's own set-up costs a round trip, as a TCP connection does.
      p ? setTimeout(open, p.rttMs) : open();
    });
    const fail = () => { client.destroy(); target.destroy(); };
    target.on('error', fail);
    client.on('error', fail);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const sockets = new Set();
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  return {
    port: server.address().port,
    stats,
    close: () => new Promise((ok) => { for (const s of sockets) s.destroy(); server.close(() => ok()); }),
  };
}

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.ktx2': 'image/ktx2', '.wasm': 'application/wasm', '.bin': 'application/octet-stream',
  '.glb': 'model/gltf-binary', '.woff2': 'font/woff2', '.txt': 'text/plain',
};
// Compressed as Pages does (its maps, models and fonts are not).
const GZIP = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.bin', '.csv', '.wasm']);

// A build served over HTTP/2 at https://127.0.0.1:<port>/: { url, close() }.
export async function staticServer(dir, { cache = 'pages' } = {}) {
  const keyDir = mkdtempSync(join(tmpdir(), 'orrery-tls-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1',
    '-keyout', join(keyDir, 'k.pem'), '-out', join(keyDir, 'c.pem')], { stdio: 'ignore' });
  const key = readFileSync(join(keyDir, 'k.pem')), cert = readFileSync(join(keyDir, 'c.pem'));
  rmSync(keyDir, { recursive: true, force: true });
  // The key's SPKI hash, for --ignore-certificate-errors-spki-list: with
  // the blunter --ignore-certificate-errors the browser caches nothing.
  const spki = createHash('sha256').update(createPublicKey(key).export({ type: 'spki', format: 'der' })).digest('base64');
  const server = http2.createSecureServer({ key, cert, allowHTTP1: true }, (req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'https://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(dir, path));
    let st;
    try { st = statSync(file); if (!st.isFile()) throw new Error(); } catch { res.writeHead(404); res.end(); return; }
    const ext = extname(file);
    const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    const head = {
      'content-type': TYPES[ext] ?? 'application/octet-stream', etag, 'accept-ranges': 'bytes',
      'cache-control': cache === 'immutable' && !/\.html$|\/manifest\.json$/.test(path) ? 'public, max-age=31536000, immutable' : 'max-age=600',
      'access-control-allow-origin': '*',
    };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, head); res.end(); return; }
    const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
      if (start > end || start >= st.size) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); res.end(); return; }
      res.writeHead(206, { ...head, 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 });
      createReadStream(file, { start, end }).pipe(res);
      return;
    }
    if (GZIP.has(ext) && /gzip/.test(req.headers['accept-encoding'] ?? '')) {
      res.writeHead(200, { ...head, 'content-encoding': 'gzip' });
      createReadStream(file).pipe(zlib.createGzip()).pipe(res);
      return;
    }
    res.writeHead(200, { ...head, 'content-length': st.size });
    createReadStream(file).pipe(res);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const sessions = new Set();
  server.on('session', (s) => { sessions.add(s); s.on('close', () => sessions.delete(s)); });
  return {
    url: `https://127.0.0.1:${server.address().port}`,
    spki,
    close: () => new Promise((ok) => { for (const s of sessions) s.destroy(); server.close(() => ok()); }),
  };
}
