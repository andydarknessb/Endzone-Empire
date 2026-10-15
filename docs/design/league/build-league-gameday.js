// Dashboard on game day: Sunday Week 7, 2:40 PM CDT, games live. Viewer is the commissioner of Thursday Night Regulars.
const P = require('./league-dash-parts');
const { k, LG } = P;
const out = process.argv[2];

const head = k.phHead({ title: LG, chips: ['Week 7 · In season'], live: '4 matchups live', right: P.INVITE });

const cards = [P.SHARED_LIVE, P.WAIVERS];
const move = P.yourMove(cards);

// Game day order: head, Your move, live versus, My team, Commissioner strip, then the rest.
const commissioner = P.commissionerFrame();
const versus = k.versusLive(P.LIVE_VS);
const myTeam = k.myTeamWide(P.MYTEAM_LIVE);
const pickem = P.pickemPanel(P.PICKEM_LIVE);
const recap = k.recapPanel(P.RECAP);

const tiles = P.AROUND_LIVE.slice(0, 3).map(t => `<div>${P.boardTile(t)}</div>`).join('');
const around = `<section aria-labelledby="ar-h" style="${k.FRAME2}">
${k.frameHead(`${k.h2s('ar-h', 'Around the league')}${k.meta('3 rival matchups · win probability · Endzone Forecast', 'margin-left: auto')}${k.link('Live · Game Center', 'Live scores, open Game Center')}`)}
<div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; padding: 20px">
${tiles}
${k.aroundMore('All matchups in Game Center', 'Open Game Center, all Week 7 matchups')}
</div>
</section>`;

const FEED3 = P.FEED_LIVE.slice(0, 3);
const standings = k.standings({ data: P.standingsData, viewer: 2, cutAfter: 6 });
const activity = `<section aria-labelledby="ac-h" style="${k.FRAME2}; display: flex; flex-direction: column; min-width: 0">
${k.frameHead(`<h2 id="ac-h" style="margin: 0; ${k.px(16)}">Recent activity</h2>${k.meta(FEED3.length + ' moves')}<span style="margin-left: auto">${k.link('All activity', 'All league activity')}</span>`)}
<ul style="list-style: none; margin: 0; padding: 4px 16px 8px">${FEED3.map(([kind, team, text, time], i) => k.activityRow({ kind, team, text, time, last: i === FEED3.length - 1 })).join('')}</ul>
</section>`;
const grid = `<div style="display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr); gap: 24px; align-items: start">${standings}${activity}</div>`;

const playbook = P.playbookLink(P.PLAYBOOK_LIVE, P.AWARDS.length);

const chat = `<div style="display: flex; justify-content: flex-end; padding-top: 14px">${k.chatButton({ unread: 3 })}</div>`;

const notes = k.notes([
  'One cursor: Set lineup and Week 7 picks share the ' + P.D.NEXT_LOCK + ' lock, 45 minutes from now, so they are one card under one red cursor with a foot per action; only "Set lineup" is filled. The note names the swap and says the gain once. The lead card is wide (field band left of the text) with Waivers as a compact card stacked right. A lock under one hour keeps Your move first; when nothing is due the live screen leads (see GameDaySet). The badge counts the cards (2).',
  'Order on game day: head, Your move, the live versus screen, My team, the Commissioner strip, then recap, around the league, standings and activity, playbook and the trophy link. The versus screen is Board black with "As of 2:40 PM" under the LIVE chip (the dashboard does not poll); the two sides sit close, both names on one baseline, and the margin sits directly under the viewer score. The score block is one link and is plain Board black at rest (the score flash is a Kit specimen only). A visually hidden polite live region carries the score sentence.',
  'Fixture clock: Sun Oct 18, 2:40 PM CDT. The Pick&#39;em panel (2px tier) is a full-width row directly under My team, so the full-width rows keep their alignment. PMR reads "7 players remaining" (the expansion is in the link&#39;s accessible label). My team labels the starter figures "Pts" (live) and "Proj". The commissioner strip carries the five facts and "Advance to Week 8" disabled with its reason as text: it opens when every Week 7 game is final.',
  'Container tiers: Your move, My team and Standings keep the 6px double rule; Recap, Around the league, Commissioner and Recent activity are a 2px Rule border with a Pixel 16 heading; the Playbook and the trophy case are one link row. Around the league shows the three rival games (the teams above and below Darkness Falls) as small Board black tiles (2px) with a green Live label, then "All matchups in Game Center"; Recent activity shows 3 rows then "All activity". The lead card link "Set lineup" opens the Lineup page (there is no one-press swap).',
]);

const body = `<main style="max-width: 1280px; margin: 0 auto; padding: 40px 32px 64px; display: flex; flex-direction: column; gap: 32px">
${head}
${move}
${versus}
${myTeam}
${pickem}
${commissioner}
${recap}
${around}
${grid}
${playbook}
${chat}
${notes}
</main>`;

k.write(out, 'GameDay.dc.html', k.page({ title: 'League dashboard, game day live', w: 1440, h: 3600, body }));
console.log('ok');
