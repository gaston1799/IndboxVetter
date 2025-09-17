/* index.js */
"use strict";

/* ===== Env & Deps ===== */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const http = require("http");
const { google } = require("googleapis");
const OpenAI = require("openai").default;

/* ===== Config ===== */
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const SAFE_MODE = String(process.env.SAFE_MODE || "true").toLowerCase() === "true";
const GMAIL_QUERY = process.env.GMAIL_QUERY || "label:inbox";
const OMITTED_SENDERS = (process.env.OMITTED_SENDERS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
const ALLOW_ATTACHMENTS = String(process.env.ALLOW_ATTACHMENTS || "true").toLowerCase() === "true";
const MAX_ATTACHMENT_MB = Number(process.env.MAX_ATTACHMENT_MB || 5); // skip >5MB
const MAX_IMAGES = Number(process.env.MAX_IMAGES || 3);               // don’t spam the model
const MAX_PDF_TEXT_CHARS = Number(process.env.MAX_PDF_TEXT_CHARS || 4000);


/* ===== Storage ===== */
const DATA_DIR = path.join(process.cwd(), ".data");
const LOG_DIR = path.join(process.cwd(), "logs");
const TOKEN_PATH = path.join(DATA_DIR, "token.json");
const CACHE_PATH = path.join(DATA_DIR, "processed.json");
const IMPORTANT_LOG = path.join(LOG_DIR, "important.jsonl");
for (const p of [DATA_DIR, LOG_DIR]) fs.mkdirSync(p, { recursive: true });

/* ===== Custom Logger (title + log/warn/error) ===== */
class CustomLogger {
    constructor(title = "---") {
        this.title = { body: title, color: "darkgrey", size: "1rem" };
        this.body = { color: "#008f68", size: "1rem" };
    }
    setTitleBody(title) { this.title.body = title; return this; }
    setTitleStyle({ color, size }) { if (color !== undefined) this.title.color = color; if (size !== undefined) this.title.size = size; return this; }
    setBodyStyle({ color, size }) { if (color !== undefined) this.body.color = color; if (size !== undefined) this.body.size = size; return this; }
    #print(level, body = "") {
        const prefix = `${this.title.body} | ${level.toUpperCase()}`;
        console.log(
            `%c${prefix} | %c${body}`,
            `color:${this.title.color}; font-weight:bold; font-size:${this.title.size};`,
            `color:${this.body.color}; font-weight:bold; font-size:${this.body.size}; text-shadow:0 0 5px rgba(0,0,0,0.2);`
        );
    }
    log(msg) { this.#print("log", msg); }
    warn(msg) { this.#print("warn", msg); }
    error(msg) { this.#print("error", msg); }
}
const log = new CustomLogger("InboxVetter");

/* ===== OpenAI Client ===== */
const oai = new OpenAI({
    apiKey: "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"//(process.env.OPENAI_API_KEY || "").trim(),
    // If you insist on project keys, you can add:
    // organization: process.env.OPENAI_ORG || undefined,
    // project: process.env.OPENAI_PROJECT || undefined,
});
if (!process.env.OPENAI_API_KEY || !/^sk-/.test(process.env.OPENAI_API_KEY)) {
    log.warn("OPENAI_API_KEY missing or not an sk- key. Put a classic key in .env");
}
console.log("Using OpenAI model:", OPENAI_MODEL);

/* ===== Gmail Auth (OAuth Desktop loopback; auto-open, self-close) ===== */
const SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];
const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");

function loadJSON(p, fallback) {
    try { return JSON.parse(fs.readFileSync(p, "utf8")); }
    catch { return fallback; }
}
function saveJSON(p, obj) {
    fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}
function supportsVision(model) {
    // Add any other vision-capable models you use
    return /^(gpt-5|gpt-4o|gpt-4\.1|gpt-4o-mini|gpt-4\.1-mini)/i.test(model);
}

function bytesToMB(n) { return n / (1024 * 1024); }

function flattenParts(payload, out = []) {
    if (!payload) return out;
    out.push(payload);
    if (payload.parts) payload.parts.forEach(p => flattenParts(p, out));
    return out;
}
function summarizeAttachments(list = []) {
    const c = { image: 0, pdf: 0, text: 0, other: 0, skipped: 0 };
    list.forEach(a => { c[a.kind] = (c[a.kind] || 0) + 1; });
    const parts = [];
    if (c.image) parts.push(`${c.image} img`);
    if (c.pdf) parts.push(`${c.pdf} pdf`);
    if (c.text) parts.push(`${c.text} txt`);
    if (c.other) parts.push(`${c.other} other`);
    if (c.skipped) parts.push(`${c.skipped} skipped`);
    return parts.join(", ");
}

// Gmail stores attachment data as base64url in attachments.get()
function b64urlToBuffer(data) {
    const b64 = String(data || "").replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(b64, "base64");
}

async function fetchAttachments(gmail, { id: messageId, payload }) {
    if (!ALLOW_ATTACHMENTS) return [];
    const parts = flattenParts(payload, []).filter(p => p?.filename && p.body && (p.body.attachmentId || p.body.data));
    const out = [];

    for (const p of parts) {
        const filename = p.filename || "file";
        const mimeType = p.mimeType || "application/octet-stream";
        let dataBuf = null;

        try {
            if (p.body?.attachmentId) {
                const { data } = await gmail.users.messages.attachments.get({
                    userId: "me", messageId, id: p.body.attachmentId
                });
                dataBuf = b64urlToBuffer(data.data);
            } else if (p.body?.data) {
                dataBuf = b64urlToBuffer(p.body.data);
            }
        } catch (e) {
            // couldn’t fetch; skip this attachment
            continue;
        }
        if (!dataBuf) continue;

        // Size guard
        const sizeMB = bytesToMB(dataBuf.length);
        if (sizeMB > MAX_ATTACHMENT_MB) {
            out.push({ kind: "skipped", filename, mimeType, reason: `Too large (${sizeMB.toFixed(1)} MB)` });
            continue;
        }

        // Normalize what we keep
        if (mimeType.startsWith("image/")) {
            const dataUrl = `data:${mimeType};base64,${dataBuf.toString("base64")}`;
            out.push({ kind: "image", filename, mimeType, sizeMB, dataUrl });
        } else if (mimeType === "application/pdf") {
            let text = "";
            try {
                // Try pdf-parse (optional dependency)
                const pdfParse = require("pdf-parse");
                const parsed = await pdfParse(dataBuf);
                text = String(parsed.text || "").slice(0, MAX_PDF_TEXT_CHARS);
            } catch {
                // Fallback: note we have a PDF but we couldn’t parse (missing pdf-parse)
                text = `[PDF "${filename}" present, ${sizeMB.toFixed(2)} MB, text extraction unavailable. Consider installing pdf-parse.]`;
            }
            out.push({ kind: "pdf", filename, mimeType, sizeMB, text });
        } else if (mimeType.startsWith("text/")) {
            const text = dataBuf.toString("utf8").slice(0, MAX_PDF_TEXT_CHARS);
            out.push({ kind: "text", filename, mimeType, sizeMB, text });
        } else {
            out.push({ kind: "other", filename, mimeType, sizeMB });
        }
    }

    // Prioritize a few images max; keep PDFs/texts
    const images = out.filter(a => a.kind === "image").slice(0, MAX_IMAGES);
    const nonImages = out.filter(a => a.kind !== "image");
    return [...images, ...nonImages];
}

async function getFreePort() {
    return await new Promise((resolve, reject) => {
        const s = http.createServer().listen(0, "127.0.0.1", () => {
            const port = s.address().port;
            s.close(() => resolve(port));
        }).on("error", reject);
    });
}

async function authorize() {
    const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));
    const { client_secret, client_id, redirect_uris } = creds.installed || creds.web;
    const baseRedirect = redirect_uris?.[0] || "http://localhost";

    // OAuth2 client
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, baseRedirect);

    // Persist token refreshes automatically
    oAuth2Client.on("tokens", (tokens) => {
        const current = loadJSON(TOKEN_PATH, {});
        const merged = { ...current, ...tokens };
        saveJSON(TOKEN_PATH, merged);
        log.log("Tokens refreshed & saved.");
    });

    // Use cached token if present
    const token = loadJSON(TOKEN_PATH, null);
    if (token) {
        oAuth2Client.setCredentials(token);
        return oAuth2Client;
    }

    // First-time auth: spin up loopback server
    const port = await getFreePort();
    const redirectUri = `http://127.0.0.1:${port}`;

    const codePromise = new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const url = new URL(req.url, redirectUri);
            const code = url.searchParams.get("code");
            const error = url.searchParams.get("error");

            if (error) {
                res.statusCode = 400;
                res.end(`<html><body>Auth error: ${error}. You can close this window.</body></html>`);
                server.close();
                return reject(new Error(`OAuth error: ${error}`));
            }
            if (code) {
                res.statusCode = 200;
                res.setHeader("Content-Type", "text/html");
                res.end(`<!doctype html>
<html><head><meta charset="utf-8"><title>Authorized</title></head>
<body style="font-family:system-ui;margin:2rem">
  <h2>All set ✅</h2><p>You can close this window.</p>
  <script>window.close?.(); setTimeout(()=>{},300);</script>
</body></html>`);
                server.close();
                return resolve(code);
            }
            res.statusCode = 404; res.end("No code here.");
        });
        server.listen(port, "127.0.0.1");
    });

    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: "offline",
        scope: SCOPES,
        prompt: "consent",
        redirect_uri: redirectUri
    });

    log.warn("Opening browser for Google consent…");
    const { default: open } = await import("open");
    await open(authUrl);

    const code = await codePromise;
    const { tokens } = await oAuth2Client.getToken({ code, redirect_uri: redirectUri });
    oAuth2Client.setCredentials(tokens);
    saveJSON(TOKEN_PATH, tokens);
    log.log("OAuth token saved.");
    return oAuth2Client;
}

