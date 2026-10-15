const k = require('./kit');
const out = process.argv[2];

const label = t => `<h2 style="margin: 0; ${k.px(16)}">${t}</h2>`;
const spec = (t, inner, note = '') => `<section style="display: flex; flex-direction: column; gap: 12px; min-width: 0">${label(t)}${inner}${note ? `<p style="margin: 0; font-size: 13px; color: {{t.dim}}">${note}</p>` : ''}</section>`;

// local: result chip in the pixel face, ink for a win or a loss
const resultChip = (text, color) => `<span style="align-self: flex-start; display: inline-flex; padding: 8px 10px; border: 2px solid ${color}; color: ${color}; ${k.px(12)}; line-height: 1">${text}</span>`;

function final({ id, name, chip, chipColor, you, opp, youWon, record, sr, links, extra = '' }) {
  const trophy = youWon ? k.picto('trophy', 96, '{{t.ink}}') : '';
  return k.leaguePanel({
    id, name,
    body: `<div style="position: relative; display: flex; align-items: center; gap: 16px">${resultChip(chip, chipColor)}${trophy}<span style="${k.SR}">${sr}</span></div>
<div aria-hidden="true">${k.sides(you, opp, { size: 32, mid: 'Final', youColor: youWon ? '{{t.ink}}' : '{{t.dim}}', oppColor: youWon ? '{{t.dim}}' : '{{t.ink}}' })}</div>
<div style="font-size: 15px">${record}</div>${extra}`,
    links,
  });
}

const before = k.leaguePanel({
  id: 'lg-tnr', name: 'Thursday Night Regulars', right: 'times in CDT',
  body: `<div><div style="font-size: 15px; font-weight: 600">4-1 · 2nd of 10</div><div style="font-size: 14px; color: {{t.dim}}">vs Gridiron Ghosts · kicks off Thu 7:15 PM</div></div>
${k.sides('105.9', { name: 'Gridiron Ghosts', score: '98.4' })}
${k.oddsBar(64)}
<div style="font-size: 15px">Lineup set</div>`,
  links: k.leagueLinks('Thursday Night Regulars', ['Matchup', 'Lineup', 'Picks', 'Waivers']),
});

const liveTile = k.scoreTile({ league: 'Thursday Night Regulars', aria: 'Thursday Night Regulars matchup: you lead Gridiron Ghosts 87.4 to 71.2, up 16.2, 78% win probability. 4 of your players and 2 of theirs remain. Picks this week 1-1, all 14 in', you: '87.4', opp: { name: 'Gridiron Ghosts', score: '71.2' }, youLeads: true, status: '4-1 · 2nd of 10', youNote: '4 players remaining', oppNote: '2 players remaining', margin: 'Up 16.2', pct: 78, extra: '<div style="font-size: 14px; color: {{t.boardDim}}">Picks this week 1-1, all 14 in</div>' });

const win = final({ id: 'lg-win', name: 'Thursday Night Regulars', chip: 'Final · You won', chipColor: '{{t.ink}}', you: '112.6', opp: { name: 'Gridiron Ghosts', score: '97.0' }, youWon: true, record: 'Now 5-1, 2nd of 10.', sr: 'Final: you 112.6, Gridiron Ghosts 97.0. You won. Now 5-1, 2nd of 10.', links: k.leagueLinks('Thursday Night Regulars', ['Matchup', 'Lineup', 'Picks', 'Waivers']), extra: '<div style="font-size: 14px; color: {{t.dim}}">Picks this week 9-5</div>' });
const loss = final({ id: 'lg-loss', name: 'Office League', chip: 'Final · You lost', chipColor: '{{t.ink}}', you: '88.3', opp: { name: 'Fourth and Long', score: '104.6' }, youWon: false, record: 'Now 2-4, 9th of 12.', sr: 'Final: you 88.3, Fourth and Long 104.6. You lost. Now 2-4, 9th of 12.', links: k.leagueLinks('Office League', ['Matchup', 'Lineup', 'Waivers']) });

const notes = k.notes([
  'Four specimens of one league card. Before kickoff is the full panel with Projected scores and the win probability bar. Live on Home is the scoreboard tile from the game-day board: the score block links to the Matchup page, and the league\'s other links sit under it. The full live card (score, projected final, players remaining) lives on the Matchup page.',
  "Final panels show the winner's score in ink and the loser's in dim, the result in words in the pixel face, and a visually hidden sentence with the full result. Both chips are ink: green is only for the one filled action and live state, and a loss is not an error, so never red. A win also gets the trophy sprite beside the chip, in ink; a loss gets the chip alone. The Thursday Night Regulars win adds its pick'em line (\"Picks this week 9-5\") in dim, because that pick'em is straight-up.",
  "Final panels keep every link the league has, in the canonical order: Thursday Night Regulars shows Matchup, Lineup, Picks, Waivers; Office League shows Matchup, Lineup, Waivers. The before-kickoff panel is the Thursday Night Regulars panel from Home, its odds bar is frame-coloured because the game has not started, and its header carries \"times in CDT\".",
]);

const body = `<div style="width: 1300px; box-sizing: border-box; padding: 40px; display: flex; flex-direction: column; gap: 32px">
<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 32px 40px; align-items: start">
${spec('Before kickoff', before)}
${spec('Live on Home', liveTile, 'Same tile as the game-day board.')}
${spec('Final, win', win)}
${spec('Final, loss', loss)}
</div>
${notes}
</div>`;

k.write(out, 'MatchupCard.dc.html', k.page({ title: 'League card states', w: 1300, h: 1140, body }));
console.log('ok');
