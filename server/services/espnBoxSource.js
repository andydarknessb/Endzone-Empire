/**
 * The ESPN adapter behind the Box source seam (#1184, ADR 0035).
 *
 * Reads one ESPN game summary
 * (`site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=<id>`,
 * free, unauthenticated, undocumented) and returns the same source-neutral
 * Live box that tank01BoxSource.fromBox does, so applyGameBoxScore cannot tell
 * the two apart. The Live box is read from here at the clock engine's cadence;
 * the Final box stays Tank01 (ADR 0035).
 *
 * Three places feed the stats, in this order of trust:
 *
 *  1. `boxscore.players[].statistics[]`: the per-player box. Category keys map
 *     straight onto the scoring stat keys (passing, rushing, receiving,
 *     fumbles, defensive incl. TFL, interceptions, kick and punt returns,
 *     kicking as made/att). `athlete.id` IS players.external_id.
 *  2. `scoringPlays[]`, the game's **Score summary lines**: touchdown lengths
 *     per scorer and kind, field-goal distances, safeties. A line is data the
 *     feed states; the Scoring play the sync emits afterwards comes from a
 *     player's stat change, never from the line (CONTEXT.md).
 *  3. `drives.previous[].plays[].text`, a NARROW play-text pass for exactly the
 *     keys the box lacks: defensive fumble recoveries, forced fumbles, blocked
 *     kicks. Every pattern here is bound to real Gamebook lines in
 *     test/fixtures/espn-gamebook-lines.json; a regex that has seen one game
 *     does not ship (spec ruling). Anything else is the phase-two parser.
 *
 * Two-point conversions are deliberately NOT emitted in phase one: today's
 * Tank01 live path produces no two-point key, and a key the Live box writes
 * that the Final box then drops would flip two points fifteen minutes after
 * the game. They wait for the Tank01 side to be mapped too.
 *
 * Team codes: ESPN's box uses its own abbreviations (WAS, and in play text the
 * old Gamebook codes BLT, HST, LA, ARZ, CLV). They fold through
 * espnScoreboard.espnAbbrToOurs (the live-data raw code, WSH) and then
 * nflTeam.normalizeNflTeam (the Team code, WAS); `teamDefense` is keyed by the
 * Team code and nothing raw leaves this module.
 */
const { espnAbbrToOurs } = require('../modules/espnScoreboard');
const { normalizeNflTeam } = require('./nflTeam');

/** The offensive and kicking keys the Tank01 path writes for every player (zeros included). */
const OFFENSE_ZERO_KEYS = [
  'passingYards', 'passingTDs', 'interceptions', 'rushingYards', 'rushingTDs',
  'receivingYards', 'receivingTDs', 'receptions', 'fumbles', 'fieldGoal', 'fieldGoalMissed',
  'extraPoint', 'extraPointMissed', 'returnTDs', 'puntReturns', 'puntReturnYards',
];
/** The IDP keys the Tank01 path writes for every player (zeros included). */
const IDP_ZERO_KEYS = [
  'soloTackle', 'assistedTackle', 'idpSack', 'idpInterception', 'forcedFumble', 'idpFumbleRecovery',
  'passDeflection', 'qbHit', 'tacklesForLoss', 'idpDefensiveTD', 'twoPointReturn',
];

