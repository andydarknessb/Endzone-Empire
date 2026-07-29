const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { SOURCES, GAMES_CSV_BLOB, GAMES_CSV_COMMIT } = require('../../scripts/backtest/lib/sources');
const { BOOTSTRAP_HOSTS } = require('../../scripts/backtest/lib/sourceFetch');

const REPO_ROOT = path.join(__dirname, '..', '..');
const PREREG_PATH = path.join(REPO_ROOT, 'backtest-artifacts', 'pit-sweep-2024-2025', 'PREREGISTRATION.md');
const PROVENANCE_PATH = path.join(REPO_ROOT, 'backtest-data', 'sources', 'provenance.json');

const prereg = fs.readFileSync(PREREG_PATH, 'utf8');

const NAMESPACE = 'endzone-empire/pit-sweep-2024-2025';

/** The salts are derived, not typed, so anyone can regenerate and check them. */
function expectedSalt(n) {
  const nn = String(n).padStart(2, '0');
  const hex = crypto.createHash('sha256').update(`${NAMESPACE}/salt/${nn}`).digest('hex').slice(0, 12);
  return `pit-${nn}-${hex}`;
}

/** The seeds are derived the same way: first 8 hex digits as a uint32. */
function expectedSeed(name) {
  return parseInt(crypto.createHash('sha256').update(`${NAMESPACE}/${name}`).digest('hex').slice(0, 8), 16);
}

/**
 * Substance, not line breaks: both sides are whitespace-collapsed so a
 * reflowed paragraph cannot fail a test while the sealed VALUE is intact.
 * Assertions where the exact layout matters (the provenance and threshold
 * tables) match against the raw text with a regex instead.
 */
const collapse = (text) => String(text).replace(/\s+/g, ' ');
const preregFlat = collapse(prereg);

function contains(needle) {
  assert.ok(preregFlat.includes(collapse(needle)), `PREREGISTRATION.md is missing: ${needle}`);
}

test('the preregistration exists, is sealed, and is measurement-only', () => {
  assert.ok(prereg.length > 10000, 'the sealed document is substantive');
  contains('Status: SEALED at the end of Phase 0. Immutable.');
  contains('MEASUREMENT ONLY');
  contains('pit-sweep-2024-2025');
});

test('it carries all 24 salts, regenerable from the published derivation', () => {
  for (let i = 1; i <= 24; i++) contains(expectedSalt(i));
  assert.ok(!prereg.includes(expectedSalt(25)), 'there is no 25th salt');
  contains('24 fixed candidate salts');
});

test('the two disjoint 12-salt halves are both named and are descriptive only', () => {
  contains('Half A (odd)');
  contains('Half B (even)');
  contains('Disjoint, 12 each');
  contains('**No formal gate uses it.**');
});

test('every preregistered seed appears with its derived value', () => {
  for (const name of ['bootstrap-seed', 'permutation-seed', 'roster-seed', 'moving-block-seed', 'mde-seed']) {
    contains(String(expectedSeed(name)));
    contains(name);
  }
  assert.equal(expectedSeed('bootstrap-seed'), 1499811874);
  assert.equal(expectedSeed('permutation-seed'), 940227589);
  assert.equal(expectedSeed('roster-seed'), 1357931762);
});

test('the co-primary margins and the family alpha are stated numerically', () => {
  contains('0.15 points per week');   // delta_R
  contains('0.005');                  // delta_P
  contains('Family one-sided alpha = 0.05');
  contains('alpha/7 = 0.05/7 =\n  0.0071428571');
  contains('The divisor is FIXED at 7');
});

test('all seven IUT components are present with an explicit inequality each', () => {
  for (const label of ['(a)', '(b)', '(c)', '(d)', '(e1)', '(e2)', '(f)']) contains(label);
  contains('seven components');
  contains('strictly below minus 0.15 points per week');
  contains('strictly above plus 0.005');
  contains('strictly below plus 0.15 points per week');
  contains('strictly above minus\n   0.005');
  contains('A missing or unevaluable component FAILS the claim.');
  contains('passes\n  **vacuously by definition**');
});

test('the exact resample and permutation counts are stated as exact', () => {
  contains('**Exactly 100,000 draws.** Not "at least", not "about".');
  contains('exactly **10,000**');
  contains('p_hat = (1 + #{b : T_b >= T_obs}) / (1 + 10000)');
  contains('`p_hat <= 0.001`');
  contains('IDENTICAL resamples');
  contains('0.9928571429');
});

