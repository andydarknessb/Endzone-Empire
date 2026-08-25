import ws from 'k6/ws';
import { check } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const VUS = 1200;
const LEAGUE_COUNT = 100;
const USERS_PER_LEAGUE = 12;
const PICKS_INTERVAL_MS = 10000;
const HEARTBEAT_INTERVAL_MS = 30000;

const wsHandshake = new Trend('ws_handshake_ms', true);
const wsMessagePropagation = new Trend('ws_message_propagation_ms', true);
const wsHandshakeHttpErrors = new Rate('ws_handshake_http_errors');
const wsProtocolErrors = new Rate('ws_protocol_errors');
const wsConnections = new Counter('ws_connections');
const wsBroadcasts = new Counter('ws_broadcasts');
const wsMessagesReceived = new Counter('ws_messages_received');

const supabaseUrl = (__ENV.SUPABASE_URL || '').replace(/\/$/, '');
const supabaseAnonKey = __ENV.SUPABASE_ANON_KEY || '';
const authToken = __ENV.SUPABASE_JWT || '';
const playerIdMax = Number(__ENV.PLAYER_ID_MAX || 10000);
let nextRound = 0;
const leagueIds = (__ENV.LEAGUE_IDS || '')
  .split(',')
  .filter(Boolean)
  .map((value) => value.trim());

export const options = {
  scenarios: {
    live_snake_draft: {
      executor: 'constant-vus',
      vus: VUS,
      duration: __ENV.K6_DURATION || '2m',
      gracefulStop: '0s',
    },
  },
  thresholds: {
    ws_handshake_ms: ['p(95)<1000'],
    ws_message_propagation_ms: ['p(95)<500'],
    ws_handshake_http_errors: ['rate<0.01'],
    ws_protocol_errors: ['rate<0.01'],
  },
  discardResponseBodies: true,
};

function assertConfiguration() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY are required');
  }
  if (leagueIds.length > 0 && leagueIds.length !== LEAGUE_COUNT) {
    throw new Error(`LEAGUE_IDS must contain exactly ${LEAGUE_COUNT} comma-separated IDs`);
  }
  if (!Number.isInteger(playerIdMax) || playerIdMax < 1) {
    throw new Error('PLAYER_ID_MAX must be a positive integer');
  }
}

function leagueForVu() {
  const leagueIndex = Math.floor((__VU - 1) / USERS_PER_LEAGUE);
  const configuredId = leagueIds[leagueIndex];
  return configuredId || String(leagueIndex + 1);
}

function realtimeWebSocketUrl(leagueId) {
  const endpoint = supabaseUrl.replace(/^http/i, 'ws') + '/realtime/v1/websocket';
  return `${endpoint}?apikey=${encodeURIComponent(supabaseAnonKey)}&vsn=1.0.0`;
}

function randomPlayerId() {
  return Math.floor(Math.random() * playerIdMax) + 1;
}

function phoenixMessage(topic, event, payload, ref) {
  return JSON.stringify({ topic, event, payload, ref });
}

function summaryMetric(data, name, field) {
  return data.metrics[name]?.values?.[field] ?? null;
}

export function setup() {
  assertConfiguration();
  return { startedAt: new Date().toISOString() };
}

export default function snakeDraftVU() {
  const leagueId = leagueForVu();
  const topic = `realtime:league:${leagueId}`;
  const isLeagueSender = ((__VU - 1) % USERS_PER_LEAGUE) === 0;
  const headers = {};
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const handshakeStarted = Date.now();
  let reference = 0;

  const response = ws.connect(realtimeWebSocketUrl(leagueId), { headers, tags: { league_id: leagueId } }, (socket) => {
    socket.on('open', () => {
      wsConnections.add(1, { league_id: leagueId });
      wsHandshake.add(Date.now() - handshakeStarted, { league_id: leagueId });
      socket.send(
        phoenixMessage(
          topic,
          'phx_join',
          {
            config: {
              broadcast: { self: true },
              presence: { key: `vu-${__VU}` },
              postgres_changes: [],
            },
          },
          String(++reference)
        )
      );

      socket.setInterval(() => {
        socket.send(
          phoenixMessage('phoenix', 'heartbeat', {}, String(++reference))
        );
      }, HEARTBEAT_INTERVAL_MS);

      if (isLeagueSender) {
        socket.setInterval(() => {
          nextRound += 1;
          const sentAt = Date.now();
          socket.send(
            phoenixMessage(
              topic,
              'broadcast',
              {
                type: 'broadcast',
                event: 'PLAYER_PICKED',
                payload: {
                  round_number: nextRound,
                  player_id: randomPlayerId(),
                  sent_at_ms: sentAt,
                  sender_vu: __VU,
                },
              },
              String(++reference)
            )
          );
          wsBroadcasts.add(1, { league_id: leagueId });
        }, PICKS_INTERVAL_MS);
      }
    });

    socket.on('message', (rawMessage) => {
      let message;
      try {
        message = JSON.parse(rawMessage);
      } catch (error) {
        wsProtocolErrors.add(1, { league_id: leagueId });
        return;
      }

      if (message.event === 'phx_error' || message.event === 'chan_error') {
        wsProtocolErrors.add(1, { league_id: leagueId });
        return;
      }

      const payload = message.payload?.payload;
      if (message.event === 'broadcast' && message.payload?.event === 'PLAYER_PICKED') {
        wsMessagesReceived.add(1, { league_id: leagueId });
        if (Number.isFinite(payload?.sent_at_ms)) {
          wsMessagePropagation.add(Math.max(0, Date.now() - payload.sent_at_ms), {
            league_id: leagueId,
          });
        }
      }
    });

    socket.on('error', () => {
      wsProtocolErrors.add(1, { league_id: leagueId });
    });
  });

  const accepted = check(response, {
    'WebSocket upgrade accepted': (result) => result && result.status === 101,
  });
  wsHandshakeHttpErrors.add(!accepted, { league_id: leagueId });
}

export function handleSummary(data) {
  return {
    stdout: JSON.stringify(
      {
        websocket: {
          connections: summaryMetric(data, 'ws_connections', 'count'),
          broadcasts: summaryMetric(data, 'ws_broadcasts', 'count'),
          messagesReceived: summaryMetric(data, 'ws_messages_received', 'count'),
          handshakeP95Ms: summaryMetric(data, 'ws_handshake_ms', 'p(95)'),
          propagationP95Ms: summaryMetric(data, 'ws_message_propagation_ms', 'p(95)'),
          handshakeHttpErrorRate: summaryMetric(data, 'ws_handshake_http_errors', 'rate'),
          protocolErrorRate: summaryMetric(data, 'ws_protocol_errors', 'rate'),
        },
      },
      null,
      2
    ) + '\n',
  };
}
