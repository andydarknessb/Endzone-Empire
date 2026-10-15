// Commissioner console, in season, Week 7. Cursor on the first pending join request; Waivers & Trades tab open with unsaved changes.
const k = require('./league-kit-samples');
const out = process.argv[2];
const LG = 'Thursday Night Regulars';

const head = `<section aria-labelledby="h1" style="display: flex; flex-direction: column; gap: 8px; min-width: 0">
${k.breadcrumb([LG], 'Commissioner')}
${k.h1('Commissioner console')}
<div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px 24px">
<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px"><span style="font-size: 17px; color: {{t.dim}}">${LG} · times in CDT</span>${k.chip('Week 7 · In season')}${k.chip('Commissioners · 2')}</div>
${k.btnGhost('Advance to Week 8')}
</div>
</section>`;

const facts = [['Transactions', 'Open'], ['Teams locked', '9 of 12'], ['Trade deadline', 'Week 10'], ['Waivers', 'FAAB · 48 hours'], ['Trade review', '24h'], ['Roster', '9 starters'], ['Scoring', 'Half PPR']];
const tiles = `<section aria-label="League settings at a glance" style="display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 12px">${facts.map(([l, v]) => `<div style="${k.FRAME}; padding: 12px; box-sizing: border-box; display: flex; flex-direction: column; gap: 4px; min-width: 0"><span style="font-size: 13px; color: {{t.dim}}">${l}</span><span style="font-size: 16px; font-weight: 600">${v}</span></div>`).join('')}</section>`;

const req = (name, handle, first) => {
  const row = `<div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px"><div style="display: flex; align-items: center; gap: 12px; min-width: 0">${k.avatar(name, { size: 40 })}<div><div style="font-size: 16px; font-weight: 600">${name}</div><div style="font-size: 14px; color: {{t.dim}}">${handle}</div></div></div><div style="display: flex; gap: 8px">${first ? k.btnFill('Approve', { tag: 'button', aria: `Approve ${name}` }) : k.btnGhost('Approve', { aria: `Approve ${name}` })}${k.btnGhost('Deny', { aria: `Deny ${name}` })}</div></div>`;
  return first ? `<li style="padding: 12px 20px 8px">${k.cursorRow(row)}</li>` : `<li style="padding: 8px 20px 12px"><div style="padding: 8px; border: 4px solid transparent">${row}</div></li>`;
};
const joins = `<section aria-labelledby="jr-h" style="${k.FRAME}">
${k.frameHead(`${k.h2('jr-h', 'Join requests')}${k.chip('Needs you')}${k.meta('2 pending', 'margin-left: auto')}`)}
<ul style="list-style: none; margin: 0; padding: 0">${req('Taylor Brooks', 'tbrooks21', true)}${req('Jordan Reyes', 'jreyes88', false)}</ul>
</section>`;

// Waivers & Trades: the real form. Trade review is changed to League Vote and not yet saved; the fact tile above still shows the saved value.
const cards = h => h.replace('minmax(220px, 1fr)', 'minmax(170px, 1fr)');
const TABS = ['General Settings', 'Roster Settings', 'Scoring Settings', 'Playoffs &amp; Schedule', 'Waivers &amp; Trades', 'System Overrides'];
const unsaved = k.unsavedMarker();
const tabs = k.tabs({ label: 'Commissioner Tools', id: 'ct', items: TABS.map((t, i) => ({ label: i === 4 ? t + unsaved : t, selected: i === 4 })) });
const panel = `<div role="tabpanel" aria-labelledby="ct-4" style="padding: 24px 20px; display: flex; flex-direction: column; gap: 24px">
<div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px 40px; align-items: start">
<div style="display: flex; flex-direction: column; gap: 20px; min-width: 0">
${cards(k.radioCards({ legend: 'Waiver System Type', name: 'ws', options: [{ value: 'faab', label: 'FAAB (Bidding)', checked: true }, { value: 'rolling', label: 'Rolling Priority' }] }))}
${k.toggle({ id: 'cw', label: 'Continuous waivers (players clear immediately, no waiting period)', on: false })}
${k.select({ id: 'wcp', label: 'Waiver Clear Period', options: [{ value: '24', label: '24 hours' }, { value: '48', label: '48 hours' }, { value: '72', label: '72 hours' }], value: '48', w: 240 })}
</div>
<div style="display: flex; flex-direction: column; gap: 20px; min-width: 0">
${cards(k.radioCards({ legend: 'Trade Review System', name: 'tr', options: [{ value: 'veto', label: 'Commissioner Veto' }, { value: 'vote', label: 'League Vote', checked: true }, { value: 'instant', label: 'Instant Process' }] }))}
${k.field({ id: 'vv', label: 'Votes needed to veto', type: 'number', value: '4', w: 160 })}
</div>
</div>
<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px 16px; padding-top: 16px; border-top: 2px solid {{t.rule}}"><span style="display: inline-flex; align-items: center; gap: 8px; font-size: 14px; color: {{t.dim}}"><span aria-hidden="true" style="width: 10px; height: 10px; background: {{t.ink}}"></span>Unsaved changes on this tab</span><span style="margin-left: auto">${k.btnGhost('Save Waiver Rules')}</span></div>
</div>`;
const tools = `<section aria-labelledby="ct-h" style="${k.FRAME}">
${k.frameHead(k.h2('ct-h', 'Commissioner Tools'))}
<div style="padding: 16px 20px 0">${tabs}</div>
${panel}
</section>`;

const notes = k.notes([
  'One cursor: the first pending join request. Its Approve is the page\'s one filled green action; Deny, the second request\'s buttons, Advance to Week 8 and Save Waiver Rules are all ghost. With no pending requests ("No pending join requests.") the cursor has no row and nothing on the page is filled.',
  'Unsaved marker: a square on the Waivers &amp; Trades tab (screen readers hear "Unsaved changes") and a repeat beside Save Waiver Rules. Trade Review is changed to League Vote and not yet saved. Leaving the tab asks "Discard unsaved changes?" with Keep editing and Discard.',
  'Destructive actions (Remove a team, Start New Season) live under the General Settings tab, so they are not on this tab. Their confirm dialogs ("Remove {team}?") carry their own filled button because the modal blocks the page.',
  'The six tabs are the Commissioner Tools tabs as shipped; the other five panels use the same field, select, toggle, radio card and stepper pieces from the kit. A pick\'em-only league shows only General and Season.',
]);

const body = `<main style="max-width: 1280px; margin: 0 auto; padding: 40px 32px 64px; display: flex; flex-direction: column; gap: 32px">
${head}
${tiles}
${joins}
${tools}
${notes}
</main>`;

k.write(out, 'Commissioner.dc.html', k.page({ title: 'Commissioner console, in season', w: 1440, h: 2200, body }));
console.log('ok');
