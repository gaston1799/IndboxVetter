"use strict";

const { runInboxOnce, MissingGmailTokensError, summarizeAttachments } = require("./inboxRunner");
const { loadTokens } = require("./gmailTokenStore");
const {
  listUsers,
  getSubscription,
  saveReports,
} = require("../config/db");

const DEFAULT_INTERVAL_MS = parseInt(process.env.INBOX_POLL_INTERVAL_MS, 10) || 5 * 60 * 1000;
const MIN_INTERVAL_MS = 60 * 1000;

const jobs = new Map();

function normalizeInterval(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_INTERVAL_MS;
  return Math.max(MIN_INTERVAL_MS, n);
}

function hasTokens(email) {
  const tokens = loadTokens(email);
  return !!tokens;
}

function actionToStatus(action) {
  if (action === "IMPORTANT") return "urgent";
  if (action === "TRASH") return "completed";
  return "needs_review";
}

function toReportRecords(email, run) {
  if (!run?.results?.length) return [];
  const createdAt = run.runAt || new Date().toISOString();
  return run.results.map((item) => ({
    id: item.id,
    createdAt: item.receivedAt || createdAt,
    title: item.subject || "(no subject)",
    description: item.reason || "",
    status: actionToStatus(item.action),
    snippet: `${item.action} • ${(item.reason || "").slice(0, 160)}`,
    meta: {
      action: item.action,
      isScam: item.is_scam,
      isImportant: item.is_important,
      confidence: item.confidence,
      labelsApplied: item.labelsApplied,
      attachments: item.attachments,
      attachmentsSummary: summarizeAttachments(item.attachments),
      receivedAt: item.receivedAt,
      runAt: run.runAt,
      reportPath: run.reportPath,
    },
  }));
}

async function runJob(job) {
  if (job.running) return;
  job.running = true;
  try {
    if (!hasTokens(job.email)) {
      job.lastError = "Missing Gmail tokens";
      job.logger?.warn?.(`Gmail tokens missing for ${job.email}; skipping run.`);
      return;
    }

    const run = await runInboxOnce(job.email);
    job.lastRun = new Date().toISOString();
    job.lastError = null;

    const records = toReportRecords(job.email, run);
    if (records.length) {
      saveReports(job.email, records);
      job.logger?.info?.(`Saved ${records.length} classified email(s) for ${job.email}.`);
    } else {
      job.logger?.info?.(`Processed inbox for ${job.email}; no new items.`);
    }
  } catch (err) {
    job.lastError = err?.message || String(err);
    if (err instanceof MissingGmailTokensError) {
      job.logger?.warn?.(`Stopping job for ${job.email}: ${job.lastError}`);
      stopForUser(job.email);
    } else {
      job.logger?.error?.(`Job run failed for ${job.email}: ${job.lastError}`);
    }
  } finally {
    job.running = false;
  }
}

function startForUser(email, opts = {}) {
  if (!email) return null;
  const sub = getSubscription(email);
  if (!shouldAutoRun(sub)) {
    stopForUser(email);
    return null;
  }
  const intervalMs = normalizeInterval(opts.intervalMs || DEFAULT_INTERVAL_MS);
  const existing = jobs.get(email);
  if (existing) {
    if (existing.intervalMs === intervalMs) {
      return existing;
    }
    stopForUser(email);
  }

  const job = {
    email,
    intervalMs,
    timer: null,
    running: false,
    lastRun: null,
    lastError: null,
    logger: createLogger(email),
  };

  job.timer = setInterval(() => {
    runJob(job);
  }, intervalMs);

  jobs.set(email, job);
  setImmediate(() => runJob(job));
  job.logger.info(`Scheduled inbox processing every ${Math.round(intervalMs / 1000)}s.`);
  return job;
}


function stopForUser(email) {
  const job = jobs.get(email);
  if (!job) return false;
  clearInterval(job.timer);
  jobs.delete(email);
  job.logger?.info?.("Stopped inbox processing job.");
  return true;
}

function stopAll() {
  for (const email of Array.from(jobs.keys())) {
    stopForUser(email);
  }
}

async function bootstrap() {
  const users = listUsers();
  for (const user of users) {
    const sub = getSubscription(user.email);
    if (!shouldAutoRun(sub)) continue;
    if (!hasTokens(user.email)) continue;
    startForUser(user.email);
  }
}

function shouldAutoRun(sub) {
  if (!sub) return false;
  const plan = (sub.plan || "").toLowerCase();
  if (!plan || plan === "free") return false;
  const status = (sub.status || "").toLowerCase();
  if (status === "canceled") return false;
  if (status === "scheduled_for_cancellation") {
    const renewsAt = sub.renewsAt ? new Date(sub.renewsAt) : null;
    if (renewsAt && renewsAt.getTime() > Date.now()) {
      return true;
    }
    return false;
  }
  return true;
}


function createLogger(email) {
  const prefix = `[Scheduler][${email}]`;
  return {
    info: (...args) => console.log(prefix, ...args),
    warn: (...args) => console.warn(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),
  };
}

function getJob(email) {
  return jobs.get(email) || null;
}

module.exports = {
  startForUser,
  stopForUser,
  stopAll,
  bootstrap,
  getJob,
};






