"use strict";

require("dotenv").config();

// Simple diagnostic script to show which OpenAI key would be used by the app.
// Run with: npm run test:openai-key
// Project-scoped keys are valid. This only shows which configured env var wins.

const { pickOpenAIKey, listConfiguredOpenAIKeys } = require("../utils/openaiKey");
const { maskSecret } = require("../utils/secrets");

const { chosen, source, candidates } = pickOpenAIKey();

console.log("Selected key:", maskSecret(chosen));
console.log("Selected source:", source || "<none>");
console.log(
  "Configured candidates:",
  candidates.map((entry) => `${entry.name}=${maskSecret(entry.value)}`)
);
console.log("Env snapshot:");
console.log({
  configured: listConfiguredOpenAIKeys().map((entry) => ({
    name: entry.name,
    value: maskSecret(entry.value),
  })),
});