test('component (f) states the exact sign test, tie handling, minimum, and discreteness', () => {
  contains('one-sided binomial sign test');
  contains('S_w = D_w - 0.025');
  contains('exactly zero');
  contains('DROPPED');
  contains('p = sum_{j=k}^{n} C(n, j) * 2^(-n)');
  contains('at least **8 distinct 2025 season-week clusters**');
  contains('at least **30 subgroup rows in total**');
  contains('p = 1/256 = 0.00390625');
  contains('9/256 = 0.03515625');
  contains('All 8 of 8 shifted differences must favor\nnoninferiority.');
  contains('UNEVALUABLE and the homeAway claim is\nINCONCLUSIVE - never a pass');
  contains('week-sign independence assumption');
  contains('matched same-usage OFF cell');
});

test("(f)'s margin and cap are derived from the homeAway factor's own bound, and can bind", () => {
  // The on-minus-off shift is exactly baseline * effect with |effect| <= 0.05,
  // and the (f) subgroup is baselines at or below zero. A margin or cap on the
  // scale of the (e2) accuracy margins would be unreachable, so both numbers
  // are derived from maxEffect and must show their arithmetic.
  contains('next = running * (1 + effect)');
  contains('|e| <= 0.05');
  contains('delta_F = 0.5 * maxEffect * B_bar_ref = 0.5 * 0.05 * 1.00 = 0.025');
  contains('cap = maxEffect * B_ref = 0.05 * 4.00 = 0.20');
  contains('inc > 0.20 points');
  // The falsifiability guard: a margin the data cannot exceed is not a test.
  contains('delta_F / maxEffect = 0.025 / 0.05 = 0.50 points');
  contains('noninferiority cannot be falsified');
  contains('realized mean and\nmaximum `|b|` over the subgroup');
  // And the superseded numbers are gone.
  assert.ok(!preregFlat.includes('inc > 5.00'), 'the dead 5.00-point cap is gone');
  assert.ok(!preregFlat.includes('S_w = D_w - 0.10'), 'the 0.10 margin is gone');
});

test('the coverage bound is control minus one percentage point', () => {
  contains('lower** bound above minus 0.01');
  contains('1 percentage point');
});

test('per-position activation thresholds are numeric, symmetric, and cover all six positions', () => {
  contains('factors.homeAway.available === true');
  contains('raw `homeAway.effect !== 0`');
  for (const position of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']) {
    assert.ok(new RegExp(`\\| ${position} \\| 0\\.85 \\| 0\\.85 \\|`).test(prereg), `${position} threshold row`);
  }
  contains('INCONCLUSIVE for that season');
});

test('the activation threshold is derived from the sample mechanism, symmetrically across seasons', () => {
  // The sample comes ONLY from the current-season league scan, so the two
  // seasons starve identically and an asymmetric threshold would be unfounded.
  contains('"ps"."season" = $1 AND "ps"."week" < $2');
  contains('The sample is CURRENT-SEASON ONLY');
  contains('2024 and 2025 therefore\n  accumulate identically');
  contains('gates `buildPriorGames`');
  contains('Structural ceiling: **16/17 = 0.9412**');
  contains('(17 - 2) / 17 = 15/17 = 0.8824');
  contains('rounded DOWN to the nearest 0.05');
  contains('Threshold = 0.85, identical for every position and identical in both');
  // The false rationale the review caught must be gone.
  assert.ok(
    !preregFlat.includes('empty prior-season history (2022 and 2023 are captured-as-empty), so the factor'),
    'the prior-season-accumulation rationale was false and must not survive'
  );
});

test('the CI contract fixes the estimator, the missing-cell rule, and the exact-inference trigger', () => {
  contains('Percentile CIs');
  contains('Cluster bootstrap over season-weeks');
  contains('fewer than\n  12');
  contains('fewer than 100 distinct values');
  contains('more than 2 of the 17 evaluated weeks drop');
  // 10.1 and 10.4 must agree about what gets resampled after a week drops.
  contains('Resampling is over the SURVIVING clusters, and `n` is the surviving count.');
  contains('n = 17 - (number of dropped weeks)');
  contains('the component requires `n >= 15`');
  contains('never imputed');
  contains('Moving-block bootstrap** with block lengths **2** and **3**');
  contains('Wide intervals are inconclusive');
});

