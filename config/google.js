const { OAuth2Client } = require("google-auth-library");
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const oidc = new OAuth2Client(GOOGLE_CLIENT_ID);

async function verifyIdToken(idToken) {
  const ticket = await oidc.verifyIdToken({
    idToken,
    audience: GOOGLE_CLIENT_ID
  });
  const p = ticket.getPayload();
  return {
    sub: p.sub,
    email: p.email,
    name: p.name,
    picture: p.picture,
    exp: p.exp, // seconds since epoch
  };
}

module.exports = { verifyIdToken };
