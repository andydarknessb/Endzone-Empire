// Pick'em, Standings tab, Thursday Night Regulars at Sunday Oct 18 2:40 PM. Same table, strip and heat strip as the PickemOnly board.
// Viewer row matches the dashboard fixture (PICKEM_LIVE): T-3, 52 points, 6 behind the leader. Edit the TABLE rows below to re-cut the numbers.
const k = require('./league-kit-pickem');
const out = process.argv[2];
const LG = 'Thursday Night Regulars';

// [team, points, Wk 7 so far, accuracy, pending, trend]. Straight up: Points = Correct, so Missed derives from accuracy.
const TABLE = [
  ['Sunday Scaries', 58, 1, 0.66, 11, 'up'], ['Gridiron Ghosts', 55, 1, 0.65, 12, 'flat'], ['Darkness Falls', 52, 1, 0.63, 8, 'up'], ['Hail Mary Club', 52, 1, 0.62, 10, 'down'],
  ['Blitz Brigade', 50, 1, 0.61, 12, 'flat'], ['Waiver Wolves', 48, 0, 0.60, 9, 'down'], ['Pocket Aces', 47, 1, 0.60, 11, 'up'], ['Fumble Rooskie', 45, 1, 0.58, 10, 'flat'],
  ['Red Zone Rejects', 43, 1, 0.58, 11, 'down'], ['Dynasty Dads', 41, 0, 0.57, 9, 'flat'], ['Practice Squad', 39, 1, 0.56, 10, 'up'], ['Bench Mob', 36, 0, 0.55, 9, 'down'],
];
const VIEWER = 2, TOTAL = TABLE.length;
// Pending = picks still in play: the 8 live games carry 91 picks and the 5 open games 31 (the Pickem board's own tallies). JAX @ LAR is live, so its picks are pending, not Correct or Missed.
if (TABLE.reduce((a, r) => a + r[4], 0) !== 122) throw new Error('Pending must sum to 122');
const WOBBLE = [[1, -1, 2, -2, 0, 0], [-1, 2, 0, -2, 1, 0], [0, 1, -2, 2, -1, 0], [2, -2, 1, 0, 0, -1], [-2, 1, 0, 1, 0, 0], [1, 0, -1, 0, -2, 2]];
const rows0 = TABLE.map(([team, pts, w7, accT, pending, trend], i) => {
  const missed = Math.round(pts / accT - pts);
  const s = pts - w7, base = Math.floor(s / 6), rem = s - base * 6; // weeks 1 to 6 sum to the points before Wk 7
  const wk = WOBBLE[i % 6].map((d, j) => base + d + (j < rem ? 1 : 0));
  wk[5] += s - wk.reduce((a, b) => a + b, 0);
  const all = [...wk, w7];
  const best = Math.max(...all);
  return { team, pts, w7, correct: pts, missed, pending, trend, wk: all, best, bests: all.map((x, j) => x === best ? j + 1 : 0).filter(Boolean), acc: pts / (pts + missed) };
});
const lead = rows0[0].pts, v = rows0[VIEWER];
const rankOf = r => 1 + rows0.filter(o => o.pts > r.pts).length;
const tied = r => rows0.filter(o => o.pts === r.pts).length > 1;
const list = a => a.length < 2 ? String(a[0]) : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
const bucket = (x, best) => { const f = x / best; return f <= 0.25 ? 1 : f <= 0.5 ? 2 : f <= 0.75 ? 3 : 4; };

// One labelled image per row; the 18 cells are decoration (aria-hidden). Every tied best week is ringed and named.
const heat = (r, me) => {
  const fill = me ? '{{t.playInk}}' : '{{t.frame}}', track = me ? '{{t.playField}}' : '{{t.bg}}', line = me ? '{{t.playDim}}' : '{{t.dim}}';
  const played = r.wk.filter(x => x != null);
  const label = `Weekly points, weeks 1 to ${played.length}: ${played.join(', ')}; best week${r.bests.length > 1 ? 's' : ''} ${list(r.bests)}`;
  const cells = Array.from({ length: 18 }, (_, i) => {
    const w = i + 1, x = r.wk[i];
    return `<span aria-hidden="true" style="position: relative; display: block; width: 12px; height: 12px; box-sizing: border-box; border: 1px solid ${line}; background: ${track}; overflow: hidden; ${r.bests.includes(w) ? `outline: 2px solid ${fill}; outline-offset: 1px` : ''}">${x == null ? '' : `<span style="position: absolute; left: 0; right: 0; bottom: 0; height: ${bucket(x, r.best) * 25}%; background: ${fill}"></span>`}</span>`;
  }).join('');
  return `<span role="img" aria-label="${label}" style="display: flex; gap: 3px; padding: 2px 0">${cells}</span>`;
};
// Straight up: Points = Correct, so there is no Correct column; Accuracy is the percent alone (the 10-cell bars said it a second time).
const pct = acc => `${Math.round(acc * 100)}%`;
// 16px box, pixel steps of 2: the arrows are 12 to 14px wide.
const TREND = { up: ['M7 4h2v2H7zM5 6h6v2H5zM3 8h10v2H3zM1 10h14v2H1z', 'improved'], down: ['M1 4h14v2H1zM3 6h10v2H3zM5 8h6v2H5zM7 10h2v2H7z', 'declined'], flat: ['M2 6h12v4H2z', 'unchanged'] };
const trend = t => `<svg width="16" height="16" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true" style="vertical-align: middle"><path d="${TREND[t][0]}" fill="currentColor"/></svg><span style="${k.SR}">Trend: ${TREND[t][1]}</span>`;

