"use strict";

const fs = require("fs");
const path = require("path");

const USERS_BASE_DIR = path.join(process.cwd(), "data", "users");
const GLOBAL_LOG_DIR = path.join(process.cwd(), "logs");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function slugifyEmail(email) {
  return String(email || "unknown")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "user";
}

function getUserWorkspace(email) {
  const slug = slugifyEmail(email);
  const baseDir = ensureDir(path.join(USERS_BASE_DIR, slug));
  const reportDir = ensureDir(path.join(baseDir, "reports"));
  const logDir = ensureDir(path.join(baseDir, "logs"));

  return {
    email,
    slug,
    baseDir,
    reportDir,
    logDir,
    tokenPath: path.join(baseDir, "gmail-token.json"),
    cachePath: path.join(baseDir, "processed.json"),
    importantLogPath: path.join(baseDir, "important.jsonl"),
  };
}

function readJSON(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJSON(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function appendJSONL(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, JSON.stringify(value) + "\n");
}

module.exports = {
  USERS_BASE_DIR,
  GLOBAL_LOG_DIR,
  ensureDir,
  slugifyEmail,
  getUserWorkspace,
  readJSON,
  writeJSON,
  appendJSONL,
};
