const test = require('node:test');
const assert = require('node:assert/strict');
const espnBoxSource = require('../services/espnBoxSource');
const corpus = require('./fixtures/espn-gamebook-lines.json');

/**
 * The narrow play-text pass (#1184) is bound to REAL Gamebook lines, one per
 * fixture entry, taken from ESPN summaries of 2025 weeks 1-4. Each case states
 * what a defense and its players must be credited for that line: a defensive
 * fumble recovery, a forced fumble, a blocked kick, or nothing at all. The
 * own-recovery and aborted-snap lines are the negatives: they must produce
 * zero recoveries, or the pass is crediting the offense with a takeaway.
 *
 * Three patterns and no more ship here (spec ruling); two-point returns and
 * the rest are the phase-two parser (#1187).
 */

const byLabel = (needle) => {
  const line = corpus.lines.find((l) => l.label.startsWith(needle));
  assert.ok(line, `corpus line "${needle}" exists`);
  return line;
};

function apply(line) {
  return espnBoxSource.fromSummary(line.summary, { gameId: `g-${line.eventId}` });
}

const def = (box, code) => box.teamDefense[code];

test('corpus: a sack strip recovered by the defense credits the recovery to IND and the forced fumble to K.Moore', () => {
  const box = apply(byLabel('sack strip: IND-X.Howard'));
  assert.equal(def(box, 'IND').fumbleRecovery, 1);
  assert.equal(def(box, 'MIA').fumbleRecovery, 0);
  const howard = box.players.find((p) => p.stats.idpFumbleRecovery === 1);
  assert.ok(howard, 'X.Howard gets the IDP recovery');
  const moore = box.players.find((p) => p.stats.forcedFumble === 1);
  assert.ok(moore, 'K.Moore (Kenny Moore II, suffix folded) gets the forced fumble');
  assert.equal(box.playTextFindings.length, 1);
});

test('corpus: a kickoff-return fumble recovered by the KICKING team is a takeaway for that team', () => {
  // ESPN’s start.team on a kickoff is the kicking team (PIT); the fumbling side
  // is the receiving team, so PIT recovering is a defensive recovery.
  const box = apply(byLabel('kickoff return fumble: PIT-B.Skowronek'));
  assert.equal(def(box, 'PIT').fumbleRecovery, 1);
  assert.equal(def(box, 'NYJ').fumbleRecovery, 0);
  assert.equal(box.players.filter((p) => p.stats.forcedFumble === 1).length, 1, 'K.Gainwell forced it');
});

test('corpus: a kickoff-return fumble recovered by the RETURNING team is an own recovery', () => {
  const box = apply(byLabel('kickoff return fumble recovered by the returning team'));
  assert.equal(def(box, 'PIT').fumbleRecovery, 0);
  assert.equal(def(box, 'NYJ').fumbleRecovery, 0);
  assert.equal(box.players.filter((p) => p.stats.forcedFumble === 1).length, 1, 'M.McCrary-Ball forced it');
});

test('corpus: "and recovers" is an own recovery and credits nobody a takeaway', () => {
  const box = apply(byLabel('own recovery (and recovers)'));
  assert.equal(def(box, 'NYJ').fumbleRecovery, 0);
  assert.equal(def(box, 'PIT').fumbleRecovery, 0);
  // Two Q.Williams on the NYJ roster: the forcer is ambiguous and stays uncredited
  // rather than guessed.
  assert.equal(box.players.filter((p) => p.stats.forcedFumble === 1).length, 0);
  assert.equal(box.playTextFindings.length, 0);
});

test('corpus: a muffed punt recovered by the punting team is a takeaway with no forcer', () => {
  const box = apply(byLabel('muffed punt recovered by the punting team'));
  assert.equal(def(box, 'TEN').fumbleRecovery, 1);
  assert.equal(def(box, 'DEN').fumbleRecovery, 0);
  assert.equal(box.players.filter((p) => p.stats.forcedFumble > 0).length, 0);
  const mausi = box.players.find((p) => p.stats.idpFumbleRecovery === 1);
  assert.ok(mausi, 'D.Mausi gets the IDP recovery');
});

test('corpus: a blocked field goal credits one blocked kick to the blocking defense and no fumble recovery', () => {
  const box = apply(byLabel('blocked FG recovered by SEA'));
  assert.equal(def(box, 'SEA').blockedKick, 1);
  assert.equal(def(box, 'SF').blockedKick, 0);
  assert.equal(def(box, 'SEA').fumbleRecovery, 0, 'a blocked kick is not a fumble');
});

