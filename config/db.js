// config/db.js (file-based JSON "DB")
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const ADMIN_SET = new Set(
  (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
);

// Ensure data folder and file exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], transactions: [] }, null, 2));
}

// Helpers
function readDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch (err) {
    console.error("DB read error:", err);
    return { users: [], transactions: [] };
  }
}

function writeDB(db) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (err) {
    console.error("DB write error:", err);
  }
}

function upsertUser({ id, email, name, picture }) {
  const db = readDB();
  let user = db.users.find(u => u.email === email);

  const role = ADMIN_SET.has((email || "").toLowerCase()) ? "admin" : "user";

  if (!user) {
    user = { id, email, name, picture, plan: "free", credits: 0, role };
    db.users.push(user);
  } else {
    if (name) user.name = name;
    if (picture) user.picture = picture;
    // auto-promote/demote based on env if different
    user.role = role;
  }

  writeDB(db);
  return user;
}

function getUser(email) {
  const db = readDB();
  return db.users.find(u => u.email === email) || null;
}


function getCredits(email) {
  const db = readDB();
  return db.users.find(u => u.email === email)?.credits ?? 0;
}

function addCredits(email, delta) {
  const db = readDB();
  const user = db.users.find(u => u.email === email);
  if (!user) return 0;

  user.credits = Math.max(0, (user.credits || 0) + Number(delta || 0));
  writeDB(db);
  return user.credits;
}

/* TRANSACTIONS */
function addTransaction({ email, amount, type, stripeId, meta }) {
  const db = readDB();
  const tx = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    email,
    amount: Number(amount || 0),   // positive for purchases, negative for usage
    type,                          // "purchase" | "usage" | "adjustment"
    stripeId: stripeId || null,
    meta: meta || null,            // optional: { model, tokens, messageId, ... }
    date: new Date().toISOString()
  };
  db.transactions.push(tx);
  writeDB(db);
  return tx;
}

function getTransactions(email, limit = 50) {
  const db = readDB();
  return db.transactions
    .filter(t => t.email === email)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, limit);
}

module.exports = {
  upsertUser,
  getCredits,
  addCredits,
  addTransaction,
  getTransactions,
  getUser,
};
