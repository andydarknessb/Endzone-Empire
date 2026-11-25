import React from 'react';
import { Box } from '@mui/material';
import {
  Lead, P, H2, H3, Quote,
  Table, THead, TBody, TR, TH, TD,
} from '../../components/public/kit/Prose';
import { Note, Chip } from '../../components/public/kit/ArticleBits';
import {
  GameCard, InjuryGroup, JumpGrid, RailList, RulingCard, SlateBoard, TierBoard, WindowChecklist,
} from './darkness-report-parts';

// Body only: the frontmatter lives in week12-start-sit-darkness-report.meta.js so listings can be
// built without loading this prose; content/articles/index.js loads it on demand.
//
// Every color below the hero is a theme token, so the board, cards and chips read in light and
// dark. The hero is a dark illustration in both themes, like the Week 3 start/sit banner.
//
// Reading key (also printed in the article): FPA rank: 1 = most points allowed (good matchup for the
// opposing position), 32 = fewest (tough). Weeks 1 to 11. Times are Eastern. Verdicts come from docs/editorial/week12-rulings.md.

function HeroBanner() {
  // Yard lines in perspective: t runs from 0 at the near edge to 1 at the far end line.
  const rows = [190, 222, 258, 296];
  return (
    <Box
      component="svg"
      viewBox="0 0 800 300"
      xmlns="http://www.w3.org/2000/svg"
      sx={{ width: '100%', borderRadius: 'var(--radius-md, 10px)', overflow: 'hidden', mb: 4, display: 'block' }}
      role="img"
      aria-labelledby="wk12ss-hero-title wk12ss-hero-desc"
    >
      <title id="wk12ss-hero-title">Week 12 Start/Sit: The Darkness Report</title>
      <desc id="wk12ss-hero-desc">
        A night stadium seen from one end: floodlight towers on both sides throw cones of light onto a
        field whose yard lines narrow to a far end line, with a goalpost in the middle. A football
        sits on the turf, and a dotted kick path rises toward the uprights. The headline Week 12 Start/Sit is set in a panel across the bottom.
      </desc>
      <defs>
        <linearGradient id="wk12ss-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#04060c" />
          <stop offset="1" stopColor="#101a2c" />
        </linearGradient>
        <linearGradient id="wk12ss-beam" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#dbe7ff" stopOpacity="0.5" />
          <stop offset="1" stopColor="#dbe7ff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="wk12ss-turf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#123f2e" />
          <stop offset="1" stopColor="#07190f" />
        </linearGradient>
        <linearGradient id="wk12ss-kick" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#ffd866" stopOpacity="0" />
          <stop offset="1" stopColor="#ffd866" stopOpacity="0.95" />
        </linearGradient>
      </defs>
      <rect width="800" height="300" fill="url(#wk12ss-sky)" />
      <rect x="0" y="150" width="800" height="150" fill="url(#wk12ss-turf)" />
      <path d="M60 300 L300 150 L500 150 L740 300" fill="none" stroke="#ffffff" strokeOpacity="0.22" />
      <path d="M300 150 L500 150" stroke="#ffffff" strokeOpacity="0.4" strokeWidth="2" />
      {rows.map((y) => {
        const t = (300 - y) / 150;
        return <line key={y} x1={60 + 240 * t} y1={y} x2={740 - 240 * t} y2={y} stroke="#ffffff" strokeOpacity="0.16" />;
      })}
      <path d="M110 36 L60 300 L340 300 Z M690 36 L460 300 L740 300 Z" fill="url(#wk12ss-beam)" />
      <path d="M110 150 L110 34 M690 150 L690 34" stroke="#3b4a66" strokeWidth="4" strokeLinecap="round" />
      <circle cx="110" cy="30" r="18" fill="#7eaaff" fillOpacity="0.3" />
      <circle cx="690" cy="30" r="18" fill="#7eaaff" fillOpacity="0.3" />
      <rect x="98" y="24" width="24" height="10" rx="2" fill="#dbe7ff" />
      <rect x="678" y="24" width="24" height="10" rx="2" fill="#dbe7ff" />
      <path d="M400 150 L400 112 M372 112 L428 112 M372 112 L372 58 M428 112 L428 58" fill="none" stroke="#ffd866" strokeWidth="3" strokeLinecap="round" />
      <path d="M150 196 C 210 40, 330 20, 400 84" fill="none" stroke="url(#wk12ss-kick)" strokeWidth="3" strokeLinecap="round" strokeDasharray="2 9" />
      <g transform="translate(150 196) rotate(-28) scale(0.7)">
        <ellipse rx="34" ry="19" fill="#6b3416" stroke="#ff8c42" strokeWidth="2" />
        <path d="M-13 -19 Q-18 0 -13 19 M13 -19 Q18 0 13 19" fill="none" stroke="#ffffff" strokeWidth="2" opacity="0.8" />
        <line x1="-10" y1="0" x2="10" y2="0" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
        {[-6, 0, 6].map((x) => (
          <line key={x} x1={x} y1="-4" x2={x} y2="4" stroke="#ffffff" strokeWidth="1.6" strokeLinecap="round" />
        ))}
      </g>
      <text x="400" y="34" textAnchor="middle" fill="#8badc9" fontFamily="system-ui, sans-serif" fontWeight="700" fontSize="12" letterSpacing="4">THE DARKNESS REPORT</text>
      <rect x="110" y="216" width="580" height="68" rx="14" fill="#030814" fillOpacity="0.84" stroke="#7eaaff" strokeOpacity="0.25" />
      <text x="400" y="246" textAnchor="middle" fill="#ffffff" fontFamily="system-ui, sans-serif" fontWeight="850" fontSize="24" letterSpacing="1">WEEK 12 START/SIT</text>
      <text x="400" y="270" textAnchor="middle" fill="#8badc9" fontFamily="system-ui, sans-serif" fontWeight="600" fontSize="12" letterSpacing="2">WEEK 12 | WEDNESDAY TO MONDAY | 16 GAMES</text>
    </Box>
  );
}