const cols = [{ label: 'Rank', w: 64 }, { label: 'Team', w: 216 }, { label: 'Points', align: 'right', w: 72 }, { label: 'Wk 7', align: 'right', w: 64 }, { label: 'Missed', align: 'right', w: 72 }, { label: 'Pending', align: 'right', w: 76 }, { label: 'Accuracy', align: 'right', w: 96 }, { label: 'Weekly points · Wk 1 to 18', w: 292 }, { label: 'Trend', align: 'right', w: 64 }];
const rows = rows0.map((r, i) => {
  const me = i === VIEWER;
  return [`${tied(r) ? 'T-' : ''}${rankOf(r)}`, k.phTeamCell(r.team, me), `<b style="font-weight: 700">${r.pts}</b>`, r.w7, r.missed, r.pending, pct(r.acc), heat(r, me), trend(r.trend)];
});
const tile = (l, val) => `<div style="display: flex; flex-direction: column; gap: 6px; min-width: 150px; padding: 10px 16px; box-sizing: border-box; border: 2px solid {{t.rule}}"><span style="font-size: 13px; color: {{t.dim}}">${l}</span><span style="${k.px(24)}; line-height: 1.3">${val}</span></div>`;
const standings = `<section aria-labelledby="ps-h" style="${k.FRAME}; min-width: 0">${k.frameHead(`${k.h2('ps-h', 'Standings')}${k.meta(`${TOTAL} teams`, 'margin-left: auto')}`)}
<p style="margin: 0; padding: 10px 20px; border-bottom: 2px solid {{t.rule}}; font-size: 14px; color: {{t.dim}}"><b style="font-weight: 600; color: {{t.ink}}">Weekly points</b> · one square per week, Wk 1 to 18. Fill height: that week against the team's own best week. Ring: best week (every tied best week is ringed). Empty: not played.</p>
<div style="display: flex; flex-wrap: wrap; gap: 12px; padding: 14px 20px; border-bottom: 2px solid {{t.rule}}">${tile('Your rank', `${tied(v) ? 'T-' : ''}${rankOf(v)}`)}${tile('Behind leader', `${lead - v.pts} pts`)}${tile('Your accuracy', `${Math.round(v.acc * 100)}%`)}${tile(`Best week${v.bests.length > 1 ? 's' : ''}`, `Wk ${list(v.bests)}`)}</div>
${k.table({ label: `Standings, ${TOTAL} teams`, cols, rows, viewer: VIEWER, minW: 1016 })}</section>`;

const notes = k.notes([
  "The Standings section reuses the PickemOnly board's table and 18-cell heat strip: the viewer row is Play-blue with an arrow (not a cursor), ranks are plain figures with no medal colours, Trend is a 16px pixel arrow (12 to 14px wide) in Ink with its sr word, and the heat strip uses Frame color so green stays reserved. Straight up drops the Correct column (it always equals Points) and the 10-cell accuracy bars: Accuracy is the percent alone, right-aligned, so the same figure is not drawn twice; the table keeps one header row of column headers (th scope=col) and a row header per team (th scope=row), and the 9 columns match the 9 cells of every row. A one-line legend above the tiles states how the heat strip is drawn: each square is a week, fill height is that week against the team's own best week (in quarters, not against the league's best), a ringed square is the best week (every tied best week is ringed), an empty square is a week not yet played. Ties read T-3 and the next rank skips to 5.",
  "Heat strip (Critique 10 item 8): each team's strip is one labelled image, role=img, with the full sentence as its name (for example 'Weekly points, weeks 1 to 7: 9, 10, 7, 10, 7, 8, 1; best weeks 2 and 4'), and its 18 cells are aria-hidden, so a screen reader hears one sentence per row instead of eighteen. A tied best week is named in the sentence ('best weeks 2 and 4', or 'best week 3' when there is one) and every tied week wears the ring; the 'Best week' tile follows the same rule for the viewer.",
  "Commissioner settings (fantasy variant) sits above the sections control, as the product mounts it: one collapsed row with 'Pick'em on', Straight up and a ghost 'Edit' ('Hide' when expanded; the expanded panel is on the States sheet). The Picks and Standings control is one tab stop (selected option tabindex 0, the other -1).",
  "Wk 7 counts the Thursday game only (PIT @ CLE is the one final): Darkness Falls picked PIT, so 1 point; Pending is the picks still in play (8 live games carry 91 picks, 5 open games 31, 122 in all; JAX @ LAR is live, so none of its picks is decided): 8 for the viewer. No cursor and no filled action on this section: the cursor belongs to Picks (ARI at SF still needs a pick), and the sections control keeps the selected Standings state with Play-blue, an arrow and the word. The product's Season switch only draws when the page passes more than one season, so it is absent. Picks save on tap (Critique 10), so no batch-save button or bar exists on any Pick'em section.",
]);

const body = `<main style="max-width: 1280px; margin: 0 auto; padding: 24px 32px 64px; display: flex; flex-direction: column; gap: 24px">
${k.pkHead(LG)}
${k.commissionerPanel({ mode: 'straight' })}
${k.sectionsControl({ selected: 'standings' })}
${standings}
${notes}
</main>`;
k.write(out, 'PickemStandings.dc.html', k.page({ title: "Pick'em, standings", w: 1440, h: 1366, body }));
console.log('ok');
