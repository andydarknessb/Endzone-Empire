import React from 'react';
import { Box } from '@mui/material';
import {
  Lead, P, H2, H3, UL, OL, LI, Quote,
  Table, THead, TBody, TR, TH, TD,
} from '../../components/public/kit/Prose';
import { Tag } from '../../components/public/kit/ArticleBits';
import { PriorityCard, FaabLadder, OpponentChart } from './darkness-report-parts';

// Body only: the frontmatter lives in week10-waiver-wire-darkness-report.meta.js so listings can be
// built without loading this prose; content/articles/index.js loads it on demand.
//
// Every color below the hero is a theme token, so the cards, charts and chips read in light and
// dark. The hero is a dark illustration in both themes, like the Week 3 start/sit banner.

function HeroBanner() {
  // Claim cards fanned across the field: taller card, bigger bid. The Big Three are green.
  const bids = [
    { x: 150, h: 150, label: 'JOHNSON', fill: '#2fd97b' },
    { x: 262, h: 100, label: 'KINER', fill: '#2fd97b' },
    { x: 374, h: 83, label: 'DELL', fill: '#2fd97b' },
    { x: 486, h: 67, label: 'LOCK', fill: '#7eaaff' },
    { x: 598, h: 67, label: 'ESTIME', fill: '#7eaaff' },
  ];
  return (
    <Box
      component="svg"
      viewBox="0 0 800 300"
      xmlns="http://www.w3.org/2000/svg"
      sx={{ width: '100%', borderRadius: 'var(--radius-md, 10px)', overflow: 'hidden', mb: 4, display: 'block' }}
      role="img"
      aria-labelledby="wk10ww-hero-title wk10ww-hero-desc"
    >
      <title id="wk10ww-hero-title">Week 10 Waiver Wire: The Darkness Report</title>
      <desc id="wk10ww-hero-desc">
        A night field under a floodlight with five glowing bid bars rising from the turf, tallest
        first: Kaleb Johnson, Corey Kiner, Tank Dell, Drew Lock and Audric Estime, over the headline
        Week 10 Waiver Wire. The first three are the Big Three.
      </desc>
      <defs>
        <linearGradient id="wk10ww-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#060910" />
          <stop offset="0.55" stopColor="#0c1424" />
          <stop offset="1" stopColor="#161027" />
        </linearGradient>
        <radialGradient id="wk10ww-flood" cx="0.5" cy="0" r="0.85">
          <stop offset="0" stopColor="#7eaaff" stopOpacity="0.34" />
          <stop offset="1" stopColor="#7eaaff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="wk10ww-bar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="800" height="300" fill="url(#wk10ww-bg)" />
      <rect width="800" height="300" fill="url(#wk10ww-flood)" />
      {Array.from({ length: 11 }, (_, i) => (
        <line key={`yd${i}`} x1={40 + i * 72} y1="120" x2={6 + i * 79} y2="300" stroke="rgba(255,255,255,0.06)" />
      ))}
      <line x1="0" y1="206" x2="800" y2="206" stroke="rgba(255,255,255,0.12)" strokeDasharray="6 8" />
      {bids.map((b) => (
        <g key={b.label}>
          <rect x={b.x} y={206 - b.h} width="56" height={b.h} rx="8" fill={b.fill} opacity="0.2" />
          <rect x={b.x} y={206 - b.h} width="56" height={b.h} rx="8" fill="url(#wk10ww-bar)" />
          <rect x={b.x} y={206 - b.h} width="56" height="5" rx="2.5" fill={b.fill} />
          <text x={b.x + 28} y={198 - b.h} textAnchor="middle" fill={b.fill} fontFamily="system-ui, sans-serif" fontWeight="800" fontSize="11" letterSpacing="1.5">{b.label}</text>
        </g>
      ))}
      <text x="400" y="34" textAnchor="middle" fill="#8badc9" fontFamily="system-ui, sans-serif" fontWeight="700" fontSize="12" letterSpacing="4">THE DARKNESS REPORT</text>
      <rect x="120" y="222" width="560" height="64" rx="14" fill="rgba(3,8,20,0.84)" stroke="rgba(126,170,255,0.25)" />
      <text x="400" y="253" textAnchor="middle" fill="#ffffff" fontFamily="system-ui, sans-serif" fontWeight="850" fontSize="24" letterSpacing="1">WEEK 10 WAIVER WIRE</text>
      <text x="400" y="274" textAnchor="middle" fill="#8badc9" fontFamily="system-ui, sans-serif" fontWeight="600" fontSize="12" letterSpacing="3">THE BIG THREE &middot; FAAB LADDER &middot; D/ST &middot; IDP &middot; RECEIPTS</text>
    </Box>
  );
}

const BIG_THREE = [
  {
    id: 'kaleb-johnson', rank: 1, name: 'Kaleb Johnson', pos: 'RB', team: 'GB', matchup: 'vs MIN',
    min: 14, max: 20, rostered: '0.9% rostered', window: 'If Jacobs sits', windowTone: 'var(--warning)',
    take: 'Johnson ran for 68 yards and a TD on 14 carries in the 45-27 win at New England, worth 12.8 points, after Josh Jacobs left in the first quarter with a broken finger. Matt LaFleur says Jacobs needs surgery on the finger and has not ruled out IR, and MarShawn Lloyd is listed out. Green Bay hosts Minnesota and is implied for 23.0.',
    pro: 'The lead carries in a 23.0 implied total, with the starter facing surgery.',
    con: 'No targets on Sunday, and Jacobs (95.1%) is not on IR yet. Pierre Strong Jr. ran 8 times behind him.',
  },
  {
    id: 'corey-kiner', rank: 2, name: 'Corey Kiner', pos: 'RB', team: 'NE', matchup: 'at DET (Munich)',
    min: 8, max: 12, rostered: '5.3% rostered', window: 'Until Stevenson returns', windowTone: 'var(--warning)',
    take: 'Kiner ran for 55 yards and a TD on 8 carries in the loss to Green Bay, worth 11.5 points. Rhamondre Stevenson (92.7%) left late in the third quarter with a knee tendon issue that is not expected to need surgery but may cost him "a short period of time," per Adam Schefter, and TreVeyon Henderson is listed out. Mike Vrabel says Kiner "has done a really nice job." New England plays Detroit in Munich and is implied for 24.5.',
    pro: 'The healthy back in a 24.5 implied total.',
    con: 'No targets in three weeks, and New England is off in Week 11.',
  },
  {
    id: 'tank-dell', rank: 3, name: 'Tank Dell', pos: 'WR', team: 'HOU', matchup: 'at CLE',
    min: 5, max: 9, rostered: '23.3% rostered', window: 'Season', windowTone: 'var(--success)',
    take: 'Dell caught 4 passes for 105 yards and a TD on a 24% target share in the 44-22 win over the Chargers, worth 18.5 points. It was his first TD since a knee injury in 2024, and C.J. Stroud threw for 384 yards and five TDs around him. Houston is at Cleveland and is implied for 22.0.',
    pro: 'A 24% share at 23.3% rostered, in an offense that just scored 44.',
    con: 'One week of volume. He had a 4% share in Week 7, and Kayshon Boutte out-scored him Sunday on a 14% share.',
  },
];

