const k = require('./kit');
const out = process.argv[2];

const head = `<section aria-labelledby="h1" style="display: flex; flex-direction: column; gap: 8px">
${k.h1('Welcome back, andy1234', { phone: true })}
<div style="display: flex; flex-direction: column; align-items: flex-start; gap: 12px"><p style="margin: 0; font-size: 15px; color: {{t.dim}}">Week 6 · Sunday, Oct 18 · 1 thing needs you before the 3:25 PM kickoff.</p>${k.liveChip('2 matchups live')}</div>
</section>`;

const plays = `<section aria-labelledby="plays-h" style="${k.FRAME}">
${k.frameHead(`${k.h2('plays-h', 'Call your plays', { phone: true })}${k.badge(1, 'plays')}${k.meta('times in CDT', 'flex-basis: 100%')}`, { phone: true })}
<div style="padding: 12px; display: flex; flex-direction: column; gap: 12px">${k.playCard({ kind: 'lineup', name: '1 starter is out', league: 'Office League', lockDay: 'Sun', lockTime: '3:25 PM', countdown: 'in 42 min', lockNote: 'Puka Nacua (WR) is Out and still in your lineup.', cta: 'Fix lineup', aria: 'Fix your Office League lineup: Puka Nacua is Out, kickoff 3:25 PM', state: 'urgent', lead: true, phone: true })}
<div style="padding: 12px 4px 4px; border-top: 2px solid {{t.rule}}; display: flex; flex-direction: column; gap: 8px">
<h3 style="margin: 0; ${k.px(12, '{{t.dim}}')}">On the sideline</h3>
<p style="margin: 0; font-size: 15px">Nothing else needs you today. Every other lineup and pick is set.</p>
</div>
</div>
</section>`;

const dim = t => `<div style="font-size: 14px; color: {{t.boardDim}}">${t}</div>`;
const scores = `<section aria-labelledby="live-h" style="display: flex; flex-direction: column; gap: 12px">
<div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 12px">${k.h2('live-h', 'Live scores')}${k.help({ phone: true })}</div>
${k.meta('updated 1 min ago · refreshes every minute')}
${k.scoreTile({ phone: true, scored: true, league: 'Thursday Night Regulars', aria: 'Thursday Night Regulars matchup: you lead Gridiron Ghosts 87.4 to 71.2, up 16.2, 78% win probability; picks this week 1-1, all 14 in', you: '87.4', opp: { name: 'Gridiron Ghosts', score: '71.2' }, youLeads: true, status: '4-1 · 2nd of 10', youNote: '4 players remaining', oppNote: '2 players remaining', margin: 'Up 16.2', pct: 78, extra: dim('Picks this week <b style="font-weight: 600; color: {{t.boardInk}}">1-1</b>, all 14 in') })}
${k.scoreTile({ phone: true, league: 'Office League', aria: 'Office League matchup: you trail Fourth and Long 64.0 to 78.9, down 14.9, 41% win probability', you: '64.0', opp: { name: 'Fourth and Long', score: '78.9' }, youLeads: false, status: '2-3 · 8th of 12 · 1 starter Out', links: ['Lineup', 'Waivers'], youNote: '6 players remaining', oppNote: '3 players remaining', margin: 'Down 14.9', pct: 41 })}
${k.pickemTile({ league: "Sunday Pick'em", aria: "Sunday Pick'em picks: 23 points this week, 2 of 14 games final, 4th of 12 this season", figure: '23', figureLabel: 'points this week', standing: '4th of 12 this season', note: '2 of 14 games final. The rest lock as each game kicks off.', phone: true })}
</section>`;

const join = `<div style="display: flex; gap: 8px; justify-content: center; flex-wrap: wrap">${k.btnGhost('Join a league', { tag: 'a', href: '#' })}${k.btnGhost('Create a league', { tag: 'a', href: '#' })}</div>`;

const notes = k.notes([
  "Same order as desktop: plays, then the scoreboard. The lineup problem is the only action, so its card is full width, red-framed with a Locks-in strip and clock (under 1 hour to kickoff) and carries the one filled button. On the sideline sits under it, in the same words as desktop.",
  'The scoreboard is black in both themes. The leading score is white, the trailing one is board-dim, and the margin says it in words ("Up 16.2"). One live chip under the greeting, one updated stamp (under Live scores), and times in CDT in the plays header.',
  "Sunday Pick'em is Confidence: this week's points and games final, then season rank, never a W-L record. Thursday Night Regulars' picks are straight-up, so \"1-1\" stands.",
  "Each tile carries its league's status and links under the score; there is no My leagues list. Join and Create sit at the bottom on a phone. Offline, the stamp reads \"You're offline. Showing scores from 1:42 PM.\"",
]);

const body = `<main style="padding: 24px 16px 48px; display: flex; flex-direction: column; gap: 28px">
${head}
${plays}
${scores}
${join}
${notes}
</main>`;

k.write(out, 'GameDayPhone.dc.html', k.page({ title: 'Game day, live (phone)', w: 390, h: +process.env.H || 2400, body }));
console.log('ok');
