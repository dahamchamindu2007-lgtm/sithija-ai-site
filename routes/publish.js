const express = require('express');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');
const Publish = require('../models/Publish');

const router = express.Router();

// Keeps published pages small — plenty for a demo/landing page generated
// from a chat reply, and stops the DB filling up with huge blobs.
const MAX_HTML_BYTES = 500 * 1024;

function makeSlug() {
  return crypto.randomBytes(4).toString('hex'); // e.g. "a1b2c3d4"
}

// POST /api/publish  { html: "<html>...</html>" }
// Any logged-in user can publish — this mirrors "download the code",
// just hosted instead of downloaded. The public page itself is served
// with no auth from server.js at GET /p/:slug.
router.post('/', requireAuth, async (req, res) => {
  try {
    const html = (req.body.html || '').toString();
    if (!html.trim()) {
      return res.status(400).json({ success: false, error: 'No HTML provided' });
    }
    if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
      return res.status(400).json({ success: false, error: 'Page is too large to publish (max 500KB)' });
    }

    let slug, exists = true;
    for (let i = 0; i < 5 && exists; i++) {
      slug = makeSlug();
      exists = await Publish.exists({ slug });
    }
    if (exists) {
      return res.status(500).json({ success: false, error: 'Could not generate a unique link, try again' });
    }

    await Publish.create({ slug, html, userId: req.user._id });
    res.json({ success: true, slug, url: `${req.protocol}://${req.get('host')}/p/${slug}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// GET /api/publish/mine — a user's own published pages (for a future
// "my published pages" list; not wired into the UI yet, but harmless to
// have available).
router.get('/mine', requireAuth, async (req, res) => {
  try {
    const pages = await Publish.find({ userId: req.user._id }).sort({ createdAt: -1 }).select('slug createdAt');
    res.json({ success: true, pages });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

module.exports = router;