/* ===== Gmail Helpers ===== */
function decodeB64Url(str = "") {
    const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(b64, "base64").toString("utf8");
}
function extractPlainText(payload) {
    if (!payload) return "";
    const stack = [payload];
    while (stack.length) {
        const p = stack.pop();
        if (!p) continue;
        if (p.mimeType === "text/plain" && p.body?.data) return decodeB64Url(p.body.data);
        if (p.parts) stack.push(...p.parts);
    }
    return "";
}
function getHeader(headers = [], name) {
    const h = headers.find(h => h.name?.toLowerCase() === name.toLowerCase());
    return h?.value || "";
}
function parseAddress(raw) {
    const m = raw?.match(/<?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>?/i);
    return { name: raw?.replace(/<.*?>/g, "").trim() || "", email: m ? m[1].toLowerCase() : "" };
}
function senderIsOmitted(fromEmail) {
    if (!fromEmail) return false;
    const domain = fromEmail.split("@")[1]?.toLowerCase();
    return OMITTED_SENDERS.some(entry => entry === fromEmail || entry === domain || fromEmail.endsWith(`@${entry}`));
}

/* ===== OpenAI Classification ===== */
function isG5OrReasoning(model) {
    return /^(gpt-5|o[0-9]|o1|o3|o4)/i.test(model);
}
function tokenParam(model, n) {
    return isG5OrReasoning(model) ? { max_completion_tokens: n } : { max_tokens: n };
}
function tempParam(model, t) {
    return isG5OrReasoning(model) ? {} : { temperature: t };
}

