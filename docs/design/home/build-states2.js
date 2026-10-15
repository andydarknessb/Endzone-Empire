const k = require('./kit');
const out = process.argv[2];
const TNR = 'Thursday Night Regulars';

// Local: a labelled specimen (heading plus one dim line, then the content).
const specimen = (id, title, sub, inner) => `<section aria-labelledby="${id}" style="display: flex; flex-direction: column; gap: 12px">
<div style="display: flex; flex-direction: column; gap: 4px">${k.h2(id, title)}<p style="margin: 0; font-size: 15px; color: {{t.dim}}">${sub}</p></div>
${inner}
</section>`;
const grid4 = cards => `<div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; padding: 12px">${cards}</div>`;
const sideline = inner => `<div style="grid-column: span 2; padding: 12px 12px 12px 20px; border-left: 2px solid {{t.rule}}; display: flex; flex-direction: column; gap: 12px"><h3 style="margin: 0; ${k.px(12, '{{t.dim}}')}">On the sideline</h3>${inner}</div>`;
const item = (title, sub, action) => `<div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; padding: 12px 0; border-top: 2px solid {{t.rule}}"><div><div style="font-weight: 600">${title}</div><div style="font-size: 14px; color: {{t.dim}}">${sub}</div></div>${action || ''}</div>`;
const head = (id, meta, badge) => k.frameHead(`${k.h2(id, 'Call your plays')}${badge ? k.badge(badge, 'plays') : ''}${meta ? k.meta(meta, 'margin-left: auto') : ''}`);

// Draft night: the pick leads (it locks during the draft), the draft is a plain card.
const picksCard = k.playCard({ kind: 'picks', name: "Tonight's pick", league: 'NYG at PHI · 2 leagues', lockDay: 'Thu', lockTime: '7:20 PM', countdown: 'in 38 min', lockNote: 'Your draft keeps running while you pick. 15 more games lock Sun and Mon.', cta: 'Make picks', state: 'urgent', lead: true, aria: 'Pick NYG at PHI in 2 leagues before 7:20 PM', actions: [{ label: "Sunday Pick'em", note: 'Not picked yet', aria: "Make your NYG at PHI pick in Sunday Pick'em, not picked yet" }, { label: 'Thursday Night Regulars', note: 'Not picked yet', aria: 'Make your NYG at PHI pick in Thursday Night Regulars, not picked yet' }] });
const draftCard = k.playCard({ kind: 'draft', name: 'Draft room open', league: 'Thursday Night Regulars', detail: 'Round 1, you pick 7th', lockDay: 'Live', lockTime: 'now', lockNote: 'If your clock runs out, autopick covers your turn.', cta: 'Open draft room', state: 'open', aria: 'Round 1 is under way, you pick 7th' });
const twoCards = `${picksCard}${draftCard}`;
const requests = sideline(`<p style="margin: 0; font-size: 14px; color: {{t.dim}}">Nothing else is due tonight. Join requests do not show once a league's draft has started.</p>`);
const draftNight = specimen('s-draft', 'Draft night', "Week 1 · Thursday, Sep 10. Tonight's pick locks during the draft, so it leads and holds the one filled button. It is one card with a button per league.",
  `<div style="${k.FRAME}">${head('plays-h-a', 'Earliest lock first · times in CDT · updated just now', 2)}${grid4(twoCards + requests)}</div>`);

