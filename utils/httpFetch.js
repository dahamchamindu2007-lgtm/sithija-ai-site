// Some hosts (older Vercel Node runtime settings, some Railway base images,
// etc) don't have the global fetch() that Node 18+ ships with — calling
// fetch() there throws "fetch is not defined" immediately, which upstream
// code just sees as a generic thrown error and reports as "service
// unavailable". Using this everywhere instead of the bare global removes
// that whole class of failure: it uses the native one when present (zero
// overhead, same behavior) and transparently falls back to the node-fetch
// package otherwise.
const httpFetch = typeof fetch === 'function' ? fetch : require('node-fetch');

module.exports = httpFetch;