async function classifyEmail({ subject, from, body, attachments = [] }) {
    const model = OPENAI_MODEL;
    const compactBody = String(body || "").slice(0, 4000);

    const system = `You are an email screener for a streamer named Gaston.
Decide if the email is:
- "TRASH" (obvious scam/phish/junk/unsolicited sales),
- "KEEP" (legit but not critical),
- "IMPORTANT" (sponsorships/brand deals/payments/account security/school/admin).

Consider email text, and if present, attachment content (images/PDF text).
Prefer IMPORTANT for sponsorship/payment/security even if tentative.
Return the result ONLY via the provided function schema.`;

    // Build multi-part user content
    const contentParts = [
        {
            type: "text", text:
                `Subject: ${subject}
From: ${from}
Body (truncated):
${compactBody}`
        }
    ];

    // Images → include as vision inputs if supported
    if (supportsVision(model)) {
        for (const a of attachments) {
            if (a.kind === "image" && a.dataUrl) {
                contentParts.push({ type: "image_url", image_url: { url: a.dataUrl } });
            }
        }
    }

    // PDFs / text attachments → include first N chars of extracted text
    const textSnippets = attachments
        .filter(a => (a.kind === "pdf" || a.kind === "text") && a.text)
        .map(a => `---\nAttachment: ${a.filename} (${a.mimeType}, ${a.sizeMB?.toFixed?.(2) ?? "?"} MB)\n${a.text}`);
    if (textSnippets.length) {
        contentParts.push({ type: "text", text: `Attachment text excerpts:\n${textSnippets.join("\n")}` });
    }

    const tools = [{
        type: "function",
        function: {
            name: "set_classification",
            description: "Return the email classification in strict schema.",
            parameters: {
                type: "object",
                properties: {
                    action: { type: "string", enum: ["TRASH", "KEEP", "IMPORTANT"] },
                    is_scam: { type: "boolean" },
                    is_important: { type: "boolean" },
                    confidence: { type: "number", minimum: 0, maximum: 1 },
                    reason: { type: "string" }
                },
                required: ["action", "is_scam", "is_important", "confidence", "reason"],
                additionalProperties: false
            }
        }
    }];

    try {
        const resp = await oai.chat.completions.create({
            model,
            messages: [
                { role: "system", content: system },
                { role: "user", content: contentParts } // <-- array content w/ images & text
            ],
            tools,
            tool_choice: { type: "function", function: { name: "set_classification" } },
            ...tokenParam(model, 200),
            ...tempParam(model, 0.1),
        });

        const choice = resp.choices?.[0];
        const call = choice?.message?.tool_calls?.[0];

        let out;
        if (call?.function?.name === "set_classification" && call.function.arguments) {
            out = JSON.parse(call.function.arguments);
        } else {
            const text = choice?.message?.content || "";
            const m = text.match(/\{[\s\S]*\}/);
            out = m ? JSON.parse(m[0]) : null;
        }
        if (!out) throw new Error("No JSON");

        const action = ["TRASH", "KEEP", "IMPORTANT"].includes(out.action) ? out.action : "KEEP";
        return {
            action,
            is_scam: !!out.is_scam,
            is_important: !!out.is_important,
            confidence: Math.max(0, Math.min(1, Number(out.confidence) || 0)),
            reason: String(out.reason || "").slice(0, 300)
        };
    } catch (err) {
        return {
            action: "KEEP",
            is_scam: false,
            is_important: false,
            confidence: 0.2,
            reason: `OpenAI parse/error: ${err.message || String(err)}`
        };
    }
}
async function classifyEmail_({ subject, from, body }) {
    const model = OPENAI_MODEL;
    const compactBody = String(body || "").slice(0, 4000);

    const system = `You are an email screener for a streamer named Gaston.
Decide if the email is:
- "TRASH" (obvious scam/phish/junk/unsolicited sales),
- "KEEP" (legit but not critical),
- "IMPORTANT" (sponsorships/brand deals/payments/account security/school/admin).

Return the result ONLY by calling the provided function with strict JSON.
Prefer IMPORTANT for potential sponsorship/payment/security even if tentative.`;

    const user = `Subject: ${subject}
From: ${from}
Body (truncated):
${compactBody}`;

    const tools = [{
        type: "function",
        function: {
            name: "set_classification",
            description: "Return the email classification in strict schema.",
            parameters: {
                type: "object",
                properties: {
                    action: { type: "string", enum: ["TRASH", "KEEP", "IMPORTANT"] },
                    is_scam: { type: "boolean" },
                    is_important: { type: "boolean" },
                    confidence: { type: "number", minimum: 0, maximum: 1 },
                    reason: { type: "string" }
                },
                required: ["action", "is_scam", "is_important", "confidence", "reason"],
                additionalProperties: false
            }
        }
    }];

    try {
        const resp = await oai.chat.completions.create({
            model,
            messages: [
                { role: "system", content: system },
                { role: "user", content: user }
            ],
            tools,
            tool_choice: { type: "function", function: { name: "set_classification" } },
            ...tokenParam(model, 200),
            ...tempParam(model, 0.1),
        });

        const choice = resp.choices?.[0];
        const call = choice?.message?.tool_calls?.[0];

        let out;
        if (call?.function?.name === "set_classification" && call.function.arguments) {
            out = JSON.parse(call.function.arguments);
        } else {
            const text = choice?.message?.content || "";
            const m = text.match(/\{[\s\S]*\}/);
            out = m ? JSON.parse(m[0]) : null;
        }
        if (!out) throw new Error("No JSON");

        const action = ["TRASH", "KEEP", "IMPORTANT"].includes(out.action) ? out.action : "KEEP";
        return {
            action,
            is_scam: !!out.is_scam,
            is_important: !!out.is_important,
            confidence: Math.max(0, Math.min(1, Number(out.confidence) || 0)),
            reason: String(out.reason || "").slice(0, 300)
        };
    } catch (err) {
        return {
            action: "KEEP",
            is_scam: false,
            is_important: false,
            confidence: 0.2,
            reason: `OpenAI parse/error: ${err.message || String(err)}`
        };
    }
}

