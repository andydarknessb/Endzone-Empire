import { formatInstant, formatPoints } from '../../../shared/lib';
import { accepts } from './rosterTemplateModel';

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

// May this bench player start in `slotKey`? The league's roster template answers (a K or DEF cannot fill a FLEX, a
// superflex takes a QB); a template with nothing to say about the slot (no eligibility listed) cannot rule him out.
function fitsSlot(template, slotKey, position) {
  const listed = (Array.isArray(template) ? template : []).find((s) => s && s.key === slotKey)?.eligiblePositions;
  return Array.isArray(listed) ? accepts(template, slotKey, position) : true;
}

/**
 * The viewer's starting slots as the note reads them: `[{ slot, player, label? }]`, `player` null for an empty
 * slot. `label` is what the note says for the slot when that differs from the slot key the roster template
 * knows ("WR 2" for the second WR seat); the slot key still decides who may fill it. `rows` are the Matchup page's paired starter rows (`{ slot, first, second }`) and `isViewer` whether
 * the board's first side is the viewer's Team; a caller that holds one lineup already (Game Center) builds the same shape itself.
 */
export function lineupSlots(rows, isViewer) {
  if (!isViewer) return [];
  return (rows || []).map((row) => ({ slot: row.slot, player: row.first ?? null }));
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
  (slots || []).forEach(({ slot, player, label }) => {
    const shown = label ? { label } : null;
    if (!player) issues.push({ slot, kind: 'empty', ...shown });
    else if (isOut(player) && unlocked(player, rows)) issues.push({ slot, kind: 'out', name: player.name, ...shown });
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
 * the first open slot while a bench player can still fill it: "{SLOT} is empty · next kickoff {lock}", and
 * under an hour from it "{SLOT} is empty · next kickoff in {n} min" (`danger`). A bench player fills it when his
 * game has not started (an unknown game state is not started), he is not Out or unavailable, and the roster
 * template lets him start in that slot. When none can, it says so and points at free agents instead: "{SLOT} is empty ·
 * no bench player can fill it · add a free agent playing at {time} · next kickoff in {n} min" (the last
 * part under an hour only, in Danger). Live with no lock still to come leaves nothing to fix: null.
 *
 * @param {object} input
 * @param {Array<{ slot: string, player: object|null }>} input.slots the viewer's starting slots (`lineupSlots`)
 * @param {Array} [input.bench] the viewer's bench players
 * @param {Array} [input.template] the league's roster template (`parseRosterTemplate(league.roster_slots)`): a bench player counts only if he is eligible for the open slot
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
  slots, bench, template, gameStates, started, now, lockAt: givenLock, advice, gain, proj,
}) {
  const rows = Array.isArray(gameStates) ? gameStates : [];
  const issues = lineupIssues(slots, rows);
  if (issues.length === 0) return null;
  const lockAt = givenLock !== undefined ? givenLock : nextKickoff(rows);
  const lockWord = lockAt != null ? formatInstant(lockAt, 'weekdayTime') : null;

  if (!started) {
    const named = advice || issues.map((i) => (i.kind === 'empty' ? `${i.label ?? i.slot} is empty` : `${i.name} (Out) at ${i.label ?? i.slot}`)).join(' · ');
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
  const where = issue.label ?? issue.slot;
  const lead = issue.kind === 'empty' ? `${where} is empty` : `${where} holds ${issue.name} (Out)`;
  const minutes = Math.max(1, Math.ceil((lockAt - now) / MINUTE_MS));
  const danger = lockAt - now < HOUR_MS;
  const canFill = (bench || []).some((p) => unlocked(p, rows) && !isOut(p) && p.availability?.available !== false && fitsSlot(template, issue.slot, p.position));
  const segments = [{ text: lead, strong: true }];
  let plain = lead;
  if (canFill) {
    // Critique 10 item 11: the slot stays open until the next kickoff, so the note says that.
    const tail = danger ? `next kickoff in ${minutes} min` : `next kickoff ${lockWord}`;
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

const kickoffMs = (value) => {
  const ms = new Date(value ?? NaN).getTime();
  return Number.isFinite(ms) ? ms : null;
};

/**
 * The starting slot that needs the viewer next (RULINGS "Wave 3 boards", spec #2347 ruling 4): the cursor
 * of the Lineup page. Built on `lineupIssues`: an empty slot or a not-yet-started Out starter. An Out
 * starter locks when his own game kicks off; an empty slot locks at the next kickoff still to come
 * (`nextKickoff`). The pick is the issue that locks first, slot order breaking a tie, and a slot with no
 * lock left to beat (its game started, or every game has) is skipped. Null when nothing needs the viewer.
 *
 * `entries` is the viewer's starting slots in the shape `lineupIssues` reads (`[{ slot, player }]`,
 * `player` null for an empty slot); a player is a lineup entry (`nflTeam`, `injuryStatus`, `kickoff`).
 * Returns `{ slot, kind: 'empty'|'out', lockAt }` with `lockAt` in epoch ms (null when no game rows
 * have been read yet), so the caller can turn the cursor Danger under one hour.
 */
export function nextLineupSlot(entries, gameStates = [], now = Date.now()) {
  const rows = Array.isArray(gameStates) ? gameStates : [];
  const open = nextKickoff(rows);
  const everyGameStarted = rows.length > 0 && open == null;
  const list = Array.isArray(entries) ? entries : [];
  const picks = lineupIssues(list, rows).flatMap((issue) => {
    if (issue.kind === 'empty') {
      return everyGameStarted ? [] : [{ slot: issue.slot, kind: issue.kind, lockAt: open }];
    }
    const player = list.find((s) => s.slot === issue.slot)?.player;
    const team = code(player?.nfl_team ?? player?.nflTeam);
    const row = team ? rows.find((g) => code(g.away_team) === team || code(g.home_team) === team) : null;
    return [{ slot: issue.slot, kind: issue.kind, lockAt: kickoffMs(row?.kickoff_at ?? row?.start_time ?? player?.kickoff) }];
  }).filter((pick) => pick.lockAt == null || pick.lockAt > now);
  // Array.prototype.sort is stable: slot order breaks a tie, a null lock sorts last.
  picks.sort((a, b) => (a.lockAt ?? Infinity) - (b.lockAt ?? Infinity));
  return picks[0] ?? null;
}
