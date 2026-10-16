// Lineup on a phone (390), a move in progress: Puka Nacua is being moved, eligible rows are highlighted, the rest are Dim with a dashed rule.
const k = require('./league-kit-samples');
const { STARTERS, BENCH, IR, SUMMARY, BENCH_POINTS, FIRST_LOCK, FILLED, ADVICE, plural } = require('./lineup-data');
const out = process.argv[2];
const LG = 'Thursday Night Regulars';
const { px, FRAME, frameHead, h2, meta, injTag } = k;
const f1 = n => n.toFixed(1);

const head = `<section aria-labelledby="h1" style="display: flex; flex-direction: column; gap: 10px; min-width: 0">
<div style="font-size: 14px; font-weight: 600; color: {{t.dim}}">Lineup · ${LG}</div>
${k.h1('Darkness Falls', { phone: true })}
<p style="margin: 0; font-size: 15px; color: {{t.dim}}">Week 7 · First lock Sun ${FIRST_LOCK} · times in CDT</p>
${k.weekPicker({ week: 7, phone: true })}
</section>`;

const tile = (l, v) => `<div style="display: flex; flex-direction: column; gap: 2px; min-width: 0"><span style="font-size: 13px; color: {{t.dim}}">${l}</span><span style="font-size: 16px; font-weight: 700">${v}</span></div>`;
const summary = `<section aria-label="Team summary" style="${FRAME}; min-width: 0">
<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 12px 14px; border-bottom: 2px solid {{t.rule}}"><span style="display: inline-flex; align-items: center; height: 32px; padding: 0 10px; box-sizing: border-box; border: 2px solid {{t.ink}}; font-size: 14px; font-weight: 700">+${ADVICE.gain} pts · ${plural(ADVICE.swaps, 'swap')}</span><span style="font-size: 13px; color: {{t.dim}}">Wk 7 · 1 bye</span></div>
<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; padding: 12px 14px">${tile('Score vs proj.', `0.0 · ${f1(SUMMARY.meProj)}`)}${tile('Opponent vs proj.', `0.0 · ${f1(SUMMARY.oppProj)}`)}${tile('Starters', `${FILLED} to play`)}${tile('Win probability', SUMMARY.pct + '%')}</div>
<div style="display: flex; flex-wrap: wrap; gap: 6px 16px; padding: 0 14px 12px; font-size: 14px; font-weight: 600"><span style="display: inline-flex; align-items: center; gap: 8px">${injTag('Out')}Nacua</span><span style="display: inline-flex; align-items: center; gap: 8px">${injTag('Questionable')}Marks</span><span>Olave on bye</span></div>
</section>`;

const modeFor = s => {
  if (s.name === 'Puka Nacua') return 'moving';
  const wrSlot = s.slot === 'WR 2' || s.slot === 'FLEX' || s.pos === 'WR';
  return wrSlot && !s.bye && !s.lock && s.slot !== 'IR' ? 'eligible' : 'dim';
};
const ledger = (id, title, rows, metaText) => `<section aria-labelledby="${id}" style="${FRAME}; min-width: 0">${frameHead(`${h2(id, title, { phone: true })}${meta(metaText, 'margin-left: auto')}`, { phone: true })}<ul style="list-style: none; margin: 0; padding: 2px 6px 6px">${rows.join('')}</ul></section>`;
const starters = ledger('ls-h', 'Starters', STARTERS.map((s, i) => k.lineupRow({ ...s, phone: true, mode: modeFor(s), last: i === STARTERS.length - 1 })), `${FILLED} of ${STARTERS.length} filled`);
const bench = ledger('lb-h', 'Bench', BENCH.map((s, i) => k.lineupRow({ ...s, phone: true, mode: modeFor(s), last: i === BENCH.length - 1 })), `Bench points this season: ${BENCH_POINTS}`);

const ir = ledger('li-h', 'IR', IR.map((s, i) => k.lineupRow({ ...s, phone: true, mode: modeFor(s), last: i === IR.length - 1 })), '1 player');

const notes = k.notes([
  'A move in progress: Puka Nacua (WR, Out) is the pressed row and holds the one cursor. WR 2, the empty FLEX and the bench WR Jordan Addison are highlighted in Play-blue. Every other row keeps full opacity: Dim name, a dashed rule and "not eligible" for screen readers. Locked, bye and IR rows are never eligible.',
  'No filled action on the phone while a move is open: the move strip offers Cancel, and the pick is the highlighted row. The footer toggles show or hide Starters, Bench and Outlook (the Endzone Forecast, byes and preview frames).',
]);

const body = `<main style="padding: 24px 16px 24px; display: flex; flex-direction: column; gap: 20px">
${head}
${summary}
${starters}
${bench}
${ir}
${notes}
</main>
${k.stickyFooter({ name: 'Puka Nacua' })}`;

k.write(out, 'LineupPhone.dc.html', k.page({ title: 'Lineup, phone', w: 390, h: 2288, body, phone: true }));
console.log('ok');
