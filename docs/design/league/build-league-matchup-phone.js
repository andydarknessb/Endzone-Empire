// Matchup detail, LIVE, phone (390), Sunday Oct 18, 2:40 PM CDT, Week 7. Same content as the live desktop board, minus Last plays (Scoreboard view only).
const k = require('./league-kit-matchup');
const out = process.argv[2];
const LG = 'Thursday Night Regulars';
const { px, FRAME, frameHead, h2, meta, avatar, youBadge, posTag, f1, ME, OPP, LIVE_TOTALS: T } = k;
const ph = { phone: true };
const B = { ink: '{{t.boardInk}}', dim: '{{t.boardDim}}', rule: '{{t.boardRule}}' };
const leader = T.lead >= 0 ? 'Darkness Falls' : 'Sunday Scaries';

const head = `<section aria-labelledby="h1" style="display: flex; flex-direction: column; gap: 4px; min-width: 0">
${k.breadcrumbPhone([LG, 'Game Center'])}
<div style="display: flex; flex-direction: column; gap: 12px; min-width: 0">
<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px">${k.h1('Week 7 Matchup', ph)}${k.liveChip('Live')}</div>
<p style="margin: 0; font-size: 17px; color: {{t.dim}}">Times in CDT</p>
${k.viewToggleFill({ label: 'Matchup view', items: [{ label: 'Standard', selected: true }, { label: 'Scoreboard' }] })}
${k.numbersHelp(ph)}
</div>
</section>`;

// ---- Board-black versus screen: names on one baseline, Pixel 24 scores, margin under the viewer's score, odds bar ----
const side = ({ name, fig, lead, expected, left, you, right }) => `<div style="min-width: 0; text-align: ${right ? 'right' : 'left'}; display: flex; flex-direction: column; align-items: ${right ? 'flex-end' : 'flex-start'}"><h3 style="margin: 0; ${px(16, B.ink)}; overflow-wrap: anywhere">${name}</h3><div style="display: flex; align-items: center; gap: 8px; margin-top: 8px; min-height: 22px; ${right ? 'flex-direction: row-reverse' : ''}">${k.recLine(name, B.dim)}${you ? youBadge(B.ink) : ''}</div><div style="${px(24, lead ? B.ink : B.dim)}; line-height: 1.3; margin-top: 4px">${fig}</div></div>`;
const sub = (expected, left) => `<div style="min-width: 0; font-size: 14px; color: ${B.dim}"><div>Expected final <b style="font-weight: 600; color: ${B.ink}; white-space: nowrap">${expected}</b></div><div>${left} players remaining</div></div>`;
const scoreboard = `<section aria-labelledby="sb-h" style="display: flex; flex-direction: column; gap: 16px; padding: 14px; box-sizing: border-box; background: {{t.board}}; color: {{t.boardInk}}; border: 6px double {{t.boardDim}}; min-width: 0">
${k.sbHeading('Week 7 scoreboard').replace('<h2', '<h2 id="sb-h"')}
<p aria-live="polite" style="margin: 0; ${k.SR}">${k.sentence(T.meNow, T.oppNow)}</p>
<div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 4px 12px; align-items: start">
${side({ name: 'Darkness Falls', fig: f1(T.meNow), lead: T.lead >= 0, you: true })}${side({ name: 'Sunday Scaries', fig: f1(T.oppNow), lead: T.lead < 0, right: true })}
<div style="grid-column: 1 / -1; ${px(16, B.ink)}; line-height: 1.5"><span style="white-space: nowrap">${leader}</span> <span style="white-space: nowrap">by ${f1(Math.abs(T.lead))}</span></div>
${sub(f1(T.meExp), T.meLeft)}<div style="text-align: right">${sub(f1(T.oppExp), T.oppLeft)}</div>
</div>
${k.twoSided('Darkness Falls', 'Sunday Scaries', T.pct, { on: 'board', caption: `Win probability · <span style="white-space: nowrap">Endzone Forecast</span>`, size: 14 })}
</section>`;

