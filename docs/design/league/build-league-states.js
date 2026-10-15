// States reference sheet in the Play-select world: loading, failed read, widget errors, empties, member vs commissioner head, Copied.
const k = require('./league-kit-samples');
const out = process.argv[2];
const LG = 'Thursday Night Regulars';
const { px, FRAME, frameHead, h2, meta, skel, errorPanel, btnGhost, warn, checkIcon } = k;

const cap = (t, sub) => `<div style="display: flex; flex-direction: column; gap: 2px; margin-bottom: 12px"><span style="font-size: 14px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase">${t}</span>${sub ? `<span style="font-size: 13px; color: {{t.dim}}">${sub}</span>` : ''}</div>`;
const section = (id, title, sub, inner) => `<section aria-labelledby="${id}" style="display: flex; flex-direction: column; min-width: 0"><div id="${id}">${cap(title, sub)}</div>${inner}</section>`;
const demoH = t => `<div role="heading" aria-level="2" style="${px(32)}; line-height: 1.3; overflow-wrap: break-word">${t}</div>`;
const status = t => `<p style="margin: 0; font-size: 17px; color: {{t.dim}}">${t}</p>`;

// ---- A. page loading ----
const skelRows = n => Array.from({ length: n }, (_, i) => `<div style="display: flex; align-items: center; gap: 12px; height: 44px; ${i < n - 1 ? 'border-bottom: 2px solid {{t.rule}}' : ''}">${skel('28px', 28)}${skel('34%', 16)}<span style="flex: 1"></span>${skel('48px', 16)}</div>`).join('');
const skelFrame = (hw, rows) => `<div style="${FRAME}; min-width: 0">${frameHead(skel(hw, 24))}<div style="padding: 8px 20px 12px">${skelRows(rows)}</div></div>`;
const loading = `<div aria-busy="true" role="status" aria-label="Loading league" style="display: flex; flex-direction: column; gap: 24px">
<div style="display: flex; flex-direction: column; gap: 12px">${skel('520px', 40)}${skel('340px', 20)}</div>
<div style="${FRAME}">${frameHead(skel('180px', 24))}<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; padding: 12px">${[0, 1, 2].map(() => `<div style="padding: 8px; border: 4px solid transparent"><div style="display: flex; flex-direction: column; gap: 12px; padding: 12px; background: {{t.skel}}; height: 168px; box-sizing: border-box; opacity: .6"></div></div>`).join('')}</div></div>
<div style="display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr); gap: 24px">${skelFrame('160px', 5)}${skelFrame('200px', 5)}</div>
</div>`;

// ---- B. League unavailable ----
const unavailable = `<div style="display: flex; flex-direction: column; gap: 16px; align-items: flex-start">
${demoH('League unavailable')}
<div role="alert" style="display: flex; align-items: center; gap: 10px; font-size: 17px">${warn('{{t.danger}}')}We could not load this league right now.</div>
${btnGhost('Try again')}
</div>`;

// ---- C. widget error panels (exact research copy) ----
const err = (title, body, aria) => errorPanel({ title, body, retryAria: aria });
const errors = `<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px">
${err('Standings', 'We could not load the standings right now.', 'Try loading the standings again')}
${err('Week 7 Matchup', "We could not load this week's matchup right now.", 'Try loading the matchup again')}
${err('Recent activity', 'We could not load recent activity right now.', 'Try loading recent activity again')}
${err('My team', 'We could not load your team summary right now.', 'Try loading your team summary again')}
</div>`;

// ---- D. empty states ----
const empty = (id, title, text, extra = '') => `<section aria-labelledby="${id}" style="${FRAME}; min-width: 0">${frameHead(h2(id, title, { phone: true }), { phone: true })}<div style="padding: 24px 20px; display: flex; flex-direction: column; gap: 8px"><p style="margin: 0; font-size: 16px; font-weight: 600">${text}</p>${extra}</div></section>`;
const empties = `<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; align-items: start">
${empty('em1', 'Week 7 Matchup', 'No matchup this week')}
${empty('em2', 'Recent activity', 'No moves yet this season.')}
${empty('em3', 'Trophy room', 'No trophies for this season yet')}
</div>`;