test('corpus: a blocked field goal returned for a touchdown is still exactly one blocked kick', () => {
  const box = apply(byLabel('blocked FG returned for TD by NYJ'));
  assert.equal(def(box, 'NYJ').blockedKick, 1);
  assert.equal(def(box, 'TB').blockedKick, 0);
  assert.equal(def(box, 'NYJ').fumbleRecovery, 0);
});

test('corpus: a blocked punt credits the blocking defense', () => {
  const box = apply(byLabel('blocked punt returned for TD by PHI'));
  assert.equal(def(box, 'PHI').blockedKick, 1);
  assert.equal(def(box, 'TB').blockedKick, 0);
});

test('corpus: a blocked PAT written into the touchdown line credits the defense', () => {
  const box = apply(byLabel('blocked PAT in play text'));
  assert.equal(def(box, 'DAL').blockedKick, 1);
  assert.equal(def(box, 'GB').blockedKick, 0);
});

test('corpus: an aborted snap recovered by the offense credits nothing', () => {
  const box = apply(byLabel('aborted snap'));
  assert.equal(def(box, 'ATL').fumbleRecovery, 0);
  assert.equal(def(box, 'TB').fumbleRecovery, 0);
  assert.equal(box.players.filter((p) => p.stats.forcedFumble > 0).length, 0);
  assert.equal(box.playTextFindings.length, 0);
});

test('corpus: a sack strip the forcer himself recovers credits SF the recovery and N.Bosa both the FF and the IDP recovery', () => {
  const box = apply(byLabel('sack strip recovered by the forcer himself'));
  assert.equal(def(box, 'SF').fumbleRecovery, 1);
  const bosa = box.players.find((p) => p.stats.forcedFumble === 1);
  assert.ok(bosa);
  assert.equal(bosa.stats.idpFumbleRecovery, 1);
});

test('corpus: a fumble out of bounds is a forced fumble and no recovery', () => {
  const box = apply(byLabel('fumble out of bounds'));
  assert.equal(def(box, 'BAL').fumbleRecovery, 0);
  assert.equal(def(box, 'BUF').fumbleRecovery, 0);
  assert.equal(box.players.filter((p) => p.stats.forcedFumble === 1).length, 1, 'K.Hamilton');
});

test('corpus: an own recovery after a forced fumble credits only the forcer', () => {
  const box = apply(byLabel('own recovery: J.Bosa FF only'));
  assert.equal(def(box, 'BUF').fumbleRecovery, 0);
  assert.equal(def(box, 'BAL').fumbleRecovery, 0);
  assert.equal(box.players.filter((p) => p.stats.forcedFumble === 1).length, 1);
});

test('corpus: a sack strip recovered by DAL-J.Houston credits DAL and J.Houston twice over', () => {
  const box = apply(byLabel('sack strip recovered by DAL-J.Houston'));
  assert.equal(def(box, 'DAL').fumbleRecovery, 1);
  assert.equal(def(box, 'GB').fumbleRecovery, 0);
  const houston = box.players.find((p) => p.stats.forcedFumble === 1);
  assert.ok(houston);
  assert.equal(houston.stats.idpFumbleRecovery, 1);
});

test('corpus: a Safety Score summary line credits the scoring defense', () => {
  const box = apply(byLabel('safety Score summary line'));
  assert.equal(def(box, 'TB').safety, 1);
  assert.equal(def(box, 'PHI').safety, 0);
  assert.equal(box.scoreSummaryLines[0].kind, 'Safety');
});

// --- phase two (#1187): twoPointReturn -----------------------------------------

test('phase two: a defensive two-point return that SUCCEEDS credits twoPointReturn to the named defender', () => {
  const box = apply(byLabel('phase two: defensive two-point return SUCCEEDS'));
  const fitz = box.players.find((p) => p.stats.twoPointReturn === 1);
  assert.ok(fitz, 'M.Fitzpatrick (MIA) gets the return');
  assert.equal(box.players.filter((p) => p.stats.twoPointReturn > 0).length, 1);
  assert.equal(box.playTextFindings.length, 1);
  assert.equal(box.playTextFindings[0].twoPointReturnBy, fitz.externalId);
});

test('phase two: a defensive two-point attempt that FAILS credits nobody (the negative)', () => {
  const box = apply(byLabel('phase two: defensive two-point attempt FAILS'));
  assert.equal(box.players.filter((p) => p.stats.twoPointReturn > 0).length, 0);
  assert.equal(box.playTextFindings.length, 0, 'a fumble recovered on a two-point try is not a Live box takeaway either');
});

