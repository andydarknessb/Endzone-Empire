import http from 'k6/http';
import ws from 'k6/ws';
import exec from 'k6/execution';
import { check } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

/**
 * NFL Sunday notification/chat burst.
 *
 * K6 VUs are isolated event loops. HTTP requests use K6's concurrent VU
 * scheduler; Realtime chat uses WebSocket callbacks and timers so no VU
 * blocks while waiting for messages. Configure the edge/provider URLs to
 * point at a staging gateway, never an uncontrolled production provider.
 */

const LEAGUE_COUNT = 10000;
const TARGET_USERS_PER_LEAGUE = 12;
const CHAT_USERS = 5000;
const CHAT_MESSAGES_PER_SECOND = 3;
const CHAT_INTERVAL_MS = Math.floor(1000 / CHAT_MESSAGES_PER_SECOND);

const supabaseUrl = (__ENV.SUPABASE_URL || '').replace(/\/$/, '');
const anonKey = __ENV.SUPABASE_ANON_KEY || '';
const authToken = __ENV.SUPABASE_JWT || '';
const providerApiKey = __ENV.NOTIFICATION_API_KEY || '';
const edgeFunctionUrl = __ENV.EDGE_FUNCTION_URL ||
  `${supabaseUrl}/functions/v1/close-matchup-alert`;
const notificationApiUrl = __ENV.NOTIFICATION_API_URL || '';
const chatChannelPrefix = __ENV.CHAT_CHANNEL_PREFIX || 'realtime:league:';
const chatEvent = __ENV.CHAT_EVENT || 'CHAT_MESSAGE';
const duration = __ENV.K6_DURATION || '2m';
const notificationVus = Number(__ENV.NOTIFICATION_VUS || LEAGUE_COUNT);

const edgeLatency = new Trend('edge_function_latency_ms', true);
const edgeErrors = new Rate('edge_function_errors');
const providerLatency = new Trend('notification_provider_latency_ms', true);
const providerErrors = new Rate('notification_provider_errors');
const targetTriggers = new Counter('push_target_triggers');
const queueDepth = new Trend('delivery_queue_depth');
const queueWait = new Trend('delivery_queue_wait_ms', true);
const queueBackpressure = new Counter('delivery_queue_backpressure');
const queueRejected = new Counter('delivery_queue_rejected');
const chatConnections = new Counter('chat_connections');
const chatDisconnects = new Counter('chat_disconnects');
const chatMessages = new Counter('chat_messages_sent');
const chatDeliveryLatency = new Trend('chat_delivery_latency_ms', true);
const chatErrors = new Rate('chat_errors');

export const options = {
  scenarios: {
    close_matchup_notification_burst: {
      executor: 'shared-iterations',
      vus: notificationVus,
      iterations: LEAGUE_COUNT,
      maxDuration: __ENV.NOTIFICATION_MAX_DURATION || '10m',
      gracefulStop: '0s',
      startTime: '0s',
      tags: { workload: 'notifications' },
    },
    in_league_chat_burst: {
      executor: 'constant-vus',
      vus: CHAT_USERS,
      duration,
      gracefulStop: '10s',
      startTime: '0s',
      tags: { workload: 'chat' },
    },
  },
  thresholds: {
    edge_function_latency_ms: ['p(95)<1000'],
    notification_provider_latency_ms: ['p(95)<1500'],
    edge_function_errors: ['rate<0.01'],
    notification_provider_errors: ['rate<0.01'],
    delivery_queue_backpressure: ['count<1000'],
    chat_delivery_latency_ms: ['p(95)<500'],
    chat_errors: ['rate<0.01'],
  },
  discardResponseBodies: false,
};

function assertConfiguration() {
  if (!supabaseUrl || !anonKey) {
    throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY are required');
  }
  if (!Number.isInteger(notificationVus) || notificationVus < 1) {
    throw new Error('NOTIFICATION_VUS must be a positive integer');
  }
  if (!edgeFunctionUrl) throw new Error('EDGE_FUNCTION_URL must not be empty');
  if (!notificationApiUrl) {
    throw new Error('NOTIFICATION_API_URL is required to measure provider bottlenecking');
  }
}

