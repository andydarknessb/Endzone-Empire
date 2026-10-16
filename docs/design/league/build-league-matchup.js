// Matchup detail, LIVE, Sunday 2:40 PM CDT, Week 7. Viewer: Darkness Falls vs Sunday Scaries.
const k = require('./league-kit-matchup');
const out = process.argv[2];
const LG = 'Thursday Night Regulars';
const { px, FRAME, frameHead, h2, meta, avatar, youBadge, posTag, injTag } = k;

// Both rosters come from the shared Week 7 fixture (lineup-data.js). status: ip = In progress, fin = Final, yet = Yet to play, empty = no player in the slot.
const { ME, OPP, BENCH, LIVE_TOTALS: T } = require('./lineup-data');
const f1 = n => n.toFixed(1);
const { meNow, oppNow, meExp, oppExp, lead } = T;
console.log('now', f1(meNow), f1(oppNow), 'exp', f1(meExp), f1(oppExp));

const MARK = k.MARK;
const W = k.W;

// ---- head ----
const head = `<section aria-labelledby="h1" style="display: flex; flex-direction: column; gap: 4px; min-width: 0">
${k.breadcrumb([LG, 'Game Center'], 'Matchup')}
<div style="display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 16px 24px">
<div style="display: flex; flex-direction: column; gap: 12px; min-width: 0">
<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px">${k.h1('Week 7 Matchup')}${k.liveChip('Live')}</div>
<p style="margin: 0; font-size: 17px; color: {{t.dim}}">Times in CDT</p>
${k.numbersHelp()}
</div>
<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px">${k.viewToggle({ label: 'Matchup view', items: [{ label: 'Standard', selected: true }, { label: 'Scoreboard' }] })}${k.btnGhost('Set lineup', { tag: 'a', aria: `Set lineup, ${LG}` })}</div>
</div>
</section>`;

// ---- Board-black versus scoreboard (a hidden h2 heads the team-name h3s; the live region carries the score sentence only) ----
const B = { ink: '{{t.boardInk}}', dim: '{{t.boardDim}}', boardRule: '{{t.boardRule}}' };
const side = ({ name, fig, lead: ld, expected, left, you, right }) => `<div style="min-width: 0; text-align: ${right ? 'right' : 'left'}"><div style="display: flex; align-items: center; gap: 10px; ${right ? 'flex-direction: row-reverse' : ''}">${avatar(name, { c: B.ink })}<h3 style="margin: 0; min-width: 0; ${px(16, B.ink)}; overflow-wrap: anywhere">${name}</h3>${you ? youBadge(B.ink) : ''}</div>${k.recLine(name, B.dim)}<div style="font-size: 13px; color: ${B.dim}; margin-top: 10px">Live score</div><div style="${px(32, ld ? B.ink : B.dim)}; line-height: 1.2; margin-top: 4px">${fig}</div><div style="font-size: 14px; color: ${B.dim}; margin-top: 6px">Expected final <b style="font-weight: 600; color: ${B.ink}">${expected}</b></div><div style="font-size: 14px; color: ${B.dim}">${left} players remaining</div></div>`;
const scoreboard = `<section aria-labelledby="sb-h" style="display: flex; flex-direction: column; gap: 20px; padding: 24px; box-sizing: border-box; background: {{t.board}}; color: {{t.boardInk}}; border: 6px double {{t.boardDim}}; min-width: 0">
${k.sbHeading('Week 7 scoreboard').replace('<h2', '<h2 id="sb-h"')}
<p aria-live="polite" style="margin: 0; ${k.SR}">${k.sentence(meNow, oppNow)}</p>
<div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; align-items: end">${side({ name: 'Darkness Falls', fig: f1(meNow), lead: lead >= 0, expected: f1(meExp), left: T.meLeft, you: true })}${side({ name: 'Sunday Scaries', fig: f1(oppNow), lead: lead < 0, expected: f1(oppExp), left: T.oppLeft, right: true })}</div>
<div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px"><span style="${px(16, B.ink)}">${lead >= 0 ? 'Darkness Falls' : 'Sunday Scaries'} by ${f1(Math.abs(lead))}</span></div>
${k.twoSided('Darkness Falls', 'Sunday Scaries', T.pct, { on: 'board', caption: `Win probability · <span style="white-space: nowrap">Endzone Forecast</span>`, size: 14 })}
</section>`;