test('phase two: a Defensive PAT Conversion Score summary line credits the named defender', () => {
  const box = apply(byLabel('phase two: blocked PAT returned for two'));
  const bell = box.players.find((p) => p.stats.twoPointReturn === 1);
  assert.ok(bell, 'Markquese Bell (DAL) gets the return');
  assert.equal(box.scoreSummaryLines[0].scorerExternalId, bell.externalId);
  assert.equal(box.players.filter((p) => p.stats.twoPointReturn > 0).length, 1);
});

// --- offensive two-point conversions (#2252) ---------------------------------
// The touchdown's Score summary line carries the try in parentheses with full
// display names. A player with no conversion carries no two-point key at all,
// so the box write keeps a stored count (BOX_KEEP_IF_ABSENT).

const TWO_PT_KEYS = ['passingTwoPt', 'rushingTwoPt', 'receivingTwoPt'];

// Box players carry no name; resolve one through the line's own box roster.
function applyNamed(line) {
  const box = apply(line);
  const ids = new Map();
  for (const team of line.summary.boxscore.players) {
    for (const st of team.statistics) for (const a of st.athletes) ids.set(a.athlete.displayName, a.athlete.id);
  }
  const nameOf = new Map([...ids].map(([n, id]) => [id, n]));
  const p = (name) => box.players.find((x) => x.externalId === ids.get(name));
  const withTwoPt = () => box.players.filter((x) => TWO_PT_KEYS.some((k) => k in x.stats)).map((x) => nameOf.get(x.externalId)).sort();
  return { box, p, withTwoPt };
}

test('two-point: "A Pass to B for Two-Point Conversion" credits the passer and the receiver', () => {
  const { p, withTwoPt } = applyNamed(byLabel('two-point pass conversion: Allen to Kincaid'));
  assert.equal(p('Josh Allen').stats.passingTwoPt, 1);
  assert.equal(p('Dalton Kincaid').stats.receivingTwoPt, 1);
  assert.deepEqual(withTwoPt(), ['Dalton Kincaid', 'Josh Allen']);
  assert.equal('rushingTwoPt' in p('Josh Allen').stats, false, 'the 1-yard TD run is not a two-point run');
  assert.deepEqual(p('Josh Allen').stats.rushingTDLengths, [1], 'the TD length still reads');
});

test('two-point: a second game binds the pass pattern (Love to Golden)', () => {
  const { p, withTwoPt } = applyNamed(byLabel('two-point pass conversion: Love to Golden'));
  assert.equal(p('Jordan Love').stats.passingTwoPt, 1);
  assert.equal(p('Matthew Golden').stats.receivingTwoPt, 1);
  assert.equal(withTwoPt().length, 2);
});

test('two-point: "A Run for Two-Point Conversion" credits the rusher only', () => {
  const { p, withTwoPt } = applyNamed(byLabel('two-point run conversion: Henry'));
  assert.equal(p('Derrick Henry').stats.rushingTwoPt, 1);
  assert.deepEqual(withTwoPt(), ['Derrick Henry']);
  assert.deepEqual(p('Devontez Walker').stats.receivingTDLengths, [7], 'the TD length still reads');
});

test('two-point: a second game binds the run pattern, suffix included (Etienne Jr.)', () => {
  const { p, withTwoPt } = applyNamed(byLabel('two-point run conversion: Etienne Jr.'));
  assert.equal(p('Travis Etienne Jr.').stats.rushingTwoPt, 1);
  assert.deepEqual(withTwoPt(), ['Travis Etienne Jr.']);
});

test('two-point: a same-name player on the other team is never credited', () => {
  const line = structuredClone(byLabel('two-point pass conversion: Allen to Kincaid'));
  // Put a LAR "Dalton Kincaid" FIRST, so a both-teams lookup would find him.
  const teams = line.summary.boxscore.players;
  teams.sort((a) => (a.team.abbreviation === 'LAR' ? -1 : 1));
  line.summary.header.competitions[0].competitors.sort((c) => (c.team.abbreviation === 'LAR' ? -1 : 1));
  teams[0].statistics[0].athletes.push({ athlete: { id: '999999', displayName: 'Dalton Kincaid' }, stats: [] });
  const box = apply(line);
  assert.equal('receivingTwoPt' in box.players.find((x) => x.externalId === '999999').stats, false);
  const real = teams[1].statistics.flatMap((s) => s.athletes).find((a) => a.athlete.displayName === 'Dalton Kincaid');
  assert.equal(box.players.find((x) => x.externalId === real.athlete.id).stats.receivingTwoPt, 1);
});

test('two-point: a "Conversion Failed" line credits nobody (the negative)', () => {
  const { p, withTwoPt } = applyNamed(byLabel('two-point conversion Failed'));
  assert.equal(withTwoPt().length, 0);
  assert.deepEqual(p('Puka Nacua').stats.receivingTDLengths, [2]);
});

