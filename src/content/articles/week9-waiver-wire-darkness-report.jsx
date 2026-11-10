import React from 'react';
import { Box } from '@mui/material';
import {
  Lead, P, H2, H3, UL, OL, LI, Quote,
  Table, THead, TBody, TR, TH, TD,
} from '../../components/public/kit/Prose';
import { Tag } from '../../components/public/kit/ArticleBits';
import { PriorityCard, FaabLadder, OpponentChart } from './darkness-report-parts';

// Body only: the frontmatter lives in week9-waiver-wire-darkness-report.meta.js so listings can be
// built without loading this prose; content/articles/index.js loads it on demand.
//
// Every color below the hero is a theme token, so the cards, charts and chips read in light and
// dark. The hero is a dark illustration in both themes, like the Week 3 start/sit banner.

function HeroBanner() {
  // Claim cards fanned across the field: taller card, bigger bid. The Big Three are green.
  const bids = [
    { x: 150, h: 150, label: 'ALLGEIER', fill: '#2fd97b' },
    { x: 262, h: 100, label: 'RODRIGUEZ', fill: '#2fd97b' },
    { x: 374, h: 83, label: 'MITCHELL', fill: '#2fd97b' },
    { x: 486, h: 67, label: 'DARNOLD', fill: '#7eaaff' },
    { x: 598, h: 67, label: 'WILLIAMS', fill: '#7eaaff' },
  ];
  return (
    <Box
      component="svg"
      viewBox="0 0 800 300"
      xmlns="http://www.w3.org/2000/svg"
      sx={{ width: '100%', borderRadius: 'var(--radius-md, 10px)', overflow: 'hidden', mb: 4, display: 'block' }}
      role="img"
      aria-labelledby="wk9ww-hero-title wk9ww-hero-desc"
    >
      <title id="wk9ww-hero-title">Week 9 Waiver Wire: The Darkness Report</title>
      <desc id="wk9ww-hero-desc">
        A night field under a floodlight with five glowing bid bars rising from the turf, tallest
        first: Tyler Allgeier, Chris Rodriguez Jr., Adonai Mitchell, Sam Darnold and Antonio
        Williams, over the headline Week 9 Waiver Wire. The first three are the Big Three.
      </desc>
      <defs>
        <linearGradient id="wk9ww-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#060910" />
          <stop offset="0.55" stopColor="#0c1424" />
          <stop offset="1" stopColor="#161027" />
        </linearGradient>
        <radialGradient id="wk9ww-flood" cx="0.5" cy="0" r="0.85">
          <stop offset="0" stopColor="#7eaaff" stopOpacity="0.34" />
          <stop offset="1" stopColor="#7eaaff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="wk9ww-bar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="800" height="300" fill="url(#wk9ww-bg)" />
      <rect width="800" height="300" fill="url(#wk9ww-flood)" />
      {Array.from({ length: 11 }, (_, i) => (
        <line key={`yd${i}`} x1={40 + i * 72} y1="120" x2={6 + i * 79} y2="300" stroke="rgba(255,255,255,0.06)" />
      ))}
      <line x1="0" y1="206" x2="800" y2="206" stroke="rgba(255,255,255,0.12)" strokeDasharray="6 8" />
      {bids.map((b) => (
        <g key={b.label}>
          <rect x={b.x} y={206 - b.h} width="56" height={b.h} rx="8" fill={b.fill} opacity="0.2" />
          <rect x={b.x} y={206 - b.h} width="56" height={b.h} rx="8" fill="url(#wk9ww-bar)" />
          <rect x={b.x} y={206 - b.h} width="56" height="5" rx="2.5" fill={b.fill} />
          <text x={b.x + 28} y={198 - b.h} textAnchor="middle" fill={b.fill} fontFamily="system-ui, sans-serif" fontWeight="800" fontSize="11" letterSpacing="1.5">{b.label}</text>
        </g>
      ))}
      <text x="400" y="34" textAnchor="middle" fill="#8badc9" fontFamily="system-ui, sans-serif" fontWeight="700" fontSize="12" letterSpacing="4">THE DARKNESS REPORT</text>
      <rect x="120" y="222" width="560" height="64" rx="14" fill="rgba(3,8,20,0.84)" stroke="rgba(126,170,255,0.25)" />
      <text x="400" y="253" textAnchor="middle" fill="#ffffff" fontFamily="system-ui, sans-serif" fontWeight="850" fontSize="24" letterSpacing="1">WEEK 9 WAIVER WIRE</text>
      <text x="400" y="274" textAnchor="middle" fill="#8badc9" fontFamily="system-ui, sans-serif" fontWeight="600" fontSize="12" letterSpacing="3">THE BIG THREE &middot; FAAB LADDER &middot; D/ST &middot; IDP &middot; RECEIPTS</text>
    </Box>
  );
}

const BIG_THREE = [
  {
    id: 'tyler-allgeier', rank: 1, name: 'Tyler Allgeier', pos: 'RB', team: 'ARI', matchup: 'at SEA',
    min: 12, max: 18, rostered: '45.9% rostered', window: 'If Love sits', windowTone: 'var(--warning)',
    take: 'Allgeier ran for 147 yards and a TD on 11 carries and caught 5 passes for 44 and another TD in Sunday\'s overtime win at Dallas. His 33.6 points led every back in football. Jeremiyah Love ran 9 times for 23 and came out of it with what Mike LaFleur calls a "new" ankle injury, and Bam Knight is in the concussion protocol. Arizona is at Seattle and is implied for 16.5.',
    pro: 'The best back on the wire, with both backs on the chart around him hurt.',
    con: 'Arizona\'s 16.5 is the week\'s lowest team total, and Love (94.9%) may play. LaFleur has promised an update later this week.',
  },
  {
    id: 'chris-rodriguez', rank: 2, name: 'Chris Rodriguez Jr.', pos: 'RB', team: 'JAX', matchup: 'at BAL (Thu)',
    min: 8, max: 12, rostered: '12.6% rostered', window: 'If Tuten sits', windowTone: 'var(--warning)',
    take: 'Rodriguez ran for 41 yards and a TD on 6 carries and caught a 17-yard pass in the 42-7 win over Indianapolis, worth 12.3 points. Bhayshul Tuten (93.5%) scored 28.9 but was a non-participant at Monday\'s walkthrough with ankle and foot injuries, and Jacksonville plays again Thursday. The Jaguars are 8.5-point favorites at Baltimore and are implied for 25.5.',
    pro: 'Second on Jacksonville\'s chart, in a 25.5 implied total, on a short week.',
    con: 'Rodriguez was limited Monday with a hand injury, and if Tuten plays this is a 6% target share behind him.',
  },
  {
    id: 'adonai-mitchell', rank: 3, name: 'Adonai Mitchell', pos: 'WR', team: 'NYJ', matchup: 'at KC',
    min: 6, max: 10, rostered: '11.4% rostered', window: 'If Cooper sits', windowTone: 'var(--warning)',
    take: 'Mitchell caught 7 passes for 142 yards and a TD on a 29% target share, worth 23.7 points, in the 38-33 loss to Las Vegas. Omar Cooper Jr. was not in the box score, with no designation in our data. The Jets are 9.5-point underdogs at Kansas City and are implied for 18.5.',
    pro: 'A 29% share at 11.4% rostered, and the Jets will be throwing from behind.',
    con: 'One week. He had a 10% share the week before, and KC Concepcion\'s 29% fell to 10% last week. Cooper (69.6%) coming back ends this.',
  },
];

