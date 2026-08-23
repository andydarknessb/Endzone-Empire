'use strict';

// Reads the `jest.testMatch` patterns pinned in package.json and builds a
// matcher using jest-util's own `globsToMatcher` — the exact helper
// `@jest/core`'s SearchSource uses at test-discovery time (see
// node_modules/@jest/core/build/SearchSource.js). This module exists so a
// test can exercise the real matching behavior instead of a reimplementation
// of it. See issue #171: CRA has no jest config of its own, so discovery
// used to depend entirely on the caller's working directory.

const { globsToMatcher } = require('jest-util');
const packageJson = require('../package.json');

function getTestMatchPatterns() {
  const testMatch = packageJson.jest && packageJson.jest.testMatch;
  if (!Array.isArray(testMatch) || testMatch.length === 0) {
    throw new Error('package.json is missing a jest.testMatch array');
  }
  return testMatch;
}

function createTestFileMatcher(testMatch = getTestMatchPatterns()) {
  return globsToMatcher(testMatch);
}

module.exports = { getTestMatchPatterns, createTestFileMatcher };