// ---- NFL games: the one strip drawing, then the Bench what-if note ----
const teams = [...ME, ...OPP].map(r => r[3] && r[3].split(' ')[0]).filter(Boolean);
const games = k.nflStrip(W.gamesFor(teams));
const lineupNote = k.lineupNote('live');

// ---- starters comparison ----
const COLS = 'minmax(0, 1fr) 88px minmax(0, 1fr)';
const sideCell = (r, right) => {
  const [slot, name, inj, game, st, pts, proj, exp] = r;
  if (st === 'empty') return `<div style="display: flex; align-items: center; gap: 12px; min-width: 0; ${right ? 'flex-direction: row-reverse; text-align: right' : ''}"><div style="flex: 1; min-width: 0"><div style="font-size: 15px; color: {{t.dim}}">No starter</div><div style="font-size: 13px; color: {{t.dim}}">${k.fillBy('live')}</div></div><span style="width: 112px; flex: none"></span><div style="text-align: right; width: 84px; flex: none"><b style="font-size: 16px; font-weight: 700">0.0</b> <span style="font-size: 13px; color: {{t.dim}}">pts</span></div><div style="width: 64px; flex: none; text-align: right; font-size: 15px; color: {{t.dim}}">0.0</div></div>`;
  const [mlabel, mglyph] = MARK[st];
  const fig = st === 'yet'
    ? `<div style="text-align: right; width: 84px; flex: none"><span style="font-size: 13px; color: {{t.dim}}">proj</span> <b style="font-size: 16px; font-weight: 600; color: {{t.dim}}">${f1(proj)}</b></div>`
    : `<div style="text-align: right; width: 84px; flex: none"><b style="font-size: 16px; font-weight: 700">${f1(pts)}</b> <span style="font-size: 13px; color: {{t.dim}}">pts</span></div>`;
  return `<div style="display: flex; align-items: center; gap: 12px; min-width: 0; ${right ? 'flex-direction: row-reverse; text-align: right' : ''}"><div style="flex: 1; min-width: 0"><div style="display: flex; align-items: center; gap: 8px; ${right ? 'justify-content: flex-end' : ''}"><span style="font-size: 15px; font-weight: 600">${name}</span>${inj ? injTag(inj) : ''}</div><div style="font-size: 13px; color: {{t.dim}}">${k.teamLine(game)}</div></div><span style="display: inline-flex; align-items: center; gap: 8px; width: 112px; flex: none; font-size: 13px; color: {{t.dim}}; ${right ? 'flex-direction: row-reverse' : ''}">${mglyph}${mlabel}</span>${fig}<div style="width: 64px; flex: none; text-align: right; font-size: 15px; color: {{t.dim}}">${f1(exp)}</div></div>`;
};
const labelRow = right => `<div style="display: flex; align-items: center; gap: 12px; ${right ? 'flex-direction: row-reverse' : ''}"><span style="flex: 1"></span><span style="width: 112px; flex: none"></span><span style="width: 84px; flex: none; text-align: right; white-space: nowrap">Pts / proj</span><span style="width: 64px; flex: none; display: flex; justify-content: flex-end; white-space: nowrap">Exp final</span></div>`;
const rowStyle = last => `display: grid; grid-template-columns: ${COLS}; align-items: center; gap: 0 20px; min-height: 56px; padding: 6px 20px; ${last ? '' : 'border-bottom: 2px solid {{t.rule}}'}`;
const starters = `<section aria-labelledby="st-h" style="${FRAME}; min-width: 0">
${frameHead(`${h2('st-h', 'Starters')}${meta('9 slots', 'margin-left: auto')}${k.statusLegend()}`)}
<div role="table" aria-label="Starters, Darkness Falls against Sunday Scaries">
<div role="row" style="display: grid; grid-template-columns: ${COLS}; align-items: center; gap: 0 20px; padding: 14px 20px 8px; border-bottom: 2px solid {{t.rule}}">
<div role="columnheader" style="display: flex; align-items: center; gap: 10px">${avatar('Darkness Falls')}<span style="${px(16)}">Darkness Falls</span>${youBadge()}</div>
<span role="columnheader" style="text-align: center; font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: {{t.dim}}">Slot</span>
<div role="columnheader" style="display: flex; align-items: center; gap: 10px; flex-direction: row-reverse; text-align: right">${avatar('Sunday Scaries')}<span style="${px(16)}">Sunday Scaries</span></div>
</div>
<div role="row" aria-hidden="true" style="display: grid; grid-template-columns: ${COLS}; gap: 0 20px; padding: 6px 20px; border-bottom: 2px solid {{t.rule}}; font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: {{t.dim}}">${labelRow(false)}<span></span>${labelRow(true)}</div>
${ME.map((m, i) => `<div role="row" style="${rowStyle(false)}"><div role="cell">${sideCell(m, false)}</div><div role="cell" style="display: flex; flex-direction: column; align-items: center; gap: 4px">${k.slotTag(m[0])}<span style="font-size: 13px; font-weight: 700; letter-spacing: .04em; color: {{t.dim}}">${m[0]}</span></div><div role="cell">${sideCell(OPP[i], true)}</div></div>`).join('')}
<div role="row" style="${rowStyle(true)}; background: {{t.bg}}; border-top: 2px solid {{t.frame}}">
<div role="cell" style="display: flex; align-items: center; gap: 12px"><span style="flex: 1"></span><span style="width: 112px"></span><span style="width: 84px; text-align: right"><b style="font-size: 18px; font-weight: 700">${f1(meNow)}</b> <span style="font-size: 13px; color: {{t.dim}}">pts</span></span><span style="width: 64px; text-align: right; font-size: 15px; font-weight: 600; color: {{t.dim}}">${f1(meExp)}</span></div>
<div role="cell" style="text-align: center; font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase">Totals</div>
<div role="cell" style="display: flex; align-items: center; gap: 12px; flex-direction: row-reverse"><span style="flex: 1"></span><span style="width: 112px"></span><span style="width: 84px; text-align: right"><b style="font-size: 18px; font-weight: 700">${f1(oppNow)}</b> <span style="font-size: 13px; color: {{t.dim}}">pts</span></span><span style="width: 64px; text-align: right; font-size: 15px; font-weight: 600; color: {{t.dim}}">${f1(oppExp)}</span></div>
</div>
</div>
</section>`;

