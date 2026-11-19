// validation/browser/shims/dns.mjs: node:dns for the browser gate. The
// validations only set Node's address order, for downloads they don't make.
export const setDefaultResultOrder = () => {};
export default { setDefaultResultOrder };
