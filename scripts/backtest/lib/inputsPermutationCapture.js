'use strict';

/**
 * Gate 2, the `--inputs` PRODUCER's permutation-control observation capture
 * (increment 4).
 *
 * Section 5 pins the permutation control's two statistics to the CONTROL CELL
 * only, over 2025 REG weeks 2-18, and the reducer derives both from RAW
 * observation rows rather than accepting a statistic
 * (`metrics.computePermutationControl`: "caller-supplied permutation
 * statistics are prohibited"). This module produces those rows: it walks
 * 2025's 17 evaluated weeks x 24 salts, calls an INJECTED generator once per
 * (week, salt) with the control cell's resolved constants, and emits
 * `observations` (`{season, week, salt, position, playerId, actual,
 * projected}`) and `rosterRows` (`{season, week, position, playerId}`) in the
 * canonical salt -> week -> position -> playerId order
 * `permutationControl.canonicalObservations` requires (`:206-216` rejects
 * out-of-order input outright).
 *
 * WHY THESE GENERATIONS EXIST AT ALL, AND HOW THEY RELATE TO THE 14,688 GRID
 *
 * Section 9 counts the sweep's grid at 14,688 salted arm-week generations and
 * permits exactly ONE reuse - the sweep's 8.6.0 independent-control arm and
 * the permutation control's own generation may be the same artifact IF that
 * reuse "is stated and justified in Gate 2's own code and in the published
 * report". Increment 3 took NO such reuse ("the independent control arm is
 * generated here in full, so the grid total stays 14,688 rather than 13,872,
 * and increment 4's permutation control is free to generate its own"). This
 * module honours that decision from the other side: its 17 x 24 = 408
 * control-cell generations are its OWN, additional to the 14,688, and nothing
 * here reads or writes the 8.6.0 identity records. Because no reuse is taken,
 * section 9's reuse-disclosure obligation is not triggered - stated here so
 * the absence of a disclosure reads as the decision it is, not an oversight.
 *
 * THE OBSERVATION DOMAIN - producer-side DETERMINATION 8 (B3 deferral batch,
 * continuing `inputsAssembly.js`'s 1-3, `inputsGeneration.js`'s 4-6 and the
 * wiring's 7)
 *
 * The sealed text does not pin which players form the permutation cells. The
 * reducer constrains the choice from three sides (`permutationControl.js`):
 * every observation row needs a FINITE `actual` and `projected` (`:206-208`);
 * every ROSTERED player needs an observation (`assertPolicyArtifactDomain` -
 * "a measured zero standing in for missing evidence"); and each salt/cell's
 * observation ids must equal the cell's canonical member list elementwise
 * (`:229-231`). Within those walls this module pins:
 *
 *   THE DOMAIN IS EVERY COHORT MEMBER WITH A MACRO POSITION AND A RESOLVED
 *   OUTCOME TRUTH (a finite `actualPointsByPlayerId` entry - `lib/outcomes`
 *   writes one only for `scored`/`zero-recorded` members).
 *
 *   - BYE MEMBERS ARE IN. A bye player stays in the cohort and in rosters
 *     (`lib/cohort.js`), and `assertPolicyArtifactDomain` requires every
 *     rostered player to carry an observation, so excluding byes would fail
 *     the reducer on every week with a rostered bye. Consequence, recorded
 *     head-on: bye players therefore participate in the permutation control's
 *     pairwise statistic, where prereg 4.1 excludes them from the sweep's own
 *     point-accuracy scoring (`pairwiseRowsByPosition` skips `onBye`). Both
 *     T_obs and every T_b are computed from the same rows by the identical
 *     code path, so the gate stays internally consistent; whether 4.1's
 *     exclusion SHOULD propagate into section 5's cells is a spec question of
 *     the same family as the component-(f) membership question the QA pass
 *     filed (A4), and it rides with this determination rather than being
 *     silently decided by either reading.
 *   - EXCLUSIONS ARE COUNTED, NEVER SILENT. A member outside the domain
 *     (unresolved outcome, or a position outside the six macro positions) is
 *     tallied in `counts.excluded` by reason - per member-WEEK, so one member
 *     excluded all season contributes 17. A silently-shrunk domain is a
 *     fail-open by omission - the increment-1 QA lesson - and the reducer
 *     cannot see it, because its coverage assertions only bound the domain
 *     from below (rostered players).
 *   - A ROSTERED PLAYER OUTSIDE THE DOMAIN FAILS THE CAPTURE, by name, with
 *     the exclusion reason attached. The reducer would reject the same run
 *     hours later as "roster player N has no observation" with no cause; this
 *     module knows the cause at the only moment it is attached.
 *
 * KNOWN REAL-DATA RISK (D, continuing the driver's A-C): every domain member
 * must yield a finite projected median under EVERY salt, or the capture
 * throws. A player-week that short-circuits before the model (absent from the
 * feature bundle) has no median, and unlike the sweep - where a sparse
 * projections map is legal evidence - the permutation control has no
 * expression for a missing projection at all (`canonicalObservations` requires
 * finite `projected` on every row). Expect this to surface on the first
 * authoritative run alongside risk A, and for the same underlying players.
 *
 * SALT-INVARIANCE BY CONSTRUCTION, NOT BY SELF-CHECK. The control cell's
 * constants are resolved ONCE, outside the salt loop, and the composed
 * `hashValue` is the only per-salt input `generate` receives - so the salt
 * can reach generation only through the hashValue, which is the property
 * spec 3.4's test 6 checks from the input side. (Stated as this module's own
 * engineering claim, not as sealed text - the sealed wording pins the
 * equivalent fact about a cell's resolved run object.) The driver-style
 * `assertSaltAffectsOnlyHashValue` over recorded call inputs is deliberately
 * NOT replicated: recording the arguments this module itself constructs and
 * then validating them against each other checks the loop against itself
 * (the QA pass on `7411d28` found exactly that check effectively dead in the
 * driver). The tests pin the invariance from OUTSIDE instead, on the
 * observed calls of an injected spy - and because the shared constants
 * object and each week's playerIds array are handed to an injected function
 * 24 times, both are RE-VERIFIED after the loops, so a generator that
 * mutates its inputs fails loudly instead of quietly feeding later salts
 * different state (an adversarial QA finding on this increment).
 *
 * THE RUNTIME SEED GUARD RUNS HERE TOO. Spec 3.4.5 makes the pairwise
 * distinctness of the 24 salt-derived final seeds mandatory "for EVERY
 * evaluated player-week it actually computes", and these 408 generations
 * compute every 2025 cohort player-week. `seedFor` is injected and the check
 * runs per player-week; no `saltSeedRecords` are emitted, because the
 * document's schema keys those rows by the 8 factorial cell names and has no
 * row for a non-cell arm - the same structural fact the QA pass recorded for
 * the sensitivity profiles (S1). The guard here is therefore runtime-only,
 * which is exactly what 3.4.5 asks for - "aborts the sweep the instant a
 * real collision is detected".
 *
 * PLAYER IDS ARE ASSERTED, NEVER COERCED - the A1 lesson applied to new code:
 * a coerced id can hold a different key type from the rows it is filed under,
 * and the reducer's own domain checks compare RAW roster ids against the
 * observation ids. The wiring holds the same line at the JSON boundary
 * (`assertNumericPlayerIds`); this module holds it for pure callers.
 *
 * Pure: no database, no filesystem, no clock, no RNG of its own. `generate`
 * is a parameter, not a require - Gate-0-clean by construction, tested on
 * synthetic fixtures like the three increments before it. Before returning,
 * the output is passed through the CONSUMER'S OWN gate
 * (`permutationControl.canonicalObservations`), so a capture that would fail
 * the reducer fails here, at generation time, not after 14,688 further runs.
 */

