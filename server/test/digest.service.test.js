const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const pushAlerts = require('../services/pushAlerts.service');
const lineupService = require('../services/lineup.service');
const projectionService = require('../services/projection.service');

// deliverEmail rides nodemailer when SMTP_URL is set; the transporter is cached
// on first use, so the stub is installed once and its behaviour swapped per test.
process.env.SMTP_URL = 'smtp://digest.test';
let sendMail = async () => ({ messageId: 'x' });
require('nodemailer').createTransport = () => ({ sendMail: (mail) => sendMail(mail) });

const { sendWeeklyRecapDigest, sendWaiverResultsDigest, sendLineupReminders } = require('../services/digest.service');

// First address bounces (an SMTP error), the rest deliver.
function bounceFirst() {
  const delivered = [];
  sendMail = async ({ to }) => {
    if (to === 'bad@example.test') throw new Error('550 mailbox unavailable');
    delivered.push(to);
    return { messageId: to };
  };
  return delivered;
}

test('sendWeeklyRecapDigest: one bounced address does not skip the members after it', async (t) => {
  createFakePool([
    [/FROM "league_analytics"/, () => ({ rows: [{ data: { narrative: 'A recap.' } }] })],
    [/FROM "teams"/, () => ({ rows: [
      { id: 1, email: 'bad@example.test', league_name: 'L' },
      { id: 2, email: 'good@example.test', league_name: 'L' },
    ] })],
    [/FROM "notification_prefs"/, () => ({ rows: [] })],
  ]).install(t);
  t.mock.method(console, 'error', () => {});
  const delivered = bounceFirst();

  const result = await sendWeeklyRecapDigest({ leagueId: 7, season: 2026, week: 3 });

  assert.deepEqual(delivered, ['good@example.test']);
  assert.deepEqual(result, { sent: 1 });
});

test('sendWaiverResultsDigest: one bounced address does not skip the owners after it', async (t) => {
  t.mock.method(pushAlerts, 'sendAlert', async () => ({ fresh: [
    { email: 'bad@example.test', leagueName: 'L', lines: ['Won A'] },
    { email: 'good@example.test', leagueName: 'L', lines: ['Won B'] },
  ] }));
  t.mock.method(console, 'error', () => {});
  const delivered = bounceFirst();

  const result = await sendWaiverResultsDigest({ leagueId: 7 });

  assert.deepEqual(delivered, ['good@example.test']);
  assert.deepEqual(result, { sent: 1 });
});

// #2391: a starting seat spent by a spared off-roster row (#627) is filled, as
// spentStartingSlots treats it on a save. The fake answers the lineup read the
// way the table would: the off-roster row comes back only from a statement that
// LEFT JOINs team_players, never from one that inner JOINs it.
test('sendLineupReminders: a K seat spent by an off-roster row is not reported empty (#2391)', async (t) => {
  t.mock.method(lineupService, 'materializeLineup', async () => {});
  t.mock.method(projectionService, 'getWeeklyProjections', async () => ({
    startVerdictFor: () => ({ outcome: 'recommendable', reason: null, numberTrusted: true }),
  }));
  const alerts = [];
  t.mock.method(pushAlerts, 'sendAlert', async (args) => { alerts.push(args); return { fresh: [] }; });
  const league = { id: 1, current_season: 2026, current_week: 8, best_ball: false, scoring_preset: 'half_ppr', roster_positions: null };
  const spared = { slot: 'K', player_id: 9, ir_attested: false, name: 'Spared Kicker', injury_status: null, nfl_team: 'KC', spent: true };
  createFakePool([
    [/FROM "leagues"/, () => ({ rows: [league] })],
    [/^SELECT 1 FROM "nfl_games"/, () => ({ rows: [{ '?column?': 1 }] })],
    [/FROM "nfl_games"/, () => ({ rows: [] })],
    [/FROM "teams"/, () => ({ rows: [{ id: 3, name: 'T', owner_id: 5, email: 'o@example.test' }] })],
    [/FROM "notification_prefs"/, () => ({ rows: [] })],
    [/FROM "lineup_entries"/, (text) => ({ rows: /LEFT JOIN "team_players"/.test(text) ? [spared] : [] })],
  ]).install(t);

  await sendLineupReminders();

  assert.equal(alerts.length, 1, 'the team has other empty seats, so a reminder is raised');
  assert.equal(alerts[0].problems.some((p) => /empty K slot/.test(p)), false, 'the spent K seat is filled');
});
