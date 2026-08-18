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

  // REQUIRED for AI features
 sasaApiKey: process.env.SASA_API_KEY || 'Sasa_Dev_Api_4eed65c016af3ca6b0d0ad2ef564246543c45b34',
  sasaApiBase: process.env.SASA_API_BASE || 'https://api.sasatech.online',

  // Railway provides PORT automatically
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'production'
};

module.exports = config;