const arms = require('./arms');
const metrics = require('./metrics');
const permutationControl = require('./permutationControl');
const { PRIMARY_SCORING_PROFILE } = require('./freezeManifest');

const { SALTS, EVALUATED_WEEKS, MACRO_POSITIONS } = metrics;

/**
 * STRICT, never `numbers.isFiniteNumber`: that predicate coerces
 * (`Number.isFinite(Number(value))`), so the string "7.5", the array [7.5]
 * and the hex string "0x10" all pass it - and a capture that emits their
 * coerced values launders a malformed artifact into rows the reducer's own
 * strict checks then accept. `metrics.js` already applied this exact
 * hardening to `incrementalError` after a coercible string flowed into a
 * published verdict; values here get the same treatment as ids: asserted,
 * never coerced (adversarial QA finding F2 on this increment).
 */
function isStrictFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Section 5: "scope pinned to 2025 REG weeks 2-18 only, never 2024, never week 1" - the same literal `canonicalRosterRows` pins. */
const PERMUTATION_SEASON = 2025;

/** The capture's own sealed arithmetic: one control-cell generation per (week, salt). */
const CAPTURE_TOTAL = EVALUATED_WEEKS.length * SALTS.length;

/** The cohort's player ids in member order - ASSERTED numeric (never coerced), duplicates rejected per section 8.6.4. */
function strictCohortPlayerIds(cohortWeek, label) {
  const ids = [];
  const seen = new Set();
  for (const [index, member] of (cohortWeek.members || []).entries()) {
    const id = member && member.playerId;
    if (typeof id !== 'number' || !Number.isFinite(id)) {
      throw new Error(
        `${label}: cohort member[${index}].playerId is ${JSON.stringify(id)} (${typeof id}), not a finite number. `
        + 'Asserted rather than coerced: the reducer compares RAW roster ids against observation ids, so a coerced '
        + 'id here can satisfy every capture check while the document fails the reducer\'s domain assertions'
      );
    }
    if (seen.has(id)) {
      throw new Error(`${label}: cohort carries playerId ${id} twice - a duplicate raw id must be rejected before any run is generated (section 8.6.4), never deduplicated`);
    }
    seen.add(id);
    ids.push(id);
  }
  if (ids.length === 0) throw new Error(`${label}: cohort week has no members`);
  return ids;
}

