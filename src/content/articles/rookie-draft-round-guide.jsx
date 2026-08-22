import React from 'react';
import { Box } from '@mui/material';
import {
  Lead, P, H2, H3, Quote, Link,
  Table, THead, TBody, TR, TH, TD,
} from '../../components/public/kit/Prose';

/* ---------- inline hero banner ----------
 * Self-contained dark panel, so it reads correctly in both themes and takes
 * the hero-banner exemption in scripts/check-color-literals.js (see ADR 0003).
 * Data graphics below take the opposite approach and inherit the theme.
 */
function HeroBanner() {
  const board = [];
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 12; col += 1) {
      board.push({ row, col });
    }
  }

  return (
    <Box
      component="svg"
      viewBox="0 0 800 240"
      xmlns="http://www.w3.org/2000/svg"
      sx={{
        width: '100%',
        borderRadius: 'var(--radius-md, 12px)',
        overflow: 'hidden',
        mb: 4,
        display: 'block',
      }}
      role="img"
      aria-label="Rookie Draft Guide 2026 banner"
    >
      <rect width="800" height="240" fill="#10151f" />
      <rect width="800" height="240" fill="url(#rookieFade)" />
      <defs>
        <linearGradient id="rookieFade" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1b2740" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#10151f" stopOpacity="0.2" />
        </linearGradient>
      </defs>

      {/* draft board: 12 teams across, 4 rounds down */}
      {board.map(({ row, col }) => {
        const x = 44 + col * 60;
        const y = 34 + row * 30;
        // The highlighted cards trace where this class actually goes: a couple
        // of early picks, then a long tail of late-round darts.
        const hot = (row === 0 && col === 2) || (row === 0 && col === 7)
          || (row === 2 && col === 4) || (row === 3 && col === 1) || (row === 3 && col === 9);
        return (
          <rect
            key={`${row}-${col}`}
            x={x}
            y={y}
            width="52"
            height="22"
            rx="3"
            fill={hot ? 'rgba(92, 147, 255, 0.55)' : 'rgba(255, 255, 255, 0.05)'}
            stroke={hot ? 'rgba(92, 147, 255, 0.9)' : 'rgba(255, 255, 255, 0.08)'}
            strokeWidth="1"
          />
        );
      })}

      {/* round rail */}
      {[1, 2, 3, 4].map((round, i) => (
        <text
          key={round}
          x="30"
          y={50 + i * 30}
          textAnchor="end"
          fill="rgba(255,255,255,0.3)"
          fontFamily="system-ui, sans-serif"
          fontWeight="700"
          fontSize="13"
        >
          {round}
        </text>
      ))}

      {/* scrim so the title stays legible over the board */}
      <rect x="0" y="150" width="800" height="90" fill="#10151f" opacity="0.82" />

      <text x="400" y="192" textAnchor="middle" fill="white" fontFamily="system-ui, sans-serif" fontWeight="800" fontSize="34" letterSpacing="1">ROOKIE DRAFT GUIDE</text>
      <text x="400" y="217" textAnchor="middle" fill="rgba(255,255,255,0.65)" fontFamily="system-ui, sans-serif" fontWeight="600" fontSize="14" letterSpacing="3">2026 CLASS · CAMP THROUGH PRESEASON WEEK 1</text>
      <rect x="330" y="228" width="140" height="3" rx="1.5" fill="rgba(92, 147, 255, 0.8)" />
    </Box>
  );
}
/* ---------- theme-aware data graphics ----------
 * ADR 0003: the hero above may use literals because it is a self-contained
 * panel. These sit inline in the reading column, so they take their colors
 * from the theme and cannot drift out of contrast when it changes.
 */

// Decorative: it restates the shape of the cheat sheet above it, and the table
// is the accessible source of truth. Hence aria-hidden rather than a
// paragraph-long aria-label describing data already on the page.
// Counted from SHEET rather than by hand, so the chart cannot drift out of sync
// with the table it restates. A hand-written count did exactly that.
const BAND_DEFS = [
  { label: 'Rounds 5 to 7', test: (r) => r <= 7 },
  { label: 'Rounds 8 to 10', test: (r) => r >= 8 && r <= 10 },
  { label: 'Rounds 11 to 12', test: (r) => r === 11 || r === 12 },
  { label: 'Rounds 13 to 15', test: (r) => r >= 13 },
];

