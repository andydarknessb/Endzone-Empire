'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const bfj = require('bfj');

const DEFAULT_MAX_BUFFERED_CHARS = 64 * 1024;
const DEFAULT_PARSE_YIELD_RATE = 1_000_000;

/**
 * Visit the exact tokens emitted by snapshotStore.canonicalJson without ever
 * joining a complete array, object, or document into one V8 string.
 */
function forEachCanonicalToken(value, consume) {
  if (value === undefined) throw new Error('canonicalJson: undefined is not serializable');
  if (value === null) {
    consume('null');
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`canonicalJson: ${String(value)} is not serializable as JSON`);
    }
    consume(JSON.stringify(value));
    return;
  }
  if (typeof value === 'boolean' || typeof value === 'string') {
    consume(JSON.stringify(value));
    return;
  }
  if (value instanceof Date) {
    consume(JSON.stringify(value.toISOString()));
    return;
  }
  if (Array.isArray(value)) {
    consume('[');
    for (let index = 0; index < value.length; index += 1) {
      if (index > 0) consume(',');
      forEachCanonicalToken(value[index], consume);
    }
    consume(']');
    return;
  }
  if (typeof value === 'object') {
    consume('{');
    const keys = Object.keys(value).sort();
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (value[key] === undefined) {
        throw new Error(`canonicalJson: key ${JSON.stringify(key)} is undefined`);
      }
      if (index > 0) consume(',');
      consume(JSON.stringify(key));
      consume(':');
      forEachCanonicalToken(value[key], consume);
    }
    consume('}');
    return;
  }
  throw new Error(`canonicalJson: cannot serialize ${typeof value}`);
}

function canonicalJsonSha256(value, { assertToken } = {}) {
  const hash = crypto.createHash('sha256');
  forEachCanonicalToken(value, (token) => {
    if (assertToken) assertToken(token);
    hash.update(token, 'utf8');
  });
  return hash.digest('hex');
}

function writeCanonicalJsonFileSync(filePath, value, {
  assertToken,
  trailingNewline = false,
  maxBufferedChars = DEFAULT_MAX_BUFFERED_CHARS,
} = {}) {
  if (!Number.isSafeInteger(maxBufferedChars) || maxBufferedChars < 1) {
    throw new Error('writeCanonicalJsonFileSync: maxBufferedChars must be a positive safe integer');
  }
  const targetPath = path.resolve(String(filePath));
  const temporaryPath = `${targetPath}.tmp-${process.pid}`;
  let descriptor;
  let pending = '';

  const flush = () => {
    if (pending.length === 0) return;
    fs.writeSync(descriptor, pending, null, 'utf8');
    pending = '';
  };
  const writeToken = (token) => {
    if (assertToken) assertToken(token);
    if (pending.length > 0 && pending.length + token.length > maxBufferedChars) flush();
    if (token.length >= maxBufferedChars) {
      flush();
      fs.writeSync(descriptor, token, null, 'utf8');
      return;
    }
    pending += token;
  };

  try {
    descriptor = fs.openSync(temporaryPath, 'wx');
    forEachCanonicalToken(value, writeToken);
    if (trailingNewline) writeToken('\n');
    flush();
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporaryPath, targetPath);
  } catch (err) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch (_closeError) { /* preserve the primary error */ }
    }
    try { fs.unlinkSync(temporaryPath); } catch (cleanupError) {
      if (cleanupError && cleanupError.code !== 'ENOENT') err.cleanupError = cleanupError;
    }
    throw err;
  }
  return targetPath;
}

/** Parse without first materializing the whole UTF-8 file as one V8 string. */
async function readJsonFile(filePath, options = {}) {
  return bfj.read(path.resolve(String(filePath)), {
    yieldRate: DEFAULT_PARSE_YIELD_RATE,
    ...options,
    Promise: global.Promise,
  });
}

module.exports = {
  DEFAULT_MAX_BUFFERED_CHARS,
  DEFAULT_PARSE_YIELD_RATE,
  forEachCanonicalToken,
  canonicalJsonSha256,
  writeCanonicalJsonFileSync,
  readJsonFile,
};