// ---- bench ----
const { BENCH_ME, BENCH_OPP } = k;
const benchCol = k.benchCol;
const bench = `<section aria-labelledby="bn-h" style="${FRAME}; min-width: 0">
${frameHead(`${h2('bn-h', 'Bench')}${meta('6 players each', 'margin-left: auto')}${k.hideBtn}`)}
<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px 40px; padding: 16px 20px 20px">${benchCol(BENCH_ME, 'Darkness Falls', { live: true })}${benchCol(BENCH_OPP, 'Sunday Scaries', { live: true })}</div>
</section>`;

const notes = k.notes([
  'No cursor on this page: it is a watching screen. The lineup note (Critique 7, reworded by Critique 11 item 11) is a quiet row of its own and no longer dead-ends: a warning pictogram, never the lock (the lock means Locked), then "FLEX is empty · no bench player can fill it · add a free agent playing at 3:25 PM · next kickoff in 45 min". Only "next kickoff in 45 min" (minutes computed from the 2:40 PM clock) is set in the Danger text token Pick&#39;em uses for "Locks in", and only while it is under an hour; the whole sentence is in its accessible name. "No bench player can fill it" is checked against week7-games.js: at 2:40 PM every bench player&#39;s game is live, final or on bye (Spears, Addison, Kincaid, Bigsby, Allgeier live; Olave on bye), so none is unlocked; if one were, the note would name him instead. The ghost link reads "Free agents" (it replaces "Set lineup" in this note; the page head keeps its one "Set lineup"). The empty FLEX row reads "No starter" with line two "Empty · next kickoff Sun 3:25 PM", and its slot tag reads "FLEX" (Critique 11 item 14). No cursor, no filled action, no countdown chip: text only.',
  'Green is live state only: the Live chip. The scoreboard win probability is the two-sided bar (Critique 10 item 9): caption "Win probability · Endzone Forecast", each side&#39;s share filled from its own end, the leader (Sunday Scaries, 58%) in Board-lit green on Board black, the trailer outlined in Board dim, "Darkness Falls 42%" at the left end and "Sunday Scaries 58%" at the right, one accessible name that names both; the old one-sided bar is gone. The leader&#39;s score is white and the trailer&#39;s is Board dim, with the margin in words, each side&#39;s record under its name, and Expected final and players remaining on separate lines. The live region carries the score sentence only. A closed "What the numbers mean" disclosure sits under the page sub-line (Critique 10 item 15; 44px summary): Proj, Expected final, Players remaining (a starter whose NFL game is not final; Out starters and empty slots don&#39;t count), Win probability (Endzone Forecast) and Projected margin. Players remaining has one definition on every board (Critique 9 item 2): a starter whose NFL game is not final, so an Out starter and an empty slot do not count. At 2:40 PM that is 7 for Darkness Falls (9 starters, Puka Nacua is Out, FLEX is empty) and 9 for Sunday Scaries (only Thursday&#39;s PIT @ CLE is final and neither roster has a Steelers or Browns starter); the figures derive from lineup-data.js and week7-games.js, not from typed numbers.',
  'The NFL games strip is the one strip drawing (Board black, no visible heading, scrolls inside its box, and its last tile is cut at the right edge so the scroll reads, Critique 9 item 6) and holds the games these two rosters&#39; starters span, read from week7-games.js. Last plays is not drawn: it belongs to the Scoreboard view, which keeps the amber LED and is not redrawn here.',
  'The live bench follows the starters (Critique 8 item 2, Critique 11 item 14): a player in a live game shows his points with "proj {x}" as line two (Spears 13.4 over proj 12.9), a final game reads "8.6 pts · final" over "proj 8.1" the same way on every board (Jaylen Warren, PIT @ CLE), a game not started shows proj alone (Romeo Doubs, GB at 7:20 PM) and a bye stays "on bye". The figures are fixtures held in league-kit-matchup.js and checked against week7-games.js; the board draws no bench total.',
  'Critique 11 item 13: Expected final is points so far plus the projection times the share of the game left, for each live starter (the Q4 clock: minutes left / 60), the full projection for a starter whose game has not started, and the points for a final game. Darkness Falls 97.1 → 91.7 and Sunday Scaries 101.2 → 99.6 (the margin 4.1 → 7.9 to the trail); the win probability stays 42% (the Forecast&#39;s own figure; the dashboard formula alone would say 34%, which is not absurd either way).',
  'Critique 11 item 8: "When the scoreboard scrolls away" at the end of the page is a 56px specimen of the compact sticky scoreboard: "DF 61.0 · SS 58.9 · Darkness Falls by 2.1" with the Live chip on Board black. In the product the full scoreboard stays in flow; once it scrolls out of view the compact bar pins to the top, and the page reserves it with scroll-padding-top 72px (56px + 16px) so a focused control is never under it. It is a specimen here, not a second scoreboard: nothing in it is a control.',
  'Starters keep both sides on one row so a slot reads straight across. Line two is the product&#39;s "BUF vs MIA" with the live clock on in-progress games. In progress (filled square), Final (outline square) and Yet to play (outline with a centre dot) each pair a distinct shape with the words, so state never rides on colour. Pixel type stays on the h1, team names in heads and scores.',
]);


const body = `<main style="max-width: 1280px; margin: 0 auto; padding: 24px 32px 64px; display: flex; flex-direction: column; gap: 24px">
${head}
${scoreboard}
${games}
${lineupNote}
${starters}
${bench}
${k.stickyBar()}
${notes}
</main>`;

k.write(out, 'Matchup.dc.html', k.page({ title: 'Matchup, live', w: 1440, h: 2628, body }));
console.log('ok');