/** One week's resolved outcome truth for one player, accepting either artifact shape (Map from the wiring, plain object from JSON). */
function actualFor(cohortWeek, playerId) {
  const source = cohortWeek.actualPointsByPlayerId;
  return source instanceof Map ? source.get(playerId) : (source || {})[playerId];
}

/**
 * The projection's median as a finite number, or null. The bare-number
 * tolerance mirrors `armWeekEvaluator.intervalRows`; the STRICTNESS
 * deliberately does not - a string median coerced here would be emitted as a
 * clean number and nothing downstream could see the artifact was malformed.
 */
function medianOf(projection) {
  if (projection === null || projection === undefined) return null;
  if (typeof projection === 'number') return Number.isFinite(projection) ? projection : null;
  if (typeof projection !== 'object') return null;
  return isStrictFiniteNumber(projection.median) ? projection.median : null;
}

/**
 * The observation domain for one week: per macro position, the members with a
 * resolved outcome truth, sorted by ascending numeric playerId (section 5.1
 * step 4's canonical cell order). Exclusions are tallied by reason and kept
 * per id so a rostered exclusion can name its cause.
 */
function deriveWeekDomain({ cohortWeek, playerIds, where }) {
  const byPosition = new Map(MACRO_POSITIONS.map((position) => [position, []]));
  const excludedReasonById = new Map();
  const excluded = { nonMacroPosition: 0, unresolvedActual: 0 };
  for (const [index, member] of cohortWeek.members.entries()) {
    const playerId = playerIds[index];
    if (!MACRO_POSITIONS.includes(member.position)) {
      excluded.nonMacroPosition += 1;
      excludedReasonById.set(playerId, `position ${JSON.stringify(member.position)} is not one of the six macro positions`);
      continue;
    }
    const actual = actualFor(cohortWeek, playerId);
    // ABSENT is an unresolved outcome and is excluded-and-counted. PRESENT
    // BUT NOT A FINITE NUMBER is an artifact defect and throws: the frozen
    // artifacts are JSON, which cannot even express NaN, so a non-number
    // that IS there means the artifact or an in-memory caller is broken -
    // and excluding it would silently shrink the domain around the defect.
    if (actual === undefined || actual === null) {
      excluded.unresolvedActual += 1;
      excludedReasonById.set(playerId, 'no resolved outcome truth (no actualPointsByPlayerId entry)');
      continue;
    }
    if (!isStrictFiniteNumber(actual)) {
      throw new Error(
        `${where}: member ${playerId}'s outcome truth is ${JSON.stringify(actual)} (${typeof actual}), not a finite `
        + 'number. Asserted, never coerced or excluded: a present-but-malformed actual is a defect of the artifact, '
        + 'not an unresolved outcome, and treating it as either would launder the defect'
      );
    }
    // A bye member with a resolved actual stays IN (module docblock): the
    // reducer requires an observation for every rostered player and byes stay
    // rostered, so the domain has no bye exclusion to offer.
    byPosition.get(member.position).push({ playerId, actual });
  }
  for (const position of MACRO_POSITIONS) {
    const cell = byPosition.get(position);
    if (cell.length === 0) {
      throw new Error(
        `${where}: no ${position} member has a resolved outcome truth, so this week's ${position} cell would be empty. `
        + 'The authority for this abort is the CONSUMER\'s contract, not the sealed text (5.1 step 6 tolerates a '
        + 'size-0 cell): the reducer rejects a missing roster cell outright, and an empty position here means the '
        + 'cohort or its outcome resolution is broken'
      );
    }
    cell.sort((a, b) => a.playerId - b.playerId);
  }
  return { byPosition, excludedReasonById, excluded };
}