test('two-point: a name missing from the box credits nobody and does not throw', () => {
  const line = structuredClone(byLabel('two-point pass conversion: Allen to Kincaid'));
  for (const team of line.summary.boxscore.players) {
    for (const st of team.statistics) st.athletes = st.athletes.filter((a) => a.athlete.displayName !== 'Dalton Kincaid');
  }
  const { p, withTwoPt } = applyNamed(line);
  assert.equal(p('Josh Allen').stats.passingTwoPt, 1, 'the passer still counts');
  assert.deepEqual(withTwoPt(), ['Josh Allen']);
});

// --- reviews and penalties (#2003) ---------------------------------------------
// ESPN keeps the original description in front of the review sentence, so a
// fumble that did not stand still reads FUMBLES and RECOVERED by.

test('corpus: a fumble the replay REVERSED credits no recovery, no IDP recovery and no forced fumble', () => {
  const box = apply(byLabel('reversed fumble: DEN at PHI'));
  assert.equal(def(box, 'PHI').fumbleRecovery, 0);
  assert.equal(def(box, 'DEN').fumbleRecovery, 0);
  assert.equal(box.players.filter((p) => p.stats.idpFumbleRecovery > 0).length, 0);
  assert.equal(box.players.filter((p) => p.stats.forcedFumble > 0).length, 0);
  assert.equal(box.playTextFindings.length, 0);
});

test('corpus: a fumble erased by a penalty ("- No Play") credits no recovery, no IDP recovery and no forced fumble', () => {
  const box = apply(byLabel('No Play fumble: CAR at ARI'));
  assert.equal(def(box, 'ARI').fumbleRecovery, 0);
  assert.equal(def(box, 'CAR').fumbleRecovery, 0);
  assert.equal(box.players.filter((p) => p.stats.idpFumbleRecovery > 0).length, 0);
  assert.equal(box.players.filter((p) => p.stats.forcedFumble > 0).length, 0);
  assert.equal(box.playTextFindings.length, 0);
});

test('corpus: an UPHELD review leaves the fumble standing (control: the guard must not skip every review)', () => {
  const box = apply(byLabel('upheld review: PHI-K.Ringo'));
  assert.equal(def(box, 'PHI').fumbleRecovery, 1);
  assert.equal(box.players.filter((p) => p.stats.idpFumbleRecovery === 1).length, 1, 'K.Ringo');
  assert.equal(box.players.filter((p) => p.stats.forcedFumble === 1).length, 1, 'J.Hunt');
});

test('corpus: a reversal INTO a fumble credits the fumble that follows the last REVERSED (control: no blanket skip)', () => {
  const box = apply(byLabel('reversal into a fumble'));
  assert.equal(def(box, 'HOU').fumbleRecovery, 1);
  assert.equal(def(box, 'LAR').fumbleRecovery, 0);
  assert.equal(box.players.filter((p) => p.stats.idpFumbleRecovery === 1).length, 1, 'D.Hunter');
  assert.equal(box.players.filter((p) => p.stats.forcedFumble === 1).length, 1, 'A.Al-Shaair');
});

test('corpus: the whole corpus produces exactly the expected takeaway totals', () => {
  let recoveries = 0;
  let blocks = 0;
  let forced = 0;
  for (const line of corpus.lines) {
    const box = apply(line);
    for (const d of Object.values(box.teamDefense)) {
      recoveries += d.fumbleRecovery;
      blocks += d.blockedKick;
    }
    for (const p of box.players) forced += p.stats.forcedFumble;
  }
  assert.equal(recoveries, 7, 'IND, PIT, TEN, SF, DAL, PHI (upheld), HOU (reversal into a fumble); none from blocks, own recoveries, two-point tries, a REVERSED fumble or a No Play');
  assert.equal(blocks, 4, 'two blocked FGs, one blocked punt, one blocked PAT');
  assert.equal(forced, 9, 'K.Moore, K.Gainwell, M.McCrary-Ball, N.Bosa, K.Hamilton, J.Bosa, J.Houston, J.Hunt (upheld), A.Al-Shaair (reversal into a fumble); none for a REVERSED or No Play fumble, Q.Williams (ambiguous) or Aborted');
  let twoPointReturns = 0;
  for (const line of corpus.lines) {
    for (const p of apply(line).players) twoPointReturns += p.stats.twoPointReturn;
  }
  assert.equal(twoPointReturns, 2, 'M.Fitzpatrick and Markquese Bell; not C.Gray');
});
