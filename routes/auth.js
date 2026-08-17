const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const config = require('../config');
const { sendOtpEmail } = require('../utils/mailer');

const router = express.Router();
const googleClient = new OAuth2Client(config.googleClientId);

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_OTP_ATTEMPTS = 5;

function signToken(user) {
  return jwt.sign(
    { id: user._id, email: user.email, isOwner: user.isOwner },
    config.jwtSecret,
    { expiresIn: '30d' } // stays logged in across refresh; only clearing the token (logout) ends it
  );
}

function publicUser(user) {
  return {
    id: user._id,
    email: user.email,
    isOwner: user.isOwner,
    isPro: user.isPro,
    requestCount: user.requestCount,
    requestDate: user.requestDate
  };
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
}

async function issueOtp(user) {
  const otp = generateOtp();
  user.otpHash = await bcrypt.hash(otp, 10);
  user.otpExpires = new Date(Date.now() + OTP_TTL_MS);
  user.otpAttempts = 0;
  await user.save();
  await sendOtpEmail(user.email, otp);
}

// Step 1 of creating an account: validate + store the password, but don't
// log the user in yet — an OTP is emailed first and /verify-otp finishes it.
// This is what actually stops fake-gmail signups: the account can't be used
// until a code sent to that real inbox is entered back.
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing && existing.emailVerified) {
      return res.status(409).json({ success: false, error: 'Account already exists, please login' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const isOwner = normalizedEmail === config.ownerEmail;

    let user = existing;
    if (user) {
      // Re-registering an email that started signup but never verified —
      // overwrite the old attempt instead of blocking them.
      user.passwordHash = passwordHash;
    } else {
      user = new User({ email: normalizedEmail, passwordHash, isOwner, emailVerified: false });
    }

    await issueOtp(user);
    res.json({ success: true, otpRequired: true, email: normalizedEmail });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Server error, try again' });
  }
});

// Step 2: user submits the 6-digit code from their inbox
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ success: false, error: 'Email and code required' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user || !user.otpHash) {
      return res.status(400).json({ success: false, error: 'No pending verification for this email' });
    }

    if (user.otpExpires < new Date()) {
      return res.status(400).json({ success: false, error: 'Code expired, request a new one' });
    }

    if (user.otpAttempts >= MAX_OTP_ATTEMPTS) {
      return res.status(429).json({ success: false, error: 'Too many attempts, request a new code' });
    }

    const match = await bcrypt.compare(String(otp).trim(), user.otpHash);
    if (!match) {
      user.otpAttempts += 1;
      await user.save();
      return res.status(400).json({ success: false, error: 'Incorrect code' });
    }

    user.emailVerified = true;
    user.otpHash = undefined;
    user.otpExpires = undefined;
    user.otpAttempts = 0;
    await user.save();

    const token = signToken(user);
    res.json({ success: true, token, user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Resend a fresh code (e.g. the first one expired or got lost)
router.post('/resend-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email required' });
    }
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user || user.emailVerified) {
      return res.status(400).json({ success: false, error: 'No pending verification for this email' });
    }
    await issueOtp(user);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Server error, try again' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password required' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user || !user.passwordHash) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    if (!user.emailVerified) {
      await issueOtp(user); // send a fresh code so they can finish verifying right away
      return res.status(403).json({ success: false, error: 'Email not verified', otpRequired: true, email: user.email });
    }

    if (user.isBanned) {
      return res.status(403).json({ success: false, banned: true, error: user.banReason || 'Your account has been banned.' });
    }

    // Self-heal owner status: if this account's email matches the
    // configured owner email but isOwner wasn't set (e.g. it was created
    // before OWNER_EMAIL was set correctly, or another bug), fix it now
    // instead of leaving them locked out of the owner dashboard forever.
    const shouldBeOwner = user.email === config.ownerEmail;
    if (shouldBeOwner !== user.isOwner) {
      user.isOwner = shouldBeOwner;
      await user.save();
    }

    const token = signToken(user);
    res.json({ success: true, token, user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Public — lets the frontend fetch the Google Client ID without hardcoding it in HTML
router.get('/google-client-id', (req, res) => {
  res.json({ clientId: config.googleClientId });
});

// Sign in / sign up with Google. Frontend sends the ID token from Google
// Identity Services; we verify it directly with Google's servers — this is
// what actually blocks fake-gmail spam signups, since the token can only be
// produced by a real Google account that completed Google's own login flow.
router.post('/google', async (req, res) => {
  try {
    const { credential } = req.body; // ID token (JWT) from Google Identity Services
    if (!credential) {
      return res.status(400).json({ success: false, error: 'Missing Google credential' });
    }

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: config.googleClientId
      });
      payload = ticket.getPayload();
    } catch (err) {
      return res.status(401).json({ success: false, error: 'Invalid Google token' });
    }

    if (!payload.email_verified) {
      return res.status(401).json({ success: false, error: 'Google email not verified' });
    }

    const normalizedEmail = payload.email.toLowerCase().trim();
    const isOwner = normalizedEmail === config.ownerEmail;

    let user = await User.findOne({ $or: [{ googleId: payload.sub }, { email: normalizedEmail }] });

    if (!user) {
      user = await User.create({ email: normalizedEmail, googleId: payload.sub, isOwner, emailVerified: true });
    } else if (!user.googleId) {
      // Existing password account signing in with Google for the first time — link it.
      // Google already verified this email, so this also clears any pending OTP step.
      user.googleId = payload.sub;
      user.emailVerified = true;
      await user.save();
    }

    if (user.isBanned) {
      return res.status(403).json({ success: false, banned: true, error: user.banReason || 'Your account has been banned.' });
    }

    // Same self-heal as the password login path above.
    if (isOwner !== user.isOwner) {
      user.isOwner = isOwner;
      await user.save();
    }

    const token = signToken(user);
    res.json({ success: true, token, user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Called on page load to silently restore the session from a saved token
router.get('/me', requireAuth, async (req, res) => {
  res.json({ success: true, user: publicUser(req.user) });
});

module.exports = router;
