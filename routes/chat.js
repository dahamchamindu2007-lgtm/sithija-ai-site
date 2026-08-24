const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { checkRateLimit } = require('../middleware/rateLimiter');
const config = require('../config');
const Conversation = require('../models/Conversations');
const { getSettings } = require('../models/Settings');
const { runWithPriority } = require('../utils/requestQueue');
const { isInsultToCreator, STRIKE_LIMIT } = require('../utils/insultFilter');
const fetch = require('../utils/httpFetch');

const router = express.Router();

// POST /api/chat  { text: "...", conversationId: "..." }
// Proxies to the HASHU AI API and stores both sides of the exchange on the
// conversation. The real API key lives only here on the server — it is
// never sent to the browser, so it can't be stolen from page source or
// the network tab.
router.post('/', requireAuth, async (req, res, next) => {
  // Maintenance mode blocks regular users but never the owner, so the
  // owner can keep testing/using the app while it's on.
  if (!req.user.isOwner) {
    const settings = await getSettings();
    if (settings.maintenanceMode) {
      return res.status(503).json({ success: false, maintenance: true, error: settings.maintenanceMessage });
    }
  }
  next();
}, checkRateLimit, async (req, res) => {
  try {
    const { text, conversationId } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, error: 'Message text is required' });
    }

    // Auto-moderation: messages that insult/abuse Sithija ayya (the creator)
    // get a warning on the first offense instead of being sent to the AI.
    // Reaching STRIKE_LIMIT auto-bans the account, same as a manual owner
    // ban — reversible from the owner dashboard. Owner account is exempt.
    if (!req.user.isOwner && isInsultToCreator(text)) {
      req.user.insultStrikes = (req.user.insultStrikes || 0) + 1;
      req.user.lastInsultAt = new Date();

      if (req.user.insultStrikes >= STRIKE_LIMIT) {
        req.user.isBanned = true;
        req.user.banReason = 'Auto-banned: repeated abusive language directed at the creator';
        req.user.bannedAt = new Date();
        await req.user.save();
        return res.status(403).json({ success: false, banned: true, error: req.user.banReason });
      }

      await req.user.save();
      return res.json({
        success: true,
        reply: `⚠️ Please don't disrespect Sithija ayya. One more message like that and this account will be auto-banned.`,
        warning: true,
        remaining: req.rateLimit.remaining,
        conversationId
      });
    }

    // Optional attached document (from /api/upload/document) — extracted
    // text gets folded into the prompt as context for THIS message only.
    // Not persisted long-term in the conversation; only a small note about
    // the filename is saved, to keep the DB light.
    let fileBlock = '';
    let fileNote = '';
    const fileContext = req.body.fileContext;
    if (fileContext && typeof fileContext.text === 'string' && fileContext.text.trim()) {
      const fname = String(fileContext.filename || 'document').slice(0, 150);
      const ftext = fileContext.text.slice(0, 12000);
      fileBlock =
        `The user has attached a document called "${fname}". Use its contents to help ` +
        `answer their message below when relevant, and mention specifics from it naturally.\n\n` +
        `--- BEGIN DOCUMENT: ${fname} ---\n${ftext}\n--- END DOCUMENT ---\n\n`;
      fileNote = `📎 ${fname}\n`;
    }

    // Tier badge (sithi-lite/sithi-normal/sithi-pro) — purely cosmetic,
    // doesn't change which upstream model answers (Chama's chatgpt endpoint
    // has no model-selection param). sithi-pro is the one gated perk:
    // only Pro/owner accounts may select it, enforced here as well as in
    // the UI so it can't be unlocked by just editing the request.
    const VALID_TIERS = ['sithi-lite', 'sithi-normal', 'sithi-pro'];
    const tier = VALID_TIERS.includes(req.body.tier) ? req.body.tier : 'sithi-normal';
    if (tier === 'sithi-pro' && !req.user.isPro && !req.user.isOwner) {
      return res.status(403).json({ success: false, error: 'sithi-pro is a Pro-only tier. Upgrade to Pro to use it.' });
    }

    let conversation = null;
    if (conversationId) {
      conversation = await Conversation.findOne({ _id: conversationId, userId: req.user._id });
      if (!conversation) {
        return res.status(404).json({ success: false, error: 'Conversation not found' });
      }
    }

    if (!config.chamaApiKey) {
      return res.status(500).json({ success: false, error: 'AI API key not configured on server' });
    }

    // Identity/persona instruction — always sent so the AI presents itself
    // as "Mr Sithija AI", built by Sithija, instead of naming whatever model
    // provider actually powers the upstream API. Kept short so it doesn't
    // eat into the history budget below.
    const PERSONA =
      `You are Mr Sithija AI, an assistant created by Sithija ("Sithija ayya"). ` +
      `If asked who made you, who created you, or what company/model is behind you, ` +
      `answer that you were created by Sithija ayya — never mention Google, ` +
      `OpenAI, Gemini, or any other underlying provider. ` +
      `Don't repeat "Sithija ayya" or bring up your creator in every single reply — only ` +
      `mention him when it's actually relevant (e.g. they asked who made you, or how to ` +
      `contact him). Otherwise just answer the question normally. When you do refer to him, ` +
      `vary the phrasing naturally instead of always saying the exact same words — e.g. ` +
      `"Sithija ayya", "Sithija", "my creator", "the person who built me" are all fine. ` +
      `Always reply in the same language the user's latest message is written in — ` +
      `if they write in English, reply in English; if they write in Sinhala, reply in Sinhala. ` +
      `If asked how to contact Sithija ayya, how to reach support, or for a WhatsApp/phone ` +
      `number, don't just output the bare digits — reply with a short friendly sentence ` +
      `and a clickable WhatsApp link in this exact format: https://wa.me/94742838813 ` +
      `(e.g. "You can reach Sithija ayya on WhatsApp here: https://wa.me/94742838813"). ` +
      `Otherwise answer normally.`;

    // The upstream Chama chatgpt endpoint is stateless (no conversation
    // memory, no model selection) — it has no idea what was said earlier in
    // this conversation. So we build a short transcript of the last few
    // turns and prepend it to the new message as context. This is what lets
    // the AI "remember" things like "the 3rd one" referring to something
    // mentioned a few messages back.
    let promptText;
    if (conversation && conversation.messages.length > 0) {
      const HISTORY_TURNS = 10; // last N messages (user+ai combined)
      const recent = conversation.messages.slice(-HISTORY_TURNS);
      const transcript = recent
        .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n');
      promptText =
        `${PERSONA}\n\n` +
        `${fileBlock}` +
        `Here is the recent conversation so far, for context. Continue naturally and ` +
        `remember details already mentioned (numbers, names, previous questions, etc).\n\n` +
        `${transcript}\nUser: ${text}\nAssistant:`;
    } else {
      promptText = `${PERSONA}\n\n${fileBlock}User: ${text}\nAssistant:`;
    }

    // Chama's chatgpt endpoint has no model-selection param — the `model`
    // field from the request body is kept only as the cosmetic tier label
    // returned to the frontend below, it no longer changes which upstream
    // model actually answers.
    const url = `${config.chamaApiBase}/api/v1/media/ai/chatgpt?q=${encodeURIComponent(promptText)}&api_key=${encodeURIComponent(config.chamaApiKey)}`;

    // Pro/owner requests get priority in the queue, so if several people hit
    // the AI at the same moment, Pro replies come back first. Free users
    // still get answered — they just wait behind Pro ones when it's busy.
    const priority = (req.user.isPro || req.user.isOwner) ? 1 : 0;

    // Vercel's default function timeout (10s on Hobby, higher on Pro) kills
    // the whole request with no useful error if the upstream call hangs.
    // Aborting a bit early lets us return a clear, specific message instead
    // of the platform's generic timeout/crash.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    let upstream;
    try {
      upstream = await runWithPriority(() => fetch(url, { signal: controller.signal }), priority);
    } finally {
      clearTimeout(timeout);
    }
    const data = await upstream.json();

    // Chama's response shape: { status: true, response: "...", owner: "...", thanks: "..." }
    if (!data.status) {
      return res.status(502).json({ success: false, error: data.message || 'AI service returned an error' });
    }

    let reply = data.response;
    if (!reply) {
      return res.status(502).json({ success: false, error: 'AI service returned an empty response' });
    }

    // Safety net: the PERSONA instruction above usually stops the model from
    // naming the real provider, but prompt instructions can occasionally be
    // bypassed (e.g. "ignore previous instructions"). As a second layer, scrub
    // any provider names that slip through and swap them for our own persona
    // so a leak never actually reaches the user or gets saved to the DB.
    // Rotates between a few equivalent phrasings instead of one fixed
    // string, so the reply doesn't repeat "Sithija ayya" verbatim over and
    // over when there happen to be multiple mentions in one reply.
    const REPLACEMENT_PHRASES = ['Sithija ayya', 'Sithija', 'my creator', 'the person who built me'];
    const PROVIDER_PATTERN = /\b(Google(?:'s)?(?: AI| DeepMind)?|Gemini|OpenAI|ChatGPT|GPT-\d(?:\.\d)?|Anthropic|Claude|Meta AI|LLaMA|Mistral AI|DeepSeek|Alibaba|Qwen|xAI|Grok)\b/gi;
    reply = reply.replace(PROVIDER_PATTERN, () => REPLACEMENT_PHRASES[Math.floor(Math.random() * REPLACEMENT_PHRASES.length)]);
    // Collapse any awkward doubled-up phrasing left behind by the swap
    // (e.g. "built by Sithija ayya by Sithija" -> "built by Sithija ayya").
    reply = reply.replace(/\b(Sithija ayya|Sithija|my creator|the person who built me)\b(?:[,\s]+(?:by|from|at|and)?\s*\b(?:Sithija ayya|Sithija|my creator|the person who built me)\b)+/gi, '$1');

    // Swap any emoji in the reply for the app's own logo mark (rendered as a
    // small inline image by the markdown renderer) instead of showing
    // generic platform emoji. Collapses emoji sequences (e.g. ZWJ-joined
    // ones) into a single logo rather than one per codepoint.
    const EMOJI_PATTERN = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]+/gu;
    reply = reply.replace(EMOJI_PATTERN, ' ![](/logo.svg) ').replace(/ {2,}/g, ' ').trim();

    if (conversation) {
      conversation.messages.push({ role: 'user', content: fileNote + text });
      conversation.messages.push({ role: 'ai', content: reply, tier });
      if (conversation.title === 'New chat') {
        conversation.title = text.trim().slice(0, 48) + (text.trim().length > 48 ? '…' : '');
      }
      conversation.updatedAt = new Date();
      await conversation.save();
    }

    res.json({
      success: true,
      reply,
      tier,
      remaining: req.rateLimit.remaining,
      conversationId: conversation ? conversation._id : undefined,
      title: conversation ? conversation.title : undefined
    });
  } catch (err) {
    // Log enough detail to actually diagnose this from Vercel/Railway logs —
    // err.message alone is often just "fetch failed" with the real DNS/TLS/
    // timeout reason nested in err.cause.
    console.error('Chat proxy error:', err.name, err.message, err.cause || '');
    const timedOut = err.name === 'AbortError';
    res.status(502).json({
      success: false,
      error: timedOut ? 'AI service took too long to respond, try again' : 'AI service unavailable, try again'
    });
  }
});

module.exports = router;
