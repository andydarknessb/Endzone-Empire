import React from 'react';
import { Box } from '@mui/material';
import {
  Lead, P, H2, H3, UL, OL, LI, Quote,
  Table, THead, TBody, TR, TH, TD,
} from '../../components/public/kit/Prose';
import { Tag } from '../../components/public/kit/ArticleBits';
import { PriorityCard, FaabLadder, OpponentChart } from './darkness-report-parts';

// Body only: the frontmatter lives in week11-waiver-wire-darkness-report.meta.js so listings can be
// built without loading this prose; content/articles/index.js loads it on demand.
//
// Every color below the hero is a theme token, so the cards, charts and chips read in light and
// dark. The hero is a dark illustration in both themes, like the Week 3 start/sit banner.

function HeroBanner() {
  // Claim cards fanned across the field: taller card, bigger bid. The Big Three are green.
  const bids = [
    { x: 150, h: 150, label: 'TYSON', fill: '#2fd97b' },
    { x: 262, h: 109, label: 'WARD', fill: '#2fd97b' },
    { x: 374, h: 95, label: 'HUTCHINSON', fill: '#2fd97b' },
    { x: 486, h: 82, label: 'HARRIS', fill: '#7eaaff' },
    { x: 598, h: 82, label: 'NIX', fill: '#7eaaff' },
  ];
  return (
    <Box
      component="svg"
      viewBox="0 0 800 300"
      xmlns="http://www.w3.org/2000/svg"
      sx={{ width: '100%', borderRadius: 'var(--radius-md, 10px)', overflow: 'hidden', mb: 4, display: 'block' }}
      role="img"
      aria-labelledby="wk11ww-hero-title wk11ww-hero-desc"
    >
      <title id="wk11ww-hero-title">Week 11 Waiver Wire: The Darkness Report</title>
      <desc id="wk11ww-hero-desc">
        A night field under a floodlight with five glowing bid bars rising from the turf, tallest
        first: Jordyn Tyson, Cam Ward, Xavier Hutchinson, Tre&apos; Harris and Bo Nix, over the headline
        Week 11 Waiver Wire. The first three are the Big Three.
      </desc>
      <defs>
        <linearGradient id="wk11ww-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#060910" />
          <stop offset="0.55" stopColor="#0c1424" />
          <stop offset="1" stopColor="#161027" />
        </linearGradient>
        <radialGradient id="wk11ww-flood" cx="0.5" cy="0" r="0.85">
          <stop offset="0" stopColor="#7eaaff" stopOpacity="0.34" />
          <stop offset="1" stopColor="#7eaaff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="wk11ww-bar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="800" height="300" fill="url(#wk11ww-bg)" />
      <rect width="800" height="300" fill="url(#wk11ww-flood)" />
      {Array.from({ length: 11 }, (_, i) => (
        <line key={`yd${i}`} x1={40 + i * 72} y1="120" x2={6 + i * 79} y2="300" stroke="rgba(255,255,255,0.06)" />
      ))}
      <line x1="0" y1="206" x2="800" y2="206" stroke="rgba(255,255,255,0.12)" strokeDasharray="6 8" />
      {bids.map((b) => (
        <g key={b.label}>
          <rect x={b.x} y={206 - b.h} width="56" height={b.h} rx="8" fill={b.fill} opacity="0.2" />
          <rect x={b.x} y={206 - b.h} width="56" height={b.h} rx="8" fill="url(#wk11ww-bar)" />
          <rect x={b.x} y={206 - b.h} width="56" height="5" rx="2.5" fill={b.fill} />
          <text x={b.x + 28} y={198 - b.h} textAnchor="middle" fill={b.fill} fontFamily="system-ui, sans-serif" fontWeight="800" fontSize="11" letterSpacing="1.5">{b.label}</text>
        </g>
      ))}
      <text x="400" y="34" textAnchor="middle" fill="#8badc9" fontFamily="system-ui, sans-serif" fontWeight="700" fontSize="12" letterSpacing="4">THE DARKNESS REPORT</text>
      <rect x="120" y="222" width="560" height="64" rx="14" fill="rgba(3,8,20,0.84)" stroke="rgba(126,170,255,0.25)" />
      <text x="400" y="253" textAnchor="middle" fill="#ffffff" fontFamily="system-ui, sans-serif" fontWeight="850" fontSize="24" letterSpacing="1">WEEK 11 WAIVER WIRE</text>
      <text x="400" y="274" textAnchor="middle" fill="#8badc9" fontFamily="system-ui, sans-serif" fontWeight="600" fontSize="12" letterSpacing="3">THE BIG THREE &middot; FAAB LADDER &middot; D/ST &middot; IDP &middot; RECEIPTS</text>
    </Box>
  );
}

const BIG_THREE = [
  {
    id: 'jordyn-tyson', rank: 1, name: 'Jordyn Tyson', pos: 'WR', team: 'NO', matchup: 'at CHI',
    min: 7, max: 11, rostered: '42.2% rostered', window: 'Season', windowTone: 'var(--success)',
    take: 'Tyson caught 11 passes for 80 yards on 13 targets in the 20-17 loss to Carolina, a 39% target share after 16% the week before, worth 13.5 points. Chris Olave had 4 targets in the same game. New Orleans is at Chicago as an 11.5-point underdog, implied for 18.5 in a 48.5 total.',
    pro: 'A 39% share and 13 targets, on a team that will be throwing from behind.',
    con: '7.3 yards a catch and no TD. He had a 16% share and 3.0 points the week before, and the Saints are implied for 18.5.',
  },
  {
    id: 'cam-ward', rank: 2, name: 'Cam Ward', pos: 'QB', team: 'TEN', matchup: 'at DAL',
    min: 5, max: 8, rostered: '4.5% rostered', window: 'Season', windowTone: 'var(--success)',
    take: "Ward went 28 of 39 for 231 yards, 2 TDs and an interception and ran for 39 yards in the 40-23 loss to Jacksonville, worth 19.1 points. He scored 26.3 in Week 8, before the bye. Tennessee is at Dallas in the week's highest total, 54.5, and is implied for 23.0. The Cowboys just gave up 46 points and 389 passing yards to San Francisco.",
    pro: '26.3 and 19.1 in his last two games, at 4.5% rostered, in a 54.5 total.',
    con: "Tennessee is an 8.5-point underdog, Carnell Tate is questionable and Wan'Dale Robinson hurt an ankle on Sunday. In a one-quarterback league he is a $1 streamer.",
  },
  {
    id: 'xavier-hutchinson', rank: 3, name: 'Xavier Hutchinson', pos: 'WR', team: 'HOU', matchup: 'vs IND (Thu)',
    min: 4, max: 7, rostered: '8.7% rostered', window: 'While Harrison is out', windowTone: 'var(--warning)',
    take: "Hutchinson caught 4 passes for 58 yards and a TD on 9 targets in the 27-24 loss at Cleveland, a 25% share after 14% the week before, worth 13.8 points. Marvin Harrison Jr. missed the game and was estimated as a non-participant with a hamstring injury on Monday's practice report, and Jaylin Noel is on IR. Houston hosts Indianapolis on Thursday night and is implied for 28.5.",
    pro: 'Nine targets, second on the team, in a 28.5 implied total.',
    con: "Nico Collins drew 16 targets, and the role is Harrison's when he returns. It is a short week, so the claim has to clear before Thursday.",
  },
];

