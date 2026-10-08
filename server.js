const express = require('express');
const mongoose = require('mongoose');
const config = require('./config');

const app = express();

// Railway sits behind a proxy that terminates HTTPS and forwards requests as
// plain HTTP internally. Without this, req.protocol always reports "http"
// even on a https:// URL — which breaks anything that builds a redirect URI
// from req.protocol (like the Gmail OAuth setup routes). Vercel's edge
// network does the same thing, so this is needed there too.
app.set('trust proxy', 1);

app.use(express.json());

// Health check — useful for the platform (Railway/Vercel) to confirm the
// app is actually up. Also reports DB status, so you can see from the URL
// alone if Mongo is the problem.
app.get('/health', (req, res) => {
  const dbStates = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  res.json({
    status: 'ok',
    db: dbStates[mongoose.connection.readyState] || 'unknown'
  });
});

// public/index.html exists, so express.static would serve it automatically for "/"
// before this route ever ran. { index: false } disables that auto-serve so "/"
// always lands on welcome.html first, and everything else in public/ still works.
app.get('/', (req, res) => res.redirect('/welcome.html'));
app.use(express.static('public', { index: false }));

// ---------------------------------------------------------------------------
// MongoDB connection — cached across invocations.
//
// On a traditional always-on server (Railway) mongoose.connect() is called
// once at boot and the process just waits around, so by the time the first
// request arrives the connection is long since ready.
//
// On Vercel, this file is re-evaluated on every cold start of the serverless
// function, and — critically — a fresh request can arrive and hit the
// `/api` middleware below WHILE mongoose.connect() is still in flight
// (readyState 2 "connecting", not yet 1 "connected"). The old code only
// checked readyState synchronously, so it 503'd immediately instead of
// waiting a few hundred ms for the connection to finish. That's the "Database
// not connected" loop you were seeing — the DB config itself was fine, the
// server just never waited for it.
//
// The fix: connectDB() below returns the SAME in-flight promise to every
// caller (request) until it resolves or fails, and the /api middleware
// awaits it instead of just reading readyState. Works identically on
// Railway/any long-running host too — after the first successful connect,
// readyState is already 1 so connectDB() resolves instantly.
let connectionPromise = null;

function connectDB() {
  if (mongoose.connection.readyState === 1) return Promise.resolve();

  if (!connectionPromise) {
    connectionPromise = mongoose.connect(config.mongodbUri, {
      // Fail fast instead of hanging (default is 30s, which just makes every
      // request queue up and time out on a serverless platform). Give it a
      // more forgiving 15s in case the region is far from Atlas.
      serverSelectionTimeoutMS: 15000,
      // Never buffer commands waiting on a connection that may never
      // arrive — surface the failure instead of a silent hang.
      bufferCommands: false
    })
      .then(() => {
        console.log('MongoDB connected');
      })
      .catch(err => {
        console.error('=====================================================');
        console.error('MongoDB connection FAILED. Common causes:');
        console.error('  1) config.js mongodbUri is wrong or still a placeholder');
        console.error('  2) MongoDB Atlas > Network Access does not allow this server\'s IP');
        console.error('     (Atlas > Network Access > Add IP > ALLOW ACCESS FROM ANYWHERE)');
        console.error('  3) The Atlas DB user/password is wrong or was rotated');
        console.error('Actual error below:');
        console.error(err.message);
        console.error('=====================================================');
        connectionPromise = null; // let the next request retry instead of staying stuck on a dead promise
        throw err;
      });
  }

  return connectionPromise;
}

// Kick off a connection attempt at startup too (harmless on serverless —
// just gives the connection a head start before the first request lands —
// and matches the old always-connect-at-boot behavior on Railway).
connectDB().catch(() => {}); // errors are already logged inside connectDB; avoid an unhandled rejection here

// Block API calls while the DB isn't connected, with a clear reason, instead
// of letting every route fail with a generic "Server error". Now actually
// WAITS for an in-flight connection attempt instead of only checking the
// current state.
app.use('/api', async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    res.status(503).json({
      success: false,
      error: 'Database not connected. Check server logs for the MongoDB connection error.'
    });
  }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/gmail-setup', require('./routes/gmailSetup')); // one-time Gmail sender setup helper
app.use('/api/owner', require('./routes/owner'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/image', require('./routes/image'));
app.use('/api/conversations', require('./routes/conversations'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/maintenance', require('./routes/maintenance'));
app.use('/api/publish', require('./routes/publish'));

// Public, unauthenticated route that serves a page a user published from
// an AI-generated HTML code block. No login needed — this is the whole
// point (a link they can send to anyone).
const Publish = require('./models/Publish');
app.get('/p/:slug', async (req, res) => {
  try {
    await connectDB();
    const page = await Publish.findOne({ slug: req.params.slug });
    if (!page) return res.status(404).send('Page not found.');
    if (page.disabled) return res.status(503).send('This page is temporarily unavailable.');
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(page.html);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error.');
  }
});

// Warn loudly at boot if config.js still has unfilled placeholder values —
// this is the #1 cause of "Server error" on register/login.
const requiredConfig = [
  ['MONGODB_URI', config.mongodbUri],
  ['JWT_SECRET', config.jwtSecret],
  ['GEMINI_API_KEY', config.geminiApiKey],
  ['OWNER_EMAIL', config.ownerEmail]
].filter(([, value]) => !value || !String(value).trim());

if (requiredConfig.length) {
  console.error('=====================================================');
  console.error('Missing required Railway environment variables:', requiredConfig.map(([k]) => k).join(', '));
  console.error('Add them in Railway → Variables, then redeploy.');
  console.error('=====================================================');
}

mongoose.connection.on('error', err => console.error('MongoDB runtime error:', err.message));
mongoose.connection.on('disconnected', () => console.warn('MongoDB disconnected'));

// Vercel's Node runtime imports this file as a serverless function handler
// (via api/index.js) and calls the exported app directly per-request — it
// must NOT also call app.listen(), which would try to bind a port in an
// environment that doesn't work that way. `require.main === module` is only
// true when this file is run directly (`node server.js`, e.g. on Railway/any
// normal host), so app.listen() is skipped automatically on Vercel while
// staying unchanged for every other host.
if (require.main === module) {
  app.listen(config.port, () => console.log(`Running on port ${config.port}`));
}

module.exports = app;
