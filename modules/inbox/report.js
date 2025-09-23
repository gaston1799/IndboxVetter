"use strict";

const fs = require("fs");
const path = require("path");
const { ensureWorkspace } = require("./gmail");

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function actionBadge(action) {
  const color = action === "IMPORTANT" ? "#10b981" : action === "TRASH" ? "#ef4444" : "#3b82f6";
  return `<span class="badge" data-kind="${escapeHtml(action)}" style="background:${color}">${escapeHtml(action)}</span>`;
}

function scamPill(isScam) {
  return `<span class="pill ${isScam ? "pill-scam" : "pill-ok"}">${isScam ? "SCAM" : "Not Scam"}</span>`;
}

function attachmentListHTML(list = []) {
  if (!Array.isArray(list) || !list.length) return `<span class="att none">—</span>`;
  const items = list
    .map((att) => {
      const label = `${kindEmoji(att.kind)} ${att.filename || "(file)"}`;
      const hint = `${att.mimeType || ""}${att.sizeMB ? ` • ${humanMB(att.sizeMB)}` : ""}`;
      return `<li class="att" title="${escapeHtml(hint)}">${escapeHtml(label)}</li>`;
    })
    .join("");
  return `<ul class="att-list">${items}</ul>`;
}

function kindEmoji(kind) {
  return kind === "image"
    ? "??"
    : kind === "pdf"
    ? "??"
    : kind === "text"
    ? "??"
    : kind === "skipped"
    ? "?"
    : "??";
}

function humanMB(n) {
  const num = Number(n || 0);
  if (!Number.isFinite(num) || num <= 0) return "";
  return `${num.toFixed(num < 1 ? 2 : 1)} MB`;
}

function gmailLink(id) {
  return id ? `https://mail.google.com/mail/u/0/#all/${id}` : null;
}

function renderHTML({ results, generatedAt, descriptor }) {
  const rows = results
    .map((r, index) => {
      const link = gmailLink(r.id);
      return `<tr>
        <td class="idx">${index + 1}</td>
        <td class="date">${escapeHtml(r.receivedAt || "")}</td>
        <td class="from">${escapeHtml(r.from || "")}</td>
        <td class="subject">${
          link
            ? `<a href="${link}" target="_blank" rel="noopener">${escapeHtml(r.subject || "(no subject)")}</a>`
            : escapeHtml(r.subject || "(no subject)")
        }</td>
        <td class="action">${actionBadge(r.action)}</td>
        <td class="scam">${scamPill(r.is_scam)}</td>
        <td class="conf">${(r.confidence ?? 0).toFixed(2)}</td>
        <td class="labels">${escapeHtml((r.labelsApplied || []).join(", "))}</td>
        <td class="reason">${escapeHtml(r.reason || "")}</td>
        <td class="atts">${attachmentListHTML(r.attachments)}</td>
      </tr>`;
    })
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>InboxVetter Report</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  :root {
  color-scheme: dark;
  --bg: #0b0f17;
  --panel: #0f172a;
  --thead: #0b1222;
  --hover: #0c1426;
  --row-alt: #0d162a;
  --text: #e5e7eb;
  --muted: #93a4bc;
  --border: #1f2937;
  --badge-keep: #3b82f6;
  --badge-trash: #ef4444;
  --badge-important: #10b981;
  --pill-scam-bg: #1b0f12;
  --pill-scam-text: #fca5a5;
  --pill-scam-border: #7f1d1d;
  --pill-ok-bg: #0f1a14;
  --pill-ok-text: #bbf7d0;
  --pill-ok-border: #065f46;
  --shadow: 0 12px 28px rgba(0,0,0,.45);
  }
  html, body { background: var(--bg); }
  body {
    color: var(--text);
    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
    margin: 24px;
  }
  h1 { margin: 0 0 12px; }
  .meta { color: var(--muted); margin-bottom: 18px; }
  table {
    width: 100%;
    border-collapse: collapse;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: var(--shadow);
    overflow: hidden;
  }
  th, td {
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }
  th {
    text-align: left;
    background: var(--thead);
    position: sticky;
    top: 0;
    z-index: 1;
  }
  tbody tr:nth-child(odd) { background: var(--row-alt); }
  tbody tr:hover { background: var(--hover); }
  .idx { width: 40px; color: var(--muted); }
  .date { white-space: nowrap; color: var(--muted); }
  .subject a { color: #93c5fd; text-decoration: underline; }
  .subject a:hover { color: #bfdbfe; }
  .badge { color: white; padding: 6px 10px; border-radius: 999px; font-size: 12px; letter-spacing: .2px; display: inline-flex; align-items: center; white-space: nowrap; line-height: 1; }
  .pill { display: inline-flex; align-items: center; white-space: nowrap; padding: 6px 10px; border-radius: 999px; font-size: 12px; border: 1px solid transparent; }
  .pill-scam { background: var(--pill-scam-bg); color: var(--pill-scam-text); border-color: var(--pill-scam-border); }
  .pill-ok { background: var(--pill-ok-bg); color: var(--pill-ok-text); border-color: var(--pill-ok-border); }
  .conf { text-align: right; font-variant-numeric: tabular-nums; }
  .footer { margin-top: 16px; color: var(--muted); font-size: 12px; }
  .att-list { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
  .att { background: rgba(255,255,255,0.05); border-radius: 999px; padding: 4px 10px; font-size: 12px; }
</style>
</head>
<body>
  <h1>InboxVetter – Run Report</h1>
  <div class="meta">Generated at ${escapeHtml(new Date(generatedAt).toLocaleString())} • ${results.length} item(s). IMPORTANT focus: ${escapeHtml(descriptor)}</div>
  <table>
    <thead>
      <tr><th>#</th><th>Date</th><th>From</th><th>Subject</th><th>Action</th><th>SCAM</th><th>Conf</th><th>Labels</th><th>Reason</th><th>Attachments</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">“Action” = model decision; “SCAM” = explicit scam flag.</div>
</body>
</html>`;
}

function writeReport({ email, results, descriptor }) {
  const generatedAt = new Date().toISOString();
  const workspace = ensureWorkspace(email);
  const fileName = `inbox_report-${generatedAt.replace(/[:.]/g, "-")}.html`;
  const outPath = path.join(workspace.reportDir, fileName);
  const html = renderHTML({ results, generatedAt, descriptor });
  fs.writeFileSync(outPath, html, "utf8");
  return { path: outPath, fileName, generatedAt };
}

module.exports = {
  writeReport,
  escapeHtml,
};
