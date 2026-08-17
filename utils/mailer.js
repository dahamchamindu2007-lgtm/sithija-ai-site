const { google } = require('googleapis');
const config = require('../config');

function getGmailClient() {
  const oauth2Client = new google.auth.OAuth2(config.gmailClientId, config.gmailClientSecret);
  oauth2Client.setCredentials({ refresh_token: config.gmailRefreshToken });
  return google.gmail({ version: 'v1', auth: oauth2Client });
}

// Gmail API wants the raw RFC 2822 message, base64url-encoded.
function buildRawMessage({ to, from, fromName, subject, html }) {
  const headers = [
    `From: ${fromName} <${from}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: text/html; charset="UTF-8"`
  ].join('\r\n');

  const message = `${headers}\r\n\r\n${html}`;

  return Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function sendOtpEmail(toEmail, otp) {
  if (!config.gmailRefreshToken || config.gmailRefreshToken.startsWith('PASTE_')) {
    throw new Error('Gmail sending not configured yet — run the /api/gmail-setup flow first');
  }

  const gmail = getGmailClient();
  const raw = buildRawMessage({
    to: toEmail,
    from: config.gmailSenderEmail,
    fromName: config.gmailSenderName,
    subject: `${otp} is your Mr Sithija AI verification code`,
    html: `
      <div style="font-family:Arial,sans-serif;background:#000;color:#fafafa;padding:32px;">
        <h2 style="margin:0 0 12px;">Verify your email</h2>
        <p style="color:#aaa;margin:0 0 20px;">Use this code to finish creating your Mr Sithija AI account. It expires in 10 minutes.</p>
        <div style="font-size:32px;font-weight:800;letter-spacing:6px;background:#111;border:1px solid #333;border-radius:10px;padding:16px 24px;display:inline-block;">${otp}</div>
        <p style="color:#666;margin-top:24px;font-size:12px;">If you didn't request this, you can ignore this email.</p>
      </div>
    `
  });

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw }
  });
}

// Owner -> user broadcast message (used by the admin panel's "Notify" action).
// Kept separate from sendOtpEmail so a template change to one never affects the other.
async function sendNotificationEmail(toEmail, message) {
  if (!config.gmailRefreshToken || config.gmailRefreshToken.startsWith('PASTE_')) {
    throw new Error('Gmail sending not configured yet — run the /api/gmail-setup flow first');
  }

  const gmail = getGmailClient();
  const raw = buildRawMessage({
    to: toEmail,
    from: config.gmailSenderEmail,
    fromName: config.gmailSenderName,
    subject: `A message from Mr Sithija AI`,
    html: `
      <div style="font-family:Arial,sans-serif;background:#000;color:#fafafa;padding:32px;">
        <h2 style="margin:0 0 12px;">Message from the team</h2>
        <p style="color:#eee;margin:0 0 20px;white-space:pre-wrap;">${message}</p>
        <p style="color:#666;margin-top:24px;font-size:12px;">You're receiving this because you have an account on Mr Sithija AI.</p>
      </div>
    `
  });

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw }
  });
}

module.exports = { sendOtpEmail, sendNotificationEmail };
