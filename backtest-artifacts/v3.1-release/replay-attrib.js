/* Attribution: separate a404cf0's real effect from ambient nondeterminism.
 * Compares three runs: pre (266060a), head (a404cf0 run 1), head2 (a404cf0 run 2). */
const fs = require('fs');
const s = 'C:/Users/Cory/AppData/Local/Temp/claude/c--Users-Cory-Endzone-Empire/15b5b31f-2001-4752-8a5e-a7298bde9fba/scratchpad';
const load = (f) => JSON.parse(fs.readFileSync(`${s}/${f}`, 'utf8')).rows;
const key = (r) => `${r[0]}:${r[1]}:${r[2]}`;
const toMap = (rows) => new Map(rows.map((r) => [key(r), r]));

const pre = toMap(load('replay-pre.json'));
const head = toMap(load('replay-head.json'));
const head2 = toMap(load('replay-head2.json'));

function diffKeys(a, b, idx) {
  const out = new Set();
  for (const [k, rb] of b) {
    const ra = a.get(k);
    if (!ra) continue;
    if (!idx.every((i) => (rb[i] == null ? ra[i] == null : rb[i] === ra[i]))) out.add(k);
  }
  return out;
}

const QUANT = [4, 5, 6]; // median, p10, p90
const META = [7, 8];     // vsMeetings, vsContribution

const commitQuant = diffKeys(pre, head, QUANT);
const ambientQuant = diffKeys(head2, head, QUANT);
const overlap = [...commitQuant].filter((k) => ambientQuant.has(k)).length;
console.log(`quantile diffs pre-vs-head: ${commitQuant.size}; head2-vs-head (ambient): ${ambientQuant.size}; overlap: ${overlap}`);
console.log(`quantile diffs attributable to a404cf0 beyond ambient noise: ${[...commitQuant].filter((k) => !ambientQuant.has(k)).length}`);

const commitMeta = diffKeys(pre, head, META);
const ambientMeta = diffKeys(head2, head, META);
console.log(`vs-meetings metadata diffs pre-vs-head: ${commitMeta.size}; head2-vs-head (ambient): ${ambientMeta.size}`);
