/* eslint-disable no-console */
require('dotenv').config();

const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'peak-sunday-stress-run.log');
const K6_FILE = path.join(LOG_DIR, 'peak-sunday-generated.k6.js');
const K6_SUMMARY = path.join(LOG_DIR, 'peak-sunday-k6-summary.json');
const ROUTE = '/api/scoring/league/00000000-0000-4000-8000-000000007001/correct-week';
const MOCK_PORT = Number(process.env.LOAD_MOCK_PORT || 4174);

const k6Source = `
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const correctionErrors = new Rate('correction_http_errors');
const correctionLatency = new Trend('correction_latency_ms', true);

export const options = {
  scenarios: {
    sunday_matchup_views: {
      executor: 'constant-vus',
      vus: 100,
      duration: __ENV.K6_DURATION || '1m',
      gracefulStop: '5s',
    },
  },
  thresholds: {
    correction_http_errors: ['rate<0.01'],
    correction_latency_ms: ['p(95)<250'],
    http_req_failed: ['rate<0.01'],
  },
};

const baseUrl = __ENV.LOAD_BASE_URL;
const route = '${ROUTE}';

export default function () {
  const response = http.post(
    baseUrl + route,
    JSON.stringify({ season: 2025, week: 17 }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: __ENV.LOAD_AUTH_TOKEN ? 'Bearer ' + __ENV.LOAD_AUTH_TOKEN : '',
      },
      tags: { route: 'correct-week', workload: 'sunday-matchup-view' },
    }
  );
  const ok = check(response, {
    'correction route accepted': (result) => result.status >= 200 && result.status < 400,
  });
  correctionErrors.add(!ok);
  correctionLatency.add(response.timings.duration);
  sleep(1);
}
`;

function commandExists(command, args = ['--version']) {
  return spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'ignore',
    windowsHide: true,
  }).status === 0;
}

function append(stream, source, message) {
  stream.write(`${new Date().toISOString()} source=${source} ${message}\n`);
}

function pipeChild(child, stream, source) {
  child.stdout?.on('data', (chunk) => append(stream, source, String(chunk).trimEnd()));
  child.stderr?.on('data', (chunk) => append(stream, `${source}:stderr`, String(chunk).trimEnd()));
  child.on('error', (error) => append(stream, source, `process_error=${JSON.stringify(error.message)}`));
}

function startMockServer(stream) {
  const server = http.createServer((request, response) => {
    const startedAt = Date.now();
    request.resume();
    request.on('end', () => {
      if (request.method !== 'POST' || request.url !== ROUTE) {
        response.writeHead(404, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'not found' }));
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ mocked: true, correctedWeek: 17 }));
      append(
        stream,
        'mock-server',
        `method=POST route=${ROUTE} status=200 duration_ms=${Date.now() - startedAt}`
      );
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(MOCK_PORT, '127.0.0.1', () => resolve(server));
  });
}

