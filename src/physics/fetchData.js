// @ts-check
// src/physics/fetchData.js
//
// Fetch a data file and fail when the answer is not ok, so an error page
// (a dev server answers a missing file with the app's index.html) is never
// read as data. The error says `HTTP <status>`, after `what` when given.
// A network failure throws as fetch does.

/** @param {string} url @param {string} [what] */
async function get(url, what) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(what ? `${what}: HTTP ${r.status}` : `HTTP ${r.status}`);
  return r;
}

/** @param {string} url @param {string} [what] @returns {Promise<any>} */
export const getJson = async (url, what) => (await get(url, what)).json();

/** @param {string} url @param {string} [what] @returns {Promise<ArrayBuffer>} */
export const getBuffer = async (url, what) => (await get(url, what)).arrayBuffer();