/**
 * The reducer's `assertPolicyArtifactDomain` run at CAPTURE time, with the
 * cause attached: every rostered player (starters and bench alike) must be in
 * the observation domain, or the eventual run dies hours later on "roster
 * player N has no observation" with the reason long gone.
 */
function assertRosteredCoverage({ rosterWeek, domainIds, cohortIds, excludedReasonById, where }) {
  // The shape is REQUIRED, never defaulted away: `(rosters || [])` would make
  // this whole assertion vacuously true on a truncated or mis-shaped roster
  // artifact, and the function's reason to exist is moving the reducer's
  // rejection to capture time (adversarial QA finding F3 on this increment).
  if (!Array.isArray(rosterWeek.rosters) || rosterWeek.rosters.length === 0) {
    throw new Error(`${where}: the roster artifact carries no rosters array - a missing or empty rosters list would make rostered coverage vacuously true`);
  }
  for (const [rosterIndex, roster] of rosterWeek.rosters.entries()) {
    if (!roster || !Array.isArray(roster.starters) || !Array.isArray(roster.bench)) {
      throw new Error(`${where}: rosters[${rosterIndex}] lacks starters/bench arrays - the reducer walks exactly those two fields, so a differently-shaped roster is invisible to this coverage check`);
    }
    for (const player of [...roster.starters, ...roster.bench]) {
      const id = player && player.playerId;
      if (typeof id !== 'number' || !Number.isFinite(id)) {
        throw new Error(`${where}: rosters[${rosterIndex}] carries playerId ${JSON.stringify(id)} (${typeof id}), not a finite number - asserted, never coerced, for the same reason as the cohort ids`);
      }
      if (domainIds.has(id)) continue;
      const cause = !cohortIds.has(id)
        ? 'it has no cohort entry for this week at all'
        : (excludedReasonById.get(id) || 'it was excluded from the observation domain for an unrecorded reason');
      throw new Error(
        `${where}: rostered player ${id} is outside the observation domain - ${cause}. `
        + 'The reducer requires an observation for every rostered player (a missing one would score a measured '
        + 'zero standing in for missing evidence), so this capture cannot produce a valid permutation control'
      );
    }
  }
}

/**
 * Capture the permutation control's raw observations.
 *
 * Injected seam, mirroring `inputsGeneration.generateSweepInputRecords`' - the
 * SAME wiring functions serve both, which is what makes the wiring obligations
 * (weatherService false, the whole run object returned) hold here for free:
 *
 *   - `weekArtifacts`: `Map`/object keyed `"<season>:<week>"`; only 2025's
 *     evaluated weeks are read.
 *   - `baseConstants`: `model.MODEL_CONSTANTS`. The control cell's constants
 *     are resolved HERE, once.
 *   - `scoringHashFor(profile)`: called with the PRIMARY profile only -
 *     section 5's statistics are control-cell, primary-profile quantities.
 *   - `generate({scoringProfile, season, week, playerIds, hashValue,
 *     modelConstants})` -> the WHOLE run object. No `onPreHomeAwayBaseline`
 *     is passed: baseline capture belongs to the sweep's matched-off
 *     generations (spec 6.5), and a control-only capture must not create a
 *     second source for it.
 *   - `seedFor({hashValue, season, week, playerId})`: the final unsigned
 *     32-bit seed, for the mandatory runtime collision guard (spec 3.4.5).
 */
