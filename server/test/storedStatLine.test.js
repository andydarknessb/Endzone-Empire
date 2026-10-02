/**
 * The one ownership table: what a Stat line becomes when a source writes it
 * (#1760, spec #1758). Pure: no pool, no mocks. Each of the four sources is
 * run against a prior of none, box-only, nflverse-only and mixed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { storedStatLine, STAT_KEY_OWNERSHIP } = require('../services/playerStatsWrite.service');

const BOX_ONLY_PRIOR = { passingYards: 100, passingTDs: 1, passingTDLengths: [40], fumbles: 1 };
const NFLVERSE_ONLY_PRIOR = {
  gameTeam: 'KC', gameOpponent: 'DEN', usageTargets: 9, usageTargetShare: 0.3, epaReceiving: 1.5,
  usageOffenseSnaps: 60, usageOffenseSnapPct: 0.9, idpSackYards: 7, kickReturns: 2,
  passingTwoPt: 1, receivingYards: 88,
};
const MIXED_PRIOR = { ...BOX_ONLY_PRIOR, ...NFLVERSE_ONLY_PRIOR, receivingTDs: 1, receivingTDLengths: [22] };

const stats = (result) => (result === null ? null : result.stats);

// --- box: replace, may create ----------------------------------------------

test('box, no prior: creates the line from the fresh keys', () => {
  const fresh = { passingYards: 250, passingTDs: 2, passingTDLengths: [10, 30] };
  assert.deepEqual(stats(storedStatLine({ source: 'box', fresh, prior: null })), fresh);
});

test('box carries snap, usage, share and EPA keys forward (nflverse-only prior)', () => {
  const fresh = { passingYards: 0, receivingYards: 12, receptions: 1 };
  const out = stats(storedStatLine({ source: 'box', fresh, prior: NFLVERSE_ONLY_PRIOR }));
  for (const key of ['usageTargets', 'usageTargetShare', 'epaReceiving', 'usageOffenseSnaps',
    'usageOffenseSnapPct', 'gameTeam', 'gameOpponent', 'idpSackYards']) {
    assert.equal(out[key], NFLVERSE_ONLY_PRIOR[key], key);
  }
  assert.equal(out.receivingYards, 12, 'the fresh box value wins over the nflverse one');
  assert.equal(out.kickReturns, 2, 'a key the box does not own is carried');
  assert.equal(out.passingTwoPt, 1, 'a key the box does not own is carried');
});

test('box lowering a scoring stat the prior held: the fresh value wins, even at 0', () => {
  const fresh = { passingYards: 90, passingTDs: 0, passingTDLengths: [], fumbles: 0 };
  const out = stats(storedStatLine({ source: 'box', fresh, prior: BOX_ONLY_PRIOR }));
  assert.equal(out.passingYards, 90);
  assert.equal(out.passingTDs, 0);
  assert.deepEqual(out.passingTDLengths, []);
  assert.equal(out.fumbles, 0);
});

test('box removes an owned key the fresh line no longer carries', () => {
  const out = stats(storedStatLine({ source: 'box', fresh: { passingYards: 90 }, prior: BOX_ONLY_PRIOR }));
  assert.equal('passingTDs' in out, false);
  assert.equal('passingTDLengths' in out, false);
  assert.equal(out.passingYards, 90);
});

test('box against a mixed prior keeps every nflverse key and replaces every box key', () => {
  const fresh = { passingYards: 5, receivingYards: 6 };
  const out = stats(storedStatLine({ source: 'box', fresh, prior: MIXED_PRIOR }));
  assert.equal(out.usageOffenseSnaps, 60);
  assert.equal(out.epaReceiving, 1.5);
  assert.equal(out.passingYards, 5);
  assert.equal(out.receivingYards, 6);
  assert.equal('receivingTDs' in out, false, 'an owned box key absent from the fresh line is removed');
  assert.equal('receivingTDLengths' in out, false);
});

test('box keeps a stored idpInterceptionReturnYards a Tank01 box has no field for, but a fresh value wins', () => {
  const prior = { idpInterception: 1, idpInterceptionReturnYards: 27, kickReturnYards: 9 };
  const kept = stats(storedStatLine({ source: 'box', fresh: { idpInterception: 1 }, prior }));
  assert.equal(kept.idpInterceptionReturnYards, 27);
  assert.equal('kickReturnYards' in kept, false, 'the old carry list never held kickReturnYards');
  const fresh = stats(storedStatLine({ source: 'box', fresh: { idpInterception: 1, idpInterceptionReturnYards: 31 }, prior }));
  assert.equal(fresh.idpInterceptionReturnYards, 31);
});

test('box: a fresh key with value undefined counts as absent', () => {
  const out = stats(storedStatLine({ source: 'box', fresh: { passingYards: undefined, receptions: 3 }, prior: BOX_ONLY_PRIOR }));
  assert.equal('passingYards' in out, false);
  assert.equal(out.receptions, 3);
});

test('box: a team-defense line, prior none and prior nflverse (gameTeam carried)', () => {
  const fresh = { sack: 3, interceptionReturn: 1, pointsAllowed: 17, yardsAllowed: 300 };
  assert.deepEqual(stats(storedStatLine({ source: 'box', fresh, prior: null })), fresh);
  const out = stats(storedStatLine({
    source: 'box', fresh, prior: { gameTeam: 'KC', gameOpponent: 'DEN', sack: 1, blockedKick: 1 },
  }));
  assert.equal(out.gameTeam, 'KC');
  assert.equal(out.sack, 3);
  assert.equal('blockedKick' in out, false);
});

// --- nflverse-correction: replace, may create -------------------------------

const CORRECTION_FRESH = {
  gameTeam: 'KC', gameOpponent: 'DEN', passingYards: 300, passingTDs: 3, receivingYards: 0,
  usageTargets: 4, usageTargetShare: 0.2, epaPassing: 0.4, idpSackYards: 0,
};

test('correction, no prior: creates the line from the fresh keys', () => {
  assert.deepEqual(stats(storedStatLine({ source: 'nflverse-correction', fresh: CORRECTION_FRESH, prior: null })), CORRECTION_FRESH);
});

test('correction carries touchdown-length lists and snap keys forward', () => {
  const prior = { ...MIXED_PRIOR, rushingTDLengths: [3] };
  const out = stats(storedStatLine({ source: 'nflverse-correction', fresh: CORRECTION_FRESH, prior }));
  assert.deepEqual(out.passingTDLengths, [40]);
  assert.deepEqual(out.receivingTDLengths, [22]);
  assert.deepEqual(out.rushingTDLengths, [3]);
  assert.equal(out.usageOffenseSnaps, 60);
  assert.equal(out.usageOffenseSnapPct, 0.9);
});

test('correction: its own value replaces the box value', () => {
  const out = stats(storedStatLine({
    source: 'nflverse-correction', fresh: { passingYards: 120, passingTDs: 1 }, prior: BOX_ONLY_PRIOR,
  }));
  assert.equal(out.passingYards, 120);
  assert.equal(out.passingTDs, 1);
});

test('correction removes a scoring key the prior held', () => {
  const out = stats(storedStatLine({
    source: 'nflverse-correction', fresh: { passingYards: 120 }, prior: BOX_ONLY_PRIOR,
  }));
  assert.equal('passingTDs' in out, false);
  assert.equal('fumbles' in out, false);
  assert.deepEqual(out.passingTDLengths, [40], 'the length list is not the correction\'s to remove');
});

test('correction against an nflverse-only prior replaces the nflverse keys it owns', () => {
  const out = stats(storedStatLine({
    source: 'nflverse-correction', fresh: { usageTargets: 2, gameTeam: 'KC' }, prior: NFLVERSE_ONLY_PRIOR,
  }));
  assert.equal(out.usageTargets, 2);
  assert.equal('usageTargetShare' in out, false);
  assert.equal(out.usageOffenseSnaps, 60);
});

// --- nflverse-week: patch, may create only from per-defender yardage --------

test('week patch with only share/EPA keys and no prior returns null', () => {
  const fresh = { usageTargetShare: 0.3, usageAirYardsShare: 0.2, usageWopr: 0.5, epaPassing: null, epaRushing: 1, epaReceiving: 2 };
  assert.equal(storedStatLine({ source: 'nflverse-week', fresh, prior: null }), null);
});

test('week patch of zero yardage and no prior returns null', () => {
  const fresh = { idpSackYards: 0, idpTacklesForLossYards: 0, idpFumbleReturnYards: 0, idpInterceptionReturnYards: 0, idpSafety: 0, usageWopr: 0.4 };
  assert.equal(storedStatLine({ source: 'nflverse-week', fresh, prior: null }), null);
});

test('week patch with a non-zero per-defender yardage value and no prior creates a line', () => {
  const fresh = { idpSackYards: 9, idpTacklesForLossYards: 0, idpFumbleReturnYards: 0, idpInterceptionReturnYards: 0, idpSafety: 0, usageWopr: 0.4, epaPassing: 1 };
  const out = stats(storedStatLine({ source: 'nflverse-week', fresh, prior: null }));
  assert.equal(out.idpSackYards, 9);
  assert.equal('usageWopr' in out, false, 'share/EPA keys never ride into a created line');
  assert.equal('epaPassing' in out, false);
});

test('week patch of a safety alone and no prior creates a line (the finalization patch counts it)', () => {
  const out = stats(storedStatLine({ source: 'nflverse-week', fresh: { idpSackYards: 0, idpSafety: 1, usageWopr: 0.4 }, prior: null }));
  assert.deepEqual(out, { idpSackYards: 0, idpSafety: 1 });
});

test('week patch with prior: every owned key merges onto the prior line, share/EPA included', () => {
  const fresh = { idpSackYards: 4, idpSafety: 0, usageTargetShare: 0.1, epaReceiving: null };
  const out = stats(storedStatLine({ source: 'nflverse-week', fresh, prior: BOX_ONLY_PRIOR }));
  assert.equal(out.passingYards, 100);
  assert.deepEqual(out.passingTDLengths, [40]);
  assert.equal(out.idpSackYards, 4);
  assert.equal(out.usageTargetShare, 0.1);
  assert.equal(out.epaReceiving, null);
});

test('week patch against a mixed prior leaves every key it does not own alone', () => {
  const out = stats(storedStatLine({ source: 'nflverse-week', fresh: { idpSackYards: 1 }, prior: MIXED_PRIOR }));
  assert.equal(out.idpSackYards, 1);
  assert.equal(out.usageOffenseSnaps, 60);
  assert.equal(out.receivingYards, 88);
  assert.equal(out.usageTargets, 9);
});

test('week patch against an nflverse-only prior replaces its own keys and keeps the rest', () => {
  const out = stats(storedStatLine({
    source: 'nflverse-week', fresh: { idpSackYards: 11, usageTargetShare: 0.5, epaReceiving: null }, prior: NFLVERSE_ONLY_PRIOR,
  }));
  assert.deepEqual(out, { ...NFLVERSE_ONLY_PRIOR, idpSackYards: 11, usageTargetShare: 0.5, epaReceiving: null });
});

test('week patch writes gameTeam/gameOpponent onto a box-only prior that lacks them (the nightly pass, not only the Tue/Wed correction)', () => {
  const out = stats(storedStatLine({
    source: 'nflverse-week', fresh: { idpSackYards: 0, gameTeam: 'WAS', gameOpponent: 'DAL' }, prior: BOX_ONLY_PRIOR,
  }));
  assert.equal(out.gameTeam, 'WAS');
  assert.equal(out.gameOpponent, 'DAL');
  assert.equal(out.passingYards, 100, 'no scored key moves');
});

test('week patch carries gameTeam/gameOpponent into a line it creates from yardage', () => {
  const out = stats(storedStatLine({
    source: 'nflverse-week', fresh: { idpSackYards: 9, gameTeam: 'KC', gameOpponent: 'DEN' }, prior: null,
  }));
  assert.equal(out.gameTeam, 'KC');
  assert.equal(out.gameOpponent, 'DEN');
});

test('week patch with gameTeam alone and no prior still creates nothing', () => {
  assert.equal(storedStatLine({ source: 'nflverse-week', fresh: { gameTeam: 'KC', gameOpponent: 'DEN' }, prior: null }), null);
});

test('week patch that omits gameTeam keeps the stored one', () => {
  const out = stats(storedStatLine({ source: 'nflverse-week', fresh: { idpSackYards: 1 }, prior: NFLVERSE_ONLY_PRIOR }));
  assert.equal(out.gameTeam, 'KC');
  assert.equal(out.gameOpponent, 'DEN');
});

test('week patch ignores a fresh key it does not own', () => {
  const out = stats(storedStatLine({ source: 'nflverse-week', fresh: { idpSackYards: 1, passingYards: 999 }, prior: BOX_ONLY_PRIOR }));
  assert.equal(out.passingYards, 100);
});

// --- nflverse-snaps: patch, never creates -----------------------------------

const SNAP_FRESH = { usageOffenseSnaps: 50, usageOffenseSnapPct: 0.8, usageDefenseSnaps: null, usageDefenseSnapPct: null };

test('snap patch with no prior returns null', () => {
  assert.equal(storedStatLine({ source: 'nflverse-snaps', fresh: SNAP_FRESH, prior: null }), null);
  assert.equal(storedStatLine({ source: 'nflverse-snaps', fresh: SNAP_FRESH, prior: undefined }), null);
});

test('snap patch applied onto a prior line, box-only and mixed', () => {
  const box = stats(storedStatLine({ source: 'nflverse-snaps', fresh: SNAP_FRESH, prior: BOX_ONLY_PRIOR }));
  assert.deepEqual(box, { ...BOX_ONLY_PRIOR, ...SNAP_FRESH });
  const mixed = stats(storedStatLine({ source: 'nflverse-snaps', fresh: SNAP_FRESH, prior: MIXED_PRIOR }));
  assert.equal(mixed.usageOffenseSnaps, 50);
  assert.equal(mixed.usageDefenseSnaps, null);
  assert.equal(mixed.usageTargets, 9);
  assert.deepEqual(mixed.passingTDLengths, [40]);
});

test('snap patch against an nflverse-only prior replaces the snap keys and keeps the rest', () => {
  const out = stats(storedStatLine({ source: 'nflverse-snaps', fresh: SNAP_FRESH, prior: NFLVERSE_ONLY_PRIOR }));
  assert.deepEqual(out, { ...NFLVERSE_ONLY_PRIOR, ...SNAP_FRESH });
});

test('snap patch onto an empty-object prior still patches (a row exists)', () => {
  assert.deepEqual(stats(storedStatLine({ source: 'nflverse-snaps', fresh: SNAP_FRESH, prior: {} })), SNAP_FRESH);
});

// --- the table itself -------------------------------------------------------

test('an unknown source is refused', () => {
  assert.throws(() => storedStatLine({ source: 'tank01', fresh: {}, prior: null }), /unknown stat line source/i);
});

test('storedStatLine mutates neither input', () => {
  const fresh = Object.freeze({ passingYards: 1 });
  const prior = Object.freeze({ ...MIXED_PRIOR });
  for (const source of Object.keys(STAT_KEY_OWNERSHIP)) {
    assert.doesNotThrow(() => storedStatLine({ source, fresh, prior }));
  }
});

test('the ownership table has exactly the four sources, and no key is owned by both patch sources', () => {
  assert.deepEqual(Object.keys(STAT_KEY_OWNERSHIP).sort(), ['box', 'nflverse-correction', 'nflverse-snaps', 'nflverse-week']);
  const week = new Set(STAT_KEY_OWNERSHIP['nflverse-week'].keys);
  for (const key of STAT_KEY_OWNERSHIP['nflverse-snaps'].keys) assert.equal(week.has(key), false, key);
});
