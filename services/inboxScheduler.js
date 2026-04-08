"use strict";

const { GmailTokenMissingError } = require("./inboxRunner");
const { runScheduledInbox } = require("../modules/inbox/orchestrator");
const { loadTokens } = require("./gmailTokenStore");
const {
  listUsers,
  getSubscription,
  ensureNextRunScheduled,
} = require("../config/db");

const jobs = new Map();

function hasTokens(email) {
  const tokens = loadTokens(email);
  return !!tokens;
}

async function runJob(job) {
  if (job.running) return;
  job.running = true;
  try {
    const subscription = getSubscription(job.email);
    if (!shouldAutoRun(subscription)) {
      job.logger?.info?.("Subscription inactive; stopping job.");
      stopForUser(job.email);
      return;
    }

    if (!hasTokens(job.email)) {
      job.lastError = "Missing Gmail tokens";
      job.logger?.warn?.(`Gmail tokens missing for ${job.email}; skipping run.`);
      return;
    }

    const run = await runScheduledInbox(job.email, {
      log: (msg) => job.logger?.info?.(msg),
    });
    job.lastRun = new Date().toISOString();
    job.lastError = null;

    if (run?.ok) {
      job.logger?.info?.(
        `Inbox run complete for ${job.email}. Reviewed ${run?.stats?.reviewed ?? "?"} messages.`
      );
    } else if (run?.alreadyActive) {
      job.logger?.info?.(`Inbox run already active for ${job.email}; skipping.`);
    } else {
      job.logger?.warn?.(`Inbox run for ${job.email} finished without ok flag.`);
    }
  } catch (err) {
    job.lastError = err?.message || String(err);
    if (err instanceof GmailTokenMissingError) {
      job.logger?.warn?.(`Stopping job for ${job.email}: ${job.lastError}`);
      stopForUser(job.email);
    } else {
      job.logger?.error?.(`Job run failed for ${job.email}: ${job.lastError}`);
    }
  } finally {
    job.running = false;
    if (jobs.has(job.email)) {
      scheduleJob(job);
    }
  }
}

function startForUser(email, opts = {}) {
  if (!email) return null;
  const sub = getSubscription(email);
  if (!shouldAutoRun(sub)) {
    stopForUser(email);
    return null;
  }
  const existing = jobs.get(email);
  if (existing) {
    if (opts.force) {
      stopForUser(email);
    } else {
      scheduleJob(existing);
      return existing;
    }
  }

  const job = {
    email,
    timer: null,
    running: false,
    lastRun: null,
    lastError: null,
    logger: createLogger(email),
  };

  jobs.set(email, job);
  scheduleJob(job);
  return job;
}

function stopForUser(email) {
  const job = jobs.get(email);
  if (!job) return false;
  clearTimeout(job.timer);
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

function scheduleJob(job) {
  const next = ensureNextRunScheduled(job.email);
  if (!next || !Number.isFinite(next.ts)) {
    job.logger?.warn?.("Unable to determine next run; stopping job.");
    stopForUser(job.email);
    return;
  }
  const delay = Math.max(30 * 1000, next.ts - Date.now());
  if (delay === Infinity) {
    job.logger?.warn?.("Invalid delay computed; stopping job.");
    stopForUser(job.email);
    return;
  }
  clearTimeout(job.timer);
  job.timer = setTimeout(() => runJob(job), delay);
  job.logger?.info?.(
    `Next run ${new Date(next.ts).toISOString()} (in ${Math.round(delay / 60000)}m).`
  );
}

module.exports = {
  startForUser,
  stopForUser,
  stopAll,
  bootstrap,
  getJob,
};
