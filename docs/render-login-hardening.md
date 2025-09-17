# Render login hardening summary

## Google sign-in redirect loop
- **Issue**: On Render, Google sign-in succeeded but the dashboard immediately redirected back to `/login.html` because protected requests came back `401 Unauthorized`.
- **Root cause**: Render terminates TLS at its edge. Without trusting the proxy, Express believed incoming requests were plain HTTP and `cookie-session` refused to issue the HTTPS-only session cookie.
- **Fix**: Call `app.set("trust proxy", 1);` during server setup so Express respects `X-Forwarded-Proto: https` and still sends the secure session cookie when the user's original connection used HTTPS.【F:server.js†L15-L52】

## Gmail OAuth redirect hardening
- **Issue**: `/gmail/callback` accepted an arbitrary `redirect` query parameter and forwarded the browser there after finishing the OAuth flow, allowing open-redirect abuse.
- **Fix**: Added `sanitizeRedirect()` to validate the target stays on the InboxVetter origin and falls back to `/settings.html?gmail=connected` whenever the parameter is missing or unsafe.【F:routes/gmail.js†L16-L56】【F:routes/gmail.js†L84-L92】

These changes keep Google sign-in working behind Render's proxy while preventing attackers from abusing the Gmail OAuth redirect.
