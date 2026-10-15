// Dashboard, pick'em-only league "Sunday Pick'em", in season Week 7, viewer is a member (Darkness Falls). No fantasy widgets.
const k = require('./league-kit');
const out = process.argv[2];
const LG = "Sunday Pick'em";

const head = k.phHead({ title: LG, chips: ['Week 7 · In season'] });

const move = `<section aria-labelledby="move-h" style="${k.FRAME}; min-width: 0">
${k.frameHead(`${k.h2('move-h', 'Your move')}${k.badge(1, 'plays')}`)}
<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; padding: 12px">
${k.playCard({ kind: 'picks', name: 'Week 7 picks', league: LG, detail: "Confidence pick'em · 0 of 14 made", lockDay: 'Thu', lockTime: '7:15 PM', lockNote: 'The first game locks at kickoff. Each game locks at its own kickoff.', cta: 'Make picks', aria: `Make Week 7 picks in ${LG}, 0 of 14 made, the first game locks Thursday 7:15 PM`, state: 'next' })}
</div></section>`;

// The Pick'em tile is the lead card above, so the Playbook is League · 3 only.
const playbook = k.phPb({ cols: 280, groups: [{ name: 'League', tiles: [{ kind: 'activity', label: 'Activity', status: 'Recent roster and league moves' }, { kind: 'history', label: 'History', status: 'Past seasons and champions' }, { kind: 'rules', label: 'League Rules', status: 'Scoring and roster settings' }] }] });

// Weekly confidence points for weeks 1-6 (week 7 has not kicked off, so every Wk 7 cell reads "-").
const T = [
  ['Blitz Brigade', [72, 81, 64, 88, 77, 70], 61, 29, 14, 'up'], ['Waiver Wolves', [68, 74, 79, 70, 83, 66], 60, 30, 11, 'flat'],
  ['Darkness Falls', [61, 77, 70, 84, 62, 75], 58, 32, 0, 'up'], ['Sunday Scaries', [66, 58, 73, 69, 72, 60], 56, 34, 14, 'down'],
  ['Gridiron Ghosts', [59, 70, 55, 76, 64, 68], 55, 35, 8, 'up'], ['Fumble Rooskie', [63, 52, 68, 61, 70, 57], 53, 37, 14, 'flat'],
  ['Hail Mary Club', [55, 64, 49, 66, 58, 62], 51, 39, 0, 'down'], ['Pocket Aces', [60, 47, 58, 52, 61, 50], 49, 41, 14, 'flat'],
  ['Dynasty Dads', [48, 55, 44, 57, 46, 59], 47, 43, 6, 'up'], ['Red Zone Rejects', [45, 41, 52, 43, 50, 38], 42, 48, 14, 'down'],
];
const VIEWER = 2;
const rows0 = T.map(([team, wk, c, m, p, trend]) => ({ team, wk, c, m, p, trend, pts: wk.reduce((a, b) => a + b), best: Math.max(...wk), acc: c / (c + m) }));
const leader = Math.max(...rows0.map(r => r.pts));
const bucket = (v, best) => { const f = v / best; return f <= 0.25 ? 1 : f <= 0.5 ? 2 : f <= 0.75 ? 3 : 4; };

const heat = (r, me) => {
  const fill = me ? '{{t.playInk}}' : '{{t.frame}}', track = me ? '{{t.playField}}' : '{{t.bg}}', line = me ? '{{t.playDim}}' : '{{t.dim}}';
  const bestWeek = r.wk.indexOf(r.best) + 1;
  const cells = Array.from({ length: 18 }, (_, i) => {
    const w = i + 1, v = r.wk[i];
    const label = v == null ? `Week ${w}: not played yet` : `Week ${w}: ${v} points${w === bestWeek ? ', best week' : ''}`;
    return `<span role="img" aria-label="${label}" style="position: relative; display: block; width: 12px; height: 12px; box-sizing: border-box; border: 1px solid ${line}; background: ${track}; overflow: hidden; ${w === bestWeek ? `outline: 2px solid ${fill}; outline-offset: 1px` : ''}">${v == null ? '' : `<span style="position: absolute; left: 0; right: 0; bottom: 0; height: ${bucket(v, r.best) * 25}%; background: ${fill}"></span>`}</span>`;
  }).join('');
  return `<span style="display: flex; gap: 3px; padding: 2px 0">${cells}</span>`;
};
const accBar = (acc, me) => {
  const on = Math.round(acc * 10), fill = me ? '{{t.playInk}}' : '{{t.frame}}', line = me ? '{{t.playDim}}' : '{{t.dim}}';
  return `<span style="display: inline-flex; align-items: center; gap: 10px"><span aria-hidden="true" style="display: grid; grid-template-columns: repeat(10, 8px); gap: 2px">${Array.from({ length: 10 }, (_, i) => `<span style="height: 12px; box-sizing: border-box; ${i < on ? `background: ${fill}` : `border: 2px solid ${line}`}"></span>`).join('')}</span><span style="min-width: 40px">${Math.round(acc * 100)}%</span></span>`;
};
const TREND = {
  up: ['M5 1h2v2H5zM3 3h6v2H3zM1 5h10v2H1z', 'improved'],
  down: ['M1 3h10v2H1zM3 5h6v2H3zM5 7h2v2H5z', 'declined'],
  flat: ['M2 5h8v2H2z', 'unchanged'],
};
const trend = t => `<svg width="12" height="12" viewBox="0 0 12 12" shape-rendering="crispEdges" aria-hidden="true" style="vertical-align: middle"><path d="${TREND[t][0]}" fill="currentColor"/></svg><span style="${k.SR}">Trend: ${TREND[t][1]}</span>`;

