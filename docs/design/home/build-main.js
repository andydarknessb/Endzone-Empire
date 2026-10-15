const k = require('./kit');
const out = process.argv[2];

const head = `<section aria-labelledby="h1" style="display: flex; flex-wrap: wrap; gap: 16px 24px; align-items: flex-end; justify-content: space-between">
<div style="display: flex; flex-direction: column; gap: 12px; min-width: 0">
${k.h1('Welcome back, andy1234')}
<p style="margin: 0; font-size: 17px; color: {{t.dim}}">Week 6 · Wednesday, Oct 14 · Picks are open in 2 leagues.</p>
</div>
<div style="display: flex; gap: 12px">${k.btnGhost('Join a league', { tag: 'a' })}${k.btnGhost('Create a league', { tag: 'a' })}</div>
</section>`;

const row = (text, sub) => `<li style="border-bottom: 2px solid {{t.rule}}"><a href="#" style="display: block; padding: 12px 0; text-decoration: none"><div style="font-weight: 600">${text}</div><div style="font-size: 14px; color: {{t.dim}}">${sub}</div></a></li>`;

const plays = `<section aria-labelledby="plays-h" style="${k.FRAME}">
${k.frameHead(`${k.h2('plays-h', 'Call your plays')}${k.badge(1, 'plays')}${k.meta('Earliest lock first · times in CDT · updated just now', 'margin-left: auto')}`)}
<div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; padding: 12px">
<div style="grid-column: span 2">${k.playCard({ kind: 'picks', name: 'Week 6 picks', league: '2 leagues · 14 games', lockDay: 'Thu', lockTime: '7:15 PM', lockNote: 'First game locks in 26 hours. Each game locks at its own kickoff.', cta: 'Make picks', aria: 'Make picks in 2 leagues, first lock Thursday 7:15 PM', state: 'next', actions: [{ label: "Sunday Pick'em", note: '0 of 14 made', aria: "Make picks in Sunday Pick'em, 0 of 14 made" }, { label: 'Thursday Night Regulars', note: '0 of 14 made', aria: 'Make picks in Thursday Night Regulars, 0 of 14 made' }] })}</div>
<div style="grid-column: span 2; padding: 12px 12px 12px 20px; border-left: 2px solid {{t.rule}}; display: flex; flex-direction: column; gap: 12px">
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
  id: 'lg-tnr', name: 'Thursday Night Regulars',
  body: `<div><div style="font-size: 15px; font-weight: 600">4-1 · 2nd of 10</div><div style="font-size: 14px; color: {{t.dim}}">vs Gridiron Ghosts · kicks off Thu 7:15 PM</div></div>
${k.sides('105.9', { name: 'Gridiron Ghosts', score: '98.4' })}
${k.oddsBar(64)}
<div style="font-size: 15px">Lineup set</div>`,
  links: k.leagueLinks('Thursday Night Regulars', ['Matchup', 'Lineup', 'Picks', 'Waivers']),
});
const office = k.leaguePanel({
  id: 'lg-office', name: 'Office League',
  body: `<div><div style="font-size: 15px; font-weight: 600">2-3 · 8th of 12</div><div style="font-size: 14px; color: {{t.dim}}">vs Fourth and Long · kicks off Thu 7:15 PM</div></div>
${k.sides('98.2', { name: 'Fourth and Long', score: '101.5' })}
${k.oddsBar(46)}
<div style="font-size: 15px">Lineup set</div>`,
  links: k.leagueLinks('Office League', ['Matchup', 'Lineup', 'Waivers']),
});
const pickem = k.leaguePanel({
  id: 'lg-pickem', name: "Sunday Pick'em",
  body: `<div><div style="font-size: 15px; font-weight: 600">Confidence pick'em</div><div style="font-size: 14px; color: {{t.dim}}">12 managers · season standings</div></div>
