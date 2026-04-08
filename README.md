# InboxVetter

Local-first web app with Google login, Stripe-powered subscriptions, and a paid proxy to use a server-side OpenAI key.

## Dev

1. Copy `.env.example` to `.env` and fill in the values.
   On PowerShell: `Copy-Item .env.example .env`
2. Install dependencies with `npm install`.
3. Start the app with `npm run dev`.

## Gmail Automation

- Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` in `.env`. The redirect must point to `/gmail/callback` on your deployed host (e.g. `https://yourapp.com/gmail/callback`).
- Each subscriber connects their mailbox from *Settings ? Gmail connect*. Tokens are stored under `data/users/<slug>/gmail-token.json` and the scheduler starts automatically when both Gmail access and a paid plan are active.
- Optional: install `pdf-parse` if you want PDF text extraction during classification (`npm install pdf-parse`).
## Sessions & Security

- `SESSION_MAX_AGE_DAYS` (default 30) controls how long provider sign-ins stay active. Cookies are `SameSite=Lax`, `HttpOnly`, and switch to secure-only automatically in production. Set `SESSION_COOKIE_NAME` or `SESSION_SECURE_COOKIES=true` if you need custom behavior.
- Provide `DATA_ENCRYPTION_KEY` (32-byte hex/base64/utf8) to encrypt Gmail refresh tokens at rest. Without it the app falls back to base64-encoded plaintext and logs a warning.
- Express now ships with `helmet` headers enabled by default. CSP is intentionally left off for now because the current pages still use inline scripts and third-party script hosts.
- High-risk POST endpoints are rate-limited with `express-rate-limit`, including Google sign-in, Gmail connect/disconnect, billing actions, settings writes, and manual inbox runs.
- `npm run dev` is Windows-safe via `cross-env`.
- Project-based OpenAI API keys are accepted; `npm run test:openai-key` shows which configured environment variable wins without printing full secrets.
- Local runtime data under `data/users/` and `logs/` is ignored by Git so token files and generated reports are less likely to be committed accidentally.
