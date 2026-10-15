const k = require('./kit');
const out = process.argv[2];

const head = `<section aria-labelledby="h1" style="display: flex; flex-direction: column; gap: 12px">
${k.h1('Welcome back, andy1234', { phone: true })}
<p style="margin: 0; font-size: 15px; color: {{t.dim}}">Week 6 · Wednesday, Oct 14 · Picks are open in 2 leagues.</p>
</section>`;

const row = (text, sub, last) => `<li style="border-bottom: ${last ? 0 : '2px solid {{t.rule}}'}"><a href="#" style="display: block; padding: 12px 0; text-decoration: none"><div style="font-weight: 600">${text}</div><div style="font-size: 14px; color: {{t.dim}}">${sub}</div></a></li>`;

const plays = `<section aria-labelledby="plays-h" style="${k.FRAME}">
${k.frameHead(`${k.h2('plays-h', 'Call your plays', { phone: true })}${k.badge(1, 'plays')}${k.meta('Earliest lock first · times in CDT · updated just now', 'flex-basis: 100%')}`, { phone: true })}
<div style="padding: 12px; display: flex; flex-direction: column; gap: 12px">
${k.playCard({ kind: 'picks', name: 'Week 6 picks', league: '2 leagues · 14 games', lockDay: 'Thu', lockTime: '7:15 PM', lockNote: 'First game locks in 26 hours. Each game locks at its own kickoff.', cta: 'Make picks', aria: 'Make picks in 2 leagues, first lock Thursday 7:15 PM', state: 'next', actions: [{ label: "Sunday Pick'em", note: '0 of 14 made', aria: "Make picks in Sunday Pick'em, 0 of 14 made" }, { label: 'Thursday Night Regulars', note: '0 of 14 made', aria: 'Make picks in Thursday Night Regulars, 0 of 14 made' }], phone: true })}
<div style="padding: 12px 4px 0; border-top: 2px solid {{t.rule}}; display: flex; flex-direction: column; gap: 12px">
<h3 style="margin: 0; ${k.px(12, '{{t.dim}}')}">On the sideline</h3>
<div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; padding: 12px 0; border-top: 2px solid {{t.rule}}; border-bottom: 2px solid {{t.rule}}">
<div><div style="font-weight: 600">1 waiver claim pending</div><div style="font-size: 14px; color: {{t.dim}}">Thursday Night Regulars · clears Thu 2:00 AM</div></div>
${k.link('View claims', 'View your waiver claims in Thursday Night Regulars')}
</div>
<p style="margin: 0; font-size: 14px; color: {{t.dim}}">Nothing else is due before Thursday's kickoff.</p>
</div>
</div>
</section>`;

const tnr = k.leaguePanel({
  phone: true, id: 'lg-tnr', name: 'Thursday Night Regulars',
  body: `<div><div style="font-size: 15px; font-weight: 600">4-1 · 2nd of 10</div><div style="font-size: 14px; color: {{t.dim}}">vs Gridiron Ghosts · kicks off Thu 7:15 PM</div></div>
${k.sides('105.9', { name: 'Gridiron Ghosts', score: '98.4' }, { size: 20 })}
${k.oddsBar(64)}
<div style="font-size: 15px">Lineup set</div>`,
  links: k.leagueLinks('Thursday Night Regulars', ['Matchup', 'Lineup', 'Picks', 'Waivers']),
});
const office = k.leaguePanel({
  phone: true, id: 'lg-office', name: 'Office League',
  body: `<div><div style="font-size: 15px; font-weight: 600">2-3 · 8th of 12</div><div style="font-size: 14px; color: {{t.dim}}">vs Fourth and Long · kicks off Thu 7:15 PM</div></div>
${k.sides('98.2', { name: 'Fourth and Long', score: '101.5' }, { size: 20 })}
${k.oddsBar(46)}
<div style="font-size: 15px">Lineup set</div>`,
  links: k.leagueLinks('Office League', ['Matchup', 'Lineup', 'Waivers']),
});
const pickem = k.leaguePanel({
  phone: true, id: 'lg-pickem', name: "Sunday Pick'em",
  body: `<div><div style="font-size: 15px; font-weight: 600">Confidence pick'em</div><div style="font-size: 14px; color: {{t.dim}}">12 managers · season standings</div></div>
<div style="display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap"><span style="${k.px(24)}; line-height: 1.2">4th</span><span style="font-size: 15px; color: {{t.dim}}">of 12 · 412 points</span></div>
<div style="font-size: 14px; color: {{t.dim}}">1st place has 447 points. Week 5 earned you 71.</div>`,
  links: k.leagueLinks("Sunday Pick'em", ['Picks']),
});