// Generated from docs/editorial/week12-rulings.md and the week's dump. Games are in kickoff order.
// Game call items are [name, position, why, rank, flag]. flag is a Darkness Ruling id (C4).
// Injury board rows are [name, position, team, status, pivot, tone, ruling].
// D/ST rows are [d/st, opponent, opp implied, verdict, why].
const GAMES = [
  {
    id: 'gb-lar',
    slot: 'thu',
    title: 'Packers at Rams',
    kick: 'Wed 8:00p',
    when: 'Wednesday Night · 8:00p ET',
    away: 'GB',
    home: 'LAR',
    awayPts: 21,
    homePts: 23.5,
    line: 'LAR -2.5',
    total: 44.5,
    weather: 'Dome',
    rain: false,
    read: 'The Rams are a 2.5-point favorite over Green Bay in a 44.5 total, implied for 23.5 for the Rams and 21 for Green Bay. Jordan Love (QB12) is a start on 19.7 a game, with 36.2 and 10.8 his last two before the bye, and the Rams allow the 8th-fewest QB points. Matthew Golden (WR13) is a start with 10.1 targets a game, though the Rams allow the 3rd-fewest WR points. Christian Watson (WR14) is a start at 18.4 a game, with 30.1 and 6.7 his last two before the bye. Kyren Williams (RB10) is a start on 13.9 carries and 5.1 targets a game, and Green Bay allows the 7th-most RB points, though he played 51% of the snaps before the bye. Matthew Stafford is a sit despite full practice Tuesday (elbow), at 16.3 a game, and Green Bay allows the 6th-fewest QB points. Josh Jacobs (RB26) is a sit, questionable for Wednesday with a finger injury after a limited practice. Puka Nacua is out, on IR after knee surgery and sidelined 4 to 5 months. Davante Adams is out on IR with a hamstring injury.',
    fpa: 'GB offense vs LAR D: QB 25, RB 31, WR 30, TE 25 · LAR offense vs GB D: QB 27, RB 7, WR 5, TE 30',
    start: [
      ['Jordan Love', 'QB', '19.7 a game, 36.2 and 10.8 his last two before the bye; Green Bay implied for 21.0 in a dome Wednesday, though the Rams allow the 8th-fewest QB points; QB12.', 'QB12', 'C12'],
      ['Kyren Williams', 'RB', 'Full practice Tuesday (toe); 13.9 carries and 5.1 targets a game, and Green Bay allows the 7th-most RB points, though he played 51% of the snaps before the bye.', 'RB10', 'C47'],
      ['Matthew Golden', 'WR', '10.1 targets a game, 17.6 points a game and 9 or more targets in each of his last four, though the Rams allow the 3rd-fewest WR points.', 'WR13', 'C86'],
      ['Christian Watson', 'WR', '18.4 a game, 30.1 and 6.7 his last two before the bye; the Rams allow the 3rd-fewest WR points.', 'WR14', 'C87'],
    ],
    flex: [],
    watch: [],
    sit: [
      ['Matthew Stafford', 'QB', 'Full practice Tuesday (elbow), but Puka Nacua and Davante Adams are on IR; 16.3 a game, and Green Bay allows the 6th-fewest QB points.', null, 'C15'],
      ['Blake Corum', 'RB', '17 carries on 51% of the snaps for 20.9 before the bye, the same snap share as Williams.', null, 'C47'],
      ['Josh Jacobs', 'RB', 'Questionable for Wednesday (finger) after a limited practice; 4 carries on 15% of the snaps in Week 9, his last game, and the Rams allow the 2nd-fewest RB points.', 'RB26', 'C63'],
      ['Puka Nacua', 'WR', 'OUT. On IR after knee surgery and out 4 to 5 months; the engine still projects 25.8.', null, 'C119'],
      ['Davante Adams', 'WR', 'OUT. On IR (hamstring); the engine still projects 16.8.', null, 'C120'],
      ['Tucker Kraft', 'TE', '1.9 and 2.9 his last two before the bye on 3 and 4 targets; the Rams allow the 8th-fewest TE points.', null, 'C142'],
    ],
    also: null,
  },
  {
    id: 'chi-det',
    slot: 'thu',
    title: 'Bears at Lions',
    kick: 'Thu 1:00p',
    when: 'Thursday · 1:00p ET',
    away: 'CHI',
    home: 'DET',
    awayPts: 28.5,
    homePts: 27,
    line: 'CHI -1.5',
    total: 55.5,
    weather: 'Dome',
    rain: false,
    read: 'Chicago is a 1.5-point favorite over Detroit in a 55.5 total, implied for 28.5 for Chicago and 27 for Detroit. Caleb Williams (QB10) is a start at 17.8 a game on 5.0 carries, and Detroit allows the 3rd-most QB points. Jahmyr Gibbs (RB1) is a start with 27.8 last week on 23 carries, and 28.1 a game on 22.2 carries. Jared Goff (QB9) is a start with 20.4 in each of the last two games, and Detroit is implied for 27.0 in a dome. Amon-Ra St. Brown (WR5) is a start on a 30% target share and 19.8 a game. Colston Loveland (TE6) is a start, and Detroit allows the most TE points. He played 93% of the snaps last week. D\'Andre Swift (RB19) is a flex on 13 carries and 46% of the snaps last week, down from 72% or more in each of his three games before. Luther Burden III (WR18) is a flex, and Detroit allows the 10th-most WR points, though he had 3 targets on 59% of the snaps last week. Jameson Williams (WR20) is a flex with 19.3 last week on 4 targets.',
    fpa: 'CHI offense vs DET D: QB 3, RB 26, WR 10, TE 1 · DET offense vs CHI D: QB 13, RB 22, WR 23, TE 26',
    start: [
      ['Jared Goff', 'QB', '20.4 in each of the last two games; Detroit implied for 27.0 in a dome Thursday, in a 55.5 total, the highest on the slate.', 'QB9', 'C9'],
      ['Caleb Williams', 'QB', 'Chicago implied for 28.5 Thursday, and Detroit allows the 3rd-most QB points; 17.8 a game on 5.0 carries, 14.3 last week.', 'QB10', 'C10'],
      ['Jahmyr Gibbs', 'RB', '27.8 last week on 23 carries, 28.1 a game on 22.2 carries; Detroit implied for 27.0 Thursday.', 'RB1', 'C38'],
      ['Amon-Ra St. Brown', 'WR', '30% target share, 19.8 a game; Detroit implied for 27.0 in a dome Thursday.', 'WR5', 'C78'],
      ['Colston Loveland', 'TE', 'Detroit allows the most TE points and Chicago is implied for 28.5; 93% of the snaps last week, though 3 targets.', 'TE6', 'C132'],
    ],
    flex: [
      ['D\'Andre Swift', 'RB', '13 carries on 46% of the snaps last week, down from 72% or more in each of his three games before; Chicago is implied for 28.5 Thursday.', 'RB19', 'C56'],
      ['Luther Burden III', 'WR', 'Chicago implied for 28.5 Thursday and Detroit allows the 10th-most WR points, though 3 targets on 59% of the snaps for 3.3 last week.', 'WR18', 'C91'],
      ['Jameson Williams', 'WR', '19.3 last week on 4 targets, 13.4 a game; Detroit implied for 27.0 in a 55.5 total.', 'WR20', 'C93'],
    ],
    watch: [],
    sit: [
      ['Kyle Monangai', 'RB', '8 carries on 38% of the snaps for 1.8 last week in his first game since Week 4.', null, 'C56'],
      ['Rome Odunze', 'WR', '4 targets on 92% of the snaps for 8.5 last week, 9.8 a game; WR31.', 'WR31', 'C104'],
      ['Sam LaPorta', 'TE', 'Full practice Tuesday (ankle); 6 targets on 91% of the snaps for 9.2 last week, but Chicago allows the 7th-fewest TE points; TE14.', 'TE14', 'C140'],
    ],
    also: null,
  },
  {
    id: 'phi-dal',
    slot: 'thu',
    title: 'Eagles at Cowboys',
    kick: 'Thu 4:30p',
    when: 'Thursday · 4:30p ET',
    away: 'PHI',
    home: 'DAL',
    awayPts: 19.5,
    homePts: 28,
    line: 'DAL -8.5',
    total: 47.5,
    weather: 'Retractable roof; 54F, wind 10 and sunny outside',
    rain: false,
    read: 'Dallas is an 8.5-point favorite over Philadelphia in a 47.5 total, implied for 28 for Dallas and 19.5 for Philadelphia. Dak Prescott (QB2) is a start with 34.4 and 35.9 the last two, and Philadelphia allows the 10th-most QB points. Javonte Williams (RB9) is a start on 17.1 carries a game, with 24.1 last week. CeeDee Lamb (WR2) is a start on a 33% target share and 30.2 last week, and Philadelphia allows the 3rd-most WR points. George Pickens (WR3) is a start with 43.5 and 23.8 the last two on 18 and 10 targets. Saquon Barkley (RB23) is a flex with 17 carries on 64% of the snaps last week, and Dallas allows the 3rd-most RB points. DeVonta Smith (WR16) is a flex with 12 targets on 81% of the snaps last week, in his first game since Week 6. Dallas allows the 4th-most WR points. Jalen Hurts is out, on IR and expected to miss the rest of the season. Joe Milton is a sit at 6.3 on 100% of the snaps last week.',
    fpa: 'PHI offense vs DAL D: QB 4, RB 3, WR 4, TE 17 · DAL offense vs PHI D: QB 10, RB 24, WR 3, TE 27',
    start: [
      ['Dak Prescott', 'QB', '34.4 and 35.9 the last two, full practice Tuesday (hand); Dallas implied for 28.0 Thursday, and Philadelphia allows the 10th-most QB points.', 'QB2', 'C2'],
      ['Javonte Williams', 'RB', '17.1 carries a game, 24.1 last week; Dallas implied for 28.0 Thursday as an 8.5-point favorite.', 'RB9', 'C46'],
      ['CeeDee Lamb', 'WR', '30.2 last week, 33% target share; Philadelphia allows the 3rd-most WR points, and Dallas is implied for 28.0 Thursday.', 'WR2', 'C75'],
      ['George Pickens', 'WR', '43.5 and 23.8 the last two on 18 and 10 targets; Philadelphia allows the 3rd-most WR points.', 'WR3', 'C76'],
    ],
    flex: [
      ['Saquon Barkley', 'RB', 'Full practice Tuesday (neck); 17 carries on 64% of the snaps last week, and Dallas allows the 3rd-most RB points, though Philadelphia is implied for 19.5.', 'RB23', 'C60'],
      ['DeVonta Smith', 'WR', '12 targets on 81% of the snaps last week in his first game since Week 6, full practice Tuesday (hamstring); Dallas allows the 4th-most WR points, though Joe Milton is the quarterback.', 'WR16', 'C89'],
    ],
    watch: [],
    sit: [
      ['Joe Milton', 'QB', '6.3 on 100% of the snaps last week with Jalen Hurts on IR; Philadelphia is implied for 19.5 Thursday.', null, 'C31'],
      ['Tanner McKee', 'QB', 'Full practice Tuesday (rib); second on the depth chart.', null, 'C31'],
      ['Jalen Hurts', 'QB', 'OUT. On IR and expected to miss the rest of the season; the engine still projects 18.4.', null, 'C33'],
      ['Makai Lemon', 'WR', '3 targets for 1.3 last week with Smith back.', null, 'C89'],
      ['Ryan Flournoy', 'WR', '1 target on 54% of the snaps last week; WR33.', 'WR33', 'C106'],
      ['Dallas Goedert', 'TE', 'Full practice Tuesday (shin); 1 target on 89% of the snaps last week with Joe Milton at quarterback; TE13.', 'TE13', 'C139'],
      ['Jake Ferguson', 'TE', 'Did not practice Tuesday (knee, ankle) and is listed as doubtful in our data.', null, 'C150'],
    ],
    also: null,
  },
  {
    id: 'kc-buf',
    slot: 'thu',
    title: 'Chiefs at Bills',
    kick: 'Thu 8:20p',
    when: 'Thursday Night · 8:20p ET',
    away: 'KC',
    home: 'BUF',
    awayPts: 21.75,
    homePts: 24.75,
    line: 'BUF -3',
    total: 46.5,
    weather: '37F, wind 13, 100% rain showers',
    rain: true,
    read: 'Buffalo is a 3-point favorite over Kansas City in a 46.5 total, implied for 24.75 for Buffalo and 21.75 for Kansas City. Patrick Mahomes (QB8) is a start with 35.4 and 25.0 the last two. Kenneth Walker III (RB12) is a start if active. He was limited Tuesday (groin) and has not played since Week 9. Josh Allen (QB4) is a start at 23.5 a game on 6.6 carries, and Kansas City allows the 3rd-fewest QB points. James Cook III (RB5) is a start on 20.9 carries a game, though Kansas City allows the 5th-fewest RB points. Travis Kelce (TE7) is a start with 25.4 last week on 7 targets. The Buffalo Bills (DST5) defense is a start, with 21, 22, 12 and 15 the last four. Dalton Kincaid (TE8) is a start if active after a limited Tuesday (thumb, ankle). Emmett Johnson (RB14) is a flex with 22 and 23 carries, and a start if Walker sits again. Rashee Rice (WR22) is a flex with 6 targets in each of the last two. DJ Moore (WR24) is a flex with 19.4 and 23.1 the last two.',
    fpa: 'KC offense vs BUF D: QB 24, RB 13, WR 17, TE 22 · BUF offense vs KC D: QB 30, RB 28, WR 31, TE 6',
    start: [
      ['Josh Allen', 'QB', '23.5 a game on 6.6 carries, though 12.2 last week without a carry; Kansas City allows the 3rd-fewest QB points, and rain is forecast Thursday night.', 'QB4', 'C4'],
      ['Patrick Mahomes', 'QB', '35.4 and 25.0 the last two, full practice Tuesday (knee); Kansas City is implied for 21.75 in Buffalo, with rain forecast Thursday night.', 'QB8', 'C8'],
      ['James Cook III', 'RB', '20.9 carries a game, 18.7 points a game; rain is forecast Thursday night, though Kansas City allows the 5th-fewest RB points.', 'RB5', 'C42'],
      ['Travis Kelce', 'TE', '25.4 last week on 7 targets and 72% of the snaps; 13.0 a game.', 'TE7', 'C133'],
      ['Buffalo Bills', 'DEF', '21, 22, 12 and 15 the last four; rain is forecast Thursday night, though Kansas City is implied for 21.75.', 'DST5', 'C155'],
    ],
    flex: [
      ['Emmett Johnson', 'RB', '22 and 23 carries on 88% and 82% of the snaps for 35.1 and 24.3 with Kenneth Walker III out; a start if Walker sits again, a risk if he plays.', 'RB14', 'C51'],
      ['Rashee Rice', 'WR', 'Full practice Tuesday (knee); 6 targets in each of the last two games, though on 46% and 44% of the snaps.', 'WR22', 'C95'],
      ['DJ Moore', 'WR', '19.4 and 23.1 the last two, 10 targets on 74% of the snaps last week, though Kansas City allows the 2nd-fewest WR points and rain is forecast.', 'WR24', 'C97'],
    ],
    watch: [
      ['Kenneth Walker III', 'RB', 'START if active. Limited Tuesday (groin) and has not played since Week 9; 24.5 a game on 19.9 carries.', 'RB12', 'C49'],
      ['Dalton Kincaid', 'TE', 'START if active. Limited Tuesday (thumb, ankle) and has not played since Week 10; Kansas City allows the 6th-most TE points, though he played 46% of the snaps in his last game.', 'TE8', 'C134'],
    ],
    sit: [
      ['Khalil Shakir', 'WR', '9 targets on 81% of the snaps for 15.3 last week, but 5.4 targets a game, and Kansas City allows the 2nd-fewest WR points.', null, 'C107'],
      ['Josh Downs', 'WR', '5 targets on 24% of the snaps last week.', null, 'C113'],
      ['Xavier Worthy', 'WR', '4 targets for 11.8 last week, 8.0 a game.', null, 'C113'],
    ],
    also: 'George Karlaftis (KC DE) is on the IDP board.',
  },
  {
    id: 'den-pit',
    slot: 'thu',
    title: 'Broncos at Steelers',
    kick: 'Fri 3:00p',
    when: 'Friday · 3:00p ET',
    away: 'DEN',
    home: 'PIT',
    awayPts: 20,
    homePts: 16.5,
    line: 'DEN -3.5',
    total: 36.5,
    weather: '44F, wind 17, 95% light rain',
    rain: true,
    read: 'Denver is a 3.5-point favorite over Pittsburgh in a 36.5 total, implied for 20 for Denver and 16.5 for Pittsburgh. The Denver Broncos (DST3) defense is a start with 13 last week, and Pittsburgh is implied for 16.5, the lowest on the slate. Jonah Coleman (RB8) is a start with 24 carries on 85% of the snaps for 34.9 last week. Pat Freiermuth (TE9) is a start with 11.6, 11.5 and 9.0 his last three, and Denver allows the 3rd-most TE points. Jaylen Warren (RB18) is a flex with 9 carries on 68% of the snaps for 4.9 last week, and Denver allows the 8th-most RB points. Bo Nix is a sit at 14.2 a game, and Pittsburgh allows the 5th-fewest QB points, with rain and 17 mph wind forecast Friday. J.K. Dobbins is out, suspended one game by the team. RJ Harvey is out, on IR with a knee injury.',
    fpa: 'DEN offense vs PIT D: QB 28, RB 16, WR 21, TE 20 · PIT offense vs DEN D: QB 13, RB 8, WR 26, TE 3',
    start: [
      ['Jonah Coleman', 'RB', '24 carries on 85% of the snaps for 34.9 last week; J.K. Dobbins is suspended for Friday and RJ Harvey is on IR.', 'RB8', 'C45'],
      ['Pat Freiermuth', 'TE', 'Denver allows the 3rd-most TE points; 11.6, 11.5 and 9.0 his last three, though Pittsburgh is implied for 16.5.', 'TE9', 'C135'],
      ['Denver Broncos', 'DEF', 'Pittsburgh implied for 16.5 Friday, the lowest on the slate, with rain and 17 mph wind forecast; 13 last week.', 'DST3', 'C153'],
    ],
    flex: [
      ['Jaylen Warren', 'RB', '9 carries on 68% of the snaps for 4.9 last week; Denver allows the 8th-most RB points, though Pittsburgh is implied for 16.5, the lowest on the slate.', 'RB18', 'C55'],
    ],
    watch: [],
    sit: [
      ['Aaron Rodgers', 'QB', 'Pittsburgh implied for 16.5 Friday, the lowest on the slate, with rain and 17 mph wind forecast; 15.0 a game.', null, 'C17'],
      ['Bo Nix', 'QB', '11.5 last week, 14.2 a game; Pittsburgh allows the 5th-fewest QB points, and rain and 17 mph wind are forecast Friday.', null, 'C22'],
      ['J.K. Dobbins', 'RB', 'OUT. Suspended one game by the team; the engine still projects 6.9.', null, 'C45'],
      ['Rico Dowdle', 'RB', '5 carries and 5 targets on 32% of the snaps last week.', null, 'C55'],
      ['RJ Harvey', 'RB', 'OUT. On IR (knee); the engine still projects 10.9.', null, 'C72'],
      ['Max Hurleman', 'WR', '18.1 on 31% of the snaps last week is his only game; the engine\'s 13.2 rests on that one line.', null, 'C108'],
      ['DK Metcalf', 'WR', '4 targets on 62% of the snaps for 1.2 last week; Pittsburgh is implied for 16.5.', null, 'C109'],
      ['Germie Bernard', 'WR', '10 targets on 94% of the snaps for 10.0 last week.', null, 'C109'],
      ['Jaylen Waddle', 'WR', '6 targets on 53% of the snaps last week; rain and 17 mph wind are forecast Friday.', null, 'C112'],
      ['Courtland Sutton', 'WR', '0.0 on 2 targets last week.', null, 'C112'],
    ],
    also: 'Alex Singleton (DEN LB) is on the IDP board.',
  },
  {
    id: 'atl-min',
    slot: 'one',
    title: 'Falcons at Vikings',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'ATL',
    home: 'MIN',
    awayPts: 17.25,
    homePts: 24.25,
    line: 'MIN -7',
    total: 41.5,
    weather: 'Dome',
    rain: false,
    read: 'Minnesota is a 7-point favorite over Atlanta in a 41.5 total, implied for 24.25 for Minnesota and 17.25 for Atlanta. Bijan Robinson (RB6) is a start at 19.8 a game on 18.5 carries and a 17% target share, though Minnesota allows the 4th-fewest RB points. Justin Jefferson (WR12) is a start on a 29% target share, and Atlanta allows the 7th-most WR points. T.J. Hockenson (TE10) is a start with 7 targets in each of his last two games and a 20% target share. The Minnesota Vikings (DST1) defense is a start at 12.6 a game, though -2 last week, and Atlanta is a 7-point underdog implied for 17.25. Drake London (WR19) is a flex on a 28% target share, with 12 targets for 16.9 before the bye, and Minnesota allows the 5th-fewest WR points. Jordan Addison is out, recovering from thumb surgery, and his coach does not expect him to play. Michael Penix Jr. is a sit at 13.6 a game, and Minnesota allows the fewest QB points.',
    fpa: 'ATL offense vs MIN D: QB 32, RB 29, WR 28, TE 32 · MIN offense vs ATL D: QB 6, RB 5, WR 7, TE 18',
    start: [
      ['Bijan Robinson', 'RB', '19.8 a game on 18.5 carries and a 17% target share, though Minnesota allows the 4th-fewest RB points and Atlanta is implied for 17.25.', 'RB6', 'C43'],
      ['Justin Jefferson', 'WR', '29% target share with Jordan Addison not expected to play; Atlanta allows the 7th-most WR points.', 'WR12', 'C85'],
      ['T.J. Hockenson', 'TE', '7 targets in each of his last two games, 20% target share, with Jordan Addison not expected to play; 51% of the snaps last week.', 'TE10', 'C136'],
      ['Minnesota Vikings', 'DEF', 'Atlanta implied for 17.25 as a 7-point underdog; 12.6 a game, though -2 last week.', 'DST1', 'C151'],
    ],
    flex: [
      ['Drake London', 'WR', '28% target share, 12 targets for 16.9 before the bye, though Minnesota allows the 5th-fewest WR points.', 'WR19', 'C92'],
    ],
    watch: [],
    sit: [
      ['Kirk Cousins', 'QB', '15.4 and 7.4 in his two Minnesota games, though Atlanta allows the 6th-most QB points and Minnesota is implied for 24.25; QB13.', 'QB13', 'C13'],
      ['Kyler Murray', 'QB', 'Listed as questionable in our data and has not played since Week 8; second on the depth chart.', null, 'C13'],
      ['Michael Penix Jr.', 'QB', 'Minnesota allows the fewest QB points, and Atlanta is implied for 17.25; 13.6 a game.', null, 'C26'],
      ['Aaron Jones Sr.', 'RB', '8 carries on 39% of the snaps last week; splits with Jordan Mason, though Atlanta allows the 5th-most RB points.', null, 'C65'],
      ['Jordan Mason', 'RB', '11 carries on 42% of the snaps for 4.7 last week.', null, 'C65'],
      ['Jordan Addison', 'WR', 'OUT. Recovering from thumb surgery, and his coach does not expect him to play; the engine still projects 8.9.', null, 'C122'],
      ['Kyle Pitts Sr.', 'TE', 'Minnesota allows the fewest TE points; 7.8 a game.', null, 'C146'],
    ],
    also: 'Blake Cashman (MIN LB) is on the IDP board.',
  },
  {
    id: 'bal-hou',
    slot: 'one',
    title: 'Ravens at Texans',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'BAL',
    home: 'HOU',
    awayPts: 20.25,
    homePts: 27.25,
    line: 'HOU -7',
    total: 47.5,
    weather: 'Retractable roof; 71F, wind 15 and mostly sunny outside',
    rain: false,
    read: 'Houston is a 7-point favorite over Baltimore in a 47.5 total, implied for 27.25 for Houston and 20.25 for Baltimore. C.J. Stroud (QB6) is a start at 20.5 a game, with 20.4 and 20.5 the last two. Nico Collins (WR8) is a start on a 23% target share, with 14.8 last week on 89% of the snaps. Derrick Henry (RB11) is a start at 18.0 carries a game, with 19.0 and 19.1 the last two, though he played 49% of the snaps last week. Zay Flowers (WR11) is a start with 11 targets on 88% of the snaps for 16.4 last week, and Houston allows the 6th-most WR points. The Houston Texans (DST4) defense is a start, with 22 last week, and Baltimore is implied for 20.25. David Montgomery (RB24) is a flex with 26 carries on 73% of the snaps for 15.4 last week. Woody Marks is a sit, listed as questionable in our data with a concussion, and his coach is hopeful he plays Sunday. Jacoby Brissett is a sit with 11.8 and 13.7 the last two, with Baltimore a 7-point underdog. Lamar Jackson is out, on IR after right thumb surgery.',
    fpa: 'BAL offense vs HOU D: QB 17, RB 18, WR 6, TE 28 · HOU offense vs BAL D: QB 15, RB 17, WR 16, TE 11',
    start: [
      ['C.J. Stroud', 'QB', '20.4 and 20.5 the last two, 20.5 a game; Houston implied for 27.25.', 'QB6', 'C6'],
      ['Derrick Henry', 'RB', '19.0 and 19.1 the last two, 18.0 carries a game, though he played 49% of the snaps last week and Baltimore is a 7-point underdog.', 'RB11', 'C48'],
      ['Nico Collins', 'WR', '23% target share, 14.8 last week on 89% of the snaps; Houston implied for 27.25.', 'WR8', 'C81'],
      ['Zay Flowers', 'WR', '11 targets on 88% of the snaps for 16.4 last week, 29% target share; Houston allows the 6th-most WR points.', 'WR11', 'C84'],
      ['Houston Texans', 'DEF', '22 last week; Baltimore is implied for 20.25 with Jacoby Brissett at quarterback.', 'DST4', 'C154'],
    ],
    flex: [
      ['David Montgomery', 'RB', '26 carries on 73% of the snaps for 15.4 last week; Houston is implied for 27.25, though the Texans are hopeful Woody Marks returns.', 'RB24', 'C61'],
    ],
    watch: [],
    sit: [
      ['Jacoby Brissett', 'QB', '11.8 and 13.7 the last two; Baltimore is a 7-point underdog implied for 20.25.', null, 'C18'],
      ['Lamar Jackson', 'QB', 'OUT. On IR after right thumb surgery; the engine still projects 15.0.', null, 'C35'],
      ['Justice Hill', 'RB', '17.6 last week on 6 carries and 5 targets, on 55% of the snaps to Henry\'s 49%.', null, 'C48'],
      ['Woody Marks', 'RB', 'Listed as questionable in our data (concussion), and his coach is hopeful he plays Sunday; 12 carries on 45% of the snaps in Week 10.', null, 'C61'],
      ['Xavier Hutchinson', 'WR', '3 targets for 3.3 last week on 82% of the snaps.', null, 'C118'],
      ['Tank Dell', 'WR', '4 targets in each of the last two games on under half the snaps.', null, 'C118'],
      ['Dalton Schultz', 'TE', '1 target for 2.1 last week.', null, 'C144'],
      ['Mark Andrews', 'TE', '3 targets for 3.4 last week.', null, 'C147'],
    ],
    also: 'Will Anderson Jr. (HOU DE) is on the IDP board.',
  },
  {
    id: 'no-cin',
    slot: 'one',
    title: 'Saints at Bengals',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'NO',
    home: 'CIN',
    awayPts: 20.25,
    homePts: 30.25,
    line: 'CIN -10',
    total: 50.5,
    weather: '54F, wind 12, 64% light rain',
    rain: true,
    read: 'Cincinnati is a 10-point favorite over New Orleans in a 50.5 total, implied for 30.25 for Cincinnati and 20.25 for New Orleans. Joe Burrow (QB1) is a start at 25.2 a game, with 19.9 last week after 39.5, 29.5 and 33.2. Tyler Shough (QB11) is a start at 17.1 a game on 4.3 carries, though rain is likely in Cincinnati. Chase Brown (RB7) is a start with 6.2 targets a game, and New Orleans allows the 2nd-most RB points. Ja\'Marr Chase (WR4) is a start with 9 targets on 97% of the snaps last week, after 31.1, 31.5 and 34.1. Tee Higgins (WR7) is a start at 18.4 a game on a 20% target share. Chris Olave (WR10) is a start on a 28% target share, with 15 targets for 19.2 last week. Mike Gesicki (TE11) is a start with 12.7 last week on 6 targets, and New Orleans allows the 7th-most TE points. Juwan Johnson is a sit, injured a hamstring last week and still being evaluated.',
    fpa: 'NO offense vs CIN D: QB 16, RB 18, WR 20, TE 9 · CIN offense vs NO D: QB 18, RB 2, WR 25, TE 7',
    start: [
      ['Joe Burrow', 'QB', '19.9 last week after 39.5, 29.5 and 33.2, 25.2 a game; Cincinnati is implied for 30.25 as a 10-point favorite.', 'QB1', 'C1'],
      ['Tyler Shough', 'QB', '17.1 a game on 4.3 carries; New Orleans is a 10-point underdog in a 50.5 total, though rain is likely in Cincinnati.', 'QB11', 'C11'],
      ['Chase Brown', 'RB', 'New Orleans allows the 2nd-most RB points and Cincinnati is implied for 30.25; 6.2 targets a game, though 8.6 last week on 6 carries.', 'RB7', 'C44'],
      ['Ja\'Marr Chase', 'WR', '9 targets on 97% of the snaps last week for 8.1, after 31.1, 31.5 and 34.1; Cincinnati implied for 30.25.', 'WR4', 'C77'],
      ['Tee Higgins', 'WR', '18.4 a game on a 20% target share; Cincinnati implied for 30.25, though 3 targets last week.', 'WR7', 'C80'],
      ['Chris Olave', 'WR', '15 targets for 19.2 last week, 28% target share and 10.2 targets a game.', 'WR10', 'C83'],
      ['Mike Gesicki', 'TE', '12.7 last week on 6 targets; Cincinnati is implied for 30.25 and New Orleans allows the 7th-most TE points, though he played 47% of the snaps.', 'TE11', 'C137'],
    ],
    flex: [],
    watch: [],
    sit: [
      ['Samaje Perine', 'RB', '6 carries and 4 targets in each of the last two games for 13.9 and 13.7; 50% of the snaps last week.', null, 'C44'],
      ['Travis Etienne Jr.', 'RB', '14 carries on 44% of the snaps for 7.6 last week; New Orleans is a 10-point underdog.', null, 'C69'],
      ['Alvin Kamara', 'RB', '1 carry on 11% of the snaps last week.', null, 'C69'],
      ['Devaughn Vele', 'WR', '14.6 last week on 7 targets, after 3.7 and 3.4.', null, 'C116'],
      ['Jordyn Tyson', 'WR', '2 targets on 50% of the snaps last week, after 13 targets the week before.', null, 'C116'],
      ['Juwan Johnson', 'TE', 'Injured a hamstring last week and is still being evaluated; 1 target on 38% of the snaps.', null, 'C149'],
    ],
    also: null,
  },
  {
    id: 'nyg-ind',
    slot: 'one',
    title: 'Giants at Colts',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'NYG',
    home: 'IND',
    awayPts: 24,
    homePts: 17.5,
    line: 'NYG -6.5',
    total: 41.5,
    weather: 'Retractable roof; 50F, wind 13 and a 71% chance of light rain outside',
    rain: false,
    read: 'The Giants are a 6.5-point favorite over Indianapolis in a 41.5 total, implied for 24 for the Giants and 17.5 for Indianapolis. Malik Nabers (WR9) is a start with 12 targets for 18.5 last week on a 28% target share. Isaiah Likely (TE5) is a start on a 25% target share and 16.1 a game, with 27.7 and 4.5 the last two on 11 and 3 targets. The New York Giants (DST6) defense is a start at 8.1 a game, with Indianapolis implied for 17.5. Cam Skattebo (RB16) is a flex with 14 carries and 7 targets on 84% of the snaps last week for 5.8, and Indianapolis allows the 9th-most RB points. Jonathan Taylor (RB17) is a flex with 17.1 carries a game, and 6.7, 9.4, 12.3 and 6.7 his last four, and the Giants allow the 6th-fewest RB points. Alec Pierce is out on IR with a heel injury. Jaxson Dart is out on IR. J.J. McCarthy is a sit with 17.1 and 14.2 the last two on 6 and 7 carries, but 10.9 a game. Daniel Jones is a sit with 5.2 and 4.1 the last two.',
    fpa: 'NYG offense vs IND D: QB 11, RB 9, WR 22, TE 15 · IND offense vs NYG D: QB 9, RB 27, WR 14, TE 19',
    start: [
      ['Malik Nabers', 'WR', '12 targets for 18.5 last week, 28% target share; the Giants are implied for 24.0.', 'WR9', 'C82'],
      ['Isaiah Likely', 'TE', '25% target share, 16.1 a game; 27.7 and 4.5 the last two on 11 and 3 targets.', 'TE5', 'C131'],
      ['New York Giants', 'DEF', 'Indianapolis implied for 17.5, and Daniel Jones scored 5.2 and 4.1 the last two weeks; 8.1 a game.', 'DST6', 'C156'],
    ],
    flex: [
      ['Cam Skattebo', 'RB', '14 carries and 7 targets on 84% of the snaps last week, for 5.8; Indianapolis allows the 9th-most RB points, and the Giants are implied for 24.0.', 'RB16', 'C53'],
      ['Jonathan Taylor', 'RB', '17.1 carries a game, but 6.7, 9.4, 12.3 and 6.7 his last four; Indianapolis is implied for 17.5, and the Giants allow the 6th-fewest RB points.', 'RB17', 'C54'],
    ],
    watch: [],
    sit: [
      ['J.J. McCarthy', 'QB', '17.1 and 14.2 the last two on 6 and 7 carries, but 10.9 a game.', null, 'C23'],
      ['Daniel Jones', 'QB', '5.2 and 4.1 the last two; Indianapolis is implied for 17.5.', null, 'C28'],
      ['Jaxson Dart', 'QB', 'OUT. On IR; the engine still projects 17.0.', null, 'C36'],
      ['Alec Pierce', 'WR', 'OUT. On IR (heel); the engine still projects 9.2.', null, 'C126'],
      ['Tyler Warren', 'TE', '2.4 and 3.2 the last two; Indianapolis is implied for 17.5.', null, 'C141'],
    ],
    also: 'Arvell Reese (NYG LB) is on the IDP board.',
  },
  {
    id: 'nyj-mia',
    slot: 'one',
    title: 'Jets at Dolphins',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'NYJ',
    home: 'MIA',
    awayPts: 22,
    homePts: 18.5,
    line: 'NYJ -3.5',
    total: 40.5,
    weather: '75F, wind 8, 29% rain showers',
    rain: false,
    read: 'The Jets are a 3.5-point favorite over Miami in a 40.5 total, implied for 22 for the Jets and 18.5 for Miami. Breece Hall (RB13) is a start with 20 carries on 63% of the snaps for 19.0 last week, and Miami allows the 6th-most RB points. Garrett Wilson (WR23) is a flex on a 28% target share, with 14 and 5 targets the last two, and Miami allows the 4th-fewest WR points. Omar Cooper Jr. (WR29) is a flex if active. He is listed as questionable in our data and has not played since Week 9, with 22.3, 22.5 and 13.8 his last three. Geno Smith is a sit with 19.4 last week but 14.2 a game, and Miami allows the 13th-fewest QB points. Braelon Allen is a sit behind Hall, with 16 carries on 37% of the snaps for 9.4 last week. Malik Willis is out on IR with a groin injury. Kyle McCord is a sit with 12.8 and 3.0 the last two, with Willis on IR. De\'Von Achane is out on IR with a knee injury.',
    fpa: 'NYJ offense vs MIA D: QB 20, RB 6, WR 29, TE 8 · MIA offense vs NYJ D: QB 8, RB 10, WR 27, TE 16',
    start: [
      ['Breece Hall', 'RB', '20 carries on 63% of the snaps for 19.0 last week; Miami allows the 6th-most RB points, and the Jets are 3.5-point favorites.', 'RB13', 'C50'],
    ],
    flex: [
      ['Garrett Wilson', 'WR', '28% target share, 14 and 5 targets the last two; Miami allows the 4th-fewest WR points.', 'WR23', 'C96'],
    ],
    watch: [
      ['Omar Cooper Jr.', 'WR', 'FLEX if active. Listed as questionable in our data and has not played since Week 9; 22.3, 22.5 and 13.8 his last three.', 'WR29', 'C102'],
    ],
    sit: [
      ['Geno Smith', 'QB', '19.4 last week but 14.2 a game; Miami allows the 13th-fewest QB points.', null, 'C19'],
      ['Kyle McCord', 'QB', '12.8 and 3.0 the last two with Malik Willis on IR; Miami is implied for 18.5.', null, 'C29'],
      ['Malik Willis', 'QB', 'OUT. On IR (groin); the engine still projects 12.8.', null, 'C37'],
      ['Braelon Allen', 'RB', '16 carries on 37% of the snaps for 9.4 last week; behind Hall.', null, 'C50'],
      ['Ollie Gordon II', 'RB', '11 carries on 72% of the snaps for 8.7 last week; Miami is implied for 18.5 with Kyle McCord at quarterback.', null, 'C67'],
      ['De\'Von Achane', 'RB', 'OUT. On IR (knee); the engine still projects 14.3.', null, 'C71'],
      ['Adonai Mitchell', 'WR', '3 targets on 62% of the snaps for 5.0 last week; a flex only if Cooper sits.', null, 'C102'],
      ['Caleb Douglas', 'WR', '10 targets for 5.0 last week with Kyle McCord at quarterback.', null, 'C114'],
    ],
    also: 'David Bailey (NYJ LB) is on the IDP board.',
  },
  {
    id: 'ten-jax',
    slot: 'one',
    title: 'Titans at Jaguars',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'TEN',
    home: 'JAX',
    awayPts: 17,
    homePts: 31.5,
    line: 'JAX -14.5',
    total: 48.5,
    weather: '67F, wind 6, partly sunny',
    rain: false,
    read: 'Jacksonville is a 14.5-point favorite over Tennessee in a 48.5 total, implied for 31.5 for Jacksonville and 17 for Tennessee. Trevor Lawrence (QB3) is a start at 18.7 a game, and Tennessee allows the 2nd-most QB points. Parker Washington (WR6) is a start with 17 targets last week, and Tennessee allows the most WR points. The Jacksonville Jaguars (DST2) defense is a start at 9.8 a game. Tony Pollard (RB21) is a flex with 21 carries on 80% of the snaps last week, and Jacksonville allows the 3rd-fewest RB points. Carnell Tate (WR30) is a flex with 5 targets on 90% of the snaps for 13.8 last week. Jakobi Meyers (WR25) is a flex with 10 targets on 83% of the snaps for 12.5 last week. Bhayshul Tuten (RB22) is a flex if active, after aggravating a right ankle injury last week. Chris Rodriguez Jr. is a sit behind Tuten, with 4 carries on 38% of the snaps last week. Cam Ward is a sit with 26.3, 19.1 and 22.2 his last three, and Jacksonville allows the 7th-fewest QB points. Wan\'Dale Robinson is out for the season on IR with an ankle injury.',
    fpa: 'TEN offense vs JAX D: QB 26, RB 30, WR 18, TE 29 · JAX offense vs TEN D: QB 2, RB 14, WR 1, TE 14',
    start: [
      ['Trevor Lawrence', 'QB', 'Jacksonville implied for 31.5, the highest on the slate, and Tennessee allows the 2nd-most QB points; 12.7 last week, 18.7 a game.', 'QB3', 'C3'],
      ['Parker Washington', 'WR', '17 targets last week, 28.2 and 18.3 the last two; Tennessee allows the most WR points, and Jacksonville is implied for 31.5.', 'WR6', 'C79'],
      ['Jacksonville Jaguars', 'DEF', 'Tennessee implied for 17.0 as a 14.5-point underdog; 9.8 a game.', 'DST2', 'C152'],
    ],
    flex: [
      ['Tony Pollard', 'RB', '21 carries on 80% of the snaps last week, though Tennessee is a 14.5-point underdog and Jacksonville allows the 3rd-fewest RB points.', 'RB21', 'C58'],
      ['Jakobi Meyers', 'WR', '10 targets on 83% of the snaps for 12.5 last week; Tennessee allows the most WR points, and Jacksonville is implied for 31.5.', 'WR25', 'C98'],
      ['Carnell Tate', 'WR', '5 targets on 90% of the snaps for 13.8 last week in his first game since Week 7; 26% target share, though Tennessee is implied for 17.0; WR30.', 'WR30', 'C103'],
    ],
    watch: [
      ['Bhayshul Tuten', 'RB', 'FLEX if active. Aggravated a right ankle injury last week, when he had 10 carries on 43% of the snaps; Jacksonville is implied for 31.5, the highest on the slate.', 'RB22', 'C59'],
    ],
    sit: [
      ['Cam Ward', 'QB', '26.3, 19.1 and 22.2 his last three, but Tennessee is implied for 17.0 as a 14.5-point underdog, and Jacksonville allows the 7th-fewest QB points.', null, 'C24'],
      ['Chris Rodriguez Jr.', 'RB', '4 carries on 38% of the snaps last week; next up if Tuten sits.', null, 'C59'],
      ['Wan\'Dale Robinson', 'WR', 'OUT. On IR and out for the season (ankle); the engine still projects 9.6.', null, 'C125'],
      ['Brenton Strange', 'TE', '3 targets in each of the last two games, 8.5 a game.', null, 'C145'],
    ],
    also: null,
  },
  {
    id: 'ne-lac',
    slot: 'late',
    title: 'Patriots at Chargers',
    kick: 'Sun 4:05p',
    when: 'Sun 4:05p ET',
    away: 'NE',
    home: 'LAC',
    awayPts: 17,
    homePts: 18.5,
    line: 'LAC -1.5',
    total: 35.5,
    weather: 'Dome',
    rain: false,
    read: 'The Chargers are a 1.5-point favorite over New England in a 35.5 total, implied for 18.5 for the Chargers and 17 for New England. Ladd McConkey (WR21) is a flex with 8 targets on 78% of the snaps for 20.7 last week in his first game since Week 8, and New England allows the 2nd-most WR points. Drake Maye is out, listed as out in our data with a fractured right fibula and not on IR. Romeo Doubs is out on IR with a shoulder injury. Justin Herbert is a sit, in the concussion protocol, with 22.4 last week on 8 carries but 12.1 a game. DJ Uiagalelei is a sit, second on the Chargers\' depth chart and the next man up if Herbert is not cleared. Tommy DeVito is a sit, first on New England\'s depth chart with Maye out, and 7.1 on 83% of the snaps before the bye. A.J. Brown is a sit, listed as doubtful in our data with a hamstring injury, and he was not seen at Tuesday\'s unofficial practice.',
    fpa: 'NE offense vs LAC D: QB 21, RB 11, WR 8, TE 24 · LAC offense vs NE D: QB 12, RB 15, WR 2, TE 31',
    start: [],
    flex: [
      ['Ladd McConkey', 'WR', '8 targets on 78% of the snaps for 20.7 last week in his first game since Week 8; New England allows the 2nd-most WR points, though Justin Herbert is in the concussion protocol.', 'WR21', 'C94'],
    ],
    watch: [],
    sit: [
      ['Justin Herbert', 'QB', 'In the concussion protocol; 22.4 last week on 8 carries but 12.1 a game, in a 35.5 total, the lowest on the slate.', null, 'C20'],
      ['DJ Uiagalelei', 'QB', 'Second on the Chargers\' depth chart; the next man up if Herbert is not cleared.', null, 'C20'],
      ['Tommy DeVito', 'QB', 'First on New England\'s depth chart with Drake Maye listed as out in our data; 7.1 on 83% of the snaps before the bye, and New England is implied for 17.0.', null, 'C30'],
      ['Drake Maye', 'QB', 'OUT. Listed as out in our data with a fractured right fibula, though not on IR; the engine still projects 16.3.', null, 'C34'],
      ['Omarion Hampton', 'RB', '14 carries on 55% of the snaps for 10.3 last week; the Chargers are implied for 18.5 with Justin Herbert in the concussion protocol; RB25.', 'RB25', 'C62'],
      ['Rhamondre Stevenson', 'RB', '6 carries on 44% of the snaps for 1.5 before the bye; New England is implied for 17.0 with Tommy DeVito first on the depth chart.', 'RB27', 'C64'],
      ['Mack Hollins', 'WR', '6 targets on 92% of the snaps before the bye, but Tommy DeVito is first on the depth chart at quarterback.', null, 'C115'],
      ['A.J. Brown', 'WR', 'Listed as doubtful in our data (hamstring) and was not seen at Tuesday\'s unofficial practice.', null, 'C115'],
      ['Romeo Doubs', 'WR', 'OUT. On IR (shoulder); the engine still projects 10.0.', null, 'C124'],
      ['Hunter Henry', 'TE', '3 targets in each of his last three games; New England is implied for 17.0.', null, 'C148'],
    ],
    also: null,
  },
  {
    id: 'sea-sf',
    slot: 'late',
    title: 'Seahawks at 49ers',
    kick: 'Sun 4:25p',
    when: 'Sun 4:25p ET',
    away: 'SEA',
    home: 'SF',
    awayPts: 21.25,
    homePts: 24.25,
    line: 'SF -3',
    total: 45.5,
    weather: '63F, wind 12, 68% light rain',
    rain: true,
    read: 'San Francisco is a 3-point favorite over Seattle in a 45.5 total, implied for 24.25 for San Francisco and 21.25 for Seattle. Jaxon Smith-Njigba (WR1) is a start on a 38% target share and 26.4 a game, and San Francisco allows the 9th-most WR points. Brock Purdy (QB7) is a start with 31.7 and 22.2 the last two, though Seattle allows the 2nd-fewest QB points. Christian McCaffrey (RB2) is a start at 22.7 a game on an 18% target share, with 14.2 last week on 12 carries. George Kittle (TE4) is a start with 18.4 last week and 14.7 a game, and Seattle allows the 10th-fewest TE points. Mike Evans (WR26) is a flex with 22.9 on 7 targets last week, and Seattle allows the fewest WR points. Sam Darnold is a sit. He has not played since Week 8 with quadriceps and rib injuries, and he is listed as questionable in our data. Drew Lock is a sit, the starter if Darnold is not ready. Kaelon Black is a sit, the No. 2 behind McCaffrey, with 6 carries on 30% of the snaps last week.',
    fpa: 'SEA offense vs SF D: QB 19, RB 25, WR 9, TE 13 · SF offense vs SEA D: QB 31, RB 23, WR 32, TE 23',
    start: [
      ['Brock Purdy', 'QB', '31.7 and 22.2 the last two, 22.5 a game, though Seattle allows the 2nd-fewest QB points.', 'QB7', 'C7'],
      ['Christian McCaffrey', 'RB', '22.7 a game on an 18% target share; 14.2 last week on 12 carries.', 'RB2', 'C39'],
      ['Jaxon Smith-Njigba', 'WR', '38% target share and 26.4 a game, 31.1 before the bye; San Francisco allows the 9th-most WR points, though Sam Darnold is listed as questionable in our data.', 'WR1', 'C74'],
      ['George Kittle', 'TE', '18.4 last week, 14.7 a game on a 23% target share, though 3 targets, and Seattle allows the 10th-fewest TE points.', 'TE4', 'C130'],
    ],
    flex: [
      ['Mike Evans', 'WR', '22.9 on 7 targets last week in his first game since Week 6, on 43% of the snaps; Seattle allows the fewest WR points.', 'WR26', 'C99'],
    ],
    watch: [],
    sit: [
      ['Sam Darnold', 'QB', 'Has not played since Week 8 (quadriceps, rib); his coach said he starts Sunday if Wednesday\'s practice goes well; 13.2 a game.', null, 'C25'],
      ['Drew Lock', 'QB', '12.6 and 15.6 on 100% of the snaps in Seattle\'s last two games; the starter if Darnold is not ready.', null, 'C25'],
      ['Kaelon Black', 'RB', '6 carries on 30% of the snaps last week; the No. 2 behind McCaffrey.', null, 'C39'],
      ['Zach Charbonnet', 'RB', '20 carries on 72% of the snaps before the bye, but 9.4 points for it, and San Francisco allows the 8th-fewest RB points.', null, 'C68'],
      ['Deebo Samuel Sr.', 'WR', '4 targets on 52% of the snaps for 7.7 last week.', null, 'C99'],
      ['Keenan Allen', 'WR', '4 targets on 57% of the snaps for 6.8 last week.', null, 'C99'],
    ],
    also: null,
  },
  {
    id: 'was-ari',
    slot: 'late',
    title: 'Commanders at Cardinals',
    kick: 'Sun 4:25p',
    when: 'Sun 4:25p ET',
    away: 'WAS',
    home: 'ARI',
    awayPts: 24.25,
    homePts: 17.25,
    line: 'WAS -7',
    total: 41.5,
    weather: 'Retractable roof; 76F and sunny outside',
    rain: false,
    read: 'Washington is a 7-point favorite over Arizona in a 41.5 total, implied for 24.25 for Washington and 17.25 for Arizona. Jayden Daniels (QB5) is a start at 19.1 a game on 6.0 carries, and Arizona allows the most QB points. Trey McBride (TE1) is a start with 14 targets last week on a 30% target share, and Washington allows the 2nd-most TE points. Chig Okonkwo (TE12) is a start with 10.6 last week on 5 targets and 72% of the snaps, and Arizona allows the 4th-most TE points. Stefon Diggs (WR17) is a flex on a 23% target share and 13.2 a game, though 8.5 last week. Antonio Williams (WR28) is a flex with 11 targets on 84% of the snaps for 21.2 last week. Terry McLaurin is out on IR after knee surgery. James Conner is out on IR with a foot injury. Michael Wilson is out on IR with a neck injury. Josh Johnson is a sit with 10.7 on 100% of the snaps last week. Carson Beck is a sit, listed as questionable in our data and first on Arizona\'s depth chart, though Johnson took every snap last week.',
    fpa: 'WAS offense vs ARI D: QB 1, RB 12, WR 13, TE 4 · ARI offense vs WAS D: QB 7, RB 21, WR 12, TE 2',
    start: [
      ['Jayden Daniels', 'QB', 'Arizona allows the most QB points; 19.1 a game on 6.0 carries, and Washington is implied for 24.25.', 'QB5', 'C5'],
      ['Trey McBride', 'TE', '14 targets last week, 30% target share; Washington allows the 2nd-most TE points.', 'TE1', 'C127'],
      ['Chig Okonkwo', 'TE', 'Arizona allows the 4th-most TE points; 10.6 last week on 5 targets and 72% of the snaps; TE12.', 'TE12', 'C138'],
    ],
    flex: [
      ['Stefon Diggs', 'WR', '23% target share, 13.2 a game; Washington implied for 24.25, though 8.5 last week.', 'WR17', 'C90'],
      ['Antonio Williams', 'WR', '11 targets on 84% of the snaps for 21.2 last week, though 2 targets the week before; Washington implied for 24.25.', 'WR28', 'C101'],
    ],
    watch: [],
    sit: [
      ['Josh Johnson', 'QB', '10.7 on 100% of the snaps last week; Carson Beck is listed as questionable in our data and Gardner Minshew II is on IR.', null, 'C32'],
      ['Carson Beck', 'QB', 'Listed as questionable in our data; first on Arizona\'s depth chart, but Josh Johnson took every snap last week.', null, 'C32'],
      ['Jacory Croskey-Merritt', 'RB', '13 carries on 41% of the snaps for 15.7 last week in his first game since Week 5; Washington split the snaps three ways.', null, 'C66'],
      ['Rachaad White', 'RB', 'No carries on 22% of the snaps last week.', null, 'C66'],
      ['Tyler Allgeier', 'RB', '7 carries on 54% of the snaps for 2.3 last week; Arizona is implied for 17.25.', null, 'C70'],
      ['James Conner', 'RB', 'OUT. On IR (foot); the engine still projects 10.4.', null, 'C73'],
      ['Michael Wilson', 'WR', 'OUT. On IR (neck); the engine still projects 14.1.', null, 'C121'],
      ['Terry McLaurin', 'WR', 'OUT. On IR after knee surgery; the engine still projects 10.3.', null, 'C123'],
    ],
    also: null,
  },
  {
    id: 'lv-cle',
    slot: 'prime',
    title: 'Raiders at Browns',
    kick: 'Sun 8:20p',
    when: 'Sunday Night · 8:20p ET',
    away: 'LV',
    home: 'CLE',
    awayPts: 18,
    homePts: 22.5,
    line: 'CLE -4.5',
    total: 40.5,
    weather: '47F, wind 15, 71% light rain',
    rain: true,
    read: 'Cleveland is a 4.5-point favorite over Las Vegas in a 40.5 total, implied for 22.5 for Cleveland and 18 for Las Vegas. Brock Bowers (TE2) is a start if active. He is listed as questionable in our data and has not played since Week 10. Harold Fannin Jr. (TE3) is a start with 9 targets for 16.1 before the bye, and Las Vegas allows the 5th-most TE points. The Cleveland Browns (DST8) defense is a start at 7.3 a game, with rain likely Sunday night. Ashton Jeanty (RB15) is a flex with 27.9 last week on 11 carries and 8 targets. Quinshon Judkins (RB20) is a flex with 10 carries for 16.1 before the bye, and Las Vegas allows the 4th-most RB points. KC Concepcion (WR27) is a flex with 8 targets for 11.7 before the bye, and Las Vegas allows the 11th-most WR points. Deshaun Watson (QB14) is a sit with 15.5 a game. Michael Mayer is a sit, a start only if Bowers sits. Denzel Boston is a sit after not taking part in Tuesday\'s unofficial practice (toe). Fernando Mendoza is a sit with 22.9 last week.',
    fpa: 'LV offense vs CLE D: QB 23, RB 20, WR 19, TE 12 · CLE offense vs LV D: QB 5, RB 4, WR 11, TE 5',
    start: [
      ['Harold Fannin Jr.', 'TE', '9 targets on 87% of the snaps for 16.1 before the bye; Las Vegas allows the 5th-most TE points.', 'TE3', 'C129'],
      ['Cleveland Browns', 'DEF', 'Las Vegas implied for 18.0 Sunday night with rain likely and 15 mph wind; 7.3 a game.', 'DST8', 'C158'],
    ],
    flex: [
      ['Ashton Jeanty', 'RB', '27.9 last week on 11 carries, 8 targets and 84% of the snaps; 6.1 targets a game, though Las Vegas is implied for 18.0.', 'RB15', 'C52'],
      ['Quinshon Judkins', 'RB', 'Las Vegas allows the 4th-most RB points; 10 carries and 5 targets for 16.1 before the bye, though on 47% of the snaps.', 'RB20', 'C57'],
      ['KC Concepcion', 'WR', '8 targets for 11.7 before the bye, 20% target share; Las Vegas allows the 11th-most WR points, and Denzel Boston is listed as questionable in our data.', 'WR27', 'C100'],
    ],
    watch: [
      ['Brock Bowers', 'TE', 'START if active. Listed as questionable in our data and has not played since Week 10, when he had 19% of the snaps; 26% target share, 18.7 a game.', 'TE2', 'C128'],
    ],
    sit: [
      ['Deshaun Watson', 'QB', '21.4 on 8 carries before the bye, and Las Vegas allows the 5th-most QB points, but 15.5 a game; QB14.', 'QB14', 'C14'],
      ['Fernando Mendoza', 'QB', '22.9 last week in his second straight game on 100% of the snaps; Las Vegas is implied for 18.0 Sunday night, with rain likely in Cleveland.', null, 'C21'],
      ['Dylan Sampson', 'RB', '6 targets in each of his last two games, on 51% of the snaps before the bye.', null, 'C57'],
      ['Denzel Boston', 'WR', 'Did not take part in Tuesday\'s unofficial practice (toe); 2 targets for 2.6 before the bye.', null, 'C100'],
      ['Jack Bech', 'WR', '9 targets on 79% of the snaps for 22.8 last week, after 3.0 the week before; Las Vegas is implied for 18.0.', null, 'C110'],
      ['Tre Tucker', 'WR', '10 targets for 7.0 last week.', null, 'C110'],
      ['Michael Mayer', 'TE', '4 targets on 67% of the snaps for 1.4 last week; a start only if Bowers sits.', null, 'C128'],
    ],
    also: 'Nakobe Dean (LV LB) and Carson Schwesinger (CLE LB) are on the IDP board.',
  },
  {
    id: 'car-tb',
    slot: 'prime',
    title: 'Panthers at Buccaneers',
    kick: 'Mon 8:15p',
    when: 'Monday Night · 8:15p ET',
    away: 'CAR',
    home: 'TB',
    awayPts: 20.25,
    homePts: 23.25,
    line: 'TB -3',
    total: 43.5,
    weather: '67F, wind 3, 22% isolated rain showers',
    rain: false,
    read: 'Tampa Bay is a 3-point favorite over Carolina in a 43.5 total, implied for 23.25 for Tampa Bay and 20.25 for Carolina. Chuba Hubbard (RB4) is a start with 27 carries in each of the last two games for 34.2 and 26.0, on 84% and 82% of the snaps, though Tampa Bay allows the fewest RB points. Tetairoa McMillan (WR15) is a start with 19.1 last week on 9 targets and a 26% target share, though Tampa Bay allows the 9th-fewest WR points. Bucky Irving (RB3) is a start with 18 carries for 19.0 last week, and Carolina allows the most RB points. The Tampa Bay Buccaneers (DST7) defense is a start at 11.0 a game, though 0 last week, with Carolina implied for 20.25 Monday. Bryce Young is a sit with 16.0 last week and 17.1 a game, and Tampa Bay allows the 4th-fewest QB points. Baker Mayfield is a sit with 19.1 last week on 6 carries, but 10.0 a game. Kenny Gainwell is a sit behind Irving, with 4 carries and 5 targets on 41% of the snaps last week.',
    fpa: 'CAR offense vs TB D: QB 29, RB 32, WR 24, TE 10 · TB offense vs CAR D: QB 22, RB 1, WR 15, TE 21',
    start: [
      ['Bucky Irving', 'RB', 'Carolina allows the most RB points; 18 carries for 19.0 last week, 17.8 a game on 18.5 carries.', 'RB3', 'C40'],
      ['Chuba Hubbard', 'RB', '27 carries in each of the last two games for 34.2 and 26.0, on 84% and 82% of the snaps, though Tampa Bay allows the fewest RB points.', 'RB4', 'C41'],
      ['Tetairoa McMillan', 'WR', '19.1 last week on 9 targets, 26% target share, though Tampa Bay allows the 9th-fewest WR points.', 'WR15', 'C88'],
      ['Tampa Bay Buccaneers', 'DEF', '11.0 a game; Carolina implied for 20.25 Monday, though 0 last week.', 'DST7', 'C157'],
    ],
    flex: [],
    watch: [],
    sit: [
      ['Bryce Young', 'QB', '16.0 last week, 17.1 a game; Tampa Bay allows the 4th-fewest QB points.', null, 'C16'],
      ['Baker Mayfield', 'QB', '19.1 last week on 6 carries, but 10.0 a game.', null, 'C27'],
      ['Kenny Gainwell', 'RB', '4 carries and 5 targets on 41% of the snaps last week; behind Irving.', null, 'C40'],
      ['Emeka Egbuka', 'WR', '5 targets in each of the last two games for 6.9 and 3.8; WR32.', 'WR32', 'C105'],
      ['Ted Hurst III', 'WR', '22.6 on 7 targets last week, after 0.0 in each of his three games before.', null, 'C111'],
      ['Jalen Coker', 'WR', '7 targets for 8.7 last week.', null, 'C117'],
      ['Darren Waller', 'TE', '3 targets on 46% of the snaps last week.', null, 'C143'],
    ],
    also: null,
  },
];

