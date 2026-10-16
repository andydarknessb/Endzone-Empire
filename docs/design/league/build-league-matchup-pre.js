// Matchup detail, BEFORE KICKOFF, Sunday Oct 18, 9:10 AM CDT, Week 7. Darkness Falls vs Sunday Scaries. Figures match Main's versus panel.
const k = require('./league-kit-matchup');
const out = process.argv[2];
const LG = 'Thursday Night Regulars';
const { px, FRAME, frameHead, h2, meta, avatar, youBadge, posTag, injTag, f1, ME, OPP, SUMMARY: S } = k;

const head = `<section aria-labelledby="h1" style="display: flex; flex-direction: column; gap: 4px; min-width: 0">
${k.breadcrumb([LG, 'Game Center'], 'Matchup')}
<div style="display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 16px 24px">
<div style="display: flex; flex-direction: column; gap: 12px; min-width: 0">
<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px">${k.h1('Week 7 Matchup')}${k.chip('Scheduled')}</div>
<p style="margin: 0; font-size: 17px; color: {{t.dim}}">Times in CDT</p>
${k.numbersHelp()}
</div>
<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px">${k.viewToggle({ label: 'Matchup view', items: [{ label: 'Standard', selected: true }, { label: 'Scoreboard' }] })}</div>
</div>
</section>`;

// ---- framed versus panel (Main's panel: 6px double Frame, Proj figures, Frame-colour odds bar, one Endzone Forecast credit) ----
const behind = S.trail > 0;
const margin = behind ? `Sunday Scaries by ${f1(S.trail)}` : `Darkness Falls by ${f1(-S.trail)}`;
const side = ({ name, fig, left, you, right }) => `<div style="min-width: 0; text-align: ${right ? 'right' : 'left'}"><div style="display: flex; align-items: center; gap: 10px; ${right ? 'flex-direction: row-reverse' : ''}">${avatar(name)}<h3 style="margin: 0; min-width: 0; ${px(16)}; overflow-wrap: anywhere">${name}</h3>${you ? youBadge() : ''}</div>${k.recLine(name)}<div style="font-size: 13px; color: {{t.dim}}; margin-top: 10px">Proj</div><div style="${px(32)}; line-height: 1.2; margin-top: 4px">${fig}</div><div style="font-size: 14px; color: {{t.dim}}; margin-top: 6px">${left} ${left === 1 ? 'starter' : 'starters'} set to play</div></div>`;
const versus = `<section aria-labelledby="sb-h" style="${FRAME}; display: flex; flex-direction: column; gap: 20px; padding: 24px; box-sizing: border-box; min-width: 0">
${k.sbHeading('Week 7 scoreboard, projected').replace('<h2', '<h2 id="sb-h"')}
<div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; align-items: end">${side({ name: 'Darkness Falls', fig: f1(S.meProj), left: k.PRE_LEFT.me, you: true })}${side({ name: 'Sunday Scaries', fig: f1(S.oppProj), left: k.PRE_LEFT.opp, right: true })}</div>
<div style="font-size: 16px"><span style="color: {{t.dim}}">Projected margin ·</span> <b style="font-weight: 700">${k.nb(margin)}</b></div>
${k.twoSided('Darkness Falls', 'Sunday Scaries', S.pct, { on: 'page', caption: `Win probability · <span style="white-space: nowrap">Endzone Forecast</span>`, size: 14 })}
</section>`;

