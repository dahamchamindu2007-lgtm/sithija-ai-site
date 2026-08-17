const config = {
  // REQUIRED on Railway
  mongodbUri: process.env.MONGODB_URI || 'mongodb+srv://actqwg7789_db_user:sithija123456@cluster0.3vzsn08.mongodb.net/',
  jwtSecret: process.env.JWT_SECRET || '3b9018e1f3986250dd700911f4be703365cb6d1a5952d89bfe3dbd776895aad5',
  ownerEmail: (process.env.OWNER_EMAIL || 'sithijaanuhas87@gmail.com').toLowerCase(),

  // Google sign-in / Gmail OTP
  googleClientId: process.env.GOOGLE_CLIENT_ID || '33474917838-m4jj35a1ff7tqrqrka2no12k9ltb6m36.apps.googleusercontent.com',
  gmailClientId: process.env.GMAIL_CLIENT_ID || '725412746068-nf16uscf6mrqi1d70r0mqumc8gk916u6.apps.googleusercontent.com',
  gmailClientSecret: process.env.GMAIL_CLIENT_SECRET || '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',
  gmailRefreshToken: process.env.GMAIL_REFRESH_TOKEN || '1//09fHzGikS5zR_CgYIARAAGAkSNwF-L9IreRgwmKegzpWDHyMKy1tdkT9zj78LCnQh5Ti7j2Wo2xUunElkP9R1ISSCx2GpUZng2dM',
  gmailSenderEmail: process.env.GMAIL_SENDER_EMAIL || 'sithijaanuhas87@gmail.com',
  gmailSenderName: process.env.GMAIL_SENDER_NAME || 'Mr Sithija AI',
  gmailSetupKey: process.env.GMAIL_SETUP_KEY || 'change-this-setup-key-before-deploying',

  // REQUIRED for AI features
  hashuApiKey: process.env.HASHU_API_KEY || 'hashu_33b70902c0489263d4eb64fe4e49dad5',
  hashuApiBase: process.env.HASHU_API_BASE || 'https://hashu-apis-production.up.railway.app',

  // Railway provides PORT automatically
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'production'
};

module.exports = config;