function roundBands() {
  const counts = BAND_DEFS.map((d) => ({ label: d.label, count: 0 }));
  let notDrafted = 0;
  for (const row of SHEET) {
    const found = /[0-9]+/.exec(row[5]);
    const index = found ? BAND_DEFS.findIndex((d) => d.test(Number(found[0]))) : -1;
    if (index === -1) notDrafted += 1;
    else counts[index].count += 1;
  }
  return counts.concat([{ label: 'Not worth a pick', count: notDrafted }]);
}


function RoundBandChart() {
  const bands = roundBands();
  const max = Math.max(...bands.map((b) => b.count));
  return (
    <Box
      component="svg"
      viewBox="0 0 640 210"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      sx={{ width: '100%', display: 'block', my: 4, color: 'text.primary' }}
    >
      {bands.map((band, i) => {
        const y = 18 + i * 38;
        const width = (band.count / max) * 400;
        return (
          <g key={band.label}>
            <text x="0" y={y + 14} fill="currentColor" opacity="0.75" fontFamily="system-ui, sans-serif" fontSize="13" fontWeight="600">{band.label}</text>
            <rect x="140" y={y} width="400" height="20" rx="4" fill="currentColor" opacity="0.07" />
            <rect x="140" y={y} width={width} height="20" rx="4" fill="var(--accent)" opacity={i === 4 ? 0.45 : 0.9} />
            <text x={150 + width} y={y + 14} fill="currentColor" opacity="0.75" fontFamily="system-ui, sans-serif" fontSize="13" fontWeight="700">{band.count}</text>
          </g>
        );
      })}
      <text x="0" y="205" fill="currentColor" opacity="0.5" fontFamily="system-ui, sans-serif" fontSize="11">{`Where the ${SHEET.length} rookies on the cheat sheet are worth taking, by band`}</text>
    </Box>
  );
}

/* Preseason Week 1 usage. Targets and carries only, because those are complete
 * and free in the box scores; snap counts exist for a handful of players and
 * nowhere else, so they are shown where a real source published one and marked
 * "not reported" where none did. Nothing here is interpolated. */
const USAGE = [
  { name: 'De\u2019Zhaun Stribling', team: 'SF', touches: 8, kind: 'targets', yards: 63, snaps: 22 },
  { name: 'Emmett Johnson', team: 'KC', touches: 12, kind: 'carries', yards: 59, snaps: null },
  { name: 'Elijah Sarratt', team: 'BAL', touches: 7, kind: 'targets', yards: 66, snaps: 28 },
  { name: 'Jeremiyah Love', team: 'ARI', touches: 14, kind: 'touches', yards: 72, snaps: 23 },
  { name: 'Reggie Virgil', team: 'ARI', touches: 10, kind: 'targets', yards: null, snaps: null },
  { name: 'Mike Washington Jr.', team: 'LV', touches: 6, kind: 'carries', yards: 63, snaps: null },
  { name: 'Germie Bernard', team: 'PIT', touches: 5, kind: 'targets', yards: 51, snaps: null },
  { name: 'KC Concepcion', team: 'CLE', touches: 4, kind: 'touches', yards: 41, snaps: 25 },
  { name: 'Cyrus Allen', team: 'KC', touches: 5, kind: 'targets', yards: 20, snaps: null },
  { name: 'Jonah Coleman', team: 'DEN', touches: 4, kind: 'carries', yards: 24, snaps: 14 },
  { name: 'Ja\u2019Kobi Lane', team: 'BAL', touches: 3, kind: 'targets', yards: 38, snaps: null },
];