function headers() {
  const result = {
    'Content-Type': 'application/json',
    apikey: anonKey,
  };
  if (authToken) result.Authorization = `Bearer ${authToken}`;
  return result;
}

function providerHeaders() {
  const result = headers();
  if (providerApiKey) result.Authorization = `Bearer ${providerApiKey}`;
  return result;
}

function leagueIdForIndex(index) {
  const configured = (__ENV.LEAGUE_IDS || '').split(',').filter(Boolean);
  return configured[index] || String(index + 1);
}

function bodyJson(response) {
  try {
    return response && response.body ? JSON.parse(response.body) : {};
  } catch (_error) {
    return {};
  }
}

function observeQueue(response, tags) {
  const body = bodyJson(response);
  const depth = Number(body.queue_depth ?? body.queueDepth ?? body.queue?.depth);
  const wait = Number(body.queue_wait_ms ?? body.queueWaitMs ?? body.queue?.wait_ms);
  if (Number.isFinite(depth)) queueDepth.add(depth, tags);
  if (Number.isFinite(wait)) queueWait.add(wait, tags);

  const backpressured = response.status === 429 || response.status === 503 ||
    body.backpressure === true || body.queue_status === 'backpressured';
  if (backpressured) queueBackpressure.add(1, tags);
  if (response.status === 429 || body.queue_status === 'rejected') queueRejected.add(1, tags);
}

function notificationPayload(leagueId, iteration) {
  return JSON.stringify({
    event: 'CLOSE_MATCHUP_ALERT',
    league_id: leagueId,
    target_user_count: TARGET_USERS_PER_LEAGUE,
    matchup_id: `sunday-${leagueId}-${iteration}`,
    sent_at_ms: Date.now(),
  });
}

function runNotificationBurst() {
  const leagueIndex = (__ITER || 0) % LEAGUE_COUNT;
  const leagueId = leagueIdForIndex(leagueIndex);
  const payload = notificationPayload(leagueId, __ITER || 0);
  const tagSet = { league_id: leagueId, workload: 'notifications' };
  const requests = [[
    'POST',
    edgeFunctionUrl,
    payload,
    { headers: headers(), tags: { ...tagSet, dependency: 'edge_function' } },
  ]];
  requests.push([
    'POST',
    notificationApiUrl,
    payload,
    { headers: providerHeaders(), tags: { ...tagSet, dependency: 'notification_provider' } },
  ]);

  // K6 batch dispatches both dependency probes without blocking another VU.
  const responses = http.batch(requests);
  const edgeResponse = responses[0];
  const edgeOk = check(edgeResponse, {
    'edge function accepted alert': (response) => response.status >= 200 && response.status < 300,
  });
  edgeLatency.add(edgeResponse.timings.duration, tagSet);
  edgeErrors.add(!edgeOk, tagSet);
  observeQueue(edgeResponse, tagSet);
  if (edgeOk) targetTriggers.add(TARGET_USERS_PER_LEAGUE, tagSet);

  const providerResponse = responses[1];
  const providerOk = check(providerResponse, {
    'notification provider accepted burst': (response) => response.status >= 200 && response.status < 300,
  });
  providerLatency.add(providerResponse.timings.duration, tagSet);
  providerErrors.add(!providerOk, tagSet);
  observeQueue(providerResponse, tagSet);
}

function phoenixMessage(topic, event, payload, ref) {
  return JSON.stringify({ topic, event, payload, ref });
}

function realtimeWebSocketUrl() {
  const websocketUrl = supabaseUrl.replace(/^http/i, 'ws') + '/realtime/v1/websocket';
  return `${websocketUrl}?apikey=${encodeURIComponent(anonKey)}&vsn=1.0.0`;
}

