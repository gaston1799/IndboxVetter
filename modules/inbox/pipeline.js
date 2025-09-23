"use strict";

const path = require("path");
const {
  buildRunConfig,
} = require("./config");
const {
  getAuthorizedGmail,
  listMessages,
  getMessage,
  fetchAttachments,
  getHeader,
  extractPlainText,
  ensureLabels,
  senderIsOmitted,
  summarizeAttachments,
  GmailTokenMissingError,
} = require("./gmail");
const {
  generateImportantDescriptor,
  classifyEmail,
} = require("./classifier");
const { writeReport } = require("./report");

function parseAddress(raw) {
  const match = raw?.match(/<?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>?/i);
  return {
    name: raw?.replace(/<.*?>/g, "").trim() || "",
    email: match ? match[1].toLowerCase() : "",
  };
}

function buildLog(log) {
  if (typeof log === "function") return log;
  return () => {};
}

async function runInboxPipeline({ email, settings = {}, overrides = {}, state = {}, log }) {
  const logger = buildLog(log);
  const config = buildRunConfig(settings, overrides);
  const descriptor = await generateImportantDescriptor(settings);

  const { gmail } = await getAuthorizedGmail(email);
  const labels = await ensureLabels(gmail);

  const existingIds = Array.isArray(state.processedMessageIds) ? new Set(state.processedMessageIds) : new Set();

  logger(`Fetching Gmail messages with query "${config.gmailQuery}" (max ${config.gmailMaxResults}).`);
  const messageIds = await listMessages(gmail, {
    query: config.gmailQuery,
    maxResults: config.gmailMaxResults,
  });
  const newIds = messageIds.filter((id) => id && !existingIds.has(id));
  if (!newIds.length) {
    logger("No new messages to review.");
    const reportMeta = writeReport({ email, results: [], descriptor });
    return {
      results: [],
      report: {
        path: reportMeta.path,
        fileName: reportMeta.fileName,
        generatedAt: reportMeta.generatedAt,
      },
      processedMessageIds: Array.from(existingIds),
      stats: { reviewed: 0, skipped: 0 },
      descriptor,
    };
  }

  logger(`Reviewing ${newIds.length} message(s).`);
  const results = [];
  let skipped = 0;

  for (const id of newIds) {
    try {
      const message = await getMessage(gmail, id);
      const headers = message.payload?.headers || [];
      const subject = getHeader(headers, "Subject") || "(no subject)";
      const fromRaw = getHeader(headers, "From");
      const { email: fromEmail } = parseAddress(fromRaw);

      if (senderIsOmitted(fromEmail, (settings.omittedSenders || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean))) {
        logger(`Omitted via preference: ${fromEmail} | ${subject}`);
        skipped += 1;
        existingIds.add(id);
        continue;
      }

      const attachments = await fetchAttachments(gmail, email, message, config);
      const snippet = message.snippet || "";
      const plain = extractPlainText(message.payload);
      const body = plain || snippet;
      const receivedAt = message.internalDate ? new Date(Number(message.internalDate)).toISOString() : "";

      const verdict = await classifyEmail({
        config,
        subject,
        from: fromRaw,
        body,
        attachments,
        descriptor,
      });

      const labelsApplied = [];
      const addLabels = async (labelIds) => {
        if (!labelIds?.length) return;
        await gmail.users.messages.modify({
          userId: "me",
          id,
          requestBody: {
            addLabelIds: labelIds,
          },
        });
      };

      if (verdict.action === "TRASH" || verdict.is_scam) {
        await addLabels([labels.SCAM]);
        labelsApplied.push("SCAM");
        if (config.safeMode) {
          await addLabels([labels.REVIEW_SPAM]);
          labelsApplied.push("REVIEW_SPAM");
          logger(`Flagged (SAFE_MODE): ${fromEmail} | ${subject}`);
        } else {
          await gmail.users.messages.trash({ userId: "me", id });
          logger(`Trashed: ${fromEmail} | ${subject}`);
        }
      } else if (verdict.action === "IMPORTANT" || verdict.is_important) {
        await addLabels([labels.IMPORTANT_TO_ME]);
        labelsApplied.push("IMPORTANT_TO_ME");
        logger(`Important: ${fromEmail} | ${subject}`);
      } else {
        logger(`Keep: ${fromEmail} | ${subject}`);
      }

      results.push({
        id,
        from: fromRaw,
        subject,
        receivedAt,
        action: verdict.action,
        is_scam: verdict.is_scam,
        is_important: verdict.is_important,
        confidence: verdict.confidence,
        reason: verdict.reason,
        labelsApplied,
        attachments: attachments.map((att) => ({
          kind: att.kind,
          filename: att.filename || "",
          mimeType: att.mimeType || "",
          sizeMB: typeof att.sizeMB === "number" ? att.sizeMB : 0,
          summary: summarizeAttachments([att]),
        })),
      });

      existingIds.add(id);
    } catch (err) {
      logger(`Processing failed for message ${id}: ${err?.message || err}`, "error");
      existingIds.add(id);
    }
  }

  const reportMeta = writeReport({ email, results, descriptor });

  return {
    results,
    report: {
      path: reportMeta.path,
      fileName: reportMeta.fileName,
      generatedAt: reportMeta.generatedAt,
    },
    processedMessageIds: Array.from(existingIds),
    stats: {
      reviewed: results.length,
      skipped,
    },
    descriptor,
  };
}

module.exports = {
  runInboxPipeline,
  GmailTokenMissingError,
};
