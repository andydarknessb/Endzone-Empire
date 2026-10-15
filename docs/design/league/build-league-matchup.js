// Matchup detail, LIVE, Sunday 2:40 PM CDT, Week 7. Viewer: Darkness Falls vs Sunday Scaries.
const k = require('./league-kit-samples');
const out = process.argv[2];
const LG = 'Thursday Night Regulars';
const { px, FRAME, frameHead, h2, meta, avatar, youBadge, posTag, injTag, kindTag } = k;

// Both rosters come from the shared Week 7 fixture (lineup-data.js). status: ip = In progress, fin = Final, yet = Yet to play, empty = no player in the slot.
const { ME, OPP, BENCH, LIVE_TOTALS: T } = require('./lineup-data');
const f1 = n => n.toFixed(1);
const { meNow, oppNow, meExp, oppExp, lead } = T;
console.log('now', f1(meNow), f1(oppNow), 'exp', f1(meExp), f1(oppExp));

const MARK = k.MARK;

// ---- head ----
const head = `<section aria-labelledby="h1" style="display: flex; flex-direction: column; gap: 4px; min-width: 0">
${k.breadcrumb([LG, 'Game Center'], 'Matchup')}
<div style="display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 16px 24px">
<div style="display: flex; flex-direction: column; gap: 12px; min-width: 0">
<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px">${k.h1('Week 7 Matchup')}${k.liveChip('Live')}</div>
<p style="margin: 0; font-size: 17px; color: {{t.dim}}">Times in CDT</p>
</div>
<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px">${k.viewToggle({ label: 'Matchup view', items: [{ label: 'Standard', selected: true }, { label: 'Scoreboard' }] })}${k.btnGhost('Set lineup', { tag: 'a', aria: `Set lineup, ${LG}` })}</div>
</div>
</section>`;

// ---- Board-black versus scoreboard ----
const B = { ink: '{{t.boardInk}}', dim: '{{t.boardDim}}' };
const side = ({ name, fig, lead: ld, proj, you, right }) => `<div style="min-width: 0; text-align: ${right ? 'right' : 'left'}"><div style="display: flex; align-items: center; gap: 10px; ${right ? 'flex-direction: row-reverse' : ''}">${avatar(name, { c: B.ink })}<h3 style="margin: 0; min-width: 0; ${px(16, B.ink)}; overflow-wrap: anywhere">${name}</h3>${you ? youBadge(B.ink) : ''}</div><div style="display: flex; align-items: center; gap: 8px; margin-top: 14px; font-size: 13px; color: ${B.dim}; ${right ? 'justify-content: flex-end' : ''}">Live score</div><div style="${px(32, ld ? B.ink : B.dim)}; line-height: 1.2; margin-top: 4px">${fig}</div><div style="font-size: 14px; color: ${B.dim}; margin-top: 6px">Projected ${proj}</div></div>`;
const scoreboard = `<section aria-label="Scoreboard" style="display: flex; flex-direction: column; gap: 20px; padding: 24px; box-sizing: border-box; background: {{t.board}}; color: {{t.boardInk}}; border: 6px double {{t.boardDim}}; min-width: 0">
<div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; align-items: end">${side({ name: 'Darkness Falls', fig: f1(meNow), lead: lead >= 0, proj: f1(meExp), you: true })}${side({ name: 'Sunday Scaries', fig: f1(oppNow), lead: lead < 0, proj: f1(oppExp), right: true })}</div>
<div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px"><span style="${px(16, B.ink)}">${lead >= 0 ? 'Darkness Falls' : 'Sunday Scaries'} by ${f1(Math.abs(lead))}</span></div>
${k.oddsBar(T.pct, { on: 'board' })}
</section>`;

// ---- NFL games strip on Board ----
const GAMES = [['ARI @ SF', '3:25 PM'], ['JAX @ LAR', 'Final'], ['MIA @ BUF', 'Q4 4:21'], ['TB @ DET', 'Q4 8:02'], ['SEA @ HOU', 'Q4 1:48'], ['NYJ @ CIN', 'Q4 9:30'], ['PHI @ MIN', 'Q4 2:30'], ['IND @ TEN', 'Q4 0:48'], ['DAL @ DEN', '3:25 PM'], ['KC @ LV', '3:25 PM']];
const games = `<section aria-labelledby="gm-h" style="display: flex; flex-direction: column; background: {{t.board}}; color: {{t.boardInk}}; border: 6px double {{t.boardDim}}; min-width: 0">
<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 14px 20px; border-bottom: 2px solid {{t.boardRule}}">${h2('gm-h', 'NFL games')}</div>
<ul style="list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr))">${GAMES.map(([g, s], i) => `<li style="display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 52px; box-sizing: border-box; padding: 0 20px; border-top: ${i >= 5 ? '2px solid {{t.boardRule}}' : '0'}; border-left: ${i % 5 ? '2px solid {{t.boardRule}}' : '0'}"><span style="font-size: 15px; font-weight: 600">${g}</span><span style="font-size: 14px; color: ${s.startsWith('Q') ? B.ink : B.dim}; ${s.startsWith('Q') ? 'font-weight: 600' : ''}">${s}</span></li>`).join('')}</ul>
</section>`;

