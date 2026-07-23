let ready = false;
let shuttingDown = false;

function markReady() {
  ready = true;
  shuttingDown = false;
}

function markShuttingDown() {
  ready = false;
  shuttingDown = true;
}

function getRuntimeState() {
  return { ready, shuttingDown };
}

module.exports = { getRuntimeState, markReady, markShuttingDown };