// ---- E. member vs commissioner head ----
const inviteBtn = (copied = false) => `<button type="button" aria-label="${copied ? 'Invite link copied' : 'Copy invite link, code TNR-7K4Q'}" style="min-height: 44px; display: inline-flex; align-items: center; gap: 10px; padding: 0 16px; box-sizing: border-box; border-radius: 0; background: transparent; border: 2px solid {{t.ink}}; color: {{t.ink}}; font-family: inherit; font-size: 15px; font-weight: 600">${copied ? `${checkIcon()}Copied` : `Invite <span style="font-weight: 600; letter-spacing: .08em; font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace">TNR-7K4Q</span>`}</button>`;
const headDemo = (who, withInvite) => `<div style="display: flex; flex-direction: column; gap: 12px; padding: 20px; border: 2px dashed {{t.rule}}; box-sizing: border-box; min-width: 0"><span style="font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: {{t.dim}}">${who}</span><div style="display: flex; flex-direction: column; gap: 12px; align-items: flex-start">${demoH(LG)}<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px">${k.chip('Week 7 · In season')}<p style="margin: 0; font-size: 17px; color: {{t.dim}}">Times in CDT</p></div>${withInvite ? inviteBtn() : ''}</div></div>`;
const heads = `<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px">${headDemo('Member', false)}${headDemo('Commissioner', true)}</div>`;

// ---- F. copy-invite ----
const copied = `<div style="display: flex; flex-wrap: wrap; gap: 32px; align-items: flex-start"><div style="display: flex; flex-direction: column; align-items: flex-start; gap: 8px">${cap('Ready')}${inviteBtn()}</div><div style="display: flex; flex-direction: column; align-items: flex-start; gap: 8px">${cap('After tap, for 2 seconds')}${inviteBtn(true)}<span role="status" style="font-size: 13px; color: {{t.dim}}">Announced to screen readers as "Invite link copied"</span></div></div>`;

const notes = k.notes([
  'Skeleton blocks use the Skel colour, are square and do not animate, so reduced motion needs no extra path. The loading head and frames keep the layout of the real page, with aria-busy set.',
  'Errors use the Danger double rule with the warning icon, and Try again is a ghost button. A failed widget never takes the page down: only the widget read fails. League unavailable replaces the whole page.',
  'Copied is a word and a check, not a colour change. The invite control exists only for the commissioner.',
]);

const body = `<main style="max-width: 1236px; margin: 0 auto; padding: 40px 32px 64px; display: flex; flex-direction: column; gap: 48px; box-sizing: content-box">
<header style="display: flex; flex-direction: column; gap: 12px">${k.h1('States')}<p style="margin: 0; font-size: 17px; color: {{t.dim}}">${LG} · loading, failed reads, errors, empties, heads</p></header>
${section('s-a', 'Page loading', 'Skeleton blocks in Skel on the page layout, nothing else is drawn.', loading)}
${section('s-b', 'Failed read: League unavailable', 'h1, an alert sentence, Try again.', unavailable)}
${section('s-c', 'Widget error panels', 'One panel per widget, in its own frame slot.', errors)}
${section('s-d', 'Empty states', 'The widget keeps its frame and head; the sentence is the whole body.', empties)}
${section('s-e', 'Member and commissioner head', 'Same head; the Invite control is the only difference.', heads)}
${section('s-f', 'Copy invite', 'Ghost button, then Copied for 2 seconds.', copied)}
${notes}
</main>`;

k.write(out, 'States.dc.html', k.page({ title: 'States', w: 1300, h: 2400, body }));
console.log('ok');