const leagues = `<section aria-labelledby="leagues-h" style="display: flex; flex-direction: column; gap: 12px">
<div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 16px">${k.h2('leagues-h', 'My leagues', { phone: true })}${k.help({ phone: true })}</div>
<div style="display: flex; flex-direction: column; gap: 16px">${tnr}${office}${pickem}</div>
</section>`;

const news = `<section aria-labelledby="news-h" style="${k.FRAME}">
${k.frameHead(k.h2('news-h', 'League news', { phone: true }), { phone: true })}
<ul style="list-style: none; margin: 0; padding: 4px 14px 12px">
${row('Your waiver claim for Woody Marks went through.', 'Thursday Night Regulars · Oct 14')}
${row('A Week 5 stat correction changed 2 scores.', 'Thursday Night Regulars · Oct 13')}
${row('Gridiron Ghosts and Blitz Brigade made a trade.', 'Thursday Night Regulars · Oct 12', true)}
</ul>
</section>`;

const columns = `<section aria-labelledby="col-h" style="${k.FRAME}">
${k.frameHead(k.h2('col-h', 'Columns', { phone: true }), { phone: true })}
<div style="padding: 14px; display: flex; flex-direction: column; gap: 16px">
<article style="display: flex; flex-direction: column; gap: 6px">
<p style="margin: 0; font-size: 18px; font-weight: 600; line-height: 1.35">Woody Marks, Germie Bernard and Jameis Winston lead the Week 6 wire.</p>
<div style="font-size: 14px; color: {{t.dim}}">Waiver Wire · Andy Darkness · Oct 13 · 15 min read</div>
<div style="margin-left: -10px">${k.link('Read the Waiver Wire column', 'Read the Week 6 Waiver Wire column')}</div>
</article>
<article style="padding-top: 16px; border-top: 2px solid {{t.rule}}">
<p style="margin: 0; font-size: 15px; color: {{t.dim}}"><b style="color: {{t.ink}}; font-weight: 600">The Darkness Report.</b> Week 6 calls publish Thursday, before the first kickoff, and are scored the following Tuesday.</p>
</article>
</div>
</section>`;

const alerts = `<section aria-labelledby="alerts-h" style="${k.FRAME}; padding: 14px; display: flex; flex-direction: column; gap: 12px">
<div style="display: flex; flex-direction: column; gap: 6px"><h2 id="alerts-h" style="margin: 0; ${k.px(12)}">Get alerts on this device</h2><p style="margin: 0; font-size: 15px; color: {{t.dim}}">Score changes, big plays and lineup problems, sent to this device even when the app is closed.</p></div>
<div style="display: flex; flex-wrap: wrap; gap: 8px">${k.btnGhost('Turn on alerts')}${k.btnQuiet('Not now', { aria: 'Not now, hide the alerts offer' })}</div>
</section>`;

const join = `<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px">${k.btnGhost('Join a league', { tag: 'a' })}${k.btnGhost('Create a league', { tag: 'a' })}</div>`;

const notes = k.notes([
  "Same content as the desktop board, in one column: greeting, Call your plays, My leagues, Columns, alerts, then Join a league and Create a league side by side just above these notes. The grouped picks card runs full width with a foot link per league; On the sideline and League news sit under it.",
  "The three league panels stack. League links run Matchup, Lineup, Picks, Waivers and keep only the ones the league has. Sunday Pick'em ranks by points, never a W-L record.",
  'Times in CDT and the one updated stamp live in the plays frame header. The earliest lock leads; a live draft never outranks a pick that locks during it. The cursor frame blinks three times, then holds; reduced motion skips the blink.',
]);

const body = `<main style="padding: 24px 16px 48px; display: flex; flex-direction: column; gap: 28px">
${head}
${plays}
${leagues}
${news}
${columns}
${alerts}
${join}
${notes}
</main>`;

k.write(out, 'MainPhone.dc.html', k.page({ title: 'Home, game week (phone)', w: 390, h: +process.env.H || 3360, body }));
console.log('ok');
