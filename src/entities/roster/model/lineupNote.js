import { formatInstant, formatPoints } from '../../../shared/lib';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

const code = (team) => (team == null ? '' : String(team).trim().toUpperCase());

/**
 * One player's NFL game state: the `live_game_states` row that carries his team (`game_status`), else his
 * own wire `game_state` (the server's classification), else null (unknown).
 */
function gameStateOf(player, gameStates) {
  const team = code(player.nfl_team ?? player.nflTeam);
  const row = team ? gameStates.find((g) => code(g.away_team) === team || code(g.home_team) === team) : null;
  return row ? row.game_status : (player.game_state ?? player.gameState ?? null);
}

// A game that has not started is the one lock a player's row can say; null (unknown) counts as not started.
const unlocked = (player, gameStates) => !['in_progress', 'final'].includes(gameStateOf(player, gameStates));
const isOut = (player) => (player.injury_status ?? player.injuryStatus) === 'O' || player.availability?.reason === 'out';

/**
 * The viewer's starting slots as the note reads them: `[{ slot, player }]`, `player` null for an empty
 * slot. `rows` are the Matchup page's paired starter rows (`{ slot, home, away }`) and `side` the viewer's
 * side; a caller that holds one lineup already (Game Center) builds the same shape itself.
 */
export function lineupSlots(rows, side) {
  if (side !== 'home' && side !== 'away') return [];
  return (rows || []).map((row) => ({ slot: row.slot, player: row[side] ?? null }));
}

/**
 * The first kickoff still to come among the `live_game_states` rows (`game_status` not started yet,
 * `kickoff_at` or `start_time`), as epoch ms, or null: the lock an empty slot can still be filled before.
 */
export function nextKickoff(gameStates) {
  const kicks = (Array.isArray(gameStates) ? gameStates : [])
    .filter((g) => g && g.game_status !== 'in_progress' && g.game_status !== 'final')
    .map((g) => new Date(g.kickoff_at ?? g.start_time ?? NaN).getTime())
    .filter(Number.isFinite);
  return kicks.length ? Math.min(...kicks) : null;
}

/**
 * The lineup problems that can still be fixed: an empty starting slot, or a starter the feed rules Out
 * whose NFL game has not started (a started Out starter is locked in and nobody can act on him).
 */
export function lineupIssues(slots, gameStates = []) {
  const rows = Array.isArray(gameStates) ? gameStates : [];
  const issues = [];
  (slots || []).forEach(({ slot, player }) => {
    if (!player) issues.push({ slot, kind: 'empty' });
    else if (isOut(player) && unlocked(player, rows)) issues.push({ slot, kind: 'out', name: player.name });
  });
  return issues;
}

/**
 * The lineup note's decision (RULINGS Critique 7, 8, 10 and 11; spec #2334 ruling 4), shared by Matchup
 * and Game Center, or null when the viewer has nothing to fix. Pure: no render, no clock of its own.
 *
 * Before kickoff it carries the dashboard's figures for the same moment: the advice sentence naming every
 * move behind its gain (`adviceNote`) or, with no advice, the problems themselves; "you'd project {x} to
 * {y}" when both Proj figures and the gain are known; and the lock on its own line (`sub`). Live it names
 * the first open slot: "{SLOT} is empty · fill it by {lock}", and under an hour from the lock "{SLOT} is
 * empty · locks in {n} min" (`danger`). When no bench player can fill it (every bench game has started, is
 * final, is a bye or the player is Out) it says so and points at free agents instead: "{SLOT} is empty ·
 * no bench player can fill it · add a free agent playing at {time} · next kickoff in {n} min" (the last
 * part under an hour only, in Danger). Live with no lock still to come leaves nothing to fix: null.
 *
 * @param {object} input
 * @param {Array<{ slot: string, player: object|null }>} input.slots the viewer's starting slots (`lineupSlots`)
 * @param {Array} [input.bench] the viewer's bench players
 * @param {Array} [input.gameStates] `live_game_states` rows; a player's game is the row carrying his NFL team
 * @param {boolean} input.started whether the matchup has started (live, played or final)
 * @param {number} input.now epoch ms
 * @param {number|null} [input.lockAt] the next lock (epoch ms); defaults to `nextKickoff(gameStates)`
 * @param {string|null} [input.advice] the `adviceNote` sentence, once the advice has read
 * @param {number|null} [input.gain] the advice's total gain, for "you'd project"
 * @param {{ you: number|string|null, them: number|string|null }} [input.proj] the two Proj figures
 * @returns {null | {
 *   kind: 'pre'|'live',
 *   segments: Array<{ text: string, strong?: boolean, danger?: boolean }>,
 *   sub: string|null, plain: string, danger: boolean, link: 'lineup'|'free-agents',
 * }} `segments` is the visible sentence in runs, `plain` the same words for an accessible name, `sub` the
 *   second line (before kickoff, "Locks Sun 12:00 PM"), `danger` true when under an hour from the lock
 *   live, `link` the ghost link: Set lineup (`'lineup'`) or Free agents (`'free-agents'`).
 */