// ---- starters comparison ----
const COLS = 'minmax(0, 1fr) 88px minmax(0, 1fr)';
const sideCell = (r, right) => {
  const [slot, name, inj, game, st, pts, proj, exp] = r;
  if (st === 'empty') return `<div style="display: flex; align-items: center; gap: 12px; min-width: 0; ${right ? 'flex-direction: row-reverse; text-align: right' : ''}"><div style="flex: 1; min-width: 0"><div style="font-size: 15px; color: {{t.dim}}">Empty</div><div style="font-size: 13px; color: {{t.dim}}">No player in this slot</div></div><span style="width: 112px; flex: none"></span><div style="text-align: right; width: 84px; flex: none"><b style="font-size: 16px; font-weight: 700">0.0</b> <span style="font-size: 13px; color: {{t.dim}}">pts</span></div><div style="width: 64px; flex: none; text-align: right; font-size: 15px; color: {{t.dim}}">0.0</div></div>`;
  const [mlabel, mglyph] = MARK[st];
  const fig = st === 'yet'
    ? `<div style="text-align: right; width: 84px; flex: none"><span style="font-size: 13px; color: {{t.dim}}">proj</span> <b style="font-size: 16px; font-weight: 600; color: {{t.dim}}">${f1(proj)}</b></div>`
    : `<div style="text-align: right; width: 84px; flex: none"><b style="font-size: 16px; font-weight: 700">${f1(pts)}</b> <span style="font-size: 13px; color: {{t.dim}}">pts</span></div>`;
  return `<div style="display: flex; align-items: center; gap: 12px; min-width: 0; ${right ? 'flex-direction: row-reverse; text-align: right' : ''}"><div style="flex: 1; min-width: 0"><div style="display: flex; align-items: center; gap: 8px; ${right ? 'justify-content: flex-end' : ''}"><span style="font-size: 15px; font-weight: 600">${name}</span>${inj ? injTag(inj) : ''}</div><div style="font-size: 13px; color: {{t.dim}}">${game}</div></div><span style="display: inline-flex; align-items: center; gap: 8px; width: 112px; flex: none; font-size: 13px; color: {{t.dim}}; ${right ? 'flex-direction: row-reverse' : ''}">${mglyph}${mlabel}</span>${fig}<div style="width: 64px; flex: none; text-align: right; font-size: 15px; color: {{t.dim}}">${f1(exp)}</div></div>`;
};
const labelRow = right => `<div style="display: flex; align-items: center; gap: 12px; ${right ? 'flex-direction: row-reverse' : ''}"><span style="flex: 1"></span><span style="width: 112px; flex: none"></span><span style="width: 84px; flex: none; text-align: right; white-space: nowrap">Pts / proj</span><span style="width: 64px; flex: none; text-align: right">Exp final</span></div>`;
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
${ME.map((m, i) => `<div role="row" style="${rowStyle(false)}"><div role="cell">${sideCell(m, false)}</div><div role="cell" style="display: flex; flex-direction: column; align-items: center; gap: 4px">${posTag(m[0].split(' ')[0] === 'FLEX' ? 'WR' : m[0].split(' ')[0])}<span style="font-size: 13px; font-weight: 700; letter-spacing: .04em; color: {{t.dim}}">${m[0]}</span></div><div role="cell">${sideCell(OPP[i], true)}</div></div>`).join('')}
<div role="row" style="${rowStyle(true)}; background: {{t.bg}}; border-top: 2px solid {{t.frame}}">
<div role="cell" style="display: flex; align-items: center; gap: 12px"><span style="flex: 1"></span><span style="width: 112px"></span><span style="width: 84px; text-align: right"><b style="font-size: 18px; font-weight: 700">${f1(meNow)}</b> <span style="font-size: 13px; color: {{t.dim}}">pts</span></span><span style="width: 64px; text-align: right; font-size: 15px; font-weight: 600; color: {{t.dim}}">${f1(meExp)}</span></div>
<div role="cell" style="text-align: center; font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase">Totals</div>
<div role="cell" style="display: flex; align-items: center; gap: 12px; flex-direction: row-reverse"><span style="flex: 1"></span><span style="width: 112px"></span><span style="width: 84px; text-align: right"><b style="font-size: 18px; font-weight: 700">${f1(oppNow)}</b> <span style="font-size: 13px; color: {{t.dim}}">pts</span></span><span style="width: 64px; text-align: right; font-size: 15px; font-weight: 600; color: {{t.dim}}">${f1(oppExp)}</span></div>
</div>
</div>
</section>`;

// ---- bench ----
const BENCH_ME = BENCH.map(b => [b.name, b.pos, b.sub.split(' · ')[1], b.bye ? null : +b.proj]);
const BENCH_OPP = [['Rachaad White', 'RB', 'TB', 9.3], ['Calvin Ridley', 'WR', 'TEN', 9.0, 'Questionable'], ['Mark Andrews', 'TE', 'BAL', 7.9], ['Jaylen Warren', 'RB', 'PIT', 6.4], ['Romeo Doubs', 'WR', 'GB', 6.0], ['Chig Okonkwo', 'TE', 'TEN', 4.1]];
const benchCol = (rows, name) => `<div><h3 style="margin: 0 0 4px; font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: {{t.dim}}">${name}</h3><ul style="list-style: none; margin: 0; padding: 0">${rows.map(([n, p, t, proj, inj], i) => `<li style="display: flex; align-items: center; gap: 12px; min-height: 48px; ${i < rows.length - 1 ? 'border-bottom: 2px solid {{t.rule}}' : ''}">${posTag(p)}<div style="flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px"><span style="font-size: 15px; font-weight: 600">${n}</span>${inj ? injTag(inj) : ''}<span style="font-size: 13px; color: {{t.dim}}">${t}</span></div><span style="font-size: 15px; color: {{t.dim}}">${proj == null ? 'on bye' : `proj ${f1(proj)}`}</span></li>`).join('')}</ul></div>`;
const bench = `<section aria-labelledby="bn-h" style="${FRAME}; min-width: 0">
${frameHead(`${h2('bn-h', 'Bench')}${meta('6 players each', 'margin-left: auto')}<button type="button" aria-expanded="true" style="min-height: 44px; display: inline-flex; align-items: center; padding: 0 12px; background: transparent; border: 2px solid {{t.ink}}; border-radius: 0; color: {{t.ink}}; font-size: 15px; font-weight: 600">Hide</button>`)}
<div style="display: flex; align-items: center; gap: 8px; padding: 10px 20px; border-bottom: 2px solid {{t.rule}}; font-size: 14px; color: {{t.dim}}">${k.lockIcon()}<span><b style="font-weight: 600; color: {{t.ink}}">Bench what-if.</b> Locked players cannot be swapped.</span></div>
<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px 40px; padding: 16px 20px 20px">${benchCol(BENCH_ME, 'Darkness Falls')}${benchCol(BENCH_OPP, 'Sunday Scaries')}</div>
</section>`;

// ---- last plays ----
const PLAYS = [['Ja\'Marr Chase', 'Receiving TD', '+12.1', 'Darkness Falls'], ['Saquon Barkley', 'Rushing TD', '+9.4', 'Sunday Scaries'], ['Josh Allen', 'Intercepted', '-2.0', 'Darkness Falls'], ["Ka'imi Fairbairn", 'Field goal', '+3.0', 'Sunday Scaries']];
const plays = `<section aria-labelledby="lp-h" style="${FRAME}; min-width: 0">
${frameHead(`${h2('lp-h', 'Last plays')}`)}
<ul style="list-style: none; margin: 0; padding: 4px 20px 8px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 40px">${PLAYS.map(([n, p, pts, tm], i) => `<li style="display: flex; align-items: center; gap: 12px; min-height: 56px; ${i < 2 ? 'border-bottom: 2px solid {{t.rule}}' : ''}">${kindTag(p, { w: 0 })}<div style="flex: 1; min-width: 0"><div style="font-size: 15px; font-weight: 600">${n}</div><div style="font-size: 13px; color: {{t.dim}}">${tm}</div></div><span style="font-size: 18px; font-weight: 700">${pts}</span></li>`).join('')}</ul>
</section>`;

const notes = k.notes([
  'No cursor on this page: it is a watching screen, and the one bench what-if only reads "Locked players cannot be swapped." so there is no next move to point at. Set lineup stays a ghost button, so there is no filled action either.',
  'Green is live state only: the Live chip. The scoreboard odds bar is Board-lit while live. The leader\'s score is white and the trailer\'s is Board dim, with the margin in words.',
  'Starters keep both sides on one row so a slot reads straight across. In progress (filled square), Final (outline square) and Yet to play (outline with a centre dot) each pair a distinct shape with the words, so state never rides on colour. Pixel type stays on the h1, team names in heads and scores.',
]);

const body = `<main style="max-width: 1280px; margin: 0 auto; padding: 24px 32px 64px; display: flex; flex-direction: column; gap: 24px">
${head}
${scoreboard}
${games}
${starters}
${bench}
${plays}
${notes}
</main>`;

k.write(out, 'Matchup.dc.html', k.page({ title: 'Matchup, live', w: 1440, h: 2400, body }));
console.log('ok');
