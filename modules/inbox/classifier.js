"use strict";

const OpenAI = require("openai").default;
const { DEFAULT_OPENAI_MODEL } = require("./config");

let cachedClient = null;

function getOpenAIClient() {
  if (cachedClient) return cachedClient;
  const apiKey = (process.env.OPENAI_API_KEY || process.env.HOUNDOPENAI_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY (or HOUNDOPENAI_API_KEY) is required for classification.");
  }
  cachedClient = new OpenAI({ apiKey });
  return cachedClient;
}

function supportsVision(model) {
  return /^(gpt-5|gpt-4o|gpt-4\.1|gpt-4o-mini|gpt-4\.1-mini)/i.test(model);
}

function tokenParam(model, n) {
  return /^(gpt-5|o[0-9]|o1|o3|o4)/i.test(model)
    ? { max_completion_tokens: n }
    : { max_tokens: n };
}

function tempParam(model, t) {
  return /^(gpt-5|o[0-9]|o1|o3|o4)/i.test(model) ? {} : { temperature: t };
}

async function generateImportantDescriptor(settings = {}) {
  const base = String(settings.importantDesc || "").trim();
  const fallback = "sponsorships/brand deals/payments/account security/school/admin";
  if (!base) return fallback;
  try {
    const oai = getOpenAIClient();
    const prompt = `Take this description of what emails are important to the user:\n\n"${base}"\n\nRewrite it as a short phrase (max 12 words) that can fit inside parentheses after the word IMPORTANT.`;
    const resp = await oai.chat.completions.create({
      model: process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
      messages: [
        { role: "system", content: "You produce concise phrases." },
        { role: "user", content: prompt },
      ],
      max_tokens: 40,
      temperature: 0.4,
    });
    const text = resp.choices?.[0]?.message?.content || "";
    const cleaned = text.replace(/["\n]/g, " ").trim();
    return cleaned || fallback;
  } catch (err) {
    console.warn("important descriptor generation failed:", err?.message || err);
    return fallback;
  }
}

async function classifyEmail({ config, subject, from, body, attachments = [], descriptor }) {
  const openai = getOpenAIClient();
  const model = config.openaiModel || DEFAULT_OPENAI_MODEL;
  const compactBody = String(body || "").slice(0, 4000);

  const system = `You are an email screener for a streamer named Gaston.\nDecide if the email is:\n- "TRASH" (obvious scam/phish/junk/unsolicited sales),\n- "KEEP" (legit but not critical),\n- "IMPORTANT" (${descriptor || "sponsorships/brand deals/payments/account security/school/admin"}).\n\nConsider email text, and if present, attachment content (images/PDF text).\nPrefer IMPORTANT for sponsorship/payment/security even if tentative.\nReturn the result ONLY via the provided function schema.`;

  const contentParts = [
    {
      type: "text",
      text: `Subject: ${subject}\nFrom: ${from}\nBody (truncated):\n${compactBody}`,
    },
  ];

  if (supportsVision(model)) {
    for (const attachment of attachments) {
      if (attachment.kind === "image" && attachment.dataUrl) {
        contentParts.push({
          type: "image_url",
          image_url: { url: attachment.dataUrl },
        });
      }
    }
  }

  const textSnippets = attachments
    .filter((att) => (att.kind === "pdf" || att.kind === "text") && att.text)
    .map((att) => `---\nAttachment: ${att.filename} (${att.mimeType}, ${att.sizeMB?.toFixed?.(2) ?? "?"} MB)\n${att.text}`);

  if (textSnippets.length) {
    contentParts.push({ type: "text", text: `Attachment text excerpts:\n${textSnippets.join("\n")}` });
  }

  const tools = [
    {
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
            reason: { type: "string" },
          },
          required: ["action", "is_scam", "is_important", "confidence", "reason"],
          additionalProperties: false,
        },
      },
    },
  ];

  try {
    const resp = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: contentParts },
      ],
      tools,
      tool_choice: { type: "function", function: { name: "set_classification" } },
      ...tokenParam(model, 200),
      ...tempParam(model, 0.1),
    });

    const choice = resp.choices?.[0];
    const call = choice?.message?.tool_calls?.[0];
    let output;
    if (call?.function?.name === "set_classification" && call.function.arguments) {
      output = JSON.parse(call.function.arguments);
    } else {
      const text = choice?.message?.content || "";
      const match = text.match(/\{[\s\S]*\}/);
      output = match ? JSON.parse(match[0]) : null;
    }
    if (!output) throw new Error("Classifier returned no structured data");
    const action = ["TRASH", "KEEP", "IMPORTANT"].includes(output.action) ? output.action : "KEEP";
    return {
      action,
      is_scam: Boolean(output.is_scam),
      is_important: Boolean(output.is_important || action === "IMPORTANT"),
      confidence: Math.max(0, Math.min(1, Number(output.confidence) || 0)),
      reason: String(output.reason || "").slice(0, 300),
    };
  } catch (err) {
    return {
      action: "KEEP",
      is_scam: false,
      is_important: false,
      confidence: 0.2,
      reason: `OpenAI error: ${err.message || err}`,
    };
  }
}

module.exports = {
  getOpenAIClient,
  supportsVision,
  generateImportantDescriptor,
  classifyEmail,
};
