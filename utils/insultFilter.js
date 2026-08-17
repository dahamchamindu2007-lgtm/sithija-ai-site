// Lightweight, keyword-based detector for messages that insult/abuse
// Sithija ayya (the creator) rather than just generic chit-chat. It's
// intentionally conservative: a message only counts as an insult if it
// contains BOTH (a) a reference to the creator/app, AND (b) a swear or
// insult word — so ordinary messages that merely mention "Sithija" (e.g.
// "how do I contact Sithija ayya?") are never flagged.
//
// This is a starting keyword list, not a complete profanity database.
// Extend TARGET_WORDS / INSULT_WORDS below as you see real abuse patterns
// come through — Sinhala/Singlish slang varies a lot by region and group,
// so treat this as a first line of defense, not a perfect filter.

const STRIKE_LIMIT = 2; // strikes at/after which the account is auto-banned

// References to the creator, the app, or "you" (since insults are often
// aimed at the assistant itself, standing in for its creator).
const TARGET_WORDS = [
  'sithija', 'sithija ayya', 'ayya', 'creator', 'owner', 'admin',
  'app', 'mokka', 'oyage', 'oyala', 'oyaage'
];

// Common Sinhala/Singlish and English insult or swear words. Kept
// deliberately moderate/representative rather than an exhaustive slur
// list — add to this array directly as needed.
const INSULT_WORDS = [
  'huttho', 'hutto', 'huththa', 'huththo', 'hutta', 'pakaya', 'pakayek',
  'pako', 'weda karapan', 'modaya', 'modayek', 'boru', 'booruwa',
  'kariya', 'kariyo', 'gani', 'ponnaya', 'thopi', 'harak', 'harakaya',
  'kala', 'kalek', 'balla', 'ballek', 'baduwa', 'wesi', 'wesige',
  'idiot', 'stupid', 'dumb', 'trash', 'garbage', 'useless', 'suck', 'sucks',
  'shit', 'fuck', 'fucking', 'fck', 'fuk', 'bastard', 'asshole', 'bitch',
  'loser', 'scam', 'scammer', 'fraud', 'cheat', 'thief'
];

function normalizeTokens(text) {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map(t => t.replace(/^[.,!?"'()]+|[.,!?"'()]+$/g, ''))
    .filter(Boolean);
}

// Returns true if `text` looks like an insult directed at the creator/app.
function isInsultToCreator(text) {
  if (!text || !text.trim()) return false;
  const lower = ' ' + text.toLowerCase() + ' ';
  const tokens = normalizeTokens(text);

  const hasTarget = TARGET_WORDS.some(w =>
    w.includes(' ') ? lower.includes(' ' + w + ' ') : tokens.includes(w)
  );
  if (!hasTarget) return false;

  const hasInsult = INSULT_WORDS.some(w =>
    w.includes(' ') ? lower.includes(' ' + w + ' ') : tokens.includes(w)
  );
  return hasInsult;
}

module.exports = { isInsultToCreator, STRIKE_LIMIT };