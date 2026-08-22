import apiClient from '../api/apiClient';

export const PENDING_LINEUP_MUTATIONS_KEY = 'pending_lineup_mutations';
export const LINEUP_QUEUE_CHANGED_EVENT = 'lineup:mutation-queue-changed';
export const LINEUP_MUTATION_REPLAYED_EVENT = 'lineup:mutation-replayed';
const LINEUP_REPLAY_LOCK = 'pending-lineup-mutations-replay';

const ALLOWED_METHODS = new Set(['POST', 'PUT', 'PATCH']);
const ALLOWED_ENDPOINTS = [
  /^\/api\/team\/lineup$/,
  /^\/api\/scoring\/league\/\d+\/correct-week$/,
];
let replayPromise = null;

function browserStorage() {
  return typeof window === 'undefined' ? null : window.localStorage;
}

function queueEvent(name, detail) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }
}

function validIntent(value) {
  return !!(
    value &&
    typeof value.id === 'string' &&
    typeof value.endpoint === 'string' &&
    ALLOWED_ENDPOINTS.some((pattern) => pattern.test(value.endpoint)) &&
    ALLOWED_METHODS.has(value.method) &&
    value.payload &&
    typeof value.payload === 'object' &&
    Number.isFinite(value.createdAt)
  );
}

export function readPendingLineupMutations() {
  const storage = browserStorage();
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(PENDING_LINEUP_MUTATIONS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter(validIntent) : [];
  } catch (_error) {
    return [];
  }
}

function writeQueue(queue) {
  const storage = browserStorage();
  if (!storage) throw new Error('localStorage is unavailable; lineup intent cannot be protected');
  try {
    if (queue.length === 0) storage.removeItem(PENDING_LINEUP_MUTATIONS_KEY);
    else storage.setItem(PENDING_LINEUP_MUTATIONS_KEY, JSON.stringify(queue));
  } catch (error) {
    const storageError = new Error('Unable to persist the pending lineup mutation queue');
    storageError.cause = error;
    throw storageError;
  }
  queueEvent(LINEUP_QUEUE_CHANGED_EVENT, { pendingCount: queue.length });
}

function mutationId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function enqueuePendingLineupMutation({ endpoint, method, payload }) {
  const normalizedMethod = String(method || '').toUpperCase();
  const intent = {
    id: mutationId(),
    endpoint: String(endpoint || ''),
    method: normalizedMethod,
    payload: JSON.parse(JSON.stringify(payload)),
    createdAt: Date.now(),
  };
  if (!validIntent(intent)) throw new TypeError('invalid pending lineup mutation');

  const queue = readPendingLineupMutations();
  queue.push(intent);
  writeQueue(queue);
  return intent;
}

export function enqueueScoreCorrection({ leagueId, payload }) {
  if (!Number.isInteger(Number(leagueId)) || Number(leagueId) < 1) {
    throw new TypeError('leagueId must be a positive integer');
  }
  return enqueuePendingLineupMutation({
    endpoint: `/api/scoring/league/${Number(leagueId)}/correct-week`,
    method: 'POST',
    payload,
  });
}

function removeIntent(id) {
  const queue = readPendingLineupMutations().filter((intent) => intent.id !== id);
  writeQueue(queue);
}

function isOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

async function runReplay() {
  let replayed = 0;
  while (isOnline()) {
    const intent = readPendingLineupMutations()[0];
    if (!intent) return { replayed, remaining: 0 };

    let response;
    try {
      response = await apiClient.request({
        url: intent.endpoint,
        method: intent.method,
        data: intent.payload,
        headers: { 'Idempotency-Key': intent.id },
      });
    } catch (error) {
      return { replayed, remaining: readPendingLineupMutations().length, error };
    }

    if (response.status !== 200 && response.status !== 201) {
      return {
        replayed,
        remaining: readPendingLineupMutations().length,
        error: new Error(`Unexpected replay response status ${response.status}`),
      };
    }

    removeIntent(intent.id);
    replayed += 1;
    queueEvent(LINEUP_MUTATION_REPLAYED_EVENT, { intent, status: response.status });
  }
  return { replayed, remaining: readPendingLineupMutations().length };
}

export function replayPendingLineupMutations() {
  if (!replayPromise) {
    const locks = typeof navigator === 'undefined' ? null : navigator.locks;
    const replay = locks?.request
      ? locks.request(LINEUP_REPLAY_LOCK, { mode: 'exclusive' }, runReplay)
      : runReplay();
    replayPromise = replay.finally(() => {
      replayPromise = null;
    });
  }
  return replayPromise;
}