// Draft did not auto-start: member and commissioner.
const noteBox = text => `<p style="margin: 0; font-size: 15px; color: {{t.dim}}; align-self: center">${text}</p>`;
const half = (id, label, card, text) => `<section aria-labelledby="${id}" style="${k.FRAME}">${k.frameHead(k.h2(id, label))}<div style="display: grid; grid-template-columns: 280px minmax(0, 1fr); gap: 20px; padding: 12px 20px 12px 12px">${card}${noteBox(text)}</div></section>`;
const memberCard = k.playCard({ kind: 'draft', name: 'Draft waiting', league: TNR, lockDay: 'Not started', lockTime: '', lockNote: "The draft didn't start on its own. It starts when the commissioner begins it.", cta: 'Open draft room', aria: `Open the ${TNR} draft room: waiting for the commissioner to start it`, state: 'open', lead: false });
const commCard = k.playCard({ kind: 'draft', name: 'Draft waiting on you', league: TNR, detail: '8 of 10 in the room', lockDay: 'Not started', lockTime: '', lockNote: "Your draft didn't start on its own.", cta: 'Open draft room', aria: `Open the ${TNR} draft room: your draft has not started, 8 of 10 managers are in`, state: 'next' });
const autoStart = specimen('s-auto', "Draft didn't auto-start", 'Same play card, kind draft, for the two roles. It is not live and has no lock time, so there is no clock.',
  `<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; align-items: start">${half('h-mem', 'Member', memberCard, 'A member sees "Open draft room" in an outlined foot: nothing is theirs to start.')}${half('h-com', 'Commissioner', commCard, '"Open draft room", not "Start draft": the button goes to the Draft Room, where Start Draft lives. "8 of 10 in the room" shows only if the status carries it.')}</div>`);

// FYI only: no actions, so no cards. Sideline items run full width under the empty line.
const fyiItems = `<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 32px; padding: 0 20px 12px">
${item('1 waiver claim pending', `${TNR} · clears Thu 2:00 AM`, k.link('View claims', `View your waiver claims in ${TNR}`))}
</div>`;
const fyi = specimen('s-fyi', 'Only FYI items', 'Nothing here asks for a tap. No count badge at zero, no cards, and an FYI row never takes the filled button.',
  `<div style="${k.FRAME}">${head('plays-h-c', '')}${k.emptyPlays()}<div style="padding: 0 20px 4px; border-top: 2px solid {{t.rule}}"><h3 style="margin: 12px 0 0; ${k.px(12, '{{t.dim}}')}">On the sideline</h3></div>${fyiItems}</div>`);

// Leagues failed to load: plays stay above, the error replaces the league grid.
const err = specimen('s-err', 'Leagues failed to load', "Your plays do not depend on the league grid, so they stay. The error takes the grid's place.",
  `<div style="display: flex; flex-direction: column; gap: 40px"><div style="${k.FRAME}">${head('plays-h-d', 'Earliest lock first', 2)}${grid4(twoCards + requests)}</div>
<section aria-labelledby="leagues-h" style="display: flex; flex-direction: column; gap: 16px">${k.h2('leagues-h', 'My leagues')}${k.errorPanel({ title: "Couldn't load your leagues", body: 'Check your connection, then try again.', retryAria: 'Try loading your leagues again' })}</section></div>`);

const notes = k.notes([
  "Draft night: the earliest lock leads, and a live draft never outranks a pick that locks during it. Tonight's pick is under 1 hour out, so it is one card with a button per league, a red Locks-in strip, the red cursor frame and the one filled button. The draft is a plain card with an outlined foot. The other 15 games lock Sunday and Monday.",
  'The draft card\'s lock line reads Live now. "You pick 7th" returns only if the draft status carries the order.',
  "Didn't auto-start: a draft that never started has no lock time, so the lock line says Not started. \"8 of 10 in the room\" only if the status carries it. The commissioner's card is the lead, so its foot is filled; the member's is outlined.",
  'FYI only: k.emptyPlays() with the sideline items full width below. No badge at zero. Times in CDT and the one updated stamp appear once, in the first frame header on the board.',
  'Leagues error: role="alert", red double frame, one Try again button. The title starts "Couldn\'t" and the body claims nothing the app cannot know. "Network Error" never shows.',
]);

const body = `<main style="max-width: 1240px; margin: 0 auto; padding: 40px 32px 64px; display: flex; flex-direction: column; gap: 40px">
${draftNight}
${autoStart}
${fyi}
${err}
${notes}
</main>`;

k.write(out, 'States2.dc.html', k.page({ title: 'Draft night, FYI only, leagues error', w: 1300, h: 2980, body }));
console.log('ok');