// Bid ranges, % of a $100 budget. Big Three first, then the top of the priced board.
const LADDER = [
  ['Kaleb Johnson', 'RB', 14, 20, true],
  ['Corey Kiner', 'RB', 8, 12, true],
  ['Tank Dell', 'WR', 5, 9, true],
  ['Drew Lock', 'QB', 4, 7, false],
  ['Audric Estime', 'RB', 4, 7, false],
  ['Caleb Douglas', 'WR', 3, 6, false],
  ['Jacoby Brissett', 'QB', 3, 5, false],
  ['Justice Hill', 'RB', 3, 5, false],
  ['Darren Waller', 'TE', 2, 4, false],
  ['Michael Penix Jr.', 'QB', 2, 4, false],
];

// Implied points for the offense each defense faces. Lower is better for the defense.
const DST_TARGETS = [
  { def: 'LAR', opp: 'ARI', pts: 15.5, kind: 'stream' },
  { def: 'BAL', opp: 'LAC', pts: 16.5, kind: 'stream' },
  { def: 'HOU', opp: 'CLE', pts: 17.5, kind: 'stream' },
  { def: 'JAX', opp: 'TEN', pts: 18, kind: 'stream' },
  { def: 'GB', opp: 'MIN', pts: 18.5, kind: 'stream' },
  { def: 'IND', opp: 'MIA', pts: 19, kind: 'stream' },
  { def: 'NYG', opp: 'WSH', pts: 19.5, kind: 'stream' },
  { def: 'SEA', opp: 'LV', pts: 20, kind: 'stream' },
  { def: 'ARI', opp: 'LAR', pts: 25, kind: 'avoid' },
  { def: 'SF', opp: 'DAL', pts: 25.5, kind: 'avoid' },
  { def: 'PIT', opp: 'CIN', pts: 26, kind: 'avoid' },
  { def: 'NE', opp: 'DET', pts: 27, kind: 'avoid' },
  { def: 'TEN', opp: 'JAX', pts: 28.5, kind: 'avoid' },
  { def: 'NYJ', opp: 'BUF', pts: 29.5, kind: 'avoid' },
  { def: 'DAL', opp: 'SF', pts: 30, kind: 'avoid' },
];

