/* QA: (1) v3.1 run1 vs run2 must be byte-identical everywhere.
 * (2) v3.1 means must equal v3 means (mean path untouched by the release). */
const fs = require('fs');
const s = __dirname;
const load = (f) => JSON.parse(fs.readFileSync(`${s}/${f}`, 'utf8'));
const key = (r) => `${r[0]}:${r[1]}:${r[2]}`;

const run1 = load('replay-v31-run1.json');
const run2 = load('replay-v31-run2.json');
const v3 = load('replay-head.json'); // pre-release run at a404cf0
console.log(`versions: run1=${run1.modelVersion} run2=${run2.modelVersion} old=${v3.modelVersion}`);

const map2 = new Map(run2.rows.map((r) => [key(r), r]));
let anyDiff = 0;
for (const r1 of run1.rows) {
  const r2 = map2.get(key(r1));
  if (!r2 || JSON.stringify(r1) !== JSON.stringify(r2)) {
    anyDiff += 1;
    if (anyDiff <= 5) console.log(`  DIFF ${key(r1)}: ${JSON.stringify(r1)} vs ${JSON.stringify(r2)}`);
  }
}
console.log(`determinism: run1 vs run2 field-level diffs (all 9 fields): ${anyDiff} of ${run1.rows.length}`);

const v3map = new Map(v3.rows.map((r) => [key(r), r]));
let meanDiff = 0;
let quantDiff = 0;
for (const r1 of run1.rows) {
  const r0 = v3map.get(key(r1));
  if (!r0) continue;
  if ((r1[3] == null ? r0[3] != null : r1[3] !== r0[3])) {
    meanDiff += 1;
    if (meanDiff <= 5) console.log(`  MEAN DIFF ${key(r1)}: ${r0[3]} -> ${r1[3]}`);
  }
  if ([4, 5, 6].some((i) => (r1[i] == null ? r0[i] != null : r1[i] !== r0[i]))) quantDiff += 1;
}
console.log(`v3 -> v3.1: mean changes: ${meanDiff}; quantile changes (expected, seed re-roll + canonical sort): ${quantDiff}`);