const QB_ROWS = [
  [1, 'Joe Burrow', 'CIN', '19.9 last week after 39.5, 29.5 and 33.2, 25.2 a game; Cincinnati is implied for 30.25 as a 10-point favorite', 'start'],
  [2, 'Dak Prescott', 'DAL', '34.4 and 35.9 the last two, full practice Tuesday (hand); Dallas implied for 28.0 Thursday, and Philadelphia allows the 10th-most QB points', 'start'],
  [3, 'Trevor Lawrence', 'JAX', 'Jacksonville implied for 31.5, the highest on the slate, and Tennessee allows the 2nd-most QB points; 12.7 last week, 18.7 a game', 'start'],
  [4, 'Josh Allen', 'BUF', '23.5 a game on 6.6 carries, though 12.2 last week without a carry; Kansas City allows the 3rd-fewest QB points, and rain is forecast Thursday night', 'start'],
  [5, 'Jayden Daniels', 'WAS', 'Arizona allows the most QB points; 19.1 a game on 6.0 carries, and Washington is implied for 24.25', 'start'],
  [6, 'C.J. Stroud', 'HOU', '20.4 and 20.5 the last two, 20.5 a game; Houston implied for 27.25', 'start'],
  [7, 'Brock Purdy', 'SF', '31.7 and 22.2 the last two, 22.5 a game, though Seattle allows the 2nd-fewest QB points', 'start'],
  [8, 'Patrick Mahomes', 'KC', '35.4 and 25.0 the last two, full practice Tuesday (knee); Kansas City is implied for 21.75 in Buffalo, with rain forecast Thursday night', 'start'],
  [9, 'Jared Goff', 'DET', '20.4 in each of the last two games; Detroit implied for 27.0 in a dome Thursday, in a 55.5 total, the highest on the slate', 'start'],
  [10, 'Caleb Williams', 'CHI', 'Chicago implied for 28.5 Thursday, and Detroit allows the 3rd-most QB points; 17.8 a game on 5.0 carries, 14.3 last week', 'start'],
  [11, 'Tyler Shough', 'NO', '17.1 a game on 4.3 carries; New Orleans is a 10-point underdog in a 50.5 total, though rain is likely in Cincinnati', 'start'],
  [12, 'Jordan Love', 'GB', '19.7 a game, 36.2 and 10.8 his last two before the bye; Green Bay implied for 21.0 in a dome Wednesday, though the Rams allow the 8th-fewest QB points; QB12', 'start'],
  [13, 'Kirk Cousins', 'MIN', '15.4 and 7.4 in his two Minnesota games, though Atlanta allows the 6th-most QB points and Minnesota is implied for 24.25; QB13', 'sit'],
  [14, 'Deshaun Watson', 'CLE', '21.4 on 8 carries before the bye, and Las Vegas allows the 5th-most QB points, but 15.5 a game; QB14', 'sit'],
];

