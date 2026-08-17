const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  // Optional now — accounts created via Google Sign-In have no password
  passwordHash: { type: String },
  // Set for accounts created/linked via Google Sign-In. Sparse so multiple
  // password-only users (googleId: undefined) don't collide on the unique index.
  googleId: { type: String, unique: true, sparse: true },

  // Email OTP verification (password accounts only — Google accounts are
  // already verified by Google, so this stays true for them from the start)
  emailVerified: { type: Boolean, default: false },
  otpHash: { type: String },       // bcrypt hash of the current 6-digit OTP
  otpExpires: { type: Date },      // OTP valid for 10 minutes
  otpAttempts: { type: Number, default: 0 }, // wrong-guess counter, resets on new OTP

  isOwner: { type: Boolean, default: false },
  isPro: { type: Boolean, default: false },

  // Ban: blocks login + chat immediately, without deleting the account or
  // its history (unlike delete, this is reversible from the dashboard).
  isBanned: { type: Boolean, default: false },
  banReason: { type: String, default: '' },
  bannedAt: { type: Date },

  // Auto-moderation: counts messages that insult/abuse Sithija ayya (the
  // creator). First hit gets a warning instead of being sent to the AI;
  // reaching the strike limit (see utils/insultFilter.js) auto-bans the
  // account the same way a manual owner ban would. Reversible from the
  // dashboard like any other ban.
  insultStrikes: { type: Number, default: 0 },
  lastInsultAt: { type: Date },

  // Personal API key — lets this user (or their own external app/bot)
  // call the AI directly outside the web UI. Null until the owner
  // generates one from the dashboard. Sparse so many nulls don't collide
  // on the unique index.
  apiKey: { type: String, unique: true, sparse: true },
  apiKeyCreatedAt: { type: Date },

  // Rate limit is tied to the account (this doc), not the device/phone —
  // so logging in with the same email from another phone shares the same counter.
  requestCount: { type: Number, default: 0 },
  requestDate: { type: String, default: '' }, // 'YYYY-MM-DD'

  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);