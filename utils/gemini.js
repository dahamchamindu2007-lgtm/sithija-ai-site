// Thin wrapper around the Google Gemini REST API (generativelanguage.googleapis.com).
// The API key is read from config (env var GEMINI_API_KEY) and sent in the
// x-goog-api-key header, so it never appears in a URL, logs, or the browser.
const config = require('../config');
const fetch = require('./httpFetch');

function endpoint(model) {
  return `${config.geminiApiBase}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

async function callGemini(model, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(endpoint(model), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.geminiApiKey
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  try { data = await res.json(); } catch (_) { /* non-JSON body */ }

  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.upstream = data;
    throw err;
  }
  return data;
}

// Text chat. `history` = [{ role: 'user'|'ai', content }], `userText` = new message.
async function generateText({ model, systemPrompt, history = [], userText, timeoutMs = 25000 }) {
  const contents = history
    .filter(m => m && typeof m.content === 'string' && m.content.trim())
    .map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] }));
  contents.push({ role: 'user', parts: [{ text: userText }] });

  // Gemini requires the first turn to be 'user' and roles to alternate sensibly.
  while (contents.length > 1 && contents[0].role !== 'user') contents.shift();

  const data = await callGemini(model, {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents
  }, timeoutMs);

  const cand = data.candidates && data.candidates[0];
  const text = cand && cand.content && cand.content.parts
    ? cand.content.parts.map(p => p.text || '').join('').trim()
    : '';
  if (!text) {
    const reason = (data.promptFeedback && data.promptFeedback.blockReason) || (cand && cand.finishReason) || 'empty';
    const err = new Error(`Gemini returned no text (${reason})`);
    err.blocked = true;
    throw err;
  }
  return text;
}

// Image generation. Returns a data: URI.
async function generateImage({ model, prompt, timeoutMs = 55000 }) {
  const data = await callGemini(model, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['IMAGE'] }
  }, timeoutMs);

  const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  const imgPart = parts.find(p => (p.inlineData || p.inline_data));
  if (!imgPart) {
    const reason = (data.promptFeedback && data.promptFeedback.blockReason) ||
      (data.candidates && data.candidates[0] && data.candidates[0].finishReason) || 'no image returned';
    const err = new Error(`Gemini returned no image (${reason})`);
    err.blocked = true;
    throw err;
  }
  const inline = imgPart.inlineData || imgPart.inline_data;
  const mime = inline.mimeType || inline.mime_type || 'image/png';
  return `data:${mime};base64,${inline.data}`;
}

// Try each model in a comma-separated list until one works. Only moves on for
// "model problem" errors (404 retired/unknown, 429, 5xx, timeouts); auth
// errors (400/401/403) and safety blocks are returned immediately.
async function withModelFallback(models, fn) {
  const list = Array.isArray(models) ? models : String(models).split(',').map(m => m.trim()).filter(Boolean);
  let lastErr;
  for (const model of list) {
    try {
      return await fn(model);
    } catch (e) {
      lastErr = e;
      const retryable = e.status === 404 || e.status === 429 || (e.status >= 500) || e.name === 'AbortError';
      console.error(`Gemini model "${model}" failed:`, e.status || e.name, e.message);
      if (!retryable) break;
    }
  }
  throw lastErr;
}

module.exports = { generateText, generateImage, withModelFallback };
