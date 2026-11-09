const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { logger } = require('../modules/logger');
const { formatLine, requestLogMiddleware, shouldLog } = require('../modules/requestLog');

test('shouldLog is true for /api paths', () => {
  assert.equal(shouldLog('/api/auth/login'), true);
  assert.equal(shouldLog('/api'), true);
});

test('shouldLog is false for static asset / non-api paths', () => {
  assert.equal(shouldLog('/index.html'), false);
  assert.equal(shouldLog('/static/js/main.js'), false);
  assert.equal(shouldLog('/'), false);
});

test('shouldLog handles non-string input defensively', () => {
  assert.equal(shouldLog(undefined), false);
  assert.equal(shouldLog(null), false);
});

test('formatLine produces valid JSON with the expected fields', () => {
  const line = formatLine({ method: 'GET', path: '/api/league', userId: 42 }, 200, 12);
  const parsed = JSON.parse(line);
  assert.equal(parsed.method, 'GET');
  assert.equal(parsed.path, '/api/league');
  assert.equal(parsed.status, 200);
  assert.equal(parsed.ms, 12);
  assert.equal(parsed.userId, 42);
  assert.equal(typeof parsed.time, 'string');
  assert.ok(!Number.isNaN(Date.parse(parsed.time)), 'time should be a parseable timestamp');
});

test('formatLine defaults userId to null when absent (unauthenticated request)', () => {
  const line = formatLine({ method: 'POST', path: '/api/auth/login' }, 401, 5);
  const parsed = JSON.parse(line);
  assert.equal(parsed.userId, null);
});

/**
 * Sends one GET through an app shaped like server.js: the logger on the app and
 * a router mounted under /api, which trims req.path to its own mount. Resolves
 * with the request-log line the middleware wrote, or null if it wrote none.
 */
async function requestLogLine(t, path) {
  const app = express();
  app.use(requestLogMiddleware);
  const router = express.Router();
  router.get('/draft/mine', (req, res) => res.json([]));
  router.get('/draft/board/:token', (req, res) => res.json({}));
  router.get('/draft/board/:token/activity', (req, res) => res.json([]));
  app.use('/api', router);
  const server = await new Promise((resolve) => {
    const started = app.listen(0, '127.0.0.1', () => resolve(started));
  });
  t.after(() => server.close());

  const original = logger.info;
  let resolveLine;
  const line = new Promise((resolve) => { resolveLine = resolve; });
  logger.info = (entry) => resolveLine(entry);
  t.after(() => { logger.info = original; });
  const timer = setTimeout(() => resolveLine(null), 2000);
  t.after(() => clearTimeout(timer));

  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
  await response.text();
  return line;
}

test('a routed request is logged with its full path and no query string', async (t) => {
  const line = await requestLogLine(t, '/api/draft/mine?leagueId=7');
  assert.ok(line, 'a routed request writes a request-log line');
  assert.equal(line.path, '/api/draft/mine');
  assert.equal(line.status, 200);
});

test('the presenter share token never reaches the request log', async (t) => {
  const line = await requestLogLine(t, '/api/draft/board/secret');
  assert.ok(line, 'the presenter board is logged');
  assert.equal(line.path, '/api/draft/board/:token');
  assert.ok(!JSON.stringify(line).includes('secret'));
});

test('the presenter activity route redacts the token and drops the query string', async (t) => {
  const line = await requestLogLine(t, '/api/draft/board/secret/activity?before=3');
  assert.ok(line, 'the presenter activity feed is logged');
  assert.equal(line.path, '/api/draft/board/:token/activity');
  assert.ok(!JSON.stringify(line).includes('secret'));
});
