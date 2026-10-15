const k = require('./kit');
const out = process.argv[2];

const head = `<section aria-labelledby="h1" style="display: flex; flex-wrap: wrap; gap: 16px 24px; align-items: flex-end; justify-content: space-between">
<div style="display: flex; flex-direction: column; gap: 12px; min-width: 0">
${k.h1('Welcome back, andy1234')}
<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px"><p style="margin: 0; font-size: 17px; color: {{t.dim}}">Week 6 · Sunday, Oct 18 · 1 thing needs you before the 3:25 PM kickoff.</p>${k.liveChip('2 matchups live')}</div>
</div>
<div style="display: flex; gap: 12px">${k.btnGhost('Join a league', { tag: 'a' })}${k.btnGhost('Create a league', { tag: 'a' })}</div>
</section>`;

const plays = `<section aria-labelledby="plays-h" style="${k.FRAME}">
${k.frameHead(`${k.h2('plays-h', 'Call your plays')}${k.badge(1, 'plays')}${k.meta('times in CDT', 'margin-left: auto')}`)}
<div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; padding: 12px">
<div style="grid-column: span 2">${k.playCard({ kind: 'lineup', name: '1 starter is out', league: 'Office League', lockDay: 'Sun', lockTime: '3:25 PM', lockNote: 'Puka Nacua (WR) is Out and still in your lineup.', cta: 'Fix lineup', aria: 'Fix your Office League lineup: Puka Nacua is Out, kickoff 3:25 PM', state: 'urgent', lead: true, countdown: 'in 42 min' })}</div>
<div style="grid-column: span 2; padding: 12px 12px 12px 20px; border-left: 2px solid {{t.rule}}; display: flex; flex-direction: column; gap: 12px">
<h3 style="margin: 0; ${k.px(12, '{{t.dim}}')}">On the sideline</h3>
<p style="margin: 0; font-size: 15px">Nothing else needs you today. Every other lineup and pick is set.</p>
</div>
</div>
</section>`;

const live = `<section aria-labelledby="live-h" style="display: flex; flex-direction: column; gap: 16px">
<div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 24px">${k.h2('live-h', 'Live scores')}${k.help()}${k.meta('updated 1 min ago · refreshes every minute', 'margin-left: auto')}</div>
<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px">
${k.scoreTile({ scored: true, league: 'Thursday Night Regulars', aria: 'Thursday Night Regulars matchup: you lead Gridiron Ghosts 87.4 to 71.2, up 16.2, 78% win probability. 4 of your players and 2 of theirs remain. Picks this week 1-1, all 14 in', you: '87.4', opp: { name: 'Gridiron Ghosts', score: '71.2' }, youLeads: true, status: '4-1 · 2nd of 10', youNote: '4 players remaining', oppNote: '2 players remaining', margin: 'Up 16.2', pct: 78, extra: '<div style="font-size: 14px; color: {{t.boardDim}}">Picks this week 1-1, all 14 in</div>' })}
${k.scoreTile({ league: 'Office League', aria: 'Office League matchup: you trail Fourth and Long 64.0 to 78.9, down 14.9, 41% win probability. 6 of your players and 3 of theirs remain', you: '64.0', opp: { name: 'Fourth and Long', score: '78.9' }, youLeads: false, status: '2-3 · 8th of 12 · 1 starter Out', links: ['Lineup', 'Waivers'], youNote: '6 players remaining', oppNote: '3 players remaining', margin: 'Down 14.9', pct: 41 })}
${k.pickemTile({ league: "Sunday Pick'em", aria: "Sunday Pick'em picks: 23 points this week, 2 of 14 games final, 4th of 12 this season", figure: '23', figureLabel: 'points this week', standing: '4th of 12 this season', note: '2 of 14 games final. The rest lock as each game kicks off.' })}
</div>
</section>`;

const notes = k.notes([
  "When a live score changes on refresh, its score block flashes three beats, then holds. With reduced motion it holds a steady highlight for 1 second instead. The Thursday Night Regulars tile shows the flash on load as a specimen.",
  "Order on game day: greeting and status line (with the live chip beside it), the play-select frame, then Live scores. The one play card is the lineup problem: under 1 hour to kickoff it turns Flag Red with a clock and carries the page's one filled button. The cursor blinks three times, then holds.",
  'The frame head holds "times in CDT"; the Live scores head holds the only "updated" stamp. With nothing due, the frame shrinks to one line: "Nothing needs you right now."',
  'The scoreboard is black in both themes. The leading score is white and the trailing one is board-dim; "Up 16.2" and "Down 14.9" say the lead in words, so brightness never works alone. Live chips are accent green; Flag Red is only urgency and errors.',
  "Each tile is one league: the name, its status line, the score block (the link to the Matchup) and the league's other links, in order Lineup, Picks, Waivers, only the ones the league has. There is no separate My leagues list on game day.",
  "The pick'em tile ranks by points, never a W-L record: \"23 points this week\", \"2 of 14 games final\", \"4th of 12 this season\". The Thursday Night Regulars tile shows its straight-up record (\"1-1\") because that pick'em is not Confidence. Week points and records need live pick results (Contract B).",
  "The stamp is plain text, not a live region. Offline, the page says \"You're offline. Showing scores from 1:42 PM.\" On the sideline is one line when nothing else is due, so the frame is only as tall as the play card.",
]);

const body = `<main style="max-width: 1240px; margin: 0 auto; padding: 40px 32px 64px; display: flex; flex-direction: column; gap: 40px">
${head}
${plays}
${live}
${notes}
</main>`;

k.write(out, 'GameDay.dc.html', k.page({ title: 'Home, game day', w: 1440, h: 1540, body }));
console.log('ok');