const Body = () => (
  <>
    <HeroBanner />
    <Lead>
      Week 9 broke Josh Jacobs&apos; finger in the first quarter, sent Puka Nacua toward IR on the
      final snap in Washington, and left Arizona without Michael Wilson for the season and, probably,
      Gardner Minshew too. Kaleb Johnson ran for a TD in Jacobs&apos; place and is on the wire in 99
      of 100 leagues. Last week&apos;s Big Three went one hit and two misses. Let&apos;s spend.
    </Lead>
    <P>
      Every bid below is a percentage of a $100 FAAB budget. The league is half-PPR with one
      quarterback slot and a superflex. Rostered figures come from our own snapshot, taken early
      Tuesday. Lines are ESPN&apos;s as of Tuesday. Injury statuses are our database as of
      Tuesday with Monday&apos;s reporting layered on, and where the two disagree I trust the
      database and say so. Chicago, Denver, Philadelphia and Tampa Bay are on bye, so 28 teams play.
      Thursday is Washington at the Giants at 8:15 p.m. ET. Sunday opens at 9:30 a.m. ET with New
      England and Detroit in Munich, then the 1:00, 4:05 and 4:25 p.m. ET kickoffs. Sunday night is
      Pittsburgh at Cincinnati, and Monday night is the Chargers at Baltimore. Week 9 snap counts are
      not in our data yet, so I quote yards, catches, target share and points, plus carries from
      ESPN&apos;s box scores.
    </P>

    <H2>The Big Three</H2>
    <P>
      Johnson for the backfield, Kiner for the other backfield, Dell for the target share. The first
      two are injury windows, so price the second bet. Kiner has to be claimed in time for Munich,
      because New England kicks off at 9:30 a.m. ET.
    </P>
    {BIG_THREE.map((p) => <PriorityCard key={p.id} p={p} />)}
    <H3>Not in the Big Three: Drew Lock</H3>
    <P>
      Lock (QB, SEA, 8.0% rostered) is the best quarterback on the wire, and Mike Macdonald has named
      him Sunday&apos;s starter at Las Vegas. He went 19 of 28 for 175 yards and a TD in Darnold&apos;s
      place, worth 12.6, and Seattle is implied for 23.5. That is why he is a 4&ndash;7% bid in
      superflex, and it is also why he is not a Big Three bid: Seattle is off in Week 11 and Darnold
      is expected back in Week 12, so this is one start.
    </P>

    <H2>The FAAB Ladder</H2>
    <P>
      The top of the priced board on one scale. Highlighted bars are the Big Three. Anything that
      tops out at 8% or less is a cheap bid: pick a number in the range and don&apos;t lose sleep.
      Johnson is the one to watch, because his whole range depends on whether Green Bay moves Jacobs
      to IR.
    </P>
    <FaabLadder ladder={LADDER} />

    <H2>The Full Board</H2>
    <P>
      Window is how long the role should last. Season means no starter is coming back to take it,
      and &quot;If X sits&quot; means exactly that. Rostered% is our snapshot, so a name at 40%
      is already in two out of five leagues out there.
    </P>
    <Table aria-label="Week 10 offensive waiver board">
      <THead>
        <TR>
          <TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Team</TH><TH scope="col">Why</TH><TH scope="col">Wk 10</TH><TH scope="col">Window</TH><TH scope="col">Bid</TH><TH scope="col">Rostered%</TH>
        </TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Kaleb Johnson</strong></TD><TD>RB</TD><TD>GB</TD><TD>68 yards and a TD on 14 carries. Jacobs needs finger surgery.</TD><TD>vs MIN</TD><TD>If Jacobs sits</TD><TD>14&ndash;20%</TD><TD>0.9%</TD></TR>
        <TR><TD>2</TD><TD><strong>Corey Kiner</strong></TD><TD>RB</TD><TD>NE</TD><TD>55 yards and a TD on 8 carries. Stevenson&apos;s knee will cost him time.</TD><TD>at DET (Munich)</TD><TD>Until Stevenson returns</TD><TD>8&ndash;12%</TD><TD>5.3%</TD></TR>
        <TR><TD>3</TD><TD><strong>Tank Dell</strong></TD><TD>WR</TD><TD>HOU</TD><TD>4 for 105 and a TD on a 24% share, his second game back.</TD><TD>at CLE</TD><TD>Season</TD><TD>5&ndash;9%</TD><TD>23.3%</TD></TR>
        <TR><TD>4</TD><TD><strong>Drew Lock</strong></TD><TD>QB</TD><TD>SEA</TD><TD>175 yards and a TD, and named Sunday&apos;s starter.</TD><TD>at LV</TD><TD>One start</TD><TD>4&ndash;7%</TD><TD>8.0%</TD></TR>
        <TR><TD>5</TD><TD><strong>Audric Estime</strong></TD><TD>RB</TD><TD>NO</TD><TD>72 yards and the go-ahead TD on 15 carries. Kamara had 6.</TD><TD>vs CAR</TD><TD>If the role holds</TD><TD>4&ndash;7%</TD><TD>9.2%</TD></TR>
        <TR><TD>6</TD><TD><strong>Caleb Douglas</strong></TD><TD>WR</TD><TD>MIA</TD><TD>6 for 70 on a 38% share, after 20%.</TD><TD>at IND</TD><TD>Season</TD><TD>3&ndash;6%</TD><TD>27.4%</TD></TR>
        <TR><TD>7</TD><TD><strong>Jacoby Brissett</strong></TD><TD>QB</TD><TD>BAL</TD><TD>First on Baltimore&apos;s chart after the trade. 16.5 in Week 7.</TD><TD>vs LAC (Mon)</TD><TD>As the starter</TD><TD>3&ndash;5%</TD><TD>13.5%</TD></TR>
        <TR><TD>8</TD><TD><strong>Justice Hill</strong></TD><TD>RB</TD><TD>BAL</TD><TD>85 yards and a TD on 9 carries, 65 of them on one run.</TD><TD>vs LAC (Mon)</TD><TD>Stream</TD><TD>3&ndash;5%</TD><TD>7.4%</TD></TR>
        <TR><TD>9</TD><TD><strong>Darren Waller</strong></TD><TD>TE</TD><TD>CAR</TD><TD>8 for 90 and a TD on a 27% share, after 6%.</TD><TD>at NO</TD><TD>Stream</TD><TD>2&ndash;4%</TD><TD>7.7%</TD></TR>
        <TR><TD>10</TD><TD><strong>Michael Penix Jr.</strong></TD><TD>QB</TD><TD>ATL</TD><TD>162 yards, a TD and 50 rushing yards, worth 13.5.</TD><TD>vs KC</TD><TD>Superflex stream</TD><TD>2&ndash;4%</TD><TD>15.5%</TD></TR>
        <TR><TD>11</TD><TD><strong>Jordan Watkins</strong></TD><TD>WR</TD><TD>SF</TD><TD>4 for 86 and a TD on a 17% share. Evans is unlikely to practice Wednesday.</TD><TD>at DAL</TD><TD>If Evans sits</TD><TD>2&ndash;4%</TD><TD>0.8%</TD></TR>
        <TR><TD>12</TD><TD><strong>Brevyn Spann-Ford</strong></TD><TD>TE</TD><TD>DAL</TD><TD>Ferguson is out for multiple weeks. 18% and 9% shares the last two weeks.</TD><TD>vs SF</TD><TD>If the job holds</TD><TD>2&ndash;4%</TD><TD>0.3%</TD></TR>
        <TR><TD>13</TD><TD><strong>AJ Barner</strong></TD><TD>TE</TD><TD>SEA</TD><TD>A receiving TD and a rushing TD, worth 14.0, on a 14% share.</TD><TD>at LV</TD><TD>Stream</TD><TD>1&ndash;3%</TD><TD>7.2%</TD></TR>
        <TR><TD>14</TD><TD><strong>Van Jefferson</strong></TD><TD>WR</TD><TD>WSH</TD><TD>5 for 58 and a TD on a 21% share, after 4%.</TD><TD>at NYG (Thu)</TD><TD>Stream</TD><TD>1&ndash;3%</TD><TD>0.1%</TD></TR>
        <TR><TD>15</TD><TD><strong>Chig Okonkwo</strong></TD><TD>TE</TD><TD>WSH</TD><TD>6 for 57 on a 21% share. Limited Monday with a hip injury.</TD><TD>at NYG (Thu)</TD><TD>Season</TD><TD>1&ndash;3%</TD><TD>13.8%</TD></TR>
        <TR><TD>16</TD><TD><strong>Cam Ward</strong></TD><TD>QB</TD><TD>TEN</TD><TD>26.3 in Week 8, then the bye. Jacksonville at home.</TD><TD>vs JAX</TD><TD>Superflex stream</TD><TD>1&ndash;3%</TD><TD>4.0%</TD></TR>
        <TR><TD>17</TD><TD><strong>Jameis Winston</strong></TD><TD>QB</TD><TD>NYG</TD><TD>Threw the go-ahead TD in relief. McCarthy is limited with a hip injury.</TD><TD>vs WSH (Thu)</TD><TD>If McCarthy sits</TD><TD>1&ndash;2%</TD><TD>3.8%</TD></TR>
        <TR><TD>18</TD><TD><strong>Pierre Strong Jr.</strong></TD><TD>RB</TD><TD>GB</TD><TD>22 yards on 8 carries behind Johnson.</TD><TD>vs MIN</TD><TD>Handcuff</TD><TD>1&ndash;2%</TD><TD>2.7%</TD></TR>
      </TBody>
    </Table>
    <P>
      Several of these bids hang on an injury report. Johnson needs Jacobs out, Kiner needs Stevenson
      out, Watkins needs Evans out and Winston needs McCarthy out. That is why only Johnson tops 12%.
    </P>
    <P>
      Off the board, for a dollar if your wire is thin: Tutu Atwell (LAR WR, 0.3%), with 16% and 12%
      shares the last two weeks and Nacua likely headed to IR. Brandon Aiyuk (SF WR, 11.9%) is the
      stash: the league reinstated him Monday, and the 49ers have a two-week roster exemption for him.
      Shedeur Sanders (CLE QB, 3.0%) threw for 297 yards and 2 TDs, and the Browns are going back to
      Deshaun Watson anyway, so he is a stash too.
    </P>

    <H2>Superflex Corner</H2>
    <P>
      Quarterbacks are where this format is won on the wire, so here is the ranking, with Week 9
      points.
    </P>
    <UL>
      <LI>
        <strong>Drew Lock</strong> (SEA, 8.0% rostered) is first at 12.6, 19 of 28 for 175 yards and a
        TD. He starts Sunday at Las Vegas, with Seattle implied for 23.5. Darnold is expected back after
        the Week 11 bye, so this is one start.
      </LI>
      <LI>
        <strong>Jacoby Brissett</strong> (BAL, 13.5%) is first on Baltimore&apos;s chart after the trade and
        is expected to start Monday night against the Chargers, with Baltimore implied for 22.0. He scored
        16.5 for Arizona in Week 7.
      </LI>
      <LI>
        <strong>Michael Penix Jr.</strong> (ATL, 15.5%) scored 13.5 and hosts Kansas City, with Atlanta
        implied for 21.0.
      </LI>
      <LI>
        <strong>Cam Ward</strong> (TEN, 4.0%) scored 26.3 in Week 8 before the bye and hosts Jacksonville,
        with Tennessee implied for 18.0.
      </LI>
      <LI>
        <strong>J.J. McCarthy</strong> (NYG, 34.0%) scored 7.3, hurt his hip in the third quarter and came
        back. John Harbaugh feels &quot;fairly good&quot; about him for Thursday, with the Giants implied
        for 22.0. <strong>Jameis Winston</strong> (NYG, 3.8%) is the cover.
      </LI>
      <LI>
        <strong>Hold, do not cut:</strong> Bo Nix (59.8%), on bye after 15.7.
      </LI>
      <LI>
        <strong>Avoid Justin Herbert</strong> (LAC, 32.1%, 10.4): the finger is not broken, but the
        Chargers are implied for 16.5 at Baltimore. <strong>Avoid Carson Beck</strong> (ARI, 0.4%), next on
        Arizona&apos;s chart behind Minshew, with the Cardinals implied for 15.5, the week&apos;s lowest.
      </LI>
      <LI>
        <strong>Avoid Carson Wentz</strong> (MIN, 4.4%, -2.8): 8 of 25 for 81 yards and 2 interceptions
        before Max Brosmer replaced him Monday night. Kyler Murray (50.0%) sat with a hamstring injury, and
        our data has nothing newer.
      </LI>
      <LI>
        <strong>Avoid Shedeur Sanders</strong> this week, even after 22.7: the Browns plan to start Watson
        against Houston. <strong>Avoid Geno Smith</strong> (NYJ, 22.6%, 7.4), 165 yards and no TDs at Kansas City.
      </LI>
      <LI>
        On bye and useless this week: Chicago (Caleb Williams), Denver (Nix), Philadelphia (Joe Milton, who
        scored 13.2) and Tampa Bay (Baker Mayfield).
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
        <strong>The Rams D/ST</strong> at Arizona (15.5) is the best number on the board. Minshew&apos;s elbow,
        Michael Wilson&apos;s neck and Jeremiyah Love&apos;s ankle leave the Cardinals with Carson Beck next on
        the chart. The Rams D/ST scored 2, 14 and 13, and Myles Garrett had three sacks in his return.
      </LI>
      <LI>
        <strong>Baltimore D/ST</strong> hosts the Chargers (16.5) on Monday night. The Ravens D/ST scored -3, 0 and 2,
        so this is about a winless opponent whose quarterback hurt his finger Sunday.
      </LI>
      <LI>
        <strong>Houston D/ST</strong> at Cleveland (17.5) scored 13 last week, and the Browns go back to Watson
        after his concussion.
      </LI>
      <LI>
        <strong>Jacksonville D/ST</strong> at Tennessee (18.0) scored 24 and 15 the last two weeks.{' '}
        <strong>Green Bay D/ST</strong> hosts Minnesota (18.5) after Wentz&apos;s 81-yard night and scored 5, 15 and 12.
      </LI>
      <LI>
        <strong>Indianapolis D/ST</strong> hosts Miami (19.0). <strong>The Giants D/ST</strong> hosts Washington
        (19.5) on Thursday after scoring 17, and <strong>Seattle D/ST</strong> is at Las Vegas (20.0) after scoring 17.
      </LI>
    </UL>
    <P>
      <strong>Avoid:</strong> Dallas (faces San Francisco, 30.0), the Jets (face Buffalo, 29.5), Tennessee
      (faces Jacksonville, 28.5), New England (faces Detroit, 27.0), Pittsburgh (faces Cincinnati, 26.0),
      San Francisco (faces Dallas, 25.5) and Arizona (faces the Rams, 25.0). The grey bars above are those
      defenses. The San Francisco D/ST scored 21 last week, but Dallas is implied for 25.5, so do not chase it.
    </P>

    <H2>Kickers</H2>
    <P>
      Kicker ownership is in our snapshot. The play is a kicker on an offense that scores, and the
      best number this week is San Francisco&apos;s, at 30.0 in a 55.5 total. Points are Week 8 then
      Week 9.
    </P>
    <Table aria-label="Week 10 kicker streamers">
      <THead>
        <TR>
          <TH scope="col">#</TH><TH scope="col">Kicker</TH><TH scope="col">Team</TH><TH scope="col">Team total</TH><TH scope="col">Rostered%</TH>
        </TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Eddy Pineiro</strong></TD><TD>SF</TD><TD>30.0 at DAL in a 55.5 total; bye in Week 8, 8 in Week 9</TD><TD>35.4%</TD></TR>
        <TR><TD>2</TD><TD><strong>Jake Bates</strong></TD><TD>DET</TD><TD>27.0 vs NE in Munich; 7 and 15</TD><TD>52.6%</TD></TR>
        <TR><TD>3</TD><TD><strong>Evan McPherson</strong></TD><TD>CIN</TD><TD>26.0 vs PIT on Sunday night; 5 and 13</TD><TD>21.0%</TD></TR>
        <TR><TD>4</TD><TD><strong>Brandon McManus</strong></TD><TD>LAR</TD><TD>25.0 at ARI; 6 and 8</TD><TD>0.5%</TD></TR>
        <TR><TD>5</TD><TD><strong>Charlie Smyth</strong></TD><TD>NO</TD><TD>24.5 vs CAR; bye in Week 8, 12 in Week 9</TD><TD>0.2%</TD></TR>
      </TBody>
    </Table>
    <P>
      Bye cover: Cairo Santos (CHI, 39.3%) is off. Tyler Loop (BAL, 30.5%) is on IR with a groin injury, and
      Jake Moody (0.1%) kicked for Baltimore. Dominic Zvada (NYG, 37.3%) scored 17 and plays Thursday, with
      the Giants implied for 22.0.
    </P>

    <H2>IDP Waiver Board</H2>
    <P>
      Lines are Week 9 box scores from our database. IDP rostered percentages are not tracked, so I can&apos;t
      tell you who is sitting on your wire. Tackle volume is the currency at linebacker and safety. Pressure is
      the currency on the line. The Jets are 8.5-point underdogs at home to Buffalo, Tennessee is a 10.5-point
      underdog to Jacksonville and Arizona is a 9.5-point underdog to the Rams, so those defenses will be on the
      field. David Bailey is the Jets&apos; pick here, and Andrew Wingard (4 solo and 8 assisted tackles) is
      Arizona&apos;s tackle floor.
    </P>
    <H3>Linebacker</H3>
    <Table aria-label="IDP linebackers">
      <THead>
        <TR><TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Team</TH><TH scope="col">Type</TH><TH scope="col">Week 9</TH><TH scope="col">Wk 10</TH></TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Arvell Reese</strong></TD><TD>NYG</TD><TD><Tag kind="both" /></TD><TD>10 solo and 2 assisted tackles, 3 sacks, 3 tackles for loss and a forced fumble.</TD><TD>vs WSH (Thu)</TD></TR>
        <TR><TD>2</TD><TD><strong>Carson Schwesinger</strong></TD><TD>CLE</TD><TD><Tag kind="both" /></TD><TD>10 solo and 5 assisted tackles, 2 sacks and 2 forced fumbles.</TD><TD>vs HOU</TD></TR>
        <TR><TD>3</TD><TD><strong>David Bailey</strong></TD><TD>NYJ</TD><TD><Tag kind="both" /></TD><TD>5 solo and 4 assisted tackles, 2 sacks, 3 tackles for loss and 2 forced fumbles.</TD><TD>vs BUF</TD></TR>
        <TR><TD>4</TD><TD><strong>Frankie Luvu</strong></TD><TD>WSH</TD><TD><Tag kind="T" /></TD><TD>7 solo and 8 assisted tackles and a sack.</TD><TD>at NYG (Thu)</TD></TR>
        <TR><TD>5</TD><TD><strong>Nakobe Dean</strong></TD><TD>LV</TD><TD><Tag kind="T" /></TD><TD>7 solo and 11 assisted tackles.</TD><TD>vs SEA</TD></TR>
        <TR><TD>6</TD><TD><strong>Kaden Elliss</strong></TD><TD>NO</TD><TD><Tag kind="T" /></TD><TD>8 solo and 3 assisted tackles, a sack and 2 tackles for loss.</TD><TD>vs CAR</TD></TR>
      </TBody>
    </Table>
    <H3>Defensive line and edge</H3>
    <Table aria-label="IDP defensive line">
      <THead>
        <TR><TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Team</TH><TH scope="col">Week 9</TH><TH scope="col">Wk 10</TH></TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Myles Garrett</strong></TD><TD>DE</TD><TD>LAR</TD><TD>3 solo tackles, 3 sacks, 3 tackles for loss and a forced fumble.</TD><TD>at ARI</TD></TR>
        <TR><TD>2</TD><TD><strong>Carl Granderson</strong></TD><TD>DE</TD><TD>NO</TD><TD>5 solo and 2 assisted tackles and 2 sacks.</TD><TD>vs CAR</TD></TR>
        <TR><TD>3</TD><TD><strong>George Karlaftis</strong></TD><TD>DE</TD><TD>KC</TD><TD>4 solo and 2 assisted tackles, 2 sacks and 3 tackles for loss.</TD><TD>at ATL</TD></TR>
        <TR><TD>4</TD><TD><strong>Quinnen Williams</strong></TD><TD>DT</TD><TD>DAL</TD><TD>3 solo and 4 assisted tackles, 3 tackles for loss and a forced fumble.</TD><TD>vs SF</TD></TR>
        <TR><TD>5</TD><TD><strong>Sheldon Rankins</strong></TD><TD>DT</TD><TD>HOU</TD><TD>3 solo tackles, 2 sacks and 2 tackles for loss.</TD><TD>at CLE</TD></TR>
      </TBody>
    </Table>
    <H3>Defensive back</H3>
    <Table aria-label="IDP defensive backs">
      <THead>
        <TR><TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Team</TH><TH scope="col">Type</TH><TH scope="col">Week 9</TH><TH scope="col">Wk 10</TH></TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Jessie Bates III</strong></TD><TD>S</TD><TD>JAX</TD><TD><Tag kind="T" /></TD><TD>11 solo and 3 assisted tackles.</TD><TD>at TEN</TD></TR>
        <TR><TD>2</TD><TD><strong>Hunter Wohler</strong></TD><TD>S</TD><TD>IND</TD><TD><Tag kind="T" /></TD><TD>6 solo and 10 assisted tackles.</TD><TD>vs MIA</TD></TR>
        <TR><TD>3</TD><TD><strong>Nick Cross</strong></TD><TD>S</TD><TD>WSH</TD><TD><Tag kind="both" /></TD><TD>6 solo and 2 assisted tackles, an interception and 3 passes defended.</TD><TD>at NYG (Thu)</TD></TR>
        <TR><TD>4</TD><TD><strong>Christian Gonzalez</strong></TD><TD>CB</TD><TD>NE</TD><TD><Tag kind="T" /></TD><TD>9 solo and 1 assisted tackle.</TD><TD>at DET (Munich)</TD></TR>
        <TR><TD>5</TD><TD><strong>Xavier McKinney</strong></TD><TD>S</TD><TD>GB</TD><TD><Tag kind="BP" /></TD><TD>2 interceptions and 2 passes defended.</TD><TD>vs MIN</TD></TR>
        <TR><TD>6</TD><TD><strong>Myles Harden</strong></TD><TD>CB</TD><TD>CLE</TD><TD><Tag kind="BP" /></TD><TD>4 solo tackles, 2 sacks and 2 tackles for loss.</TD><TD>vs HOU</TD></TR>
      </TBody>
    </Table>
    <P>
      Tackle-heavy scoring: bump the Tackles tags a tier. Big-play scoring: bump the Big play tags.
      Reese, Schwesinger, Bailey and Cross carry both.
    </P>

    <H2>The Injury Ledger</H2>
    <H3>Out or on IR</H3>
    <UL>
      <LI><strong>Josh Jacobs</strong> (GB RB): broken right ring finger, left in the first quarter Sunday. LaFleur says he needs surgery and has not ruled out IR. <strong>MarShawn Lloyd</strong> (GB RB) is listed out. Kaleb Johnson.</LI>
      <LI><strong>Puka Nacua</strong> (LAR WR): MCL and PCL sprain and turf toe on the final snap Sunday. Sean McVay says he will likely go on IR. <strong>Davante Adams</strong> is already on IR with a hamstring injury. Atwell.</LI>
      <LI><strong>Michael Wilson</strong> (ARI WR): a fracture in his neck, out for the season (LaFleur). <strong>Gardner Minshew II</strong> (ARI QB): a torn UCL that likely needs season-ending surgery; he is seeking more opinions (Schefter). Carson Beck is next on the chart.</LI>
      <LI><strong>Jeremiyah Love</strong> (ARI RB): IR, ankle. LaFleur says <strong>James Conner</strong> won&apos;t come off IR this week, and <strong>Bam Knight</strong> is listed out.</LI>
      <LI><strong>Jake Ferguson</strong> (DAL TE): sprained PCL and MCL, out &quot;multiple weeks&quot; (Brian Schottenheimer). <strong>Tyler Goodson</strong> (DAL RB): sprained knee, also &quot;multiple weeks.&quot; Spann-Ford.</LI>
      <LI><strong>Sam Darnold</strong> (SEA QB): quadriceps, out at Las Vegas and expected back in Week 12 after the bye (Gregg Bell). Lock.</LI>
      <LI><strong>Lamar Jackson</strong> (BAL QB): IR, thumb surgery, and he has told teammates he plans to return this season (Ian Rapoport). <strong>Tyler Huntley</strong> (BAL QB): IR, toe. <strong>Tyler Loop</strong> (BAL K): IR, groin. Brissett.</LI>
      <LI><strong>Garrett Wilson</strong> (NYJ WR): concussion, inactive Sunday and listed out. Omar Cooper Jr. (58.2%) caught 8 for 58 on a 37% share.</LI>
      <LI><strong>Mike Evans</strong> (SF WR): Achilles, unlikely to practice Wednesday (Nick Wagoner). <strong>Deebo Samuel Sr.</strong> is on track to return to practice Wednesday. Watkins.</LI>
      <LI><strong>George Pickens</strong> (DAL WR): hamstring, inactive Sunday, with &quot;a chance to play&quot; against San Francisco but capped practice reps (Jon Machota).</LI>
      <LI><strong>David Montgomery</strong> (HOU RB): groin. Ryans hopes he resumes practicing this week or next. Woody Marks (79.6%).</LI>
      <LI><strong>Kyler Murray</strong> (MIN QB): hamstring, sat Monday night. Wentz was replaced in the fourth quarter.</LI>
      <LI><strong>Jalen Hurts</strong> (PHI QB): IR, blood clots, expected to miss the rest of the season. <strong>De&apos;Von Achane</strong> (MIA RB), <strong>Jacory Croskey-Merritt</strong> (WSH RB), <strong>Brian Robinson Jr.</strong> (ATL RB), <strong>Christian Kirk</strong> (SF WR) and <strong>Roman Wilson</strong> (PIT WR): IR.</LI>
      <LI><strong>Terrance Ferguson</strong> (LAR TE): IR, hamstring, likely out another couple of weeks (McVay). <strong>Jonathon Brooks</strong> (CAR RB): IR; Dave Canales says the Panthers will spend two days discussing his status.</LI>
      <LI><strong>Jaylen Waddle</strong> (DEN WR) and <strong>Luther Burden III</strong> (CHI WR): concussions, and both teams are on bye.</LI>
      <LI><strong>Kyle Monangai</strong> (CHI RB), <strong>DeVonta Smith</strong> and <strong>Dontayvion Wicks</strong> (PHI WR), <strong>Rashid Shaheed</strong> (SEA WR), <strong>Carnell Tate</strong> (TEN WR) and <strong>Tyjae Spears</strong> (TEN RB): out, no new detail.</LI>
    </UL>
    <H3>Questionable and day-to-day</H3>
    <UL>
      <LI><strong>Rhamondre Stevenson</strong> (NE RB): knee tendon, no surgery expected, &quot;a short period of time&quot; (Schefter). <strong>TreVeyon Henderson</strong> (NE RB) is listed out. Kiner.</LI>
      <LI><strong>A.J. Brown</strong> (NE WR): knee, listed out in our data but trending toward making the trip to Munich (Mark Daniels).</LI>
      <LI><strong>Patrick Mahomes</strong> (KC QB): elbow, day-to-day (Andy Reid). <strong>Xavier Worthy</strong> (KC WR): hamstring, day-to-day.</LI>
      <LI><strong>Justin Herbert</strong> (LAC QB): left middle finger, no fracture (Jim Harbaugh). <strong>Ladd McConkey</strong> (LAC WR): back spasms, day to day.</LI>
      <LI><strong>J.J. McCarthy</strong> (NYG QB): hip, limited Monday. Harbaugh feels &quot;fairly good&quot; about Thursday. Winston. <strong>Cam Skattebo</strong> (NYG RB): hamstring, listed out in our data and limited Monday. <strong>Darnell Mooney</strong> (NYG WR): chest, limited.</LI>
      <LI><strong>Drew Lock</strong> (SEA QB): oblique. Macdonald says the tests were &quot;good.&quot;</LI>
      <LI><strong>Chig Okonkwo</strong> (WSH TE): hip, limited. <strong>Treylon Burks</strong> (WSH WR): foot, listed out in our data, did not practice Monday. Washington plays Thursday.</LI>
      <LI><strong>Deshaun Watson</strong> (CLE QB): concussion, listed out in our data, but the Browns plan to start him Sunday (Jeremy Fowler). Sanders.</LI>
    </UL>

    <H2>Receipts: Grading Week 9</H2>
    <P>
      Last week&apos;s board, graded in half-PPR points from our database. The hits first.
    </P>
    <Table aria-label="Week 9 board hits">
      <THead>
        <TR><TH scope="col">Player</TH><TH scope="col">Points</TH><TH scope="col">Wk 9 bid</TH></TR>
      </THead>
      <TBody>
        <TR><TD><strong>Michael Penix Jr.</strong></TD><TD>13.5</TD><TD>2&ndash;4%</TD></TR>
        <TR><TD><strong>Efton Chism III</strong></TD><TD>13.4</TD><TD>2&ndash;4%</TD></TR>
        <TR><TD><strong>Kirk Cousins</strong></TD><TD>12.6</TD><TD>4&ndash;8%</TD></TR>
        <TR><TD><strong>Chris Rodriguez Jr.</strong></TD><TD>10.2</TD><TD>8&ndash;12%</TD></TR>
        <TR><TD><strong>Emmett Johnson</strong></TD><TD>9.4</TD><TD>2&ndash;4%</TD></TR>
      </TBody>
    </Table>
    <P>
      Penix threw for 162 yards and a TD and ran for 50. Chism caught 5 for 49 and a TD with A.J. Brown
      out. Cousins threw 3 interceptions and ran in a TD. Rodriguez ran for a TD with Tuten playing. Emmett
      Johnson ran 6 times for 34 and a TD. Now the misses and the shrugs.
    </P>
    <Table aria-label="Week 9 board misses and pushes">
      <THead>
        <TR><TH scope="col">Player</TH><TH scope="col">Points</TH><TH scope="col">Wk 9 bid</TH><TH scope="col">What happened</TH></TR>
      </THead>
      <TBody>
        <TR><TD><strong>Geno Smith</strong></TD><TD>7.4</TD><TD>3&ndash;5%</TD><TD>A push: 165 yards, no TDs.</TD></TR>
        <TR><TD><strong>Gardner Minshew II</strong></TD><TD>7.0</TD><TD>2&ndash;4%</TD><TD>Hurt his elbow.</TD></TR>
        <TR><TD><strong>Eli Raridon</strong></TD><TD>6.7</TD><TD>2&ndash;4%</TD><TD>A push, on a 17% share.</TD></TR>
        <TR><TD><strong>Ryan Flournoy</strong></TD><TD>6.3</TD><TD>2&ndash;4%</TD><TD>Not enough.</TD></TR>
        <TR><TD><strong>Dylan Sampson</strong></TD><TD>6.3</TD><TD>2&ndash;3%</TD><TD>A push, on a 21% share.</TD></TR>
        <TR><TD><strong>Tyler Allgeier</strong></TD><TD>5.6</TD><TD>12&ndash;18%</TD><TD>17 carries for 46 in a 17-3 loss.</TD></TR>
        <TR><TD><strong>Devin Singletary</strong></TD><TD>4.9</TD><TD>4&ndash;7%</TD><TD>21 carries for 31.</TD></TR>
        <TR><TD><strong>Keenan Allen</strong></TD><TD>4.6</TD><TD>3&ndash;5%</TD><TD>A 25% share, 26 yards.</TD></TR>
        <TR><TD><strong>Austin Ekeler</strong></TD><TD>4.4</TD><TD>1&ndash;2%</TD><TD>Not enough.</TD></TR>
        <TR><TD><strong>Antonio Williams</strong></TD><TD>4.0</TD><TD>5&ndash;8%</TD><TD>3 for 25.</TD></TR>
        <TR><TD><strong>Malik Willis</strong></TD><TD>3.8</TD><TD>2&ndash;3%</TD><TD>128 yards and an interception.</TD></TR>
        <TR><TD><strong>Michael Mayer</strong></TD><TD>3.2</TD><TD>2&ndash;4%</TD><TD>Not enough.</TD></TR>
        <TR><TD><strong>Sione Vaki</strong></TD><TD>3.1</TD><TD>1&ndash;2%</TD><TD>Not enough.</TD></TR>
        <TR><TD><strong>Jahan Dotson</strong></TD><TD>2.6</TD><TD>1&ndash;3%</TD><TD>Not enough.</TD></TR>
        <TR><TD><strong>Mike Gesicki</strong></TD><TD>2.1</TD><TD>3&ndash;6%</TD><TD>2 for 11.</TD></TR>
        <TR><TD><strong>Adonai Mitchell</strong></TD><TD>0.0</TD><TD>6&ndash;10%</TD><TD>A 23% share and no catches.</TD></TR>
        <TR><TD><strong>Chris Bell</strong></TD><TD>0.0</TD><TD>1&ndash;3%</TD><TD>No catches.</TD></TR>
        <TR><TD><strong>Mike Washington Jr.</strong></TD><TD>-0.3</TD><TD>3&ndash;6%</TD><TD>-3 rushing yards.</TD></TR>
        <TR><TD><strong>Sam Darnold</strong></TD><TD>DNP</TD><TD>5&ndash;8%</TD><TD>Ruled out, quadriceps.</TD></TR>
        <TR><TD><strong>Treylon Burks</strong></TD><TD>DNP</TD><TD>2&ndash;4%</TD><TD>No stat line.</TD></TR>
      </TBody>
    </Table>
    <P>
      Also on the record: last week&apos;s column said to cut Jacoby Brissett, Seth McGowan and Juwan
      Johnson. Brissett was traded to Baltimore and is first on its chart, McGowan ran for a TD and scored
      10.7, and Johnson caught a TD for 10.4. I own those. The other cuts held: Keon Coleman scored 3.2,
      Kimani Vidal 4.1, Jerry Jeudy 4.7, Kenyon Sadiq 6.9 and Roschon Johnson 0.0. Holding KC Concepcion for
      one more week paid 16.8.
    </P>
    <H3>The lesson</H3>
    <P>
      The Big Three went one hit and two misses. Five superflex quarterbacks who played returned 44.3 points
      on bids that topped out at 8%, down from last week&apos;s 52.4 on six, and Darnold never took the field.
      The defenses paid again: six of last week&apos;s seven streamers scored 13 or more (Seattle 17, the Giants
      17, Jacksonville 15, Kansas City 15, Chicago 14, Houston 13), and no defense on the avoid list scored more
      than 10. Last week&apos;s named touchdown traps, Kyle Williams, Kevin Coleman Jr., Nate Boerkircher, Jack
      Endries and Isaiah Williams, returned 10.0 combined.
    </P>
    <H3>Where the market went</H3>
    <UL>
      <LI><strong>Devin Singletary</strong>: 3.6% to 45.1%, on 4.9.</LI>
      <LI><strong>Adonai Mitchell</strong>: 11.4% to 43.0%, and he did not catch a pass.</LI>
      <LI><strong>Tyler Allgeier</strong>: 45.9% to 70.2%, on 5.6.</LI>
      <LI><strong>Jonah Coleman</strong>: 52.3% to 82.0%, and he scored 16.8.</LI>
      <LI><strong>J.J. McCarthy</strong>: 15.4% to 34.0%, on 7.3.</LI>
      <LI><strong>Emmett Johnson</strong>: 11.8% to 23.5%, on 9.4.</LI>
      <LI><strong>Mike Washington Jr.</strong>: 17.5% to 29.8%, on -0.3.</LI>
      <LI><strong>Malik Willis</strong>: 10.6% to 23.6%, on 3.8.</LI>
      <LI><strong>Mike Gesicki</strong>: 15.1% to 26.5%, on 2.1.</LI>
    </UL>

    <H2>The Darkness Doctrine</H2>
    <P>
      Last week&apos;s receipts wrote this week&apos;s rules. Five of them.
    </P>
    <H3>Rule 1: Target share over touchdowns, again</H3>
    <P>
      Tank Dell&apos;s 24% share is why he is a Big Three bid and Kayshon Boutte (HOU WR, 2.8%) is not: Boutte
      scored 26.5 on two TDs, one of them from 63 yards, on a 14% share. This week&apos;s other traps: Ashton
      Dulin (IND WR, a 55-yard TD on his only catch, a 6% share), Keleki Latu (BUF TE, a TD on his only catch,
      a 3% share), Charlie Woerner (ATL TE, a 1-yard TD, his only catch) and Derius Davis (LAC WR, a TD on his
      only catch). Justice Hill is a 3&ndash;5% bid and no more, because 65 of his 85 yards came on one run.
    </P>
    <H3>Rule 2: Buy the job, then check the offense</H3>
    <P>
      The rule cost us last week. Allgeier got 17 carries and Singletary got 21, and they turned them into 77
      yards. Johnson&apos;s job comes in a 23.0 implied total and Kiner&apos;s in 24.5, which is why they top the
      board and Arizona&apos;s backfield is not on it.
    </P>
    <H3>Rule 3: Four byes</H3>
    <P>
      Chicago, Denver, Philadelphia and Tampa Bay are off. Check the lineup before the wire. Jonah Coleman, Bo
      Nix, Courtland Sutton, Makai Lemon and Kenny Gainwell all had Week 9 lines, and none of them plays Sunday.
      Spend nothing on them this week.
    </P>
    <H3>Rule 4: Thursday locks first</H3>
    <P>
      Washington at the Giants is Thursday night (McCarthy, Winston, Okonkwo, Van Jefferson, Reese, Luvu, Cross,
      Zvada). New England and Detroit kick off at 9:30 a.m. ET on Sunday in Munich (Kiner, Bates, Gonzalez), so
      that game locks before the rest of your Sunday. Sunday night is Pittsburgh at Cincinnati (McPherson), and
      Monday night is the Chargers at Baltimore (Brissett, Justice Hill).
    </P>
    <H3>Rule 5: Price the second bet</H3>
    <P>
      Three of last week&apos;s six windows opened, and Allgeier, Singletary and Chism scored 23.9 between them. An
      open window is not a good game. Johnson needs Jacobs out, Kiner needs Stevenson out, Watkins needs Evans out
      and Winston needs McCarthy out. Price each one as the second bet it is.
    </P>
    <Quote>
      Buy the job. Rent the touchdown. Never pay for last week&apos;s.
    </Quote>

    <H2>Who to Cut</H2>
    <UL>
      <LI><strong>Mike Washington Jr.</strong>: -3 rushing yards and -0.3 points, at 29.8%.</LI>
      <LI><strong>Kaelon Black</strong>: Christian McCaffrey is back and scored 21.7, and Black is at 37.0%.</LI>
      <LI><strong>Michael Wilson</strong>: out for the season, at 90.4%. <strong>Gardner Minshew II</strong>: the elbow, at 3.1%.</LI>
      <LI><strong>Mike Gesicki</strong>: 2.1 on a 7% share, at 26.5%.</LI>
      <LI><strong>Carson Wentz</strong>: the 81-yard night, at 4.4%. <strong>Jaylin Noel</strong>: IR, season over, still at 5.7%.</LI>
      <LI><strong>Hold</strong> Josh Jacobs and Rhamondre Stevenson through absences, Puka Nacua in an IR slot, Sam Darnold through the bye, and Lamar Jackson in an IR slot.</LI>
      <LI><strong>Hold</strong> Omar Cooper Jr. (8 for 58 on a 37% share with Garrett Wilson out) and Shedeur Sanders in superflex.</LI>
    </UL>

    <H2>The Week 10 Bid Sheet</H2>
    <P>Set your claims in this order.</P>
    <OL>
      <LI><strong>Kaleb Johnson</strong> at 14&ndash;20%.</LI>
      <LI><strong>Corey Kiner</strong> at 8&ndash;12%. He plays in Munich at 9:30 a.m. ET Sunday.</LI>
      <LI><strong>Tank Dell</strong> at 5&ndash;9%.</LI>
      <LI>Superflex: <strong>Drew Lock</strong> at 4&ndash;7% ($1 in 1QB), then <strong>Jacoby Brissett</strong> at 3&ndash;5%, <strong>Michael Penix Jr.</strong> at 2&ndash;4% and <strong>Cam Ward</strong> at 1&ndash;3%.</LI>
      <LI><strong>Audric Estime</strong> at 4&ndash;7% and <strong>Caleb Douglas</strong> at 3&ndash;6%.</LI>
      <LI><strong>Justice Hill</strong> at 3&ndash;5% and <strong>Darren Waller</strong> at 2&ndash;4%.</LI>
      <LI>The rest of the Full Board at the ranges listed, and $1 on Tutu Atwell.</LI>
    </OL>
    <P>
      Injury statuses are as of Tuesday. Jacobs, Stevenson, Evans and McCarthy decide four of these bids before
      kickoff, Thursday night is Washington at the Giants, and Sunday starts at 9:30 a.m. ET in Munich. Andy
      Darkness is a pen name and has no rooting interest, allegedly.
    </P>
  </>
);

export default Body;
