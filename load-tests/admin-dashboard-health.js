import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:5000').replace(/\/$/, '');
const LEAGUE_ID = __ENV.LEAGUE_ID || '00000000-0000-4000-8000-000000007001';
const SEASON = Number(__ENV.SEASON || new Date().getUTCFullYear());
const WEEK = Number(__ENV.WEEK || 1);
const USER_TOKENS = (__ENV.USER_JWTS || __ENV.USER_JWT || '')
  .split(',')
  .map((token) => token.trim())
  .filter(Boolean);
const ADMIN_TOKEN = (__ENV.ADMIN_JWT || '').trim();
const DURATION = __ENV.K6_DURATION || '2m';
const ADMIN_START = __ENV.ADMIN_START || '15s';

const regularRequests = new Counter('regular_lineup_requests');
const regularQueueLimited = new Counter('regular_queue_limited');
const regularServerErrors = new Counter('regular_server_errors');
const serverErrors5xx = new Counter('server_5xx_errors');
const regularSuccess = new Rate('regular_lineup_success');
const adminSyncSuccess = new Rate('admin_sync_success');
const adminHealthSuccess = new Rate('admin_health_success');
const adminFailures = new Counter('admin_failures');
const gatewayTimeouts = new Counter('gateway_504s');
const deadlockResponses = new Counter('deadlock_responses');
const adminSyncLatency = new Trend('admin_sync_latency_ms', true);
const healthRefreshLatency = new Trend('admin_health_refresh_latency_ms', true);

export const options = {
  scenarios: {
    regular_lineup_traffic: {
      executor: 'constant-vus',
      vus: 500,
      duration: DURATION,
      gracefulStop: '10s',
      tags: { role: 'regular' },
    },
    admin_emergency_sync: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      exec: 'adminEmergencySync',
      startTime: ADMIN_START,
      maxDuration: '5m',
      gracefulStop: '10s',
      tags: { role: 'admin' },
    },
  },
  thresholds: {
    regular_lineup_success: ['rate>0.95'],
    regular_server_errors: ['count==0'],
    server_5xx_errors: ['count==0'],
    gateway_504s: ['count==0'],
    deadlock_responses: ['count==0'],
    admin_sync_success: ['rate==1'],
    admin_health_success: ['rate==1'],
    admin_failures: ['count==0'],
    admin_sync_latency_ms: ['p(95)<30000'],
    admin_health_refresh_latency_ms: ['p(95)<5000'],
  },
  discardResponseBodies: false,
};

function requireConfiguration() {
  if (!BASE_URL || !LEAGUE_ID) throw new Error('BASE_URL and LEAGUE_ID are required');
  if (USER_TOKENS.length === 0) {
    throw new Error('USER_JWT or USER_JWTS is required for lineup traffic');
  }
  if (!ADMIN_TOKEN) throw new Error('ADMIN_JWT is required for the emergency sync');
  if (!Number.isInteger(SEASON) || !Number.isInteger(WEEK) || WEEK < 1) {
    throw new Error('SEASON and WEEK must be valid integers');
  }
}

function bearer(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };
}

function bodyHasDatabaseFailure(response) {
  return /deadlock detected|too many connections for role|connection pool|supavisor/i
    .test(response.body || '');
}

function recordServerHealth(response, role) {
  if (response.status === 504) gatewayTimeouts.add(1, { role });
  if (response.status >= 500) {
    serverErrors5xx.add(1, { role });
    if (role === 'regular') regularServerErrors.add(1, { role });
  }
  if (bodyHasDatabaseFailure(response)) deadlockResponses.add(1, { role });
}

function tokenForVu() {
  return USER_TOKENS[(__VU - 1) % USER_TOKENS.length];
}

function isJsonResponse(response) {
  const contentType = response.headers['Content-Type'] || response.headers['content-type'] || '';
  return String(contentType).toLowerCase().includes('json');
}

export function setup() {
  requireConfiguration();
  return { startedAt: Date.now() };
}

