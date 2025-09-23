"use strict";

const path = require("path");
const {
  beginVetterRun,
  finalizeVetterRun,
  failVetterRun,
  computeNextRun,
} = require("../../config/db");
const { runInboxPipeline, GmailTokenMissingError } = require("./pipeline");

function summarizeResults(results = []) {
  const summary = { total: 0, important: 0, trash: 0, keep: 0 };
  results.forEach((item) => {
    summary.total += 1;
    const action = (item.action || "").toUpperCase();
    if (action === "IMPORTANT") summary.important += 1;
    else if (action === "TRASH") summary.trash += 1;
    else summary.keep += 1;
  });
  return summary;
}

function buildReportRecord({ email, run, summary }) {
  const createdAt = run.report.generatedAt || new Date().toISOString();
  const id = `inbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const descriptor = run.descriptor;
  const title = summary.important
    ? `Important inbox alerts (${summary.important})`
    : `Inbox review (${summary.total} messages)`;
  const description = summary.important
    ? `${summary.important} message(s) flagged as important.`
    : `Reviewed ${summary.total} message(s); nothing marked important.`;
  const snippet = `Important ${summary.important} • Trash ${summary.trash} • Keep ${summary.keep}`;
  const status = summary.important ? "urgent" : "completed";
  const reportPathRelative = path.relative(process.cwd(), run.report.path);

  return {
    id,
    email,
    title,
    description,
    snippet,
    status,
    createdAt,
    meta: {
      descriptor,
      stats: summary,
      reportFile: run.report.fileName,
      reportPath: reportPathRelative,
      results: run.results,
    },
  };
}

async function executeInboxRun(email, { overrides = {}, trigger = "manual", log } = {}) {
  const start = beginVetterRun(email);
  if (!start) {
    return { ok: false, error: "User not found" };
  }
  if (start.alreadyActive) {
    return { ok: false, alreadyActive: true, vetter: start.vetter };
  }

  const ctx = start.ctx;
  const logs = [];
  const logFn = (message, level = "info") => {
    logs.push({ message, level });
    if (typeof log === "function") {
      try {
        log(message, level);
      } catch (err) {
        // ignore log handler errors
      }
    }
  };

  try {
    const state = {
      processedMessageIds: ctx.user.vetter.processedMessageIds || [],
    };
    logFn("Collecting Gmail messages.");
    const run = await runInboxPipeline({
      email,
      settings: ctx.user.settings,
      overrides,
      state,
      log: logFn,
    });
    const summary = summarizeResults(run.results);
    logFn(`Review complete: Important ${summary.important}, Trash ${summary.trash}, Keep ${summary.keep}.`, "success");

    const reportRecord = buildReportRecord({ email, run, summary });
    const finalize = finalizeVetterRun(ctx, {
      reportRecord,
      processedMessageIds: run.processedMessageIds,
      logs,
      nextRunAt: overrides.nextRunAt || computeNextRun(run.report.generatedAt),
    });

    return {
      ok: true,
      vetter: finalize?.vetter || null,
      events: finalize?.logs || [],
      report: reportRecord,
      stats: summary,
      descriptor: run.descriptor,
    };
  } catch (err) {
    const failure = failVetterRun(ctx, err?.message || String(err));
    return {
      ok: false,
      error: err,
      vetter: failure?.vetter || null,
      events: failure?.logs || [],
    };
  }
}

async function runManualInbox(email, options = {}) {
  return executeInboxRun(email, { ...options, trigger: "manual" });
}

async function runScheduledInbox(email, options = {}) {
  return executeInboxRun(email, { ...options, trigger: "scheduled" });
}

module.exports = {
  runManualInbox,
  runScheduledInbox,
  summarizeResults,
  buildReportRecord,
};