// ---- NFL games: the one strip drawing (games the two rosters' starters span), then the Bench what-if note ----
const teams = [...ME, ...OPP].map(r => r[3] && r[3].split(' ')[0]).filter(Boolean);
const games = k.nflStrip(k.W.gamesFor(teams), { phone: true });

// ---- starters: two-line rows per slot, both sides; halves are 1fr either side of a 48px slot column ----
const COLS = 'minmax(0, 1fr) 48px minmax(0, 1fr)';
const rowPad = 'padding: 10px 8px; gap: 0 6px';
const names = `<div role="row" style="display: grid; grid-template-columns: ${COLS}; ${rowPad}; align-items: start; border-bottom: 2px solid {{t.rule}}">
<div role="columnheader" style="min-width: 0"><span style="${px(16)}; display: block; overflow-wrap: anywhere">Darkness Falls</span><span style="display: inline-flex; margin-top: 4px">${youBadge()}</span></div>
<span role="columnheader" style="text-align: center; font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: {{t.dim}}">Slot</span>
<div role="columnheader" style="min-width: 0; text-align: right"><span style="${px(16)}; display: block; overflow-wrap: anywhere">Sunday Scaries</span></div>
</div>`;
const rows = ME.map((m, i) => `<div role="row" style="display: grid; grid-template-columns: ${COLS}; ${rowPad}; align-items: center; min-height: 64px; border-bottom: 2px solid {{t.rule}}"><div role="cell" style="min-width: 0">${k.phoneCell(m, false)}</div><div role="cell" style="display: flex; flex-direction: column; align-items: center; gap: 4px">${k.slotTag(m[0])}<span style="font-size: 13px; font-weight: 700; letter-spacing: .04em; color: {{t.dim}}; white-space: nowrap">${m[0]}</span></div><div role="cell" style="min-width: 0">${k.phoneCell(OPP[i], true)}</div></div>`).join('');
const tot = (now, exp, right) => `<div role="cell" style="min-width: 0; text-align: ${right ? 'right' : 'left'}"><b style="font-size: 18px; font-weight: 700">${f1(now)}</b> <span style="font-size: 13px; color: {{t.dim}}">pts</span><div style="font-size: 14px; color: {{t.dim}}">Exp final ${f1(exp)}</div></div>`;
const starters = `<section aria-labelledby="st-h" style="${FRAME}; min-width: 0">
${frameHead(`${h2('st-h', 'Starters', ph)}${meta('9 slots')}<div style="width: 100%">${k.statusLegend()}</div>`, ph)}
<div role="table" aria-label="Starters, Darkness Falls against Sunday Scaries">
${names}${rows}
<div role="row" style="display: grid; grid-template-columns: ${COLS}; ${rowPad}; align-items: center; background: {{t.bg}}; border-top: 2px solid {{t.frame}}">${tot(T.meNow, T.meExp, false)}<div role="cell" style="text-align: center; font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase">Totals</div>${tot(T.oppNow, T.oppExp, true)}</div>
</div>
</section>`;

// ---- bench: one frame, each side stacked ----
const bench = `<section aria-labelledby="bn-h" style="${FRAME}; min-width: 0">
${frameHead(`${h2('bn-h', 'Bench', ph)}${meta('6 players each', 'margin-left: auto')}${k.hideBtn}`, ph)}
<div style="display: grid; grid-template-columns: minmax(0, 1fr); gap: 20px; padding: 14px 14px 16px">${k.benchCol(k.BENCH_ME, 'Darkness Falls', { phone: true, live: true })}${k.benchCol(k.BENCH_OPP, 'Sunday Scaries', { phone: true, live: true })}</div>
</section>`;

