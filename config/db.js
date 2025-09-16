// config/db.js (file-based JSON "DB")
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const ADMIN_SET = new Set(
  (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

const DEFAULT_THEME = "light";
const VALID_THEMES = new Set(["light", "dark"]);
const HOUSE_OPENAI_KEY = (process.env.HOUSE_OPENAI_KEY || "").trim();

const PLAN_DEFINITIONS = {
  basic: { renewalDays: 30, defaultStatus: "active", usesHouseKey: true },
  test: { renewalDays: null, defaultStatus: "active", usesHouseKey: true },
};

const LEGACY_PLAN_ALIASES = {
  free: "basic",
  creator: "basic",
  team: "basic",
  pro: "basic",
};

const DEFAULT_PLAN = "basic";

const DEFAULT_SETTINGS = {
  openaiKey: "",
  omittedSenders: "",
  importantDesc: "",
  allowAttachments: true,
  maxAttachmentMB: 5,
  maxImages: 3,
  maxPdfTextChars: 4000,
  model: "gpt-4.1-mini",
  theme: DEFAULT_THEME,
};

const SAMPLE_REPORTS = [
  {
    title: "Sponsorship inquiry from Flowgear",
    description: "Flowgear wants to collaborate on a sponsored tutorial series.",
    status: "needs_review",
    snippet: "We're big fans of your channel and would love to work together on a 3-part automation series...",
  },
  {
    title: "Payment received from CreatorStack",
    description: "Monthly affiliate payout processed successfully.",
    status: "completed",
    snippet: "Your CreatorStack balance was paid out to your bank ending in 9901.",
  },
  {
    title: "Security alert from Proton Mail",
    description: "New login detected from Frankfurt, Germany.",
    status: "urgent",
    snippet: "We noticed a new sign-in on your InboxVetter account from a Chrome browser in Frankfurt.",
  },
];

function normalizePlan(plan = DEFAULT_PLAN) {
  const slug = (plan || "").toString().toLowerCase();
  if (!slug) return DEFAULT_PLAN;
  if (PLAN_DEFINITIONS[slug]) return slug;
  if (LEGACY_PLAN_ALIASES[slug]) return LEGACY_PLAN_ALIASES[slug];
  return DEFAULT_PLAN;
}

function getPlanDefinition(plan) {
  const normalized = normalizePlan(plan);
  return {
    name: normalized,
    definition: PLAN_DEFINITIONS[normalized] || PLAN_DEFINITIONS[DEFAULT_PLAN],
  };
}

function usesHouseOpenAIPlan(plan) {
  return getPlanDefinition(plan).definition.usesHouseKey;
}

function computeRenewalDate(days) {
  if (!days) return null;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

// Ensure data folder and file exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(
    DB_FILE,
    JSON.stringify({ users: [], reports: [], transactions: [] }, null, 2)
  );
}

// Helpers
function readDB() {
  try {
    const raw = fs.readFileSync(DB_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.users)) parsed.users = [];
    if (!Array.isArray(parsed.reports)) parsed.reports = [];
    if (!Array.isArray(parsed.transactions)) parsed.transactions = [];
    return parsed;
  } catch (err) {
    console.error("DB read error:", err);
    return { users: [], reports: [], transactions: [] };
  }
}

function writeDB(db) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (err) {
    console.error("DB write error:", err);
  }
}

function defaultSubscription(plan = DEFAULT_PLAN) {
  const { name, definition } = getPlanDefinition(plan);
  return {
    plan: name,
    seats: 1,
    status: definition.defaultStatus,
    renewsAt: computeRenewalDate(definition.renewalDays),
  };
}
function updateSubscription(email, updates = {}) {
  const ctx = getUserInternal(email);
  if (!ctx) return null;

  const subscription = ctx.user.subscription || defaultSubscription(ctx.user.plan);

  if (updates.plan) {
    const { name } = getPlanDefinition(updates.plan);
    subscription.plan = name;
  }

  if (updates.status && typeof updates.status === "string") {
    subscription.status = updates.status;
  }

  if (updates.seats !== undefined) {
    const seats = Number(updates.seats);
    if (!Number.isNaN(seats) && seats > 0) {
      subscription.seats = Math.round(seats);
    }
  }

  if (updates.renewsAt !== undefined) {
    if (!updates.renewsAt) {
      subscription.renewsAt = null;
    } else {
      const date = new Date(updates.renewsAt);
      if (!Number.isNaN(date.getTime())) {
        subscription.renewsAt = date.toISOString();
      }
    }
  }

  const planInfo = getPlanDefinition(subscription.plan);
  if (!subscription.status) {
    subscription.status = planInfo.definition.defaultStatus;
  }
  if (planInfo.definition.renewalDays) {
    if (!subscription.renewsAt) {
      subscription.renewsAt = computeRenewalDate(planInfo.definition.renewalDays);
    }
  } else {
    subscription.renewsAt = null;
  }
  if (!subscription.seats || subscription.seats < 1) {
    subscription.seats = 1;
  }

  ctx.user.plan = subscription.plan;
  if (usesHouseOpenAIPlan(subscription.plan)) {
    ctx.user.settings.openaiKey = "";
  }
  ctx.user.subscription = subscription;
  writeDB(ctx.db);
  return { ...subscription };
}