// Bid ranges, % of a $100 budget. Big Three first, then the top of the priced board.
const LADDER = [
  ['Jordyn Tyson', 'WR', 7, 11, true],
  ['Cam Ward', 'QB', 5, 8, true],
  ['Xavier Hutchinson', 'WR', 4, 7, true],
  ["Tre' Harris", 'WR', 3, 6, false],
  ['Bo Nix', 'QB', 3, 6, false],
  ['Courtland Sutton', 'WR', 3, 5, false],
  ['Mark Andrews', 'TE', 2, 4, false],
  ['Elic Ayomanor', 'WR', 2, 4, false],
  ['Ryan Flournoy', 'WR', 2, 4, false],
  ['J.J. McCarthy', 'QB', 2, 4, false],
];

// Implied points for the offense each defense faces. Lower is better for the defense.
const DST_TARGETS = [
  { def: 'KC', opp: 'ARI', pts: 12.5, kind: 'stream' },
  { def: 'BUF', opp: 'MIA', pts: 14.5, kind: 'stream' },
  { def: 'DEN', opp: 'LV', pts: 15.25, kind: 'stream' },
  { def: 'HOU', opp: 'IND', pts: 16, kind: 'stream' },
  { def: 'PIT', opp: 'PHI', pts: 17, kind: 'stream' },
  { def: 'CHI', opp: 'NO', pts: 18.5, kind: 'stream' },
  { def: 'LAC', opp: 'NYJ', pts: 18.5, kind: 'stream' },
  { def: 'DET', opp: 'TB', pts: 19.5, kind: 'stream' },
  { def: 'TB', opp: 'DET', pts: 26, kind: 'avoid' },
  { def: 'NYG', opp: 'JAX', pts: 26.25, kind: 'avoid' },
  { def: 'IND', opp: 'HOU', pts: 28.5, kind: 'avoid' },
  { def: 'ARI', opp: 'KC', pts: 29, kind: 'avoid' },
  { def: 'WSH', opp: 'CIN', pts: 29.5, kind: 'avoid' },
  { def: 'NO', opp: 'CHI', pts: 30, kind: 'avoid' },
  { def: 'MIA', opp: 'BUF', pts: 31, kind: 'avoid' },
  { def: 'TEN', opp: 'DAL', pts: 31.5, kind: 'avoid' },
];