// ---- starters: every row Yet to play; figure is "proj x" (an Out starter shows the reason in its place) ----
const COLS = 'minmax(0, 1fr) 88px minmax(0, 1fr)';
const W = { fig: 84 };
const sideCell = (r, right) => {
  const [, name, inj, tv, st, , proj] = r;
  const dir = right ? 'flex-direction: row-reverse; text-align: right' : '';
  if (st === 'empty') return `<div style="display: flex; align-items: center; gap: 12px; min-width: 0; ${dir}"><div style="flex: 1; min-width: 0"><div style="font-size: 15px; color: {{t.dim}}">Empty</div><div style="font-size: 13px; color: {{t.dim}}">${k.fillBy('pre')}</div></div><div style="text-align: right; width: ${W.fig}px; flex: none"><span style="font-size: 13px; color: {{t.dim}}">proj</span> <b style="font-size: 16px; font-weight: 600; color: {{t.dim}}">0.0</b></div></div>`;
  const fig = inj === 'Out'
    ? `<span style="font-size: 15px; color: {{t.dim}}">out</span>`
    : `<span style="font-size: 13px; color: {{t.dim}}">proj</span> <b style="font-size: 16px; font-weight: 600">${f1(proj)}</b>`;
  return `<div style="display: flex; align-items: center; gap: 12px; min-width: 0; ${dir}"><div style="flex: 1; min-width: 0"><div style="display: flex; align-items: center; gap: 8px; ${right ? 'justify-content: flex-end' : ''}"><span style="font-size: 15px; font-weight: 600">${name}</span>${inj ? injTag(inj) : ''}</div><div style="font-size: 13px; color: {{t.dim}}">${tv}</div></div><div style="text-align: right; width: ${W.fig}px; flex: none">${fig}</div></div>`;
};
const labelRow = right => `<div style="display: flex; align-items: center; gap: 12px; ${right ? 'flex-direction: row-reverse' : ''}"><span style="flex: 1"></span><span style="width: ${W.fig}px; flex: none; text-align: right">Proj</span></div>`;
const rowStyle = last => `display: grid; grid-template-columns: ${COLS}; align-items: center; gap: 0 20px; min-height: 56px; padding: 6px 20px; ${last ? '' : 'border-bottom: 2px solid {{t.rule}}'}`;
const total = (v, right) => `<div role="cell" style="display: flex; align-items: center; gap: 12px; ${right ? 'flex-direction: row-reverse' : ''}"><span style="flex: 1"></span><span style="width: ${W.fig}px; text-align: right"><span style="font-size: 13px; color: {{t.dim}}">proj</span> <b style="font-size: 18px; font-weight: 700">${f1(v)}</b></span></div>`;
const slotPos = s => k.slotTag(s);
const starters = `<section aria-labelledby="st-h" style="${FRAME}; min-width: 0">
${frameHead(`${h2('st-h', 'Starters')}${meta('9 slots')}${meta('Every starter yet to play', 'margin-left: auto')}`)}
<div role="table" aria-label="Starters, Darkness Falls against Sunday Scaries">
<div role="row" style="display: grid; grid-template-columns: ${COLS}; align-items: center; gap: 0 20px; padding: 14px 20px 8px; border-bottom: 2px solid {{t.rule}}">
<div role="columnheader" style="display: flex; align-items: center; gap: 10px">${avatar('Darkness Falls')}<span style="${px(16)}">Darkness Falls</span>${youBadge()}</div>
<span role="columnheader" style="text-align: center; font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: {{t.dim}}">Slot</span>
<div role="columnheader" style="display: flex; align-items: center; gap: 10px; flex-direction: row-reverse; text-align: right">${avatar('Sunday Scaries')}<span style="${px(16)}">Sunday Scaries</span></div>
</div>
<div role="row" aria-hidden="true" style="display: grid; grid-template-columns: ${COLS}; gap: 0 20px; padding: 6px 20px; border-bottom: 2px solid {{t.rule}}; font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: {{t.dim}}">${labelRow(false)}<span></span>${labelRow(true)}</div>
${ME.map((m, i) => `<div role="row" style="${rowStyle(false)}"><div role="cell">${sideCell(m, false)}</div><div role="cell" style="display: flex; flex-direction: column; align-items: center; gap: 4px">${slotPos(m[0])}<span style="font-size: 13px; font-weight: 700; letter-spacing: .04em; color: {{t.dim}}">${m[0]}</span></div><div role="cell">${sideCell(OPP[i], true)}</div></div>`).join('')}
<div role="row" style="${rowStyle(true)}; background: {{t.bg}}; border-top: 2px solid {{t.frame}}">${total(S.meProj, false)}<div role="cell" style="text-align: center; font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase">Totals</div>${total(S.oppProj, true)}</div>
</div>
</section>`;

