const { processAllDueWaivers } = require('../services/waiver.service');
const { processDueTrades } = require('../services/trade.service');

/**
 * In-process job runner for time-based league mechanics (waiver clearing,
 * trade review windows). Each job's DB work is transactional with row locks,
 * so a manual commissioner trigger racing the schedule is safe.
 */
const INTERVAL_MS = 5 * 60 * 1000;

let timer = null;
let running = false;

async function tick() {
  if (running) return; // don't overlap slow runs
  running = true;
  try {
    const waivers = await processAllDueWaivers();
    if (waivers.length > 0) console.log(`scheduler: processed waivers for ${waivers.length} league(s)`);
    const trades = await processDueTrades();
    if (trades.length > 0) console.log(`scheduler: settled ${trades.length} trade(s)`);
  } catch (err) {
    console.error('scheduler tick failed:', err.message);
  } finally {
    running = false;
  }
}

function startScheduler() {
  if (timer) return timer;
  timer = setInterval(tick, INTERVAL_MS);
  timer.unref(); // never keep the process alive just for the scheduler
  setTimeout(tick, 15 * 1000).unref(); // first pass shortly after boot
  return timer;
}

function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { startScheduler, stopScheduler, tick, INTERVAL_MS };