const RB_ROWS = [
  [1, 'Jahmyr Gibbs', 'DET', '27.8 last week on 23 carries, 28.1 a game on 22.2 carries; Detroit implied for 27.0 Thursday', 'start'],
  [2, 'Christian McCaffrey', 'SF', '22.7 a game on an 18% target share; 14.2 last week on 12 carries', 'start'],
  [3, 'Bucky Irving', 'TB', 'Carolina allows the most RB points; 18 carries for 19.0 last week, 17.8 a game on 18.5 carries', 'start'],
  [4, 'Chuba Hubbard', 'CAR', '27 carries in each of the last two games for 34.2 and 26.0, on 84% and 82% of the snaps, though Tampa Bay allows the fewest RB points', 'start'],
  [5, 'James Cook III', 'BUF', '20.9 carries a game, 18.7 points a game; rain is forecast Thursday night, though Kansas City allows the 5th-fewest RB points', 'start'],
  [6, 'Bijan Robinson', 'ATL', '19.8 a game on 18.5 carries and a 17% target share, though Minnesota allows the 4th-fewest RB points and Atlanta is implied for 17.25', 'start'],
  [7, 'Chase Brown', 'CIN', 'New Orleans allows the 2nd-most RB points and Cincinnati is implied for 30.25; 6.2 targets a game, though 8.6 last week on 6 carries', 'start'],
  [8, 'Jonah Coleman', 'DEN', '24 carries on 85% of the snaps for 34.9 last week; J.K. Dobbins is suspended for Friday and RJ Harvey is on IR', 'start'],
  [9, 'Javonte Williams', 'DAL', '17.1 carries a game, 24.1 last week; Dallas implied for 28.0 Thursday as an 8.5-point favorite', 'start'],
  [10, 'Kyren Williams', 'LAR', 'Full practice Tuesday (toe); 13.9 carries and 5.1 targets a game, and Green Bay allows the 7th-most RB points, though he played 51% of the snaps before the bye', 'start'],
  [11, 'Derrick Henry', 'BAL', '19.0 and 19.1 the last two, 18.0 carries a game, though he played 49% of the snaps last week and Baltimore is a 7-point underdog', 'start'],
  [12, 'Kenneth Walker III', 'KC', 'If active. Limited Tuesday (groin) and has not played since Week 9; 24.5 a game on 19.9 carries', 'start'],
  [13, 'Breece Hall', 'NYJ', '20 carries on 63% of the snaps for 19.0 last week; Miami allows the 6th-most RB points, and the Jets are 3.5-point favorites', 'start'],
  [14, 'Emmett Johnson', 'KC', '22 and 23 carries on 88% and 82% of the snaps for 35.1 and 24.3 with Kenneth Walker III out; a start if Walker sits again, a risk if he plays', 'flex'],
  [15, 'Ashton Jeanty', 'LV', '27.9 last week on 11 carries, 8 targets and 84% of the snaps; 6.1 targets a game, though Las Vegas is implied for 18.0', 'flex'],
  [16, 'Cam Skattebo', 'NYG', '14 carries and 7 targets on 84% of the snaps last week, for 5.8; Indianapolis allows the 9th-most RB points, and the Giants are implied for 24.0', 'flex'],
  [17, 'Jonathan Taylor', 'IND', '17.1 carries a game, but 6.7, 9.4, 12.3 and 6.7 his last four; Indianapolis is implied for 17.5, and the Giants allow the 6th-fewest RB points', 'flex'],
  [18, 'Jaylen Warren', 'PIT', '9 carries on 68% of the snaps for 4.9 last week; Denver allows the 8th-most RB points, though Pittsburgh is implied for 16.5, the lowest on the slate', 'flex'],
  [19, 'D\'Andre Swift', 'CHI', '13 carries on 46% of the snaps last week, down from 72% or more in each of his three games before; Chicago is implied for 28.5 Thursday', 'flex'],
  [20, 'Quinshon Judkins', 'CLE', 'Las Vegas allows the 4th-most RB points; 10 carries and 5 targets for 16.1 before the bye, though on 47% of the snaps', 'flex'],
  [21, 'Tony Pollard', 'TEN', '21 carries on 80% of the snaps last week, though Tennessee is a 14.5-point underdog and Jacksonville allows the 3rd-fewest RB points', 'flex'],
  [22, 'Bhayshul Tuten', 'JAX', 'If active. Aggravated a right ankle injury last week, when he had 10 carries on 43% of the snaps; Jacksonville is implied for 31.5, the highest on the slate', 'flex'],
  [23, 'Saquon Barkley', 'PHI', 'Full practice Tuesday (neck); 17 carries on 64% of the snaps last week, and Dallas allows the 3rd-most RB points, though Philadelphia is implied for 19.5', 'flex'],
  [24, 'David Montgomery', 'HOU', '26 carries on 73% of the snaps for 15.4 last week; Houston is implied for 27.25, though the Texans are hopeful Woody Marks returns', 'flex'],
  [25, 'Omarion Hampton', 'LAC', '14 carries on 55% of the snaps for 10.3 last week; the Chargers are implied for 18.5 with Justin Herbert in the concussion protocol; RB25', 'sit'],
  [26, 'Josh Jacobs', 'GB', 'Questionable for Wednesday (finger) after a limited practice; 4 carries on 15% of the snaps in Week 9, his last game, and the Rams allow the 2nd-fewest RB points', 'sit'],
  [27, 'Rhamondre Stevenson', 'NE', '6 carries on 44% of the snaps for 1.5 before the bye; New England is implied for 17.0 with Tommy DeVito first on the depth chart', 'sit'],
];

const WR_ROWS = [
  [1, 'Jaxon Smith-Njigba', 'SEA', '38% target share and 26.4 a game, 31.1 before the bye; San Francisco allows the 9th-most WR points, though Sam Darnold is listed as questionable in our data', 'start'],
  [2, 'CeeDee Lamb', 'DAL', '30.2 last week, 33% target share; Philadelphia allows the 3rd-most WR points, and Dallas is implied for 28.0 Thursday', 'start'],
  [3, 'George Pickens', 'DAL', '43.5 and 23.8 the last two on 18 and 10 targets; Philadelphia allows the 3rd-most WR points', 'start'],
  [4, 'Ja\'Marr Chase', 'CIN', '9 targets on 97% of the snaps last week for 8.1, after 31.1, 31.5 and 34.1; Cincinnati implied for 30.25', 'start'],
  [5, 'Amon-Ra St. Brown', 'DET', '30% target share, 19.8 a game; Detroit implied for 27.0 in a dome Thursday', 'start'],
  [6, 'Parker Washington', 'JAX', '17 targets last week, 28.2 and 18.3 the last two; Tennessee allows the most WR points, and Jacksonville is implied for 31.5', 'start'],
  [7, 'Tee Higgins', 'CIN', '18.4 a game on a 20% target share; Cincinnati implied for 30.25, though 3 targets last week', 'start'],
  [8, 'Nico Collins', 'HOU', '23% target share, 14.8 last week on 89% of the snaps; Houston implied for 27.25', 'start'],
  [9, 'Malik Nabers', 'NYG', '12 targets for 18.5 last week, 28% target share; the Giants are implied for 24.0', 'start'],
  [10, 'Chris Olave', 'NO', '15 targets for 19.2 last week, 28% target share and 10.2 targets a game', 'start'],
  [11, 'Zay Flowers', 'BAL', '11 targets on 88% of the snaps for 16.4 last week, 29% target share; Houston allows the 6th-most WR points', 'start'],
  [12, 'Justin Jefferson', 'MIN', '29% target share with Jordan Addison not expected to play; Atlanta allows the 7th-most WR points', 'start'],
  [13, 'Matthew Golden', 'GB', '10.1 targets a game, 17.6 points a game and 9 or more targets in each of his last four, though the Rams allow the 3rd-fewest WR points', 'start'],
  [14, 'Christian Watson', 'GB', '18.4 a game, 30.1 and 6.7 his last two before the bye; the Rams allow the 3rd-fewest WR points', 'start'],
  [15, 'Tetairoa McMillan', 'CAR', '19.1 last week on 9 targets, 26% target share, though Tampa Bay allows the 9th-fewest WR points', 'start'],
  [16, 'DeVonta Smith', 'PHI', '12 targets on 81% of the snaps last week in his first game since Week 6, full practice Tuesday (hamstring); Dallas allows the 4th-most WR points, though Joe Milton is the quarterback', 'flex'],
  [17, 'Stefon Diggs', 'WAS', '23% target share, 13.2 a game; Washington implied for 24.25, though 8.5 last week', 'flex'],
  [18, 'Luther Burden III', 'CHI', 'Chicago implied for 28.5 Thursday and Detroit allows the 10th-most WR points, though 3 targets on 59% of the snaps for 3.3 last week', 'flex'],
  [19, 'Drake London', 'ATL', '28% target share, 12 targets for 16.9 before the bye, though Minnesota allows the 5th-fewest WR points', 'flex'],
  [20, 'Jameson Williams', 'DET', '19.3 last week on 4 targets, 13.4 a game; Detroit implied for 27.0 in a 55.5 total', 'flex'],
  [21, 'Ladd McConkey', 'LAC', '8 targets on 78% of the snaps for 20.7 last week in his first game since Week 8; New England allows the 2nd-most WR points, though Justin Herbert is in the concussion protocol', 'flex'],
  [22, 'Rashee Rice', 'KC', 'Full practice Tuesday (knee); 6 targets in each of the last two games, though on 46% and 44% of the snaps', 'flex'],
  [23, 'Garrett Wilson', 'NYJ', '28% target share, 14 and 5 targets the last two; Miami allows the 4th-fewest WR points', 'flex'],
  [24, 'DJ Moore', 'BUF', '19.4 and 23.1 the last two, 10 targets on 74% of the snaps last week, though Kansas City allows the 2nd-fewest WR points and rain is forecast', 'flex'],
  [25, 'Jakobi Meyers', 'JAX', '10 targets on 83% of the snaps for 12.5 last week; Tennessee allows the most WR points, and Jacksonville is implied for 31.5', 'flex'],
  [26, 'Mike Evans', 'SF', '22.9 on 7 targets last week in his first game since Week 6, on 43% of the snaps; Seattle allows the fewest WR points', 'flex'],
  [27, 'KC Concepcion', 'CLE', '8 targets for 11.7 before the bye, 20% target share; Las Vegas allows the 11th-most WR points, and Denzel Boston is listed as questionable in our data', 'flex'],
  [28, 'Antonio Williams', 'WAS', '11 targets on 84% of the snaps for 21.2 last week, though 2 targets the week before; Washington implied for 24.25', 'flex'],
  [29, 'Omar Cooper Jr.', 'NYJ', 'If active. Listed as questionable in our data and has not played since Week 9; 22.3, 22.5 and 13.8 his last three', 'flex'],
  [30, 'Carnell Tate', 'TEN', '5 targets on 90% of the snaps for 13.8 last week in his first game since Week 7; 26% target share, though Tennessee is implied for 17.0; WR30', 'flex'],
  [31, 'Rome Odunze', 'CHI', '4 targets on 92% of the snaps for 8.5 last week, 9.8 a game; WR31', 'sit'],
  [32, 'Emeka Egbuka', 'TB', '5 targets in each of the last two games for 6.9 and 3.8; WR32', 'sit'],
  [33, 'Ryan Flournoy', 'DAL', '1 target on 54% of the snaps last week; WR33', 'sit'],
];

const TE_ROWS = [
  [1, 'Trey McBride', 'ARI', '14 targets last week, 30% target share; Washington allows the 2nd-most TE points', 'start'],
  [2, 'Brock Bowers', 'LV', 'If active. Listed as questionable in our data and has not played since Week 10, when he had 19% of the snaps; 26% target share, 18.7 a game', 'start'],
  [3, 'Harold Fannin Jr.', 'CLE', '9 targets on 87% of the snaps for 16.1 before the bye; Las Vegas allows the 5th-most TE points', 'start'],
  [4, 'George Kittle', 'SF', '18.4 last week, 14.7 a game on a 23% target share, though 3 targets, and Seattle allows the 10th-fewest TE points', 'start'],
  [5, 'Isaiah Likely', 'NYG', '25% target share, 16.1 a game; 27.7 and 4.5 the last two on 11 and 3 targets', 'start'],
  [6, 'Colston Loveland', 'CHI', 'Detroit allows the most TE points and Chicago is implied for 28.5; 93% of the snaps last week, though 3 targets', 'start'],
  [7, 'Travis Kelce', 'KC', '25.4 last week on 7 targets and 72% of the snaps; 13.0 a game', 'start'],
  [8, 'Dalton Kincaid', 'BUF', 'If active. Limited Tuesday (thumb, ankle) and has not played since Week 10; Kansas City allows the 6th-most TE points, though he played 46% of the snaps in his last game', 'start'],
  [9, 'Pat Freiermuth', 'PIT', 'Denver allows the 3rd-most TE points; 11.6, 11.5 and 9.0 his last three, though Pittsburgh is implied for 16.5', 'start'],
  [10, 'T.J. Hockenson', 'MIN', '7 targets in each of his last two games, 20% target share, with Jordan Addison not expected to play; 51% of the snaps last week', 'start'],
  [11, 'Mike Gesicki', 'CIN', '12.7 last week on 6 targets; Cincinnati is implied for 30.25 and New Orleans allows the 7th-most TE points, though he played 47% of the snaps', 'start'],
  [12, 'Chig Okonkwo', 'WAS', 'Arizona allows the 4th-most TE points; 10.6 last week on 5 targets and 72% of the snaps; TE12', 'start'],
  [13, 'Dallas Goedert', 'PHI', 'Full practice Tuesday (shin); 1 target on 89% of the snaps last week with Joe Milton at quarterback; TE13', 'sit'],
  [14, 'Sam LaPorta', 'DET', 'Full practice Tuesday (ankle); 6 targets on 91% of the snaps for 9.2 last week, but Chicago allows the 7th-fewest TE points; TE14', 'sit'],
];

const DST_ROWS = [
  [1, 'Minnesota Vikings', 'MIN', 'Atlanta implied for 17.25 as a 7-point underdog; 12.6 a game, though -2 last week', 'start'],
  [2, 'Jacksonville Jaguars', 'JAX', 'Tennessee implied for 17.0 as a 14.5-point underdog; 9.8 a game', 'start'],
  [3, 'Denver Broncos', 'DEN', 'Pittsburgh implied for 16.5 Friday, the lowest on the slate, with rain and 17 mph wind forecast; 13 last week', 'start'],
  [4, 'Houston Texans', 'HOU', '22 last week; Baltimore is implied for 20.25 with Jacoby Brissett at quarterback', 'start'],
  [5, 'Buffalo Bills', 'BUF', '21, 22, 12 and 15 the last four; rain is forecast Thursday night, though Kansas City is implied for 21.75', 'start'],
  [6, 'New York Giants', 'NYG', 'Indianapolis implied for 17.5, and Daniel Jones scored 5.2 and 4.1 the last two weeks; 8.1 a game', 'start'],
  [7, 'Tampa Bay Buccaneers', 'TB', '11.0 a game; Carolina implied for 20.25 Monday, though 0 last week', 'start'],
  [8, 'Cleveland Browns', 'CLE', 'Las Vegas implied for 18.0 Sunday night with rain likely and 15 mph wind; 7.3 a game', 'start'],
];

