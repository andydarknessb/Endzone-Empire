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
  assert.equal(recoveries, 5, 'IND, PIT, TEN, SF, DAL recoveries; none from blocks or own recoveries');
  assert.equal(blocks, 4, 'two blocked FGs, one blocked punt, one blocked PAT');
  assert.equal(forced, 7, 'K.Moore, K.Gainwell, M.McCrary-Ball, N.Bosa, K.Hamilton, J.Bosa, J.Houston; none for Q.Williams (ambiguous) or Aborted');
});
