// Game Center before kickoff, Sunday Oct 18 9:10 AM CDT, Week 7. Every matchup scheduled.
const k = require('./league-kit-gc');
const out = process.argv[2];
const { head, strips, grid } = k.gcBody({ live: false });
const G = k.GC;
console.log('glance', G.glanceFacts(G.MATCHUPS, 'pre').map(r => r.join(' ')).join(' | '));

const notes = k.notes([
  'One fixture (Critique 9 item 1): the five League matchups tiles read Main\'s 9:10 AM "Around the league" table (league-kit-gc.js AROUND_PRE, imported by Main, MainPhone and this board), so Blitz Brigade 118.2 over Bench Mob 96.4 at 78% and the rest match Main exactly, and each tile draws that win probability with the two-sided bar (leader in Ink, not Accent: before kickoff nothing is live; trailer outlined, both names and percents at the ends). Before kickoff a side reads "{n} starters set to play" (Critique 10 item 12), never the live count&#39;s wording: 7 for Darkness Falls, 9 for Sunday Scaries and the other teams from the fixture table (one definition: a starter whose NFL game is not final; Out starters and empty slots excluded); Week at a glance reads "Starters set to play" and sums them (100). The sync line reads "Scores synced 8:55 AM · next pass in 15 min" with non-breaking spaces. The NFL games strip ends on a cut tile. The week picker is one tab stop (Critique 10 item 10, roving tabindex: the selected week is tabindex 0, the rest -1, arrow keys move) and a closed "What the numbers mean" disclosure sits under the sync line (item 15).',
  'No cursor, no filled action, no scores and no odds bar on the hero: every matchup is Scheduled, so the figures are Proj (the Expected final of the product, renamed per the Proj ruling). Your matchup is the framed versus panel with the Scheduled chip and "Kickoff Sun 12:00 PM", and, like MatchupPre, "Projected margin · Sunday Scaries by 4.8" over the two-sided win probability bar in Ink (Critique 10 item 9; the 40% and 60% come from the dashboard&#39;s projections). The tiles are framed, not Board black, because nothing is live, and carry no Scheduled chip and no "Kicks off" line (Critique 10 item 13): the League matchups head says "All games kick off Sun 12:00 PM · projected totals · win probability · Endzone Forecast" once, and each tile carries only its figures, the bar and its two names.',
  'Before kickoff the scoring strip is not drawn (Critique 10 item 13); the Scoring feed card keeps the idle line. The NFL games strip is the shared Board-black strip at 9:10 AM: every Sunday game of the one slate with its kickoff time. The Scoring feed card holds the same idle line. Week at a glance keeps only the fact the week can answer: Starters set to play (a top score, closest game or biggest lead needs a started matchup, so those rows are left out, not zeroed).',
  'Hero footer: "No games in progress" is the product\'s gamesInProgress line; the product\'s "Next kickoff" line is left off here because "Kickoff Sun 12:00 PM" above it already says the same time (Say it once). The hero carries the lineup note above that footer with the dashboard\'s figures for 9:10 AM: "Two moves · +23.0 pts: Addison in for Puka Nacua (Out) · Spears into the empty FLEX · you&#39;d project 116.8 to 98.6" over "Locks Sun 12:00 PM" (both moves named plainly, Critique 11 item 10; the outcome leads, Critique 10 item 11; 116.8 is computed from the projections; the Out and empty facts are in the first line), with a warning pictogram instead of the lock (the lock means Locked), next to the existing ghost "Set lineup" (no cursor, no filled action). The lock is more than an hour away, so no minutes are shown. The sync line is drawn on the assumption that the week has synced before kickoff; the product omits it while the week has no sync.',
]);

const body = `<main style="max-width: 1280px; margin: 0 auto; padding: 24px 32px 64px; display: flex; flex-direction: column; gap: 24px">
${head}
${strips}
${grid}
${notes}
</main>`;
k.write(out, 'GameCenterPre.dc.html', k.page({ title: 'Game Center, before kickoff', w: 1440, h: 2426, body }));
console.log('ok');
