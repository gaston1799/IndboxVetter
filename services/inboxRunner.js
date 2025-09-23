"use strict";

const { getSettings } = require("../config/db");
const { runInboxPipeline, GmailTokenMissingError } = require("../modules/inbox/pipeline");
const { summarizeAttachments } = require("../modules/inbox/gmail");

const SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];

async function runInboxOnce(email, { overrides = {}, state = {}, log } = {}) {
  const settings = getSettings(email);
  return runInboxPipeline({ email, settings, overrides, state, log });
}

module.exports = {
  SCOPES,
  runInboxOnce,
  GmailTokenMissingError,
  summarizeAttachments,
};
