const config = {
  // REQUIRED on Railway
  mongodbUri: process.env.MONGODB_URI || 'mongodb+srv://actqwg7789_db_user:sithija123456@cluster0.3vzsn08.mongodb.net/',
  jwtSecret: process.env.JWT_SECRET || '3b9018e1f3986250dd700911f4be703365cb6d1a5952d89bfe3dbd776895aad5',
  ownerEmail: (process.env.OWNER_EMAIL || 'sithijaanuhas87@gmail.com').toLowerCase(),

  // Google sign-in / Gmail OTP
  googleClientId: process.env.GOOGLE_CLIENT_ID || '456111260958-t34o7cskeirlo5tt5d3im2h5val7mg92.apps.googleusercontent.com',
  gmailClientId: process.env.GMAIL_CLIENT_ID || '456111260958-t34o7cskeirlo5tt5d3im2h5val7mg92.apps.googleusercontent.com',
  gmailClientSecret: process.env.GMAIL_CLIENT_SECRET || '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',
  gmailRefreshToken: process.env.GMAIL_REFRESH_TOKEN || '1//09fHzGikS5zR_CgYIARAAGAkSNwF-L9IreRgwmKegzpWDHyMKy1tdkT9zj78LCnQh5Ti7j2Wo2xUunElkP9R1ISSCx2GpUZng2dM',
  gmailSenderEmail: process.env.GMAIL_SENDER_EMAIL || 'sithijaanuhas87@gmail.com',
  gmailSenderName: process.env.GMAIL_SENDER_NAME || 'Mr Sithija AI',
  gmailSetupKey: process.env.GMAIL_SETUP_KEY || 'change-this-setup-key-before-deploying',

  // REQUIRED: Google Gemini API key — powers BOTH text chat (chat.js) and
  // image generation (image.js). Set GEMINI_API_KEY in Railway/Vercel/.env.
  geminiApiKey: (process.env.GEMINI_API_KEY || 'AQ.Ab8RN6KHOgmfdlcKjaGV1NajwDFTuhVfP1lbf-EJ0sTXk4HHpQ').trim().replace(/^["']|["']$/g, '').trim(),
  geminiApiBase: process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com',

  // Models (override with env vars if Google renames/retires one).
  // Each value can be a comma-separated list: the first is tried first, and if
  // Google answers 404 (retired model) or 5xx/429 the next one is tried.
  // NOTE: all gemini-2.5-* models were retired by Google in mid-2026.
  geminiModels: {
    'sithi-lite': process.env.GEMINI_MODEL_LITE || 'gemini-3.1-flash-lite-preview,gemini-3.5-flash',
    'sithi-normal': process.env.GEMINI_MODEL_NORMAL || 'gemini-3.5-flash,gemini-3-flash-preview,gemini-3.1-flash-lite-preview',
    'sithi-pro': process.env.GEMINI_MODEL_PRO || 'gemini-3.1-pro-preview,gemini-3.5-flash'
  },
  geminiImageModel: process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image-preview,gemini-3-pro-image-preview',

  // Railway provides PORT automatically
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'production'
};
 
module.exports = config;
