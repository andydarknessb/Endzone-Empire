const k = require('./kit');
const out = process.argv[2];

const head = `<section aria-labelledby="h1" style="display: flex; flex-direction: column; gap: 12px; max-width: 720px">
${k.h1('Start a league tonight')}
<p style="margin: 0; font-size: 17px; color: {{t.dim}}">Welcome, andy1234. It's Week 6 and free to play: pick fantasy, NFL pick'em, or both, send your friends the invite code, and draft as soon as they're in.</p>
</section>`;

const step = (n, title, sub, last) => `<li style="display: grid; grid-template-columns: 32px 1fr; gap: 12px; padding: 12px 0; ${last ? '' : 'border-bottom: 2px solid {{t.rule}}'}"><span style="${k.px(16, '{{t.ink}}')}">${n}</span><div><div style="font-weight: 600">${title}</div><div style="font-size: 14px; color: {{t.dim}}">${sub}</div></div></li>`;

const plays = `<section aria-labelledby="plays-h" style="${k.FRAME}">
${k.frameHead(`${k.h2('plays-h', 'Start here')}`)}
<div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; padding: 12px">
${k.playCard({ kind: 'create', name: 'Create a league', league: 'Your league, your rules', lockDay: '', lockTime: '', lockNote: "You'll be the commissioner.", cta: 'Create a league', aria: 'Invite friends and choose your format', state: 'next', lead: true })}
${k.playCard({ kind: 'join', name: 'Join with a code', league: "Your friends' league", lockDay: '', lockTime: '', lockNote: 'Paste the invite code your commissioner sent you.', cta: 'Join with a code', aria: 'Enter the invite code your commissioner sent you' })}
<div style="grid-column: span 2; padding: 12px 12px 12px 20px; border-left: 2px solid {{t.rule}}; display: flex; flex-direction: column; gap: 4px">
<h3 style="margin: 0; ${k.px(12, '{{t.dim}}')}">How it works</h3>
<ol style="list-style: none; margin: 0; padding: 0">
${step(1, 'Create the league', 'Name it, choose the format and set the size.')}
${step(2, 'Send the invite code', 'Friends join with the code you share.')}
${step(3, 'Play this week', "Fantasy leagues draft live with a pick clock. Pick'em leagues skip the draft and start picking.", true)}
</ol>
</div>
</div>
<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; padding: 4px 16px; border-top: 2px solid {{t.rule}}; font-size: 14px; color: {{t.dim}}">Not ready yet? ${k.link('Practice a mock draft', 'Practice a mock draft, no league needed')}</div>
</section>`;

const report = `<section aria-labelledby="dr-h" style="${k.FRAME}; max-width: 612px; display: flex; flex-direction: column">
${k.frameHead(k.h2('dr-h', 'Columns'))}
<div style="padding: 16px 20px; display: flex; flex-direction: column; gap: 6px">
<p style="margin: 0; font-size: 19px; font-weight: 600; line-height: 1.35">Woody Marks, Germie Bernard and Jameis Winston lead the Week 6 wire.</p>
<div style="font-size: 14px; color: {{t.dim}}">Waiver Wire · Andy Darkness · Oct 13 · 15 min read</div>
</div>
<div style="border-top: 2px solid {{t.rule}}; padding: 4px 10px">${k.link('Read the Waiver Wire column', 'Read the Week 6 Waiver Wire column')}</div>
</section>`;

const notes = k.notes([
  "Motion is 8-bit: it jumps in steps and never slides. Hover or keyboard focus moves the cursor frame to that card and clears it from the lead card, so one cursor is always on screen. Pressing a card drops it 2px under a white frame. With reduced motion the cursor still moves (a colour change), the press keeps its white frame without the drop, and nothing blinks.",
  "First run has no league panels, no sideline and no empty-plays line: the user has nothing to call yet, so the two ways in are the only play cards. There is no Join or Create button elsewhere; the cards are the way in.",
  "Create a league leads: it is the page's one filled button and wears the cursor frame. Join with a code is a plain card. Both are links to their own pages. The cards' lock-line slot is empty so nothing imitates a lock time.",
  "The promise copy (free to play, fantasy and/or pick'em, invite code, draft when friends are in) is said once, in the intro paragraph; the cards and steps say something else. No count badge: it would count choices, not things owed.",
  "The mock draft and the Waiver Wire column are public: they work without a league.",
]);

const body = `<main style="max-width: 1240px; margin: 0 auto; padding: 40px 32px 64px; display: flex; flex-direction: column; gap: 40px">
${head}
${plays}
${report}
${notes}
</main>`;

k.write(out, 'FirstRun.dc.html', k.page({ title: 'Home, first run', w: 1440, h: Number(process.env.H || 1260), body }));
console.log('ok');
