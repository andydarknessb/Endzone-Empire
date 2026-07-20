/* eslint-disable no-console */
require('dotenv').config();

const fs = require('fs/promises');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_LOG = path.join(ROOT, 'logs', 'peak-sunday-stress-run.log');
const REPORT_FILE = path.join(ROOT, 'logs', 'peak-sunday-sre-health-report.md');
const MODEL = process.env.OPENAI_TRIAGE_MODEL || 'gpt-5.6-luna';

function redact(text) {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
    .replace(/(api[_-]?key|apikey|authorization)["'=:\s]+[^\s,"'}]+/gi, '$1=[REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, 'sk-[REDACTED]');
}

function durationMs(line) {
  const match = line.match(/(?:duration|latency|elapsed|execution_time)(?:_ms)?["'=:\s]+([0-9.]+)\s*(ms|s)?/i);
  if (!match) return null;
  const value = Number(match[1]);
  return match[2]?.toLowerCase() === 's' ? value * 1000 : value;
}

function buildEvidence(raw) {
  const lines = redact(raw).split(/\r?\n/);
  const poolPattern = /supavisor|pool.{0,20}(deplet|exhaust|queue|timeout)|too many connections for role/i;
  const websocketPattern = /websocket|realtime|subscription|channel.{0,20}(drop|disconnect)|backpressure|slow message/i;
  const http5xxPattern = /HTTP\/1\.1\s+5\d\d|Gateway Timeout|status=5\d\d/i;
  const monteCarloPattern = /monte.?carlo|simulation/i;
  const tank01Pattern = /tank01|ingest/i;
  const relevant = [];
  const counts = {
    lines: lines.length,
    poolSignals: 0,
    slowOver250Ms: 0,
    websocketSignals: 0,
    http5xxSignals: 0,
    monteCarloSignals: 0,
    tank01Signals: 0,
  };

  for (const line of lines) {
    const pool = poolPattern.test(line);
    const websocket = websocketPattern.test(line);
    const http5xx = http5xxPattern.test(line);
    const monteCarlo = monteCarloPattern.test(line);
    const tank01 = tank01Pattern.test(line);
    const duration = durationMs(line);
    const slow = duration != null && duration > 250;
    if (pool) counts.poolSignals += 1;
    if (slow) counts.slowOver250Ms += 1;
    if (websocket) counts.websocketSignals += 1;
    if (http5xx) counts.http5xxSignals += 1;
    if (monteCarlo) counts.monteCarloSignals += 1;
    if (tank01) counts.tank01Signals += 1;
    if ((pool || websocket || http5xx || monteCarlo || tank01 || slow) && relevant.length < 10000) {
      relevant.push(line);
    }
  }

  const maxChars = Number(process.env.TRIAGE_MAX_LOG_CHARS || 2000000);
  const content = relevant.length > 0 ? relevant.join('\n') : lines.slice(-2000).join('\n');
  return JSON.stringify(counts, null, 2) + '\n\nRelevant log evidence:\n' + content.slice(0, maxChars);
}

function outputText(response) {
  if (typeof response.output_text === 'string') return response.output_text;
  return (response.output || [])
    .flatMap((item) => item.content || [])
    .filter((content) => content.type === 'output_text' && typeof content.text === 'string')
    .map((content) => content.text)
    .join('\n');
}

async function run() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required');
  const inputFile = path.resolve(process.argv[2] || DEFAULT_LOG);
  const stats = await fs.stat(inputFile).catch(() => null);
  if (!stats || !stats.isFile() || stats.size <= 0) throw new Error(`log file is missing or empty: ${inputFile}`);
  const raw = await fs.readFile(inputFile, 'utf8');
  const evidence = buildEvidence(raw);

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      reasoning: { effort: 'low' },
      text: { verbosity: 'low' },
      max_output_tokens: 5000,
      input: [
        {
          role: 'developer',
          content: [{
            type: 'input_text',
            text: 'Act as a principal SRE. Produce a punchy executive Markdown report. Count only evidence present in the logs; never infer missing events. Cover HTTP 5xx and Edge Function timeouts, Supavisor pool depletion/queuing/role limits, query or Edge Function latency over 250ms, Monte Carlo and Tank01 bottlenecks, and WebSocket/Realtime dropout or backpressure. For each confirmed issue, give one structural recommendation. Explicitly label unavailable telemetry.',
          }],
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: evidence }],
        },
      ],
    }),
    signal: AbortSignal.timeout(120000),
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(`OpenAI Responses API ${response.status}: ${body.error?.message || 'unknown error'}`);
  }
  const report = outputText(body);
  if (!report.trim()) throw new Error('OpenAI response contained no report text');
  await fs.writeFile(REPORT_FILE, report.trim() + '\n', 'utf8');
  console.log(report.trim());
  console.log(`\nReport written to ${REPORT_FILE}`);
}

run().catch((error) => {
  console.error(`Sunday log triage failed: ${error.message}`);
  process.exitCode = 1;
});