const cols = [{ label: 'Rank', w: 64 }, { label: 'Team', w: 216 }, { label: 'Points', align: 'right', w: 72 }, { label: 'Wk 7', align: 'right', w: 64 }, { label: 'Correct', align: 'right', w: 76 }, { label: 'Missed', align: 'right', w: 72 }, { label: 'Pending', align: 'right', w: 76 }, { label: 'Accuracy', w: 150 }, { label: 'Weekly points · Wk 1 to 18', w: 292 }, { label: 'Trend', align: 'right', w: 64 }];
const rows = rows0.map((r, i) => {
  const me = i === VIEWER;
  return [i + 1, k.phTeamCell(r.team, me), `<b style="font-weight: 700">${r.pts}</b>`, '-', r.c, r.m, r.p, accBar(r.acc, me), heat(r, me), trend(r.trend)];
});
const v = rows0[VIEWER];
const tile = (l, val) => `<div style="display: flex; flex-direction: column; gap: 6px; min-width: 150px; padding: 10px 16px; box-sizing: border-box; border: 2px solid {{t.rule}}"><span style="font-size: 13px; color: {{t.dim}}">${l}</span><span style="${k.px(24)}; line-height: 1.3">${val}</span></div>`;
const standings = `<section aria-labelledby="ps-h" style="${k.FRAME}; min-width: 0">${k.frameHead(`${k.h2('ps-h', "Pick'em Standings")}${k.meta('10 teams', 'margin-left: auto')}`)}
<div style="display: flex; flex-wrap: wrap; gap: 12px; padding: 14px 20px; border-bottom: 2px solid {{t.rule}}">${tile('Your rank', '3rd')}${tile('Behind leader', `${leader - v.pts} pts`)}${tile('Your accuracy', `${Math.round(v.acc * 100)}%`)}${tile('Best week', `Wk ${v.wk.indexOf(v.best) + 1}`)}</div>
${k.table({ label: "Pick'em Standings, 10 teams", cols, rows, viewer: VIEWER, minW: 1146 })}</section>`;

// Weekly awards of weeks 1-6 from the Weekly points above (Weekly High is the week's top points).
const awards = [
  ['cup', 'Weekly High', 'Darkness Falls', 'Week 6 · 75'], ['cup', 'Weekly High', 'Waiver Wolves', 'Week 5 · 83'], ['star', 'Called Shot', 'Gridiron Ghosts', 'Week 4'],
];
const trophies = k.trophyLink(awards.length);

const chat = `<div style="display: flex; justify-content: flex-end; padding-top: 14px">${k.chatButton({ unread: 2 })}</div>`;
const notes = k.notes([
  "One cursor: Week 7 picks is the Recommended action for a pick'em-only league in season, so it takes the cursor frame and the page's one filled button. Thursday 7:15 PM is more than an hour away, so the cursor is yellow, not red.",
  "The body is Pick'em Standings: viewer strip, then the table with the 18-cell weekly heat strip (fill height by bucket, best week outlined) and Trend as an arrow shape. Heat and accuracy use Frame color, so green stays reserved. The Wk 7 column reads - until the first game is played; Pending counts picks made and not yet decided.",
  "The viewer row is Play-blue with an arrow, not a cursor. On a phone Rank and Team stay and the figures scroll inside the table box.",
  "No fantasy widgets mount: no Matchup, My team, Recap, Around the league, Recent activity, Commissioner facts or Draft chips. The Playbook is League · 3: the Pick'em tile would duplicate the lead card, so it is left out.",
]);

const body = `<main style="max-width: 1280px; margin: 0 auto; padding: 40px 32px 64px; display: flex; flex-direction: column; gap: 32px">
${head}
${move}
${standings}
${playbook}
${trophies}
${chat}
${notes}
</main>`;
k.write(out, 'PickemOnly.dc.html', k.page({ title: "League dashboard, pick'em-only", w: 1440, h: 2000, body }));
console.log('ok');
