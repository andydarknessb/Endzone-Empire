'use strict';

/**
 * The GIF-message capability flag (#446, AC7/AC9).
 *
 * DISABLED BY DEFAULT, and deliberately so: #446 builds the GIF message
 * contract and experience to be testable WITHOUT enabling any provider (AC9).
 * This flag is the one switch that turns the capability on, and it is OFF in
 * every environment until external approval. It carries NO provider key, reads
 * NO `.env` value and triggers NO provider request - it is a plain in-process
 * boolean. Enabling it is a deliberate future config change (a JS/JSON config
 * edit, never a `.env*` or `render.yaml` carve-out), gated on that approval.
 *
 * WHY NOT AN ENV VAR. Reading `process.env.GIF_MESSAGES_ENABLED` would put the
 * enablement switch on the deploy surface (`.env*` / render.yaml), which #446's
 * carve-out boundary keeps for the maintainer and which AC9 says must not gain a
 * production-enablement path before approval. Keeping the default a hard-coded
 * `false` here means the capability cannot be turned on by an environment change
 * alone; it takes a code change that a reviewer sees.
 *
 * The server GATES chat:send on this (a client that never rendered the picker
 * can still emit the event, so the refusal is server-side), and the client is
 * told the state through the league-join ack (like isCommissioner) so the picker
 * is absent when it is off - never inferred client-side.
 */

// Disabled by default (AC9). No env, no key, no production enablement.
const DEFAULT_ENABLED = false;

// A test-only override. Production never sets it, so the default governs. Kept
// separate from DEFAULT_ENABLED so a test cannot accidentally change the real
// default, only shadow it for the duration of a case.
let testOverride = null;

/** Whether the GIF-message capability is enabled. False in every real
 *  environment until external approval flips DEFAULT_ENABLED in a code change. */
function isGifMessagesEnabled() {
  if (testOverride !== null) return testOverride;
  return DEFAULT_ENABLED;
}

/**
 * TEST ONLY: shadow the capability for a single case. Pass a boolean to force
 * it, or null to clear the override and fall back to the real default. A test
 * that flips it MUST clear it in afterEach so the disabled-by-default state
 * cannot leak into another suite.
 */
function setGifMessagesEnabledForTests(value) {
  testOverride = value === null || value === undefined ? null : Boolean(value);
}

module.exports = {
  DEFAULT_ENABLED,
  isGifMessagesEnabled,
  setGifMessagesEnabledForTests,
};
