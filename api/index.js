// Vercel entry point. Vercel treats every file under /api as its own
// serverless function; this one just hands off to the real Express app in
// server.js (which exports `app` instead of calling app.listen() when
// required rather than run directly — see the require.main check there).
module.exports = require('../server');
