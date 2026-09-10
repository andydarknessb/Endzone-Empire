/**
 * The Tank01 adapter behind the Box source seam (#1183, ADR 0035).
 *
 * `applyGameBoxScore` (scoring.service) used to read Tank01's `/getNFLBoxScore`
 * body directly: `playerStats`, `DST`, `teamStats`, `allPlayByPlay`. It now
 * consumes one source-neutral **Live box**, and this module is the only place
 * that knows Tank01's shape. The ESPN adapter (espnBoxSource) produces the same
 * shape from ESPN's summary endpoint; the Final box is always this adapter.
 *
 * The neutral shape:
 *
 *   {
 *     gameId,            // tank01_game_id, YYYYMMDD_AWAY@HOME
 *     source: 'tank01',
 *     isFinal,
 *     players: [{ externalId, stats }],   // scoring stat keys (+ the bonus arrays)
 *     teamDefense: { [teamCode]: { sack, interceptionReturn, fumbleRecovery,
 *                                  defensiveTD, safety, blockedKick,
 *                                  pointsAllowed, yardsAllowed } },
 *     scoreSummaryLines: [{ kind, period, clock, teamCode, text,
 *                           scorerExternalId, yards }],
 *   }
 *
 * `teamDefense` is keyed by the folded Team code (CONTEXT.md **Team code**:
 * WAS, never WSH), so the DEF-unit match in applyGameBoxScore is Team code on
 * Team code (#431). `players[].externalId` is the string playerID; players the
 * pool does not know are left in and skipped by the apply, exactly as before.
 * Player order is Tank01's `Object.values(playerStats)` order and team-defense
 * order is home then away, so the plays array the apply emits is identical to
 * the pre-refactor path (the golden in test/boxSource.tank01.test.js).
 */
const {
  normalizeTank01Stats,
  normalizeTank01IdpStats,
  normalizeTank01DstStats,
  extractPlayByPlayBonusStats,
} = require('./tank01Normalizers');
const { normalizeNflTeam } = require('./nflTeam');

/** Pure: Tank01's gameStatusCode/gameStatus -> is the game over? */
function isFinalBox(box) {
  const code = String((box && box.gameStatusCode) ?? '');
  if (code === '2') return true;
  const status = String((box && box.gameStatus) || '').toLowerCase();
  return status.includes('final') || status.includes('completed');
}

/**
 * Pure: Tank01's own scoringPlays entries -> Score summary lines. Tank01 gives
 * no scorer id or yardage in a machine-readable field, so those are null; the
 * TD-length and FG-distance bonuses come from `allPlayByPlay` instead (below).
 */
function scoreSummaryLines(box) {
  const container = box && box.scoringPlays;
  const raw = Array.isArray(container)
    ? container
    : container && typeof container === 'object'
      ? Object.values(container)
      : [];
  const out = [];
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue;
    const text = String(p.score || p.scoreDetails || p.play || '').trim();
    const rawTeam = p.team || p.teamAbv || null;
    if (!text && !rawTeam) continue;
    out.push({
      kind: p.scoreType ? String(p.scoreType) : null,
      period: p.scorePeriod || p.period || p.quarter ? String(p.scorePeriod || p.period || p.quarter) : null,
      clock: p.scoreTime || p.gameClock || p.clock ? String(p.scoreTime || p.gameClock || p.clock) : null,
      teamCode: rawTeam ? normalizeNflTeam(rawTeam) : null,
      text,
      scorerExternalId: null,
      yards: null,
    });
  }
  return out;
}

/**
 * Pure: one unwrapped Tank01 `/getNFLBoxScore` body -> the neutral Live box.
 *
 * @param {object} box  unwrapped body (see scoring.service.tank01Body)
 * @returns {object} Live box
 */
function fromBox(box) {
  const b = box || {};
  const playerStats = b.playerStats || {};
  const bonusByPlayer = extractPlayByPlayBonusStats(b.allPlayByPlay);

  const players = [];
  for (const entry of Object.values(playerStats)) {
    if (!entry || entry.playerID == null) continue;
    const externalId = String(entry.playerID);
    players.push({
      externalId,
      stats: {
        ...normalizeTank01Stats(entry),
        ...normalizeTank01IdpStats(entry),
        ...(bonusByPlayer.get(externalId) || {}),
      },
    });
  }

  // One aggregate DST line per side. `blockedFG`/`blockedXP`/`blockedPunt` sit
  // on a team's OWN teamStats line as kicks of THEIRS that got blocked, so the
  // block credit belongs to the opponent's defense (normalizeTank01DstStats).
  const dst = b.DST || {};
  const teamStats = b.teamStats || {};
  const teamDefense = {};
  for (const side of ['home', 'away']) {
    const dstSide = dst[side];
    const rawAbbr = dstSide && dstSide.teamAbv ? String(dstSide.teamAbv).toUpperCase() : null;
    const teamCode = rawAbbr ? normalizeNflTeam(rawAbbr) : null;
    if (!teamCode) continue;
    const opponentSide = side === 'home' ? 'away' : 'home';
    teamDefense[teamCode] = normalizeTank01DstStats(dstSide, teamStats[opponentSide]);
  }

  return {
    gameId: b.gameID != null ? String(b.gameID) : null,
    source: 'tank01',
    isFinal: isFinalBox(b),
    players,
    teamDefense,
    scoreSummaryLines: scoreSummaryLines(b),
  };
}

module.exports = { fromBox, isFinalBox, scoreSummaryLines };
