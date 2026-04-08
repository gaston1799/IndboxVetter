"use strict";

const OPENAI_KEY_ENV_ORDER = [
  "HOUSE_OPENAI_KEY",
  "OPENAI_API_KEY",
  "HOUNDOPENAI_API_KEY",
];

function listConfiguredOpenAIKeys() {
  return OPENAI_KEY_ENV_ORDER.map((name) => ({
    name,
    value: String(process.env[name] || "").trim(),
  }));
}

function pickOpenAIKey() {
  const candidates = listConfiguredOpenAIKeys().filter((entry) => entry.value);
  const chosen = candidates[0] || null;
  return {
    chosen: chosen?.value || "",
    source: chosen?.name || "",
    candidates,
  };
}

module.exports = {
  OPENAI_KEY_ENV_ORDER,
  listConfiguredOpenAIKeys,
  pickOpenAIKey,
};
