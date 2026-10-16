import { formatInstant, formatPoints } from '../../../shared/lib';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

// A starter or bench row's NFL game has not started: the one lock the page can read off the wire row.
const unlocked = (player) => player.game_state !== 'in_progress' && player.game_state !== 'final';
const isOut = (player) => player.injury_status === 'O' || player.availability?.reason === 'out';

/**
 * The viewer's lineup problems the page can still fix: an empty starting slot, or a starter the feed
 * rules Out whose NFL game has not started. `rows` are the paired starter rows (`{ slot, home, away }`).
 * A started Out starter is locked in and is not a problem anyone can act on.
 */
export function lineupIssues(rows, viewerSide) {
  if (viewerSide !== 'home' && viewerSide !== 'away') return [];
  const issues = [];
  (rows || []).forEach((row) => {
    const player = row[viewerSide];
    if (!player) issues.push({ slot: row.slot, kind: 'empty' });
    else if (isOut(player) && unlocked(player)) issues.push({ slot: row.slot, kind: 'out', name: player.name });
  });
  return issues;
}

/**
 * The Matchup page's lineup note (RULINGS Critique 7, 8, 10 and 11; spec #2334 ruling 4), or null
 * when the viewer has nothing to fix. It replaces the Bench what-if sentence while it applies, and
 * the dashboard's lead card reads the same advice (`adviceNote`, `entities/roster`).
 *
 * Before kickoff it carries the dashboard's figures for the same moment: the advice sentence naming
 * every move behind its gain (or, with no advice, the problems themselves), "you'd project {x} to
 * {y}" when both Proj figures and the gain are known, and the lock on its own line. Live it names the
 * first open slot: "{SLOT} is empty · fill it by {lock}", and under an hour from the lock "{SLOT} is
 * empty · locks in {n} min" (`urgent`, set in Danger). When no bench player can fill it (every bench
 * game has started, is final or is a bye) it says so and points at free agents instead:
 * "{SLOT} is empty · no bench player can fill it · add a free agent playing at {time}".
 *
 * `segments` is the visible sentence as `{ text, strong?, danger? }` runs; `plain` is the same words
 * for the accessible name. `cta` is `'lineup'` or `'free-agents'`.
 *
 * @param {object} input
 * @param {Array} input.rows paired starter rows
 * @param {'home'|'away'|null} input.viewerSide
 * @param {Array} input.bench the viewer's bench rows
 * @param {boolean} input.started whether the matchup has started
 * @param {number|null} input.lockAt the next lock (epoch ms): the first kickoff still to come
 * @param {number} input.now epoch ms
 * @param {string|null} [input.advice] the `adviceNote` sentence, when the advice has read
 * @param {{ you: number|string|null, them: number|string|null }} [input.proj] the two Proj figures
 * @param {number|null} [input.gain] the advice's total gain, for "you'd project"
 */
export function lineupNoteView({
  rows, viewerSide, bench, started, lockAt, now, advice, proj, gain,
}) {
  const issues = lineupIssues(rows, viewerSide);
  if (issues.length === 0) return null;
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
      cta: 'lineup',
      plain: `${named}${outlook}${lockWord ? `, locks ${lockWord}` : ''}`,
      urgent: false,
    };
  }

  // Live: only a lock still to come leaves a slot open.
  if (lockAt == null || lockAt <= now) return null;
  const issue = issues[0];
  const lead = issue.kind === 'empty' ? `${issue.slot} is empty` : `${issue.slot} holds ${issue.name} (Out)`;
  const minutes = Math.max(1, Math.ceil((lockAt - now) / MINUTE_MS));
  const urgent = lockAt - now < HOUR_MS;
  const canFill = (bench || []).some((p) => p.game_state === 'scheduled' && !isOut(p) && p.availability?.available !== false);
  const segments = [{ text: lead, strong: true }];
  let plain = lead;
  if (canFill) {
    const tail = urgent ? `locks in ${minutes} min` : `fill it by ${lockWord}`;
    segments.push({ text: ' · ' }, urgent ? { text: tail, danger: true } : { text: tail });
    plain += ` · ${tail}`;
  } else {
    const tail = `no bench player can fill it · add a free agent playing at ${formatInstant(lockAt, 'time')}`;
    segments.push({ text: ` · ${tail}` });
    plain += ` · ${tail}`;
    if (urgent) {
      segments.push({ text: ' · ' }, { text: `next kickoff in ${minutes} min`, danger: true });
      plain += ` · next kickoff in ${minutes} min`;
    }
  }
  return {
    kind: 'live', segments, sub: null, cta: canFill ? 'lineup' : 'free-agents', plain, urgent,
  };
}
