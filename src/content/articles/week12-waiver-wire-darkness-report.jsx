import React from 'react';
import { Box } from '@mui/material';
import {
  Lead, P, H2, H3, UL, OL, LI, Quote,
  Table, THead, TBody, TR, TH, TD,
} from '../../components/public/kit/Prose';
import { Tag } from '../../components/public/kit/ArticleBits';
import { PriorityCard, FaabLadder, OpponentChart } from './darkness-report-parts';

// Body only: the frontmatter lives in week12-waiver-wire-darkness-report.meta.js so listings can be
// built without loading this prose; content/articles/index.js loads it on demand.
//
// Every color below the hero is a theme token, so the cards, charts and chips read in light and
// dark. The hero is a dark illustration in both themes, like the Week 3 start/sit banner.

function HeroBanner() {
  // Claim cards fanned across the field: taller card, bigger bid. The Big Three are green.
  const bids = [
    { x: 150, h: 150, label: 'CROSKEY-MERRITT', fill: '#2fd97b' },
    { x: 262, h: 108, label: 'WILLIAMS', fill: '#2fd97b' },
    { x: 374, h: 82, label: 'BECH', fill: '#2fd97b' },
    { x: 486, h: 74, label: 'MENDOZA', fill: '#7eaaff' },
    { x: 598, h: 68, label: 'WATSON', fill: '#7eaaff' },
  ];
  return (
    <Box
      component="svg"
      viewBox="0 0 800 300"
      xmlns="http://www.w3.org/2000/svg"
      sx={{ width: '100%', borderRadius: 'var(--radius-md, 10px)', overflow: 'hidden', mb: 4, display: 'block' }}
      role="img"
      aria-labelledby="wk12ww-hero-title wk12ww-hero-desc"
    >
      <title id="wk12ww-hero-title">Week 12 Waiver Wire: The Darkness Report</title>
      <desc id="wk12ww-hero-desc">
        A night field under a floodlight with five glowing bid bars rising from the turf, tallest
        first: Jacory Croskey-Merritt, Antonio Williams, Jack Bech, Fernando Mendoza and Deshaun
        Watson, over the headline Week 12 Waiver Wire. The first three are the Big Three.
      </desc>
      <defs>
        <linearGradient id="wk12ww-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#060910" />
          <stop offset="0.55" stopColor="#0c1424" />
          <stop offset="1" stopColor="#161027" />
        </linearGradient>
        <radialGradient id="wk12ww-flood" cx="0.5" cy="0" r="0.85">
          <stop offset="0" stopColor="#7eaaff" stopOpacity="0.34" />
          <stop offset="1" stopColor="#7eaaff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="wk12ww-bar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="800" height="300" fill="url(#wk12ww-bg)" />
      <rect width="800" height="300" fill="url(#wk12ww-flood)" />
      {Array.from({ length: 11 }, (_, i) => (
        <line key={`yd${i}`} x1={40 + i * 72} y1="120" x2={6 + i * 79} y2="300" stroke="rgba(255,255,255,0.06)" />
      ))}
      <line x1="0" y1="206" x2="800" y2="206" stroke="rgba(255,255,255,0.12)" strokeDasharray="6 8" />
      {bids.map((b) => (
        <g key={b.label}>
          <rect x={b.x} y={206 - b.h} width="56" height={b.h} rx="8" fill={b.fill} opacity="0.2" />
          <rect x={b.x} y={206 - b.h} width="56" height={b.h} rx="8" fill="url(#wk12ww-bar)" />
          <rect x={b.x} y={206 - b.h} width="56" height="5" rx="2.5" fill={b.fill} />
          <text x={b.x + 28} y={198 - b.h} textAnchor="middle" fill={b.fill} fontFamily="system-ui, sans-serif" fontWeight="800" fontSize="11" letterSpacing="1.5">{b.label}</text>
        </g>
      ))}
      <text x="400" y="34" textAnchor="middle" fill="#8badc9" fontFamily="system-ui, sans-serif" fontWeight="700" fontSize="12" letterSpacing="4">THE DARKNESS REPORT</text>
      <rect x="120" y="222" width="560" height="64" rx="14" fill="rgba(3,8,20,0.84)" stroke="rgba(126,170,255,0.25)" />
      <text x="400" y="253" textAnchor="middle" fill="#ffffff" fontFamily="system-ui, sans-serif" fontWeight="850" fontSize="24" letterSpacing="1">WEEK 12 WAIVER WIRE</text>
      <text x="400" y="274" textAnchor="middle" fill="#8badc9" fontFamily="system-ui, sans-serif" fontWeight="600" fontSize="12" letterSpacing="3">THE BIG THREE &middot; FAAB LADDER &middot; D/ST &middot; IDP &middot; RECEIPTS</text>
    </Box>
  );
}

const BIG_THREE = [
  {
    id: 'jacory-croskey-merritt', rank: 1, name: 'Jacory Croskey-Merritt', pos: 'RB', team: 'WSH', matchup: 'at ARI',
    min: 12, max: 18, rostered: '45.5% rostered', window: 'Season', windowTone: 'var(--success)',
    take: 'Croskey-Merritt came off IR on Monday and ran 13 times for 54 yards and a TD in the 22-20 win over Cincinnati, with 2 catches for 23, worth 14.7 points. Austin Ekeler had the other 7 running back carries, and Rachaad White was active and did not have one. Washington is at Arizona as a 7.5-point favorite, implied for 25.0.',
    pro: "He is first on Washington's chart, and he had more carries than White in all four games they both played before he went on IR.",
    con: 'It is one game back, at 4.2 yards a carry, and he caught 2 passes. White (67.3% rostered) and Ekeler are both still on the roster.',
  },
  {
    id: 'antonio-williams', rank: 2, name: 'Antonio Williams', pos: 'WR', team: 'WSH', matchup: 'at ARI',
    min: 8, max: 12, rostered: '21.9% rostered', window: 'Season', windowTone: 'var(--success)',
    take: 'Williams caught 9 passes for 122 yards on 11 targets on Monday night, a 34% target share, worth 16.7 points. Two of the catches set up the winning field goal. Terry McLaurin is on IR after surgery on a torn patellar tendon, and Stefon Diggs had 6 targets in the same game.',
    pro: 'Eleven targets and a 34% share, with McLaurin on IR, at 21.9% rostered.',
    con: 'His share was 6% the week before and 18% the week before that, and he did not score. Last week I called him a touchdown trap. It is one game.',
  },
  {
    id: 'jack-bech', rank: 3, name: 'Jack Bech', pos: 'WR', team: 'LV', matchup: 'at CLE (Sun night)',
    min: 4, max: 7, rostered: '0.3% rostered', window: 'Season', windowTone: 'var(--success)',
    take: 'Bech caught 8 passes for 88 yards and a TD on 9 targets in the 38-24 loss at Denver, a 24% share after 26% the week before, worth 18.8 points. Brock Bowers was inactive with ankle and quadriceps injuries. Las Vegas is at Cleveland on Sunday night as a 4.5-point underdog, implied for 18.5.',
    pro: "Two straight games with a quarter of Fernando Mendoza's targets, at 0.3% rostered.",
    con: 'The 26% share the week before produced 2 catches for 10 yards, Tre Tucker had 10 targets in the same game and the Raiders are implied for 18.5.',
  },
];