const RULINGS = [
  [
    'C1',
    [
      ['Joe Burrow', 'QB', 'CIN', 'START', '19.9 last week after 39.5, 29.5 and 33.2, 25.2 a game; Cincinnati is implied for 30.25 as a 10-point favorite.'],
    ],
  ],
  [
    'C2',
    [
      ['Dak Prescott', 'QB', 'DAL', 'START', '34.4 and 35.9 the last two, full practice Tuesday (hand); Dallas implied for 28.0 Thursday, and Philadelphia allows the 10th-most QB points.'],
    ],
  ],
  [
    'C3',
    [
      ['Trevor Lawrence', 'QB', 'JAX', 'START', 'Jacksonville implied for 31.5, the highest on the slate, and Tennessee allows the 2nd-most QB points; 12.7 last week, 18.7 a game.'],
    ],
  ],
  [
    'C4',
    [
      ['Josh Allen', 'QB', 'BUF', 'START', '23.5 a game on 6.6 carries, though 12.2 last week without a carry; Kansas City allows the 3rd-fewest QB points, and rain is forecast Thursday night.'],
    ],
  ],
  [
    'C5',
    [
      ['Jayden Daniels', 'QB', 'WAS', 'START', 'Arizona allows the most QB points; 19.1 a game on 6.0 carries, and Washington is implied for 24.25.'],
    ],
  ],
  [
    'C6',
    [
      ['C.J. Stroud', 'QB', 'HOU', 'START', '20.4 and 20.5 the last two, 20.5 a game; Houston implied for 27.25.'],
    ],
  ],
  [
    'C7',
    [
      ['Brock Purdy', 'QB', 'SF', 'START', '31.7 and 22.2 the last two, 22.5 a game, though Seattle allows the 2nd-fewest QB points.'],
    ],
  ],
  [
    'C8',
    [
      ['Patrick Mahomes', 'QB', 'KC', 'START', '35.4 and 25.0 the last two, full practice Tuesday (knee); Kansas City is implied for 21.75 in Buffalo, with rain forecast Thursday night.'],
    ],
  ],
  [
    'C9',
    [
      ['Jared Goff', 'QB', 'DET', 'START', '20.4 in each of the last two games; Detroit implied for 27.0 in a dome Thursday, in a 55.5 total, the highest on the slate.'],
    ],
  ],
  [
    'C10',
    [
      ['Caleb Williams', 'QB', 'CHI', 'START', 'Chicago implied for 28.5 Thursday, and Detroit allows the 3rd-most QB points; 17.8 a game on 5.0 carries, 14.3 last week.'],
    ],
  ],
  [
    'C11',
    [
      ['Tyler Shough', 'QB', 'NO', 'START', '17.1 a game on 4.3 carries; New Orleans is a 10-point underdog in a 50.5 total, though rain is likely in Cincinnati.'],
    ],
  ],
  [
    'C12',
    [
      ['Jordan Love', 'QB', 'GB', 'START', '19.7 a game, 36.2 and 10.8 his last two before the bye; Green Bay implied for 21.0 in a dome Wednesday, though the Rams allow the 8th-fewest QB points; QB12.'],
    ],
  ],
  [
    'C13',
    [
      ['Kirk Cousins', 'QB', 'MIN', 'SIT', '15.4 and 7.4 in his two Minnesota games, though Atlanta allows the 6th-most QB points and Minnesota is implied for 24.25; QB13.'],
      ['Kyler Murray', 'QB', 'MIN', 'SIT', 'Listed as questionable in our data and has not played since Week 8; second on the depth chart.'],
    ],
  ],
  [
    'C14',
    [
      ['Deshaun Watson', 'QB', 'CLE', 'SIT', '21.4 on 8 carries before the bye, and Las Vegas allows the 5th-most QB points, but 15.5 a game; QB14.'],
    ],
  ],
  [
    'C15',
    [
      ['Matthew Stafford', 'QB', 'LAR', 'SIT', 'Full practice Tuesday (elbow), but Puka Nacua and Davante Adams are on IR; 16.3 a game, and Green Bay allows the 6th-fewest QB points.'],
    ],
  ],
  [
    'C16',
    [
      ['Bryce Young', 'QB', 'CAR', 'SIT', '16.0 last week, 17.1 a game; Tampa Bay allows the 4th-fewest QB points.'],
    ],
  ],
  [
    'C17',
    [
      ['Aaron Rodgers', 'QB', 'PIT', 'SIT', 'Pittsburgh implied for 16.5 Friday, the lowest on the slate, with rain and 17 mph wind forecast; 15.0 a game.'],
    ],
  ],
  [
    'C18',
    [
      ['Jacoby Brissett', 'QB', 'BAL', 'SIT', '11.8 and 13.7 the last two; Baltimore is a 7-point underdog implied for 20.25.'],
    ],
  ],
  [
    'C19',
    [
      ['Geno Smith', 'QB', 'NYJ', 'SIT', '19.4 last week but 14.2 a game; Miami allows the 13th-fewest QB points.'],
    ],
  ],
  [
    'C20',
    [
      ['Justin Herbert', 'QB', 'LAC', 'SIT', 'In the concussion protocol; 22.4 last week on 8 carries but 12.1 a game, in a 35.5 total, the lowest on the slate.'],
      ['DJ Uiagalelei', 'QB', 'LAC', 'SIT', 'Second on the Chargers\' depth chart; the next man up if Herbert is not cleared.'],
    ],
  ],
  [
    'C21',
    [
      ['Fernando Mendoza', 'QB', 'LV', 'SIT', '22.9 last week in his second straight game on 100% of the snaps; Las Vegas is implied for 18.0 Sunday night, with rain likely in Cleveland.'],
    ],
  ],
  [
    'C22',
    [
      ['Bo Nix', 'QB', 'DEN', 'SIT', '11.5 last week, 14.2 a game; Pittsburgh allows the 5th-fewest QB points, and rain and 17 mph wind are forecast Friday.'],
    ],
  ],
  [
    'C23',
    [
      ['J.J. McCarthy', 'QB', 'NYG', 'SIT', '17.1 and 14.2 the last two on 6 and 7 carries, but 10.9 a game.'],
    ],
  ],
  [
    'C24',
    [
      ['Cam Ward', 'QB', 'TEN', 'SIT', '26.3, 19.1 and 22.2 his last three, but Tennessee is implied for 17.0 as a 14.5-point underdog, and Jacksonville allows the 7th-fewest QB points.'],
    ],
  ],
  [
    'C25',
    [
      ['Sam Darnold', 'QB', 'SEA', 'SIT', 'Has not played since Week 8 (quadriceps, rib); his coach said he starts Sunday if Wednesday\'s practice goes well; 13.2 a game.'],
      ['Drew Lock', 'QB', 'SEA', 'SIT', '12.6 and 15.6 on 100% of the snaps in Seattle\'s last two games; the starter if Darnold is not ready.'],
    ],
  ],
  [
    'C26',
    [
      ['Michael Penix Jr.', 'QB', 'ATL', 'SIT', 'Minnesota allows the fewest QB points, and Atlanta is implied for 17.25; 13.6 a game.'],
    ],
  ],
  [
    'C27',
    [
      ['Baker Mayfield', 'QB', 'TB', 'SIT', '19.1 last week on 6 carries, but 10.0 a game.'],
    ],
  ],
  [
    'C28',
    [
      ['Daniel Jones', 'QB', 'IND', 'SIT', '5.2 and 4.1 the last two; Indianapolis is implied for 17.5.'],
    ],
  ],
  [
    'C29',
    [
      ['Kyle McCord', 'QB', 'MIA', 'SIT', '12.8 and 3.0 the last two with Malik Willis on IR; Miami is implied for 18.5.'],
    ],
  ],
  [
    'C30',
    [
      ['Tommy DeVito', 'QB', 'NE', 'SIT', 'First on New England\'s depth chart with Drake Maye listed as out in our data; 7.1 on 83% of the snaps before the bye, and New England is implied for 17.0.'],
    ],
  ],
  [
    'C31',
    [
      ['Joe Milton', 'QB', 'PHI', 'SIT', '6.3 on 100% of the snaps last week with Jalen Hurts on IR; Philadelphia is implied for 19.5 Thursday.'],
      ['Tanner McKee', 'QB', 'PHI', 'SIT', 'Full practice Tuesday (rib); second on the depth chart.'],
    ],
  ],
  [
    'C32',
    [
      ['Josh Johnson', 'QB', 'ARI', 'SIT', '10.7 on 100% of the snaps last week; Carson Beck is listed as questionable in our data and Gardner Minshew II is on IR.'],
      ['Carson Beck', 'QB', 'ARI', 'SIT', 'Listed as questionable in our data; first on Arizona\'s depth chart, but Josh Johnson took every snap last week.'],
    ],
  ],
  [
    'C33',
    [
      ['Jalen Hurts', 'QB', 'PHI', 'OUT', 'On IR and expected to miss the rest of the season; the engine still projects 18.4.'],
    ],
  ],
  [
    'C34',
    [
      ['Drake Maye', 'QB', 'NE', 'OUT', 'Listed as out in our data with a fractured right fibula, though not on IR; the engine still projects 16.3.'],
    ],
  ],
  [
    'C35',
    [
      ['Lamar Jackson', 'QB', 'BAL', 'OUT', 'On IR after right thumb surgery; the engine still projects 15.0.'],
    ],
  ],
  [
    'C36',
    [
      ['Jaxson Dart', 'QB', 'NYG', 'OUT', 'On IR; the engine still projects 17.0.'],
    ],
  ],
  [
    'C37',
    [
      ['Malik Willis', 'QB', 'MIA', 'OUT', 'On IR (groin); the engine still projects 12.8.'],
    ],
  ],
  [
    'C38',
    [
      ['Jahmyr Gibbs', 'RB', 'DET', 'START', '27.8 last week on 23 carries, 28.1 a game on 22.2 carries; Detroit implied for 27.0 Thursday.'],
    ],
  ],
  [
    'C39',
    [
      ['Christian McCaffrey', 'RB', 'SF', 'START', '22.7 a game on an 18% target share; 14.2 last week on 12 carries.'],
      ['Kaelon Black', 'RB', 'SF', 'SIT', '6 carries on 30% of the snaps last week; the No. 2 behind McCaffrey.'],
    ],
  ],
  [
    'C40',
    [
      ['Bucky Irving', 'RB', 'TB', 'START', 'Carolina allows the most RB points; 18 carries for 19.0 last week, 17.8 a game on 18.5 carries.'],
      ['Kenny Gainwell', 'RB', 'TB', 'SIT', '4 carries and 5 targets on 41% of the snaps last week; behind Irving.'],
    ],
  ],
  [
    'C41',
    [
      ['Chuba Hubbard', 'RB', 'CAR', 'START', '27 carries in each of the last two games for 34.2 and 26.0, on 84% and 82% of the snaps, though Tampa Bay allows the fewest RB points.'],
    ],
  ],
  [
    'C42',
    [
      ['James Cook III', 'RB', 'BUF', 'START', '20.9 carries a game, 18.7 points a game; rain is forecast Thursday night, though Kansas City allows the 5th-fewest RB points.'],
    ],
  ],
  [
    'C43',
    [
      ['Bijan Robinson', 'RB', 'ATL', 'START', '19.8 a game on 18.5 carries and a 17% target share, though Minnesota allows the 4th-fewest RB points and Atlanta is implied for 17.25.'],
    ],
  ],
  [
    'C44',
    [
      ['Chase Brown', 'RB', 'CIN', 'START', 'New Orleans allows the 2nd-most RB points and Cincinnati is implied for 30.25; 6.2 targets a game, though 8.6 last week on 6 carries.'],
      ['Samaje Perine', 'RB', 'CIN', 'SIT', '6 carries and 4 targets in each of the last two games for 13.9 and 13.7; 50% of the snaps last week.'],
    ],
  ],
  [
    'C45',
    [
      ['Jonah Coleman', 'RB', 'DEN', 'START', '24 carries on 85% of the snaps for 34.9 last week; J.K. Dobbins is suspended for Friday and RJ Harvey is on IR.'],
      ['J.K. Dobbins', 'RB', 'DEN', 'OUT', 'Suspended one game by the team; the engine still projects 6.9.'],
    ],
  ],
  [
    'C46',
    [
      ['Javonte Williams', 'RB', 'DAL', 'START', '17.1 carries a game, 24.1 last week; Dallas implied for 28.0 Thursday as an 8.5-point favorite.'],
    ],
  ],
  [
    'C47',
    [
      ['Kyren Williams', 'RB', 'LAR', 'START', 'Full practice Tuesday (toe); 13.9 carries and 5.1 targets a game, and Green Bay allows the 7th-most RB points, though he played 51% of the snaps before the bye.'],
      ['Blake Corum', 'RB', 'LAR', 'SIT', '17 carries on 51% of the snaps for 20.9 before the bye, the same snap share as Williams.'],
    ],
  ],
  [
    'C48',
    [
      ['Derrick Henry', 'RB', 'BAL', 'START', '19.0 and 19.1 the last two, 18.0 carries a game, though he played 49% of the snaps last week and Baltimore is a 7-point underdog.'],
      ['Justice Hill', 'RB', 'BAL', 'SIT', '17.6 last week on 6 carries and 5 targets, on 55% of the snaps to Henry\'s 49%.'],
    ],
  ],
  [
    'C49',
    [
      ['Kenneth Walker III', 'RB', 'KC', 'START if active', 'Limited Tuesday (groin) and has not played since Week 9; 24.5 a game on 19.9 carries.'],
    ],
  ],
  [
    'C50',
    [
      ['Breece Hall', 'RB', 'NYJ', 'START', '20 carries on 63% of the snaps for 19.0 last week; Miami allows the 6th-most RB points, and the Jets are 3.5-point favorites.'],
      ['Braelon Allen', 'RB', 'NYJ', 'SIT', '16 carries on 37% of the snaps for 9.4 last week; behind Hall.'],
    ],
  ],
  [
    'C51',
    [
      ['Emmett Johnson', 'RB', 'KC', 'FLEX', '22 and 23 carries on 88% and 82% of the snaps for 35.1 and 24.3 with Kenneth Walker III out; a start if Walker sits again, a risk if he plays.'],
    ],
  ],
  [
    'C52',
    [
      ['Ashton Jeanty', 'RB', 'LV', 'FLEX', '27.9 last week on 11 carries, 8 targets and 84% of the snaps; 6.1 targets a game, though Las Vegas is implied for 18.0.'],
    ],
  ],
  [
    'C53',
    [
      ['Cam Skattebo', 'RB', 'NYG', 'FLEX', '14 carries and 7 targets on 84% of the snaps last week, for 5.8; Indianapolis allows the 9th-most RB points, and the Giants are implied for 24.0.'],
    ],
  ],
  [
    'C54',
    [
      ['Jonathan Taylor', 'RB', 'IND', 'FLEX', '17.1 carries a game, but 6.7, 9.4, 12.3 and 6.7 his last four; Indianapolis is implied for 17.5, and the Giants allow the 6th-fewest RB points.'],
    ],
  ],
  [
    'C55',
    [
      ['Jaylen Warren', 'RB', 'PIT', 'FLEX', '9 carries on 68% of the snaps for 4.9 last week; Denver allows the 8th-most RB points, though Pittsburgh is implied for 16.5, the lowest on the slate.'],
      ['Rico Dowdle', 'RB', 'PIT', 'SIT', '5 carries and 5 targets on 32% of the snaps last week.'],
    ],
  ],
  [
    'C56',
    [
      ['D\'Andre Swift', 'RB', 'CHI', 'FLEX', '13 carries on 46% of the snaps last week, down from 72% or more in each of his three games before; Chicago is implied for 28.5 Thursday.'],
      ['Kyle Monangai', 'RB', 'CHI', 'SIT', '8 carries on 38% of the snaps for 1.8 last week in his first game since Week 4.'],
    ],
  ],
  [
    'C57',
    [
      ['Quinshon Judkins', 'RB', 'CLE', 'FLEX', 'Las Vegas allows the 4th-most RB points; 10 carries and 5 targets for 16.1 before the bye, though on 47% of the snaps.'],
      ['Dylan Sampson', 'RB', 'CLE', 'SIT', '6 targets in each of his last two games, on 51% of the snaps before the bye.'],
    ],
  ],
  [
    'C58',
    [
      ['Tony Pollard', 'RB', 'TEN', 'FLEX', '21 carries on 80% of the snaps last week, though Tennessee is a 14.5-point underdog and Jacksonville allows the 3rd-fewest RB points.'],
    ],
  ],
  [
    'C59',
    [
      ['Bhayshul Tuten', 'RB', 'JAX', 'FLEX if active', 'Aggravated a right ankle injury last week, when he had 10 carries on 43% of the snaps; Jacksonville is implied for 31.5, the highest on the slate.'],
      ['Chris Rodriguez Jr.', 'RB', 'JAX', 'SIT', '4 carries on 38% of the snaps last week; next up if Tuten sits.'],
    ],
  ],
  [
    'C60',
    [
      ['Saquon Barkley', 'RB', 'PHI', 'FLEX', 'Full practice Tuesday (neck); 17 carries on 64% of the snaps last week, and Dallas allows the 3rd-most RB points, though Philadelphia is implied for 19.5.'],
    ],
  ],
  [
    'C61',
    [
      ['David Montgomery', 'RB', 'HOU', 'FLEX', '26 carries on 73% of the snaps for 15.4 last week; Houston is implied for 27.25, though the Texans are hopeful Woody Marks returns.'],
      ['Woody Marks', 'RB', 'HOU', 'SIT', 'Listed as questionable in our data (concussion), and his coach is hopeful he plays Sunday; 12 carries on 45% of the snaps in Week 10.'],
    ],
  ],
  [
    'C62',
    [
      ['Omarion Hampton', 'RB', 'LAC', 'SIT', '14 carries on 55% of the snaps for 10.3 last week; the Chargers are implied for 18.5 with Justin Herbert in the concussion protocol; RB25.'],
    ],
  ],
  [
    'C63',
    [
      ['Josh Jacobs', 'RB', 'GB', 'SIT', 'Questionable for Wednesday (finger) after a limited practice; 4 carries on 15% of the snaps in Week 9, his last game, and the Rams allow the 2nd-fewest RB points.'],
    ],
  ],
  [
    'C64',
    [
      ['Rhamondre Stevenson', 'RB', 'NE', 'SIT', '6 carries on 44% of the snaps for 1.5 before the bye; New England is implied for 17.0 with Tommy DeVito first on the depth chart.'],
    ],
  ],
  [
    'C65',
    [
      ['Aaron Jones Sr.', 'RB', 'MIN', 'SIT', '8 carries on 39% of the snaps last week; splits with Jordan Mason, though Atlanta allows the 5th-most RB points.'],
      ['Jordan Mason', 'RB', 'MIN', 'SIT', '11 carries on 42% of the snaps for 4.7 last week.'],
    ],
  ],
  [
    'C66',
    [
      ['Jacory Croskey-Merritt', 'RB', 'WAS', 'SIT', '13 carries on 41% of the snaps for 15.7 last week in his first game since Week 5; Washington split the snaps three ways.'],
      ['Rachaad White', 'RB', 'WAS', 'SIT', 'No carries on 22% of the snaps last week.'],
    ],
  ],
  [
    'C67',
    [
      ['Ollie Gordon II', 'RB', 'MIA', 'SIT', '11 carries on 72% of the snaps for 8.7 last week; Miami is implied for 18.5 with Kyle McCord at quarterback.'],
    ],
  ],
  [
    'C68',
    [
      ['Zach Charbonnet', 'RB', 'SEA', 'SIT', '20 carries on 72% of the snaps before the bye, but 9.4 points for it, and San Francisco allows the 8th-fewest RB points.'],
    ],
  ],
  [
    'C69',
    [
      ['Travis Etienne Jr.', 'RB', 'NO', 'SIT', '14 carries on 44% of the snaps for 7.6 last week; New Orleans is a 10-point underdog.'],
      ['Alvin Kamara', 'RB', 'NO', 'SIT', '1 carry on 11% of the snaps last week.'],
    ],
  ],
  [
    'C70',
    [
      ['Tyler Allgeier', 'RB', 'ARI', 'SIT', '7 carries on 54% of the snaps for 2.3 last week; Arizona is implied for 17.25.'],
    ],
  ],
  [
    'C71',
    [
      ['De\'Von Achane', 'RB', 'MIA', 'OUT', 'On IR (knee); the engine still projects 14.3.'],
    ],
  ],
  [
    'C72',
    [
      ['RJ Harvey', 'RB', 'DEN', 'OUT', 'On IR (knee); the engine still projects 10.9.'],
    ],
  ],
  [
    'C73',
    [
      ['James Conner', 'RB', 'ARI', 'OUT', 'On IR (foot); the engine still projects 10.4.'],
    ],
  ],
  [
    'C74',
    [
      ['Jaxon Smith-Njigba', 'WR', 'SEA', 'START', '38% target share and 26.4 a game, 31.1 before the bye; San Francisco allows the 9th-most WR points, though Sam Darnold is listed as questionable in our data.'],
    ],
  ],
  [
    'C75',
    [
      ['CeeDee Lamb', 'WR', 'DAL', 'START', '30.2 last week, 33% target share; Philadelphia allows the 3rd-most WR points, and Dallas is implied for 28.0 Thursday.'],
    ],
  ],
  [
    'C76',
    [
      ['George Pickens', 'WR', 'DAL', 'START', '43.5 and 23.8 the last two on 18 and 10 targets; Philadelphia allows the 3rd-most WR points.'],
    ],
  ],
  [
    'C77',
    [
      ['Ja\'Marr Chase', 'WR', 'CIN', 'START', '9 targets on 97% of the snaps last week for 8.1, after 31.1, 31.5 and 34.1; Cincinnati implied for 30.25.'],
    ],
  ],
  [
    'C78',
    [
      ['Amon-Ra St. Brown', 'WR', 'DET', 'START', '30% target share, 19.8 a game; Detroit implied for 27.0 in a dome Thursday.'],
    ],
  ],
  [
    'C79',
    [
      ['Parker Washington', 'WR', 'JAX', 'START', '17 targets last week, 28.2 and 18.3 the last two; Tennessee allows the most WR points, and Jacksonville is implied for 31.5.'],
    ],
  ],
  [
    'C80',
    [
      ['Tee Higgins', 'WR', 'CIN', 'START', '18.4 a game on a 20% target share; Cincinnati implied for 30.25, though 3 targets last week.'],
    ],
  ],
  [
    'C81',
    [
      ['Nico Collins', 'WR', 'HOU', 'START', '23% target share, 14.8 last week on 89% of the snaps; Houston implied for 27.25.'],
    ],
  ],
  [
    'C82',
    [
      ['Malik Nabers', 'WR', 'NYG', 'START', '12 targets for 18.5 last week, 28% target share; the Giants are implied for 24.0.'],
    ],
  ],
  [
    'C83',
    [
      ['Chris Olave', 'WR', 'NO', 'START', '15 targets for 19.2 last week, 28% target share and 10.2 targets a game.'],
    ],
  ],
  [
    'C84',
    [
      ['Zay Flowers', 'WR', 'BAL', 'START', '11 targets on 88% of the snaps for 16.4 last week, 29% target share; Houston allows the 6th-most WR points.'],
    ],
  ],
  [
    'C85',
    [
      ['Justin Jefferson', 'WR', 'MIN', 'START', '29% target share with Jordan Addison not expected to play; Atlanta allows the 7th-most WR points.'],
    ],
  ],
  [
    'C86',
    [
      ['Matthew Golden', 'WR', 'GB', 'START', '10.1 targets a game, 17.6 points a game and 9 or more targets in each of his last four, though the Rams allow the 3rd-fewest WR points.'],
    ],
  ],
  [
    'C87',
    [
      ['Christian Watson', 'WR', 'GB', 'START', '18.4 a game, 30.1 and 6.7 his last two before the bye; the Rams allow the 3rd-fewest WR points.'],
    ],
  ],
  [
    'C88',
    [
      ['Tetairoa McMillan', 'WR', 'CAR', 'START', '19.1 last week on 9 targets, 26% target share, though Tampa Bay allows the 9th-fewest WR points.'],
    ],
  ],
  [
    'C89',
    [
      ['DeVonta Smith', 'WR', 'PHI', 'FLEX', '12 targets on 81% of the snaps last week in his first game since Week 6, full practice Tuesday (hamstring); Dallas allows the 4th-most WR points, though Joe Milton is the quarterback.'],
      ['Makai Lemon', 'WR', 'PHI', 'SIT', '3 targets for 1.3 last week with Smith back.'],
    ],
  ],
  [
    'C90',
    [
      ['Stefon Diggs', 'WR', 'WAS', 'FLEX', '23% target share, 13.2 a game; Washington implied for 24.25, though 8.5 last week.'],
    ],
  ],
  [
    'C91',
    [
      ['Luther Burden III', 'WR', 'CHI', 'FLEX', 'Chicago implied for 28.5 Thursday and Detroit allows the 10th-most WR points, though 3 targets on 59% of the snaps for 3.3 last week.'],
    ],
  ],
  [
    'C92',
    [
      ['Drake London', 'WR', 'ATL', 'FLEX', '28% target share, 12 targets for 16.9 before the bye, though Minnesota allows the 5th-fewest WR points.'],
    ],
  ],
  [
    'C93',
    [
      ['Jameson Williams', 'WR', 'DET', 'FLEX', '19.3 last week on 4 targets, 13.4 a game; Detroit implied for 27.0 in a 55.5 total.'],
    ],
  ],
  [
    'C94',
    [
      ['Ladd McConkey', 'WR', 'LAC', 'FLEX', '8 targets on 78% of the snaps for 20.7 last week in his first game since Week 8; New England allows the 2nd-most WR points, though Justin Herbert is in the concussion protocol.'],
    ],
  ],
  [
    'C95',
    [
      ['Rashee Rice', 'WR', 'KC', 'FLEX', 'Full practice Tuesday (knee); 6 targets in each of the last two games, though on 46% and 44% of the snaps.'],
    ],
  ],
  [
    'C96',
    [
      ['Garrett Wilson', 'WR', 'NYJ', 'FLEX', '28% target share, 14 and 5 targets the last two; Miami allows the 4th-fewest WR points.'],
    ],
  ],
  [
    'C97',
    [
      ['DJ Moore', 'WR', 'BUF', 'FLEX', '19.4 and 23.1 the last two, 10 targets on 74% of the snaps last week, though Kansas City allows the 2nd-fewest WR points and rain is forecast.'],
    ],
  ],
  [
    'C98',
    [
      ['Jakobi Meyers', 'WR', 'JAX', 'FLEX', '10 targets on 83% of the snaps for 12.5 last week; Tennessee allows the most WR points, and Jacksonville is implied for 31.5.'],
    ],
  ],
  [
    'C99',
    [
      ['Mike Evans', 'WR', 'SF', 'FLEX', '22.9 on 7 targets last week in his first game since Week 6, on 43% of the snaps; Seattle allows the fewest WR points.'],
      ['Deebo Samuel Sr.', 'WR', 'SF', 'SIT', '4 targets on 52% of the snaps for 7.7 last week.'],
      ['Keenan Allen', 'WR', 'SF', 'SIT', '4 targets on 57% of the snaps for 6.8 last week.'],
    ],
  ],
  [
    'C100',
    [
      ['KC Concepcion', 'WR', 'CLE', 'FLEX', '8 targets for 11.7 before the bye, 20% target share; Las Vegas allows the 11th-most WR points, and Denzel Boston is listed as questionable in our data.'],
      ['Denzel Boston', 'WR', 'CLE', 'SIT', 'Did not take part in Tuesday\'s unofficial practice (toe); 2 targets for 2.6 before the bye.'],
    ],
  ],
  [
    'C101',
    [
      ['Antonio Williams', 'WR', 'WAS', 'FLEX', '11 targets on 84% of the snaps for 21.2 last week, though 2 targets the week before; Washington implied for 24.25.'],
    ],
  ],
  [
    'C102',
    [
      ['Omar Cooper Jr.', 'WR', 'NYJ', 'FLEX if active', 'Listed as questionable in our data and has not played since Week 9; 22.3, 22.5 and 13.8 his last three.'],
      ['Adonai Mitchell', 'WR', 'NYJ', 'SIT', '3 targets on 62% of the snaps for 5.0 last week; a flex only if Cooper sits.'],
    ],
  ],
  [
    'C103',
    [
      ['Carnell Tate', 'WR', 'TEN', 'FLEX', '5 targets on 90% of the snaps for 13.8 last week in his first game since Week 7; 26% target share, though Tennessee is implied for 17.0; WR30.'],
    ],
  ],
  [
    'C104',
    [
      ['Rome Odunze', 'WR', 'CHI', 'SIT', '4 targets on 92% of the snaps for 8.5 last week, 9.8 a game; WR31.'],
    ],
  ],
  [
    'C105',
    [
      ['Emeka Egbuka', 'WR', 'TB', 'SIT', '5 targets in each of the last two games for 6.9 and 3.8; WR32.'],
    ],
  ],
  [
    'C106',
    [
      ['Ryan Flournoy', 'WR', 'DAL', 'SIT', '1 target on 54% of the snaps last week; WR33.'],
    ],
  ],
  [
    'C107',
    [
      ['Khalil Shakir', 'WR', 'BUF', 'SIT', '9 targets on 81% of the snaps for 15.3 last week, but 5.4 targets a game, and Kansas City allows the 2nd-fewest WR points.'],
    ],
  ],
  [
    'C108',
    [
      ['Max Hurleman', 'WR', 'PIT', 'SIT', '18.1 on 31% of the snaps last week is his only game; the engine\'s 13.2 rests on that one line.'],
    ],
  ],
  [
    'C109',
    [
      ['DK Metcalf', 'WR', 'PIT', 'SIT', '4 targets on 62% of the snaps for 1.2 last week; Pittsburgh is implied for 16.5.'],
      ['Germie Bernard', 'WR', 'PIT', 'SIT', '10 targets on 94% of the snaps for 10.0 last week.'],
    ],
  ],
  [
    'C110',
    [
      ['Jack Bech', 'WR', 'LV', 'SIT', '9 targets on 79% of the snaps for 22.8 last week, after 3.0 the week before; Las Vegas is implied for 18.0.'],
      ['Tre Tucker', 'WR', 'LV', 'SIT', '10 targets for 7.0 last week.'],
    ],
  ],
  [
    'C111',
    [
      ['Ted Hurst III', 'WR', 'TB', 'SIT', '22.6 on 7 targets last week, after 0.0 in each of his three games before.'],
    ],
  ],
  [
    'C112',
    [
      ['Jaylen Waddle', 'WR', 'DEN', 'SIT', '6 targets on 53% of the snaps last week; rain and 17 mph wind are forecast Friday.'],
      ['Courtland Sutton', 'WR', 'DEN', 'SIT', '0.0 on 2 targets last week.'],
    ],
  ],
  [
    'C113',
    [
      ['Josh Downs', 'WR', 'KC', 'SIT', '5 targets on 24% of the snaps last week.'],
      ['Xavier Worthy', 'WR', 'KC', 'SIT', '4 targets for 11.8 last week, 8.0 a game.'],
    ],
  ],
  [
    'C114',
    [
      ['Caleb Douglas', 'WR', 'MIA', 'SIT', '10 targets for 5.0 last week with Kyle McCord at quarterback.'],
    ],
  ],
  [
    'C115',
    [
      ['Mack Hollins', 'WR', 'NE', 'SIT', '6 targets on 92% of the snaps before the bye, but Tommy DeVito is first on the depth chart at quarterback.'],
      ['A.J. Brown', 'WR', 'NE', 'SIT', 'Listed as doubtful in our data (hamstring) and was not seen at Tuesday\'s unofficial practice.'],
    ],
  ],
  [
    'C116',
    [
      ['Devaughn Vele', 'WR', 'NO', 'SIT', '14.6 last week on 7 targets, after 3.7 and 3.4.'],
      ['Jordyn Tyson', 'WR', 'NO', 'SIT', '2 targets on 50% of the snaps last week, after 13 targets the week before.'],
    ],
  ],
  [
    'C117',
    [
      ['Jalen Coker', 'WR', 'CAR', 'SIT', '7 targets for 8.7 last week.'],
    ],
  ],
  [
    'C118',
    [
      ['Xavier Hutchinson', 'WR', 'HOU', 'SIT', '3 targets for 3.3 last week on 82% of the snaps.'],
      ['Tank Dell', 'WR', 'HOU', 'SIT', '4 targets in each of the last two games on under half the snaps.'],
    ],
  ],
  [
    'C119',
    [
      ['Puka Nacua', 'WR', 'LAR', 'OUT', 'On IR after knee surgery and out 4 to 5 months; the engine still projects 25.8.'],
    ],
  ],
  [
    'C120',
    [
      ['Davante Adams', 'WR', 'LAR', 'OUT', 'On IR (hamstring); the engine still projects 16.8.'],
    ],
  ],
  [
    'C121',
    [
      ['Michael Wilson', 'WR', 'ARI', 'OUT', 'On IR (neck); the engine still projects 14.1.'],
    ],
  ],
  [
    'C122',
    [
      ['Jordan Addison', 'WR', 'MIN', 'OUT', 'Recovering from thumb surgery, and his coach does not expect him to play; the engine still projects 8.9.'],
    ],
  ],
  [
    'C123',
    [
      ['Terry McLaurin', 'WR', 'WAS', 'OUT', 'On IR after knee surgery; the engine still projects 10.3.'],
    ],
  ],
  [
    'C124',
    [
      ['Romeo Doubs', 'WR', 'NE', 'OUT', 'On IR (shoulder); the engine still projects 10.0.'],
    ],
  ],
  [
    'C125',
    [
      ['Wan\'Dale Robinson', 'WR', 'TEN', 'OUT', 'On IR and out for the season (ankle); the engine still projects 9.6.'],
    ],
  ],
  [
    'C126',
    [
      ['Alec Pierce', 'WR', 'IND', 'OUT', 'On IR (heel); the engine still projects 9.2.'],
    ],
  ],
  [
    'C127',
    [
      ['Trey McBride', 'TE', 'ARI', 'START', '14 targets last week, 30% target share; Washington allows the 2nd-most TE points.'],
    ],
  ],
  [
    'C128',
    [
      ['Brock Bowers', 'TE', 'LV', 'START if active', 'Listed as questionable in our data and has not played since Week 10, when he had 19% of the snaps; 26% target share, 18.7 a game.'],
      ['Michael Mayer', 'TE', 'LV', 'SIT', '4 targets on 67% of the snaps for 1.4 last week; a start only if Bowers sits.'],
    ],
  ],
  [
    'C129',
    [
      ['Harold Fannin Jr.', 'TE', 'CLE', 'START', '9 targets on 87% of the snaps for 16.1 before the bye; Las Vegas allows the 5th-most TE points.'],
    ],
  ],
  [
    'C130',
    [
      ['George Kittle', 'TE', 'SF', 'START', '18.4 last week, 14.7 a game on a 23% target share, though 3 targets, and Seattle allows the 10th-fewest TE points.'],
    ],
  ],
  [
    'C131',
    [
      ['Isaiah Likely', 'TE', 'NYG', 'START', '25% target share, 16.1 a game; 27.7 and 4.5 the last two on 11 and 3 targets.'],
    ],
  ],
  [
    'C132',
    [
      ['Colston Loveland', 'TE', 'CHI', 'START', 'Detroit allows the most TE points and Chicago is implied for 28.5; 93% of the snaps last week, though 3 targets.'],
    ],
  ],
  [
    'C133',
    [
      ['Travis Kelce', 'TE', 'KC', 'START', '25.4 last week on 7 targets and 72% of the snaps; 13.0 a game.'],
    ],
  ],
  [
    'C134',
    [
      ['Dalton Kincaid', 'TE', 'BUF', 'START if active', 'Limited Tuesday (thumb, ankle) and has not played since Week 10; Kansas City allows the 6th-most TE points, though he played 46% of the snaps in his last game.'],
    ],
  ],
  [
    'C135',
    [
      ['Pat Freiermuth', 'TE', 'PIT', 'START', 'Denver allows the 3rd-most TE points; 11.6, 11.5 and 9.0 his last three, though Pittsburgh is implied for 16.5.'],
    ],
  ],
  [
    'C136',
    [
      ['T.J. Hockenson', 'TE', 'MIN', 'START', '7 targets in each of his last two games, 20% target share, with Jordan Addison not expected to play; 51% of the snaps last week.'],
    ],
  ],
  [
    'C137',
    [
      ['Mike Gesicki', 'TE', 'CIN', 'START', '12.7 last week on 6 targets; Cincinnati is implied for 30.25 and New Orleans allows the 7th-most TE points, though he played 47% of the snaps.'],
    ],
  ],
  [
    'C138',
    [
      ['Chig Okonkwo', 'TE', 'WAS', 'START', 'Arizona allows the 4th-most TE points; 10.6 last week on 5 targets and 72% of the snaps; TE12.'],
    ],
  ],
  [
    'C139',
    [
      ['Dallas Goedert', 'TE', 'PHI', 'SIT', 'Full practice Tuesday (shin); 1 target on 89% of the snaps last week with Joe Milton at quarterback; TE13.'],
    ],
  ],
  [
    'C140',
    [
      ['Sam LaPorta', 'TE', 'DET', 'SIT', 'Full practice Tuesday (ankle); 6 targets on 91% of the snaps for 9.2 last week, but Chicago allows the 7th-fewest TE points; TE14.'],
    ],
  ],
  [
    'C141',
    [
      ['Tyler Warren', 'TE', 'IND', 'SIT', '2.4 and 3.2 the last two; Indianapolis is implied for 17.5.'],
    ],
  ],
  [
    'C142',
    [
      ['Tucker Kraft', 'TE', 'GB', 'SIT', '1.9 and 2.9 his last two before the bye on 3 and 4 targets; the Rams allow the 8th-fewest TE points.'],
    ],
  ],
  [
    'C143',
    [
      ['Darren Waller', 'TE', 'CAR', 'SIT', '3 targets on 46% of the snaps last week.'],
    ],
  ],
  [
    'C144',
    [
      ['Dalton Schultz', 'TE', 'HOU', 'SIT', '1 target for 2.1 last week.'],
    ],
  ],
  [
    'C145',
    [
      ['Brenton Strange', 'TE', 'JAX', 'SIT', '3 targets in each of the last two games, 8.5 a game.'],
    ],
  ],
  [
    'C146',
    [
      ['Kyle Pitts Sr.', 'TE', 'ATL', 'SIT', 'Minnesota allows the fewest TE points; 7.8 a game.'],
    ],
  ],
  [
    'C147',
    [
      ['Mark Andrews', 'TE', 'BAL', 'SIT', '3 targets for 3.4 last week.'],
    ],
  ],
  [
    'C148',
    [
      ['Hunter Henry', 'TE', 'NE', 'SIT', '3 targets in each of his last three games; New England is implied for 17.0.'],
    ],
  ],
  [
    'C149',
    [
      ['Juwan Johnson', 'TE', 'NO', 'SIT', 'Injured a hamstring last week and is still being evaluated; 1 target on 38% of the snaps.'],
    ],
  ],
  [
    'C150',
    [
      ['Jake Ferguson', 'TE', 'DAL', 'SIT', 'Did not practice Tuesday (knee, ankle) and is listed as doubtful in our data.'],
    ],
  ],
  [
    'C151',
    [
      ['Minnesota Vikings', 'DEF', 'MIN', 'START', 'Atlanta implied for 17.25 as a 7-point underdog; 12.6 a game, though -2 last week.'],
    ],
  ],
  [
    'C152',
    [
      ['Jacksonville Jaguars', 'DEF', 'JAX', 'START', 'Tennessee implied for 17.0 as a 14.5-point underdog; 9.8 a game.'],
    ],
  ],
  [
    'C153',
    [
      ['Denver Broncos', 'DEF', 'DEN', 'START', 'Pittsburgh implied for 16.5 Friday, the lowest on the slate, with rain and 17 mph wind forecast; 13 last week.'],
    ],
  ],
  [
    'C154',
    [
      ['Houston Texans', 'DEF', 'HOU', 'START', '22 last week; Baltimore is implied for 20.25 with Jacoby Brissett at quarterback.'],
    ],
  ],
  [
    'C155',
    [
      ['Buffalo Bills', 'DEF', 'BUF', 'START', '21, 22, 12 and 15 the last four; rain is forecast Thursday night, though Kansas City is implied for 21.75.'],
    ],
  ],
  [
    'C156',
    [
      ['New York Giants', 'DEF', 'NYG', 'START', 'Indianapolis implied for 17.5, and Daniel Jones scored 5.2 and 4.1 the last two weeks; 8.1 a game.'],
    ],
  ],
  [
    'C157',
    [
      ['Tampa Bay Buccaneers', 'DEF', 'TB', 'START', '11.0 a game; Carolina implied for 20.25 Monday, though 0 last week.'],
    ],
  ],
  [
    'C158',
    [
      ['Cleveland Browns', 'DEF', 'CLE', 'START', 'Las Vegas implied for 18.0 Sunday night with rain likely and 15 mph wind; 7.3 a game.'],
    ],
  ],
];

