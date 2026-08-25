const assert = require('node:assert/strict');

/**
 * Shared vocabulary for the unauthenticated-payload contracts (#201).
 *
 * The suites that pin what an anonymous caller can obtain - publicPayloadShape,
 * authPayloadShape, healthPayloadShape - all assert the same two things about
 * a response, and said them three different ways before this file existed:
 * that its key set is EXACTLY the allowlist, and that a fixture row wider than
 * the contract left nothing behind in the body.
 *
 * The second half is the one worth sharing. A forbidden-key check can only
 * prove what the fixture actually supplied: a loop naming a key no row carries
 * asserts nothing while reading as a guarantee. `withheld()` builds the decoys
 * and the assertion from ONE object, so the two cannot drift apart.
 */

/** A payload's key set, sorted, for a deepEqual against a literal allowlist. */
const keys = (value) => Object.keys(value).sort();

/**
 * Decoys for a fixture row, plus the assertion that none of them survived.
 *
 * `withheld({ user_id: 9, email: 'a@b.c' })` answers `{ decoys, assertWithheld }`:
 * spread `decoys` into every fixture row, then call `assertWithheld(body)`.
 *
 * Every decoy gets a KEY check. Only STRING-valued decoys also get a value
 * check, which is what catches a serializer that renamed a field on its way
 * out. Non-string decoys - ids, booleans, null - deliberately do not: `9` or
 * `false` occurs legitimately all over a payload, so searching for it would
 * fail on innocent data rather than on a rename. The consequence is worth
 * stating plainly because it bounds the guarantee: a decoy whose rename must
 * be caught by VALUE has to be given a distinctive string. The identity and
 * secret decoys that matter here (usernames, emails, tokens, invite codes,
 * password hashes, the next-quarter-column stand-in) all are.
 */
function withheld(decoys) {
  return {
    decoys,
    assertWithheld(body) {
      const published = JSON.stringify(body);
      for (const [key, value] of Object.entries(decoys)) {
        assert.ok(!new RegExp(`"${key}"`).test(published), `${key} is not published`);
        if (typeof value === 'string') {
          assert.ok(!published.includes(value), `the value ${value} is not published`);
        }
      }
    },
  };
}

/**
 * The stand-in for "a column someone adds next quarter". One string, so a grep
 * for it finds every fixture that models the #173 failure rather than four
 * near-miss spellings of the same idea.
 */
const NEXT_QUARTER = 'publishes by default under a delete-list';

module.exports = { keys, withheld, NEXT_QUARTER };
