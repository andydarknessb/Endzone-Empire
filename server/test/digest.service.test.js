const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePool } = require('./helpers/fakePool');
const pushAlerts = require('../services/pushAlerts.service');

// deliverEmail rides nodemailer when SMTP_URL is set; the transporter is cached
// on first use, so the stub is installed once and its behaviour swapped per test.
process.env.SMTP_URL = 'smtp://digest.test';
let sendMail = async () => ({ messageId: 'x' });
require('nodemailer').createTransport = () => ({ sendMail: (mail) => sendMail(mail) });

const { sendWeeklyRecapDigest, sendWaiverResultsDigest } = require('../services/digest.service');

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
