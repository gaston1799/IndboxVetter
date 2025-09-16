// middleware/session.js
const session = require("cookie-session");

function sessionMiddleware() {
  return session({
    name: "inboxvetter_session",
    secret: process.env.SESSION_SECRET || "supersecret",
    maxAge: 24 * 60 * 60 * 1000, // 1 day
  });
}

module.exports = sessionMiddleware;
