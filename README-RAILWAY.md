# HASHU AI — Railway deployment package

This version is prepared for Railway. It listens on Railway's `PORT`, exposes
`/health`, and keeps credentials out of `config.js`.

## Railway setup

1. Deploy this project to Railway.
2. Railway should detect Node.js automatically; the start command is `npm start`.
3. Add these variables in **Railway → Variables**:

```text
MONGODB_URI=your_mongodb_atlas_connection_string
JWT_SECRET=generate_a_long_random_secret
OWNER_EMAIL=your_owner_email
CHAMA_API_KEY=chama_api_90569a61c96bdb95a2f1a71d16f6e95e
```

For Google sign-in, add:

```text
GOOGLE_CLIENT_ID=...
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REFRESH_TOKEN=...
GMAIL_SENDER_EMAIL=...
GMAIL_SENDER_NAME=Mr Sithija AI
GMAIL_SETUP_KEY=...
```

Optional:

```text
CHAMA_API_BASE=https://chama-movie-api.koyeb.app
NODE_ENV=production
```

For AI image generation to keep working (routes/image.js), also add:

```text
HASHU_API_KEY=your_hashu_api_key
HASHU_API_BASE=https://hashu-apis-production.up.railway.app
```

Do not manually set `PORT`; Railway supplies it.

## MongoDB Atlas

Allow your Railway deployment to reach MongoDB Atlas. For initial testing,
`0.0.0.0/0` can be used in Atlas Network Access, then restricted later when
you have a suitable fixed egress setup.

## Gmail OAuth

Register this callback URL in your Google OAuth client:

`https://YOUR-RAILWAY-DOMAIN/api/gmail-setup/callback`

Then use:

`https://YOUR-RAILWAY-DOMAIN/api/gmail-setup/url?key=YOUR_GMAIL_SETUP_KEY`

## Health check

Railway can use `/health`.

## Security

The original uploaded project contained live-looking database, Gmail OAuth,
and AI API credentials in `config.js`. This package removes those credentials.
If they are real, rotate/revoke them and use fresh credentials before
deployment.

## Local test

```bash
npm install
# copy .env.example to .env and fill it in
npm start
```

Then open `http://localhost:3000/health`.