function getSubscription(email) {
  const ctx = getUserInternal(email);
  if (!ctx) return defaultSubscription();
  return { ...ctx.user.subscription };
}
function applySettingDefaults(settings = {}) {
  const next = { ...DEFAULT_SETTINGS, ...settings };
  // ensure booleans/numbers are typed correctly
  next.allowAttachments = settings.allowAttachments ?? DEFAULT_SETTINGS.allowAttachments;
  next.maxAttachmentMB = Number.isFinite(Number(next.maxAttachmentMB))
    ? Number(next.maxAttachmentMB)
    : DEFAULT_SETTINGS.maxAttachmentMB;
  next.maxImages = Number.isFinite(Number(next.maxImages))
    ? Number(next.maxImages)
    : DEFAULT_SETTINGS.maxImages;
  next.maxPdfTextChars = Number.isFinite(Number(next.maxPdfTextChars))
    ? Number(next.maxPdfTextChars)
    : DEFAULT_SETTINGS.maxPdfTextChars;
  const desiredTheme = (next.theme || "").toString().toLowerCase();
  next.theme = VALID_THEMES.has(desiredTheme) ? desiredTheme : DEFAULT_THEME;
  return next;
}

function ensureUserDefaults(user) {
  let changed = false;
  const planInfo = getPlanDefinition(user.plan);
  if (!user.plan || user.plan !== planInfo.name) {
    user.plan = planInfo.name;
    changed = true;
  }

  if (!user.subscription) {
    user.subscription = defaultSubscription(user.plan);
    changed = true;
  } else {
    const subscriptionPlanInfo = getPlanDefinition(user.subscription.plan);
    if (user.subscription.plan !== subscriptionPlanInfo.name) {
      user.subscription.plan = subscriptionPlanInfo.name;
      changed = true;
    }
    if (!user.subscription.status) {
      user.subscription.status = subscriptionPlanInfo.definition.defaultStatus;
      changed = true;
    }

    if (subscriptionPlanInfo.definition.renewalDays) {
      if (!user.subscription.renewsAt) {
        user.subscription.renewsAt = computeRenewalDate(
          subscriptionPlanInfo.definition.renewalDays
        );
        changed = true;
      }
    } else if (user.subscription.renewsAt !== null) {
      user.subscription.renewsAt = null;
      changed = true;
    }

    if (!user.subscription.seats || user.subscription.seats < 1) {
      user.subscription.seats = 1;
      changed = true;
    }
  }
  if (!user.settings) {
    user.settings = applySettingDefaults();
    changed = true;
  } else {
    const next = applySettingDefaults(user.settings);
    if (JSON.stringify(next) !== JSON.stringify(user.settings)) {
      user.settings = next;
      changed = true;
    }
  }
  if (usesHouseOpenAIPlan(user.subscription?.plan) && user.settings.openaiKey) {
    user.settings.openaiKey = "";
    changed = true;
  }
  user.plan = user.subscription.plan;
  if (!user.role) {
    user.role = ADMIN_SET.has((user.email || "").toLowerCase())
      ? "admin"
      : "user";
    changed = true;
  }
  return changed;
}

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture,
    role: user.role,
    plan: user.plan,
    subscription: user.subscription,
  };
}

function upsertUser({ id, email, name, picture }) {
  const db = readDB();
  let user = db.users.find((u) => u.email === email);

  const role = ADMIN_SET.has((email || "").toLowerCase()) ? "admin" : "user";

  if (!user) {
    user = {
      id,
      email,
      name,
      picture,
      role,
      plan: DEFAULT_PLAN,
      subscription: defaultSubscription(DEFAULT_PLAN),
      settings: applySettingDefaults(),
    };
    db.users.push(user);
  } else {
    if (name) user.name = name;
    if (picture) user.picture = picture;
    user.role = role;
  }

  if (ensureUserDefaults(user)) {
    // defaults may have changed (e.g., new keys) so persist them
  }

  writeDB(db);
  return sanitizeUser(user);
}

function getUser(email) {
  const db = readDB();
  const user = db.users.find((u) => u.email === email);
  if (!user) return null;
  if (ensureUserDefaults(user)) {
    writeDB(db);
  }
  return sanitizeUser(user);
}