const DST_TABLE = [
  ['Minnesota Vikings', 'vs ATL', '17.25', 'START (DST1)', 'Atlanta implied for 17.25 as a 7-point underdog; 12.6 a game, though -2 last week.'],
  ['Jacksonville Jaguars', 'vs TEN', '17', 'START (DST2)', 'Tennessee implied for 17.0 as a 14.5-point underdog; 9.8 a game.'],
  ['Denver Broncos', 'at PIT', '16.5', 'START (DST3)', 'Pittsburgh implied for 16.5 Friday, the lowest on the slate, with rain and 17 mph wind forecast; 13 last week.'],
  ['Houston Texans', 'vs BAL', '20.25', 'START (DST4)', '22 last week; Baltimore is implied for 20.25 with Jacoby Brissett at quarterback.'],
  ['Buffalo Bills', 'vs KC', '21.75', 'START (DST5)', '21, 22, 12 and 15 the last four; rain is forecast Thursday night, though Kansas City is implied for 21.75.'],
  ['New York Giants', 'at IND', '17.5', 'START (DST6)', 'Indianapolis implied for 17.5, and Daniel Jones scored 5.2 and 4.1 the last two weeks; 8.1 a game.'],
  ['Tampa Bay Buccaneers', 'vs CAR', '20.25', 'START (DST7)', '11.0 a game; Carolina implied for 20.25 Monday, though 0 last week.'],
  ['Cleveland Browns', 'vs LV', '18', 'START (DST8)', 'Las Vegas implied for 18.0 Sunday night with rain likely and 15 mph wind; 7.3 a game.'],
];

