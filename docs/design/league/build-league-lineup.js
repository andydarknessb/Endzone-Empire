// Lineup before kickoff, Week 7. Cursor on the starter who is Out; the page's one filled action is the Forecast suggestion's Apply.
const k = require('./league-kit-samples');
const { STARTERS, BENCH, IR, SUMMARY, BENCH_POINTS, LEFT_ON_BENCH, FIRST_LOCK, FILLED, ADVICE, plural } = require('./lineup-data');
const out = process.argv[2];
const LG = 'Thursday Night Regulars';
const { px, FRAME, frameHead, h2, meta, avatar, injTag } = k;

const f1 = n => n.toFixed(1);
const { meProj, oppProj, trail, pct } = SUMMARY;

// ---- head ----
const weekPicker = k.weekPicker({ week: 7 });
const head = `<section aria-labelledby="h1" style="display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 16px 24px">
<div style="display: flex; flex-direction: column; gap: 12px; min-width: 0">
<div style="font-size: 15px; font-weight: 600; color: {{t.dim}}">Lineup · ${LG}</div>
<div style="display: flex; align-items: center; gap: 16px">${avatar('Darkness Falls', { size: 48 })}${k.h1('Darkness Falls')}</div>
<p style="margin: 0; font-size: 17px; color: {{t.dim}}">Week 7 · First lock Sun ${FIRST_LOCK} · times in CDT</p>
</div>
${weekPicker}
</section>`;

// ---- team summary strip ----
const tile = (l, v, sub) => `<div style="display: flex; flex-direction: column; gap: 2px; min-width: 0"><span style="font-size: 13px; color: {{t.dim}}">${l}</span><span style="font-size: 18px; font-weight: 700">${v}</span>${sub ? `<span style="font-size: 13px; color: {{t.dim}}">${sub}</span>` : ''}</div>`;
const pill = t => `<span style="display: inline-flex; align-items: center; height: 32px; padding: 0 10px; box-sizing: border-box; border: 2px solid {{t.ink}}; font-size: 14px; font-weight: 700">${t}</span>`;
const issue = (inj, text) => `<span style="display: inline-flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600">${inj ? injTag(inj) : ''}${text}</span>`;
const summary = `<section aria-label="Team summary" style="${FRAME}; min-width: 0">
<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 20px; padding: 12px 20px; border-bottom: 2px solid {{t.rule}}">${pill(`+${ADVICE.gain} pts · ${plural(ADVICE.swaps, 'swap')}`)}<span style="font-size: 14px; color: {{t.dim}}">Wk 7 · 1 bye</span><span style="margin-left: auto; display: flex; flex-wrap: wrap; gap: 6px 20px">${issue('Out', 'Nacua')}${issue('Questionable', 'Marks')}${issue('', 'Olave on bye')}</span></div>
<div style="display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px 16px; padding: 14px 20px">${tile('This week', 'Wk 7', 'vs Sunday Scaries')}${tile('Score vs proj.', `0.0 · ${f1(meProj)}`, 'score · proj')}${tile('Opponent vs proj.', `0.0 · ${f1(oppProj)}`, 'score · proj')}${tile('Starters', `${FILLED} to play`, `${FILLED} of ${STARTERS.length} slots filled`)}${tile('Win probability', pct + '%', 'Endzone Forecast')}</div>
</section>`;

// ---- ledger ----
const ledger = (id, title, rows, metaText) => `<section aria-labelledby="${id}" style="${FRAME}; min-width: 0">${frameHead(`${h2(id, title)}${meta(metaText, 'margin-left: auto')}`)}<ul style="list-style: none; margin: 0; padding: 4px 12px 8px">${rows.join('')}</ul></section>`;
const starterRows = STARTERS.map((s, i) => k.lineupRow({ ...s, last: i === STARTERS.length - 1 }));
const benchRows = BENCH.map((s, i) => k.lineupRow({ ...s, last: i === BENCH.length - 1 }));
const irRows = IR.map(s => k.lineupRow({ ...s, last: true }));
const starters = ledger('ls-h', 'Starters', starterRows, `${FILLED} of ${STARTERS.length} filled`);
const bench = ledger('lb-h', 'Bench', benchRows, `Bench points this season: ${BENCH_POINTS}`);
const ir = ledger('li-h', 'IR', irRows, '1 player');

// ---- Endzone Forecast ----
const statLine = (l, v) => `<div style="display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-top: 2px solid {{t.rule}}; font-size: 14px"><span style="color: {{t.dim}}">${l}</span><b style="font-weight: 600; text-align: right">${v}</b></div>`;
const card = k.forecastCard({ slot: 'WR', title: 'Start Jordan Addison over Puka Nacua', verdict: 'Strong start', odds: 94, gain: '10.1', decide: 'Sun ' + FIRST_LOCK,
  sit: { name: 'Puka Nacua', inj: 'Out', note: 'No practice this week', range: { floor: 0, proj: 0, ceil: 0, max: 24 } },
  start: { name: 'Jordan Addison', range: { floor: 3.2, proj: 10.1, ceil: 19.4, max: 24 }, facts: ['High total 47.5', 'Favored by 2.5'] },
  actions: `${k.btnGhost('Compare')}${k.btnGhost('Call your shot')}${k.btnQuiet('Dismiss')}${k.btnFill('Apply', { tag: 'button' })}` });
