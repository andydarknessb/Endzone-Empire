/**
 * Tiny registry so non-socket code (scoring, scheduler) can broadcast to the
 * Socket.io server without a circular require. draftSocket registers the
 * server instance at attach time.
 */
let io = null;

function setIo(server) {
  io = server;
}

function getIo() {
  return io;
}

module.exports = { setIo, getIo };