test('the estimand definitions are exact: median-primary, week unit, macro pairwise, RMSE, WIS', () => {
  contains('The primary point value is the MEDIAN');
  contains('The analysis unit is the season-week.');
  contains('macro-average over the six positions');
  contains('`QB, RB, WR, TE, K, DEF`');
  contains('RMSE is never\n  pooled across weeks');
  contains('WIS(y) = ( 0.5 * |y - m| + sum_k (alpha_k / 2) * IS_{alpha_k}(y) ) / (K + 0.5)');
  contains('contributes 0.5 to pairwise accuracy');
  contains('rounded to 10 decimal places');
});

test('the roster construction rules are complete and numeric', () => {
  contains('**20 QB, 50 RB, 50 WR, 20 TE, 10 K, 10 DEF = 160**');
  contains('snake');
  contains('**5 replicates**');
  contains('**1700 roster-weeks**');
  contains('2 QB, 5 RB, 5 WR, 2 TE, 1 K, 1 DEF');
  contains('SUM of `slot.count`\n  (= 9), never `rosterSlots.length` (= 7)');
  contains('Initial starter/bench state');
  contains('QB, RB, RB, WR, WR, TE, FLEX, K, DEF');
});

test('the scoring profiles name half-PPR as primary and the other two as no-harm', () => {
  contains('**half-PPR is the formal primary**');
  contains('Standard and full-PPR\nare no-harm sensitivities');
});

test('the v3.2 replay veto states both inequalities per comparator at one-sided 95%', () => {
  contains('v3.2 replay veto');
  contains('one-sided 95%');
  contains('matched same-usage off-cell | 0.15 | 0.005');
  contains('no-harm checks only, never new superiority\ntests');
  contains('A veto ends the cycle - no promotion of any runner-up.');
});

test('the parsimony total order is stated and never uses point estimates', () => {
  contains('Parsimony total order (never by point estimate)');
  contains('1. usage-40 x off');
  contains('7. usage-60 x on');
  contains('**Point\nestimates never break a tie.**');
});

test('the blinded MDE algorithm is specified and cannot alter a margin', () => {
  contains('primary-component power for the seven claims');
  contains('control-only artifacts');
  contains('structurally incapable of\nloading a candidate cell');
  contains('rho in {0.00, 0.10, 0.20, 0.30, 0.40, 0.50,');
  contains('**2,000**');
  contains('10,000** cluster-bootstrap draws per\n   simulated experiment');
  contains('it can NEVER\nalter a margin');
});

test('the oracle weeks cover every conditional SQL branch of loadFeatureBundle', () => {
  contains('| 2025 W1 | OFF | OFF |');
  contains('| 2025 W2 | ON | ON |');
  contains('| 2025 W9 | ON | ON |');
  contains('| 2025 W18 | ON | ON |');
  contains('| 2024 W1 | OFF | OFF |');
  contains('| 2024 W10 | ON | ON |');
  contains("scanPositions.length > 0 && Number(week) > 1");
  contains('currentSeasonScheduleRows.length > 0');
  contains('The 8 SQL texts');
});

test('the injury policy states the primary, both as-of sensitivities, and the empirical finding', () => {
  contains('**Primary (both seasons): `injury_status = null` for every player-week.**');
  contains('Primary results do NOT test O/IR filtering.');
  contains('`injuries_2024.csv` **HAS** `date_modified`');
  contains('`injuries_2025.csv` **DOES NOT**');
  contains('Fail-closed if the column is absent.');
  contains('explicitly leak-prone');
});

test('the cohort rules carry the sealed mechanical mappings', () => {
  contains('| `active` | `ACT`, `INA` |');
  contains('| `reserve` | `RES`, `RET`, `EXE`, `E01` |');
  contains('| `off_roster` | `DEV`, `CUT`, `TRD`, `TRC` |');
  contains('| `Note` | `null` |');
  contains('| `Questionable` | `Q` |');
  contains('| `Doubtful` | `D` |');
  contains('| `Out` | `O` |');
  contains('`IR` is deliberately UNREACHABLE from injury reports');
  contains('2025 REG weeks 2-18 (17 primary weeks)');
  contains('2024 REG\n  weeks 2-18 (17 safety weeks)');
  contains('Bye players are excluded from point-accuracy scoring and included in\n  rosters');
});