function getUserInternal(email) {
  const db = readDB();
  const user = db.users.find((u) => u.email === email);
  if (!user) return null;
  if (ensureUserDefaults(user)) {
    writeDB(db);
  }
  return { db, user };
}

function listUsers() {
  const db = readDB();
  let dirty = false;
  for (const user of db.users) {
    if (ensureUserDefaults(user)) dirty = true;
  }
  if (dirty) writeDB(db);
  return db.users.map(sanitizeUser);
}

function getSettings(email) {
  const ctx = getUserInternal(email);
  if (!ctx) {
    const defaults = applySettingDefaults();
    defaults.usingHouseOpenAIKey = usesHouseOpenAIPlan(DEFAULT_PLAN);
    return defaults;
  }
  const plan = ctx.user.subscription?.plan || ctx.user.plan;
  const settings = applySettingDefaults(ctx.user.settings);
  const managed = usesHouseOpenAIPlan(plan);
  if (managed) {
    settings.openaiKey = "";
  }
  settings.usingHouseOpenAIKey = managed;
  return settings;
}

function updateSettings(email, updates) {
  const ctx = getUserInternal(email);
  if (!ctx) return applySettingDefaults();
  const plan = ctx.user.subscription?.plan || ctx.user.plan;
  const usesHouseKey = usesHouseOpenAIPlan(plan);
  const allowed = {
    omittedSenders: "string",
    importantDesc: "string",
    allowAttachments: "boolean",
    maxAttachmentMB: "number",
    maxImages: "number",
    maxPdfTextChars: "number",
    model: "string",
    theme: "string",
  };
  for (const [key, type] of Object.entries(allowed)) {
    if (!(key in updates)) continue;
    const value = updates[key];
    if (type === "boolean") {
      ctx.user.settings[key] = Boolean(value);
    } else if (type === "number") {
      const num = Number(value);
      if (!Number.isNaN(num)) ctx.user.settings[key] = num;
    } else if (typeof value === "string") {
      ctx.user.settings[key] = value;
    }
  }
  if (!usesHouseKey && typeof updates.openaiKey === "string") {
    ctx.user.settings.openaiKey = updates.openaiKey.trim();
  }
  if (usesHouseKey) {
    ctx.user.settings.openaiKey = "";
  }
  ctx.user.settings = applySettingDefaults(ctx.user.settings);
  const result = { ...ctx.user.settings, usingHouseOpenAIKey: usesHouseKey };
  writeDB(ctx.db);
  return result;
}

function getEffectiveOpenAIKey(email) {
  const ctx = getUserInternal(email);
  if (!ctx) return HOUSE_OPENAI_KEY || null;
  const plan = ctx.user.subscription?.plan || ctx.user.plan;
  if (usesHouseOpenAIPlan(plan)) {
    return HOUSE_OPENAI_KEY || null;
  }
  const key = (ctx.user.settings?.openaiKey || "").trim();
  return key || null;
}

function seedReportsForUser(db, email) {
  if (!Array.isArray(db.reports)) db.reports = [];
  const already = db.reports.some((r) => r.email === email);
  if (already) return false;
  const now = Date.now();
  const seeded = SAMPLE_REPORTS.map((sample, idx) => ({
    id: `demo-${email}-${idx + 1}`,
    email,
    createdAt: new Date(now - idx * 3 * 60 * 60 * 1000).toISOString(),
    ...sample,
  }));
  db.reports.push(...seeded);
  return true;
}

function listReports(email) {
  const db = readDB();
  const seeded = seedReportsForUser(db, email);
  if (seeded) writeDB(db);
  return db.reports
    .filter((r) => r.email === email)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function getReport(email, id) {
  const db = readDB();
  const report = db.reports.find((r) => r.email === email && r.id === id);
  if (!report) return null;
  return report;
}

/* TRANSACTIONS (retained for potential auditing) */
function addTransaction({ email, amount, type, stripeId, meta }) {
  const db = readDB();
  const tx = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    email,
    amount: Number(amount || 0),
    type,
    stripeId: stripeId || null,
    meta: meta || null,
    date: new Date().toISOString(),
  };
  db.transactions.push(tx);
  writeDB(db);
  return tx;
}

function getTransactions(email, limit = 50) {
  const db = readDB();
  return db.transactions
    .filter((t) => t.email === email)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, limit);
}

module.exports = {
  upsertUser,
  getUser,
  listUsers,
  getSettings,
  updateSettings,
  getSubscription,
  updateSubscription,
  getEffectiveOpenAIKey,
  usesHouseOpenAIPlan,
  listReports,
  getReport,
  addTransaction,
  getTransactions,
};
