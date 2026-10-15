const k = require('./kit');
const out = process.argv[2];

const head = `<section aria-labelledby="h1" style="display: flex; flex-direction: column; gap: 8px">
${k.h1('Welcome back, andy1234', { phone: true })}
<p style="margin: 0; font-size: 15px; color: {{t.dim}}">Week 1 · Thursday, Sep 10 · Your draft is live, and tonight's pick locks at 7:20 PM.</p>
</section>`;

const plays = `<section aria-labelledby="plays-h" style="${k.FRAME}">
${k.frameHead(`${k.h2('plays-h', 'Call your plays', { phone: true })}${k.badge(2, 'plays')}${k.meta('Earliest lock first · times in CDT · updated just now', 'flex-basis: 100%')}`, { phone: true })}
<div style="display: flex; flex-direction: column; gap: 8px; padding: 12px">
${k.playCard({ kind: 'picks', name: "Tonight's pick", league: 'NYG at PHI · 2 leagues', lockDay: 'Thu', lockTime: '7:20 PM', countdown: 'in 38 min', lockNote: 'Your draft keeps running while you pick. 15 more games lock Sun and Mon.', cta: 'Make picks', state: 'urgent', lead: true, aria: 'Pick NYG at PHI in 2 leagues before 7:20 PM', actions: [{ label: "Sunday Pick'em", note: 'Not picked yet', aria: "Make your NYG at PHI pick in Sunday Pick'em, not picked yet" }, { label: 'Thursday Night Regulars', note: 'Not picked yet', aria: 'Make your NYG at PHI pick in Thursday Night Regulars, not picked yet' }], phone: true })}
${k.playCard({ kind: 'draft', name: 'Draft room open', league: 'Thursday Night Regulars', detail: 'Round 1, you pick 7th', lockDay: 'Live', lockTime: 'now', lockNote: 'If your clock runs out, autopick covers your turn.', cta: 'Open draft room', state: 'open', aria: 'Round 1 is under way, you pick 7th', phone: true })}
<div style="padding: 12px 4px 4px; border-top: 2px solid {{t.rule}}; display: flex; flex-direction: column; gap: 8px">
<h3 style="margin: 0; ${k.px(12, '{{t.dim}}')}">On the sideline</h3>
<p style="margin: 0; font-size: 14px; color: {{t.dim}}">Nothing else is due tonight.</p>
</div>
</div>
</section>`;

const notes = k.notes([
  "The play-select frame holds two cards, one per action: tonight's pick, then the draft. Tonight's game is one grouped picks card with a foot link per pick'em league, counted once; nothing else on this board links to picks.",
  "The earliest lock leads; a live draft never outranks a pick that locks during it. The pick locks in 38 min, so it wears the red cursor frame, the Locks-in strip with a clock and the page's one filled button. The draft card is a plain card with an outlined foot. Both run full width and stack. The cursor blinks three times, then holds.",
  '"Round 1, you pick 7th" only if the draft status carries the order; otherwise "The draft room is open." Join requests do not show once the draft has started: a fantasy league takes new members only before its draft.',
]);

const body = `<main style="padding: 24px 16px 48px; display: flex; flex-direction: column; gap: 28px">
${head}
${plays}
${notes}
</main>`;

k.write(out, 'DraftNightPhone.dc.html', k.page({ title: 'Draft night, phone', w: 390, h: +process.env.H || 1520, body }));
console.log('ok');