// Bid ranges, % of a $100 budget. Big Three first, then the top of the priced board.
const LADDER = [
  ['Jacory Croskey-Merritt', 'RB', 12, 18, true],
  ['Antonio Williams', 'WR', 8, 12, true],
  ['Jack Bech', 'WR', 4, 7, true],
  ['Fernando Mendoza', 'QB', 3, 6, false],
  ['Deshaun Watson', 'QB', 3, 5, false],
  ['Justice Hill', 'RB', 3, 5, false],
  ['Kaleb Johnson', 'RB', 2, 4, false],
  ['Cam Ward', 'QB', 2, 4, false],
  ['Geno Smith', 'QB', 2, 4, false],
  ['Baker Mayfield', 'QB', 2, 4, false],
];

// Implied points for the offense each defense faces. Lower is better for the defense.
const DST_TARGETS = [
  { def: 'JAX', opp: 'TEN', pts: 16.5, kind: 'stream' },
  { def: 'LAC', opp: 'NE', pts: 17, kind: 'stream' },
  { def: 'NYG', opp: 'IND', pts: 17.5, kind: 'stream' },
  { def: 'WSH', opp: 'ARI', pts: 17.5, kind: 'stream' },
  { def: 'DEN', opp: 'PIT', pts: 17.75, kind: 'stream' },
  { def: 'MIN', opp: 'ATL', pts: 17.75, kind: 'stream' },
  { def: 'CLE', opp: 'LV', pts: 18.5, kind: 'stream' },
  { def: 'NYJ', opp: 'MIA', pts: 18.5, kind: 'stream' },
  { def: 'ARI', opp: 'WSH', pts: 25, kind: 'avoid' },
  { def: 'KC', opp: 'BUF', pts: 25.25, kind: 'avoid' },
  { def: 'BAL', opp: 'HOU', pts: 26.5, kind: 'avoid' },
  { def: 'CHI', opp: 'DET', pts: 26.5, kind: 'avoid' },
  { def: 'PHI', opp: 'DAL', pts: 28, kind: 'avoid' },
  { def: 'DET', opp: 'CHI', pts: 29, kind: 'avoid' },
  { def: 'NO', opp: 'CIN', pts: 30.25, kind: 'avoid' },
  { def: 'TEN', opp: 'JAX', pts: 31, kind: 'avoid' },
];