const INJ_OUT = [
  ['Jalen Hurts', 'QB', 'PHI', 'On IR and expected to miss the rest of the season; the engine still projects 18.4.', 'Joe Milton (SIT) is first on the depth chart.', 'out', 'C33'],
  ['Drake Maye', 'QB', 'NE', 'Listed as out in our data with a fractured right fibula, though not on IR; the engine still projects 16.3.', 'Tommy DeVito (SIT) is first on the depth chart.', 'out', 'C34'],
  ['Lamar Jackson', 'QB', 'BAL', 'On IR after right thumb surgery; the engine still projects 15.0.', 'Jacoby Brissett (SIT).', 'out', 'C35'],
  ['Jaxson Dart', 'QB', 'NYG', 'On IR; the engine still projects 17.0.', 'J.J. McCarthy (SIT).', 'out', 'C36'],
  ['Malik Willis', 'QB', 'MIA', 'On IR (groin); the engine still projects 12.8.', 'Kyle McCord (SIT).', 'out', 'C37'],
  ['J.K. Dobbins', 'RB', 'DEN', 'Suspended one game by the team; the engine still projects 6.9.', 'Jonah Coleman (START, RB8).', 'out', 'C45'],
  ['De\'Von Achane', 'RB', 'MIA', 'On IR (knee); the engine still projects 14.3.', 'Ollie Gordon II (SIT).', 'out', 'C71'],
  ['RJ Harvey', 'RB', 'DEN', 'On IR (knee); the engine still projects 10.9.', 'Jonah Coleman (START, RB8).', 'out', 'C72'],
  ['James Conner', 'RB', 'ARI', 'On IR (foot); the engine still projects 10.4.', 'Tyler Allgeier (SIT).', 'out', 'C73'],
  ['Puka Nacua', 'WR', 'LAR', 'On IR after knee surgery and out 4 to 5 months; the engine still projects 25.8.', 'No Rams receiver has a start or flex call.', 'out', 'C119'],
  ['Davante Adams', 'WR', 'LAR', 'On IR (hamstring); the engine still projects 16.8.', 'No Rams receiver has a start or flex call.', 'out', 'C120'],
  ['Michael Wilson', 'WR', 'ARI', 'On IR (neck); the engine still projects 14.1.', 'No other Arizona receiver has a call.', 'out', 'C121'],
  ['Jordan Addison', 'WR', 'MIN', 'Recovering from thumb surgery, and his coach does not expect him to play; the engine still projects 8.9.', 'Justin Jefferson (START, WR12).', 'out', 'C122'],
  ['Terry McLaurin', 'WR', 'WAS', 'On IR after knee surgery; the engine still projects 10.3.', 'Stefon Diggs (FLEX, WR17) and Antonio Williams (FLEX, WR28).', 'out', 'C123'],
  ['Romeo Doubs', 'WR', 'NE', 'On IR (shoulder); the engine still projects 10.0.', 'Mack Hollins (SIT).', 'out', 'C124'],
  ['Wan\'Dale Robinson', 'WR', 'TEN', 'On IR and out for the season (ankle); the engine still projects 9.6.', 'Carnell Tate (FLEX, WR30).', 'out', 'C125'],
  ['Alec Pierce', 'WR', 'IND', 'On IR (heel); the engine still projects 9.2.', 'No other Indianapolis receiver has a call.', 'out', 'C126'],
];

const INJ_THU = [
  ['Kenneth Walker III', 'RB', 'KC', 'Limited Tuesday (groin) and has not played since Week 9; 24.5 a game on 19.9 carries.', 'Emmett Johnson (FLEX, RB14). Carry a back who kicks off Friday or later.', 'gtd', 'C49'],
  ['Dalton Kincaid', 'TE', 'BUF', 'Limited Tuesday (thumb, ankle) and has not played since Week 10; Kansas City allows the 6th-most TE points, though he played 46% of the snaps in his last game.', 'No other Buffalo tight end has a call. Carry a tight end who kicks off Friday or later.', 'gtd', 'C134'],
  ['Josh Jacobs', 'RB', 'GB', 'Questionable for Wednesday (finger) after a limited practice; 4 carries on 15% of the snaps in Week 9, his last game, and the Rams allow the 2nd-fewest RB points.', 'No other Green Bay back has a call. Carry a back who kicks off Thursday or later.', 'sit', 'C63'],
  ['Jake Ferguson', 'TE', 'DAL', 'Did not practice Tuesday (knee, ankle) and is listed as doubtful in our data.', 'No other Dallas tight end has a call. Carry a tight end who kicks off Thursday night or later.', 'sit', 'C150'],
];

const INJ_INTL = [];

const INJ_ONE = [
  ['Bhayshul Tuten', 'RB', 'JAX', 'Aggravated a right ankle injury last week, when he had 10 carries on 43% of the snaps; Jacksonville is implied for 31.5, the highest on the slate.', 'Chris Rodriguez Jr. (SIT). Carry a back who kicks off at 4:05p or later.', 'gtd', 'C59'],
  ['Omar Cooper Jr.', 'WR', 'NYJ', 'Listed as questionable in our data and has not played since Week 9; 22.3, 22.5 and 13.8 his last three.', 'Adonai Mitchell (SIT), a flex only if Cooper sits. Carry a receiver who kicks off at 4:05p or later.', 'gtd', 'C102'],
  ['Kyler Murray', 'QB', 'MIN', 'Listed as questionable in our data and has not played since Week 8; second on the depth chart.', 'Kirk Cousins (SIT, QB13).', 'sit', 'C13'],
  ['Woody Marks', 'RB', 'HOU', 'Listed as questionable in our data (concussion), and his coach is hopeful he plays Sunday; 12 carries on 45% of the snaps in Week 10.', 'David Montgomery (FLEX, RB24). Carry a back who kicks off at 4:05p or later.', 'sit', 'C61'],
  ['Juwan Johnson', 'TE', 'NO', 'Injured a hamstring last week and is still being evaluated; 1 target on 38% of the snaps.', 'No other New Orleans tight end has a call. Carry a tight end who kicks off at 4:05p or later.', 'sit', 'C149'],
];

const INJ_LATE = [
  ['Justin Herbert', 'QB', 'LAC', 'In the concussion protocol; 22.4 last week on 8 carries but 12.1 a game, in a 35.5 total, the lowest on the slate.', 'DJ Uiagalelei (SIT).', 'sit', 'C20'],
  ['Sam Darnold', 'QB', 'SEA', 'Has not played since Week 8 (quadriceps, rib); his coach said he starts Sunday if Wednesday\'s practice goes well; 13.2 a game.', 'Drew Lock (SIT).', 'sit', 'C25'],
  ['Carson Beck', 'QB', 'ARI', 'Listed as questionable in our data; first on Arizona\'s depth chart, but Josh Johnson took every snap last week.', 'Josh Johnson (SIT).', 'sit', 'C32'],
  ['A.J. Brown', 'WR', 'NE', 'Listed as doubtful in our data (hamstring) and was not seen at Tuesday\'s unofficial practice.', 'Mack Hollins (SIT). Carry a receiver who kicks off Sunday night or Monday.', 'sit', 'C115'],
];

const INJ_NIGHT = [
  ['Brock Bowers', 'TE', 'LV', 'Listed as questionable in our data and has not played since Week 10, when he had 19% of the snaps; 26% target share, 18.7 a game.', 'Michael Mayer (SIT), a start only if Bowers sits. Carry a tight end who kicks off Monday.', 'gtd', 'C128'],
  ['Denzel Boston', 'WR', 'CLE', 'Did not take part in Tuesday\'s unofficial practice (toe); 2 targets for 2.6 before the bye.', 'KC Concepcion (FLEX, WR27). Carry a receiver who kicks off Monday.', 'sit', 'C100'],
];

const INJ_MNF = [];

const SLOT = (slot) => GAMES.filter((g) => g.slot === slot).map((g) => <GameCard key={g.id} g={g} />);

const QB_NEXT = 'Sits and unranked: Kyler Murray, Matthew Stafford, Bryce Young, Aaron Rodgers, Jacoby Brissett, Geno Smith, Justin Herbert, DJ Uiagalelei, Fernando Mendoza, Bo Nix, J.J. McCarthy, Cam Ward, Sam Darnold, Drew Lock, Michael Penix Jr., Baker Mayfield, Daniel Jones, Kyle McCord, Tommy DeVito, Joe Milton, Tanner McKee, Josh Johnson and Carson Beck. Out: Jalen Hurts (18.4), Jaxson Dart (17.0), Drake Maye (16.3), Lamar Jackson (15.0) and Malik Willis (12.8). Kirk Cousins (QB13) and Deshaun Watson (QB14) are ranked with sit rulings.';
const RB_NEXT = 'Sits: Aaron Jones Sr., Jacory Croskey-Merritt, Ollie Gordon II, Zach Charbonnet, Travis Etienne Jr., Tyler Allgeier, and the handcuffs Jordan Mason, Kaelon Black, Kenny Gainwell, Samaje Perine, Blake Corum, Justice Hill, Braelon Allen, Rico Dowdle, Kyle Monangai, Dylan Sampson, Chris Rodriguez Jr., Woody Marks, Rachaad White and Alvin Kamara. Out: De\'Von Achane (14.3), RJ Harvey (10.9), James Conner (10.4) and J.K. Dobbins (6.9). Omarion Hampton (RB25), Josh Jacobs (RB26) and Rhamondre Stevenson (RB27) are ranked with sit rulings.';
const WR_NEXT = 'Sits: Khalil Shakir, Max Hurleman, DK Metcalf, Germie Bernard, Jack Bech, Tre Tucker, Ted Hurst III, Jaylen Waddle, Courtland Sutton, Josh Downs, Xavier Worthy, Caleb Douglas, Mack Hollins, A.J. Brown, Devaughn Vele, Jordyn Tyson, Jalen Coker, Xavier Hutchinson, Tank Dell, Makai Lemon, Deebo Samuel Sr., Keenan Allen, Denzel Boston and Adonai Mitchell. Out: Puka Nacua (25.8), Davante Adams (16.8), Michael Wilson (14.1), Terry McLaurin (10.3), Romeo Doubs (10.0), Wan\'Dale Robinson (9.6), Alec Pierce (9.2) and Jordan Addison (8.9). Rome Odunze (WR31), Emeka Egbuka (WR32) and Ryan Flournoy (WR33) are ranked with sit rulings.';
const TE_NEXT = 'Sits: Tyler Warren, Tucker Kraft, Darren Waller, Dalton Schultz, Brenton Strange, Kyle Pitts Sr., Mark Andrews, Hunter Henry, Juwan Johnson, Jake Ferguson and Michael Mayer. No tight end is ruled out. Ranked with sit rulings: Dallas Goedert (TE13) and Sam LaPorta (TE14).';
const DST_TIER_NEXT = 'Every D/ST in the top eight has a ruling. Pittsburgh faces Denver at 20 in rain and 17 mph wind Friday and has 9.4 a game, so it is the next one up if yours is gone.';

const ALREADY_OUT = ['Gardner Minshew II (ARI QB, IR)', 'Jeremiyah Love (ARI RB, IR)', 'Trey Benson (ARI RB, IR)', 'Kendrick Bourne (ARI WR, IR)', 'Tyler Huntley (BAL QB, IR)', 'Brian Robinson Jr. (ATL RB, IR)', 'Isiah Pacheco (DET RB, IR)', 'TreVeyon Henderson (NE RB, IR)', 'Tyjae Spears (TEN RB, IR)', 'Tyrone Tracy Jr. (NYG RB, IR)', 'Tank Bigsby (PHI RB, IR)', 'Jeremy McNichols (WAS RB, out for the season)', 'Seth McGowan (IND RB, listed out in our data)', 'Cole Kmet (CHI TE, IR)', 'Erick All Jr. (CIN TE, IR)', 'Jayden Reed (GB WR, IR)', 'Ricky Pearsall (SF WR, IR)', 'Christian Kirk (SF WR, IR)', 'Jalen McMillan (TB WR, IR)', 'Jaylin Noel (HOU WR, IR)', 'Jayden Higgins (HOU WR, IR)', 'Tyquan Thornton (KC WR, IR)'];

// Handcuff rows are [team, starter and status, handcuff, verdict].

const HANDCUFFS = [
  ['KC', 'Kenneth Walker III: limited Tuesday (groin), has not played since Week 9.', 'Emmett Johnson', 'FLEX, RB14. 22 and 23 carries on 88% and 82% of the snaps for 35.1 and 24.3 with Kenneth Walker III out; a start if Walker sits again, a risk if he plays.'],
  ['DEN', 'RJ Harvey: on IR (knee). J.K. Dobbins: suspended for Friday.', 'Jonah Coleman', 'START, RB8. 24 carries on 85% of the snaps for 34.9 last week; J.K. Dobbins is suspended for Friday and RJ Harvey is on IR.'],
  ['JAX', 'Bhayshul Tuten: aggravated a right ankle injury last week.', 'Chris Rodriguez Jr.', 'SIT. 4 carries on 38% of the snaps last week; next up if Tuten sits.'],
  ['HOU', 'David Montgomery: 26 carries last week.', 'Woody Marks', 'SIT. Listed as questionable in our data (concussion), and his coach is hopeful he plays Sunday; 12 carries on 45% of the snaps in Week 10.'],
  ['LAR', 'Kyren Williams: full practice Tuesday (toe), 51% of the snaps before the bye.', 'Blake Corum', 'SIT. 17 carries on 51% of the snaps for 20.9 before the bye, the same snap share as Williams.'],
  ['BAL', 'Derrick Henry: 49% of the snaps last week.', 'Justice Hill', 'SIT. 17.6 last week on 6 carries and 5 targets, on 55% of the snaps to Henry\'s 49%.'],
  ['CHI', 'D\'Andre Swift: 46% of the snaps last week.', 'Kyle Monangai', 'SIT. 8 carries on 38% of the snaps for 1.8 last week in his first game since Week 4.'],
  ['CLE', 'Quinshon Judkins: 47% of the snaps before the bye.', 'Dylan Sampson', 'SIT. 6 targets in each of his last two games, on 51% of the snaps before the bye.'],
  ['CIN', 'Chase Brown: 6 carries last week.', 'Samaje Perine', 'SIT. 6 carries and 4 targets in each of the last two games for 13.9 and 13.7; 50% of the snaps last week.'],
  ['SF', 'Christian McCaffrey: 12 carries last week.', 'Kaelon Black', 'SIT. 6 carries on 30% of the snaps last week; the No. 2 behind McCaffrey.'],
  ['TB', 'Bucky Irving: 18 carries last week.', 'Kenny Gainwell', 'SIT. 4 carries and 5 targets on 41% of the snaps last week; behind Irving.'],
  ['NYJ', 'Breece Hall: 63% of the snaps last week.', 'Braelon Allen', 'SIT. 16 carries on 37% of the snaps for 9.4 last week; behind Hall.'],
  ['PIT', 'Jaylen Warren: 68% of the snaps last week.', 'Rico Dowdle', 'SIT. 5 carries and 5 targets on 32% of the snaps last week.'],
  ['MIN', 'Aaron Jones Sr.: 39% of the snaps last week.', 'Jordan Mason', 'SIT. 11 carries on 42% of the snaps for 4.7 last week.'],
  ['WAS', 'Jacory Croskey-Merritt: 41% of the snaps last week in a three-way split.', 'Rachaad White', 'SIT. No carries on 22% of the snaps last week.'],
  ['NO', 'Travis Etienne Jr.: 44% of the snaps last week.', 'Alvin Kamara', 'SIT. 1 carry on 11% of the snaps last week.'],
];

// IDP rows are [player, team, position, opponent, note].

const IDP_TABLE = [
  ['Nakobe Dean', 'LV', 'LB', 'at CLE (Sunday night)', '11.2 a game, 13.5, 9.5 and 15.0 the last three'],
  ['Blake Cashman', 'MIN', 'LB', 'vs ATL', '11.2 a game, 12.0 and 6.5 the last two'],
  ['Arvell Reese', 'NYG', 'LB', 'at IND', '11.1 a game, 25.0, 8.5 and 7.5 the last three'],
  ['Alex Singleton', 'DEN', 'LB', 'at PIT (Friday)', '10.7 a game, 12.0 last week'],
  ['George Karlaftis', 'KC', 'DE', 'at BUF (Thursday night)', '10.3 a game, 16.0, 8.5 and 17.5 the last three'],
  ['Will Anderson Jr.', 'HOU', 'DE', 'vs BAL', '10.3 a game, 10.0, 10.0 and 13.5 the last three'],
  ['David Bailey', 'NYJ', 'LB', 'at MIA', '10.0 a game, 21.0, 2.5 and 14.5 the last three'],
  ['Carson Schwesinger', 'CLE', 'LB', 'vs LV (Sunday night)', '9.8 a game, 22.5 and 11.5 his last two before the bye'],
];

const IDP_AVOID = 'Zack Baun is on IR (back), and Bobby Okereke is listed as questionable in our data. Greg Rousseau (back) and Amani Hooker (knee) practiced in full Tuesday, so both are fine to use.';

const SLEEPERS = [
  ['Tyler Shough', 'START, QB11. 17.1 a game on 4.3 carries; New Orleans is a 10-point underdog in a 50.5 total, though rain is likely in Cincinnati.', 'QB'],
  ['Cam Skattebo', 'FLEX, RB16. 14 carries and 7 targets on 84% of the snaps last week, for 5.8; Indianapolis allows the 9th-most RB points, and the Giants are implied for 24.0.', 'RB'],
  ['Antonio Williams', 'FLEX, WR28. 11 targets on 84% of the snaps for 21.2 last week, though 2 targets the week before; Washington implied for 24.25.', 'WR'],
  ['KC Concepcion', 'FLEX, WR27. 8 targets for 11.7 before the bye, 20% target share; Las Vegas allows the 11th-most WR points, and Denzel Boston is listed as questionable in our data.', 'WR'],
  ['Mike Gesicki', 'START, TE11. 12.7 last week on 6 targets; Cincinnati is implied for 30.25 and New Orleans allows the 7th-most TE points, though he played 47% of the snaps.', 'TE'],
];

const FADES = [
  ['Bo Nix', 'SIT. 11.5 last week, 14.2 a game; Pittsburgh allows the 5th-fewest QB points, and rain and 17 mph wind are forecast Friday.', 'QB'],
  ['Jonathan Taylor', 'FLEX, RB17. 17.1 carries a game, but 6.7, 9.4, 12.3 and 6.7 his last four; Indianapolis is implied for 17.5, and the Giants allow the 6th-fewest RB points.', 'RB'],
  ['Saquon Barkley', 'FLEX, RB23. Full practice Tuesday (neck); 17 carries on 64% of the snaps last week, and Dallas allows the 3rd-most RB points, though Philadelphia is implied for 19.5.', 'RB'],
  ['DK Metcalf', 'SIT. 4 targets on 62% of the snaps for 1.2 last week; Pittsburgh is implied for 16.5.', 'WR'],
  ['Sam LaPorta', 'SIT, TE14. Full practice Tuesday (ankle); 6 targets on 91% of the snaps for 9.2 last week, but Chicago allows the 7th-fewest TE points; TE14.', 'TE'],
];