const Body = () => (
  <>
    <HeroBanner />
    <Lead>
      Week 10 took Drake Maye&apos;s ankle on New England&apos;s first drive in Munich and Aidan
      Hutchinson&apos;s knee on a sack celebration, and it put Woody Marks in the concussion protocol
      four days before Houston plays again. Six teams are on bye, and there is no running back on this
      wire worth a real bid. Last week&apos;s Big Three went 0 for 3. Let&apos;s spend, carefully.
    </Lead>
    <P>
      Every bid below is a percentage of a $100 FAAB budget. The league is half-PPR with one
      quarterback slot and a superflex. Rostered figures come from our own snapshot, taken early
      Tuesday. Lines are ESPN&apos;s as of Tuesday. Injury statuses are our database as of
      Tuesday with Monday&apos;s reporting layered on, and where the two disagree I trust the
      database and say so. Atlanta, Cleveland, Green Bay, the Rams, New England and Seattle are on
      bye, so 26 teams play. Thursday is Indianapolis at Houston at 8:15 p.m. ET. Sunday has the
      1:00, 4:05 and 4:25 p.m. ET kickoffs, then Minnesota and San Francisco at night in Mexico City.
      Monday night is Cincinnati at Washington. Week 10 snap counts are not in our data yet, so I
      quote yards, catches, targets, target share and points, plus carries from ESPN&apos;s box scores.
    </P>

    <H2>The Big Three</H2>
    <P>
      Tyson for the targets, Ward for the matchup, Hutchinson for Thursday. None of the three is a
      running back, because the running backs on this wire are handcuffs. Hutchinson has to be
      claimed in time for Thursday night.
    </P>
    {BIG_THREE.map((p) => <PriorityCard key={p.id} p={p} />)}
    <H3>Not in the Big Three: every running back</H3>
    <P>
      There is no running back in the Big Three because there is no running back job on this wire.
      Seth McGowan (RB, IND, 10.8% rostered) ran 12 times for 77 yards and a TD, and Jonathan Taylor
      still had 16 carries. Kaelon Black (RB, SF, 35.0%) ran 11 times for 53 yards and a TD, and
      Christian McCaffrey scored 44.3. Emari Demercado (RB, HOU, 0.3%) matters only if Woody Marks and
      David Montgomery both sit on Thursday. All three are bids of 3% or less. If Montgomery (73.5%)
      is on your wire, he comes first: he is second on Houston&apos;s chart with no injury tag in our
      data, and Marks is listed doubtful with a concussion on a short week. Montgomery has no stat
      line in the two games since Houston&apos;s bye, so check Thursday&apos;s inactives.
    </P>

    <H2>The FAAB Ladder</H2>
    <P>
      The top of the priced board on one scale. Highlighted bars are the Big Three. Anything that
      tops out at 8% or less is a cheap bid: pick a number in the range and don&apos;t lose sleep.
      Nothing on it tops 11%, because six teams are off and nobody inherited a backfield.
    </P>
    <FaabLadder ladder={LADDER} />

    <H2>The Full Board</H2>
    <P>
      Window is how long the role should last. Season means no starter is coming back to take it,
      and &quot;If X sits&quot; means exactly that. Rostered% is our snapshot, so a name at 40%
      is already in two out of five leagues out there.
    </P>
    <Table aria-label="Week 11 offensive waiver board">
      <THead>
        <TR>
          <TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Team</TH><TH scope="col">Why</TH><TH scope="col">Wk 11</TH><TH scope="col">Window</TH><TH scope="col">Bid</TH><TH scope="col">Rostered%</TH>
        </TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Jordyn Tyson</strong></TD><TD>WR</TD><TD>NO</TD><TD>11 for 80 on 13 targets, a 39% share after 16%.</TD><TD>at CHI</TD><TD>Season</TD><TD>7&ndash;11%</TD><TD>42.2%</TD></TR>
        <TR><TD>2</TD><TD><strong>Cam Ward</strong></TD><TD>QB</TD><TD>TEN</TD><TD>26.3 and 19.1 in his last two games. A 54.5 total in Dallas.</TD><TD>at DAL</TD><TD>Season</TD><TD>5&ndash;8%</TD><TD>4.5%</TD></TR>
        <TR><TD>3</TD><TD><strong>Xavier Hutchinson</strong></TD><TD>WR</TD><TD>HOU</TD><TD>4 for 58 and a TD on 9 targets. Harrison missed the game.</TD><TD>vs IND (Thu)</TD><TD>While Harrison is out</TD><TD>4&ndash;7%</TD><TD>8.7%</TD></TR>
        <TR><TD>4</TD><TD><strong>Tre&apos; Harris</strong></TD><TD>WR</TD><TD>LAC</TD><TD>5 for 86 on a 31% share, after 23%.</TD><TD>vs NYJ</TD><TD>If McConkey sits</TD><TD>3&ndash;6%</TD><TD>2.9%</TD></TR>
        <TR><TD>5</TD><TD><strong>Bo Nix</strong></TD><TD>QB</TD><TD>DEN</TD><TD>19.3 and 15.7 before the bye. Denver is a 10-point favorite.</TD><TD>vs LV</TD><TD>Season</TD><TD>3&ndash;6%</TD><TD>56.5%</TD></TR>
        <TR><TD>6</TD><TD><strong>Courtland Sutton</strong></TD><TD>WR</TD><TD>DEN</TD><TD>A 26% share and 13.0 before the bye. Waddle is listed questionable.</TD><TD>vs LV</TD><TD>Season</TD><TD>3&ndash;5%</TD><TD>56.9%</TD></TR>
        <TR><TD>7</TD><TD><strong>Mark Andrews</strong></TD><TD>TE</TD><TD>BAL</TD><TD>8 for 82 on 8 targets in Brissett&apos;s Baltimore debut.</TD><TD>at CAR</TD><TD>Season</TD><TD>2&ndash;4%</TD><TD>53.7%</TD></TR>
        <TR><TD>8</TD><TD><strong>Elic Ayomanor</strong></TD><TD>WR</TD><TD>TEN</TD><TD>5 for 79 on 10 targets, a 27% share, with Tate out.</TD><TD>at DAL</TD><TD>If Tate sits</TD><TD>2&ndash;4%</TD><TD>0.3%</TD></TR>
        <TR><TD>9</TD><TD><strong>Ryan Flournoy</strong></TD><TD>WR</TD><TD>DAL</TD><TD>6 for 71 and a TD on 7 targets. Dallas is implied for 31.5.</TD><TD>vs TEN</TD><TD>Stream</TD><TD>2&ndash;4%</TD><TD>25.9%</TD></TR>
        <TR><TD>10</TD><TD><strong>J.J. McCarthy</strong></TD><TD>QB</TD><TD>NYG</TD><TD>293 yards, a TD and 34 rushing yards, worth 17.1.</TD><TD>vs JAX</TD><TD>Superflex stream</TD><TD>2&ndash;4%</TD><TD>27.5%</TD></TR>
        <TR><TD>11</TD><TD><strong>Jacoby Brissett</strong></TD><TD>QB</TD><TD>BAL</TD><TD>33 of 49 for 340 yards in his Baltimore debut, worth 11.8.</TD><TD>at CAR</TD><TD>As the starter</TD><TD>2&ndash;4%</TD><TD>16.2%</TD></TR>
        <TR><TD>12</TD><TD><strong>Makai Lemon</strong></TD><TD>WR</TD><TD>PHI</TD><TD>28% and 27% shares before the bye.</TD><TD>vs PIT</TD><TD>Season</TD><TD>2&ndash;3%</TD><TD>49.4%</TD></TR>
        <TR><TD>13</TD><TD><strong>Seth McGowan</strong></TD><TD>RB</TD><TD>IND</TD><TD>77 yards and a TD on 12 carries, behind Taylor&apos;s 16.</TD><TD>at HOU (Thu)</TD><TD>Handcuff</TD><TD>1&ndash;3%</TD><TD>10.8%</TD></TR>
        <TR><TD>14</TD><TD><strong>Kaelon Black</strong></TD><TD>RB</TD><TD>SF</TD><TD>53 yards and a TD on 11 carries, behind McCaffrey.</TD><TD>vs MIN (Mexico City)</TD><TD>Handcuff</TD><TD>1&ndash;3%</TD><TD>35.0%</TD></TR>
        <TR><TD>15</TD><TD><strong>Chig Okonkwo</strong></TD><TD>TE</TD><TD>WSH</TD><TD>8 targets and a 24% share. A 52.5 total on Monday night.</TD><TD>vs CIN (Mon)</TD><TD>Stream</TD><TD>1&ndash;3%</TD><TD>16.1%</TD></TR>
        <TR><TD>16</TD><TD><strong>Michael Mayer</strong></TD><TD>TE</TD><TD>LV</TD><TD>Bowers hurt his right ankle and is day-to-day.</TD><TD>at DEN</TD><TD>If Bowers sits</TD><TD>1&ndash;2%</TD><TD>18.4%</TD></TR>
        <TR><TD>17</TD><TD><strong>Caleb Douglas</strong></TD><TD>WR</TD><TD>MIA</TD><TD>3 for 71 on 8 targets, a 25% share, in McCord&apos;s first start.</TD><TD>at BUF</TD><TD>Season</TD><TD>1&ndash;2%</TD><TD>30.3%</TD></TR>
        <TR><TD>18</TD><TD><strong>Emari Demercado</strong></TD><TD>RB</TD><TD>HOU</TD><TD>7 carries on Sunday. Marks is listed doubtful with a concussion.</TD><TD>vs IND (Thu)</TD><TD>If Marks and Montgomery sit</TD><TD>1&ndash;2%</TD><TD>0.3%</TD></TR>
      </TBody>
    </Table>
    <P>
      Five of these bids hang on an injury report. Hutchinson needs Harrison out, Harris needs McConkey
      out, Ayomanor needs Tate out, Mayer needs Bowers out and Demercado needs two backs out. That is why
      nothing below Hutchinson tops 6%.
    </P>
    <P>
      Off the board, for a dollar if your wire is thin: Myles Price (MIN WR, 0.8%) caught 4 for 49 and his
      first career TD catch with Jordan Addison out, and Addison needs thumb surgery. Gavin Bartholomew (MIN TE,
      1.5%) caught 3 for 36 and a TD with T.J. Hockenson out. Tommy Tremble (CAR TE, 0.5%) has 16% and 17%
      shares the last two weeks and out-targeted Darren Waller 5 to 4. Tommy DeVito (NE QB, 0.1%) is the
      superflex stash: Mike Vrabel indicated Drake Maye will miss time, and New England is on bye.
    </P>

    <H2>Superflex Corner</H2>
    <P>
      Quarterbacks are where this format is won on the wire, so here is the ranking, with Week 10
      points.
    </P>
    <UL>
      <LI>
        <strong>Cam Ward</strong> (TEN, 4.5% rostered) is first at 19.1, 28 of 39 for 231 yards and 2 TDs
        with 39 rushing yards. He plays at Dallas in a 54.5 total, with Tennessee implied for 23.0.
      </LI>
      <LI>
        <strong>Bo Nix</strong> (DEN, 56.5%) is back from the bye after 19.3 and 15.7 and hosts Las Vegas,
        with Denver implied for 25.25. If he is on your wire, he is the safer start of the two.
      </LI>
      <LI>
        <strong>J.J. McCarthy</strong> (NYG, 27.5%) scored 17.1 on 293 yards, a TD and an interception, with
        34 rushing yards. He hosts Jacksonville, with the Giants implied for 20.25.
      </LI>
      <LI>
        <strong>Jacoby Brissett</strong> (BAL, 16.2%) threw 49 passes for 340 yards and no TDs in his Baltimore
        debut, worth 11.8. Baltimore is at Carolina, implied for 20.5.
      </LI>
      <LI>
        <strong>Kirk Cousins</strong> (MIN, 63.5%) went 21 of 31 for 207 yards and 2 TDs, worth 15.4, five days
        after rejoining the Vikings. Kyler Murray is listed out. Minnesota plays San Francisco in Mexico City,
        implied for 21.75, without Jordan Addison.
      </LI>
      <LI>
        <strong>Justin Herbert</strong> (LAC, 30.0%) scored 16.3, but 51 rushing yards and a rushing TD carried
        it: he completed 12 passes for 129 yards. The Chargers host the Jets, implied for 22.0. He is a stream.
      </LI>
      <LI>
        <strong>Avoid Aaron Rodgers</strong> (PIT, 37.2%, 15.6): both TDs came in the fourth quarter of a 38-18 loss at Cincinnati.
      </LI>
      <LI>
        <strong>Avoid Fernando Mendoza</strong> (LV, 19.5%, 13.9): 143 yards and six sacks in his first start, and
        the Raiders are implied for 15.25 at Denver. <strong>Avoid Kyle McCord</strong> (MIA, 1.2%, 12.8) at
        Buffalo, where Miami is implied for 14.5.
      </LI>
      <LI>
        <strong>Avoid Daniel Jones</strong> (IND, 11.1%, 5.2), 11 of 22 with 2 interceptions, and{' '}
        <strong>Carson Beck</strong> (ARI, 1.7%, 0.4), with Arizona implied for 12.5, the week&apos;s lowest.
      </LI>
      <LI>
        <strong>Geno Smith</strong> (NYJ, 20.6%, 5.9) left with an ankle injury, and tests found nothing major.
        Aaron Glenn wants to see how the ankle feels before he picks a quarterback, and Cade Klubnik (0.1%)
        threw for 137 yards and an interception in relief. Avoid both: the Jets are implied for 18.5.
      </LI>
      <LI>
        <strong>Baker Mayfield</strong> (TB, 19.5%) is questionable with a foot injury, and Tampa Bay signed Easton
        Stick to the roster and Cooper Rush to the practice squad on Monday. Wait for a status.
      </LI>
      <LI>
        On bye and useless this week: Drew Lock, Michael Penix Jr., Deshaun Watson and Shedeur Sanders. Mike
        Macdonald is &quot;really optimistic&quot; that Sam Darnold gets a full week of practice after the bye and starts on Nov. 29, so Lock&apos;s run looks over.
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
        <strong>Kansas City D/ST</strong> hosts Arizona (12.5), the lowest implied total on the board. Carson Beck
        threw 2 interceptions and took 5 sacks against the Rams. The Chiefs D/ST scored 15 and 11 the last two weeks.
      </LI>
      <LI>
        <strong>Buffalo D/ST</strong> hosts Miami (14.5) in Kyle McCord&apos;s second start. The Bills D/ST scored
        21, 22 and 12.
      </LI>
      <LI>
        <strong>Denver D/ST</strong> hosts Las Vegas (15.25). Seattle sacked Fernando Mendoza six times in his first
        start, and Brock Bowers is day-to-day. The Broncos D/ST scored 2 and 7 before the bye, so this is about the
        opponent.
      </LI>
      <LI>
        <strong>Houston D/ST</strong> hosts Indianapolis (16.0) on Thursday. Daniel Jones threw 2 interceptions on
        22 attempts against Miami. The Texans D/ST scored 13 and 6, and Azeez Al-Shaair, their leading tackler, went
        on IR on Tuesday.
      </LI>
      <LI>
        <strong>Pittsburgh D/ST</strong> is at Philadelphia (17.0), with Joe Milton first on the Eagles&apos; chart. The
        Steelers D/ST scored -6 at Cincinnati, so this is about the opponent too.
      </LI>
      <LI>
        <strong>Chicago D/ST</strong> hosts New Orleans (18.5) and scored 12 and 14 before the bye.{' '}
        <strong>The Chargers D/ST</strong> hosts the Jets (18.5), who do not know their quarterback yet.{' '}
        <strong>Detroit D/ST</strong> hosts Tampa Bay (19.5) and scored 18, but Aidan Hutchinson is out with a
        torn ACL, and Baker Mayfield&apos;s status decides how good the spot is.
      </LI>
    </UL>
    <P>
      <strong>Avoid:</strong> Tennessee (faces Dallas, 31.5), Miami (faces Buffalo, 31.0), New Orleans (faces
      Chicago, 30.0), Washington (faces Cincinnati, 29.5), Arizona (faces Kansas City, 29.0), Indianapolis (faces
      Houston, 28.5), the Giants (face Jacksonville, 26.25) and Tampa Bay (faces Detroit, 26.0). The grey bars
      above are those defenses. The Indianapolis D/ST scored 21 last week, but Houston is implied for 28.5, so do
      not chase it. The Minnesota D/ST scored 24 with eight sacks at Green Bay, and San Francisco is implied for
      24.75. Same answer.
    </P>

    <H2>Kickers</H2>
    <P>
      Kicker ownership is in our snapshot. The play is a kicker on an offense that scores, and the
      best number that is widely available is Chicago&apos;s, at 30.0. Points are Week 9 then Week 10.
    </P>
    <Table aria-label="Week 11 kicker streamers">
      <THead>
        <TR>
          <TH scope="col">#</TH><TH scope="col">Kicker</TH><TH scope="col">Team</TH><TH scope="col">Team total</TH><TH scope="col">Rostered%</TH>
        </TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Cairo Santos</strong></TD><TD>CHI</TD><TD>30.0 vs NO; 9 in Week 9, bye in Week 10</TD><TD>20.7%</TD></TR>
        <TR><TD>2</TD><TD><strong>Evan McPherson</strong></TD><TD>CIN</TD><TD>29.5 at WSH on Monday night; 13 and 8</TD><TD>24.3%</TD></TR>
        <TR><TD>3</TD><TD><strong>Jake Bates</strong></TD><TD>DET</TD><TD>26.0 vs TB; 15 and 5</TD><TD>54.9%</TD></TR>
        <TR><TD>4</TD><TD><strong>Wil Lutz</strong></TD><TD>DEN</TD><TD>25.25 vs LV; 9 in Week 9, bye in Week 10</TD><TD>3.6%</TD></TR>
        <TR><TD>5</TD><TD><strong>Joey Slye</strong></TD><TD>TEN</TD><TD>23.0 at DAL in a 54.5 total; bye in Week 9, 17 in Week 10</TD><TD>0.3%</TD></TR>
      </TBody>
    </Table>
    <P>
      Harrison Butker (KC, 53.2%) has the 29.0 total against Arizona and scored 5 and 5. Jason Sanders (NYJ,
      16.9%) scored 16 and 14, but the Jets are implied for 18.5. Bye cover: Brandon McManus (LAR, 0.8%), Trey
      Smack (GB, 10.0%) and Andre Szmyt (CLE, 8.8%) are off. Riley Patterson (0.7%) kicked for Baltimore, with
      Tyler Loop (20.0%) on IR.
    </P>

    <H2>IDP Waiver Board</H2>
    <P>
      Lines are Week 10 box scores from our database. IDP rostered percentages are not tracked, so I can&apos;t
      tell you who is sitting on your wire. Tackle volume is the currency at linebacker and safety. Pressure is
      the currency on the line. Arizona and Miami are 16.5-point underdogs, Indianapolis is a 12.5-point underdog
      on Thursday and New Orleans is an 11.5-point underdog, so those defenses will be on the field. Kaden Elliss
      is the Saints&apos; pick for the second week running, and Jordyn Brooks is Miami&apos;s. Andrew Wingard, last
      week&apos;s tackle floor for Arizona, is listed out.
    </P>
    <H3>Linebacker</H3>
    <Table aria-label="IDP linebackers">
      <THead>
        <TR><TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Team</TH><TH scope="col">Type</TH><TH scope="col">Week 10</TH><TH scope="col">Wk 11</TH></TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Kaden Elliss</strong></TD><TD>NO</TD><TD><Tag kind="both" /></TD><TD>6 solo and 9 assisted tackles, a sack and 2 tackles for loss.</TD><TD>at CHI</TD></TR>
        <TR><TD>2</TD><TD><strong>Payton Wilson</strong></TD><TD>PIT</TD><TD><Tag kind="T" /></TD><TD>9 solo and 10 assisted tackles.</TD><TD>at PHI</TD></TR>
        <TR><TD>3</TD><TD><strong>Cedric Gray</strong></TD><TD>TEN</TD><TD><Tag kind="both" /></TD><TD>8 solo and 1 assisted tackle, an interception and 2 passes defended.</TD><TD>at DAL</TD></TR>
        <TR><TD>4</TD><TD><strong>Patrick Queen</strong></TD><TD>PIT</TD><TD><Tag kind="T" /></TD><TD>5 solo and 9 assisted tackles and a sack.</TD><TD>at PHI</TD></TR>
        <TR><TD>5</TD><TD><strong>Foyesade Oluokun</strong></TD><TD>JAX</TD><TD><Tag kind="T" /></TD><TD>9 solo and 1 assisted tackle.</TD><TD>at NYG</TD></TR>
        <TR><TD>6</TD><TD><strong>Jordyn Brooks</strong></TD><TD>MIA</TD><TD><Tag kind="T" /></TD><TD>6 solo and 3 assisted tackles and a forced fumble.</TD><TD>at BUF</TD></TR>
      </TBody>
    </Table>
    <H3>Defensive line and edge</H3>
    <Table aria-label="IDP defensive line">
      <THead>
        <TR><TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Team</TH><TH scope="col">Week 10</TH><TH scope="col">Wk 11</TH></TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Maxx Crosby</strong></TD><TD>DE</TD><TD>LV</TD><TD>7 solo and 1 assisted tackle, a sack and 4 tackles for loss.</TD><TD>at DEN</TD></TR>
        <TR><TD>2</TD><TD><strong>Quinnen Williams</strong></TD><TD>DT</TD><TD>DAL</TD><TD>6 solo and 4 assisted tackles, a sack and a forced fumble.</TD><TD>vs TEN</TD></TR>
        <TR><TD>3</TD><TD><strong>Dalvin Tomlinson</strong></TD><TD>DT</TD><TD>LAC</TD><TD>3 solo and 2 assisted tackles, 2 sacks and 2 tackles for loss.</TD><TD>vs NYJ</TD></TR>
        <TR><TD>4</TD><TD><strong>Derrick Moore</strong></TD><TD>DE</TD><TD>DET</TD><TD>2 solo tackles, 2 sacks and 2 tackles for loss. Hutchinson is out.</TD><TD>vs TB</TD></TR>
        <TR><TD>5</TD><TD><strong>Logan Hall</strong></TD><TD>DE</TD><TD>HOU</TD><TD>2 solo tackles, 2 sacks and 2 tackles for loss.</TD><TD>vs IND (Thu)</TD></TR>
      </TBody>
    </Table>
    <H3>Defensive back</H3>
    <Table aria-label="IDP defensive backs">
      <THead>
        <TR><TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Team</TH><TH scope="col">Type</TH><TH scope="col">Week 10</TH><TH scope="col">Wk 11</TH></TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>M.J. Stewart</strong></TD><TD>S</TD><TD>HOU</TD><TD><Tag kind="T" /></TD><TD>4 solo and 10 assisted tackles.</TD><TD>vs IND (Thu)</TD></TR>
        <TR><TD>2</TD><TD><strong>Jeremy Reaves</strong></TD><TD>S</TD><TD>WSH</TD><TD><Tag kind="T" /></TD><TD>7 solo and 2 assisted tackles.</TD><TD>vs CIN (Mon)</TD></TR>
        <TR><TD>3</TD><TD><strong>Kyle Hamilton</strong></TD><TD>S</TD><TD>BAL</TD><TD><Tag kind="T" /></TD><TD>7 solo and 3 assisted tackles.</TD><TD>at CAR</TD></TR>
        <TR><TD>4</TD><TD><strong>Justin Walley</strong></TD><TD>CB</TD><TD>IND</TD><TD><Tag kind="both" /></TD><TD>3 solo and 2 assisted tackles, a sack, 2 passes defended and a forced fumble.</TD><TD>at HOU (Thu)</TD></TR>
        <TR><TD>5</TD><TD><strong>Ar&apos;Darius Washington</strong></TD><TD>S</TD><TD>NYG</TD><TD><Tag kind="BP" /></TD><TD>5 solo and 2 assisted tackles, an interception and 2 passes defended.</TD><TD>vs JAX</TD></TR>
        <TR><TD>6</TD><TD><strong>Chris Johnson</strong></TD><TD>CB</TD><TD>MIA</TD><TD><Tag kind="BP" /></TD><TD>An interception returned 59 yards for a TD.</TD><TD>at BUF</TD></TR>
      </TBody>
    </Table>
    <P>
      Tackle-heavy scoring: bump the Tackles tags a tier. Big-play scoring: bump the Big play tags.
      Elliss, Gray and Walley carry both.
    </P>

    <H2>The Injury Ledger</H2>
    <H3>Out or on IR</H3>
    <UL>
      <LI><strong>Aidan Hutchinson</strong> (DET DE): a torn ACL in his right knee, confirmed Monday (Tom Pelissero).</LI>
      <LI><strong>Jordan Addison</strong> (MIN WR): needs thumb surgery and will miss a few weeks (Kevin O&apos;Connell). <strong>Kyler Murray</strong> (MIN QB) is listed out. Price.</LI>
      <LI><strong>Josh Jacobs</strong> (GB RB): finger, listed out, with a &quot;realistic chance&quot; of returning Nov. 25 against the Rams after the bye (Ian Rapoport).</LI>
      <LI><strong>Puka Nacua</strong> (LAR WR): IR, knee and toe, expected back in &quot;mid-December&quot; (Rapoport). <strong>Davante Adams</strong> (LAR WR): IR, hamstring, targeting Nov. 25 (Rapoport).</LI>
      <LI><strong>Sam Darnold</strong> (SEA QB): quadriceps and ribs, listed out. Mike Macdonald is &quot;really optimistic&quot; he gets a full week of practice after the bye and starts Nov. 29 against San Francisco.</LI>
      <LI><strong>Lamar Jackson</strong> (BAL QB): IR, thumb, out &quot;6-to-10 weeks&quot; (Jesse Minter). Brissett.</LI>
      <LI><strong>Gardner Minshew II</strong> (ARI QB): IR, season-ending elbow surgery (Adam Schefter). <strong>Michael Wilson</strong> (ARI WR), <strong>Jeremiyah Love</strong> (ARI RB) and <strong>Kendrick Bourne</strong> (ARI WR): IR.</LI>
      <LI><strong>Malik Willis</strong> (MIA QB): IR, groin and core, and the Dolphins are still deciding on surgery (Jeff Hafley). <strong>De&apos;Von Achane</strong> (MIA RB): IR. McCord.</LI>
      <LI><strong>TreVeyon Henderson</strong> (NE RB): IR, illness. <strong>RJ Harvey</strong> (DEN RB): IR, knee. <strong>Tyler Goodson</strong> (DAL RB): IR, knee. <strong>Terry McLaurin</strong> (WSH WR): IR, surgery on a torn patellar tendon. <strong>Jalen Hurts</strong> (PHI QB): IR, expected to miss the rest of the season.</LI>
      <LI><strong>Jake Ferguson</strong> (DAL TE): listed out. <strong>Brandon Aiyuk</strong> (SF WR): listed out, on a roster exemption.</LI>
      <LI><strong>Jacory Croskey-Merritt</strong> (WSH RB): IR, no new detail.</LI>
      <LI><strong>Michael Pittman Jr.</strong> (PIT WR): IR. <strong>Roman Wilson</strong> (PIT WR): IR, and Mike McCarthy is &quot;hopeful&quot; he returns against the Eagles.</LI>
    </UL>
    <H3>Doubtful, questionable and day-to-day</H3>
    <UL>
      <LI><strong>Drake Maye</strong> (NE QB): ankle, listed doubtful, hurt on New England&apos;s opening drive in Munich. Mike Vrabel said Monday he had no definitive diagnosis but indicated Maye will miss time (Phil Perry). New England is on bye. DeVito.</LI>
      <LI><strong>Woody Marks</strong> (HOU RB): entered the concussion protocol in the third quarter Sunday, missed Monday&apos;s walkthrough and is listed doubtful, with Houston playing Thursday. <strong>Marvin Harrison Jr.</strong> (HOU WR): hamstring, listed questionable, missed Sunday&apos;s game and was estimated as a non-participant Monday. <strong>Jaylin Noel</strong> (HOU WR) is on IR. Hutchinson, Demercado.</LI>
      <LI><strong>Kenneth Walker III</strong> (KC RB): groin, ruled out the day before the Atlanta game and listed questionable. <strong>Jaydn Ott</strong> (KC RB): hamstring, inactive Sunday and listed questionable. Emmett Johnson (75.3%).</LI>
      <LI><strong>Brock Bowers</strong> (LV TE): right ankle, day-to-day. Klint Kubiak: &quot;It&apos;s not as bad as we thought, but still a significant injury.&quot; Mayer.</LI>
      <LI><strong>Geno Smith</strong> (NYJ QB): left ankle, left in the third quarter, and tests found no major injury (Rapoport). <strong>Omar Cooper Jr.</strong> (NYJ WR): ankle, hurt on the Jets&apos; first offensive play, with imaging Monday.</LI>
      <LI><strong>Baker Mayfield</strong> (TB QB): foot, questionable. Tampa Bay signed Easton Stick to the roster and Cooper Rush to the practice squad Monday (Rick Stroud).</LI>
      <LI><strong>T.J. Hockenson</strong> (MIN TE): wrist and chest, missed Sunday. The Vikings expect progress this week (O&apos;Connell). Bartholomew.</LI>
      <LI><strong>Mike Evans</strong> (SF WR): Achilles. Kyle Shanahan is &quot;hoping to&quot; have him back at practice this week.</LI>
      <LI><strong>Carnell Tate</strong> (TEN WR): shoulder, missed Sunday, and Robert Saleh is hopeful for Dallas. <strong>Wan&apos;Dale Robinson</strong> (TEN WR): ankle, hurt Sunday. Ayomanor.</LI>
      <LI><strong>Ladd McConkey</strong> (LAC WR): listed questionable, with no stat line in two games. Harris.</LI>
      <LI><strong>A.J. Brown</strong> (NE WR): hamstring, left in the second half in Munich. New England is on bye.</LI>
      <LI><strong>Travis Kelce</strong> (KC TE): aggravated a right ankle injury, was carted off and returned in the second quarter. No injury tag in our data.</LI>
      <LI><strong>Jaylen Waddle</strong> (DEN WR): concussion, listed questionable coming out of the bye. <strong>Luther Burden III</strong> (CHI WR): concussion, took part in Monday&apos;s unofficial practice. <strong>Kyle Monangai</strong> (CHI RB): thumb and toe, says he is &quot;on track&quot; for Sunday.</LI>
      <LI><strong>Chig Okonkwo</strong> (WSH TE): left last Thursday&apos;s game at the Giants with a back injury and returned after halftime. No injury tag in our data.</LI>
      <LI><strong>DeVonta Smith</strong> and <strong>Dontayvion Wicks</strong> (PHI WR): listed questionable, no new detail.</LI>
    </UL>

    <H2>Receipts: Grading Week 10</H2>
    <P>
      Last week&apos;s board, graded in half-PPR points from our database. The hits first, and there are four.
    </P>
    <Table aria-label="Week 10 board hits">
      <THead>
        <TR><TH scope="col">Player</TH><TH scope="col">Points</TH><TH scope="col">Wk 10 bid</TH></TR>
      </THead>
      <TBody>
        <TR><TD><strong>Cam Ward</strong></TD><TD>19.1</TD><TD>1&ndash;3%</TD></TR>
        <TR><TD><strong>Drew Lock</strong></TD><TD>15.6</TD><TD>4&ndash;7%</TD></TR>
        <TR><TD><strong>Michael Penix Jr.</strong></TD><TD>12.3</TD><TD>2&ndash;4%</TD></TR>
        <TR><TD><strong>Jacoby Brissett</strong></TD><TD>11.8</TD><TD>3&ndash;5%</TD></TR>
      </TBody>
    </Table>
    <P>
      All four are quarterbacks. Ward threw 2 TDs and ran for 39 yards. Lock went 14 of 17 for 240 yards and
      2 TDs. Penix threw for 286 yards and an interception and ran for 29. Brissett threw for 340 yards and no
      TDs. Now the misses and the shrugs.
    </P>
    <Table aria-label="Week 10 board misses and pushes">
      <THead>
        <TR><TH scope="col">Player</TH><TH scope="col">Points</TH><TH scope="col">Wk 10 bid</TH><TH scope="col">What happened</TH></TR>
      </THead>
      <TBody>
        <TR><TD><strong>Caleb Douglas</strong></TD><TD>8.6</TD><TD>3&ndash;6%</TD><TD>A push: 3 for 71 on a 25% share.</TD></TR>
        <TR><TD><strong>Justice Hill</strong></TD><TD>6.3</TD><TD>3&ndash;5%</TD><TD>3 carries for 4 yards, 5 catches for 34.</TD></TR>
        <TR><TD><strong>Jordan Watkins</strong></TD><TD>5.9</TD><TD>2&ndash;4%</TD><TD>2 for 49.</TD></TR>
        <TR><TD><strong>Chig Okonkwo</strong></TD><TD>4.4</TD><TD>1&ndash;3%</TD><TD>A 24% share, 24 yards.</TD></TR>
        <TR><TD><strong>Kaleb Johnson</strong></TD><TD>4.2</TD><TD>14&ndash;20%</TD><TD>10 carries for 42 in a 30-10 loss.</TD></TR>
        <TR><TD><strong>Tank Dell</strong></TD><TD>3.6</TD><TD>5&ndash;9%</TD><TD>3 for 21 on an 11% share.</TD></TR>
        <TR><TD><strong>Darren Waller</strong></TD><TD>3.4</TD><TD>2&ndash;4%</TD><TD>2 for 24.</TD></TR>
        <TR><TD><strong>AJ Barner</strong></TD><TD>3.4</TD><TD>1&ndash;3%</TD><TD>3 for 19.</TD></TR>
        <TR><TD><strong>Brevyn Spann-Ford</strong></TD><TD>3.1</TD><TD>2&ndash;4%</TD><TD>1 for 26.</TD></TR>
        <TR><TD><strong>Corey Kiner</strong></TD><TD>2.5</TD><TD>8&ndash;12%</TD><TD>10 carries for 25 in a 35-10 loss.</TD></TR>
        <TR><TD><strong>Audric Estime</strong></TD><TD>1.6</TD><TD>4&ndash;7%</TD><TD>7 carries for 6. Travis Etienne Jr. came off IR.</TD></TR>
        <TR><TD><strong>Jameis Winston</strong></TD><TD>0.1</TD><TD>1&ndash;2%</TD><TD>McCarthy played.</TD></TR>
        <TR><TD><strong>Van Jefferson</strong></TD><TD>n/a</TD><TD>1&ndash;3%</TD><TD>No stat line.</TD></TR>
        <TR><TD><strong>Pierre Strong Jr.</strong></TD><TD>n/a</TD><TD>1&ndash;2%</TD><TD>No stat line.</TD></TR>
      </TBody>
    </Table>
    <P>
      Also on the record: last week&apos;s column said to cut Kaelon Black, and he ran for 53 yards and a TD and
      scored 13.6. Two weeks ago it said to cut Seth McGowan, who has scored 10.7 and 13.7 since. Both are on this
      week&apos;s board as handcuffs, and I own both calls. Avoiding Justin Herbert cost 16.3. The other cuts held:
      Mike Washington Jr. scored 3.2 and Mike Gesicki 1.4. Emmett Johnson was a Week 9 pick I left off last
      week&apos;s board, and he scored 32.1 in his first start with Kenneth Walker III out.
    </P>
    <H3>The lesson</H3>
    <P>
      The Big Three went 0 for 3 and scored 10.3 combined. Johnson&apos;s Packers lost 30-10 and Kiner&apos;s
      Patriots lost 35-10, so the carries came and the points did not. The four superflex quarterbacks who started
      returned 58.8 points on bids that topped out at 7%, up from 44.3 on five the week before. Three of the eight
      streaming defenses paid: the Rams D/ST scored 23, Indianapolis D/ST 21 and Seattle D/ST 17. The other five
      scored 6 or fewer. No defense on the avoid list scored more than 4, and four of the seven finished below zero.
      Last week&apos;s named touchdown traps, Kayshon Boutte, Ashton Dulin, Keleki Latu, Charlie Woerner and Derius
      Davis, returned 3.5 combined.
    </P>
    <H3>Where the market went</H3>
    <UL>
      <LI><strong>Corey Kiner</strong>: 5.3% to 42.4%, on 2.5.</LI>
      <LI><strong>Tank Dell</strong>: 23.3% to 61.4%, on 3.6.</LI>
      <LI><strong>Audric Estime</strong>: 9.2% to 43.5%, on 1.6.</LI>
      <LI><strong>Darren Waller</strong>: 7.7% to 31.9%, on 3.4.</LI>
      <LI><strong>Kaleb Johnson</strong>: 0.9% to 13.4%, on 4.2.</LI>
      <LI><strong>Tutu Atwell</strong>: 0.3% to 16.9%, on 3.6.</LI>
      <LI><strong>Drew Lock</strong>: 8.0% to 19.9%, and he scored 15.6.</LI>
      <LI><strong>Emmett Johnson</strong>: 23.5% to 75.3%, and he scored 32.1.</LI>
    </UL>

    <H2>The Darkness Doctrine</H2>
    <P>
      Last week&apos;s receipts wrote this week&apos;s rules. Five of them.
    </P>
    <H3>Rule 1: Target share over touchdowns, again</H3>
    <P>
      Tyson&apos;s 39% share is why he tops the board without a TD. This week&apos;s traps scored on almost no volume:
      Josh Cameron (JAX WR, 3 targets, a 9% share), Andrew Armstrong (KC WR, a 43-yard TD on his only target),
      Jalen Tolbert (MIA WR, 2 targets), Antonio Williams (WSH WR, 2 targets, a 6% share), Drew Sample (CIN TE, a 7%
      share) and Pat Freiermuth (PIT TE, 38.8% rostered, a 10% share and a fourth-quarter TD in a 38-18 loss). Ben
      Sinnott (WSH TE) caught 4 for 42 and a TD on a 12% share, his first stat line in three weeks. I want to see it
      twice.
    </P>
    <H3>Rule 2: A handcuff is not a job</H3>
    <P>
      Last week I priced Kaleb Johnson at 14&ndash;20% and Corey Kiner at 8&ndash;12% because the starters were
      hurt. Each got 10 carries, both teams lost by 20 or more, and both are on bye now, with Jacobs given a
      realistic chance to return on Nov. 25. This week&apos;s backs are priced as what they are. McGowan and Black
      each ran well behind a starter who is not hurt, so they are 1&ndash;3%.
    </P>
    <H3>Rule 3: Six byes</H3>
    <P>
      Atlanta, Cleveland, Green Bay, the Rams, New England and Seattle are off. Check the lineup before the wire.
      Drew Lock, Deshaun Watson, Michael Penix Jr., Kaleb Johnson, Corey Kiner, Mack Hollins and Konata Mumpfield
      all had Week 10 lines, and none of them plays this week. Spend nothing on them.
    </P>
    <H3>Rule 4: Thursday locks first</H3>
    <P>
      Indianapolis at Houston is Thursday night (Hutchinson, McGowan, Demercado, Logan Hall, Stewart, Walley).
      Sunday night is Minnesota and San Francisco in Mexico City (Black, Cousins), and Monday night is Cincinnati
      at Washington (Okonkwo, McPherson, Reaves).
    </P>
    <H3>Rule 5: Price the second bet</H3>
    <P>
      Five windows on this board need somebody else to sit: Harrison, McConkey, Tate, Bowers, and Marks with
      Montgomery. None of them costs more than 7%. Last week&apos;s most expensive window did open, and Johnson scored 4.2. Kiner got 10 carries with Stevenson back and scored 2.5. An open window is not a good game.
    </P>
    <Quote>
      Buy the targets. Rent the handcuff. Never pay for last week&apos;s.
    </Quote>

    <H2>Who to Cut</H2>
    <UL>
      <LI><strong>Corey Kiner</strong>: 10 carries for 25, on bye, at 42.4%.</LI>
      <LI><strong>Audric Estime</strong>: 7 carries for 6 with Travis Etienne Jr. back, at 43.5%.</LI>
      <LI><strong>Darren Waller</strong>: 2 for 24 on a 14% share, at 31.9%.</LI>
      <LI><strong>Devin Singletary</strong>: 1 carry with Cam Skattebo back, at 28.0%. <strong>Chris Rodriguez Jr.</strong>: 4 carries while Bhayshul Tuten had 26, at 19.0%.</LI>
      <LI><strong>Drew Lock</strong>: on bye, with Mike Macdonald optimistic that Darnold starts on Nov. 29, at 19.9%.</LI>
      <LI><strong>Tyler Allgeier</strong>: 5 carries for 14, with Arizona implied for 12.5, at 64.9%. Cut him if you need the spot.</LI>
      <LI><strong>Kaleb Johnson</strong>: on bye, at 13.4%. Hold him only if you roster Jacobs.</LI>
      <LI><strong>Hold</strong> Tank Dell through Thursday: he had 4 targets while Hutchinson had 9.</LI>
      <LI><strong>Hold</strong> Josh Jacobs through the bye, Puka Nacua and Lamar Jackson in IR slots, Sam Darnold through the bye, and Drake Maye until there is a diagnosis.</LI>
      <LI><strong>Hold</strong> Omar Cooper Jr. until the imaging result is known.</LI>
    </UL>

    <H2>The Week 11 Bid Sheet</H2>
    <P>Set your claims in this order.</P>
    <OL>
      <LI><strong>Jordyn Tyson</strong> at 7&ndash;11%.</LI>
      <LI>Superflex: <strong>Cam Ward</strong> at 5&ndash;8% ($1 in 1QB), then <strong>Bo Nix</strong> at 3&ndash;6% if he is there, <strong>J.J. McCarthy</strong> at 2&ndash;4% and <strong>Jacoby Brissett</strong> at 2&ndash;4%.</LI>
      <LI><strong>Xavier Hutchinson</strong> at 4&ndash;7%. He plays Thursday night.</LI>
      <LI><strong>Tre&apos; Harris</strong> at 3&ndash;6% and <strong>Courtland Sutton</strong> at 3&ndash;5%.</LI>
      <LI><strong>Mark Andrews</strong>, <strong>Elic Ayomanor</strong> and <strong>Ryan Flournoy</strong> at 2&ndash;4%.</LI>
      <LI><strong>Seth McGowan</strong> and <strong>Kaelon Black</strong> at 1&ndash;3%, as handcuffs.</LI>
      <LI>The rest of the Full Board at the ranges listed, and $1 on Myles Price.</LI>
    </OL>
    <P>
      Injury statuses are as of Tuesday. Harrison, McConkey, Tate, Bowers and Marks decide five of these bids before
      kickoff, and Thursday night is Indianapolis at Houston. Andy Darkness is a pen name and has no rooting interest,
      allegedly.
    </P>
  </>
);

export default Body;