function UsageChart() {
  const max = Math.max(...USAGE.map((u) => u.touches));
  return (
    <Box sx={{ my: 4 }}>
      {USAGE.map((u) => (
        <Box key={u.name} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
          <Box sx={{ width: { xs: 116, sm: 168 }, flexShrink: 0, fontSize: '0.85rem', fontWeight: 600, color: 'text.primary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {u.name}
          </Box>
          <Box sx={{ flex: 1, minWidth: 0, height: 18, borderRadius: 'var(--radius-sm, 6px)', bgcolor: 'action.hover', position: 'relative' }}>
            <Box sx={{ width: `${(u.touches / max) * 100}%`, height: '100%', borderRadius: 'var(--radius-sm, 6px)', bgcolor: 'var(--accent)' }} />
          </Box>
          <Box sx={{ width: { xs: 96, sm: 178 }, flexShrink: 0, fontSize: '0.78rem', color: 'text.secondary', textAlign: 'right' }}>
            {u.touches} {u.kind}
            {u.yards === null ? '' : `, ${u.yards} yds`}
            {u.snaps === null ? ' · snaps n/r' : ` · ${u.snaps} snaps`}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

/* Cheat sheet. "Market" is the round implied by Fantasy Football Calculator's
 * 12-team half-PPR ADP (2,534 mock drafts, Aug 14-19 2026); "Take him" is this
 * article's call. "Off board" means absent from that half-PPR board; some of
 * those players still carry a deep full-PPR ADP, which is why the column is not
 * labelled "none". */
const SHEET = [
  [516, 'Jeremiyah Love', 'RB', 'ARI', '3', '5 to 6', 'High ankle sprain. Out for the preseason, no commitment on Week 1'],
  [277, 'Carnell Tate', 'WR', 'TEN', '7', '8 to 9', 'Zero catches on three targets in a broken Titans passing game'],
  [325, 'Jadarian Price', 'RB', 'SEA', '7', '6 to 7', 'Did not play, but back with the ones and the back ahead of him is on PUP'],
  [650, 'Jordyn Tyson', 'WR', 'NO', '9', '13, as a stash', 'Hamstring, reported at roughly two months. Open IR candidate'],
  [1432, 'Makai Lemon', 'WR', 'PHI', '10', '13 to 14', 'Chronic hamstring, and he has not been in team drills'],
  [1105, 'KC Concepcion', 'WR', 'CLE', '11', '11 to 12', 'Jet-sweep touchdown and 25 snaps, but camp reps ran with the twos'],
  [109, 'Denzel Boston', 'WR', 'CLE', '12', '10 to 11', 'Promoted to the first team as the boundary receiver'],
  [505, 'De’Zhaun Stribling', 'WR', 'SF', '12', '9 to 10', 'Seven catches on eight targets, and Ourlads gives him the slot job'],
  [815, 'Jonah Coleman', 'RB', 'DEN', '13', '13 to 14', 'Third string, but the handcuff to an injury-prone starter'],
  [283, 'Kaelon Black', 'RB', 'SF', '14', '14 to 15', 'Shanahan rates him the second-best back in the class'],
  [255, 'Ja’Kobi Lane', 'WR', 'BAL', '14', '12 to 13', 'The loudest camp in the class, in the quietest passing offense'],
  [336, 'Omar Cooper Jr.', 'WR', 'NYJ', '15', 'Undrafted', 'Second string in the slot and at risk of being passed'],
  [163, 'Mike Washington Jr.', 'RB', 'LV', '15', '13 to 14', 'Direct handcuff to the starter, 53-yard run in the opener'],
  [981, 'Fernando Mendoza', 'QB', 'LV', '17', 'Undrafted', 'First overall pick, second on his own depth chart'],
  [202, 'Kenyon Sadiq', 'TE', 'NYJ', 'Off board', 'Undrafted', 'Hernia setback cost him camp. Watch list only'],
  [1190, 'Caleb Douglas', 'WR', 'MIA', 'Off board', '14 to 15', 'Listed as a starting receiver on Miami’s first depth chart'],
  [585, 'Cyrus Allen', 'WR', 'KC', 'Off board', '15', 'Started with Rice and Worthy out, and has first-team snaps with Mahomes'],
  [957, 'Emmett Johnson', 'RB', 'KC', 'Off board', '14 to 15', 'Led all backs in the game in carries and yards'],
  [69, 'Reggie Virgil', 'WR', 'ARI', 'Off board', 'Watch list', 'Reported to lead all rookies in Week 1 targets and yards'],
  [223, 'Zachariah Branch', 'WR', 'ATL', 'Off board', 'Watch list', 'Nine yards on three touches, but the touches were schemed'],
  [899, 'Germie Bernard', 'WR', 'PIT', 'Off board', 'Watch list', 'Team-leading line, but with the backup quarterback throwing and the starters out'],
  [49, 'Elijah Sarratt', 'WR', 'BAL', 'Off board', 'Watch list', 'Six catches and a lost fumble, and Lane is getting the louder reviews'],
  [561, 'Kaden Wetjen', 'WR', 'PIT', 'Off board', 'Watch list', 'Reported 74-yard catch and run, then an ankle two days later'],
  [247, 'Barion Brown', 'WR', 'NO', 'Off board', 'Watch list', 'Direct beneficiary of the Tyson injury'],
  [201, 'Bryce Lance', 'WR', 'NO', 'Off board', 'Watch list', 'The other Tyson beneficiary, second string on the other side'],
  [1177, 'Antonio Williams', 'WR', 'WAS', 'Off board', 'Watch list', 'Second string behind McLaurin, earning limited first-team reps'],
  [1094, 'Eli Stowers', 'TE', 'PHI', 'Off board', 'Avoid', 'Third string, and the position change is going badly'],
  [368, 'Chris Brazzell II', 'WR', 'CAR', 'Off board', 'Do not draft', 'Torn LCL in July. Out for the season, on injured reserve'],
];

// Every rookie is linked from the sheet; the prose links again for the ones
// that get a full write-up.
const Row = ({ id, name, pos, team, market, take, note }) => (
  <TR>
    <TD><Link to={`/players/${id}`}>{name}</Link></TD>
    <TD>{pos}</TD>
    <TD>{team}</TD>
    <TD>{market}</TD>
    <TD><strong>{take}</strong></TD>
    <TD>{note}</TD>
  </TR>
);

const Body = () => (
  <>
    <HeroBanner />

    <Lead>
      Current through preseason Week 1, played August 13 to 15. Week 2 kicks off tomorrow, which
      means this is the last clean look you get before the picture changes again, and most redraft
      leagues are drafting inside the next two weeks. Everything below is calibrated to a 12-team,
      half-PPR, one-quarterback league.
    </Lead>
    <P>
      This is not a recap. If you want the full rundown of what happened last weekend, that is
      over in the{' '}
      <Link to="/strategy/preseason-week-1-recap">preseason Week 1 recap</Link>. This is the
      draft-day version: for every rookie worth a thought, where the market is taking him and
      where you should. One week of preseason football is a small sample, so where the evidence is
      thin, this says so rather than dressing a guess up as a read.
    </P>

    <H2>The cheat sheet</H2>
    <P>
      &quot;Market&quot; is the round implied by Fantasy Football Calculator&apos;s 12-team half-PPR
      ADP, drawn from 2,534 mock drafts run between August 14 and 19. &quot;Take him&quot; is our
      call. &quot;Off board&quot; means he does not appear on that half-PPR board at all. Six of those
      fourteen still turn up near the bottom of a deeper full-PPR board and two more on a single
      aggregator, and where this article does give one of them a round, that is what it is priced
      against. The six who appear on no
      board anywhere get a note instead of a round, because a round recommendation with nothing
      behind it is an opinion wearing a number&apos;s clothes. One more thing the table cannot say for itself: a 12-team draft is 15
      rounds, so a market round of 16 or higher means nobody is actually drafting him.
    </P>
    <Table>
      <THead>
        <TR>
          <TH>Player</TH><TH>Pos</TH><TH>Team</TH><TH>Market</TH><TH>Take him</TH><TH>Why</TH>
        </TR>
      </THead>
      <TBody>
        {SHEET.map(([id, name, pos, team, market, take, note]) => (
          <Row key={id} id={id} name={name} pos={pos} team={team} market={market} take={take} note={note} />
        ))}
      </TBody>
    </Table>
    <RoundBandChart />
    <P>
      That shape is the story of this class. Only two rookies are worth a pick before round 8, and
      the earlier of the two is unlikely to play again this preseason. Five more come off the board
      between rounds 8 and 12, eight are late-round darts, and just under half the names here are
      not worth a pick at all. Good news if you are patient, bad news if you were planning to build
      around a rookie.
    </P>

    <H2>The two picks that moved this week</H2>
    <H3>Jeremiyah Love, RB, Arizona Cardinals</H3>
    <P>
      Love is the only 2026 rookie drafted inside the top 60 picks anywhere, going at 31.6 overall
      in half-PPR. He was also excellent before he got hurt: 11 carries for 58 yards and three
      catches on three targets on 23 offensive snaps, all of it in the opener against Las Vegas.
      Then his feet got pinned on a tackle and that was his night.
    </P>
    <P>
      ESPN upgraded the diagnosis to a high ankle sprain on August 16 and reported he is unlikely
      to play again this preseason. Head coach Mike LaFleur would not commit to him for the
      September 13 opener, and &quot;would not commit&quot; is doing real work in that sentence.
      Nobody has called him an IR candidate, but nobody has called him healthy either. At a round-3
      price you are paying for a full season from a player whose Week 1 availability is an open
      question. Let someone else pay it and take him in round 5 or 6, where the discount
      covers the risk.
    </P>
    <H3>Jordyn Tyson, WR, New Orleans Saints</H3>
    <P>
      This one is simpler and more brutal. Tyson tore up camp, then pulled a hamstring in a joint
      practice with Jacksonville on August 13. The reported absence is roughly two months, carried
      independently by NFL Network and FOX Sports, which would put his return somewhere around
      Week 6. Reporting is explicit that New Orleans has to decide whether to open the season with
      him on injured reserve, which would cost him a minimum of four games.
    </P>
    <P>
      His ADP still reads 98.0, round 9. Do not trust that number. The half-PPR sample runs from
      August 14, so it only partly reflects the news, and it is falling underneath you as you read
      this. He is a round-13 stash in a league with an IR slot and a pass in a league without one.
      One caveat worth stating plainly: head coach Kellen Moore has given no timetable at all. The
      two-month figure is media projection, not a team announcement.
    </P>

    <H2>What Week 1 usage actually looked like</H2>
    <UsageChart />
    <P>
      A note on what is missing there. There is no free league-wide preseason snap-count source, so
      the snap figures come from one-off team writeups and simply do not exist for most players.
      Where you see &quot;snaps n/r&quot; it means nobody published one, not that the player barely
      played. We have not filled those gaps with estimates. Reggie Virgil&apos;s yardage is left
      blank for a different reason: two Sports Illustrated pieces on the same game put him at 107
      and at 109 yards, and we could not resolve it, so the target count is all you get.
    </P>

    <H2>Rounds 6 to 10: the three worth a real pick</H2>
    <H3>Jadarian Price, RB, Seattle Seahawks</H3>
    <P>
      Price did not play, and you should buy him anyway. He sat out the opener with lower-body
      soreness after missing about a week and a half, then on August 17 practiced fully for the
      first time in 11 days and, per the beat, generally lined up with the number one offense. Head
      coach Mike Macdonald had already called it a matter of days. Meanwhile Zach Charbonnet, the
      back listed ahead of him, is on the PUP list with a knee.
    </P>
    <P>
      Be honest about the mess in the depth-chart reporting: Ourlads has Charbonnet first with
      Price second, while CBS described Seattle&apos;s initial camp chart as Price sitting behind
      George Holani. Those cannot both be current and we could not determine which is. Under either
      reading he is no worse than second, but the Holani version means the job is not simply vacant. He is going in
      round 7 and that is roughly right, so take him at 6 or 7.
    </P>
    <H3>De&apos;Zhaun Stribling, WR, San Francisco 49ers</H3>
    <P>
      The line does the arguing: seven catches on eight targets for 63 yards on 22 snaps, which
      led every player in the game in both receptions and receiving yards, all of it in the first
      half before he was pulled. PFF is reported to have graded him the best offensive
      player on the roster that night, at 80.9. He is only the second receiver in a decade with
      seven catches inside the first 20 minutes of a preseason game.
    </P>
    <P>
      The opportunity is real but it is specific, and it is worth being precise about it because the
      easy version of this argument is wrong. San Francisco is not an empty receiver room: Ourlads
      still has Mike Evans at left receiver and Deebo Samuel Sr. at right. What opened up is the
      slot. The 49ers lost Jauan Jennings to Minnesota and ruled Ricky Pearsall out for the season
      after PCL surgery, and Christian Kirk is dealing with a calf. Ourlads now lists Stribling
      first in the slot. Shanahan is reported to be moving him off primary slot duty, which we could not confirm,
      and he is measured about the rookie generally: he noted Stribling &quot;struggled a little bit
      on the first drive.&quot; The slot listing is the load-bearing fact here, and it is the thing to
      watch if that Shanahan report firms up. Buy the role, not a scarcity story. He is going in
      round 12, and round 9 or 10 is the right price for as long as that job is his.
    </P>
    <H3>Carnell Tate, WR, Tennessee Titans</H3>
    <P>
      Tate is the class&apos;s second-most expensive rookie at 72.3, and he caught nothing. Zero
      receptions on three targets. Before you write that off as noise, note that the whole Tennessee
      passing game was a disaster that night, 12 catches on 24 targets for 139 yards with no
      touchdowns and Cam Ward going 5 of 12.
    </P>
    <P>
      His camp was genuinely excellent, including three touchdown catches from Ward in a single
      period against the top three corners, and Ourlads has him as the starting right receiver. But
      NBC Sports called it a hype-free start and projects a WR3 or WR4 with slow-start risk, which
      reads better against the evidence than the round-7 price does. Take him at 8 or 9. Note also
      that the boards disagree on him: Fantasy Football Calculator has Tate ahead of Price while
      4for4 has Price ahead, so whichever one you look at is deciding the order for you.
    </P>

    <H2>Rounds 10 to 13: where this class actually lives</H2>
    <H3>Denzel Boston, WR, Cleveland Browns</H3>
    <P>
      One catch for 15 yards looks like nothing until you notice it came on the opening drive from
      Deshaun Watson, with the starters. Boston was promoted to the first-team offense as
      Cleveland&apos;s boundary receiver during camp, and Ourlads now lists him as the starting left
      receiver ahead of Cedric Tillman. ESPN&apos;s Ben Solak was blunt about it: &quot;This guy
      has what it takes to be a WR1 in the league.&quot;
    </P>
    <P>
      He is going in round 12, and the number is soft: he was taken in only 52 of 2,534 half-PPR
      drafts, so that ADP is thin enough to move fast. Take him at 10 or 11 before it does.
    </P>
    <H3>Ja&apos;Kobi Lane, WR, Baltimore Ravens</H3>
    <P>
      ESPN&apos;s Jamison Hensley said that in 27 years covering the Ravens he had never seen a
      rookie camp quite like Lane&apos;s. Offensive coordinator Declan Doyle compared his hands to
      Michael Thomas. He backed it up with three catches on three targets for 38 yards and a
      touchdown, then watched the second half in street clothes.
    </P>
    <P>
      Two things hold him back and both are real. Ourlads still has him second string at right
      receiver behind Devontez Walker, and Baltimore simply does not throw much. Round 14 is too
      cheap for the best camp in the class. Round 12 or 13 is the price.
    </P>
    <H3>KC Concepcion, WR, Cleveland Browns</H3>
    <P>
      The most complete rookie stat line of the weekend: three catches on four targets for 27 yards,
      a 14-yard rushing touchdown on a jet sweep that was Cleveland&apos;s only score, a 31-yard
      punt return and 25 offensive snaps. Ourlads has him as the starting slot
      receiver.
    </P>
    <P>
      The complication is that ESPN&apos;s camp intel reports he has been working primarily with
      the second-team offense to maximize reps, and that his own teammate Boston is the one
      trending toward WR1. He is going in round 11, which is about right, and 12 is better. Just do not reach past his
      teammate to get him.
    </P>

    <H2>Rounds 13 to 15: darts with actual roles</H2>
    <P>
      <Link to="/players/163">Mike Washington Jr.</Link> is the direct handcuff to Las Vegas&apos;s
      starter and ran for 63 yards on six carries, including a 53-yard burst, on the back of the
      fastest 40 among backs in this class. He is going in round 15. Take him at 13 or 14, because
      handcuffs to a workhorse are the single best use of a last-round pick.
    </P>
    <P>
      <Link to="/players/1190">Caleb Douglas</Link> goes undrafted on the half-PPR board and was listed as a
      starting wide receiver on Miami&apos;s first unofficial depth chart. Jeff Hafley called him
      one of the team&apos;s most consistent players. A starting job for free is the best value on
      this page. <Link to="/players/957">Emmett Johnson</Link> led every back in his game with 12
      carries for 59 yards and had a touchdown wiped out by penalty; Andy Reid singled him out, and
      he is third string behind Kenneth Walker III and Emari Demercado, with a real chance to pass
      Demercado by Week 1. <Link to="/players/585">Cyrus Allen</Link>
      {' '}started the opener with Rashee Rice and Xavier Worthy out, has earned first-team snaps
      with Patrick Mahomes, and was ESPN&apos;s
      pick as the Day 3 rookie star of camp. All three go undrafted in a 12-team half-PPR league.
    </P>
    <P>
      <Link to="/players/815">Jonah Coleman</Link> managed only four carries for 24 yards on 14
      snaps, but Sean Payton pulled him early and explained he &quot;didn&apos;t need additional
      evidence of what I&apos;ve been seeing for three weeks,&quot; which is a compliment rather
      than a demotion. He is third string behind an injury-prone starter, which is exactly what a
      round-13 handcuff looks like.
    </P>
    <P>
      And a fade in this range: <Link to="/players/1432">Makai Lemon</Link> is going in round 10 and
      has not been in team drills. Reporting counts the current hamstring as his third in roughly 17
      months, one Philadelphia beat writer has argued it is fair to doubt he starts early in the
      season, and no timetable has
      been given. Ourlads still lists him as the starting slot receiver, which is the only thing
      propping that ADP up. Round 13 or 14, and only if you can afford to wait on him.
    </P>

    <H2>Undrafted fliers and the watch list</H2>
    <P>
      None of these appear on the half-PPR board this article prices against, and the few who do
      surface in deeper full-PPR drafts go past pick 170. They cost you nothing but
      a roster spot or a waiver claim.{' '}
      <Link to="/players/69">Reggie Virgil</Link> is reported to have led every rookie in Week 1
      targets and receiving yards, and he is second string at right receiver in Arizona as a
      fifth-rounder.{' '}
      <Link to="/players/899">Germie Bernard</Link> put up four catches for 51 yards and led
      Pittsburgh in targets, though the honest caveat is that he did it with Mason Rudolph throwing
      while DK Metcalf and Michael Pittman Jr. sat.{' '}
      <Link to="/players/223">Zachariah Branch</Link> gained nine yards on three touches, and the
      touches are the point: Atlanta manufactured targets, a carry and a return for him.
    </P>
    <P>
      <Link to="/players/49">Elijah Sarratt</Link> caught six of seven for 66 yards on 28 snaps and
      also lost a fumble, and one Ravens outlet already reads Lane as having won the rookie receiver battle between
      them, though the number three job is unsettled.{' '}<Link to="/players/561">Kaden Wetjen</Link>
      {' '}reportedly caught two passes for 79 yards, including a 74-yard catch and run and a short
      touchdown, then turned an ankle at practice two days later.{' '}
      <Link to="/players/247">Barion Brown</Link> and{' '}
      <Link to="/players/201">Bryce Lance</Link> are both direct beneficiaries of the Tyson injury
      and both are reported to be on track for the 53.{' '}
      <Link to="/players/1177">Antonio Williams</Link> is earning limited first-team reps behind
      Terry McLaurin and Stefon Diggs. Watch all of them. Draft none of them.
    </P>

    <H2>The names that are not 2026 rookies</H2>
    <P>
      This is the trap that will cost you a pick. Preseason coverage lumps young players together,
      and a surname on its own tells you nothing about the year. Before you spend a pick on a name because someone called him a rookie, check
      the year.
    </P>
    <P>
      Jonathon Brooks and MarShawn Lloyd both entered in <strong>2024</strong>. Matthew Golden, Cam
      Ward, Oronde Gadsden II and Ashton Jeanty all entered in <strong>2025</strong>. None of them
      is a 2026 rookie, and none of them should be priced like one. The nastiest version of this is a
      shared surname: Mike Washington Jr. is the 2026 fourth-rounder in Las Vegas, while Malik
      Washington is a 2024 receiver in Miami and Parker Washington is a 2023 receiver in
      Jacksonville. They are three different people and only one of them is on this page.
    </P>

    <H2>The bottom line</H2>
    <P>
      This is not a class you build a team around, and the people who evaluate them for a living
      said so early. CBS Sports&apos; Dave Richard opened his dynasty rookie roundtable in May by
      asking how one might politely describe the 2026 class before concluding &quot;this
      isn&apos;t the year to transform your Dynasty league team into a juggernaut.&quot; His
      colleague R.J. White called it &quot;pretty mediocre outside of the top 10 Fantasy
      picks.&quot; In fairness, that view is not unanimous: ESPN&apos;s post-draft roundtable
      declined to render any overall verdict and pointed to trench depth instead.
    </P>
    <P>
      What that means at your draft is simple. Only one rookie belongs on your board before round 6, and
      he has a bad ankle. Three more are worth a real pick between rounds 6 and 10. Everything
      else is a late-round decision, which is
      exactly where you should be shopping anyway. Take Stribling and Boston earlier than the
      market says, take the handcuffs at the end, and let somebody else pay round 7 for a receiver
      who has not caught a pass.
    </P>
    <P>
      One last thing, and it matters more than any single ranking here. Everything above rests on
      one preseason game. Week 2 starts tomorrow, and by Sunday night some of it will be wrong.
      Draft from the roles, not from the box scores.
    </P>
    <Quote>
      When the sample is one game, buy the depth chart and the injury report, not the stat line.
    </Quote>
  </>
);

export default Body;
