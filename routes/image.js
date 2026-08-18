const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { checkRateLimit } = require('../middleware/rateLimiter');
const { getSettings } = require('../models/Settings');
const config = require('../config');
const Conversation = require('../models/Conversations');
const fetch = require('../utils/httpFetch');

const router = express.Router();

// The image API works far more reliably with clean English prompts than
// with Sinhala script or romanized Singlish ("pusekge photo ekak hdla
// denna" etc — the possessive/verb suffixes confuse it into generating
// something unrelated). So before generating, we ask the same freechat
// model to translate/clean the prompt into a short English image-prompt.
// If translation fails for any reason, we just fall back to the original
// text rather than blocking the request.
async function toEnglishImagePrompt(rawPrompt) {
  try {
    const instruction =
      `Translate/rewrite the following into a short, clear English text-to-image ` +
      `prompt describing the scene. Output ONLY the prompt text itself — no quotes, ` +
      `no explanation, no extra words.\n\nInput: ${rawPrompt}\nEnglish image prompt:`;
    const url = `${config.sasaApiBase}/api/ai/gemini?apikey=${encodeURIComponent(config.sasaApiKey)}&q=${encodeURIComponent(instruction)}&mode=value`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    let upstream;
    try {
      upstream = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!upstream.ok) return rawPrompt;
    const data = await upstream.json();
    const translated = data.result || (data.results && data.results.reply) || data.reply;
    return (translated && translated.trim()) ? translated.trim() : rawPrompt;
  } catch (err) {
    console.error('Prompt translation failed, using original:', err.name, err.message);
    return rawPrompt;
  }
}

// POST /api/image/generate  { prompt: "...", conversationId: "..." }
// Proxies to Hashu-APIs' /api/aiimage endpoint, which returns the image
// bytes directly (not JSON). We stream those bytes back as base64 so the
// frontend can render + persist them without a second round trip, and so
// the real HASHU_API_KEY never reaches the browser.
router.post('/generate', requireAuth, (req, res, next) => {
  if (!req.user.isOwner) {
    getSettings().then(settings => {
      if (settings.maintenanceMode) {
        return res.status(503).json({ success: false, maintenance: true, error: settings.maintenanceMessage });
      }
      next();
    }).catch(next);
  } else {
    next();
  }
}, checkRateLimit, async (req, res) => {
  try {
    const { prompt, conversationId } = req.body;
    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ success: false, error: 'A prompt is required' });
    }
    if (!config.sasaApiKey) {
      return res.status(500).json({ success: false, error: 'AI API key not configured on server' });
    }

    let conversation = null;
    if (conversationId) {
      conversation = await Conversation.findOne({ _id: conversationId, userId: req.user._id });
      if (!conversation) {
        return res.status(404).json({ success: false, error: 'Conversation not found' });
      }
    }

    const englishPrompt = await toEnglishImagePrompt(prompt.trim());
    const url = `${config.hashuApiBase}/api/aiimage?apiKey=${encodeURIComponent(config.hashuApiKey)}&text=${encodeURIComponent(englishPrompt)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    let upstream;
    try {
      upstream = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (!upstream.ok) {
      return res.status(502).json({ success: false, error: 'Image service unavailable, try again' });
    }

    const contentType = upstream.headers.get('content-type') || 'image/png';
    if (!contentType.startsWith('image/')) {
      // Upstream returned an error body (JSON/text) instead of an image
      const bodyText = await upstream.text();
      console.error('aiimage non-image response:', bodyText.slice(0, 300));
      return res.status(502).json({ success: false, error: 'Image service returned an unexpected response' });
    }

    const arrayBuffer = await upstream.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const dataUri = `data:${contentType};base64,${base64}`;

    if (conversation) {
      conversation.messages.push({ role: 'user', content: `🎨 ${prompt.trim()}` });
      conversation.messages.push({ role: 'ai', content: prompt.trim(), type: 'image', imageData: dataUri });
      if (conversation.title === 'New chat') {
        conversation.title = 'Image: ' + prompt.trim().slice(0, 40) + (prompt.trim().length > 40 ? '…' : '');
      }
      conversation.updatedAt = new Date();
      await conversation.save();
    }

    res.json({
      success: true,
      image: dataUri,
      remaining: req.rateLimit.remaining,
      conversationId: conversation ? conversation._id : undefined,
      title: conversation ? conversation.title : undefined
    });
  } catch (err) {
    console.error('Image generation error:', err.name, err.message, err.cause || '');
    const timedOut = err.name === 'AbortError';
    res.status(502).json({
      success: false,
      error: timedOut ? 'Image service took too long to respond, try again' : 'Image service unavailable, try again'
    });
  }
});

module.exports = router;
