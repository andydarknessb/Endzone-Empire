// Main (in season, before Sunday kickoffs) at 390 wide.
const P = require('./league-dash-parts');
const { k, LG } = P;
const out = process.argv[2];
const ph = { phone: true };

const head = k.phHead({ title: LG, chips: ['Week 7 · In season'], phone: true });

const cards = [P.SHARED_MAIN, P.WAIVERS];
const move = P.yourMove(cards, { phone: true });

const versus = P.versusPanelPhone(P.VERSUS_PRE);
const myTeam = P.myTeamPhone(P.MYTEAM_PRE);

const pickem = P.pickemPanel(P.PICKEM_PRE, true);
const recap = P.recapPhone(P.RECAP);

const tile = (a, b, pct) => k.aroundTile({ a: { name: a[0], fig: a[1] }, b: { name: b[0], fig: b[1] }, pct, aria: `${a[0]} against ${b[0]}, projected ${a[1]} to ${b[1]}, ${pct}% win probability for ${a[0]}` });
const around = P.aroundPhone({
  tiles: [tile(['Blitz Brigade', '118.2'], ['Bench Mob', '96.4'], 78), tile(['Waiver Wolves', '109.9'], ['Dynasty Dads', '101.3'], 63), tile(['Gridiron Ghosts', '107.1'], ['Hail Mary Club', '105.3'], 54), tile(['Pocket Aces', '103.1'], ['Fumble Rooskie', '99.8'], 59), tile(['Red Zone Rejects', '97.5'], ['Practice Squad', '88.2'], 68)],
  count: '5 matchups · win probability · Endzone Forecast', tail: 'Projected · Game Center', tailAria: 'Projected scores, open Game Center',
  moreLabel: 'All matchups in Game Center', moreAria: 'Open Game Center, all Week 7 matchups',
});

const standings = P.standingsPhone({ data: P.standingsData, viewer: 2, cutAfter: 6, fold: true });
const activity = P.activityPhone(P.FEED);
const playbook = P.playbookLink(P.PLAYBOOK_MAIN, P.AWARDS.length, true);
const chat = `<div style="display: flex; justify-content: flex-end; padding: 14px 14px 0 0">${k.chatButton({ unread: 3 })}</div>`;

const notes = k.notes([
  'Phone: one column, 16px gutters, no page side-scroll. Your move stacks the lead card (Lineup and picks: one cursor, one foot per action, only "Set lineup" filled, since both lock Sun ' + P.D.FIRST_LOCK + ') over a compact Waivers card (name, lock, foot). The badge counts the cards.',
  'Standings keep rank, team and W-L-T in view; PF, PA and STRK scroll inside the table box. Around the league is a scroller of fixed-width tiles inside its frame. Both scrollers are keyboard-focusable regions.',
  'Pixel type: h1 24px, h2 16px, scores 24px, names and lock times 16px. Every target is 44px or taller. Folds: Standings show the viewer row, two teams either side and the playoff line, then Full standings; Recent activity shows 3 rows; the Playbook and the trophy case are one link row. The Pick&#39;em panel follows My team.',
]);

const body = `<main style="width: 390px; box-sizing: border-box; padding: 24px 16px 48px; display: flex; flex-direction: column; gap: 24px">
${head}
${move}
${versus}
${myTeam}
${pickem}
${recap}
${around}
${standings}
${activity}
${playbook}
${chat}
${notes}
</main>`;

k.write(out, 'MainPhone.dc.html', k.page({ title: 'League dashboard, in season, phone', w: 390, h: 4000, body, phone: true }));
console.log('ok');