const bench = `<section aria-labelledby="bn-h" style="${FRAME}; min-width: 0">
${frameHead(`${h2('bn-h', 'Bench')}${meta('6 players each', 'margin-left: auto')}${k.hideBtn}`)}
<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px 40px; padding: 16px 20px 20px">${k.benchCol(k.BENCH_ME, 'Darkness Falls')}${k.benchCol(k.BENCH_OPP, 'Sunday Scaries')}</div>
</section>`;

const notes = k.notes([
  'Before kickoff the scoreboard is the framed versus panel (6px double Frame, not Board black) with the same figures as the Main board: Proj ' + f1(S.meProj) + ' to ' + f1(S.oppProj) + ', ' + S.pct + '% Darkness Falls, one "win probability · Endzone Forecast" credit in the bar&#39;s caption, and the two-sided bar (Critique 9 item 4): each side&#39;s share fills from its own end, the leader (Sunday Scaries) in Ink, the trailer outlined, "Darkness Falls 40%" at the left end and "Sunday Scaries 60%" at the right, one accessible name that names both. The leader fills in Ink, not Accent (session ruling on Critique 9): before kickoff nothing is live, so nothing is green. Each side shows "{n} starters set to play" (7 and 9), never the live count&#39;s wording (Critique 10 item 12). A closed "What the numbers mean" disclosure sits under the page sub-line (Critique 10 item 15).',
  'The product shows the NFL games strip and Last plays only while the matchup is live, so neither is drawn. The lineup note sits where the Bench what-if row would be, between the versus panel and Starters, with the dashboard&#39;s figures for 9:10 AM. Critique 11 item 10 names the two moves plainly: "Two moves · +23.0 pts: Addison in for Puka Nacua (Out) · Spears into the empty FLEX · you&#39;d project 116.8 to 98.6" over "Locks Sun 12:00 PM" (read from lineup-data.js; the gain is 10.1 + 12.9; 116.8 is the 93.8 projection plus the 23.0 gain, computed in code; the Out and empty facts now live in the first line, so line two keeps only the lock, which never breaks). Its pictogram is the warning, never the lock, because the lock means Locked (item 5); the lock is more than an hour away, so it keeps the dated wording and no minutes. The note&#39;s ghost "Set lineup" is the one on the first screen (Critique 11 item 14): the page head no longer repeats it. The empty FLEX row&#39;s line two reads "Fill by Sun 12:00 PM" and its slot tag reads "FLEX". No cursor, no filled action.',
  'The bench reads like the live boards (Critique 11 item 14): a final game shows "8.6 pts · final" over "proj 8.1" (Jaylen Warren, PIT @ CLE was final Thursday) and every game not started shows proj alone.',
  'Starters: the head says "Every starter yet to play" once, so no row repeats the state word (Critique 10 item 13); every row shows "proj x" and line two is the product\'s "BUF vs MIA", with no kickoff and no clock before the games start. Each side carries its record from the standings. An Out starter shows "out" where the projection would be, as the product does. The Exp final column is gone because before kickoff it equals Proj.',
]);

const body = `<main style="max-width: 1280px; margin: 0 auto; padding: 24px 32px 64px; display: flex; flex-direction: column; gap: 24px">
${head}
${versus}
${k.lineupNote('pre')}
${starters}
${bench}
${notes}
</main>`;

k.write(out, 'MatchupPre.dc.html', k.page({ title: 'Matchup, before kickoff', w: 1440, h: 2343, body }));
console.log('ok', f1(S.meProj), f1(S.oppProj), S.pct);
