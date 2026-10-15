const k = require('./kit');
const out = process.argv[2];

// local: pixel check mark, same 12px grid as the kit icons
const check = color => `<svg width="16" height="16" viewBox="0 0 12 12" aria-hidden="true" style="flex: none"><path d="M0 5h2v2H0zM2 7h2v2H2zM4 5h2v2H4zM6 3h2v2H6zM8 1h2v2H8z" fill="${color}"/></svg>`;
const FIELD = 'min-height: 44px; box-sizing: border-box; padding: 8px 12px; border-radius: 0; background: {{t.bg}}; color: {{t.ink}}; font: inherit; font-size: 16px; letter-spacing: .08em; width: 100%';

const spec = (id, title, inner, note) => `<div style="display: flex; flex-direction: column; gap: 12px; min-width: 0">${k.h2(id, title, { phone: true })}${inner}${note ? k.meta(note) : ''}</div>`;
const banner = (icon, text, action) => `<div role="status" style="${k.FRAME}; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; gap: 8px 16px"><span style="display: flex; align-items: flex-start; gap: 12px; min-width: 0">${icon}<span>${text}</span></span><span style="flex: none">${action}</span></div>`;

const saved = spec('s-saved', 'Picks saved',
  banner(check('{{t.ink}}'), `<b style="font-weight: 700">Picks saved in Sunday Pick'em.</b> You can change each one until its game kicks off.`, k.link('Edit picks', "Edit your picks in Sunday Pick'em")),
  'Plain double frame, ink check, no accent. The play leaves Call your plays and the count and greeting update with it.');

const offline = spec('s-offline', 'Offline',
  banner(k.clock('{{t.ink}}'), '<b style="font-weight: 700">You\'re offline.</b> Showing what loaded at 6:42 PM. Picks and lineup changes need a connection.', k.btnGhost('Try again', { aria: 'Try reconnecting' })),
  'On game day the line reads "You\'re offline. Showing scores from 1:42 PM."');

const failSave = spec('s-save-fail', 'Picks failed to save',
  k.errorPanel({ title: "Couldn't save your picks", body: "Your last 3 Sunday Pick'em picks are still on this device. Try again before Thursday 7:15 PM.", retryAria: "Try saving your Sunday Pick'em picks again" }));

const leaguesErr = spec('s-leagues-err', 'Leagues failed to load',
  k.errorPanel({ title: "Couldn't load your leagues", body: 'Check your connection, then try again.', retryAria: 'Try loading your leagues again' }));

const scoresErr = spec('s-scores-err', 'Scores failed to load',
  k.errorPanel({ title: "Couldn't load live scores", body: 'Check your connection, then try again.', retryAria: 'Try loading scores again' }));

const actErr = spec('s-act-err', 'League news failed to load',
  k.errorPanel({ title: "Couldn't load league news", body: 'Check your connection, then try again.', retryAria: 'Try loading league news again' }));

const playsErr = spec('s-plays-err', 'Plays check failed',
  k.errorPanel({ title: "Couldn't check what needs you", body: 'Your leagues are below. Open each one, or try again.', retryAria: 'Try checking your plays again' }),
  'No badge and no "Nothing needs you right now": a failed check never reads as all clear. The greeting drops its second line until the check succeeds.');

const dialog = (inner) => `<div style="${k.FRAME}; padding: 16px 20px; display: flex; flex-direction: column; gap: 12px">${inner}</div>`;
// local: the disabled Join, ghost and dim until the code checks out
const joinOff = k.btnGhost('Join league').replace('<button type="button"', '<button type="button" disabled aria-disabled="true"').replace('border: 2px solid {{t.ink}}; color: {{t.ink}}', 'border: 2px solid {{t.rule}}; color: {{t.dim}}; cursor: not-allowed');
const actionsOff = `<div style="display: flex; flex-wrap: wrap; gap: 12px; justify-content: flex-end">${k.btnGhost('Cancel')}${joinOff}</div>`;
const actions = `<div style="display: flex; flex-wrap: wrap; gap: 12px; justify-content: flex-end">${k.btnGhost('Cancel')}${k.btnFill('Join league', { tag: 'button' })}</div>`;

const invalid = spec('s-invalid', 'Invalid invite code',
  dialog(`<label for="code-bad" style="font-size: 14px; font-weight: 600">Invite code</label>
<input id="code-bad" value="K7Q-2MY" aria-invalid="true" aria-describedby="code-bad-err" style="${FIELD}; border: 2px solid {{t.danger}}">
<div id="code-bad-err" style="display: flex; align-items: flex-start; gap: 8px; font-size: 14px; color: {{t.danger}}">${k.warn('{{t.danger}}')}<span>That code doesn't match a league. Check it with your commissioner.</span></div>
${actionsOff}`),
  'The input takes a red 2px border and aria-invalid; the message is tied to it with aria-describedby. Join stays disabled (disabled and aria-disabled) until the code checks out; Cancel stays available.');