// Bid ranges, % of a $100 budget. Big Three first, then the top of the priced board.
const LADDER = [
  ['Tyler Allgeier', 'RB', 12, 18, true],
  ['Chris Rodriguez Jr.', 'RB', 8, 12, true],
  ['Adonai Mitchell', 'WR', 6, 10, true],
  ['Sam Darnold', 'QB', 5, 8, false],
  ['Antonio Williams', 'WR', 5, 8, false],
  ['Kirk Cousins', 'QB', 4, 8, false],
  ['Devin Singletary', 'RB', 4, 7, false],
  ['Mike Washington Jr.', 'RB', 3, 6, false],
  ['Mike Gesicki', 'TE', 3, 6, false],
  ['Geno Smith', 'QB', 3, 5, false],
];

// Implied points for the offense each defense faces. Lower is better for the defense.
const DST_TARGETS = [
  { def: 'SEA', opp: 'ARI', pts: 16.5, kind: 'stream' },
  { def: 'JAX', opp: 'BAL', pts: 17, kind: 'stream' },
  { def: 'HOU', opp: 'LAC', pts: 18, kind: 'stream' },
  { def: 'KC', opp: 'NYJ', pts: 18.5, kind: 'stream' },
  { def: 'NYG', opp: 'PHI', pts: 18.5, kind: 'stream' },
  { def: 'DEN', opp: 'CAR', pts: 20.25, kind: 'stream' },
  { def: 'CHI', opp: 'TB', pts: 20.25, kind: 'stream' },
  { def: 'BAL', opp: 'JAX', pts: 25.5, kind: 'avoid' },
  { def: 'WSH', opp: 'LAR', pts: 26.5, kind: 'avoid' },
  { def: 'ATL', opp: 'CIN', pts: 27.75, kind: 'avoid' },
  { def: 'ARI', opp: 'SEA', pts: 28, kind: 'avoid' },
  { def: 'NYJ', opp: 'KC', pts: 28, kind: 'avoid' },
  { def: 'IND', opp: 'DAL', pts: 28.75, kind: 'avoid' },
  { def: 'MIA', opp: 'DET', pts: 28.75, kind: 'avoid' },
  { def: 'LV', opp: 'SF', pts: 30.75, kind: 'avoid' },
];

