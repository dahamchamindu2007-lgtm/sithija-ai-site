const express = require('express');
const { google } = require('googleapis');
const config = require('../config');

const router = express.Router();

// This whole file is a ONE-TIME setup helper. After you've copied the
// refresh token into config.js (or Railway env vars), you can delete this
// file and remove its line from server.js — it's not needed at runtime.

function getRedirectUri(req) {
  // Must exactly match an "Authorized redirect URI" on the OAuth client in
  // Google Cloud Console — e.g. https://your-app.up.railway.app/api/gmail-setup/callback
  return `${req.protocol}://${req.get('host')}/api/gmail-setup/callback`;
}

function getOAuthClient(req) {
  return new google.auth.OAuth2(config.gmailClientId, config.gmailClientSecret, getRedirectUri(req));
}

// Step 1: open this in your browser (with the correct ?key=) and it redirects
// you into Google's consent screen. Sign in with the Gmail account you want
// OTP emails to be sent FROM.
router.get('/url', (req, res) => {
  if (req.query.key !== config.gmailSetupKey) {
    return res.status(403).send('Forbidden — wrong or missing setup key');
  }
  const oauth2Client = getOAuthClient(req);
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // forces Google to issue a refresh_token every time
    scope: ['https://www.googleapis.com/auth/gmail.send']
  });
  res.redirect(url);
});

// Step 2: Google redirects here after you approve. Shows the refresh token
// once — copy it into config.js (gmailRefreshToken) or the GMAIL_REFRESH_TOKEN
// Railway env var.
router.get('/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send('Missing code');

    const oauth2Client = getOAuthClient(req);
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      return res.status(200).send(`
        <pre>No refresh_token returned. This usually means you already approved this app before.
Go to https://myaccount.google.com/permissions, remove "Mr Sithija AI" access for this Google account,
then visit /api/gmail-setup/url?key=YOUR_KEY again.</pre>
      `);
    }

    res.send(`
      <div style="font-family:monospace;background:#000;color:#3ecf6a;padding:24px;word-break:break-all;">
        <h2>Copy this refresh token into config.js (gmailRefreshToken):</h2>
        <p style="background:#111;padding:16px;border-radius:8px;">${tokens.refresh_token}</p>
        <p style="color:#aaa;">Also make sure config.gmailSenderEmail matches the Gmail account you just approved with.</p>
      </div>
    `);
  } catch (err) {
    console.error(err);
    res.status(500).send('OAuth exchange failed: ' + err.message);
  }
});

module.exports = router;
