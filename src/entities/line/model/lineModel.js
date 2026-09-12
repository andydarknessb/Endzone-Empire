/**
 * The Line/Weather read model, pure (ADR 0029: the entities layer). It is the
 * defensive shape over `GET /api/team/lineup/:playerId/context`'s `line` and
 * `weather` fields (server/services/decisionCardContext.service.js, #1236,
 * ADR 0037), so a malformed or half-loaded body never reaches a caller as a
 * thrown property access.
 *
 * `line` is `{ spread, total, observedAt, impliedTeamTotal }` or `null` (no
 * odds snapshot yet, or no game this week). `weather` is a fields-null object
 * `{ indoor, temperatureF, windSpeedMph, windGustMph, precipitationProbability,
 * shortForecast }` once a game exists, or `null` when there is no game this
 * week at all (a bye, or an unsynced slate) — the server's own distinction,
 * carried through unchanged.
 *
 * This shape is read independently of `entities/pickem-game/model/gameDetailModel`'s
 * own Weather read (CONTEXT.md, Weather; #1294, ADR 0038 amendment) — they
 * mirror two different server contracts and converge only behind a shared
 * wire shape, not here.
 *
 * This module is pure: it imports nothing at all.
 */

/** The `{ line, weather }` pair off the wire body, defaulting a malformed or absent body to both null. */
export function lineContextFromResponse(data) {
  const body = data && typeof data === 'object' ? data : {};
  return {
    line: body.line ?? null,
    weather: body.weather ?? null,
  };
}