const forecast = `<section aria-labelledby="ef-h" style="${FRAME}; min-width: 0">${frameHead(`${h2('ef-h', 'Endzone Forecast', { phone: true })}`, { phone: true })}
<div style="padding: 16px; display: flex; flex-direction: column; gap: 16px">
<p style="margin: 0; font-size: 15px; font-weight: 600">Projected to trail by ${f1(trail)}: lean toward Ceiling</p>
${card}
<div style="display: flex; flex-direction: column">${statLine('Left on the bench this season', LEFT_ON_BENCH)}${statLine('You vs the Forecast', '3-2')}${statLine('Called shots this season', '2 of 3 · streak 1')}</div>
</div></section>`;

// ---- bye clusters ----
const bye = `<section aria-labelledby="by-h" style="${FRAME}; min-width: 0">${frameHead(`${h2('by-h', 'Bye clusters', { phone: true })}${meta('Wk 9 to 11', 'margin-left: auto')}`, { phone: true })}
<ul style="list-style: none; margin: 0; padding: 4px 16px 8px">${[['Wk 9', 'Week 9: Spears and Addison sit. Waivers clear in 52 hours.'], ['Wk 11', 'Week 11: Allen and Kincaid sit. Waivers clear in 52 hours.']].map(([w, t], i) => `<li style="display: flex; align-items: flex-start; gap: 12px; padding: 10px 0; ${i ? 'border-top: 2px solid {{t.rule}}' : ''}">${k.kindTag(w, { w: 64 })}<span style="font-size: 15px; padding-top: 2px">${t}</span></li>`).join('')}</ul></section>`;

// ---- matchup preview (framed before kickoff, frame-colour odds bar) ----
const pv = (n, fig, r) => `<div style="min-width: 0; text-align: ${r ? 'right' : 'left'}"><div style="font-size: 15px; font-weight: 600; overflow-wrap: anywhere">${n}</div><div style="font-size: 13px; color: {{t.dim}}">Expected final</div><div style="${px(24)}; line-height: 1.3">${fig}</div></div>`;
const preview = `<section aria-labelledby="mp-h" style="${FRAME}; min-width: 0">${frameHead(`${h2('mp-h', 'Matchup', { phone: true })}${k.chip('Scheduled')}${meta('Week 7 · Kicks off Sun ' + FIRST_LOCK, 'width: 100%')}`, { phone: true })}
<div style="padding: 16px; display: flex; flex-direction: column; gap: 16px"><div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px">${pv('Darkness Falls', f1(meProj))}${pv('Sunday Scaries', f1(oppProj), true)}</div>${k.oddsBar(pct)}<div style="font-size: 15px"><span style="color: {{t.dim}}">Projected margin ·</span> <b style="font-weight: 700">Sunday Scaries by ${f1(trail)}</b></div><div style="margin-left: -10px">${k.link('Matchup', 'Open the Week 7 matchup')}</div></div></section>`;

const notes = k.notes([
  `One cursor, on Puka Nacua: he is Out and his game kicks off first (Sun ${FIRST_LOCK}), so that row is the next move. Every row is a real button (aria-pressed) with the player name and Drop player as their own buttons on top; there is no Swap player control.`,
  "The one filled action is the Endzone Forecast suggestion's Apply: Start Jordan Addison over Puka Nacua. Sit and Start sit on one shared grid, so the names, notes, bars and figures line up. Once a game kicks off its row carries the lock icon and no Drop; nothing has kicked off yet in Week 7.",
  'Green is the filled Apply only. The odds bar is Frame colour before kickoff. Out is an inverted tag rather than red, because red is reserved for under one hour and errors. Rows are Archivo throughout; pixel type is the h1, frame heads, the week, the verdict and status chips.',
]);

const body = `<main style="max-width: 1280px; margin: 0 auto; padding: 40px 32px 64px; display: flex; flex-direction: column; gap: 24px">
${head}
<div style="display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 24px; align-items: start">
<div style="display: flex; flex-direction: column; gap: 24px; min-width: 0">${summary}${starters}${bench}${ir}</div>
<div style="display: flex; flex-direction: column; gap: 24px; min-width: 0">${forecast}${bye}${preview}</div>
</div>
${notes}
</main>`;

k.write(out, 'Lineup.dc.html', k.page({ title: 'Lineup, before kickoff', w: 1440, h: 1911, body }));
console.log('ok');
