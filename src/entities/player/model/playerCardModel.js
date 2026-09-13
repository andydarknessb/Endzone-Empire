/**
 * The Decision-card payload read model (ADR 0029: the entities layer), for
 * `GET /api/players/:id/card?leagueId=` (#1306, ADR 0040 slice 3 -
 * `server/services/playerCard.service.js` `getPlayerCard`). The server
 * already ships one clean camelCase shape - `{ player, availability,
 * decision, weeks, seasonEnd, news, log, bio, depth, ownership }` - so this
 * model is a thin identity pass rather than a translation: a missing
 * response (the idle/error `useEndpoint` shape) reads as `null`, never a
 * fabricated empty object, so every UI piece's own null-hides-the-tile rule
 * (ADR 0040) sees an honest absence.
 */
export function playerCardFromResponse(data) {
  return data || null;
}

export default playerCardFromResponse;
