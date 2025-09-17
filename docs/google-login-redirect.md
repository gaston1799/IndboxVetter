# Why Google sign-in jumps back to the login screen

## Symptom
- Google Identity Services successfully returns an ID token and `/auth/google` responds with `{ ok: true }`, so the browser navigates to `/dashboard.html`.
- As soon as `/dashboard.html` loads, the page triggers API calls (starting with `/api/me`). Those requests come back with HTTP 401, so the front-end redirects back to `/login.html`.

The redirect logic lives in the dashboard script. Whenever a fetch call receives 401 it immediately sends the user to the login page, which is why you bounce straight back after the first protected request fails.【F:public/dashboard.html†L145-L189】

## What causes the 401s?
Protected routes and HTML pages all rely on the Express `requireAuth` middleware. It only allows the request through when `req.session.user` exists; otherwise it ends the request with `401 Unauthorized`.【F:middleware/authMiddleware.js†L1-L6】【F:server.js†L107-L132】

Under normal circumstances the Google sign-in handler stores the logged-in profile in `req.session.user`, which should satisfy `requireAuth` on the next request.【F:routes/auth.js†L8-L33】 The problem is that the session cookie never makes it back to the browser, so `req.session.user` is empty on every follow-up request and the middleware keeps rejecting them.

### Why the cookie is missing
The server enables secure cookies whenever it runs in production. Behind hosting platforms such as Render the TLS connection terminates at their edge, then traffic reaches Node over HTTP. Without `app.set("trust proxy", 1)` Express thinks the request was plain HTTP, so `cookie-session` refuses to send the secure cookie at all.【F:server.js†L15-L52】

That means:
1. `/auth/google` tries to set the session cookie on an HTTPS response coming through the proxy.
2. Express does not trust the `X-Forwarded-Proto: https` header, so it concludes the request was insecure.
3. Because the app requested a secure cookie, `cookie-session` silently skips the `Set-Cookie` header.
4. The next page load has no session cookie, so `requireAuth` fails and returns 401.
5. The dashboard script sees the 401 and forces a redirect back to `/login.html`.

## How to fix it
- Keep `SESSION_SECURE_COOKIES` enabled so authenticated sessions always use HTTPS-only cookies.
- Add `app.set("trust proxy", 1);` so Express honours the proxy's TLS headers and still issues secure cookies when the original browser connection was HTTPS.【F:server.js†L15-L52】
- For local development over plain HTTP, either start the server with `NODE_ENV=development` or explicitly disable secure cookies by setting `SESSION_SECURE_COOKIES=false`.

Once the cookie is delivered, `/dashboard.html` and subsequent API calls will see `req.session.user`, the middleware will allow them through, and the redirect loop stops.