const Body = () => (
  <>
    <HeroBanner />
    <Lead>
      Week 8 took Lamar Jackson on Baltimore&apos;s first snap and Tyler Huntley in the second
      quarter, and Tampa Bay won 16-0 without completing a pass. Tyler Allgeier scored 33.6 points
      in Dallas and is still on the wire in more than half of leagues. Last week&apos;s Big Three
      went one hit, one miss and one blank. Let&apos;s spend.
    </Lead>
    <P>
      Every bid below is a percentage of a $100 FAAB budget. The league is half-PPR with one
      quarterback slot and a superflex. Rostered figures come from our own snapshot, taken early
      Tuesday. Lines are ESPN&apos;s as of Tuesday. Injury statuses are our database as of
      Tuesday with Monday&apos;s reporting layered on, and where the two disagree I trust the
      database and say so. Pittsburgh and Tennessee are on bye, so 30 teams play. Thursday is
      Jacksonville at Baltimore at 8:15 p.m. ET. Sunday opens at 9:30 a.m. ET with Cincinnati and
      Atlanta in Madrid, then the 1:00, 4:05 and 4:25 p.m. ET kickoffs. Sunday night is Tampa Bay
      at Chicago, and Monday night is Buffalo at Minnesota. Week 8 snap counts are not in our data
      yet, so I quote yards, catches, target share and points, plus carries from ESPN&apos;s box
      scores.
    </P>

    <H2>The Big Three</H2>
    <P>
      Allgeier for the backfield, Rodriguez for Thursday, Mitchell for the target share. All three
      are conditional windows, so price the second bet. Rodriguez has to be claimed first, because
      Jacksonville locks Thursday night.
    </P>
    {BIG_THREE.map((p) => <PriorityCard key={p.id} p={p} />)}
    <H3>Not in the Big Three: Devin Singletary</H3>
    <P>
      Singletary (RB, NYG, 3.6% rostered) is the cheapest job on the board if it opens. John
      Harbaugh calls Cam Skattebo&apos;s hamstring day-to-day and a possible game-time decision, and
      Tyrone Tracy Jr. is on IR. Singletary scored 13.0 in Week 7 before the bye, and the Giants are
      3.5-point favorites at Philadelphia, implied for 22.0. That is why he is a 4&ndash;7% bid at
      3.6%, and it is also why he is not a Big Three bid: Skattebo could play.
    </P>

    <H2>The FAAB Ladder</H2>
    <P>
      The top of the priced board on one scale. Highlighted bars are the Big Three. Anything that
      tops out at 8% or less is a cheap bid: pick a number in the range and don&apos;t lose sleep.
      Singletary is the one to watch, because his whole value is a Friday injury report.
    </P>
    <FaabLadder ladder={LADDER} />

    <H2>The Full Board</H2>
    <P>
      Window is how long the role should last. Season means no starter is coming back to take it,
      and &quot;If X sits&quot; means exactly that. Rostered% is our snapshot, so a name at 40%
      is already in two out of five leagues out there.
    </P>
    <Table aria-label="Week 9 offensive waiver board">
      <THead>
        <TR>
          <TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Team</TH><TH scope="col">Why</TH><TH scope="col">Wk 9</TH><TH scope="col">Window</TH><TH scope="col">Bid</TH><TH scope="col">Rostered%</TH>
        </TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Tyler Allgeier</strong></TD><TD>RB</TD><TD>ARI</TD><TD>147 yards on 11 carries, 5 catches, two TDs. Love and Knight are hurt.</TD><TD>at SEA</TD><TD>If Love sits</TD><TD>12&ndash;18%</TD><TD>45.9%</TD></TR>
        <TR><TD>2</TD><TD><strong>Chris Rodriguez Jr.</strong></TD><TD>RB</TD><TD>JAX</TD><TD>41 yards and a TD on 6 carries. Tuten missed Monday&apos;s walkthrough.</TD><TD>at BAL (Thu)</TD><TD>If Tuten sits</TD><TD>8&ndash;12%</TD><TD>12.6%</TD></TR>
        <TR><TD>3</TD><TD><strong>Adonai Mitchell</strong></TD><TD>WR</TD><TD>NYJ</TD><TD>7 for 142 and a TD on a 29% target share. Cooper was not in the box score.</TD><TD>at KC</TD><TD>If Cooper sits</TD><TD>6&ndash;10%</TD><TD>11.4%</TD></TR>
        <TR><TD>4</TD><TD><strong>Sam Darnold</strong></TD><TD>QB</TD><TD>SEA</TD><TD>11.0, 14.0 and 17.5 the last three weeks. Seattle implied 28.0.</TD><TD>vs ARI</TD><TD>Season</TD><TD>5&ndash;8%</TD><TD>30.8%</TD></TR>
        <TR><TD>5</TD><TD><strong>Antonio Williams</strong></TD><TD>WR</TD><TD>WSH</TD><TD>5 for 54 on a 26% share in his first game without McLaurin.</TD><TD>vs LAR</TD><TD>Season</TD><TD>5&ndash;8%</TD><TD>16.3%</TD></TR>
        <TR><TD>6</TD><TD><strong>Kirk Cousins</strong></TD><TD>QB</TD><TD>LV</TD><TD>18.5, 20.4 and 28.2 the last three weeks. Three TD passes and a TD run.</TD><TD>at SF</TD><TD>Season</TD><TD>4&ndash;8%</TD><TD>60.2%</TD></TR>
        <TR><TD>7</TD><TD><strong>Devin Singletary</strong></TD><TD>RB</TD><TD>NYG</TD><TD>Skattebo is day-to-day with a hamstring and Tracy is on IR. 13.0 in Week 7.</TD><TD>at PHI</TD><TD>If Skattebo sits</TD><TD>4&ndash;7%</TD><TD>3.6%</TD></TR>
        <TR><TD>8</TD><TD><strong>Mike Washington Jr.</strong></TD><TD>RB</TD><TD>LV</TD><TD>83 yards on 25 carries. Jeanty had 2 carries in a reduced role.</TD><TD>at SF</TD><TD>If the role holds</TD><TD>3&ndash;6%</TD><TD>17.5%</TD></TR>
        <TR><TD>9</TD><TD><strong>Mike Gesicki</strong></TD><TD>TE</TD><TD>CIN</TD><TD>4 for 76 and a TD in a 43-36 game. Erick All is out for the season.</TD><TD>at ATL (Madrid)</TD><TD>Season</TD><TD>3&ndash;6%</TD><TD>15.1%</TD></TR>
        <TR><TD>10</TD><TD><strong>Geno Smith</strong></TD><TD>QB</TD><TD>NYJ</TD><TD>290 yards and 2 TDs, 18.0 points after 23.5.</TD><TD>at KC</TD><TD>Superflex stream</TD><TD>3&ndash;5%</TD><TD>32.8%</TD></TR>
        <TR><TD>11</TD><TD><strong>Keenan Allen</strong></TD><TD>WR</TD><TD>IND</TD><TD>7 for 67 on a 23% share. Dallas game, 51.5 total.</TD><TD>vs DAL</TD><TD>Season</TD><TD>3&ndash;5%</TD><TD>41.6%</TD></TR>
        <TR><TD>12</TD><TD><strong>Emmett Johnson</strong></TD><TD>RB</TD><TD>KC</TD><TD>5 for 128 and a TD on a 13% share, and one carry. Chiefs implied 28.0.</TD><TD>vs NYJ</TD><TD>Stream</TD><TD>2&ndash;4%</TD><TD>11.8%</TD></TR>
        <TR><TD>13</TD><TD><strong>Michael Mayer</strong></TD><TD>TE</TD><TD>LV</TD><TD>5 for 53 on a 24% share, after 23% two weeks ago.</TD><TD>at SF</TD><TD>Season</TD><TD>2&ndash;4%</TD><TD>22.9%</TD></TR>
        <TR><TD>14</TD><TD><strong>Ryan Flournoy</strong></TD><TD>WR</TD><TD>DAL</TD><TD>13.5, 9.0 and 11.6 the last three weeks. Dallas implied 28.75.</TD><TD>at IND</TD><TD>Stream</TD><TD>2&ndash;4%</TD><TD>22.1%</TD></TR>
        <TR><TD>15</TD><TD><strong>Gardner Minshew II</strong></TD><TD>QB</TD><TD>ARI</TD><TD>188 yards and 3 TDs in relief of Brissett. Named the starter Monday.</TD><TD>at SEA</TD><TD>As the starter</TD><TD>2&ndash;4%</TD><TD>0.0%</TD></TR>
        <TR><TD>16</TD><TD><strong>Michael Penix Jr.</strong></TD><TD>QB</TD><TD>ATL</TD><TD>Four picks in the rain, after 23.1 and 20.4. 52.5 total.</TD><TD>vs CIN (Madrid)</TD><TD>Superflex stream</TD><TD>2&ndash;4%</TD><TD>18.6%</TD></TR>
        <TR><TD>17</TD><TD><strong>Treylon Burks</strong></TD><TD>WR</TD><TD>WSH</TD><TD>3 for 81 on a 19% share, 17% in Week 6.</TD><TD>vs LAR</TD><TD>Season</TD><TD>2&ndash;4%</TD><TD>6.5%</TD></TR>
        <TR><TD>18</TD><TD><strong>Efton Chism III</strong></TD><TD>WR</TD><TD>NE</TD><TD>5 for 37 on a 26% share with A.J. Brown out.</TD><TD>vs GB</TD><TD>If Brown sits</TD><TD>2&ndash;4%</TD><TD>2.8%</TD></TR>
        <TR><TD>19</TD><TD><strong>Eli Raridon</strong></TD><TD>TE</TD><TD>NE</TD><TD>21% share; Henry left with a foot injury in the second quarter.</TD><TD>vs GB</TD><TD>If Henry sits</TD><TD>2&ndash;4%</TD><TD>1.9%</TD></TR>
        <TR><TD>20</TD><TD><strong>Dylan Sampson</strong></TD><TD>RB</TD><TD>CLE</TD><TD>6 for 62 on a 20% share behind Judkins.</TD><TD>at NO</TD><TD>Handcuff</TD><TD>2&ndash;3%</TD><TD>11.6%</TD></TR>
        <TR><TD>21</TD><TD><strong>Malik Willis</strong></TD><TD>QB</TD><TD>MIA</TD><TD>211 yards and 2 TDs, 14.6 points after 26.0.</TD><TD>vs DET</TD><TD>As the starter</TD><TD>2&ndash;3%</TD><TD>10.6%</TD></TR>
        <TR><TD>22</TD><TD><strong>Chris Bell</strong></TD><TD>WR</TD><TD>MIA</TD><TD>4 for 31 on a 17% share, 19% the week before.</TD><TD>vs DET</TD><TD>Season</TD><TD>1&ndash;3%</TD><TD>1.5%</TD></TR>
        <TR><TD>23</TD><TD><strong>Jahan Dotson</strong></TD><TD>WR</TD><TD>ATL</TD><TD>2 for 95 on a 22% share.</TD><TD>vs CIN (Madrid)</TD><TD>Stream</TD><TD>1&ndash;3%</TD><TD>2.8%</TD></TR>
        <TR><TD>24</TD><TD><strong>Sione Vaki</strong></TD><TD>RB</TD><TD>DET</TD><TD>65 yards on 11 carries. Saylors (neck) is not expected to practice Wednesday.</TD><TD>at MIA</TD><TD>Handcuff</TD><TD>1&ndash;2%</TD><TD>0.7%</TD></TR>
        <TR><TD>25</TD><TD><strong>Austin Ekeler</strong></TD><TD>RB</TD><TD>WSH</TD><TD>36 yards on 8 carries. McNichols is expected to miss months.</TD><TD>vs LAR</TD><TD>Handcuff</TD><TD>1&ndash;2%</TD><TD>1.6%</TD></TR>
      </TBody>
    </Table>
    <P>
      Several of these bids hang on an injury report. Allgeier needs Love out, Rodriguez needs Tuten out, Mitchell needs Cooper out, Singletary needs Skattebo out, Chism needs Brown out and Raridon needs Henry out. Only Allgeier tops 12%.
    </P>
    <P>
      Off the board, for a dollar if your wire is thin: Elijah Mitchell (PHI RB, 3.1%), with Dameon
      Pierce, Tank Bigsby and Will Shipley all on IR behind Saquon Barkley, and Brevyn Spann-Ford
      (DAL TE, 0.1%), 4 for 31 on an 18% share if Jake Ferguson sits. Terrance Ferguson (LAR TE,
      12.1%) is the stash: Sean McVay says it is &quot;looking more likely than not&quot; that he
      practices this week.
    </P>

    <H2>Superflex Corner</H2>
    <P>
      Quarterbacks are where this format is won on the wire, so here is the ranking, with Week 8
      points.
    </P>
    <UL>
      <LI>
        <strong>Sam Darnold</strong> (SEA, 30.8% rostered) is first at 17.5, up each of the last
        three weeks. Seattle hosts Arizona and is implied for 28.0.
      </LI>
      <LI>
        <strong>Kirk Cousins</strong> (LV, 60.2%) scored 28.2 with three TD passes and a TD run. Las
        Vegas is at San Francisco, implied for 20.75. If he is on your wire, he comes before everyone
        but Darnold.
      </LI>
      <LI>
        <strong>Geno Smith</strong> (NYJ, 32.8%) scored 18.0, after 23.5. The Jets are at Kansas
        City, implied for 18.5, and will be throwing.
      </LI>
      <LI>
        <strong>Gardner Minshew II</strong> (ARI, 0.0%) scored 19.5 in relief, 17 of 23 for 188 yards
        and 3 TDs. The Cardinals named him their starter Monday and moved Brissett to third on the chart. Arizona is implied for 16.5.
      </LI>
      <LI>
        <strong>Michael Penix Jr.</strong> (ATL, 18.6%) scored -1.9, 8 of 24 with four interceptions
        in a driving rain. He scored 23.1 and 20.4 the two weeks before. Atlanta is implied for 24.75
        against Cincinnati in Madrid, in a 52.5 total.
      </LI>
      <LI>
        <strong>Malik Willis</strong> (MIA, 10.6%) scored 14.6 and hosts Detroit, with Miami implied
        for 21.75.
      </LI>
      <LI>
        <strong>Deshaun Watson</strong> (CLE, 12.8%) threw for 324 yards and no TDs, worth 11.2. He is
        at New Orleans, with Cleveland implied for 20.5.
      </LI>
      <LI>
        <strong>J.J. McCarthy</strong> (NYG, 15.4%) comes off the bye as a road favorite, with the
        Giants implied for 22.0. He scored 16.3 and 10.2 before it. <strong>Tanner McKee</strong> (PHI, 4.4%) scored 7.0, and Philadelphia is implied for 18.5.
      </LI>
      <LI>
        <strong>Hold, do not cut:</strong> Bo Nix (55.8%) scored 19.3 and is at Carolina, with Denver
        implied for 23.25.
      </LI>
      <LI>
        <strong>Carson Wentz</strong> (MIN, 0.4%) is next on Minnesota&apos;s chart. Kyler Murray
        (60.1%) has a sore hamstring and is undergoing a full evaluation. A dollar, and only if you
        need the cover.
      </LI>
      <LI>
        <strong>Avoid Jacoby Brissett</strong> (ARI, 23.8%, 3.5): ESPN&apos;s recap calls him
        ineffective, and Minshew replaced him in the third quarter. <strong>Avoid Baltimore</strong> too:
        Huntley (2.5%) has a toe injury that Jesse Minter says &quot;probably&quot; keeps him out
        Thursday, and Joe Fagnano (0.0%), who finished Sunday&apos;s game, was limited Monday with an
        ankle. The Ravens are implied for 17.0.
      </LI>
      <LI>
        <strong>Avoid Justin Herbert</strong> (LAC, 34.4%, 7.8): the Chargers are 0-7 and implied for
        18.0. <strong>Avoid Baker Mayfield</strong> (TB, 26.2%, 1.4), who went 0 for 3 in his second game
        back from a fractured thumb, and <strong>Daniel Jones</strong> (IND, 11.9%, 6.5), who threw for
        144 yards and 2 interceptions in the 42-7 loss.
      </LI>
      <LI>
        On bye and useless this week: Pittsburgh (Aaron Rodgers) and Tennessee (Cam Ward, who scored
        26.3).
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
        <strong>Seattle</strong> hosts Arizona (16.5), the best number on the board, with Minshew newly named the starter and Love, Knight and Michael Wilson (two broken ribs) all
        questionable. The Seattle D/ST scored 10, 14 and 2 the last three weeks.
      </LI>
      <LI>
        <strong>Jacksonville</strong> at Baltimore (17.0) on Thursday. The Jaguars D/ST scored 24.5 last week and faces a Ravens team without Jackson, with Huntley unlikely and Fagnano limited.
      </LI>
      <LI>
        <strong>Houston</strong> at the Chargers (18.0) comes off a bye, against an 0-7 team and a
        quarterback with no TDs and 2 interceptions last week. The Houston D/ST scored 0 and 2 before the bye,
        so this is about the opponent.
      </LI>
      <LI>
        <strong>Kansas City</strong> hosts the Jets (18.5), and its D/ST scored 19, 2 and 4.{' '}
        <strong>The Giants</strong> at Philadelphia (18.5) come off a bye, and their D/ST scored 2 and 5 before it.
      </LI>
      <LI>
        <strong>Denver</strong> at Carolina (20.25) has a D/ST that scored 12, 4 and 2.{' '}
        <strong>Chicago</strong> hosts Tampa Bay (20.25) on Sunday night, and its D/ST scored 15, 4 and 12.
      </LI>
    </UL>
    <P>
      <strong>Avoid:</strong> Las Vegas (faces San Francisco, 30.75), Indianapolis (faces Dallas,
      28.75), Miami (faces Detroit, 28.75), Arizona and the Jets (both face 28.0), Atlanta (faces
      Cincinnati, 27.75), Washington (faces the Rams, 26.5) and Baltimore (faces Jacksonville, 25.5).
      The grey bars above are those defenses. The Tampa Bay D/ST scored 29 and 22 the last two weeks and faces
      Chicago at 26.25, so do not chase it.
    </P>

    <H2>Kickers</H2>
    <P>
      Kicker ownership is in our snapshot. The play is a kicker on an offense that scores, and the
      best number this week is San Francisco&apos;s, at 30.75 in a 51.5 total. Points are Week 7
      then Week 8.
    </P>
    <Table aria-label="Week 9 kicker streamers">
      <THead>
        <TR>
          <TH scope="col">#</TH><TH scope="col">Kicker</TH><TH scope="col">Team</TH><TH scope="col">Team total</TH><TH scope="col">Rostered%</TH>
        </TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Eddy Pineiro</strong></TD><TD>SF</TD><TD>30.75 vs LV in a 51.5 total; 2 in Week 7, bye in Week 8</TD><TD>36.7%</TD></TR>
        <TR><TD>2</TD><TD><strong>Jake Bates</strong></TD><TD>DET</TD><TD>28.75 at MIA; 9 and 7</TD><TD>40.8%</TD></TR>
        <TR><TD>3</TD><TD><strong>Evan McPherson</strong></TD><TD>CIN</TD><TD>27.75 at ATL in a 52.5 total; 5 and 5</TD><TD>22.8%</TD></TR>
        <TR><TD>4</TD><TD><strong>Brandon McManus</strong></TD><TD>LAR</TD><TD>26.5 at WSH; 5 and 6</TD><TD>0.5%</TD></TR>
        <TR><TD>5</TD><TD><strong>Cairo Santos</strong></TD><TD>CHI</TD><TD>26.25 vs TB on Sunday night; 15 and 11</TD><TD>26.7%</TD></TR>
      </TBody>
    </Table>
    <P>
      Bye cover: Chris Boswell (PIT, 80.1%) and Joey Slye (TEN) are off. Tyler Loop (BAL, 57.4%) may
      go on IR, according to Brian Wacker of the Baltimore Sun. Tyler Bass was last week&apos;s top
      kicker at 9.6% and is at 65.5% after scoring 16.
    </P>

    <H2>IDP Waiver Board</H2>
    <P>
      Lines are Week 8 box scores from our database. IDP rostered percentages are not tracked, so I
      can&apos;t tell you who is sitting on your wire. Tackle volume is the currency at linebacker
      and safety. Pressure is the currency on the line. The Jets are 9.5-point underdogs at Kansas
      City and Las Vegas is a 10-point underdog at San Francisco, so both defenses will be on the
      field. Jamien Sherwood and Dane Belton are the Jets&apos; tackle floor; Jeremy Chinn and Eric
      Stokes are the Raiders&apos;.
    </P>
    <H3>Linebacker</H3>
    <Table aria-label="IDP linebackers">
      <THead>
        <TR><TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Team</TH><TH scope="col">Type</TH><TH scope="col">Week 8</TH><TH scope="col">Wk 9</TH></TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Ty&apos;Ron Hopper</strong></TD><TD>GB</TD><TD><Tag kind="both" /></TD><TD>6 solo and 2 assisted tackles, a sack, an interception and 3 passes defended.</TD><TD>at NE</TD></TR>
        <TR><TD>2</TD><TD><strong>Alex Singleton</strong></TD><TD>DEN</TD><TD><Tag kind="T" /></TD><TD>6 solo and 8 assisted tackles and a sack.</TD><TD>at CAR</TD></TR>
        <TR><TD>3</TD><TD><strong>Eric Wilson</strong></TD><TD>MIN</TD><TD><Tag kind="both" /></TD><TD>7 solo and 4 assisted tackles, a sack and 2 tackles for loss.</TD><TD>vs BUF</TD></TR>
        <TR><TD>4</TD><TD><strong>Alex Anzalone</strong></TD><TD>TB</TD><TD><Tag kind="BP" /></TD><TD>3 solo and 3 assisted tackles, 2 interceptions and 2 passes defended.</TD><TD>at CHI</TD></TR>
        <TR><TD>5</TD><TD><strong>Foyesade Oluokun</strong></TD><TD>JAX</TD><TD><Tag kind="both" /></TD><TD>5 solo and 4 assisted tackles, a sack and 2 tackles for loss.</TD><TD>at BAL (Thu)</TD></TR>
        <TR><TD>6</TD><TD><strong>Jamien Sherwood</strong></TD><TD>NYJ</TD><TD><Tag kind="T" /></TD><TD>5 solo and 9 assisted tackles.</TD><TD>at KC</TD></TR>
      </TBody>
    </Table>
    <H3>Defensive line and edge</H3>
    <Table aria-label="IDP defensive line">
      <THead>
        <TR><TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Team</TH><TH scope="col">Week 8</TH><TH scope="col">Wk 9</TH></TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Quinnen Williams</strong></TD><TD>DT</TD><TD>DAL</TD><TD>4 solo and 3 assisted tackles, 2 sacks and 2 tackles for loss.</TD><TD>at IND</TD></TR>
        <TR><TD>2</TD><TD><strong>Dexter Lawrence II</strong></TD><TD>DT</TD><TD>CIN</TD><TD>4 solo and 3 assisted tackles and a sack.</TD><TD>at ATL (Madrid)</TD></TR>
        <TR><TD>3</TD><TD><strong>Dorance Armstrong</strong></TD><TD>DE</TD><TD>WSH</TD><TD>4 solo and 3 assisted tackles, a sack and a forced fumble.</TD><TD>vs LAR</TD></TR>
        <TR><TD>4</TD><TD><strong>Jeffery Simmons</strong></TD><TD>DT</TD><TD>CHI</TD><TD>3 solo and 3 assisted tackles, a sack and 2 tackles for loss.</TD><TD>vs TB</TD></TR>
        <TR><TD>5</TD><TD><strong>George Karlaftis</strong></TD><TD>DE</TD><TD>KC</TD><TD>A sack, a forced fumble and 3 passes defended.</TD><TD>vs NYJ</TD></TR>
      </TBody>
    </Table>
    <H3>Defensive back</H3>
    <Table aria-label="IDP defensive backs">
      <THead>
        <TR><TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Team</TH><TH scope="col">Type</TH><TH scope="col">Week 8</TH><TH scope="col">Wk 9</TH></TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Dane Belton</strong></TD><TD>S</TD><TD>NYJ</TD><TD><Tag kind="T" /></TD><TD>9 solo and 3 assisted tackles.</TD><TD>at KC</TD></TR>
        <TR><TD>2</TD><TD><strong>Jordan Battle</strong></TD><TD>S</TD><TD>CIN</TD><TD><Tag kind="T" /></TD><TD>9 solo and 3 assisted tackles and 2 passes defended.</TD><TD>at ATL (Madrid)</TD></TR>
        <TR><TD>3</TD><TD><strong>Jeremy Chinn</strong></TD><TD>S</TD><TD>LV</TD><TD><Tag kind="both" /></TD><TD>4 solo and 6 assisted tackles and an interception.</TD><TD>at SF</TD></TR>
        <TR><TD>4</TD><TD><strong>Jacob Parrish</strong></TD><TD>CB</TD><TD>TB</TD><TD><Tag kind="BP" /></TD><TD>4 solo and 3 assisted tackles, an interception and 2 passes defended.</TD><TD>at CHI</TD></TR>
        <TR><TD>5</TD><TD><strong>Eric Stokes</strong></TD><TD>CB</TD><TD>LV</TD><TD><Tag kind="T" /></TD><TD>7 solo and 1 assisted tackle and 2 passes defended.</TD><TD>at SF</TD></TR>
        <TR><TD>6</TD><TD><strong>Rayuan Lane III</strong></TD><TD>S</TD><TD>JAX</TD><TD><Tag kind="BP" /></TD><TD>An interception returned 92 yards for a TD and 3 passes defended.</TD><TD>at BAL (Thu)</TD></TR>
      </TBody>
    </Table>
    <P>
      Tackle-heavy scoring: bump the Tackles tags a tier. Big-play scoring: bump the Big play tags.
      Hopper, Wilson, Oluokun and Chinn carry both.
    </P>

    <H2>The Injury Ledger</H2>
    <H3>Out or on IR</H3>
    <UL>
      <LI><strong>Lamar Jackson</strong> (BAL QB): hurt his right thumb on Baltimore&apos;s first snap. Minter says he will have surgery and go on IR. Hold him in an IR slot.</LI>
      <LI><strong>Jaylin Noel</strong> (HOU WR): IR, toe surgery, expected to miss the rest of the season. Cut.</LI>
      <LI><strong>RJ Harvey</strong> (DEN RB): placed on IR Saturday, knee. Jonah Coleman (52.3%) scored 18.4 with Harvey out, so he is no longer a bargain.</LI>
      <LI><strong>Dameon Pierce</strong>, <strong>Tank Bigsby</strong> and <strong>Will Shipley</strong> (PHI RB): all on IR. Elijah Mitchell ran 11 times for 34 and caught 4 passes for 3 yards behind Barkley.</LI>
      <LI><strong>Kendrick Bourne</strong> (ARI WR): expected to miss the rest of the season, ankle (Jonathan Jones). <strong>Jalen Brooks</strong> (ARI WR) is on IR, wrist.</LI>
      <LI><strong>Erick All Jr.</strong> (CIN TE): torn ACL, season-ending surgery (Zac Taylor). Gesicki.</LI>
      <LI><strong>Jeremy McNichols</strong> (WSH RB): doubtful, foot, with an expectation that he misses multiple months (Tashan Reed). Ekeler.</LI>
      <LI><strong>Terry McLaurin</strong> (WSH WR): had surgery Friday on the torn patellar tendon. <strong>Jalen Hurts</strong> (PHI QB): IR, blood clots, expected to miss the rest of the season. <strong>De&apos;Von Achane</strong> (MIA RB) and <strong>Jacory Croskey-Merritt</strong> (WSH RB): IR.</LI>
      <LI><strong>Davante Adams</strong> (LAR WR): IR, successful hamstring surgery, on a 6-to-10-week timetable (McVay).</LI>
      <LI><strong>Jordyn Tyson</strong> (NO WR): IR, hamstring. The Saints decide by Wednesday whether to open his 21-day window. A stash, at 35.4%. <strong>Travis Etienne Jr.</strong> (NO RB) is on IR too, hamstring, and was to be evaluated Monday.</LI>
      <LI><strong>Jonathon Brooks</strong> (CAR RB): IR, core. Dave Canales says he will &quot;potentially&quot; be designated for return this week.</LI>
      <LI><strong>Michael Pittman Jr.</strong> (PIT WR): IR, foot. He resumed running last week with no clear timeline. <strong>Romeo Doubs</strong> (NE WR): IR, hopeful to return after the Week 11 bye. <strong>James Conner</strong> (ARI RB): IR. LaFleur says he will &quot;potentially&quot; play this season.</LI>
      <LI><strong>Zachariah Branch</strong> (ATL WR): out, hamstring. Stefanski says he won&apos;t play Sunday. Dotson.</LI>
      <LI><strong>Carnell Tate</strong> (TEN WR) and <strong>Tyjae Spears</strong> (TEN RB): out, and Tennessee is on bye.</LI>
    </UL>
    <H3>Questionable and day-to-day</H3>
    <UL>
      <LI><strong>Jeremiyah Love</strong> (ARI RB): a &quot;new&quot; ankle injury from Sunday, with an update coming later this week (LaFleur). Allgeier.</LI>
      <LI><strong>Bam Knight</strong> (ARI RB): concussion protocol. <strong>Michael Wilson</strong> (ARI WR): two broken ribs, by his own account, after 8 catches for 111 and a TD.</LI>
      <LI><strong>Bhayshul Tuten</strong> (JAX RB): non-participant at Monday&apos;s walkthrough, ankle and foot. Thursday game. <strong>Chris Rodriguez Jr.</strong> was limited, hand. <strong>Jakobi Meyers</strong> (JAX WR) is questionable.</LI>
      <LI><strong>Cam Skattebo</strong> (NYG RB): hamstring, day-to-day, possible game-time decision (Harbaugh). Singletary.</LI>
      <LI><strong>Tyler Huntley</strong> (BAL QB): toe, &quot;probably&quot; out Thursday (Minter). <strong>Joe Fagnano</strong> (BAL QB): limited, ankle. <strong>Justice Hill</strong> (BAL RB): limited, groin.</LI>
      <LI><strong>Kyler Murray</strong> (MIN QB): sore hamstring, undergoing a full evaluation (Alec Lewis). Monday game. Wentz.</LI>
      <LI><strong>Matthew Stafford</strong> (LAR QB): left Sunday with ice on his right arm, and McVay acknowledged arm soreness.</LI>
      <LI><strong>Hunter Henry</strong> (NE TE): foot, left in the second quarter at Miami and did not return. Raridon.</LI>
      <LI><strong>A.J. Brown</strong> (NE WR): ankle and knee, missed Week 8. Asked if Brown might practice this week, Mike Vrabel said &quot;We&apos;ll see.&quot; Chism.</LI>
      <LI><strong>Breece Hall</strong> (NYJ RB): quadriceps, considered &quot;good to go&quot; for Kansas City (Rapoport). Braelon Allen (83.4%) ran for 147 and a TD on 21 carries.</LI>
      <LI><strong>Omar Cooper Jr.</strong> (NYJ WR): not in Sunday&apos;s box score, and our data carries no designation for him. Check Wednesday&apos;s report. Mitchell.</LI>
      <LI><strong>Jake Ferguson</strong> (DAL TE): ankle, &quot;has a chance&quot; to play Sunday (Brian Schottenheimer). Spann-Ford.</LI>
      <LI><strong>David Montgomery</strong> (HOU RB): groin, &quot;no significant update&quot; (DeMeco Ryans). Woody Marks (69.6%).</LI>
      <LI><strong>DJ Moore</strong> (BUF WR) says he is okay after a late knee exit, and <strong>Christian Watson</strong> (GB WR) is sore with ribs but &quot;doing great.&quot;</LI>
      <LI><strong>Christian McCaffrey</strong>, <strong>Mike Evans</strong> and <strong>Deebo Samuel Sr.</strong> (SF): still questionable coming off the bye, with no new report in our data. Cut Kaelon Black once McCaffrey practices.</LI>
      <LI><strong>Jacob Saylors</strong> (DET RB): neck, not expected to practice Wednesday. Vaki.</LI>
      <LI><strong>Kyle Monangai</strong> (CHI RB), <strong>TreVeyon Henderson</strong> (NE RB), <strong>Emeka Egbuka</strong> (TB WR), <strong>DeVonta Smith</strong> and <strong>Dontayvion Wicks</strong> (PHI WR), <strong>Rashid Shaheed</strong> (SEA WR), <strong>Colby Parkinson</strong> (LAR TE) and <strong>Brian Robinson Jr.</strong> (ATL RB): questionable, no new detail. None of them recorded a stat in Week 8.</LI>
    </UL>

    <H2>Receipts: Grading Week 8</H2>
    <P>
      Last week&apos;s board, graded in half-PPR points from our database. The hits first.
    </P>
    <Table aria-label="Week 8 board hits">
      <THead>
        <TR><TH scope="col">Player</TH><TH scope="col">Points</TH><TH scope="col">Wk 8 bid</TH></TR>
      </THead>
      <TBody>
        <TR><TD><strong>Jonah Coleman</strong></TD><TD>18.4</TD><TD>10&ndash;16%</TD></TR>
        <TR><TD><strong>Geno Smith</strong></TD><TD>18.0</TD><TD>2&ndash;4%</TD></TR>
        <TR><TD><strong>Malik Willis</strong></TD><TD>14.6</TD><TD>4&ndash;8%</TD></TR>
        <TR><TD><strong>Ryan Flournoy</strong></TD><TD>11.6</TD><TD>1&ndash;2%</TD></TR>
        <TR><TD><strong>Deshaun Watson</strong></TD><TD>11.2</TD><TD>2&ndash;3%</TD></TR>
      </TBody>
    </Table>
    <P>
      Coleman ran for 41 yards and a TD and caught 4 for 63. Smith threw for 290 yards and 2 TDs.
      Willis threw for 211 and 2. Flournoy caught a TD and has scored 9 or more three straight weeks,
      on a 1&ndash;2% bid. Watson threw for 324 and no TDs. Now the misses and the shrugs.
    </P>
    <Table aria-label="Week 8 board misses and pushes">
      <THead>
        <TR><TH scope="col">Player</TH><TH scope="col">Points</TH><TH scope="col">Wk 8 bid</TH><TH scope="col">What happened</TH></TR>
      </THead>
      <TBody>
        <TR><TD><strong>Dylan Sampson</strong></TD><TD>9.9</TD><TD>1&ndash;2%</TD><TD>A push: 6 for 62.</TD></TR>
        <TR><TD><strong>Makai Lemon</strong></TD><TD>8.7</TD><TD>4&ndash;7%</TD><TD>A push, on a 28% share.</TD></TR>
        <TR><TD><strong>Antonio Williams</strong></TD><TD>7.9</TD><TD>4&ndash;7%</TD><TD>A push, on a 26% share.</TD></TR>
        <TR><TD><strong>Tanner McKee</strong></TD><TD>7.0</TD><TD>2&ndash;4%</TD><TD>A push: the job, not the points.</TD></TR>
        <TR><TD><strong>Greg Dulcich</strong></TD><TD>6.3</TD><TD>3&ndash;5%</TD><TD>A push.</TD></TR>
        <TR><TD><strong>Caleb Douglas</strong></TD><TD>6.3</TD><TD>$1</TD><TD>A push.</TD></TR>
        <TR><TD><strong>KC Concepcion</strong></TD><TD>5.2</TD><TD>7&ndash;12%</TD><TD>A 29% share fell to 10%.</TD></TR>
        <TR><TD><strong>Elic Ayomanor</strong></TD><TD>4.9</TD><TD>1&ndash;2%</TD><TD>Not enough.</TD></TR>
        <TR><TD><strong>Hunter Henry</strong></TD><TD>4.5</TD><TD>2&ndash;4%</TD><TD>Left in the second quarter.</TD></TR>
        <TR><TD><strong>Jacoby Brissett</strong></TD><TD>3.5</TD><TD>3&ndash;6%</TD><TD>Replaced in the third quarter.</TD></TR>
        <TR><TD><strong>Mason Taylor</strong></TD><TD>3.4</TD><TD>1&ndash;3%</TD><TD>Not enough.</TD></TR>
        <TR><TD><strong>AJ Barner</strong></TD><TD>3.3</TD><TD>1&ndash;3%</TD><TD>Not enough.</TD></TR>
        <TR><TD><strong>Chig Okonkwo</strong></TD><TD>2.2</TD><TD>2&ndash;4%</TD><TD>Not enough.</TD></TR>
        <TR><TD><strong>Keon Coleman</strong></TD><TD>0.9</TD><TD>3&ndash;6%</TD><TD>1 for 4.</TD></TR>
        <TR><TD><strong>Tez Johnson</strong></TD><TD>0.0</TD><TD>1&ndash;3%</TD><TD>Tampa Bay completed no passes.</TD></TR>
        <TR><TD><strong>Michael Penix Jr.</strong></TD><TD>-1.9</TD><TD>3&ndash;6%</TD><TD>8 of 24, four interceptions.</TD></TR>
        <TR><TD><strong>Omar Cooper Jr.</strong></TD><TD>No line</TD><TD>6&ndash;10%</TD><TD>No stat line.</TD></TR>
        <TR><TD><strong>Dameon Pierce</strong></TD><TD>DNP</TD><TD>2&ndash;4%</TD><TD>Went on IR.</TD></TR>
        <TR><TD><strong>Colby Parkinson</strong></TD><TD>No line</TD><TD>1&ndash;2%</TD><TD>No stat line.</TD></TR>
        <TR><TD><strong>Drew Sample</strong></TD><TD>No line</TD><TD>$1</TD><TD>No stat line.</TD></TR>
      </TBody>
    </Table>
    <P>
      Also on the record: last week&apos;s column said to cut Michael Mayer and Jahan Dotson. Mayer
      scored 7.8 on a 24% share and Dotson scored 10.5 on a 22% share, and both are on this
      week&apos;s board. I own it. The other cuts held: Noel&apos;s season is over, Roschon Johnson
      scored 3.3, Huntley scored -2.0, and Bam Knight scored 0.3. Holding DeMario Douglas for one more
      week paid 15.1.
    </P>
    <H3>The lesson</H3>
    <P>
      The Big Three went one hit, one miss and one blank. Six cheap superflex quarterbacks returned
      52.4 points on bids that topped out at 8%, down from last week&apos;s 70.6 on four, because
      Penix and Brissett combined for 1.6. The defenses were the week&apos;s best buy: five of the
      seven streamers scored 12 or more (Jacksonville 24.5, Pittsburgh 20, Washington 17, the Rams 14,
      New England 12), and no defense on the avoid list scored more than 7. Last week&apos;s named
      touchdown traps, Caleb Douglas, Davis Allen, Darren Waller and Sean Tucker, returned 9.7
      combined.
    </P>
    <H3>Where the market went</H3>
    <UL>
      <LI><strong>Omar Cooper Jr.</strong>: 34.7% to 69.6%, and then he had no stat line.</LI>
      <LI><strong>Jonah Coleman</strong>: 24.2% to 52.3%.</LI>
      <LI><strong>Hunter Henry</strong>: 47.2% to 73.1%, on 4.5.</LI>
      <LI><strong>Geno Smith</strong>: 13.1% to 32.8%.</LI>
      <LI><strong>KC Concepcion</strong>: 42.9% to 60.6%, on 5.2.</LI>
      <LI><strong>Caleb Douglas</strong>: 9.7% to 29.2%, on 6.3.</LI>
      <LI><strong>Makai Lemon</strong>: 37.5% to 51.9%.</LI>
      <LI><strong>Mason Taylor</strong>: 0.3% to 12.3%, on 3.4.</LI>
      <LI><strong>Tyler Bass</strong>: 9.6% to 65.5%, and he scored 16.</LI>
    </UL>

    <H2>The Darkness Doctrine</H2>
    <P>
      Last week&apos;s receipts wrote this week&apos;s rules. Five of them.
    </P>
    <H3>Rule 1: Target share over touchdowns, again</H3>
    <P>
      Antonio Williams (26%) and Lemon (28%) kept the share even in quiet weeks. Concepcion&apos;s
      fall from 29% to 10% is why Mitchell&apos;s single 29% week is a 6&ndash;10% bid and no more.
      This week&apos;s traps: Kyle Williams (NE WR, a 43-yard TD on one catch, a 5% share), Kevin
      Coleman Jr. (MIA WR, a TD on a 10% share), Nate Boerkircher (JAX TE, a TD on one catch, a 6%
      share), Jack Endries (CIN TE, a 1-yard TD, his only catch) and Isaiah Williams (NYJ WR, a TD on
      one catch, a 3% share). Kenny Gainwell (TB RB, 50.2%) ran for 140 on 25 carries in a game Tampa
      Bay played in a driving rain and never completed a pass, so don&apos;t pay for that one either.
    </P>
    <H3>Rule 2: Buy the job</H3>
    <P>
      Allgeier&apos;s 11 carries went for 147, Washington got 25 carries with Jeanty at 2, and Williams
      has McLaurin&apos;s job for the season. Jonah Coleman at 24.2% last week was this rule working.
    </P>
    <H3>Rule 3: Two byes</H3>
    <P>
      Pittsburgh and Tennessee are off. Check the lineup before the wire. Cam Ward, Chimere Dike,
      Gunnar Helm and Darnell Washington all had good Week 8 lines, and none of them plays Sunday.
      Spend nothing on them this week.
    </P>
    <H3>Rule 4: Thursday locks first</H3>
    <P>
      Jacksonville at Baltimore is Thursday night (Rodriguez, Tuten, Oluokun, Lane). Cincinnati and
      Atlanta kick off at 9:30 a.m. ET on Sunday in Madrid (Gesicki, Penix, Dotson, McPherson), so
      that game locks before the rest of your Sunday. Sunday night is Tampa Bay at Chicago (Santos),
      and Monday night is Buffalo at Minnesota (Murray, Wentz).
    </P>
    <H3>Rule 5: Price the second bet</H3>
    <P>
      Allgeier needs Love out, Rodriguez needs Tuten out, Mitchell needs Cooper out, Singletary needs
      Skattebo out, Chism needs Brown out and Raridon needs Henry out. That is six bids waiting on
      someone else&apos;s week. Price each one as the second bet it is.
    </P>
    <Quote>
      Buy the job. Rent the touchdown. Never pay for last week&apos;s.
    </Quote>

    <H2>Who to Cut</H2>
    <UL>
      <LI><strong>Jaylin Noel</strong>: IR, season over, still at 9.1%.</LI>
      <LI><strong>Jacoby Brissett</strong>: replaced in the third quarter and now third on Arizona&apos;s chart, at 23.8%.</LI>
      <LI><strong>Keon Coleman</strong>: 0.9 on a 9% share, at 28.2%.</LI>
      <LI><strong>Seth McGowan</strong>: the market took him from 4.0% to 21.3%, and he ran for 29 yards and scored 2.9.</LI>
      <LI><strong>Kimani Vidal</strong>: 5.6% to 15.5%, on 4.0 in a three-way split with Omarion Hampton (3.7) and Keaton Mitchell (3.8).</LI>
      <LI><strong>Kenyon Sadiq</strong>: 1.7, 1.1 and 2.7, at 22.1%.</LI>
      <LI><strong>Juwan Johnson</strong>: 0.0 and 1.2 before the bye, at 50.2%. <strong>MarShawn Lloyd</strong>: 1.0, 4.5 and 2.1, at 38.1%.</LI>
      <LI><strong>Jerry Jeudy</strong>: 0.0 on a 3% share. <strong>Roschon Johnson</strong>: 3.3. <strong>Tyler Huntley</strong>: the toe.</LI>
      <LI><strong>Hold</strong> Lamar Jackson, Davante Adams and Terry McLaurin in IR slots (McLaurin goes to the wire in leagues without one), and Jalen Hurts in an IR slot or on the wire.</LI>
      <LI><strong>Hold</strong> Concepcion for one more week (5.2 on a 10% share after 24% and 29%), and Tyson and Etienne while the Saints decide.</LI>
    </UL>

    <H2>The Week 9 Bid Sheet</H2>
    <P>Set your claims in this order.</P>
    <OL>
      <LI><strong>Tyler Allgeier</strong> at 12&ndash;18%.</LI>
      <LI><strong>Chris Rodriguez Jr.</strong> at 8&ndash;12%. He plays Thursday.</LI>
      <LI><strong>Adonai Mitchell</strong> at 6&ndash;10%.</LI>
      <LI>Superflex: <strong>Sam Darnold</strong> at 5&ndash;8% ($1 in 1QB), then <strong>Kirk Cousins</strong> at 4&ndash;8% if he is on your wire, <strong>Geno Smith</strong> at 3&ndash;5% and <strong>Gardner Minshew II</strong> at 2&ndash;4%.</LI>
      <LI><strong>Antonio Williams</strong> at 5&ndash;8% and <strong>Devin Singletary</strong> at 4&ndash;7%.</LI>
      <LI><strong>Mike Washington Jr.</strong> and <strong>Mike Gesicki</strong> at 3&ndash;6%.</LI>
      <LI>The rest of the Full Board at the ranges listed, and $1 on Elijah Mitchell and Brevyn Spann-Ford.</LI>
    </OL>
    <P>
      Injury statuses are as of Tuesday. Love, Tuten, Skattebo, Cooper, Brown and Henry decide six of
      these bids before kickoff, Thursday night is Jacksonville at Baltimore, and Sunday starts at 9:30
      a.m. ET in Madrid. Andy Darkness is a pen name and has no rooting interest, allegedly.
    </P>
  </>
);

export default Body;