/* ===== Labels ===== */
async function ensureLabels(gmail) {
    const { data } = await gmail.users.labels.list({ userId: "me" });
    const want = ["REVIEW_SPAM", "IMPORTANT_TO_ME", "SCAM"];
    const map = Object.fromEntries((data.labels || []).map(l => [l.name, l.id]));
    for (const name of want) {
        if (!map[name]) {
            const { data: created } = await gmail.users.labels.create({
                userId: "me",
                requestBody: { name, labelListVisibility: "labelShow", messageListVisibility: "show" }
            });
            map[name] = created.id;
        }
    }
    return map;
}

/* ===== Report Helpers ===== */
function escapeHtml(s = "") {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function actionBadge(action) {
    const color = action === "IMPORTANT" ? "#10b981" : action === "TRASH" ? "#ef4444" : "#3b82f6";
    return `<span class="badge" style="background:${color}">${action}</span>`;
}
function scamBadge(isScam) {
    return `<span class="pill ${isScam ? "pill-scam" : "pill-ok"}">${isScam ? "SCAM" : "Not Scam"}</span>`;
}
function gmailMsgLink(messageId) {
    return messageId ? `https://mail.google.com/mail/u/0/#all/${messageId}` : null;
}
function renderReportHTML(items) {
    const rows = items.map((r, i) => {
        const link = gmailMsgLink(r.id);
        return `<tr>
      <td class="idx">${i + 1}</td>
      <td class="date">${escapeHtml(r.receivedAt || "")}</td>
      <td class="from">${escapeHtml(r.from || "")}</td>
      <td class="subject">${link ? `<a href="${link}" target="_blank" rel="noopener">${escapeHtml(r.subject || "(no subject)")}</a>` : escapeHtml(r.subject || "(no subject)")}</td>
      <td class="action">${actionBadge(r.action)}</td>
      <td class="scam">${scamBadge(r.is_scam)}</td>
      <td class="conf">${(r.confidence ?? 0).toFixed(2)}</td>
      <td class="labels">${escapeHtml((r.labelsApplied || []).join(", "))}</td>
      <td class="reason">${escapeHtml(r.reason || "")}</td>
      <td class="atts">${attachmentListHTML(r.attachments)}</td>
    </tr>`;
    }).join("");

    return `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>InboxVetter Report</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  :root {
  color-scheme: dark;
  /* palette */
  --bg: #0b0f17;
  --panel: #0f172a;
  --thead: #0b1222;
  --hover: #0c1426;
  --row-alt: #0d162a;
  --text: #e5e7eb;
  --muted: #93a4bc;
  --border: #1f2937;

  --badge-keep: #3b82f6;       /* blue */
  --badge-trash: #ef4444;      /* red */
  --badge-important: #10b981;  /* green */

  --pill-scam-bg: #1b0f12;
  --pill-scam-text: #fca5a5;
  --pill-scam-border: #7f1d1d;

  --pill-ok-bg: #0f1a14;
  --pill-ok-text: #bbf7d0;
  --pill-ok-border: #065f46;

  --shadow: 0 12px 28px rgba(0,0,0,.45);
}

html, body {
  background: var(--bg);
}
body {
  color: var(--text);
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
  margin: 24px;
}

/* headings & meta */
h1 { margin: 0 0 12px; }
.meta { color: var(--muted); margin-bottom: 18px; }

/* table */
table {
  width: 100%;
  border-collapse: collapse;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: var(--shadow);
  overflow: hidden; /* keeps rounded corners on sticky header */
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

/* cols */
.idx { width: 40px; color: var(--muted); }
.date { white-space: nowrap; color: var(--muted); }
.subject a {
  color: #93c5fd;
  text-decoration: underline;
}
.subject a:hover { color: #bfdbfe; }

/* badges & pills */
.badge {
  color: white;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  letter-spacing: .2px;
}
.badge[data-kind="KEEP"] { background: var(--badge-keep); }
.badge[data-kind="TRASH"] { background: var(--badge-trash); }
.badge[data-kind="IMPORTANT"] { background: var(--badge-important); }

.pill {
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  border: 1px solid transparent;
}
.pill-scam {
  background: var(--pill-scam-bg);
  color: var(--pill-scam-text);
  border-color: var(--pill-scam-border);
}
.pill-ok {
  background: var(--pill-ok-bg);
  color: var(--pill-ok-text);
  border-color: var(--pill-ok-border);
}
.badge,
.pill {
  display: inline-flex;
  align-items: center;
  white-space: nowrap;     /* <- no wrap */
  line-height: 1;          /* avoids vertical clipping */
  padding: 6px 10px;       /* a lil taller so it doesn't look chopped */
  border-radius: 999px;
}

/* scam column: don't let it squish */
td.scam {
  white-space: nowrap;
  min-width: 100px;        /* 90–110px also fine */
  overflow: visible;       /* just in case */
}
/* numbers & footer */
.conf { text-align: right; font-variant-numeric: tabular-nums; }
.footer { margin-top: 16px; color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
  <h1>InboxVetter — Run Report</h1>
  <div class="meta">
    Generated at ${escapeHtml(new Date().toLocaleString())} · ${items.length} item(s)
  </div>
  <table>
    <thead>
      <tr><th>#</th><th>Date</th><th>From</th><th>Subject</th><th>Action</th><th>SCAM</th><th>Conf</th><th>Labels</th><th>Reason</th><th>Attachments</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">“Action” = model’s decision; “SCAM” = explicit scam flag.</div>
  <script>window.focus?.();</script>
</body>
</html>`;
}
async function writeReportAndOpen(items) {
    const fileName = `inbox_report-${new Date().toISOString().replace(/[:.]/g, "-")}.html`;
    const outPath = path.join(LOG_DIR, fileName);
    fs.writeFileSync(outPath, renderReportHTML(items), "utf8");
    const { default: open } = await import("open");
    await open(outPath);
    log.log(`Opened report: ${outPath}`);
}
function humanMB(n) {
  const v = Number(n || 0);
  if (!isFinite(v) || v <= 0) return "";
  return `${v.toFixed(v < 1 ? 2 : 1)} MB`;
}
function kindEmoji(kind) {
  return kind === "image" ? "🖼️"
       : kind === "pdf"   ? "📄"
       : kind === "text"  ? "📝"
       : kind === "skipped" ? "⛔"
       : "📎";
}
function attachmentListHTML(list = []) {
  if (!list.length) return `<span class="att none">—</span>`;
  const items = list.map(a => {
    const label = `${kindEmoji(a.kind)} ${a.filename || "(file)"}`
    const hint  = `${a.mimeType || ""}${a.sizeMB ? ` • ${humanMB(a.sizeMB)}` : ""}`;
    return `<li class="att" title="${escapeHtml(hint)}">${escapeHtml(label)}</li>`;
  }).join("");
  return `<ul class="att-list">${items}</ul>`;
}

/* ===== Main ===== */
async function processInbox() {

    const auth = await authorize();
    const gmail = google.gmail({ version: "v1", auth });

    const labels = await ensureLabels(gmail);
    const processed = loadJSON(CACHE_PATH, { ids: [] });
    const seen = new Set(processed.ids);

    const listResp = await gmail.users.messages.list({
        userId: "me",
        q: GMAIL_QUERY,
        maxResults: 200
    });
    const ids = (listResp.data.messages || []).map(m => m.id).filter(id => !seen.has(id));

    if (!ids.length) {
        log.log("No new messages to review.");
        await writeReportAndOpen([]); // open a report anyway for consistency
        return;
    }

    log.log(`Reviewing ${ids.length} message(s)…`);
    const results = [];

    for (const id of ids) {
        try {
            const { data: msg } = await gmail.users.messages.get({
                userId: "me",
                id,
                format: "full"
            });
            const attachments = await fetchAttachments(gmail, { id, payload: msg.payload });
            const headers = msg.payload?.headers || [];
            const fromRaw = getHeader(headers, "From");
            const { email: fromEmail } = parseAddress(fromRaw);
            const subject = getHeader(headers, "Subject") || "(no subject)";
            const snippet = msg.snippet || "";
            const plain = extractPlainText(msg.payload);
            const body = plain || snippet;
            const receivedAt = msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : "";
            const labelsApplied = [];
             const attachmentsMeta = (attachments || []).map(a => ({
                kind: a.kind,                   // "image" | "pdf" | "text" | "other" | "skipped"
                filename: a.filename || "",
                mimeType: a.mimeType || "",
                sizeMB: typeof a.sizeMB === "number" ? a.sizeMB : (a.dataUrl ? (a.dataUrl.length * 3 / 4) / (1024 * 1024) : 0)
            }));
            if (senderIsOmitted(fromEmail)) {
                log.log(`OMITTED: ${fromEmail} | ${subject}`);
                results.push({
                    id, from: fromRaw, subject, receivedAt,
                    action: "KEEP", is_scam: false, is_important: false,
                    confidence: 1, reason: "Omitted sender domain", labelsApplied: ["(omitted)"]
                });
                seen.add(id); saveJSON(CACHE_PATH, { ids: Array.from(seen) });
                continue;
            }

            const verdict = await classifyEmail({ subject, from: fromRaw, body });
            const info = `${verdict.action} (conf ${verdict.confidence}) — ${verdict.reason}`;

            async function addLabels(addLabelIds) {
                if (addLabelIds?.length) {
                    await gmail.users.messages.modify({
                        userId: "me",
                        id,
                        requestBody: { addLabelIds: addLabelIds }
                    });
                }
            }

            if (verdict.action === "TRASH" || verdict.is_scam) {
                await addLabels([labels.SCAM]); labelsApplied.push("SCAM");
                if (SAFE_MODE) {
                    await addLabels([labels.REVIEW_SPAM]); labelsApplied.push("REVIEW_SPAM");
                    log.warn(`FLAGGED (SAFE_MODE): ${fromEmail} | ${subject} -> [${labelsApplied.join(", ")}] | ${info}`);
                } else {
                    await gmail.users.messages.trash({ userId: "me", id });
                    log.warn(`TRASHED: ${fromEmail} | ${subject} -> [${labelsApplied.join(", ")}] | ${info}`);
                }
            } else if (verdict.action === "IMPORTANT" || verdict.is_important) {
                await addLabels([labels.IMPORTANT_TO_ME]); labelsApplied.push("IMPORTANT_TO_ME");
                const entry = {
                    id,
                    dateISO: new Date().toISOString(),
                    from: fromRaw,
                    subject,
                    reason: verdict.reason,
                    confidence: verdict.confidence
                };
                fs.appendFileSync(IMPORTANT_LOG, JSON.stringify(entry) + "\n");
                log.log(`IMPORTANT: ${fromEmail} | ${subject} -> [${labelsApplied.join(", ")}] (logged)`);
            } else {
                log.log(`KEEP: ${fromEmail} | ${subject} | ${info}`);
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
                attachments: attachmentsMeta
            });

            seen.add(id);
            saveJSON(CACHE_PATH, { ids: Array.from(seen) });
        } catch (err) {
            log.error(`Processing failed for message ${id}: ${err?.message || err}`);
        }
    }

    await writeReportAndOpen(results);
    log.log("Done.");
}

/* Kickoff */
processInbox().catch(e => {
    log.error(e.stack || String(e));
    process.exit(1);
});