test('the evaluation window is weeks 2-18, with all four reasons and the week-18 limitation', () => {
  contains('Week 1 is excluded\n  from the evaluation window in both seasons');
  contains('scripts/backtest-weekly-projections.js:35');
  contains('14,016-row `free_baseline_v3.1`');
  contains('gated off entirely at\n     `week <= 1`');
  contains('`minGamesPerSide = 24` floor, `projectionModel.js:211`');
  contains('ceiling would be 15/17 = 0.8824');
  contains('Under weeks 2-18 only week 2 is\n     starved and the ceiling is 16/17 = 0.9412');
  contains('every interval is null and coverage and WIS are undefined');
  contains('`naive-recency` requires at\n     least one prior game');
  contains('Week 18 is INCLUDED, and its distortion is a documented limitation');
  contains('a common shock cancels in the pairing');
  // Week 1 stays as an ORACLE week, and the document must say why that is not
  // a contradiction.
  contains('Week 1 is NOT an evaluated week.');
  contains('SOLELY to pin the fidelity of the\nscan-off');
  assert.ok(!preregFlat.includes('weeks 1-17 (17 primary weeks)'), 'the old window is gone');
});

test('the observed redirect hosts are recorded verbatim and exclude the unobserved one', () => {
  for (const host of ['github.com', 'raw.githubusercontent.com', 'release-assets.githubusercontent.com']) {
    contains(host);
  }
  // The bootstrap set contained a fourth host that no fetch ever touched. The
  // whole point of freezing from OBSERVED hosts is that it must not be listed.
  assert.ok(BOOTSTRAP_HOSTS.includes('objects.githubusercontent.com'));
  assert.ok(
    !/^objects\.githubusercontent\.com$/m.test(prereg.replace(/`/g, '')),
    'an unobserved host must never appear as part of the frozen allowlist'
  );
  contains('was in the bootstrap set and was NEVER observed');
});

test('every pinned source appears with a 64-hex SHA-256 and a byte length', () => {
  for (const source of SOURCES) {
    const row = new RegExp(`\\| ${source.file.replace('.', '\\.')} \\| (\\d+) \\| \`([0-9a-f]{64})\` \\|`);
    assert.ok(row.test(prereg), `${source.file} is missing its provenance row`);
  }
  const hashes = [...prereg.matchAll(/`([0-9a-f]{64})`/g)].map((m) => m[1]);
  assert.equal(new Set(hashes).size, SOURCES.length, 'ten distinct source hashes');
});

test('the games.csv pin records the commit, the blob SHA, and that the blob was verified', () => {
  contains(GAMES_CSV_COMMIT);
  contains(GAMES_CSV_BLOB);
  contains('**VERIFIED**');
  contains('sha1("blob " + length + "\\0" + bytes)');
  contains('was\n  NOT reused');
});

test('the fetcher contract limits in the document match the frozen code', () => {
  contains('Maximum redirects: **5**');
  contains('**134217728 bytes (128 MiB)**');
  // The timeout has to be described as what it actually is: `req.setTimeout`
  // is socket inactivity, not a total wall-clock deadline.
  contains('Socket-inactivity timeout: **120000 ms**');
  contains('It is **not** a total wall-clock deadline');
  contains('The size cap,\n  not the timeout, is what bounds a pathological download.');
});

test('the sealed hashes match the committed provenance record', () => {
  // Only the SOURCE BYTES are gitignored (tens of megabytes of third-party
  // CSVs that are replaced in place upstream and so cannot be refetched
  // reproducibly). The provenance record itself is committed precisely so this
  // check runs on a clean clone with no network and no source files present.
  assert.ok(fs.existsSync(PROVENANCE_PATH), `provenance must be committed at ${PROVENANCE_PATH}`);
  const provenance = JSON.parse(fs.readFileSync(PROVENANCE_PATH, 'utf8'));
  assert.equal(provenance.records.length, SOURCES.length);
  for (const record of provenance.records) {
    const source = SOURCES.find((s) => s.name === record.name);
    assert.ok(
      prereg.includes(`| ${source.file} | ${record.byteLength} | \`${record.sha256}\` |`),
      `${record.name}: the sealed row does not match the persisted bytes`
    );
    for (const host of record.observedHosts) contains(host);
  }
  assert.deepEqual(
    provenance.contract.observedHosts,
    ['github.com', 'raw.githubusercontent.com', 'release-assets.githubusercontent.com']
  );
  assert.equal(provenance.contract.maxRedirects, 5);
  assert.equal(provenance.contract.maxBytes, 134217728);
});

test('the document states the 2026 quarantine and the non-goals', () => {
  contains('`QUARANTINE_FROM_SEASON = 2026`');
  contains('untouched prospective holdout');
  contains('No `MODEL_CONSTANTS` change, no `MODEL_VERSION` bump');
  contains('No production application-data write anywhere.');
  contains('No Tank01 or RapidAPI usage at any point in this study.');
});