function startLogCollector(stream) {
  if (process.env.LOAD_LOG_COMMAND) {
    const child = spawn(process.env.LOAD_LOG_COMMAND, {
      cwd: ROOT,
      shell: true,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    pipeChild(child, stream, 'configured-logs');
    return child;
  }
  if (commandExists('supabase')) {
    const child = spawn('supabase', ['logs', '--db'], {
      cwd: ROOT,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    pipeChild(child, stream, 'supabase-db');
    return child;
  }
  if (commandExists('docker', ['compose', 'version'])) {
    const child = spawn('docker', ['compose', 'logs', '--follow', '--no-color'], {
      cwd: ROOT,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    pipeChild(child, stream, 'docker-compose');
    return child;
  }
  append(stream, 'collector', 'no_supabase_or_docker_collector_available=true');
  return null;
}

function stopProcess(child) {
  if (!child || child.exitCode != null || child.signalCode != null) return;
  child.kill('SIGTERM');
}

async function stopAndWait(child, completion) {
  if (!child || !completion) return;
  stopProcess(child);
  const stopped = await Promise.race([
    completion.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 5000)),
  ]);
  if (!stopped && child.exitCode == null && child.signalCode == null) {
    child.kill('SIGKILL');
    await completion;
  }
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
}

async function closeServer(server) {
  if (!server) return;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function closeStream(stream) {
  await new Promise((resolve, reject) => {
    stream.once('error', reject);
    stream.end(resolve);
  });
}

async function run() {
  await fsp.mkdir(LOG_DIR, { recursive: true });
  await fsp.writeFile(K6_FILE, k6Source.trimStart(), 'utf8');

  if (!commandExists('k6', ['version'])) {
    throw new Error('k6 is required but was not found on PATH; install k6 before running this pipeline');
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required for automated GPT-5.6 Luna triage');
  }

  const networkMode = process.env.LOAD_NETWORK_MODE || 'mock';
  if (!['mock', 'live'].includes(networkMode)) {
    throw new Error('LOAD_NETWORK_MODE must be mock or live');
  }
  if (networkMode === 'live' && process.env.ALLOW_DESTRUCTIVE_LOAD_TEST !== 'true') {
    throw new Error('Live correct-week traffic requires ALLOW_DESTRUCTIVE_LOAD_TEST=true');
  }
  if (networkMode === 'live' && (!process.env.LOAD_BASE_URL || !process.env.LOAD_AUTH_TOKEN)) {
    throw new Error('Live mode requires LOAD_BASE_URL and LOAD_AUTH_TOKEN');
  }

  const stream = fs.createWriteStream(LOG_FILE, { flags: 'w' });
  let mockServer = null;
  let collector = null;
  let collectorCompletion = null;
  try {
    append(stream, 'pipeline', `network_mode=${networkMode} vus=100 route=${ROUTE}`);
    if (networkMode === 'mock') mockServer = await startMockServer(stream);
    collector = startLogCollector(stream);
    collectorCompletion = collector
      ? waitForExit(collector).catch((error) => ({ error: error.message }))
      : null;

    const baseUrl =
      networkMode === 'mock' ? `http://127.0.0.1:${MOCK_PORT}` : process.env.LOAD_BASE_URL;
    const k6 = spawn(
      'k6',
      ['run', '--summary-export', K6_SUMMARY, K6_FILE],
      {
        cwd: ROOT,
        windowsHide: true,
        env: {
          ...process.env,
          LOAD_BASE_URL: baseUrl,
          LOAD_AUTH_TOKEN: networkMode === 'live' ? process.env.LOAD_AUTH_TOKEN : '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    pipeChild(k6, stream, 'k6');
    const outcome = await waitForExit(k6);
    append(stream, 'pipeline', `k6_exit_code=${outcome.code} k6_signal=${outcome.signal || 'none'}`);
    if (outcome.code !== 0) throw new Error(`k6 exited with code ${outcome.code}`);
  } finally {
    await stopAndWait(collector, collectorCompletion);
    await closeServer(mockServer);
    await closeStream(stream);
  }

  const logStats = await fsp.stat(LOG_FILE).catch(() => null);
  if (!logStats || !logStats.isFile() || logStats.size <= 0) {
    console.error('Load triage stopped: logs/peak-sunday-stress-run.log is missing or empty.');
    process.exitCode = 1;
    return;
  }

  console.log(`Validated ${LOG_FILE} (${logStats.size} bytes). Starting automated triage.`);
  const triage = spawn(process.execPath, [path.join(ROOT, 'scripts', 'triage-sunday-logs.js'), LOG_FILE], {
    cwd: ROOT,
    windowsHide: true,
    env: process.env,
    stdio: 'inherit',
  });
  const outcome = await waitForExit(triage);
  if (outcome.code !== 0) throw new Error(`log triage exited with code ${outcome.code}`);
}

run().catch((error) => {
  console.error(`Load triage pipeline failed: ${error.message}`);
  process.exitCode = 1;
});