const join = spec('s-join', 'Join check',
  dialog(`<label for="code-ok" style="font-size: 14px; font-weight: 600">Invite code</label>
<input id="code-ok" value="K7Q-2MX" style="${FIELD}; border: 2px solid {{t.dim}}">
<div role="status" style="display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 2px solid {{t.rule}}">${check('{{t.ink}}')}<span><b style="font-weight: 700">Gridiron Gang</b> · fantasy + pick'em · 8 of 12 teams</span></div>
${actions}`),
  'The code is checked as you type; the league you are about to join shows before you commit.');

const skelCard = `<div style="padding: 8px; border: 4px solid transparent"><div style="display: flex; flex-direction: column; gap: 14px; padding: 16px; background: {{t.panel}}; border: 2px solid {{t.rule}}">
${k.skel('96px', 48)}
<div style="display: flex; flex-direction: column; gap: 8px">${k.skel('70%', 20)}${k.skel('50%', 14)}</div>
<div style="display: flex; flex-direction: column; gap: 8px">${k.skel('40%', 14)}${k.skel('80%', 14)}</div>
${k.skel('100%', 40)}
</div></div>`;
const loadPlays = spec('s-load-plays', 'Loading, play-select frame',
  `<section aria-label="Loading your plays" aria-busy="true" style="${k.FRAME}">
${k.frameHead(`<span aria-hidden="true">${k.skel('200px', 20)}</span>${k.skel('28px', 28)}<span style="margin-left: auto">${k.skel('240px', 14)}</span>`)}
<div aria-hidden="true" style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; padding: 12px"><div style="grid-column: span 2">${skelCard}</div><div style="grid-column: span 2; padding: 12px 12px 12px 20px; display: flex; flex-direction: column; gap: 12px">${k.skel('40%', 16)}${k.skel('90%', 14)}${k.skel('70%', 14)}</div></div>
</section>`,
  "Four skeleton cards in the real card shape, so nothing jumps when they fill. The greeting's second line waits for them.");

const loadLeague = spec('s-load-league', 'Loading, league panel',
  `<article aria-label="Loading a league" aria-busy="true" style="${k.FRAME}; display: flex; flex-direction: column">
<div aria-hidden="true" style="padding: 12px 16px; border-bottom: 2px solid {{t.rule}}">${k.skel('55%', 18)}</div>
<div aria-hidden="true" style="padding: 16px; display: flex; flex-direction: column; gap: 16px">
<div style="display: flex; flex-direction: column; gap: 8px">${k.skel('45%', 16)}${k.skel('75%', 14)}</div>
<div style="display: flex; justify-content: space-between">${k.skel('72px', 32)}${k.skel('72px', 32)}</div>
${k.skel('100%', 12)}
${k.skel('50%', 16)}
</div>
<div aria-hidden="true" style="border-top: 2px solid {{t.rule}}; padding: 12px 16px; display: flex; gap: 16px">${k.skel('64px', 20)}${k.skel('48px', 20)}${k.skel('48px', 20)}</div>
</article>`);

const grid = `<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 32px 24px; align-items: start">
${saved}${offline}
${failSave}${leaguesErr}
${scoresErr}${actErr}
${invalid}${join}
${playsErr}${loadLeague}
<div style="grid-column: span 2">${loadPlays}</div>
</div>`;

const notes = k.notes([
  'Every error is the same component: red double frame, role="alert", Try again with its own aria-label. Only the title, body and retry label change. Every title starts "Couldn\'t", and no body claims anything the app cannot know.',
  'Saved and offline are status banners, not alerts: they do not steal focus. Both wear the plain frame, never green.',
  'Edit picks goes to the Picks page, so it is a link. Try again, Cancel and Join league act in place, so they are buttons. Green appears only on the one filled button in a specimen.',
  'A failed check never reads as all clear. Skeletons are decorative (aria-hidden); the busy region carries the label.',
]);

const body = `<main style="padding: 40px 32px 64px; display: flex; flex-direction: column; gap: 32px">
<section aria-labelledby="h1" style="display: flex; flex-direction: column; gap: 8px">${k.h1('Home states')}${k.meta('Saved, offline, errors, loading and the join check · times in CDT')}</section>
${grid}
${notes}
</main>`;

k.write(out, 'States.dc.html', k.page({ title: 'Home states', w: 1105, h: Number(process.env.H || 2180), body }));
console.log('ok');