const PIVOTS = [
  ['Kenneth Walker III out', 'Emmett Johnson (FLEX, RB14). Carry a back who kicks off Friday or later.'],
  ['Bhayshul Tuten out', 'Chris Rodriguez Jr. (SIT). Carry a back who kicks off at 4:05p or later.'],
  ['Omar Cooper Jr. out', 'Adonai Mitchell (SIT), a flex only if Cooper sits. Carry a receiver who kicks off at 4:05p or later.'],
  ['Brock Bowers out', 'Michael Mayer (SIT), a start only if Bowers sits. Carry a tight end who kicks off Monday.'],
  ['Dalton Kincaid out', 'No other Buffalo tight end has a call. Carry a tight end who kicks off Friday or later.'],
  ['Jalen Hurts out (already)', 'Joe Milton (SIT) is first on the depth chart.'],
  ['Drake Maye out (already)', 'Tommy DeVito (SIT) is first on the depth chart.'],
  ['Lamar Jackson out (already)', 'Jacoby Brissett (SIT).'],
  ['Jaxson Dart out (already)', 'J.J. McCarthy (SIT).'],
  ['Malik Willis out (already)', 'Kyle McCord (SIT).'],
  ['J.K. Dobbins out (already)', 'Jonah Coleman (START, RB8).'],
  ['De\'Von Achane out (already)', 'Ollie Gordon II (SIT).'],
  ['RJ Harvey out (already)', 'Jonah Coleman (START, RB8).'],
  ['James Conner out (already)', 'Tyler Allgeier (SIT).'],
  ['Puka Nacua out (already)', 'No Rams receiver has a start or flex call.'],
  ['Davante Adams out (already)', 'No Rams receiver has a start or flex call.'],
  ['Michael Wilson out (already)', 'No other Arizona receiver has a call.'],
  ['Jordan Addison out (already)', 'Justin Jefferson (START, WR12).'],
  ['Terry McLaurin out (already)', 'Stefon Diggs (FLEX, WR17) and Antonio Williams (FLEX, WR28).'],
  ['Romeo Doubs out (already)', 'Mack Hollins (SIT).'],
  ['Wan\'Dale Robinson out (already)', 'Carnell Tate (FLEX, WR30).'],
  ['Alec Pierce out (already)', 'No other Indianapolis receiver has a call.'],
];

const CHECK_WED = [
  ['Nobody on this card has an if-active call.', 'The Green Bay at Rams starts are Jordan Love, Kyren Williams, Matthew Golden and Christian Watson.'],
  ['Sits either way.', 'Josh Jacobs.'],
  ['Everyone else on the card.', 'Wednesday locks first: make any swap between the 6:30p ET inactives and the 8:00p ET kickoff.'],
];

const CHECK_THU = [
  ['Kenneth Walker III (KC RB).', 'Active: START. Out: Emmett Johnson (FLEX, RB14). Carry a back who kicks off Friday or later.'],
  ['Dalton Kincaid (BUF TE).', 'Active: START. Out: no other Buffalo tight end has a call. Carry a tight end who kicks off Friday or later.'],
  ['Sits either way.', 'Jake Ferguson.'],
];

const CHECK_FRI = [
  ['Nobody on this card has an if-active call.', 'The Denver at Pittsburgh starts are Jonah Coleman, Pat Freiermuth and the Denver Broncos D/ST.'],
];

const CHECK_ONE = [
  ['Bhayshul Tuten (JAX RB).', 'Active: FLEX. Out: Chris Rodriguez Jr. (SIT). Carry a back who kicks off at 4:05p or later.'],
  ['Omar Cooper Jr. (NYJ WR).', 'Active: FLEX. Out: Adonai Mitchell (SIT), a flex only if Cooper sits. Carry a receiver who kicks off at 4:05p or later.'],
  ['Sits either way.', 'Kyler Murray, Woody Marks and Juwan Johnson.'],
];

const CHECK_LATE = [
  ['Nobody on this card has an if-active call.', 'The late-window starts are Jayden Daniels, Brock Purdy, Christian McCaffrey, Jaxon Smith-Njigba, Trey McBride, George Kittle and Chig Okonkwo.'],
  ['Sits either way.', 'Justin Herbert, Sam Darnold, Carson Beck and A.J. Brown.'],
];

const CHECK_SNF = [
  ['Brock Bowers (LV TE).', 'Active: START. Out: Michael Mayer (SIT), a start only if Bowers sits. Carry a tight end who kicks off Monday.'],
  ['Sits either way.', 'Denzel Boston.'],
];

const CHECK_MNF = [
  ['Nobody on this card has an if-active call.', 'The Carolina at Tampa Bay starts are Bucky Irving, Chuba Hubbard, Tetairoa McMillan and the Tampa Bay Buccaneers D/ST.'],
  ['Everyone else on the card.', 'Monday is the last window, so a scratch here has no later game to pivot to.'],
];

const Body = () => (
  <>
    <HeroBanner />

    <Lead>
      Sixteen games, Wednesday through Monday, no byes, in Thanksgiving week. Green Bay at the Rams kicks off first, Wednesday at 8:00p ET. Three games are on Thursday, one on Friday, and Carolina at Tampa Bay closes the week Monday at 8:15p ET.
      The Rams lose Puka Nacua (IR, knee surgery) and Davante Adams (IR, hamstring). Drake Maye is listed as out in our data, with Tommy DeVito first on the New England depth chart. Denver has J.K. Dobbins suspended one game and RJ Harvey on IR, and the Chargers have Justin Herbert in the concussion protocol. Every call is here.
    </Lead>

    <Note title="Read this first">
      <strong>Lines are from our database as of Nov 25, 8:48am ET. Weather as of 5:48am ET. Practice notes are the Tuesday reports. Green Bay and the Rams have their final Wednesday-game report. The Thursday and Friday teams had posted no game statuses at writing, and the Sunday and Monday teams had not filed a practice report.</strong>{' '}
      News since last week&apos;s report:
      <Box component="ul" sx={{ pl: 2.5, m: '8px 0 0 !important' }}>
        <li>The Rams: Puka Nacua is on IR after knee surgery and out 4 to 5 months, and Davante Adams is on IR (hamstring). Matthew Stafford practiced in full Tuesday (elbow).</li>
        <li>Green Bay: Josh Jacobs is questionable for Wednesday (finger) after a limited practice.</li>
        <li>New England: Drake Maye is listed as out in our data with a fractured right fibula, and Tommy DeVito is first on the depth chart. Romeo Doubs is on IR (shoulder), and A.J. Brown is listed as doubtful in our data (hamstring).</li>
        <li>Denver: J.K. Dobbins is suspended one game by the team, and RJ Harvey is on IR. Jonah Coleman had 24 carries last week.</li>
        <li>Kansas City: Kenneth Walker III was limited Tuesday (groin) and has not played since Week 9.</li>
        <li>Buffalo: Dalton Kincaid was limited Tuesday (thumb, ankle) and has not played since Week 10.</li>
        <li>The Chargers: Justin Herbert is in the concussion protocol.</li>
        <li>Seattle: Sam Darnold has not played since Week 8 (quadriceps, rib); his coach said he starts Sunday if Wednesday&apos;s practice goes well.</li>
        <li>Jacksonville: Bhayshul Tuten aggravated a right ankle injury last week.</li>
        <li>Houston: Woody Marks is listed as questionable in our data (concussion), and his coach is hopeful he plays Sunday.</li>
        <li>Las Vegas: Brock Bowers is listed as questionable in our data and has not played since Week 10.</li>
        <li>Dallas: Jake Ferguson did not practice Tuesday (knee, ankle) and is listed as doubtful in our data.</li>
      </Box>
      Re-check the Thursday through Monday reports and the inactives before you lock anything. Every window below says
      when the inactives drop. Every time on this page is Eastern.
    </Note>

    <P>
      Scoring is PPR. No byes this week, so all 32 teams play. Six teams were off in Week 11 (Atlanta, Cleveland, Green Bay, the Rams, New England and Seattle), so their last game is Week 10.
      Where an engine projection is a placeholder (an injured or inactive player the model still scores),
      I say so and lean on usage.
    </P>
    <RailList
      items={[
        ['FPA rank', '1 means the defense allows the most points to that position (a good matchup), 32 the fewest (tough). Weeks 1 to 11.'],
        ['Verdicts', 'START, FLEX, SIT and OUT are the rulings. "If active" calls are void if the player does not appear, and they sit in the game-time group of each card.'],
        ['Tiers', 'QB 14, RB 27, WR 33, TE 14 and D/ST 8, in the order I rank them. A player ranked without a ruling says so.'],
        ['Ruling links', 'Every call on a card links to its Darkness Ruling (C1 to C158) with the reason.'],
      ]}
    />

    <JumpGrid games={GAMES} />

    <H2>The Slate Board</H2>
    <P>
      Every game, in kickoff order with Wednesday first: line, total, weather and both implied totals on
      one scale. Filled bars are the favorites. Chicago at Detroit has the highest total, 55.5, then
      New Orleans at Cincinnati at 50.5 and Tennessee at Jacksonville at 48.5. New England at the Chargers has the
      lowest, 35.5, then Denver at Pittsburgh at 36.5, and the Jets at Miami and Las Vegas at Cleveland at 40.5.
      Jacksonville (31.5) and Cincinnati (30.25) have the highest implied totals, then Chicago (28.5), Dallas (28.0),
      Houston (27.25) and Detroit (27.0). Pittsburgh has the lowest, 16.5, then New England and Tennessee at 17.0,
      and Atlanta and Arizona at 17.25. Jacksonville (-14.5), Cincinnati (-10) and Dallas (-8.5) are the biggest
      favorites, then Minnesota, Houston and Washington at -7.
    </P>
    <SlateBoard games={GAMES} />
    <P>
      The Rams, Detroit, Minnesota and the Chargers play indoors, and Dallas, Houston, Indianapolis and Arizona have
      retractable roofs. Outside, Dallas is 54F and sunny, Houston 71F with 15 mph wind, Indianapolis 50F with 13 mph
      wind and a 71% chance of light rain, and Arizona 76F and sunny. Rain is the main weather issue outdoors:
      Buffalo has a 100% chance of rain showers Thursday night (37F, 13 mph wind), Pittsburgh a 95% chance of light
      rain Friday (44F, 17 mph wind), and Cleveland a 71% chance of light rain Sunday night (47F, 15 mph wind).
      San Francisco (63F, 12 mph wind, 68% chance of light rain) and Cincinnati (54F, 12 mph wind, 64% chance of
      light rain) also have rain in the forecast. The rain in Buffalo, Pittsburgh, Cleveland and Cincinnati is already counted in the rulings for those games.
    </P>

    <H2>The Injury Board</H2>
    <P>
      The practice notes here are the Tuesday reports. The decision rules are simple, and I apply them
      the same way to every name on this page.
    </P>
    <RailList
      color="var(--warning)"
      items={[
        ['"If active" calls', 'are void if the player does not appear. A call that turns on a practice report carries that injury on its card.'],
        ['Engine placeholders', 'Hurts, Maye, Lamar Jackson, Dart, Willis, Dobbins, Achane, Harvey, Conner, Nacua, Adams, Michael Wilson, Addison, McLaurin, Doubs, Wan\'Dale Robinson and Pierce carry a projection. Each is ruled out, so the projection is a placeholder.'],
        ['Week 11 off', 'Atlanta, Cleveland, Green Bay, the Rams, New England and Seattle did not play last week, so their last game is Week 10.'],
      ]}
    />
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, my: 2 }}>
      <Chip tone="var(--accent)">Wednesday: about 6:30p ET</Chip>
      <Chip tone="var(--accent)">Thanksgiving: about 11:30a, 3:00p and 6:50p ET</Chip>
      <Chip tone="var(--accent)">Friday: about 1:30p ET</Chip>
      <Chip tone="var(--accent)">Sunday 1:00p games: about 11:30a ET</Chip>
      <Chip tone="var(--accent)">4:05p / 4:25p: about 2:35p / 2:55p ET</Chip>
      <Chip tone="var(--accent)">SNF: about 6:50p ET</Chip>
      <Chip tone="var(--accent)">MNF: about 6:45p ET Monday</Chip>
    </Box>

    <InjuryGroup title="Out, or treat as out" when="Engine projections for these players are placeholders." rows={INJ_OUT} />
    <InjuryGroup title="Wednesday through Friday" when="Inactives about 90 minutes before each kickoff" rows={INJ_THU} />
    {INJ_INTL.length ? <InjuryGroup title="International" when="Inactives about 90 minutes before kickoff" rows={INJ_INTL} /> : null}
    <InjuryGroup title="Sunday 1:00p games" when="Inactives about 11:30a ET" rows={INJ_ONE} />
    <InjuryGroup title="Late window" when="Inactives about 2:35p / 2:55p ET" rows={INJ_LATE} />
    {INJ_NIGHT.length ? <InjuryGroup title="Sunday night" when="Inactives about 6:50p ET" rows={INJ_NIGHT} /> : null}
    {INJ_MNF.length ? <InjuryGroup title="Monday night" when="Inactives about 6:45p ET Monday; no later window" rows={INJ_MNF} /> : null}
    <Box component="h3" sx={{ m: '24px 0 8px !important', fontSize: '1.15rem !important' }}>Already out for the week or longer</Box>
    <Box component="p" sx={{ mt: '0 !important', fontSize: '0.92rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
      {ALREADY_OUT.join('; ')}.
    </Box>

    <H2>Wednesday Through Friday</H2>
    <P>
      Five games over three days. Green Bay at the Rams kicks off Wednesday at 8:00p ET, indoors at SoFi Stadium,
      and inactives drop about 6:30p ET Wednesday. On Thursday, Thanksgiving, Chicago at Detroit kicks off at 1:00p ET
      in a dome (inactives about 11:30a), Philadelphia at Dallas kicks off at 4:30p ET under a retractable roof
      (inactives about 3:00p; outside it is 54F and sunny), and Kansas City at Buffalo kicks off at 8:20p ET
      (inactives about 6:50p; 37F, 13 mph wind and a 100% chance of rain showers). Denver at Pittsburgh is Friday
      at 3:00p ET, with 44F, 17 mph wind and a 95% chance of light rain, and inactives drop about 1:30p ET.
    </P>
    {SLOT('thu')}

    <H2>The 1:00p Window</H2>
    <P>
      Six games at 1:00p ET: Atlanta at Minnesota, Baltimore at Houston, New Orleans at Cincinnati, the Giants at
      Indianapolis, the Jets at Miami and Tennessee at Jacksonville. On Sunday nothing kicks between 1:00p and 4:05p,
      so a 1:00p decision needs a 4:05p-or-later swap on your bench. Inactives drop about 11:30a ET.
    </P>
    {SLOT('one')}

    <H2>Late Window</H2>
    <P>
      Three games, one at 4:05p and two at 4:25p. New England at the Chargers kicks off at 4:05p, and Seattle at
      San Francisco and Washington at Arizona kick off at 4:25p. Inactives drop about 2:35p ET for the 4:05p game
      and about 2:55p ET for the 4:25p games.
    </P>
    {SLOT('late')}

    <H2>Prime Time</H2>
    <P>
      Sunday night is Las Vegas at Cleveland at 8:20p ET. Monday night is Carolina at Tampa Bay at 8:15p ET, the last
      window. Inactives drop about 6:50p ET Sunday and about 6:45p ET Monday. The Sunday and Monday teams had not
      filed a practice report at writing, so hold both reads loosely.
    </P>
    {SLOT('prime')}

    <H2>Position Tiers</H2>
    <P>
      The rankings for the Wednesday through Monday slate. The bands follow my written verdict on each
      player: START, FLEX or SIT. A player I ranked without a ruling is listed under RANKED, NO CALL. The
      note under each name is the reason from his ruling.
    </P>
    <H3>Quarterback, top 14</H3>
    <TierBoard pos="QB" rows={QB_ROWS} next={QB_NEXT} />
    <H3>Running back, top 27</H3>
    <TierBoard pos="RB" rows={RB_ROWS} next={RB_NEXT} />
    <H3>Wide receiver, top 33</H3>
    <TierBoard pos="WR" rows={WR_ROWS} next={WR_NEXT} />
    <H3>Tight end, top 14</H3>
    <TierBoard pos="TE" rows={TE_ROWS} next={TE_NEXT} />
    <H3>D/ST, top 8</H3>
    <TierBoard pos="DST" rows={DST_ROWS} next={DST_TIER_NEXT} />

    <H2>Handcuff Board</H2>
    <P>
      The starter&apos;s report decides the handcuff, so read this beside the Injury Board. The verdict is
      for Week 12 and nothing else. A handcuff with no ruling gets no call.
    </P>
    <Table aria-label="Week 12 handcuff board">
      <THead>
        <TR>
          <TH scope="col">Team</TH><TH scope="col">Starter and status</TH><TH scope="col">Handcuff</TH><TH scope="col">Verdict</TH>
        </TR>
      </THead>
      <TBody>
        {HANDCUFFS.map(([team, starter, cuff, verdict]) => (
          <TR key={team}><TD><strong>{team}</strong></TD><TD>{starter}</TD><TD><strong>{cuff}</strong></TD><TD>{verdict}</TD></TR>
        ))}
      </TBody>
    </Table>

    <H2>D/ST Streaming Board</H2>
    <P>
      Each row is a D/ST and the offense it faces. &quot;Opp implied&quot; is the points the opposing offense
      is expected to score. Among these matchups, the two lowest opposing implied totals are Pittsburgh
      (16.5) and Tennessee (17), faced by Denver and Jacksonville.
    </P>
    <Table aria-label="Week 12 D/ST streaming board">
      <THead>
        <TR>
          <TH scope="col">D/ST</TH><TH scope="col">Opponent</TH><TH scope="col">Opp implied</TH><TH scope="col">Verdict</TH><TH scope="col">Why</TH>
        </TR>
      </THead>
      <TBody>
        {DST_TABLE.map(([team, opp, imp, verdict, why]) => (
          <TR key={team}><TD><strong>{team}</strong></TD><TD>{opp}</TD><TD>{imp}</TD><TD>{verdict}</TD><TD>{why}</TD></TR>
        ))}
      </TBody>
    </Table>

    <H2>IDP Streamers</H2>
    <P>
      Each streamer comes with the numbers behind the call. Check your own wire before you add one.
    </P>
    <Table aria-label="Week 12 IDP streamers">
      <THead>
        <TR>
          <TH scope="col">Player</TH><TH scope="col">Team</TH><TH scope="col">Pos</TH><TH scope="col">Opp</TH><TH scope="col">Note</TH>
        </TR>
      </THead>
      <TBody>
        {IDP_TABLE.map(([name, team, pos, opp, note]) => (
          <TR key={name}><TD><strong>{name}</strong></TD><TD>{team}</TD><TD>{pos}</TD><TD>{opp}</TD><TD>{note}</TD></TR>
        ))}
      </TBody>
    </Table>
    <P>{IDP_AVOID}</P>

    <H2>Sleepers, Fades and Pivots</H2>
    <H3>Sleepers</H3>
    <P>Lower-profile names. Check your own wire before you add one.</P>
    <RailList color="var(--success)" items={SLEEPERS} />
    <H3>Busts and fades</H3>
    <RailList color="var(--danger)" items={FADES} />
    <H3>If he is out, pivot to</H3>
    <P>
      The main contingencies in one place. If the first name is out at his inactive window, this
      is your next move.
    </P>
    <RailList color="var(--warning)" items={PIVOTS} />

    <H2>The Darkness Rulings</H2>
    <P>
      One hundred and fifty-eight rulings, C1 to C158, and 191 calls inside them. Each one is here with
      its reason.
    </P>
    {RULINGS.map((r) => <RulingCard key={r[0]} r={r} />)}

    <H2>Inactives Checklist</H2>
    <P>
      Inactives drop about 90 minutes before each kickoff. Windows are Eastern time. Wednesday is the first
      window, so start there.
    </P>
    <WindowChecklist title="Wednesday inactives" time="about 6:30p ET Wednesday" rows={CHECK_WED} />
    <WindowChecklist title="Thanksgiving inactives" time="about 11:30a, 3:00p and 6:50p ET Thursday" rows={CHECK_THU} />
    <WindowChecklist title="Friday inactives" time="about 1:30p ET Friday" rows={CHECK_FRI} />
    <WindowChecklist title="Sunday 1:00p inactives" time="about 11:30a ET" rows={CHECK_ONE} />
    <WindowChecklist title="4:05p and 4:25p inactives" time="about 2:35p and 2:55p ET" rows={CHECK_LATE} />
    <WindowChecklist title="Sunday night inactives" time="about 6:50p ET" rows={CHECK_SNF} />
    <WindowChecklist title="Monday night inactives" time="about 6:45p ET Monday" rows={CHECK_MNF} />

    <Quote>
      Start the names the rulings start, lean on usage, and have your pivots set before Wednesday&apos;s
      8:00p kickoff. The reports still to come may change any of it.
    </Quote>
  </>
);

export default Body;