const Body = () => (
  <>
    <HeroBanner />
    <Lead>
      Week 11 gave Washington its running back back and gave a rookie receiver 122 yards on Monday
      night. It put Justin Herbert in the concussion protocol, and the Colts released their quarterback
      the day after losing 26-3. Nobody is on bye, and five games are played before Sunday. Last
      week&apos;s Big Three went 1 for 3. Let&apos;s spend.
    </Lead>
    <P>
      Every bid below is a percentage of a $100 FAAB budget. The league is half-PPR with one
      quarterback slot and a superflex. Rostered figures come from our own snapshot, taken early
      Tuesday. Lines are ESPN&apos;s as of Tuesday. Injury statuses are our database as of
      Tuesday with Monday&apos;s reporting layered on, and where the two disagree I trust the
      database and say so. No team is on bye, so all 32 play. Wednesday is Green Bay at the Rams at
      8:00 p.m. ET. Thanksgiving has Chicago at Detroit at 1:00, Philadelphia at Dallas at 4:30 and
      Kansas City at Buffalo at 8:20 p.m. ET. Friday is Denver at Pittsburgh at 3:00 p.m. ET. Sunday
      has the 1:00, 4:05 and 4:25 p.m. ET kickoffs, then Las Vegas at Cleveland at night. Monday night
      is Carolina at Tampa Bay. Week 11 snap counts are not in our data yet, so I quote yards,
      catches, targets, target share and points, plus carries from ESPN&apos;s box scores.
    </P>

    <H2>The Big Three</H2>
    <P>
      Croskey-Merritt for the job, Williams for the targets, Bech for the price. Two of the three are
      Commanders, and Washington is a 7.5-point favorite at Arizona. All three play on Sunday, so none
      of these claims is racing a Wednesday or Thursday kickoff.
    </P>
    {BIG_THREE.map((p) => <PriorityCard key={p.id} p={p} />)}
    <H3>Not in the Big Three: every quarterback</H3>
    <P>
      Fernando Mendoza and Deshaun Watson are fourth and fifth on the board, and four more quarterbacks
      are on it below them. In a superflex league, move every one of them up: last week&apos;s four board
      quarterbacks returned 61.6 points on bids that topped out at 8%. In a one-quarterback league, they
      are $1 streamers. The Superflex Corner below ranks them.
    </P>

    <H2>The FAAB Ladder</H2>
    <P>
      The top of the priced board on one scale. Highlighted bars are the Big Three. Anything that
      tops out at 8% or less is a cheap bid: pick a number in the range and don&apos;t lose sleep.
      Croskey-Merritt is the only bid on it above 12%.
    </P>
    <FaabLadder ladder={LADDER} />

    <H2>The Full Board</H2>
    <P>
      Window is how long the role should last. Season means no starter is coming back to take it,
      and &quot;If X sits&quot; means exactly that. Rostered% is our snapshot, so a name at 40%
      is already in two out of five leagues out there.
    </P>
    <Table aria-label="Week 12 offensive waiver board">
      <THead>
        <TR>
          <TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Team</TH><TH scope="col">Why</TH><TH scope="col">Wk 12</TH><TH scope="col">Window</TH><TH scope="col">Bid</TH><TH scope="col">Rostered%</TH>
        </TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Jacory Croskey-Merritt</strong></TD><TD>RB</TD><TD>WSH</TD><TD>13 carries for 54 and a TD in his first game off IR.</TD><TD>at ARI</TD><TD>Season</TD><TD>12&ndash;18%</TD><TD>45.5%</TD></TR>
        <TR><TD>2</TD><TD><strong>Antonio Williams</strong></TD><TD>WR</TD><TD>WSH</TD><TD>9 for 122 on 11 targets, a 34% share. McLaurin is on IR.</TD><TD>at ARI</TD><TD>Season</TD><TD>8&ndash;12%</TD><TD>21.9%</TD></TR>
        <TR><TD>3</TD><TD><strong>Jack Bech</strong></TD><TD>WR</TD><TD>LV</TD><TD>8 for 88 and a TD on 9 targets. A 24% share after 26%.</TD><TD>at CLE (Sun night)</TD><TD>Season</TD><TD>4&ndash;7%</TD><TD>0.3%</TD></TR>
        <TR><TD>4</TD><TD><strong>Fernando Mendoza</strong></TD><TD>QB</TD><TD>LV</TD><TD>267 yards and 3 TDs at Denver, worth 22.9.</TD><TD>at CLE (Sun night)</TD><TD>Season</TD><TD>3&ndash;6%</TD><TD>22.3%</TD></TR>
        <TR><TD>5</TD><TD><strong>Deshaun Watson</strong></TD><TD>QB</TD><TD>CLE</TD><TD>312 yards, 49 rushing and a rushing TD before the bye, worth 21.4.</TD><TD>vs LV (Sun night)</TD><TD>As the starter</TD><TD>3&ndash;5%</TD><TD>11.1%</TD></TR>
        <TR><TD>6</TD><TD><strong>Justice Hill</strong></TD><TD>RB</TD><TD>BAL</TD><TD>69 yards and a TD on 6 carries, plus 4 catches. 16.7 and 15.6 in two of his last three.</TD><TD>at HOU</TD><TD>Change of pace</TD><TD>3&ndash;5%</TD><TD>25.6%</TD></TR>
        <TR><TD>7</TD><TD><strong>Kaleb Johnson</strong></TD><TD>RB</TD><TD>GB</TD><TD>14 and 10 carries in Green Bay&apos;s last two games. Jacobs is listed questionable.</TD><TD>at LAR (Wed)</TD><TD>If Jacobs sits</TD><TD>2&ndash;4%</TD><TD>7.0%</TD></TR>
        <TR><TD>8</TD><TD><strong>Cam Ward</strong></TD><TD>QB</TD><TD>TEN</TD><TD>19.1 and 22.2 in his last two games.</TD><TD>at JAX</TD><TD>Season</TD><TD>2&ndash;4%</TD><TD>37.3%</TD></TR>
        <TR><TD>9</TD><TD><strong>Geno Smith</strong></TD><TD>QB</TD><TD>NYJ</TD><TD>17 of 21 with 3 TDs, worth 19.4. The Jets are favored in Miami.</TD><TD>at MIA</TD><TD>Superflex stream</TD><TD>2&ndash;4%</TD><TD>16.2%</TD></TR>
        <TR><TD>10</TD><TD><strong>Baker Mayfield</strong></TD><TD>QB</TD><TD>TB</TD><TD>2 TDs and 36 rushing yards at Detroit, worth 19.1.</TD><TD>vs CAR (Mon)</TD><TD>Superflex stream</TD><TD>2&ndash;4%</TD><TD>17.9%</TD></TR>
        <TR><TD>11</TD><TD><strong>Tai Felton</strong></TD><TD>WR</TD><TD>MIN</TD><TD>6 for 42 on 12 targets, a 28% share, with Addison out.</TD><TD>vs ATL</TD><TD>While Addison is out</TD><TD>2&ndash;4%</TD><TD>0.2%</TD></TR>
        <TR><TD>12</TD><TD><strong>Evan Engram</strong></TD><TD>TE</TD><TD>DEN</TD><TD>6 for 74 on 8 targets, a 25% share.</TD><TD>at PIT (Fri)</TD><TD>Stream</TD><TD>2&ndash;4%</TD><TD>2.5%</TD></TR>
        <TR><TD>13</TD><TD><strong>Samaje Perine</strong></TD><TD>RB</TD><TD>CIN</TD><TD>11.9 and 11.7 in his last two. Cincinnati is implied for 30.25.</TD><TD>vs NO</TD><TD>Change of pace</TD><TD>2&ndash;4%</TD><TD>16.9%</TD></TR>
        <TR><TD>14</TD><TD><strong>Chris Rodriguez Jr.</strong></TD><TD>RB</TD><TD>JAX</TD><TD>Tuten aggravated an ankle injury. Jacksonville is implied for 31.0.</TD><TD>vs TEN</TD><TD>If Tuten sits</TD><TD>2&ndash;4%</TD><TD>16.8%</TD></TR>
        <TR><TD>15</TD><TD><strong>Ted Hurst III</strong></TD><TD>WR</TD><TD>TB</TD><TD>5 for 56 and 2 TDs on 7 targets, a 23% share.</TD><TD>vs CAR (Mon)</TD><TD>Stream</TD><TD>1&ndash;3%</TD><TD>1.8%</TD></TR>
        <TR><TD>16</TD><TD><strong>Chimere Dike</strong></TD><TD>WR</TD><TD>TEN</TD><TD>6 for 69 on 7 targets, a 25% share. Robinson is out for the season.</TD><TD>at JAX</TD><TD>Season</TD><TD>1&ndash;3%</TD><TD>2.9%</TD></TR>
        <TR><TD>17</TD><TD><strong>Mike Gesicki</strong></TD><TD>TE</TD><TD>CIN</TD><TD>5 for 77 on 6 targets. Cincinnati is implied for 30.25.</TD><TD>vs NO</TD><TD>Stream</TD><TD>1&ndash;3%</TD><TD>30.8%</TD></TR>
        <TR><TD>18</TD><TD><strong>Anthony Richardson Sr.</strong></TD><TD>QB</TD><TD>IND</TD><TD>First on the Colts&apos; chart after they released Daniel Jones.</TD><TD>vs NYG</TD><TD>As the starter</TD><TD>1&ndash;3%</TD><TD>0.2%</TD></TR>
      </TBody>
    </Table>
    <P>
      Three of these bids hang on an injury report. Johnson needs Jacobs out, Felton needs Addison out
      and Rodriguez needs Tuten out. Johnson&apos;s game is Wednesday night, so that claim has to clear first.
    </P>
    <P>
      Off the board, for a dollar if your wire is thin: DJ Giddens (IND RB, 0.2%) is the back behind
      Jonathan Taylor with Seth McGowan listed out. Devaughn Vele (NO WR, 34.4%) caught 7 for 76 on 7
      targets, and the Saints are 10-point underdogs at Cincinnati. Dawson Knox (BUF TE, 7.1%) plays
      Thursday night, and Dalton Kincaid is listed questionable after no stat line against Miami. Calvin
      Ridley (TEN WR, 4.3%) caught 5 for 68 and a TD on 6 targets, his first stat line since Week 8. Tommy
      DeVito (NE QB, 0.4%) is the superflex dollar: Mike Vrabel said Monday that he is the starter.
    </P>

    <H2>Superflex Corner</H2>
    <P>
      Quarterbacks are where this format is won on the wire, so here is the ranking, with Week 11 points.
    </P>
    <UL>
      <LI>
        <strong>Fernando Mendoza</strong> (LV, 22.3% rostered) is first at 22.9, 18 of 37 for 267 yards, 3 TDs
        and an interception in his second start. Denver sacked him five times. He is at Cleveland on Sunday
        night, with the Raiders implied for 18.5.
      </LI>
      <LI>
        <strong>Deshaun Watson</strong> (CLE, 11.1%) scored 21.4 in Week 10, 25 of 40 for 312 yards and an
        interception with 49 rushing yards and a rushing TD, and then had the bye. He is first on
        Cleveland&apos;s chart and hosts Las Vegas, with the Browns implied for 23.0.
      </LI>
      <LI>
        <strong>Cam Ward</strong> (TEN, 37.3%) scored 22.2 in the 51-30 loss at Dallas, 21 of 30 for 248 yards
        and 2 TDs with a rushing TD. Tennessee is at Jacksonville as a 14.5-point underdog, implied for 16.5,
        the week&apos;s lowest total. He is a start if you need one and third here because of that number.
      </LI>
      <LI>
        <strong>Geno Smith</strong> (NYJ, 16.2%) went 17 of 21 for 176 yards and 3 TDs in the 27-24 win over the
        Chargers, worth 19.4, after 7.4 and 5.9. The Jets are 3.5-point favorites at Miami, implied for 22.0.
      </LI>
      <LI>
        <strong>Baker Mayfield</strong> (TB, 17.9%) scored 19.1 at Detroit on 187 yards, 2 TDs and 36 rushing
        yards, playing with an injured foot and right thumb. He has no injury tag in our data. Tampa Bay hosts
        Carolina on Monday night, implied for 23.25.
      </LI>
      <LI>
        <strong>Sam Darnold</strong> (SEA, 18.3%) is listed questionable. Mike Macdonald says the Seahawks still
        plan to start him at San Francisco and will make the final call after Wednesday&apos;s practice. Seattle is
        implied for 21.75.
      </LI>
      <LI>
        <strong>J.J. McCarthy</strong> (NYG, 25.0%) scored 14.2 on 18 of 38 for 173 yards and a TD, with 33 rushing
        yards. The Giants are 6.5-point favorites at Indianapolis, implied for 24.0.
      </LI>
      <LI>
        <strong>Jacoby Brissett</strong> (BAL, 13.4%) scored 13.7 on 276 yards, a TD and an interception. Baltimore
        is at Houston, implied for 20.0.
      </LI>
      <LI>
        <strong>Anthony Richardson Sr.</strong> (IND, 0.2%) is first on the Colts&apos; chart. Indianapolis released
        Daniel Jones on Friday, the day after the 26-3 loss at Houston (Stephen Holder). Richardson went 0 for 2 in
        that game, and the Colts are implied for 17.5 against the Giants. He is a stash, not a start.
      </LI>
      <LI>
        <strong>Tommy DeVito</strong> (NE, 0.4%) starts at the Chargers, with New England implied for 17.0 in the
        week&apos;s lowest total, 35.5. Same answer.
      </LI>
      <LI>
        <strong>Justin Herbert</strong> (LAC, 36.5%) scored 22.4 and then entered the concussion protocol. DJ
        Uiagalelei is second on the chart. Wait for a status.
      </LI>
      <LI>
        <strong>Avoid Aaron Rodgers</strong> (PIT, 39.0%, 16.0): it took 44 attempts and he was sacked five times.
        Pittsburgh hosts Denver on Friday, implied for 17.75.
      </LI>
      <LI>
        <strong>Avoid Kyle McCord</strong> (MIA, 1.4%, 3.0), 12 of 33 for 102 yards, and{' '}
        <strong>Joe Milton</strong> (PHI, 3.6%, 6.3), 11 of 21 for 141, with the Eagles implied for 19.5 at Dallas
        on Thursday.
      </LI>
      <LI>
        <strong>Avoid Josh Johnson</strong> (ARI, 0.5%, 10.7), Arizona&apos;s fourth starter in four games. Carson Beck
        is listed questionable, and the Cardinals are implied for 17.5.
      </LI>
      <LI>
        <strong>Daniel Jones</strong> (10.3%) is a cut. He was released.
      </LI>
    </UL>

    <H2>D/ST Streaming Board</H2>
    <P>
      The recipe never changes: a backup quarterback, a thin set of weapons, and a low implied
      total. The chart below is the implied total of the offense each defense faces. Short bar,
      happy defense. D/ST rostered percentages are not in our snapshot, so check your own wire
      before you plan around a name.
    </P>
    <OpponentChart targets={DST_TARGETS} />
    <UL>
      <LI>
        <strong>Jacksonville D/ST</strong> hosts Tennessee (16.5), the lowest implied total on the board. Dallas sacked
        Cam Ward five times. The Jaguars D/ST scored 4 and 7 the last two weeks, so this is about the opponent.
      </LI>
      <LI>
        <strong>The Chargers D/ST</strong> hosts New England (17.0) with Tommy DeVito starting. The Chargers D/ST
        scored 8 and 2 the last two weeks.
      </LI>
      <LI>
        <strong>The Giants D/ST</strong> is at Indianapolis (17.5). The Colts scored 3 points at Houston and have a
        new starting quarterback. The Giants D/ST scored 6 and 8.
      </LI>
      <LI>
        <strong>Washington D/ST</strong> is at Arizona (17.5). Kansas City sacked Josh Johnson three times and held
        the Cardinals to 7 points. The Commanders D/ST scored 5 and 5.
      </LI>
      <LI>
        <strong>Denver D/ST</strong> is at Pittsburgh (17.75) on Friday. Philadelphia sacked Aaron Rodgers five
        times. The Broncos D/ST scored 13 against Las Vegas with a 35-yard interception return for a TD.
      </LI>
      <LI>
        <strong>Minnesota D/ST</strong> hosts Atlanta (17.75). The Vikings D/ST scored 24 and then -2.
      </LI>
      <LI>
        <strong>Cleveland D/ST</strong> hosts Las Vegas (18.5) on Sunday night. Fernando Mendoza has been sacked 11
        times in two starts. The Browns D/ST scored 9 and 7 before the bye.
      </LI>
      <LI>
        <strong>The Jets D/ST</strong> is at Miami (18.5). Kyle McCord completed 12 of 33 passes for 102 yards and an
        interception at Buffalo. The Jets D/ST scored 10.
      </LI>
    </UL>
    <P>
      <strong>Avoid:</strong> Tennessee (faces Jacksonville, 31.0), New Orleans (faces Cincinnati, 30.25), Detroit (faces
      Chicago, 29.0), Philadelphia (faces Dallas, 28.0), Chicago (faces Detroit, 26.5), Baltimore (faces Houston, 26.5),
      Kansas City (faces Buffalo, 25.25) and Arizona (faces Washington, 25.0). The grey bars above are those defenses.
      The Chicago D/ST scored 17 last week, but Detroit is implied for 26.5 on Thanksgiving, so do not chase it. New
      England D/ST faces the Chargers (18.5) and is only a play if Justin Herbert is ruled out: it scored -4 and -1 in
      its last two games.
    </P>

    <H2>Kickers</H2>
    <P>
      Kicker ownership is in our snapshot. The play is a kicker on an offense that scores, and the
      best number that is widely available is Cincinnati&apos;s, at 30.25. Points are Week 10 then Week 11.
    </P>
    <Table aria-label="Week 12 kicker streamers">
      <THead>
        <TR>
          <TH scope="col">#</TH><TH scope="col">Kicker</TH><TH scope="col">Team</TH><TH scope="col">Team total</TH><TH scope="col">Rostered%</TH>
        </TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Evan McPherson</strong></TD><TD>CIN</TD><TD>30.25 vs NO; 8 and 10</TD><TD>24.4%</TD></TR>
        <TR><TD>2</TD><TD><strong>Cairo Santos</strong></TD><TD>CHI</TD><TD>29.0 at DET on Thanksgiving; bye in Week 10, 8 in Week 11</TD><TD>31.1%</TD></TR>
        <TR><TD>3</TD><TD><strong>Drew Stevens</strong></TD><TD>WSH</TD><TD>25.0 at ARI; 7 and 18</TD><TD>2.9%</TD></TR>
        <TR><TD>4</TD><TD><strong>Dominic Zvada</strong></TD><TD>NYG</TD><TD>24.0 at IND; 3 and 16</TD><TD>32.1%</TD></TR>
        <TR><TD>5</TD><TD><strong>Jason Sanders</strong></TD><TD>NYJ</TD><TD>22.0 at MIA; 14 and 11</TD><TD>24.2%</TD></TR>
      </TBody>
    </Table>
    <P>
      Jake Bates (DET, 53.2%) has the 26.5 total against Chicago on Thanksgiving and scored 5 and 9. Andre
      Szmyt (CLE, 2.7%) scored 10 before the bye, and the Browns are implied for 23.0. Joey Slye (TEN, 1.1%)
      scored 17 and 13, but the Titans are implied for 16.5. Santos and Bates lock on Thursday.
    </P>

    <H2>IDP Waiver Board</H2>
    <P>
      Lines are Week 11 box scores from our database. IDP rostered percentages are not tracked, so I can&apos;t
      tell you who is sitting on your wire. Tackle volume is the currency at linebacker and safety. Pressure is
      the currency on the line. Tennessee is a 14.5-point underdog, New Orleans is a 10-point underdog,
      Philadelphia is an 8.5-point underdog on Thursday and Arizona is a 7.5-point underdog, so those defenses
      will be on the field. Quinnen Williams is on the line board for the second week running.
    </P>
    <H3>Linebacker</H3>
    <Table aria-label="IDP linebackers">
      <THead>
        <TR><TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Team</TH><TH scope="col">Type</TH><TH scope="col">Week 11</TH><TH scope="col">Wk 12</TH></TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Jacob Rodriguez</strong></TD><TD>MIA</TD><TD><Tag kind="both" /></TD><TD>8 solo and 5 assisted tackles, an interception and a pass defended.</TD><TD>vs NYJ</TD></TR>
        <TR><TD>2</TD><TD><strong>Nakobe Dean</strong></TD><TD>LV</TD><TD><Tag kind="both" /></TD><TD>6 solo and 6 assisted tackles, a sack and 2 tackles for loss.</TD><TD>at CLE (Sun night)</TD></TR>
        <TR><TD>3</TD><TD><strong>CJ Allen</strong></TD><TD>IND</TD><TD><Tag kind="T" /></TD><TD>7 solo and 9 assisted tackles.</TD><TD>vs NYG</TD></TR>
        <TR><TD>4</TD><TD><strong>Josiah Trotter</strong></TD><TD>TB</TD><TD><Tag kind="T" /></TD><TD>8 solo and 6 assisted tackles.</TD><TD>vs CAR (Mon)</TD></TR>
        <TR><TD>5</TD><TD><strong>Jeremiah Trotter Jr.</strong></TD><TD>PHI</TD><TD><Tag kind="T" /></TD><TD>9 solo and 4 assisted tackles.</TD><TD>at DAL (Thu)</TD></TR>
        <TR><TD>6</TD><TD><strong>Jamien Sherwood</strong></TD><TD>NYJ</TD><TD><Tag kind="T" /></TD><TD>8 solo and 3 assisted tackles and a forced fumble.</TD><TD>at MIA</TD></TR>
      </TBody>
    </Table>
    <H3>Defensive line and edge</H3>
    <Table aria-label="IDP defensive line">
      <THead>
        <TR><TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Team</TH><TH scope="col">Week 11</TH><TH scope="col">Wk 12</TH></TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Boye Mafe</strong></TD><TD>DE</TD><TD>CIN</TD><TD>4 solo and 1 assisted tackle, 3 sacks and 3 tackles for loss.</TD><TD>vs NO</TD></TR>
        <TR><TD>2</TD><TD><strong>Quinnen Williams</strong></TD><TD>DT</TD><TD>DAL</TD><TD>4 solo and 1 assisted tackle, 2 sacks, 3 tackles for loss and a forced fumble.</TD><TD>vs PHI (Thu)</TD></TR>
        <TR><TD>3</TD><TD><strong>George Karlaftis</strong></TD><TD>DE</TD><TD>KC</TD><TD>3 solo and 1 assisted tackle, 2.5 sacks and a forced fumble.</TD><TD>at BUF (Thu)</TD></TR>
        <TR><TD>4</TD><TD><strong>Jeffery Simmons</strong></TD><TD>DT</TD><TD>CHI</TD><TD>3 solo and 1 assisted tackle, 3 sacks and 3 tackles for loss.</TD><TD>at DET (Thu)</TD></TR>
        <TR><TD>5</TD><TD><strong>Will Anderson Jr.</strong></TD><TD>DE</TD><TD>HOU</TD><TD>2 solo and 3 assisted tackles, a sack and 2 tackles for loss.</TD><TD>vs BAL</TD></TR>
      </TBody>
    </Table>
    <H3>Defensive back</H3>
    <Table aria-label="IDP defensive backs">
      <THead>
        <TR><TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Team</TH><TH scope="col">Type</TH><TH scope="col">Week 11</TH><TH scope="col">Wk 12</TH></TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Zayne Anderson</strong></TD><TD>S</TD><TD>MIA</TD><TD><Tag kind="both" /></TD><TD>8 solo and 4 assisted tackles, a sack, an interception and 3 passes defended.</TD><TD>vs NYJ</TD></TR>
        <TR><TD>2</TD><TD><strong>Joshua Williams</strong></TD><TD>CB</TD><TD>TEN</TD><TD><Tag kind="T" /></TD><TD>9 solo and 2 assisted tackles.</TD><TD>at JAX</TD></TR>
        <TR><TD>3</TD><TD><strong>Marcus Epps</strong></TD><TD>S</TD><TD>PHI</TD><TD><Tag kind="T" /></TD><TD>8 solo tackles and a tackle for loss.</TD><TD>at DAL (Thu)</TD></TR>
        <TR><TD>4</TD><TD><strong>Ja&apos;Quan McMillian</strong></TD><TD>CB</TD><TD>DEN</TD><TD><Tag kind="BP" /></TD><TD>4 solo and 4 assisted tackles, a forced fumble and an interception returned 35 yards for a TD.</TD><TD>at PIT (Fri)</TD></TR>
        <TR><TD>5</TD><TD><strong>Deonte Banks</strong></TD><TD>CB</TD><TD>NYG</TD><TD><Tag kind="BP" /></TD><TD>5 solo and 1 assisted tackle, an interception and 3 passes defended.</TD><TD>at IND</TD></TR>
        <TR><TD>6</TD><TD><strong>Tykee Smith</strong></TD><TD>S</TD><TD>TB</TD><TD><Tag kind="T" /></TD><TD>6 solo and 3 assisted tackles.</TD><TD>vs CAR (Mon)</TD></TR>
      </TBody>
    </Table>
    <P>
      Tackle-heavy scoring: bump the Tackles tags a tier. Big-play scoring: bump the Big play tags.
      Rodriguez, Dean and Anderson carry both.
    </P>

    <H2>The Injury Ledger</H2>
    <H3>Out or on IR</H3>
    <UL>
      <LI><strong>Drake Maye</strong> (NE QB): a fractured right fibula, listed out. He is still on the 53-man roster, not IR, and Mike Vrabel said Monday that Tommy DeVito is the starter and the Patriots are not looking outside for a quarterback.</LI>
      <LI><strong>Seth McGowan</strong> (IND RB): hamstring, listed out. Shane Steichen said he will miss some time (Stephen Holder). Giddens.</LI>
      <LI><strong>Puka Nacua</strong> (LAR WR): IR. He had surgery to repair his right MCL and is expected to miss 4-to-5 months (Adam Schefter). <strong>Davante Adams</strong> (LAR WR): IR, hamstring, with an &quot;outside chance&quot; at Week 13 and a likelier return around mid-December (Ian Rapoport). <strong>Terrance Ferguson</strong> (LAR TE): IR, and he needs season-ending ankle surgery (Sean McVay).</LI>
      <LI><strong>Lamar Jackson</strong> (BAL QB): IR, thumb. The Ravens believe &quot;there&apos;s a chance&quot; he returns in Week 16 against Cleveland (Dan Graziano). Brissett.</LI>
      <LI><strong>Wan&apos;Dale Robinson</strong> (TEN WR): IR, ankle, out for the rest of the season (Robert Saleh). Dike.</LI>
      <LI><strong>Michael Pittman Jr.</strong> (PIT WR): IR. Mike McCarthy said Monday he is &quot;very confident&quot; Pittman will be on the field Friday against Denver (Brooke Pryor).</LI>
      <LI><strong>Jeremiyah Love</strong> (ARI RB): IR, ankle. Mike LaFleur said Monday the Cardinals are still evaluating him. <strong>Michael Wilson</strong> (ARI WR): IR, neck.</LI>
      <LI><strong>Jalen Hurts</strong> (PHI QB): IR, expected to miss the rest of the season. <strong>Terry McLaurin</strong> (WSH WR): IR, surgery on a torn patellar tendon. <strong>De&apos;Von Achane</strong> (MIA RB): IR, knee. <strong>RJ Harvey</strong> (DEN RB): IR, knee. <strong>TreVeyon Henderson</strong> (NE RB): IR, illness.</LI>
      <LI><strong>Brandon Aiyuk</strong> (WR): released by San Francisco on Monday.</LI>
    </UL>
    <H3>Doubtful, questionable and day-to-day</H3>
    <UL>
      <LI><strong>Justin Herbert</strong> (LAC QB): entered the concussion protocol after Sunday&apos;s loss to the Jets and is listed questionable. Uiagalelei.</LI>
      <LI><strong>Josh Jacobs</strong> (GB RB): finger, listed questionable, limited in Monday&apos;s practice (Matt Schneidman). Green Bay plays Wednesday night. Kaleb Johnson.</LI>
      <LI><strong>Kenneth Walker III</strong> (KC RB): groin, listed questionable, a non-participant on Monday&apos;s practice estimate. Kansas City plays Thursday night. Emmett Johnson (91.1%).</LI>
      <LI><strong>Saquon Barkley</strong> (PHI RB): neck and illness, listed questionable, limited on Monday&apos;s estimate. <strong>Will Shipley</strong> (PHI RB): foot and illness, also limited. Philadelphia plays Thursday.</LI>
      <LI><strong>Bhayshul Tuten</strong> (JAX RB): aggravated a right ankle injury against the Giants and is listed questionable. Liam Coen said Monday&apos;s exam found nothing &quot;too bad&quot; (Ryan O&apos;Halloran). Rodriguez.</LI>
      <LI><strong>Brock Bowers</strong> (LV TE): ankle and quadriceps, inactive at Denver and listed questionable.</LI>
      <LI><strong>Woody Marks</strong> (HOU RB): concussion, listed questionable. DeMeco Ryans said Monday he is &quot;trending in the right direction&quot; and the Texans &quot;are hopeful to have him&quot; against Baltimore (Aaron Wilson). <strong>Marvin Harrison Jr.</strong> (HOU WR): listed questionable, with no stat line in two games.</LI>
      <LI><strong>Sam Darnold</strong> (SEA QB): quadriceps and ribs, listed questionable. The Seahawks plan to start him at San Francisco and will decide after Wednesday&apos;s practice (Brady Henderson).</LI>
      <LI><strong>Jordan Addison</strong> (MIN WR): listed doubtful after thumb surgery. Kevin O&apos;Connell said he is &quot;progressing really well&quot; but is not expected to play against Atlanta (Ben Goessling). Felton.</LI>
      <LI><strong>A.J. Brown</strong> (NE WR): hamstring, listed doubtful, not on the field for Monday&apos;s session (Doug Kyed).</LI>
      <LI><strong>Dalton Kincaid</strong> (BUF TE): thumb and ankle, listed questionable, limited on Monday&apos;s estimate, no stat line against Miami. Knox. <strong>Sam LaPorta</strong> (DET TE): ankle, listed questionable, limited at Monday&apos;s walkthrough. <strong>Jake Ferguson</strong> (DAL TE): knee and ankle, listed questionable, a non-participant on Monday&apos;s estimate. All three play Thursday.</LI>
      <LI><strong>Juwan Johnson</strong> (NO TE): hamstring, hurt at Chicago and listed questionable. Kellen Moore said Monday he is still being evaluated.</LI>
      <LI><strong>Carson Beck</strong> (ARI QB): listed questionable. Josh Johnson started at Kansas City.</LI>
      <LI><strong>Baker Mayfield</strong> (TB QB): played at Detroit with an injured foot and right thumb. No injury tag in our data.</LI>
      <LI><strong>Omar Cooper Jr.</strong> (NYJ WR): listed questionable, with no stat line in two games. <strong>Kayshon Boutte</strong> (HOU WR): hip, listed questionable.</LI>
    </UL>

    <H2>Receipts: Grading Week 11</H2>
    <P>
      Last week&apos;s board, graded in half-PPR points from our database. The hits first, and there are four.
    </P>
    <Table aria-label="Week 11 board hits">
      <THead>
        <TR><TH scope="col">Player</TH><TH scope="col">Points</TH><TH scope="col">Wk 11 bid</TH></TR>
      </THead>
      <TBody>
        <TR><TD><strong>Cam Ward</strong></TD><TD>22.2</TD><TD>5&ndash;8%</TD></TR>
        <TR><TD><strong>J.J. McCarthy</strong></TD><TD>14.2</TD><TD>2&ndash;4%</TD></TR>
        <TR><TD><strong>Jacoby Brissett</strong></TD><TD>13.7</TD><TD>2&ndash;4%</TD></TR>
        <TR><TD><strong>Bo Nix</strong></TD><TD>11.5</TD><TD>3&ndash;6%</TD></TR>
      </TBody>
    </Table>
    <P>
      All four are quarterbacks, for the second week running. Ward threw for 248 yards and 2 TDs and ran
      for a third. McCarthy threw for 173 yards and a TD and ran for 33. Brissett threw for 276 yards, a TD
      and an interception. Nix threw for 225 yards, a TD and an interception. Now the misses and the shrugs.
    </P>
    <Table aria-label="Week 11 board misses and pushes">
      <THead>
        <TR><TH scope="col">Player</TH><TH scope="col">Points</TH><TH scope="col">Wk 11 bid</TH><TH scope="col">What happened</TH></TR>
      </THead>
      <TBody>
        <TR><TD><strong>Chig Okonkwo</strong></TD><TD>8.6</TD><TD>1&ndash;3%</TD><TD>A push: 4 for 66 on 5 targets.</TD></TR>
        <TR><TD><strong>Elic Ayomanor</strong></TD><TD>4.2</TD><TD>2&ndash;4%</TD><TD>3 for 27. Tate played.</TD></TR>
        <TR><TD><strong>Caleb Douglas</strong></TD><TD>4.0</TD><TD>1&ndash;2%</TD><TD>2 for 30 on 10 targets.</TD></TR>
        <TR><TD><strong>Emari Demercado</strong></TD><TD>3.9</TD><TD>1&ndash;2%</TD><TD>5 carries for 33. Montgomery had 26 carries.</TD></TR>
        <TR><TD><strong>Tre&apos; Harris</strong></TD><TD>3.8</TD><TD>3&ndash;6%</TD><TD>2 for 28. McConkey played and scored twice.</TD></TR>
        <TR><TD><strong>Mark Andrews</strong></TD><TD>2.4</TD><TD>2&ndash;4%</TD><TD>2 for 14 on 3 targets.</TD></TR>
        <TR><TD><strong>Xavier Hutchinson</strong></TD><TD>2.3</TD><TD>4&ndash;7%</TD><TD>2 for 13 on 3 targets.</TD></TR>
        <TR><TD><strong>Kaelon Black</strong></TD><TD>2.0</TD><TD>1&ndash;3%</TD><TD>6 carries for 8.</TD></TR>
        <TR><TD><strong>Ryan Flournoy</strong></TD><TD>1.6</TD><TD>2&ndash;4%</TD><TD>1 for 11 on 1 target.</TD></TR>
        <TR><TD><strong>Jordyn Tyson</strong></TD><TD>1.5</TD><TD>7&ndash;11%</TD><TD>1 for 6 on 2 targets. Olave had 15.</TD></TR>
        <TR><TD><strong>Seth McGowan</strong></TD><TD>1.3</TD><TD>1&ndash;3%</TD><TD>3 carries, then a hamstring injury.</TD></TR>
        <TR><TD><strong>Michael Mayer</strong></TD><TD>0.9</TD><TD>1&ndash;2%</TD><TD>1 for 4 on 4 targets with Bowers inactive.</TD></TR>
        <TR><TD><strong>Makai Lemon</strong></TD><TD>0.8</TD><TD>2&ndash;3%</TD><TD>1 for 3 on 3 targets.</TD></TR>
        <TR><TD><strong>Courtland Sutton</strong></TD><TD>0.0</TD><TD>3&ndash;5%</TD><TD>No catch on 2 targets.</TD></TR>
      </TBody>
    </Table>
    <P>
      Also on the record: last week&apos;s column said to avoid Fernando Mendoza, Geno Smith and Aaron Rodgers, and they
      scored 22.9, 19.4 and 16.0. Mendoza and Smith are on this week&apos;s board, and I own all three calls. I called
      Justin Herbert a stream and he scored 22.4. I listed Antonio Williams as a touchdown trap on a 6% share, and he
      caught 9 for 122. I said to cut Chris Rodriguez Jr., and he is back on the board as Tuten&apos;s handcuff. The
      avoids that held: Kyle McCord scored 3.0 and Daniel Jones 4.1, and Jones was released.
    </P>
    <H3>The lesson</H3>
    <P>
      The Big Three went 1 for 3 and scored 26.0 combined, 22.2 of it from Ward. Tyson went from 13 targets to 2
      while Chris Olave had 15. The four board quarterbacks returned 61.6 points on bids that topped out at 8%, up
      from 58.8 the week before. Six of the eight streaming defenses scored 10 or more: Houston D/ST 22, Chicago D/ST
      17, Buffalo D/ST 15, Denver D/ST 13, Kansas City D/ST 11 and Pittsburgh D/ST 10. The Chargers D/ST scored 2 and
      Detroit D/ST 8. No defense on the avoid list scored more than 8, and Tennessee D/ST finished at -7. Five of
      last week&apos;s six touchdown traps, Josh Cameron, Andrew Armstrong, Jalen Tolbert, Drew Sample and Pat
      Freiermuth, returned 16.0 combined. The sixth was Williams, who scored 16.7 by himself.
    </P>
    <H3>Where the market went</H3>
    <UL>
      <LI><strong>Chig Okonkwo</strong>: 16.1% to 61.1%, on 8.6.</LI>
      <LI><strong>Xavier Hutchinson</strong>: 8.7% to 46.7%, on 2.3.</LI>
      <LI><strong>Cam Ward</strong>: 4.5% to 37.3%, and he scored 22.2.</LI>
      <LI><strong>Jordyn Tyson</strong>: 42.2% to 72.4%, on 1.5.</LI>
      <LI><strong>Bo Nix</strong>: 56.5% to 79.7%, on 11.5.</LI>
      <LI><strong>Elic Ayomanor</strong>: 0.3% to 19.2%, on 4.2.</LI>
      <LI><strong>Ryan Flournoy</strong>: 25.9% to 44.3%, on 1.6.</LI>
      <LI><strong>Michael Mayer</strong>: 18.4% to 36.8%, on 0.9.</LI>
    </UL>

    <H2>The Darkness Doctrine</H2>
    <P>
      Last week&apos;s receipts wrote this week&apos;s rules. Five of them.
    </P>
    <H3>Rule 1: Target share over touchdowns, and it cuts both ways</H3>
    <P>
      Williams was on last week&apos;s trap list because he scored on a 6% share. This week he had a 34% share and no
      TD, and he is second on the board. The rule held and my read of him did not. This week&apos;s traps scored on
      almost no volume: Sterling Shepard (NYJ WR, 2 TDs on 2 targets), Kayshon Boutte (HOU WR, 2 targets), Colbie
      Young (CIN WR, 2 targets, a 5% share), Brian Thomas Jr. (JAX WR, 31.5% rostered, 3 targets, a 7% share),
      KaVontae Turpin (DAL WR, a rushing TD on 2 carries and no catch), Ian Thomas (LV TE, 1 target), Adam Trautman
      (DEN TE, 1 target) and Brevyn Spann-Ford (DAL TE, 2 targets). Max Hurleman (PIT WR) caught 6 for 61 on 7
      targets, with the TD in the final two minutes and Pittman expected back Friday. I want to see it twice.
    </P>
    <H3>Rule 2: Buy the job</H3>
    <P>
      Two weeks ago I paid 14&ndash;20% for Kaleb Johnson because a starter was hurt, and wrote afterward that a
      handcuff is not a job. Croskey-Merritt is the other case. He is first on Washington&apos;s chart, he got 13 of
      the 20 running back carries in his first game back and no starter is coming back to take them. That is why he
      costs 12&ndash;18% and Johnson, in the same spot as two weeks ago, costs 2&ndash;4%.
    </P>
    <H3>Rule 3: No byes, five early games</H3>
    <P>
      Nobody is off, so the lineup is not the problem this week. The clock is. Green Bay and the Rams play Wednesday
      night (Kaleb Johnson). Thanksgiving has Chicago at Detroit (Santos, Bates, Simmons), Philadelphia at Dallas
      (Quinnen Williams, Trotter Jr., Epps) and Kansas City at Buffalo (Knox, Karlaftis). Denver is at Pittsburgh on
      Friday (Engram, the Denver D/ST, McMillian). Make those decisions first.
    </P>
    <H3>Rule 4: Price the second bet</H3>
    <P>
      Last week five bids needed somebody else to sit. Two of those windows opened: Harrison had no stat line and
      Bowers was inactive, and Hutchinson and Mayer scored 3.2 between them. This week three bids are second bets, on
      Jacobs, Addison and Tuten, and none costs more than 4%. An open window is still not a good game.
    </P>
    <H3>Rule 5: In superflex, a starter is a starter</H3>
    <P>
      Mendoza, Smith and Rodgers were on my avoid list and scored 58.3 between them. The four quarterbacks on the
      board scored 61.6. Six quarterbacks are on this week&apos;s board, and Richardson and DeVito are new starters at
      under 1% rostered. If your league starts two, roster them before you need them.
    </P>
    <Quote>
      Buy the job. Rent the window. Roster the starter.
    </Quote>

    <H2>Who to Cut</H2>
    <UL>
      <LI><strong>Puka Nacua</strong>: out 4-to-5 months after knee surgery, at 85.3%. In a redraft league that is a cut.</LI>
      <LI><strong>Xavier Hutchinson</strong>: 2 for 13 on 3 targets, at 46.7%.</LI>
      <LI><strong>Michael Mayer</strong>: 1 for 4 with Bowers inactive, at 36.8%.</LI>
      <LI><strong>Ryan Flournoy</strong>: 1 target, at 44.3%. <strong>Makai Lemon</strong>: 1 for 3 on 3 targets, at 44.5%.</LI>
      <LI><strong>Seth McGowan</strong>: listed out with a hamstring injury, at 18.3%. <strong>Emari Demercado</strong>: 5 carries while David Montgomery had 26, at 12.7%.</LI>
      <LI><strong>Kaelon Black</strong>: 6 carries for 8, at 38.0%. <strong>J.K. Dobbins</strong>: 1 carry while Jonah Coleman had 24, at 63.5%.</LI>
      <LI><strong>Daniel Jones</strong>: released, at 10.3%. <strong>Brandon Aiyuk</strong>: released, at 6.8%. <strong>Drew Lock</strong>: Seattle plans to start Darnold, at 10.8%.</LI>
      <LI><strong>Tank Dell</strong>: 4 targets for the second week running, at 60.6%. Cut him if you need the spot.</LI>
      <LI><strong>Hold</strong> Jordyn Tyson and Courtland Sutton for one more week. Tyson had 13 targets a week ago, and Sutton had a 26% share in his last game before the bye.</LI>
      <LI><strong>Hold</strong> Chig Okonkwo. Hold Lamar Jackson and Davante Adams in IR slots, and Drake Maye only if your league gives an IR slot to a player listed out.</LI>
    </UL>

    <H2>The Week 12 Bid Sheet</H2>
    <P>Set your claims in this order.</P>
    <OL>
      <LI><strong>Jacory Croskey-Merritt</strong> at 12&ndash;18%.</LI>
      <LI><strong>Antonio Williams</strong> at 8&ndash;12%.</LI>
      <LI><strong>Jack Bech</strong> at 4&ndash;7%.</LI>
      <LI>Superflex: <strong>Fernando Mendoza</strong> at 3&ndash;6% and <strong>Deshaun Watson</strong> at 3&ndash;5%, then <strong>Cam Ward</strong>, <strong>Geno Smith</strong> and <strong>Baker Mayfield</strong> at 2&ndash;4% ($1 each in 1QB).</LI>
      <LI><strong>Justice Hill</strong> at 3&ndash;5%, and <strong>Kaleb Johnson</strong> at 2&ndash;4% if Jacobs is trending out. He plays Wednesday night.</LI>
      <LI><strong>Tai Felton</strong>, <strong>Evan Engram</strong>, <strong>Samaje Perine</strong> and <strong>Chris Rodriguez Jr.</strong> at 2&ndash;4%.</LI>
      <LI>The rest of the Full Board at the ranges listed, and $1 on DJ Giddens.</LI>
    </OL>
    <P>
      Injury statuses are as of Tuesday. Jacobs, Addison and Tuten decide three of these bids before kickoff, and
      the first kickoff is Wednesday night. Andy Darkness is a pen name and has no rooting interest, allegedly.
    </P>
  </>
);

export default Body;
