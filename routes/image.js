const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { checkRateLimit } = require('../middleware/rateLimiter');
const { getSettings } = require('../models/Settings');
const config = require('../config');
const Conversation = require('../models/Conversations');
const { generateImage } = require('../utils/gemini');

const router = express.Router();

// POST /api/image/generate  { prompt: "...", conversationId: "..." }
// Uses Google Gemini's image model. Gemini understands Sinhala / Singlish
// prompts directly, so no separate translation step is needed. The image
// comes back as base64, which we return as a data: URI so the frontend can
// render + persist it, and the API key never reaches the browser.
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
    if (!config.geminiApiKey) {
      return res.status(500).json({ success: false, error: 'AI API key not configured on server' });
    }

    let conversation = null;
    if (conversationId) {
      conversation = await Conversation.findOne({ _id: conversationId, userId: req.user._id });
      if (!conversation) {
        return res.status(404).json({ success: false, error: 'Conversation not found' });
      }
    }

    let dataUri;
    try {
      dataUri = await generateImage({
        model: config.geminiImageModel,
        prompt: `Generate an image: ${prompt.trim()}`
      });
    } catch (e) {
      console.error('Gemini image error:', e.name, e.message, e.upstream ? JSON.stringify(e.upstream).slice(0, 500) : '');
      if (e.blocked) {
        return res.status(422).json({ success: false, error: 'The image could not be generated for that prompt. Try describing it differently.' });
      }
      if (e.status === 429) {
        return res.status(502).json({ success: false, error: 'Image service is busy or out of quota right now, try again shortly' });
      }
      if (e.status === 400 || e.status === 401 || e.status === 403) {
        return res.status(502).json({ success: false, error: 'Image service rejected the request — check GEMINI_API_KEY and that image generation is enabled for it' });
      }
      if (e.name === 'AbortError') {
        return res.status(502).json({ success: false, error: 'Image service took too long to respond, try again' });
      }
      return res.status(502).json({ success: false, error: 'Image service unavailable, try again' });
    }

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
    res.status(502).json({ success: false, error: 'Image service unavailable, try again' });
  }
});

module.exports = router;
