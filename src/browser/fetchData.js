// @ts-check
// src/browser/fetchData.js
//
// Fetch a data file and fail when the answer is not ok, so an error page
// (a dev server answers a missing file with the app's index.html) is never
// read as data. The error says `HTTP <status>`, after `what` when given.
// A network failure throws as fetch does.

/** @param {string} url @param {string} [what] @returns {Promise<Response>} */
export async function fetchOk(url, what) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(what ? `${what}: HTTP ${r.status}` : `HTTP ${r.status}`);
  // The dev server answers a missing file with the app's index.html and a
  // 200: for a data file that means it isn't there (npm run data fetches it).
  if (!/\.html?($|\?)/.test(url) && (r.headers?.get?.('content-type') ?? '').includes('text/html')) throw new Error(`${what ? `${what}: ` : ''}${url} is missing (run npm run data)`);
  return r;
}

/** @param {string} url @param {string} [what] @returns {Promise<any>} */
export const getJson = async (url, what) => (await fetchOk(url, what)).json();

/** @param {string} url @param {string} [what] @returns {Promise<ArrayBuffer>} */
export const getBuffer = async (url, what) => (await fetchOk(url, what)).arrayBuffer();

/** @param {string} url @param {string} [what] @returns {Promise<string>} */
export const getText = async (url, what) => (await fetchOk(url, what)).text();

// The physics' loader in a browser thread (dataLoad.js): each path under
// `base`, the site's base URL, fetched as above.
/** @param {string} base @returns {import('@digital-orrery/physics/dataLoad.js').DataLoader} */
export const fetchLoader = (base) => ({
  buffer: (path, what) => getBuffer(`${base}${path}`, what),
  json: (path, what) => getJson(`${base}${path}`, what),
  text: (path, what) => getText(`${base}${path}`, what),
});