async function capturePermutationControlObservations({
  weekArtifacts,
  baseConstants,
  scoringHashFor,
  generate,
  seedFor,
  label = 'permutation capture',
}) {
  for (const [name, fn] of [['scoringHashFor', scoringHashFor], ['generate', generate], ['seedFor', seedFor]]) {
    if (typeof fn !== 'function') throw new Error(`${label}: ${name} must be injected`);
  }
  if (!baseConstants || typeof baseConstants !== 'object') throw new Error(`${label}: baseConstants must be injected`);

  const scoringHash = scoringHashFor(PRIMARY_SCORING_PROFILE);
  if (typeof scoringHash !== 'string' || !/^[0-9a-f]+$/.test(scoringHash)) {
    throw new Error(`${label}: scoringHashFor(${JSON.stringify(PRIMARY_SCORING_PROFILE)}) must return a lowercase hexadecimal scoring hash`);
  }
  const controlCellMeta = arms.ALL_CELLS.find((cell) => cell.name === arms.CONTROL_CELL);
  // Resolved ONCE, outside every loop: the constants are a property of the
  // control cell, and giving the salt loop nothing to vary is what makes
  // "the salt reaches generation only through the hashValue" structural.
  const modelConstants = arms.resolveConstants({ cell: controlCellMeta, baseConstants, label });
  // Not frozen - Object.freeze under a sloppy-mode mutator is a SILENT no-op,
  // which is worse than no guard. The pristine bytes are kept and re-verified
  // after the last generation instead, so a mutating generator fails loudly.
  const constantsReference = JSON.stringify(modelConstants);
  const hashBySalt = Object.fromEntries(SALTS.map((salt) => [
    salt, arms.composeSaltedHashValue({ scoringHash, salt, label: `${label} ${salt}` }),
  ]));

  const rowsBySalt = new Map(SALTS.map((salt) => [salt, []]));
  const rosterRows = [];
  const counts = {
    generations: 0,
    observations: 0,
    rosterRows: 0,
    excluded: { nonMacroPosition: 0, unresolvedActual: 0 },
  };

  for (const week of EVALUATED_WEEKS) {
    const where = `${label} ${PERMUTATION_SEASON}w${week}`;
    const key = `${PERMUTATION_SEASON}:${week}`;
    const artifact = weekArtifacts instanceof Map ? weekArtifacts.get(key) : (weekArtifacts || {})[key];
    if (!artifact) throw new Error(`${where}: no roster/cohort artifacts supplied for ${key} - section 5 evaluates every 2025 REG week 2-18`);
    const { rosterWeek, cohortWeek } = artifact;

    const playerIds = strictCohortPlayerIds(cohortWeek, where);
    const playerIdsReference = [...playerIds];
    const { byPosition, excludedReasonById, excluded } = deriveWeekDomain({ cohortWeek, playerIds, where });
    counts.excluded.nonMacroPosition += excluded.nonMacroPosition;
    counts.excluded.unresolvedActual += excluded.unresolvedActual;

    const domainIds = new Set(MACRO_POSITIONS.flatMap((position) => byPosition.get(position).map((row) => row.playerId)));
    assertRosteredCoverage({
      rosterWeek, domainIds, cohortIds: new Set(playerIds), excludedReasonById, where,
    });

    for (const position of MACRO_POSITIONS) {
      for (const row of byPosition.get(position)) {
        rosterRows.push({
          season: PERMUTATION_SEASON, week, position, playerId: row.playerId,
        });
        counts.rosterRows += 1;
      }
    }

    // The mandatory runtime seed guard (spec 3.4.5), over every player-week
    // this capture computes - which is the full cohort, since the generation
    // is asked for every member, not only the observation domain.
    for (const playerId of playerIds) {
      const seedsBySalt = {};
      for (const salt of SALTS) {
        const seed = seedFor({ hashValue: hashBySalt[salt], season: PERMUTATION_SEASON, week, playerId });
        if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
          throw new Error(`${where}: seedFor returned ${JSON.stringify(seed)} for playerId ${playerId} under ${salt}; a final seed must be an unsigned 32-bit integer`);
        }
        seedsBySalt[salt] = seed;
      }
      arms.assertSaltsProduceDistinctSeeds({ seedsBySalt, label: `${where}: playerId ${playerId} salt seeds` });
    }

    for (const salt of SALTS) {
      // eslint-disable-next-line no-await-in-loop
      const run = await generate({
        scoringProfile: PRIMARY_SCORING_PROFILE,
        season: PERMUTATION_SEASON,
        week,
        playerIds,
        hashValue: hashBySalt[salt],
        modelConstants,
      });
      counts.generations += 1;
      if (run instanceof Map) {
        throw new Error(`${where} ${salt}: generate() returned the projections Map itself - it must return the WHOLE run object (wiring obligation 3; the wrapper/Map inversion is the defect run-backtest-mde.js records)`);
      }
      if (!run || typeof run !== 'object' || !run.projections
        || (!(run.projections instanceof Map) && typeof run.projections !== 'object')) {
        throw new Error(`${where} ${salt}: generate() must return a run object carrying a projections map`);
      }
      const projections = run.projections;
      const projectionOf = (playerId) => {
        // Own properties only on the object branch: a prototype-chain read
        // can file an inherited phantom median under a real player
        // (adversarial QA finding F6 on this increment).
        const found = projections instanceof Map
          ? projections.get(playerId)
          : (Object.prototype.hasOwnProperty.call(projections, playerId) ? projections[playerId] : undefined);
        return found === undefined ? null : found;
      };
      const saltRows = rowsBySalt.get(salt);
      for (const position of MACRO_POSITIONS) {
        for (const row of byPosition.get(position)) {
          const projection = projectionOf(row.playerId);
          const projected = medianOf(projection);
          if (!isStrictFiniteNumber(projected)) {
            // A Map keyed by STRING ids misses every numeric lookup - name
            // the key-type defect instead of sending the operator to
            // feature-bundle coverage (adversarial QA finding F7).
            if (projection === null && projections instanceof Map && projections.has(String(row.playerId))) {
              throw new Error(
                `${where} ${salt}: the projections Map is keyed by STRING ids (${JSON.stringify(String(row.playerId))} `
                + 'is present, the number is not) - a key-type defect of the generator, not missing model coverage'
              );
            }
            throw new Error(
              `${where} ${salt}: domain member ${row.playerId} (${position}) has no finite projected median `
              + `(the projection is ${JSON.stringify(projection)}). The permutation control has no expression for a `
              + 'missing projection - canonicalObservations requires a finite projected on every row - so a '
              + 'player-week that short-circuits before the model voids the capture here rather than the run hours '
              + 'later (module docblock, risk D)'
            );
          }
          saltRows.push({
            season: PERMUTATION_SEASON, week, salt, position, playerId: row.playerId, actual: row.actual, projected,
          });
          counts.observations += 1;
        }
      }
    }

    // The week's playerIds were handed to an injected function 24 times; a
    // generator that mutated the array would have fed later salts a different
    // generation domain with no error anywhere (adversarial QA finding F4).
    if (playerIds.length !== playerIdsReference.length
      || playerIds.some((id, index) => id !== playerIdsReference[index])) {
      throw new Error(`${where}: generate() mutated the playerIds array between salts - the 24 salts no longer generated the same domain`);
    }
  }

  if (counts.generations !== CAPTURE_TOTAL) {
    throw new Error(`${label}: the capture performed ${counts.generations} generations, but section 5's scope is ${CAPTURE_TOTAL} (17 weeks x 24 salts). A week or salt did not generate.`);
  }
  if (JSON.stringify(modelConstants) !== constantsReference) {
    throw new Error(`${label}: generate() mutated the shared resolved constants - later generations ran a different cell than the control (adversarial QA finding F4)`);
  }

  // Weeks were walked in EVALUATED_WEEKS order with positions and players in
  // canonical cell order, so concatenating the per-salt buffers in SALTS
  // order IS the canonical emission order. The claim is not left to the loop
  // structure: the consumer's own gate re-derives and rejects any violation.
  const observations = SALTS.flatMap((salt) => rowsBySalt.get(salt));
  permutationControl.canonicalObservations(observations, rosterRows, `${label} self-check`);

  return { observations, rosterRows, counts };
}

module.exports = {
  PERMUTATION_SEASON,
  CAPTURE_TOTAL,
  capturePermutationControlObservations,
};