const num = (value) => {
  const parsed = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

/** '23/33' -> [23, 33]; anything else -> [0, 0]. */
function madeAtt(value) {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(String(value ?? '').trim());
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}

/** ESPN abbreviation (box or play text) -> Team code, or null. */
function teamCodeOf(abbr) {
  const ours = espnAbbrToOurs(abbr);
  return ours ? normalizeNflTeam(ours) : null;
}

/** Pure: ESPN status -> is the game over? */
function isFinalStatus(status) {
  const type = (status && status.type) || {};
  return String(type.state || '').toLowerCase() === 'post' || type.completed === true;
}

/**
 * Pure: the two competitors from the header, with every spelling we need.
 * @returns {Array<{espnTeamId: string, teamCode: string, homeAway: string, score: number}>}
 */
function readTeams(summary) {
  const competition = summary && summary.header && Array.isArray(summary.header.competitions)
    ? summary.header.competitions[0]
    : null;
  const competitors = competition && Array.isArray(competition.competitors) ? competition.competitors : [];
  const teams = [];
  for (const c of competitors) {
    const teamCode = teamCodeOf(c && c.team && c.team.abbreviation);
    if (!teamCode) continue;
    teams.push({
      espnTeamId: c.id != null ? String(c.id) : (c.team && c.team.id != null ? String(c.team.id) : null),
      teamCode,
      homeAway: c.homeAway,
      score: num(c.score),
    });
  }
  return teams;
}

/** Pure: 'Drake Maye' -> 'D.Maye' (the Gamebook spelling in play text). */
function gamebookName(displayName) {
  const parts = String(displayName || '').trim().split(/\s+/);
  if (parts.length < 2) return null;
  // Suffixes (Jr., III, IV) are not part of the Gamebook surname.
  const surnameParts = parts.slice(1).filter((p) => !/^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(p));
  const surname = surnameParts.join(' ') || parts[parts.length - 1];
  return `${parts[0][0]}.${surname}`;
}

/**
 * Mutable per-game accumulator: one stats object per athlete plus the name
 * indexes the summary-line and play-text passes need.
 */
function createRoster(teams) {
  const players = new Map(); // externalId -> { externalId, teamCode, name, stats }
  const byDisplayName = new Map(); // `${teamCode}|${displayName}` -> externalId
  const byGamebookName = new Map(); // `${teamCode}|${D.Maye}` -> externalId | 'ambiguous'
  const ensure = (athlete, teamCode) => {
    const externalId = athlete && athlete.id != null ? String(athlete.id) : null;
    if (!externalId) return null;
    if (!players.has(externalId)) {
      const stats = {};
      for (const key of OFFENSE_ZERO_KEYS) stats[key] = 0;
      for (const key of IDP_ZERO_KEYS) stats[key] = 0;
      players.set(externalId, { externalId, teamCode, name: athlete.displayName || null, stats });
      if (athlete.displayName) {
        byDisplayName.set(`${teamCode}|${athlete.displayName}`, externalId);
        const gb = gamebookName(athlete.displayName);
        if (gb) {
          const key = `${teamCode}|${gb}`;
          byGamebookName.set(key, byGamebookName.has(key) ? 'ambiguous' : externalId);
        }
      }
    }
    return players.get(externalId);
  };
  const findByDisplayName = (name) => {
    for (const t of teams) {
      const id = byDisplayName.get(`${t.teamCode}|${name}`);
      if (id) return players.get(id);
    }
    return null;
  };
  const findByGamebookName = (teamCode, name) => {
    const id = byGamebookName.get(`${teamCode}|${name}`);
    return id && id !== 'ambiguous' ? players.get(id) : null;
  };
  return { players, ensure, findByDisplayName, findByGamebookName };
}

/**
 * Pass 1: the per-player box. Each statistics group lists `keys` and each
 * athlete's `stats` in the same order; a group with no athletes is a category
 * nobody registered in.
 */
function readPlayerBox(summary, teams, roster, teamDefense) {
  const sides = summary && summary.boxscore && Array.isArray(summary.boxscore.players)
    ? summary.boxscore.players
    : [];
  for (const side of sides) {
    const teamCode = teamCodeOf(side && side.team && side.team.abbreviation);
    if (!teamCode) continue;
    const def = teamDefense[teamCode];
    for (const group of Array.isArray(side.statistics) ? side.statistics : []) {
      const keys = Array.isArray(group.keys) ? group.keys : [];
      for (const row of Array.isArray(group.athletes) ? group.athletes : []) {
        const p = roster.ensure(row.athlete, teamCode);
        if (!p) continue;
        const v = {};
        keys.forEach((k, i) => { v[k] = Array.isArray(row.stats) ? row.stats[i] : undefined; });
        const s = p.stats;
        switch (group.name) {
          case 'passing':
            s.passingYards = num(v.passingYards);
            s.passingTDs = num(v.passingTouchdowns);
            s.interceptions = num(v.interceptions);
            break;
          case 'rushing':
            s.rushingYards = num(v.rushingYards);
            s.rushingTDs = num(v.rushingTouchdowns);
            break;
          case 'receiving':
            s.receptions = num(v.receptions);
            s.receivingYards = num(v.receivingYards);
            s.receivingTDs = num(v.receivingTouchdowns);
            break;
          case 'fumbles':
            // `fumblesRecovered` here mixes own and opponent recoveries and is
            // NOT a defensive recovery (spec ruling); recoveries come from the
            // play-text pass. Only the lost count is a player stat.
            s.fumbles = num(v.fumblesLost);
            break;
          case 'defensive': {
            const total = num(v.totalTackles);
            const solo = num(v.soloTackles);
            s.soloTackle = solo;
            s.assistedTackle = Math.max(total - solo, 0);
            s.idpSack = num(v.sacks);
            s.tacklesForLoss = num(v.tacklesForLoss);
            s.passDeflection = num(v.passesDefended);
            s.qbHit = num(v.QBHits);
            // Tank01 scores defTD minus interceptionTDs as the generic bucket;
            // the interceptions group below subtracts its TDs the same way.
            s.idpDefensiveTD = Math.max(num(v.defensiveTouchdowns) - (s.__intTDs || 0), 0);
            s.__defTDs = num(v.defensiveTouchdowns);
            if (def) {
              def.sack += num(v.sacks);
              def.defensiveTD += num(v.defensiveTouchdowns);
            }
            break;
          }
          case 'interceptions':
            s.idpInterception = num(v.interceptions);
            s.idpInterceptionReturnYards = num(v.interceptionYards);
            s.__intTDs = num(v.interceptionTouchdowns);
            s.idpDefensiveTD = Math.max((s.__defTDs || 0) - s.__intTDs, 0);
            if (def) def.interceptionReturn += num(v.interceptions);
            break;
          case 'kickReturns':
            s.kickReturnYards = num(v.kickReturnYards);
            s.returnTDs += num(v.kickReturnTouchdowns);
            break;
          case 'puntReturns':
            s.puntReturns = num(v.puntReturns);
            s.puntReturnYards = num(v.puntReturnYards);
            s.returnTDs += num(v.puntReturnTouchdowns);
            break;
          case 'kicking': {
            const [fgMade, fgAtt] = madeAtt(v['fieldGoalsMade/fieldGoalAttempts']);
            const [xpMade, xpAtt] = madeAtt(v['extraPointsMade/extraPointAttempts']);
            s.fieldGoal = fgMade;
            s.fieldGoalMissed = Math.max(fgAtt - fgMade, 0);
            s.extraPoint = xpMade;
            s.extraPointMissed = Math.max(xpAtt - xpMade, 0);
            break;
          }
          default:
            break; // punting and anything new: not scored
        }
      }
    }
  }
}

// --- Score summary lines -----------------------------------------------------

const TD_PASS_RE = /^(.+?) (\d+) Yd pass from (.+?)(?: \(|$)/;
const TD_RUSH_RE = /^(.+?) (\d+) Yd (?:Rush|Run)\b/;
const FG_RE = /^(.+?) (\d+) Yd Field Goal/;
const DEFENSIVE_PAT_RE = /^(.+?) Defensive PAT Conversion\b/;

/**
 * Pass 2: `scoringPlays[]` -> Score summary lines, and the per-value bonus
 * arrays they alone can supply (TD lengths, FG distances) plus safeties.
 */
function readScoreSummaryLines(summary, roster, teamDefense) {
  const raw = summary && Array.isArray(summary.scoringPlays) ? summary.scoringPlays : [];
  const lines = [];
  const push = (p, key, value) => {
    if (!p) return;
    if (!Array.isArray(p.stats[key])) p.stats[key] = [];
    p.stats[key].push(value);
  };
  for (const sp of raw) {
    if (!sp || typeof sp !== 'object') continue;
    const text = String(sp.text || '').trim();
    const kind = (sp.type && sp.type.text) || (sp.scoringType && sp.scoringType.displayName) || null;
    const teamCode = teamCodeOf(sp.team && sp.team.abbreviation);
    let scorer = null;
    let yards = null;
    let m;
    if ((m = TD_PASS_RE.exec(text))) {
      yards = Number(m[2]);
      scorer = roster.findByDisplayName(m[1]);
      push(scorer, 'receivingTDLengths', yards);
      push(roster.findByDisplayName(m[3]), 'passingTDLengths', yards);
    } else if ((m = TD_RUSH_RE.exec(text))) {
      yards = Number(m[2]);
      scorer = roster.findByDisplayName(m[1]);
      push(scorer, 'rushingTDLengths', yards);
    } else if ((m = FG_RE.exec(text))) {
      yards = Number(m[2]);
      scorer = roster.findByDisplayName(m[1]);
      push(scorer, 'fieldGoalDistances', yards);
    } else if (/\bSafety\b/i.test(kind || '') || (sp.scoringType && sp.scoringType.name === 'safety')) {
      if (teamCode && teamDefense[teamCode]) teamDefense[teamCode].safety += 1;
    } else if ((m = DEFENSIVE_PAT_RE.exec(text))) {
      // Phase two (#1187): a blocked PAT returned for two points is its own
      // Score summary line ("Markquese Bell Defensive PAT Conversion", GB at
      // DAL 2025 week 17) and appears nowhere in the play text with a type.
      scorer = roster.findByDisplayName(m[1].trim());
      if (scorer) scorer.stats.twoPointReturn += 1;
    }
    lines.push({
      kind,
      period: sp.period && sp.period.number != null ? Number(sp.period.number) : null,
      clock: sp.clock && sp.clock.displayValue ? String(sp.clock.displayValue) : null,
      teamCode,
      text,
      scorerExternalId: scorer ? scorer.externalId : null,
      yards,
    });
  }
  return lines;
}

// --- Narrow play-text pass ---------------------------------------------------

// A fumble line names the recoverer as `RECOVERED by TEAM-X.Name` (any case).
const RECOVERED_BY_RE = /recovered by ([A-Z]{2,3})-([A-Za-z'.-]+)/i;
// `FUMBLES (X.Name)` names the player who forced it; `(Aborted)` is a snap.
const FORCED_BY_RE = /FUMBLES \(([^)]+)\)/;
// Blocked kicks: `field goal is BLOCKED (X)`, `punt is BLOCKED by X`,
// `extra point is BLOCKED`, and the summary-style `PAT blocked`.
const BLOCKED_RE = /\bis BLOCKED\b|\bPAT blocked\b|extra point is Blocked/i;
const KICK_PLAY_RE = /\b(?:kicks|punts) \d+ yards\b/;
// Phase two (#1187): a failed two-point try the defense returns for two reads
// `DEFENSIVE TWO-POINT ATTEMPT. <X.Name> ... ATTEMPT SUCCEEDS.`; the same
// sentence ending `ATTEMPT FAILS.` is a return that did not score.
const DEFENSIVE_TWO_POINT_RE = /DEFENSIVE TWO-POINT ATTEMPT\. ([A-Za-z'.-]+) (.*?)ATTEMPT (SUCCEEDS|FAILS)/;

/**
 * Pure: which team had the ball when the play started, as the fumbling side.
 * On a kickoff or punt the possession team in ESPN's `start.team` is the
 * KICKING team, but the side that can fumble is the receiving team, so the
 * answer flips there (a muffed punt recovered by the kicking team is a takeaway
 * for the kicking team's defense: TEN-D.Mausi on M.Mims, 2025 week 1).
 */
function fumblingTeam(play, teams, idToCode) {
  const startId = play && play.start && play.start.team && play.start.team.id != null
    ? String(play.start.team.id)
    : null;
  const startCode = startId ? idToCode.get(startId) : null;
  if (!startCode) return null;
  const typeText = String((play.type && play.type.text) || '');
  const isKick = /^(Kickoff|Punt)\b/i.test(typeText) || KICK_PLAY_RE.test(String(play.text || ''));
  if (!isKick) return startCode;
  const other = teams.find((t) => t.teamCode !== startCode);
  return other ? other.teamCode : null;
}

/**
 * Pass 3: exactly three patterns over play text. Returns per-play findings so
 * the corpus test can assert them line by line.
 *
 * @returns {Array<{ text, fumbleRecoveredBy: ?string, recoveringPlayer: ?string,
 *   forcedBy: ?string, forcingTeam: ?string, blockedKickBy: ?string }>}
 */
function scanPlays(summary, teams, roster, teamDefense) {
  const idToCode = new Map(teams.map((t) => [t.espnTeamId, t.teamCode]));
  const drives = summary && summary.drives ? summary.drives : {};
  const list = [
    ...(Array.isArray(drives.previous) ? drives.previous : []),
    ...(drives.current ? [drives.current] : []),
  ];
  const findings = [];
  for (const drive of list) {
    for (const play of Array.isArray(drive && drive.plays) ? drive.plays : []) {
      const text = String((play && play.text) || '');
      if (!text) continue;
      const finding = { text, fumbleRecoveredBy: null, recoveringPlayer: null, forcedBy: null, forcingTeam: null, blockedKickBy: null, twoPointReturnBy: null };
      const possession = fumblingTeam(play, teams, idToCode);
      const opponentOf = (code) => {
        const other = teams.find((t) => t.teamCode !== code);
        return other ? other.teamCode : null;
      };

      if (/\bFUMBLES\b|\bMUFFS\b/.test(text)) {
        const rec = RECOVERED_BY_RE.exec(text);
        if (rec) {
          const recTeam = teamCodeOf(rec[1]);
          if (recTeam && possession && recTeam !== possession) {
            finding.fumbleRecoveredBy = recTeam;
            if (teamDefense[recTeam]) teamDefense[recTeam].fumbleRecovery += 1;
            const p = roster.findByGamebookName(recTeam, rec[2]);
            if (p) {
              p.stats.idpFumbleRecovery += 1;
              finding.recoveringPlayer = p.externalId;
            }
          }
        }
        const forced = FORCED_BY_RE.exec(text);
        if (forced && !/^Aborted$/i.test(forced[1].trim()) && possession) {
          const defTeam = opponentOf(possession);
          const p = defTeam ? roster.findByGamebookName(defTeam, forced[1].trim()) : null;
          if (p) {
            p.stats.forcedFumble += 1;
            finding.forcedBy = p.externalId;
            finding.forcingTeam = defTeam;
          }
        }
      }

      if (BLOCKED_RE.test(text) && !/NULLIFIED/.test(text)) {
        // The kicking side is the possession team; the block is the other
        // side's defense. On a blocked kick the start team is the kicker even
        // for a punt, so read start.team directly rather than the flipped
        // fumbling team.
        const startId = play.start && play.start.team && play.start.team.id != null ? String(play.start.team.id) : null;
        const kicking = startId ? idToCode.get(startId) : null;
        const blocking = kicking ? opponentOf(kicking) : null;
        if (blocking) {
          finding.blockedKickBy = blocking;
          if (teamDefense[blocking]) teamDefense[blocking].blockedKick += 1;
        }
      }

      const twoPt = DEFENSIVE_TWO_POINT_RE.exec(text);
      if (twoPt && twoPt[3] === 'SUCCEEDS' && possession) {
        const defTeam = opponentOf(possession);
        const p = defTeam ? roster.findByGamebookName(defTeam, twoPt[1]) : null;
        if (p) {
          p.stats.twoPointReturn += 1;
          finding.twoPointReturnBy = p.externalId;
        }
      }

      if (finding.fumbleRecoveredBy || finding.forcedBy || finding.blockedKickBy || finding.twoPointReturnBy) findings.push(finding);
    }
  }
  return findings;
}

// --- team lines --------------------------------------------------------------

/** `boxscore.teams[]` statistics by Team code: name -> displayValue. */
function readTeamStats(summary) {
  const out = new Map();
  const sides = summary && summary.boxscore && Array.isArray(summary.boxscore.teams) ? summary.boxscore.teams : [];
  for (const side of sides) {
    const teamCode = teamCodeOf(side && side.team && side.team.abbreviation);
    if (!teamCode) continue;
    const stats = {};
    for (const s of Array.isArray(side.statistics) ? side.statistics : []) {
      if (s && s.name) stats[s.name] = s.displayValue;
    }
    out.set(teamCode, stats);
  }
  return out;
}

/**
 * Pure: one ESPN summary -> the neutral Live box (see tank01BoxSource for the
 * shape). `gameId` is the tank01_game_id the caller already knows from
 * live_game_states; it is the join key for everything downstream.
 *
 * @param {object} summary  parsed summary JSON
 * @param {{ gameId: string }} opts
 */
function fromSummary(summary, { gameId } = {}) {
  const teams = readTeams(summary);
  const competition = summary && summary.header && Array.isArray(summary.header.competitions)
    ? summary.header.competitions[0]
    : null;

  const teamDefense = {};
  for (const t of teams) {
    teamDefense[t.teamCode] = {
      sack: 0, interceptionReturn: 0, fumbleRecovery: 0, defensiveTD: 0,
      safety: 0, blockedKick: 0, pointsAllowed: 0, yardsAllowed: 0,
    };
  }
  const teamStats = readTeamStats(summary);
  for (const t of teams) {
    const opponent = teams.find((o) => o.teamCode !== t.teamCode);
    if (!opponent) continue;
    teamDefense[t.teamCode].pointsAllowed = opponent.score;
    const oppStats = teamStats.get(opponent.teamCode) || {};
    teamDefense[t.teamCode].yardsAllowed = num(oppStats.totalYards);
  }

  const roster = createRoster(teams);
  readPlayerBox(summary, teams, roster, teamDefense);
  const scoreSummaryLines = readScoreSummaryLines(summary, roster, teamDefense);
  const playTextFindings = scanPlays(summary, teams, roster, teamDefense);

  const players = [];
  for (const p of roster.players.values()) {
    const stats = { ...p.stats };
    delete stats.__defTDs;
    delete stats.__intTDs;
    players.push({ externalId: p.externalId, stats });
  }

  return {
    gameId: gameId != null ? String(gameId) : null,
    espnEventId: summary && summary.header && summary.header.id != null ? String(summary.header.id) : null,
    source: 'espn',
    isFinal: isFinalStatus(competition && competition.status),
    players,
    teamDefense,
    scoreSummaryLines,
    // Not part of the neutral shape's contract; exposed for the corpus test.
    playTextFindings,
  };
}

module.exports = {
  fromSummary,
  // pure, unit tested
  scanPlays,
  readTeams,
  gamebookName,
  madeAtt,
  isFinalStatus,
  RECOVERED_BY_RE,
  FORCED_BY_RE,
  BLOCKED_RE,
};
