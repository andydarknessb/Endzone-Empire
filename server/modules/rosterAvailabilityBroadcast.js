const { getIo } = require('./io');
const draftEvents = require('./draftEvents');

// Availability is a member-visible read model. Publish only after the caller's
// roster transaction has committed; a refreshed Player list remains the
// authoritative state rather than trusting event payload details.
async function broadcastRosterAvailability(leagueId) {
  const io = getIo();
  if (io) {
    io.to(`league:${leagueId}`).emit('roster:changed', { leagueId });
    return;
  }
  await draftEvents.publishDraftEvent({ leagueId, event: 'roster:changed', payload: { leagueId } });
}

module.exports = { broadcastRosterAvailability };