export function lineupNote({
  slots, bench, gameStates, started, now, lockAt: givenLock, advice, gain, proj,
}) {
  const rows = Array.isArray(gameStates) ? gameStates : [];
  const issues = lineupIssues(slots, rows);
  if (issues.length === 0) return null;
  const lockAt = givenLock !== undefined ? givenLock : nextKickoff(rows);
  const lockWord = lockAt != null ? formatInstant(lockAt, 'weekdayTime') : null;

  if (!started) {
    const named = advice || issues.map((i) => (i.kind === 'empty' ? `${i.slot} is empty` : `${i.name} (Out) at ${i.slot}`)).join(' · ');
    const you = Number(proj?.you);
    const them = Number(proj?.them);
    const outlook = gain != null && Number.isFinite(you) && Number.isFinite(them) && proj.you != null && proj.them != null
      ? ` · you'd project ${formatPoints(you + Number(gain))} to ${formatPoints(them)}`
      : '';
    return {
      kind: 'pre',
      segments: [{ text: `${named}${outlook}`, strong: true }],
      sub: lockWord ? `Locks ${lockWord}` : null,
      plain: `${named}${outlook}${lockWord ? `, locks ${lockWord}` : ''}`,
      danger: false,
      link: 'lineup',
    };
  }

  // Live: only a lock still to come leaves a slot open.
  if (lockAt == null || lockAt <= now) return null;
  const issue = issues[0];
  const lead = issue.kind === 'empty' ? `${issue.slot} is empty` : `${issue.slot} holds ${issue.name} (Out)`;
  const minutes = Math.max(1, Math.ceil((lockAt - now) / MINUTE_MS));
  const danger = lockAt - now < HOUR_MS;
  const canFill = (bench || []).some((p) => gameStateOf(p, rows) === 'scheduled' && !isOut(p) && p.availability?.available !== false);
  const segments = [{ text: lead, strong: true }];
  let plain = lead;
  if (canFill) {
    const tail = danger ? `locks in ${minutes} min` : `fill it by ${lockWord}`;
    segments.push({ text: ' · ' }, danger ? { text: tail, danger: true } : { text: tail });
    plain += ` · ${tail}`;
  } else {
    const tail = `no bench player can fill it · add a free agent playing at ${formatInstant(lockAt, 'time')}`;
    segments.push({ text: ` · ${tail}` });
    plain += ` · ${tail}`;
    if (danger) {
      segments.push({ text: ' · ' }, { text: `next kickoff in ${minutes} min`, danger: true });
      plain += ` · next kickoff in ${minutes} min`;
    }
  }
  return {
    kind: 'live', segments, sub: null, plain, danger, link: canFill ? 'lineup' : 'free-agents',
  };
}
