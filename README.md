# InboxVetter

Local-first web app with Google login, Stripe-powered subscriptions, and a paid proxy to use a server-side OpenAI key.

## Dev

```bash
cp .env.example .env  # fill values
npm i
node server.js
```
## Gmail Automation

- Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` in `.env`. The redirect must point to `/gmail/callback` on your deployed host (e.g. `https://yourapp.com/gmail/callback`).
- Each subscriber connects their mailbox from *Settings ? Gmail connect*. Tokens are stored under `data/users/<slug>/gmail-token.json` and the scheduler starts automatically when both Gmail access and a paid plan are active.
- Optional: install `pdf-parse` if you want PDF text extraction during classification (`npm install pdf-parse`).
## Sessions & Security

- `SESSION_MAX_AGE_DAYS` (default 30) controls how long provider sign-ins stay active. Cookies are `SameSite=Lax`, `HttpOnly`, and switch to secure-only automatically in production. Set `SESSION_COOKIE_NAME` or `SESSION_SECURE_COOKIES=true` if you need custom behavior.
- Provide `DATA_ENCRYPTION_KEY` (32-byte hex/base64/utf8) to encrypt Gmail refresh tokens at rest. Without it the app falls back to base64-encoded plaintext and logs a warning.