<div style="display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap"><span style="${k.px(24)}; line-height: 1.2">4th</span><span style="font-size: 15px; color: {{t.dim}}">of 12 · 412 points</span></div>
<div style="font-size: 14px; color: {{t.dim}}">1st place has 447 points. Week 5 earned you 71.</div>`,
  links: k.leagueLinks("Sunday Pick'em", ['Picks']),
});

const news = `<section aria-labelledby="news-h" style="${k.FRAME}">
${k.frameHead(k.h2('news-h', 'League news'))}
<ul style="list-style: none; margin: 0; padding: 4px 20px 12px">
${row('Your waiver claim for Woody Marks went through.', 'Thursday Night Regulars · Oct 14')}
${row('A Week 5 stat correction changed 2 scores.', 'Thursday Night Regulars · Oct 13')}
${row('Gridiron Ghosts and Blitz Brigade made a trade.', 'Thursday Night Regulars · Oct 12').replace('border-bottom: 2px solid {{t.rule}}', 'border-bottom: 0')}
</ul>
</section>`;

const leagues = `<section aria-labelledby="leagues-h" style="display: flex; flex-direction: column; gap: 16px">
<div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 24px">${k.h2('leagues-h', 'My leagues')}${k.help()}</div>
<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px">${tnr}${office}${pickem}</div>
</section>`;

const lower = `<section aria-labelledby="col-h" style="${k.FRAME}">
${k.frameHead(k.h2('col-h', 'Columns'))}
<div style="padding: 16px 20px; display: flex; flex-direction: column; gap: 16px">
<article style="display: flex; flex-direction: column; gap: 6px">
<p style="margin: 0; font-size: 19px; font-weight: 600; line-height: 1.35">Woody Marks, Germie Bernard and Jameis Winston lead the Week 6 wire.</p>
<div style="font-size: 14px; color: {{t.dim}}">Waiver Wire · Andy Darkness · Oct 13 · 15 min read</div>
<div style="margin-left: -10px">${k.link('Read the Waiver Wire column', 'Read the Week 6 Waiver Wire column')}</div>
</article>
<article style="display: flex; flex-direction: column; gap: 6px; padding-top: 16px; border-top: 2px solid {{t.rule}}">
<p style="margin: 0; font-size: 15px; color: {{t.dim}}"><b style="color: {{t.ink}}; font-weight: 600">The Darkness Report.</b> Week 6 calls publish Thursday, before the first kickoff, and are scored the following Tuesday.</p>
</article>
</div>
</section>`;

const alerts = `<section aria-labelledby="alerts-h" style="${k.FRAME}; padding: 16px 20px; display: flex; flex-wrap: wrap; gap: 16px; align-items: center; justify-content: space-between">
<div style="max-width: 640px; display: flex; flex-direction: column; gap: 6px"><h2 id="alerts-h" style="margin: 0; ${k.px(12)}">Get alerts on this device</h2><p style="margin: 0; font-size: 15px; color: {{t.dim}}">Score changes, big plays and lineup problems, sent to this device even when the app is closed.</p></div>
<div style="display: flex; gap: 8px">${k.btnGhost('Turn on alerts')}${k.btnQuiet('Not now', { aria: 'Not now, hide the alerts offer' })}</div>
</section>`;

const notes = k.notes([
  "Motion is 8-bit: it jumps in steps and never slides. Hover or keyboard focus moves the cursor frame to that card and clears it from the lead card, so one cursor is always on screen. Pressing a card drops it 2px under a white frame. With reduced motion the cursor still moves (a colour change), the press keeps its white frame without the drop, and nothing blinks.",
  "Fixture on every board: Thursday Night Regulars (fantasy + pick'em, 10 teams), Office League (fantasy, 12 teams), Sunday Pick'em (Confidence, 12 managers).",
  "Call your plays holds one play card per action. Picks that share a slate are one card with a button per league, so one slate never shows twice. The earliest lock leads: it wears the cursor frame and the page's one filled button (the league that locks first, then alphabetical). A live draft never outranks a pick that locks during it. Under 1 hour a card gets a red Locks-in strip and a clock, and only the lead keeps a frame.",
  "On the sideline holds only things still pending (claims, requests). League news (things that already happened) sits under My leagues, outside the play frame. The league panels already say whether a lineup is set.",
  "The cursor frame blinks three times on load and then holds; reduced motion skips the blink. Selection never rides on colour alone: the selected card also carries the filled foot.",
  "League links always run Matchup, Lineup, Picks, Waivers and keep only the ones the league has. Confidence pick'em leagues rank by points, never a W-L record.",
]);

const body = `<main style="max-width: 1240px; margin: 0 auto; padding: 40px 32px 64px; display: flex; flex-direction: column; gap: 40px">
${head}
${plays}
${leagues}
${news}
${lower}
${alerts}
${notes}
</main>`;

k.write(out, 'Main.dc.html', k.page({ title: 'Home, game week', w: 1440, h: 2260, body }));
console.log('ok');
