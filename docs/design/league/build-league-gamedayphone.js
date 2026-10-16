// GameDay at 390 wide, with the League Chat drawer open over the bottom of the page.
const P = require('./league-dash-parts');
const { k, LG } = P;
const out = process.argv[2];
const ph = { phone: true };

const head = k.phHead({ title: LG, chips: ['Week 7 · In season'], live: '6 matchups live', phone: true });

const cards = [P.SHARED_LIVE, P.WAIVERS];
const move = P.yourMove(cards, { phone: true });

const versus = P.versusLivePhone(P.LIVE_VS);
const myTeam = P.myTeamPhone(P.MYTEAM_LIVE);
const commissioner = P.commissionerFrame(true, true);
const pickem = P.pickemPanel(P.PICKEM_LIVE, true);
const recap = P.recapPhone(P.RECAP);
const around = P.aroundPhone({
  tiles: P.AROUND_LIVE.slice(0, 3).map(P.boardTile), count: '3 rival matchups · win probability · Endzone Forecast', tail: 'Live · Game Center', tailAria: 'Live scores, open Game Center',
  moreLabel: 'All matchups in Game Center', moreAria: 'Open Game Center, all Week 7 matchups', tileW: 260,
});
const standings = P.standingsPhone({ data: P.standingsData, viewer: 2, cutAfter: 6, fold: true });
const activity = P.activityPhone(P.FEED_LIVE);
const playbook = P.playbookLink(P.PLAYBOOK_LIVE, P.AWARDS.length, true);
const chat = `<div style="display: flex; justify-content: flex-end; padding: 14px 14px 0 0">${k.chatButton({ unread: 3 })}</div>`;

// The drawer is a full-width modal on a phone. The scrim covers the last 844px of the page, the height of the viewport it would fill.
const drawer = `<div style="position: absolute; left: 0; right: 0; bottom: 0; height: 844px; background: {{t.scrim}}; display: flex; align-items: flex-end; padding: 16px; box-sizing: border-box">
${k.chatDrawer({ phone: true, messages: [
  { team: 'Gridiron Ghosts', time: '1:58 PM', text: 'Late window picks lock at 3:25, do not forget.' },
  { team: 'Sunday Scaries', time: '2:20 PM', text: 'Darkness Falls, enjoy the lead while it lasts.' },
  { team: 'Darkness Falls', time: '2:24 PM', text: `${P.D.LIVE_TOTALS.meLeft} players left on my side. We will see.`, you: true },
  { team: 'Waiver Wolves', time: '2:36 PM', text: 'That was a wild finish in the early games.' },
] })}
</div>`;

const notes = k.notes([
  'The chat drawer is a full-width modal on a phone: a 6px double Frame on a Field scrim, League Chat in Pixel 16, messages in Archivo, a "Message" composer with Send, and "Close chat" as a 44px square. The scrim here covers the bottom 844px of the page, the area the drawer would fill in a phone viewport.',
  'Your own message wears a Play-blue bar. Under the drawer the page is the game-day dashboard: Lineup and picks (both lock ' + P.D.NEXT_LOCK + ') holds the one red cursor and the one filled button, "Set lineup"; "Make picks" is its second, outlined foot. The card carries no swap note: every bench player is locked at 2:40 PM, so the Forecast has no suggestion and it shows the lineup status instead. The matchup is the Board-black versus screen with "As of 2:40 PM" under the LIVE chip. The Pick&#39;em panel and the commissioner strip follow My team; the Invite control lives in that strip, not the head. Standings, activity and Playbook use the same phone folds as Main. Advance week is disabled with its reason, and the facts are desktop only.',
]);

const product = `<div style="position: relative">
<main style="width: 390px; box-sizing: border-box; padding: 24px 16px 48px; display: flex; flex-direction: column; gap: 24px">
${head}
${move}
${versus}
${myTeam}
${pickem}
${commissioner}
${recap}
${around}
${standings}
${activity}
${playbook}
${chat}
</main>
${drawer}
</div>
<div style="width: 390px; box-sizing: border-box; padding: 0 16px 48px">${notes}</div>`;

k.write(out, 'GameDayPhone.dc.html', k.page({ title: 'League dashboard, game day, phone, chat open', w: 390, h: 5145, body: product, phone: true }));
console.log('ok');
