const { promisify } = require('util');
const { gzip } = require('zlib');

const gzipAsync = promisify(gzip);

class BroadcastBackpressureError extends Error {
  constructor(limit) {
    super(`stat broadcast queue reached its ${limit}-event safety limit`);
    this.name = 'BroadcastBackpressureError';
    this.code = 'STAT_BROADCAST_BACKPRESSURE';
  }
}

/**
 * Batches high-frequency Tank01 updates into one gzip-compressed Supabase
 * Realtime broadcast. JavaScript's single event loop makes the queue swap in
 * flush() atomic: updates arriving while compression/send is awaiting land in
 * a fresh queue and are never removed with the in-flight batch.
 *
 * Callers must handle BroadcastBackpressureError and retry later. Rejecting at
 * the explicit limit prevents silent event loss and unbounded heap growth.
 */
class StatBroadcastThrottler {
  constructor({
    channel,
    event = 'PLAYER_STATS_BATCH',
    flushIntervalMs = 3000,
    maxQueueSize = 10000,
    onError = () => {},
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  }) {
    if (!channel || typeof channel.send !== 'function') {
      throw new TypeError('channel.send must be a function');
    }
    if (!Number.isInteger(flushIntervalMs) || flushIntervalMs < 1) {
      throw new TypeError('flushIntervalMs must be a positive integer');
    }
    if (!Number.isInteger(maxQueueSize) || maxQueueSize < 1) {
      throw new TypeError('maxQueueSize must be a positive integer');
    }
    if (typeof onError !== 'function') throw new TypeError('onError must be a function');

    this.channel = channel;
    this.event = event;
    this.flushIntervalMs = flushIntervalMs;
    this.maxQueueSize = maxQueueSize;
    this.onError = onError;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.queue = [];
    this.timer = null;
    this.inFlight = null;
    this.flushAfterFlight = false;
    this.closed = false;
  }

  get size() {
    return this.queue.length;
  }

  enqueue(update) {
    if (this.closed) throw new Error('stat broadcast throttler is closed');
    if (!update || typeof update !== 'object' || Array.isArray(update)) {
      throw new TypeError('stat update must be an object');
    }
    if (this.queue.length >= this.maxQueueSize) {
      throw new BroadcastBackpressureError(this.maxQueueSize);
    }

    this.queue.push({ ...update });
    this.#schedule();
    return this.queue.length;
  }

  async flush() {
    if (this.inFlight) {
      this.flushAfterFlight = true;
      return this.inFlight;
    }
    this.#clearScheduledFlush();
    if (this.queue.length === 0) return false;

    const batch = this.queue;
    this.queue = [];
    this.inFlight = this.#sendBatch(batch)
      .catch((error) => {
        // Failed broadcasts return to the head of the new queue in original
        // order; updates accepted during the send remain behind them.
        this.queue = batch.concat(this.queue);
        throw error;
      })
      .finally(() => {
        this.inFlight = null;
        const flushImmediately = this.flushAfterFlight;
        this.flushAfterFlight = false;
        if (this.queue.length > 0 && !this.closed) {
          if (flushImmediately) queueMicrotask(() => this.flush().catch(this.onError));
          else this.#schedule();
        }
      });

    return this.inFlight;
  }

  async close({ flush = true } = {}) {
    this.closed = true;
    this.#clearScheduledFlush();
    if (this.inFlight) await this.inFlight;
    if (flush && this.queue.length > 0) await this.flush();
  }

  #schedule() {
    if (this.timer || this.inFlight || this.closed) return;
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.flush().catch(this.onError);
    }, this.flushIntervalMs);
    if (this.timer && typeof this.timer.unref === 'function') this.timer.unref();
  }

  #clearScheduledFlush() {
    if (!this.timer) return;
    this.clearTimer(this.timer);
    this.timer = null;
  }

  async #sendBatch(updates) {
    const json = Buffer.from(JSON.stringify({ updates }), 'utf8');
    const compressed = await gzipAsync(json, { level: 1 });
    const status = await this.channel.send({
      type: 'broadcast',
      event: this.event,
      payload: {
        encoding: 'gzip+base64',
        eventCount: updates.length,
        uncompressedBytes: json.length,
        data: compressed.toString('base64'),
      },
    });
    if (status !== 'ok') throw new Error(`Supabase Realtime broadcast failed: ${status}`);
    return true;
  }
}

module.exports = {
  BroadcastBackpressureError,
  StatBroadcastThrottler,
};
