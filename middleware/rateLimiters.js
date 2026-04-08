"use strict";

const { rateLimit } = require("express-rate-limit");

function createJsonLimiter({ windowMs, limit, message }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === "test",
    handler: (_req, res, _next, options) => {
      res.status(options.statusCode).json({
        ok: false,
        error: message,
      });
    },
  });
}

const authLimiter = createJsonLimiter({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  message: "Too many sign-in attempts. Please retry in a few minutes.",
});

const gmailConnectLimiter = createJsonLimiter({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  message: "Too many Gmail connection attempts. Please retry shortly.",
});

const settingsWriteLimiter = createJsonLimiter({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  message: "Too many settings changes. Please slow down and retry shortly.",
});

const billingWriteLimiter = createJsonLimiter({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  message: "Too many billing actions. Please retry shortly.",
});

const inboxRunLimiter = createJsonLimiter({
  windowMs: 5 * 60 * 1000,
  limit: 5,
  message: "InboxVetter was started too many times. Please wait a few minutes.",
});

module.exports = {
  authLimiter,
  gmailConnectLimiter,
  settingsWriteLimiter,
  billingWriteLimiter,
  inboxRunLimiter,
};