const notes = k.notes([
  'The phone breadcrumb drops the current page (Critique 9): the h1 says "Week 7 Matchup", so the trail ends on "Game Center" with no trailing separator to wrap. Players remaining uses the one definition (a starter whose NFL game is not final; Out starters and empty slots do not count): 7 for Darkness Falls and 9 for Sunday Scaries at 2:40 PM. Expected final is recomputed (Critique 11 item 13): Darkness Falls 97.1 → 91.7, Sunday Scaries 101.2 → 99.6; the win probability stays 42%. The NFL games strip shows a tile and a half and ends on a cut tile so the scroll reads.',
  'Phone Matchup, live, Standard view. Last plays is not drawn: the product shows it only in the Scoreboard view. Set lineup moves to a full-width ghost button at the bottom, as the product does on a phone, and the Standard / Scoreboard toggle fills its row in 44px segments. No cursor, no filled action.',
  'Board-black screen: both names sit on one baseline (they wrap inside their halves) with each side&#39;s record, Pixel 24 scores, the margin directly under the viewer&#39;s score, then Expected final and players remaining per side. The live region carries the score sentence only. The NFL games strip is the one strip drawing (Board black, no visible heading, scrolls sideways inside its box) and holds the games the two rosters&#39; starters span; the lineup note ("FLEX is empty · no bench player can fill it · add a free agent playing at 3:25 PM · next kickoff in 45 min", Critique 11 item 11: a warning pictogram instead of the lock, the minutes computed from the clock, only "next kickoff in 45 min" in the Danger text token Pick&#39;em uses for "Locks in", the whole sentence in its accessible name, and a ghost "Free agents" link; no bench player is unlocked at 2:40 PM, checked against week7-games.js) is its own row under it, and the empty FLEX row reads "No starter" with line two "Empty · next kickoff Sun 3:25 PM" (Critique 10 item 11). The win probability under the scores is the two-sided bar (Critique 10 item 9): Board-lit leader, outlined trailer, both names and percents at the ends, one accessible name. A closed "What the numbers mean" disclosure with a 44px summary ends the head (Critique 10 item 15).',
  'The bench shows live points like starters (Critique 8 item 2, Critique 11 item 14): points with "proj {x}" as line two for players in a live game, "8.6 pts · final" over "proj 8.1" for a final one, proj alone before kickoff, "on bye" for a bye; the empty FLEX row&#39;s slot tag reads "FLEX"; the figures are fixtures in league-kit-matchup.js checked against week7-games.js.',
  'Critique 11 item 8: "When the scoreboard scrolls away" at the end of the page is a 56px specimen of the compact sticky scoreboard: "DF 61.0 · SS 58.9 · Darkness Falls by 2.1" with the Live chip on Board black. In the product the full scoreboard stays in flow; once it scrolls out of view the compact bar pins to the top, and the page reserves it with scroll-padding-top 72px (56px + 16px) so a focused control is never under it. It is a specimen here, not a second scoreboard: nothing in it is a control.',
  'Starters are two-line rows: name and injury tag, then the state shape, the figure and the product&#39;s line two ("BUF vs MIA · Q4 4:21", the clock on in-progress games only), which wraps under when the half is narrow. Each half keeps its side of a 48px slot column, so team names stay inside their halves.',
]);

const body = `<main style="width: 390px; box-sizing: border-box; padding: 14px 16px 48px; display: flex; flex-direction: column; gap: 16px">
${head}
${scoreboard}
${games}
${k.lineupNote('live', true)}
${starters}
${bench}
<a href="#" aria-label="Set lineup, ${LG}" style="${'min-height: 44px; display: flex; align-items: center; justify-content: center; box-sizing: border-box; border-radius: 0; font-size: 15px; font-weight: 600; text-decoration: none; background: transparent; border: 2px solid {{t.ink}}; color: {{t.ink}}'}">Set lineup</a>
${k.stickyBar({ phone: true })}
${notes}
</main>`;

k.write(out, 'MatchupPhone.dc.html', k.page({ title: 'Matchup, live, phone', w: 390, h: 3904, body, phone: true }));
console.log('ok');
