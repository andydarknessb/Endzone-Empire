const test = require('node:test');
const assert = require('node:assert/strict');
const { promisify } = require('node:util');
const { gunzip } = require('node:zlib');
const {
  BroadcastBackpressureError,
  StatBroadcastThrottler,
} = require('../services/statBroadcastThrottler');

const gunzipAsync = promisify(gunzip);

async function decodeBatch(message) {
  const compressed = Buffer.from(message.payload.data, 'base64');
  return JSON.parse((await gunzipAsync(compressed)).toString('utf8'));
}

test('compresses queued updates into one Supabase broadcast', async () => {
  const sent = [];
  const throttler = new StatBroadcastThrottler({
    channel: { send: async (message) => { sent.push(message); return 'ok'; } },
  });

  throttler.enqueue({ playerId: 'p1', passingYards: 12 });
  throttler.enqueue({ playerId: 'p2', rushingYards: 9 });
  await throttler.flush();
  await throttler.close();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'broadcast');
  assert.equal(sent[0].event, 'PLAYER_STATS_BATCH');
  assert.equal(sent[0].payload.encoding, 'gzip+base64');
  assert.equal(sent[0].payload.eventCount, 2);
  assert.deepEqual((await decodeBatch(sent[0])).updates, [
    { playerId: 'p1', passingYards: 12 },
    { playerId: 'p2', rushingYards: 9 },
  ]);
});

test('queue swap preserves updates arriving during an in-flight broadcast', async () => {
  const sent = [];
  let releaseFirst;
  const firstSend = new Promise((resolve) => { releaseFirst = resolve; });
  const throttler = new StatBroadcastThrottler({
    channel: {
      send: async (message) => {
        sent.push(message);
        if (sent.length === 1) return firstSend;
        return 'ok';
      },
    },
  });

  throttler.enqueue({ sequence: 1 });
  const activeFlush = throttler.flush();
  await new Promise((resolve) => setImmediate(resolve));
  throttler.enqueue({ sequence: 2 });
  releaseFirst('ok');
  await activeFlush;
  await throttler.flush();
  await throttler.close();

  assert.equal(sent.length, 2);
  assert.deepEqual((await decodeBatch(sent[0])).updates, [{ sequence: 1 }]);
  assert.deepEqual((await decodeBatch(sent[1])).updates, [{ sequence: 2 }]);
});

test('failed broadcasts are requeued without reordering', async () => {
  const sent = [];
  const throttler = new StatBroadcastThrottler({
    channel: {
      send: async (message) => {
        sent.push(message);
        return sent.length === 1 ? 'timed out' : 'ok';
      },
    },
  });

  throttler.enqueue({ sequence: 1 });
  throttler.enqueue({ sequence: 2 });
  await assert.rejects(throttler.flush(), /broadcast failed: timed out/);
  assert.equal(throttler.size, 2);
  await throttler.flush();
  await throttler.close();

  assert.deepEqual((await decodeBatch(sent[1])).updates, [
    { sequence: 1 },
    { sequence: 2 },
  ]);
});

test('fails closed at the configured memory safety limit', async () => {
  const throttler = new StatBroadcastThrottler({
    channel: { send: async () => 'ok' },
    maxQueueSize: 1,
  });

  throttler.enqueue({ sequence: 1 });
  assert.throws(() => throttler.enqueue({ sequence: 2 }), BroadcastBackpressureError);
  await throttler.close();
});