export default function () {
  const response = http.get(
    `${BASE_URL}/api/team/lineup?leagueId=${encodeURIComponent(LEAGUE_ID)}`,
    { headers: bearer(tokenForVu()), tags: { role: 'regular', endpoint: 'lineup' } }
  );
  regularRequests.add(1);
  recordServerHealth(response, 'regular');

  if (response.status === 429) regularQueueLimited.add(1);
  regularSuccess.add(response.status === 200);
  check(response, {
    'regular lineup view returns 200': (result) => result.status === 200,
    'regular lineup response is JSON': (result) => isJsonResponse(result),
    'regular lineup has no deadlock signature': (result) => !bodyHasDatabaseFailure(result),
  });
  sleep(Number(__ENV.USER_THINK_TIME_SECONDS || 2));
}

export function adminEmergencySync() {
  const startedAt = Date.now();
  const syncResponse = http.post(
    `${BASE_URL}/api/admin/sync/stats`,
    JSON.stringify({ season: SEASON, week: WEEK }),
    { headers: { ...bearer(ADMIN_TOKEN), 'Content-Type': 'application/json' }, tags: { role: 'admin', endpoint: 'sync' } }
  );
  adminSyncLatency.add(Date.now() - startedAt);
  recordServerHealth(syncResponse, 'admin');

  const syncBody = (() => {
    try { return syncResponse.json(); } catch (_error) { return {}; }
  })();
  const syncSucceeded = syncResponse.status === 200 &&
    syncBody && Number(syncBody.season) === SEASON && Number(syncBody.week) === WEEK &&
    syncBody && Number.isFinite(Number(syncBody.playersUpdated)) &&
    Number.isFinite(Number(syncBody.gamesProcessed));
  adminSyncSuccess.add(syncSucceeded);
  if (!syncSucceeded) adminFailures.add(1, { operation: 'sync' });

  check(syncResponse, {
    'admin sync overrides queue limits': (result) => result.status === 200,
    'admin sync reports cache refresh counters': () => syncSucceeded,
    'admin sync has no gateway timeout': (result) => result.status !== 504,
    'admin sync has no database deadlock': (result) => !bodyHasDatabaseFailure(result),
  });

  const healthStartedAt = Date.now();
  const healthResponse = http.get(`${BASE_URL}/api/admin/overview`, {
    headers: bearer(ADMIN_TOKEN),
    tags: { role: 'admin', endpoint: 'overview' },
  });
  healthRefreshLatency.add(Date.now() - healthStartedAt);
  recordServerHealth(healthResponse, 'admin');
  const healthBody = (() => {
    try { return healthResponse.json(); } catch (_error) { return {}; }
  })();
  const dashboardUpdated = healthResponse.status === 200 &&
    healthBody && healthBody.sync && healthBody.sync.statsCoverage !== undefined;
  adminHealthSuccess.add(dashboardUpdated);
  if (!dashboardUpdated) adminFailures.add(1, { operation: 'overview' });

  check(healthResponse, {
    'health dashboard refresh returns 200': (result) => result.status === 200,
    'health dashboard exposes sync coverage': () => dashboardUpdated,
    'health dashboard has no gateway timeout': (result) => result.status !== 504,
    'health dashboard has no database deadlock': (result) => !bodyHasDatabaseFailure(result),
  });
}

function metric(data, name, field) {
  return data.metrics[name]?.values?.[field] ?? null;
}

export function handleSummary(data) {
  return {
    stdout: JSON.stringify({
      configuration: { baseUrl: BASE_URL, leagueId: LEAGUE_ID, season: SEASON, week: WEEK },
      regularTraffic: {
        requests: metric(data, 'regular_lineup_requests', 'count'),
        queueLimited429: metric(data, 'regular_queue_limited', 'count'),
        successRate: metric(data, 'regular_lineup_success', 'rate'),
        serverErrors: metric(data, 'regular_server_errors', 'count'),
      },
      adminOverride: {
        syncSuccessRate: metric(data, 'admin_sync_success', 'rate'),
        syncLatencyP95Ms: metric(data, 'admin_sync_latency_ms', 'p(95)'),
        dashboardRefreshRate: metric(data, 'admin_health_success', 'rate'),
        dashboardRefreshP95Ms: metric(data, 'admin_health_refresh_latency_ms', 'p(95)'),
        failures: metric(data, 'admin_failures', 'count'),
      },
      integrity: {
        gateway504s: metric(data, 'gateway_504s', 'count'),
        databaseDeadlockSignatures: metric(data, 'deadlock_responses', 'count'),
      },
    }, null, 2) + '\n',
  };
}
