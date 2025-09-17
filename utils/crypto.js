"use strict";

const crypto = require("crypto");

const KEY_LENGTH = 32;
const IV_LENGTH = 12; // AES-256-GCM recommended IV length
const ALGO = "aes-256-gcm";
const PLAIN_PREFIX = "PLAIN:";
const ENC_PREFIX = "ENC";

function normalizeKey() {
  const raw = process.env.DATA_ENCRYPTION_KEY;
  if (!raw) return null;
  let key;
  try {
    if (/^[0-9a-f]{64}$/i.test(raw)) {
      key = Buffer.from(raw, "hex");
    } else if (/^[A-Za-z0-9+/=]+$/.test(raw) && raw.length % 4 === 0) {
      key = Buffer.from(raw, "base64");
    } else {
      key = Buffer.from(raw, "utf8");
    }
  } catch {
    key = null;
  }
  if (!key) return null;
  if (key.length < KEY_LENGTH) {
    const padded = Buffer.alloc(KEY_LENGTH);
    key.copy(padded);
    key = padded;
  } else if (key.length > KEY_LENGTH) {
    key = key.slice(0, KEY_LENGTH);
  }
  return key;
}

function encryptString(plain) {
  const key = normalizeKey();
  const data = String(plain ?? "");
  if (!key) {
    return Buffer.from(`${PLAIN_PREFIX}${data}`, "utf8").toString("base64");
  }
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(data, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const packed = Buffer.concat([Buffer.from(ENC_PREFIX, "utf8"), iv, tag, ciphertext]);
  return packed.toString("base64");
}

function decryptString(payload) {
  if (!payload) return "";
  try {
    const buf = Buffer.from(payload, "base64");
    const prefix = buf.slice(0, ENC_PREFIX.length).toString("utf8");
    const key = normalizeKey();
    if (prefix === ENC_PREFIX && key) {
      const ivStart = ENC_PREFIX.length;
      const tagStart = ivStart + IV_LENGTH;
      const dataStart = tagStart + 16;
      const iv = buf.slice(ivStart, tagStart);
      const tag = buf.slice(tagStart, dataStart);
      const ciphertext = buf.slice(dataStart);
      const decipher = crypto.createDecipheriv(ALGO, key, iv);
      decipher.setAuthTag(tag);
      const out = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return out.toString("utf8");
    }
    const plain = buf.toString("utf8");
    if (plain.startsWith(PLAIN_PREFIX)) {
      return plain.slice(PLAIN_PREFIX.length);
    }
    return plain;
  } catch {
    return "";
  }
}

function encryptJSON(obj) {
  return encryptString(JSON.stringify(obj || {}));
}

function decryptJSON(payload) {
  if (!payload) return null;
  try {
    const str = decryptString(payload);
    if (!str) return null;
    return JSON.parse(str);
  } catch {
    return null;
  }
}

module.exports = {
  encryptString,
  decryptString,
  encryptJSON,
  decryptJSON,
  hasEncryptionKey: () => Boolean(normalizeKey()),
};