function runChatBurst() {
  const leagueId = leagueIdForIndex((__VU - 1) % LEAGUE_COUNT);
  const topic = `${chatChannelPrefix}${leagueId}`;
  const tags = { league_id: leagueId, workload: 'chat' };
  const response = ws.connect(realtimeWebSocketUrl(), { headers: headers(), tags }, (socket) => {
    let reference = 0;
    socket.on('open', () => {
      chatConnections.add(1, tags);
      socket.send(phoenixMessage(topic, 'phx_join', {
        config: { broadcast: { self: true }, presence: { key: `chat-vu-${__VU}` } },
      }, String(++reference)));
      socket.setInterval(() => {
        const sentAt = Date.now();
        socket.send(phoenixMessage(topic, 'broadcast', {
          type: 'broadcast',
          event: chatEvent,
          payload: {
            league_id: leagueId,
            message_id: `${__VU}-${sentAt}-${reference}`,
            text: `Sunday chat ${reference}`,
            sent_at_ms: sentAt,
          },
        }, String(++reference)));
        chatMessages.add(1, tags);
      }, CHAT_INTERVAL_MS);
    });
    socket.on('message', (rawMessage) => {
      try {
        const message = JSON.parse(rawMessage);
        if (message.event === 'phx_error' || message.event === 'chan_error') {
          chatErrors.add(1, tags);
          return;
        }
        const payload = message.payload?.payload;
        if (message.event === 'broadcast' && Number.isFinite(payload?.sent_at_ms)) {
          chatDeliveryLatency.add(Math.max(0, Date.now() - payload.sent_at_ms), tags);
        }
        if (payload?.backpressure === true || Number(payload?.queue_depth) > 0) {
          queueBackpressure.add(1, tags);
          if (Number.isFinite(Number(payload.queue_depth))) queueDepth.add(Number(payload.queue_depth), tags);
        }
      } catch (_error) {
        chatErrors.add(1, tags);
      }
    });
    socket.on('error', () => chatErrors.add(1, tags));
    socket.on('close', () => chatDisconnects.add(1, tags));
  });
  check(response, { 'chat WebSocket upgrade accepted': (result) => result && result.status === 101 });
}

export function setup() {
  assertConfiguration();
  return { startedAt: new Date().toISOString(), targetTriggers: LEAGUE_COUNT * TARGET_USERS_PER_LEAGUE };
}

export default function notificationBurstVU() {
  if (exec.scenario.name === 'in_league_chat_burst') runChatBurst();
  else runNotificationBurst();
}

function metricValue(data, name, field) {
  return data.metrics[name]?.values?.[field] ?? null;
}

export function handleSummary(data) {
  return {
    stdout: JSON.stringify({
      notificationBurst: {
        expectedTargetTriggers: LEAGUE_COUNT * TARGET_USERS_PER_LEAGUE,
        targetTriggers: metricValue(data, 'push_target_triggers', 'count'),
        edgeP95Ms: metricValue(data, 'edge_function_latency_ms', 'p(95)'),
        edgeErrorRate: metricValue(data, 'edge_function_errors', 'rate'),
        providerP95Ms: metricValue(data, 'notification_provider_latency_ms', 'p(95)'),
        providerErrorRate: metricValue(data, 'notification_provider_errors', 'rate'),
      },
      deliveryQueue: {
        depthP95: metricValue(data, 'delivery_queue_depth', 'p(95)'),
        waitP95Ms: metricValue(data, 'delivery_queue_wait_ms', 'p(95)'),
        backpressureEvents: metricValue(data, 'delivery_queue_backpressure', 'count'),
        rejectedEvents: metricValue(data, 'delivery_queue_rejected', 'count'),
      },
      chat: {
        connections: metricValue(data, 'chat_connections', 'count'),
        messagesSent: metricValue(data, 'chat_messages_sent', 'count'),
        disconnects: metricValue(data, 'chat_disconnects', 'count'),
        deliveryP95Ms: metricValue(data, 'chat_delivery_latency_ms', 'p(95)'),
        errorRate: metricValue(data, 'chat_errors', 'rate'),
      },
    }, null, 2) + '\n',
  };
}
