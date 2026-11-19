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

// Body only: the frontmatter lives in week11-start-sit-darkness-report.meta.js so listings can be
// built without loading this prose; content/articles/index.js loads it on demand.
//
// Every color below the hero is a theme token, so the board, cards and chips read in light and
// dark. The hero is a dark illustration in both themes, like the Week 3 start/sit banner.
//
// Reading key (also printed in the article): FPA rank: 1 = most points allowed (good matchup for the
// opposing position), 32 = fewest (tough). Weeks 1 to 10. Times are Eastern. Verdicts come from docs/editorial/week11-rulings.md.

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
      aria-labelledby="wk11ss-hero-title wk11ss-hero-desc"
    >
      <title id="wk11ss-hero-title">Week 11 Start/Sit: The Darkness Report</title>
      <desc id="wk11ss-hero-desc">
        A night stadium seen from one end: floodlight towers on both sides throw cones of light onto a
        field whose yard lines narrow to a far end line, with a goalpost in the middle. A football
        sits on the turf, and a dotted kick path rises toward the uprights. The headline Week 11 Start/Sit is set in a panel across the bottom.
      </desc>
      <defs>
        <linearGradient id="wk11ss-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#04060c" />
          <stop offset="1" stopColor="#101a2c" />
        </linearGradient>
        <linearGradient id="wk11ss-beam" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#dbe7ff" stopOpacity="0.5" />
          <stop offset="1" stopColor="#dbe7ff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="wk11ss-turf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#123f2e" />
          <stop offset="1" stopColor="#07190f" />
        </linearGradient>
        <linearGradient id="wk11ss-kick" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#ffd866" stopOpacity="0" />
          <stop offset="1" stopColor="#ffd866" stopOpacity="0.95" />
        </linearGradient>
      </defs>
      <rect width="800" height="300" fill="url(#wk11ss-sky)" />
      <rect x="0" y="150" width="800" height="150" fill="url(#wk11ss-turf)" />
      <path d="M60 300 L300 150 L500 150 L740 300" fill="none" stroke="#ffffff" strokeOpacity="0.22" />
      <path d="M300 150 L500 150" stroke="#ffffff" strokeOpacity="0.4" strokeWidth="2" />
      {rows.map((y) => {
        const t = (300 - y) / 150;
        return <line key={y} x1={60 + 240 * t} y1={y} x2={740 - 240 * t} y2={y} stroke="#ffffff" strokeOpacity="0.16" />;
      })}
      <path d="M110 36 L60 300 L340 300 Z M690 36 L460 300 L740 300 Z" fill="url(#wk11ss-beam)" />
      <path d="M110 150 L110 34 M690 150 L690 34" stroke="#3b4a66" strokeWidth="4" strokeLinecap="round" />
      <circle cx="110" cy="30" r="18" fill="#7eaaff" fillOpacity="0.3" />
      <circle cx="690" cy="30" r="18" fill="#7eaaff" fillOpacity="0.3" />
      <rect x="98" y="24" width="24" height="10" rx="2" fill="#dbe7ff" />
      <rect x="678" y="24" width="24" height="10" rx="2" fill="#dbe7ff" />
      <path d="M400 150 L400 112 M372 112 L428 112 M372 112 L372 58 M428 112 L428 58" fill="none" stroke="#ffd866" strokeWidth="3" strokeLinecap="round" />
      <path d="M150 196 C 210 40, 330 20, 400 84" fill="none" stroke="url(#wk11ss-kick)" strokeWidth="3" strokeLinecap="round" strokeDasharray="2 9" />
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
      <text x="400" y="246" textAnchor="middle" fill="#ffffff" fontFamily="system-ui, sans-serif" fontWeight="850" fontSize="24" letterSpacing="1">WEEK 11 START/SIT</text>
      <text x="400" y="270" textAnchor="middle" fill="#8badc9" fontFamily="system-ui, sans-serif" fontWeight="600" fontSize="12" letterSpacing="2">WEEK 11 | THURSDAY TO MONDAY | 13 GAMES</text>
    </Box>
  );
}

// Generated from docs/editorial/week11-rulings.md and the week's dump. Games are in kickoff order.
// Game call items are [name, position, why, rank, flag]. flag is a Darkness Ruling id (C4).
// Injury board rows are [name, position, team, status, pivot, tone, ruling].
// D/ST rows are [d/st, opponent, opp implied, verdict, why].
const GAMES = [
  {
    id: 'ind-hou',
    slot: 'thu',
    title: 'Colts at Texans',
    kick: 'Thu 8:15p',
    when: 'Thursday Night · 8:15p ET',
    away: 'IND',
    home: 'HOU',
    awayPts: 15.5,
    homePts: 28,
    line: 'HOU -12.5',
    total: 43.5,
    weather: 'Retractable roof; 66F and partly cloudy outside',
    rain: false,
    read: 'Houston is a 12.5-point favorite over Indianapolis in a 43.5 total, implied for 28 for Houston and 15.5 for Indianapolis. C.J. Stroud (QB5) is a start on 20.5 a game, with 35.4 and 20.4 the last two. Nico Collins (WR6) is a start with 16 targets for 24.4 last week, and Xavier Hutchinson (WR28) is a flex with 9 targets for 15.8 last week. Jonathan Taylor (RB10) is a start on 17.7 carries a game, and Tyler Warren (TE9) is a start on a 22% target share. David Montgomery (RB22) is a flex if active, with Woody Marks ruled out Thursday and Indianapolis allowing the 6th-most RB points. Houston Texans (DST3) is a start, with 13 and 6 the last two. Marvin Harrison Jr. is out Thursday (hamstring), and Dalton Schultz (TE14) is a sit at 8.8 a game.',
    fpa: 'IND offense vs HOU D: QB 10, RB 15, WR 4, TE 23 · HOU offense vs IND D: QB 14, RB 6, WR 22, TE 19',
    start: [
      ['C.J. Stroud', 'QB', '35.4 and 20.4 the last two, 20.5 a game; Houston implied for 28.0 Thursday.', 'QB5', 'C5'],
      ['Jonathan Taylor', 'RB', '16.6 a game on 17.7 carries and a 13% target share; Indianapolis is implied for 15.5 Thursday, so the volume is the case.', 'RB10', 'C40'],
      ['Nico Collins', 'WR', '16 targets for 24.4 last week; Houston implied for 28.0 Thursday with Marvin Harrison Jr. out and Jaylin Noel on IR.', 'WR6', 'C70'],
      ['Tyler Warren', 'TE', '22% target share, 7.0 targets a game, though 2.4 last week and Houston allows the 10th-fewest TE points.', 'TE9', 'C119'],
      ['Houston Texans', 'DEF', 'Indianapolis implied for 15.5 Thursday; 13 and 6 the last two.', 'DST3', 'C134'],
    ],
    flex: [
      ['Xavier Hutchinson', 'WR', '9 targets for 15.8 last week on 76% of the snaps; Marvin Harrison Jr. is out Thursday and Jaylin Noel is on IR.', 'WR28', 'C92'],
    ],
    watch: [
      ['David Montgomery', 'RB', 'FLEX if active. Full practice (groin) with Woody Marks ruled out Thursday and Jawhar Jordan listed as out in our data; he last played in Week 5, but Houston is implied for 28.0 and Indianapolis allows the 6th-most RB points.', 'RB22', 'C52'],
    ],
    sit: [
      ['Daniel Jones', 'QB', '8.7 a game, 5.2 last week; Indianapolis implied for 15.5 as a 12.5-point underdog Thursday.', null, 'C21'],
      ['Emari Demercado', 'RB', '7 carries on 33% of the snaps last week; next up behind Montgomery.', null, 'C52'],
      ['Woody Marks', 'RB', 'OUT. Ruled out Thursday (concussion); the engine still projects 9.7.', null, 'C52'],
      ['Seth McGowan', 'RB', '12 carries on 29% of the snaps for 13.7 last week; behind Taylor.', null, 'C60'],
      ['Tank Dell', 'WR', '4 targets on 49% of the snaps last week; full practice (hand).', null, 'C92'],
      ['Marvin Harrison Jr.', 'WR', 'OUT. Ruled out Thursday (hamstring); the engine still projects 6.9.', null, 'C106'],
      ['Alec Pierce', 'WR', 'OUT. On IR (heel); the engine still projects 9.7.', null, 'C110'],
      ['Dalton Schultz', 'TE', '8.8 a game, 2 targets last week; TE14.', 'TE14', 'C124'],
    ],
    also: 'Will Anderson Jr. (HOU DE) is on the IDP board.',
  },
  {
    id: 'ari-kc',
    slot: 'one',
    title: 'Cardinals at Chiefs',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'ARI',
    home: 'KC',
    awayPts: 12.5,
    homePts: 28,
    line: 'KC -15.5',
    total: 40.5,
    weather: '49F, wind 13, sunny',
    rain: false,
    read: 'Kansas City is a 15.5-point favorite over Arizona in a 40.5 total, implied for 28 for Kansas City and 12.5 for Arizona. Patrick Mahomes (QB4) is a start with 35.4 last week, and Arizona allows the most QB points. Kenneth Walker III (RB7) is a start if active after he did not practice Wednesday (groin), with 24.5 a game on 19.9 carries. Emmett Johnson (RB15) is a flex with 22 carries last week with Walker out, and a start if Walker sits again. Trey McBride (TE1) is a start on a 28% target share. Travis Kelce (TE6) is a start after 31% of the snaps last week, and Arizona allows the 7th-most TE points. Rashee Rice (WR16) is a flex on a 21% target share. Michael Wilson is out, on IR (neck), and Carson Beck is a sit at 0.4 last week. Kansas City Chiefs (DST1) is a start, with 15 and 11 the last two.',
    fpa: 'ARI offense vs KC D: QB 29, RB 26, WR 31, TE 6 · KC offense vs ARI D: QB 1, RB 14, WR 15, TE 7',
    start: [
      ['Patrick Mahomes', 'QB', '35.4 last week, full practice Wednesday (elbow); Kansas City implied for 28.0, and Arizona allows the most QB points.', 'QB4', 'C4'],
      ['Trey McBride', 'TE', '28% target share, 9.9 targets a game; Arizona\'s top target with Michael Wilson on IR, though Arizona is implied for 12.5.', 'TE1', 'C111'],
      ['Travis Kelce', 'TE', 'Full practice Wednesday (calf) after 31% of the snaps last week; Kansas City implied for 28.0, and Arizona allows the 7th-most TE points.', 'TE6', 'C116'],
      ['Kansas City Chiefs', 'DEF', 'Arizona implied for 12.5, the lowest on the slate, with Carson Beck at quarterback; 15 and 11 the last two.', 'DST1', 'C132'],
    ],
    flex: [
      ['Emmett Johnson', 'RB', '22 carries and 7 targets on 88% of the snaps for 35.1 last week with Kenneth Walker III out; a start if Walker sits again, a risk if he plays.', 'RB15', 'C45'],
      ['Rashee Rice', 'WR', 'Full practice Wednesday (knee); 21% target share, and Kansas City is implied for 28.0, though he played 46% of the snaps last week.', 'WR16', 'C80'],
    ],
    watch: [
      ['Kenneth Walker III', 'RB', 'START if active. Did not practice Wednesday (groin) and has no Week 10 game in our data; 24.5 a game on 19.9 carries, and Kansas City is implied for 28.0.', 'RB7', 'C37'],
    ],
    sit: [
      ['Carson Beck', 'QB', '0.4 on 100% of the snaps last week with Gardner Minshew II on IR; Arizona is implied for 12.5, the lowest on the slate.', null, 'C25'],
      ['Tyler Allgeier', 'RB', '5 carries on 46% of the snaps for 1.4 last week; Arizona is implied for 12.5, the lowest on the slate.', null, 'C57'],
      ['James Conner', 'RB', 'OUT. On IR (foot); the engine still projects 10.2.', null, 'C64'],
      ['Josh Downs', 'WR', '15.3 last week on 17% of the snaps.', null, 'C95'],
      ['Xavier Worthy', 'WR', '0.0 last week on 3 targets.', null, 'C102'],
      ['Michael Wilson', 'WR', 'OUT. On IR (neck); the engine still projects 12.1.', null, 'C107'],
    ],
    also: null,
  },
  {
    id: 'bal-car',
    slot: 'one',
    title: 'Ravens at Panthers',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'BAL',
    home: 'CAR',
    awayPts: 20.5,
    homePts: 23,
    line: 'CAR -2.5',
    total: 43.5,
    weather: '66F, wind 9, mostly sunny',
    rain: false,
    read: 'Carolina is a 2.5-point favorite over Baltimore in a 43.5 total, implied for 23 for Carolina and 20.5 for Baltimore. Derrick Henry (RB8) is a start on 18.5 carries a game, and Carolina allows the 3rd-most RB points, though he played 55% of the snaps last week. Chuba Hubbard (RB6) is a start after a rest day Wednesday, with 34.2 last week on 27 carries and 84% of the snaps. Zay Flowers (WR12) is a start on a 29% target share and 7.9 targets a game. Tetairoa McMillan (WR14) is a start on a 25% target share, with Carolina implied for 23.0. Justice Hill is a sit with 3 carries behind Henry, and Jacoby Brissett is a sit at 13.7 a game. Lamar Jackson is out on IR after right thumb surgery. Darren Waller is a sit after he did not practice Wednesday (knee), and his coach called it a concern.',
    fpa: 'BAL offense vs CAR D: QB 21, RB 3, WR 18, TE 22 · CAR offense vs BAL D: QB 15, RB 23, WR 16, TE 16',
    start: [
      ['Chuba Hubbard', 'RB', 'Rest day Wednesday; 34.2 last week on 27 carries and 84% of the snaps, 20.1 a game.', 'RB6', 'C36'],
      ['Derrick Henry', 'RB', '18.5 carries a game and Carolina allows the 3rd-most RB points, though he played 55% of the snaps last week.', 'RB8', 'C38'],
      ['Zay Flowers', 'WR', '29% target share, 7.9 targets a game and 88% of the snaps last week.', 'WR12', 'C76'],
      ['Tetairoa McMillan', 'WR', '25% target share, 8.7 targets a game; Carolina implied for 23.0.', 'WR14', 'C78'],
    ],
    flex: [],
    watch: [],
    sit: [
      ['Bryce Young', 'QB', '8.1 last week, 17.2 a game; full practice Wednesday (foot).', null, 'C15'],
      ['Jacoby Brissett', 'QB', '13.7 a game, 11.8 last week; Baltimore implied for 20.5.', null, 'C17'],
      ['Lamar Jackson', 'QB', 'OUT. On IR after right thumb surgery; the engine still projects 14.6.', null, 'C28'],
      ['Justice Hill', 'RB', '7 targets last week but 3 carries; the change-of-pace back behind Henry.', null, 'C58'],
      ['Jalen Coker', 'WR', '0.3 last week on 4 targets.', null, 'C99'],
      ['Mark Andrews', 'TE', '16.2 last week on 8 targets after 5.3, 4.4 and 3.9.', null, 'C125'],
      ['Darren Waller', 'TE', 'Did not practice Wednesday (knee), and his coach called it a concern.', null, 'C128'],
      ['Tommy Tremble', 'TE', 'Did not practice Wednesday (knee).', null, 'C128'],
    ],
    also: 'Devin Lloyd (CAR LB) is on the IDP board.',
  },
  {
    id: 'mia-buf',
    slot: 'one',
    title: 'Dolphins at Bills',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'MIA',
    home: 'BUF',
    awayPts: 14.5,
    homePts: 31,
    line: 'BUF -16.5',
    total: 45.5,
    weather: '64F, wind 8, partly sunny',
    rain: false,
    read: 'Buffalo is a 16.5-point favorite over Miami in a 45.5 total, implied for 31 for Buffalo and 14.5 for Miami. Josh Allen (QB2) is a start at 24.8 a game on 7.3 carries. James Cook III (RB3) is a start on 20.8 carries a game, and Miami allows the 9th-most RB points. DJ Moore (WR27) is a flex with 19.4 last week, and Miami allows the 3rd-fewest WR points. Dalton Kincaid (TE7) is a start if active after he did not practice Wednesday (thumb, ankle), with 10.3 a game. Buffalo Bills (DST2) is a start, with 21, 22 and 12 the last three. Ollie Gordon II (RB21) is a flex with 20 carries and 5 targets last week, and Caleb Douglas (WR30) is a flex if active after he was limited Wednesday (shoulder). Malik Willis is out on IR (groin), and Kyle McCord is a sit at 12.8 last week.',
    fpa: 'MIA offense vs BUF D: QB 23, RB 10, WR 11, TE 20 · BUF offense vs MIA D: QB 20, RB 9, WR 30, TE 4',
    start: [
      ['Josh Allen', 'QB', '24.8 a game on 7.3 carries; Buffalo implied for 31.0 as a 16.5-point favorite.', 'QB2', 'C2'],
      ['James Cook III', 'RB', '20.8 carries a game, 18.9 points a game; Buffalo implied for 31.0, and Miami allows the 9th-most RB points.', 'RB3', 'C33'],
      ['Buffalo Bills', 'DEF', 'Miami implied for 14.5 with Kyle McCord at quarterback; 21, 22 and 12 the last three.', 'DST2', 'C133'],
    ],
    flex: [
      ['Ollie Gordon II', 'RB', '20 carries and 5 targets on 71% of the snaps last week; Buffalo allows the 10th-most RB points, though Miami is implied for 14.5.', 'RB21', 'C51'],
      ['DJ Moore', 'WR', '19.4 last week and Buffalo is implied for 31.0, though Miami allows the 3rd-fewest WR points and he played 58% of the snaps.', 'WR27', 'C91'],
    ],
    watch: [
      ['Caleb Douglas', 'WR', 'FLEX if active. Limited Wednesday (shoulder); 8 targets in each of the last two games on a 23% target share, though Miami is implied for 14.5.', 'WR30', 'C94'],
      ['Dalton Kincaid', 'TE', 'START if active. Did not practice Wednesday (thumb, ankle); 10.3 a game, Buffalo is implied for 31.0 and Miami allows the 4th-most TE points.', 'TE7', 'C117'],
    ],
    sit: [
      ['Kyle McCord', 'QB', '12.8 on 100% of the snaps last week with Malik Willis on IR; Miami is implied for 14.5.', null, 'C24'],
      ['Malik Willis', 'QB', 'OUT. On IR (groin); the engine still projects 12.6.', null, 'C29'],
      ['De\'Von Achane', 'RB', 'OUT. On IR (knee); the engine still projects 14.3.', null, 'C62'],
      ['Khalil Shakir', 'WR', '3 targets last week, 5.0 targets a game.', null, 'C96'],
      ['Malik Washington', 'WR', '3 targets in each of the last two games.', null, 'C97'],
    ],
    also: null,
  },
  {
    id: 'no-chi',
    slot: 'one',
    title: 'Saints at Bears',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'NO',
    home: 'CHI',
    awayPts: 18.5,
    homePts: 30,
    line: 'CHI -11.5',
    total: 48.5,
    weather: '53F, wind 15, 34% rain showers',
    rain: false,
    read: 'Chicago is an 11.5-point favorite over New Orleans in a 48.5 total, implied for 30 for Chicago and 18.5 for New Orleans. Caleb Williams (QB9) is a start at 18.4 a game with 5.2 carries. D\'Andre Swift (RB5) is a start on 17.2 carries a game, and New Orleans allows the 2nd-most RB points. Chris Olave (WR13) is a start on a 27% target share, and Chicago allows the 8th-fewest WR points. Jordyn Tyson (WR24) is a flex if active with 13 targets for 19.0 last week. Luther Burden III (WR11) is a start if active, with 17.5, 23.7, 18.6 and 20.7 his last four. Colston Loveland (TE5) is a start with 18.5, 19.9, 11.5 and 9.4 his last four, and New Orleans allows the 9th-most TE points. Rome Odunze (WR26) is a flex with 16.0 on 7 targets before the bye. Chicago Bears (DST6) is a start, with 12 and 14 the last two.',
    fpa: 'NO offense vs CHI D: QB 12, RB 22, WR 25, TE 24 · CHI offense vs NO D: QB 19, RB 2, WR 24, TE 9',
    start: [
      ['Caleb Williams', 'QB', '18.4 a game with 5.2 carries; Chicago implied for 30.0 off the bye.', 'QB9', 'C9'],
      ['D\'Andre Swift', 'RB', '17.2 carries a game; Chicago implied for 30.0, and New Orleans allows the 2nd-most RB points.', 'RB5', 'C35'],
      ['Chris Olave', 'WR', '27% target share and 9.7 targets a game, though 6.0 last week and Chicago allows the 8th-fewest WR points.', 'WR13', 'C77'],
      ['Colston Loveland', 'TE', '18.5, 19.9, 11.5 and 9.4 his last four; Chicago implied for 30.0, and New Orleans allows the 9th-most TE points.', 'TE5', 'C115'],
      ['Chicago Bears', 'DEF', 'New Orleans implied for 18.5 with 15 mph wind; 12 and 14 the last two.', 'DST6', 'C137'],
    ],
    flex: [
      ['Rome Odunze', 'WR', '16.0 on 7 targets and 84% of the snaps before the bye; Chicago implied for 30.0.', 'WR26', 'C90'],
    ],
    watch: [
      ['Luther Burden III', 'WR', 'START if active. Full practice Wednesday (concussion); 17.5, 23.7, 18.6 and 20.7 his last four, and Chicago is implied for 30.0.', 'WR11', 'C75'],
      ['Jordyn Tyson', 'WR', 'FLEX if active. Limited Wednesday (chest); 13 targets for 19.0 last week on 71% of the snaps.', 'WR24', 'C88'],
    ],
    sit: [
      ['Tyler Shough', 'QB', '17.4 a game but 10.0 last week; New Orleans is implied for 18.5 with 15 mph wind in Chicago; QB14.', 'QB14', 'C14'],
      ['Kyle Monangai', 'RB', 'Full practice Wednesday (toe) after last playing in Week 4; no role to trust in his first game back.', null, 'C35'],
      ['Travis Etienne Jr.', 'RB', '8 carries and 5 targets on 33% of the snaps last week; New Orleans splits the work three ways.', 'RB25', 'C55'],
      ['Alvin Kamara', 'RB', 'Rest day Wednesday; 2 carries on 25% of the snaps last week.', null, 'C55'],
      ['Audric Estime', 'RB', '7 carries on 43% of the snaps for 2.1 last week.', null, 'C55'],
      ['Devaughn Vele', 'WR', '3.7 and 3.4 the last two.', null, 'C103'],
      ['Juwan Johnson', 'TE', '4.8 last week on 3 targets.', null, 'C130'],
    ],
    also: 'Kaden Elliss (NO LB) is on the IDP board.',
  },
  {
    id: 'pit-phi',
    slot: 'one',
    title: 'Steelers at Eagles',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'PIT',
    home: 'PHI',
    awayPts: 21,
    homePts: 16.5,
    line: 'PIT -4.5',
    total: 37.5,
    weather: '61F, wind 5, 50% light rain',
    rain: true,
    read: 'Pittsburgh is a 4.5-point favorite over Philadelphia in a 37.5 total, implied for 21 for Pittsburgh and 16.5 for Philadelphia. Jaylen Warren (RB18) is a flex with 16.7 a game, though 7 carries on 38% of the snaps last week, and Philadelphia allows the 12th-fewest RB points. DK Metcalf (WR17) is a flex on a 23% target share, and Philadelphia allows the 3rd-most WR points. Pittsburgh Steelers (DST8) is a start, with 9.3 a game despite -6 last week. Saquon Barkley (RB23) is a flex with 13 carries in each of his last two games. DeVonta Smith (WR18) is a flex if active with a 32% target share and 17.5 a game; he has not played since Week 6. Dallas Goedert (TE8) is a start with 5.9 targets a game. Makai Lemon (WR31) is a sit with 9 targets in each of his last two games. Jalen Hurts is out on IR, and Joe Milton is a sit.',
    fpa: 'PIT offense vs PHI D: QB 9, RB 21, WR 3, TE 30 · PHI offense vs PIT D: QB 25, RB 13, WR 17, TE 17',
    start: [
      ['Dallas Goedert', 'TE', '5.9 targets a game and 81% of the snaps before the bye; 10.6 a game.', 'TE8', 'C118'],
      ['Pittsburgh Steelers', 'DEF', 'Philadelphia implied for 16.5 with Jalen Hurts on IR; 9.3 a game despite -6 last week.', 'DST8', 'C139'],
    ],
    flex: [
      ['Jaylen Warren', 'RB', '16.7 a game, but 7 carries on 38% of the snaps last week; Philadelphia allows the 12th-fewest RB points.', 'RB18', 'C48'],
      ['Saquon Barkley', 'RB', 'Full practice Wednesday (hamstring); 13 carries in each of his last two games, on 59% of the snaps before the bye, though Philadelphia is implied for 16.5.', 'RB23', 'C53'],
      ['DK Metcalf', 'WR', '15.4 last week on a 23% target share; Philadelphia allows the 3rd-most WR points.', 'WR17', 'C81'],
    ],
    watch: [
      ['DeVonta Smith', 'WR', 'FLEX if active. Limited Wednesday (hamstring) and has not played since Week 6; 32% target share, 17.5 a game.', 'WR18', 'C82'],
    ],
    sit: [
      ['Aaron Rodgers', 'QB', '14.9 a game; Pittsburgh implied for 21.0 in a 37.5 total, the lowest on the slate.', null, 'C16'],
      ['Joe Milton', 'QB', 'First on Philadelphia\'s depth chart with Jalen Hurts on IR; 13.2 on 9 carries before the bye, and Philadelphia is implied for 16.5.', null, 'C26'],
      ['Jalen Hurts', 'QB', 'OUT. On IR and expected to miss the rest of the season; the engine still projects 14.8.', null, 'C27'],
      ['Rico Dowdle', 'RB', '5 carries on 49% of the snaps last week, more snaps than Warren.', null, 'C48'],
      ['Makai Lemon', 'WR', '9 targets in each of the last two games on 94% and 93% of the snaps, but 8.4 a game with Philadelphia implied for 16.5.', 'WR31', 'C82'],
      ['Germie Bernard', 'WR', '1.0 last week on 3 targets.', null, 'C100'],
      ['Pat Freiermuth', 'TE', '3 targets last week on 54% of the snaps; Philadelphia allows the 3rd-fewest TE points.', null, 'C129'],
    ],
    also: 'Payton Wilson (PIT LB) is on the IDP board.',
  },
  {
    id: 'tb-det',
    slot: 'one',
    title: 'Buccaneers at Lions',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'TB',
    home: 'DET',
    awayPts: 18.25,
    homePts: 25.25,
    line: 'DET -7',
    total: 43.5,
    weather: 'Dome',
    rain: false,
    read: 'Detroit is a 7-point favorite over Tampa Bay in a dome with a 43.5 total, implied for 25.25 for Detroit and 18.25 for Tampa Bay. Jared Goff (QB11) is a start, though Tampa Bay allows the 3rd-fewest QB points. Jahmyr Gibbs (RB1) is a start with 28.2 a game on 22.1 carries, and Tampa Bay allows the fewest RB points. Amon-Ra St. Brown (WR3) is a start on a 31% target share. Bucky Irving (RB9) is a start at 17.7 a game, though Detroit allows the 3rd-fewest RB points. Emeka Egbuka (WR21) is a flex on a 24% target share, and Detroit allows the 12th-most WR points. Jameson Williams (WR19) is a flex on 12.7 a game. Sam LaPorta (TE11) is a start on 5.9 targets a game, and Tampa Bay allows the 10th-most TE points. Detroit Lions (DST5) is a start, with 13 and 18 the last two. Baker Mayfield is a sit after not practicing Wednesday (foot).',
    fpa: 'TB offense vs DET D: QB 2, RB 30, WR 12, TE 1 · DET offense vs TB D: QB 30, RB 32, WR 23, TE 10',
    start: [
      ['Jared Goff', 'QB', '20.4 last week, 18.6 a game; Detroit implied for 25.25 in a dome, though Tampa Bay allows the 3rd-fewest QB points.', 'QB11', 'C11'],
      ['Jahmyr Gibbs', 'RB', '44.2 last week, 28.2 a game on 22.1 carries; Detroit implied for 25.25, though Tampa Bay allows the fewest RB points.', 'RB1', 'C31'],
      ['Bucky Irving', 'RB', '28.5 before the bye, 17.7 a game on 18.6 carries, though Detroit allows the 3rd-fewest RB points.', 'RB9', 'C39'],
      ['Amon-Ra St. Brown', 'WR', '25.8 last week, 20.4 a game on a 31% target share; Detroit implied for 25.25 in a dome.', 'WR3', 'C67'],
      ['Sam LaPorta', 'TE', '5.9 targets a game and 79% of the snaps last week, though 2.6 points for it; Tampa Bay allows the 10th-most TE points.', 'TE11', 'C121'],
      ['Detroit Lions', 'DEF', 'Tampa Bay implied for 18.25 and Baker Mayfield did not practice Wednesday; 13 and 18 the last two.', 'DST5', 'C136'],
    ],
    flex: [
      ['Jameson Williams', 'WR', '12.7 a game; 7 targets last week on 79% of the snaps, and Detroit is implied for 25.25.', 'WR19', 'C83'],
      ['Emeka Egbuka', 'WR', '24% target share, 7.7 targets a game, and Detroit allows the 12th-most WR points, though Baker Mayfield did not practice Wednesday.', 'WR21', 'C85'],
    ],
    watch: [],
    sit: [
      ['Baker Mayfield', 'QB', 'Did not practice Wednesday (foot); 8.5 a game, even though Detroit allows the 2nd-most QB points.', null, 'C20'],
      ['Kenny Gainwell', 'RB', '5 carries on 38% of the snaps before the bye; behind Irving.', null, 'C59'],
      ['Cade Otton', 'TE', '8 targets on 100% of the snaps before the bye and Detroit allows the most TE points, but 5.5 a game; TE13.', 'TE13', 'C123'],
    ],
    also: null,
  },
  {
    id: 'ten-dal',
    slot: 'one',
    title: 'Titans at Cowboys',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'TEN',
    home: 'DAL',
    awayPts: 23,
    homePts: 31.5,
    line: 'DAL -8.5',
    total: 54.5,
    weather: 'Retractable roof; 62F, wind 15 and sunny outside',
    rain: false,
    read: 'Dallas is an 8.5-point favorite over Tennessee in a 54.5 total, with Dallas implied for 31.5 and Tennessee for 23. Dak Prescott (QB3) is a start with 34.4 last week and 20.2 a game. Tony Pollard (RB4) is a start with 23.9 last week on 9 targets, and Dallas allows the most RB points. Javonte Williams (RB11) is a start at 17.0 carries a game. CeeDee Lamb (WR2) is a start on a 33% target share and 12.1 targets a game. George Pickens (WR4) is a start with 43.5 last week on 18 targets. Carnell Tate (WR23) is a flex only if active, limited Wednesday (shoulder) with a 27% target share. Ryan Flournoy (WR22) is a flex with 19.1 last week on 7 targets. Cam Ward (QB13) is a sit with 26.3 and 19.1 the last two. Wan\'Dale Robinson is out for the season on IR (ankle). Jake Ferguson is out and will not play Sunday (knee, ankle).',
    fpa: 'TEN offense vs DAL D: QB 3, RB 1, WR 7, TE 13 · DAL offense vs TEN D: QB 5, RB 16, WR 1, TE 18',
    start: [
      ['Dak Prescott', 'QB', '34.4 last week, 20.2 a game; Dallas implied for 31.5, the highest on the slate, and Tennessee allows the 5th-most QB points.', 'QB3', 'C3'],
      ['Tony Pollard', 'RB', '23.9 last week on 9 targets after 36.5 and 28.7; Dallas allows the most RB points in a 54.5 total.', 'RB4', 'C34'],
      ['Javonte Williams', 'RB', '17.0 carries a game; Dallas implied for 31.5, the highest on the slate.', 'RB11', 'C41'],
      ['CeeDee Lamb', 'WR', '33% target share and 12.1 targets a game; Tennessee allows the most WR points, and Dallas is implied for 31.5.', 'WR2', 'C66'],
      ['George Pickens', 'WR', '43.5 last week on 18 targets; Tennessee allows the most WR points in a 54.5 total.', 'WR4', 'C68'],
    ],
    flex: [
      ['Ryan Flournoy', 'WR', '19.1 last week on 7 targets and 81% of the snaps; Dallas implied for 31.5 against the defense that allows the most WR points.', 'WR22', 'C86'],
    ],
    watch: [
      ['Carnell Tate', 'WR', 'FLEX if active. Limited Wednesday (shoulder) and has not played since Week 7; 27% target share, Wan\'Dale Robinson is on IR, and Dallas allows the 7th-most WR points.', 'WR23', 'C87'],
    ],
    sit: [
      ['Cam Ward', 'QB', '26.3 and 19.1 the last two and Dallas allows the 3rd-most QB points in a 54.5 total, but 13.3 a game; QB13.', 'QB13', 'C13'],
      ['Tyjae Spears', 'RB', 'Did not practice Wednesday (knee); 4 carries last week behind Pollard.', null, 'C61'],
      ['Elic Ayomanor', 'WR', '10 targets on 95% of the snaps for 12.9 last week; a flex only if Tate sits.', 'WR33', 'C87'],
      ['Wan\'Dale Robinson', 'WR', 'OUT. On IR and out for the season (ankle); the engine still projects 10.6.', null, 'C108'],
      ['Jake Ferguson', 'TE', 'OUT. Did not practice Wednesday (knee, ankle) and will not play Sunday; the engine still projects 7.1.', null, 'C131'],
    ],
    also: null,
  },
  {
    id: 'nyj-lac',
    slot: 'late',
    title: 'Jets at Chargers',
    kick: 'Sun 4:05p',
    when: 'Sun 4:05p ET',
    away: 'NYJ',
    home: 'LAC',
    awayPts: 19.25,
    homePts: 22.25,
    line: 'LAC -3',
    total: 41.5,
    weather: 'Dome',
    rain: false,
    read: 'The Chargers are a 3-point favorite over the Jets in a 41.5 total, with the Jets implied for 19.25 and the Chargers for 22.25. Garrett Wilson (WR8) is a start with 14 targets for 15.6 last week on a 28% target share, and the Chargers allow the 6th-most WR points. Breece Hall (RB20) is a flex on 15 and 11 carries the last two weeks, and the Chargers allow the 12th-most RB points. Omarion Hampton (RB17) is a flex on 22 carries on 63% of the snaps last week, and the Jets allow the 8th-most RB points. Omar Cooper Jr. (WR29) is a flex only if active, with 22.3, 22.5 and 13.8 his last three. He did not practice Wednesday (ankle). Geno Smith is a sit after playing 48% of the snaps last week for 5.9. Ladd McConkey is a sit, limited Wednesday (back) and has not played since Week 8.',
    fpa: 'NYJ offense vs LAC D: QB 22, RB 12, WR 6, TE 26 · LAC offense vs NYJ D: QB 11, RB 8, WR 26, TE 12',
    start: [
      ['Garrett Wilson', 'WR', '14 targets for 15.6 last week on a 28% target share; the Chargers allow the 6th-most WR points.', 'WR8', 'C72'],
    ],
    flex: [
      ['Omarion Hampton', 'RB', '22 carries on 63% of the snaps for 17.5 last week; the Jets allow the 8th-most RB points.', 'RB17', 'C47'],
      ['Breece Hall', 'RB', '15 and 11 carries the last two weeks for 11.7 and 14.8; the Chargers allow the 12th-most RB points.', 'RB20', 'C50'],
    ],
    watch: [
      ['Omar Cooper Jr.', 'WR', 'FLEX if active. Did not practice Wednesday (ankle) and has no Week 10 game in our data; 22.3, 22.5 and 13.8 his last three, and the Chargers allow the 6th-most WR points.', 'WR29', 'C93'],
    ],
    sit: [
      ['Justin Herbert', 'QB', '16.3 last week on 7 carries but 10.9 a game; the Chargers are implied for 22.25.', null, 'C18'],
      ['Geno Smith', 'QB', 'Played 48% of the snaps last week for 5.9 and was limited Wednesday (ankle); he said he intends to play Sunday.', null, 'C19'],
      ['Braelon Allen', 'RB', '8 carries in each of the last two weeks for 5.4 and 5.6.', null, 'C50'],
      ['Adonai Mitchell', 'WR', '8 targets on 87% of the snaps for 8.9 last week; a flex only if Cooper sits.', null, 'C93'],
      ['Ladd McConkey', 'WR', 'Limited Wednesday (back) and has not played since Week 8.', null, 'C101'],
    ],
    also: null,
  },
  {
    id: 'jax-nyg',
    slot: 'late',
    title: 'Jaguars at Giants',
    kick: 'Sun 4:25p',
    when: 'Sun 4:25p ET',
    away: 'JAX',
    home: 'NYG',
    awayPts: 26.25,
    homePts: 20.25,
    line: 'JAX -6',
    total: 46.5,
    weather: '59F, wind 5, 30% light rain',
    rain: false,
    read: 'Jacksonville is a 6-point favorite over the Giants in a 46.5 total, with Jacksonville implied for 26.25 and the Giants for 20.25. Trevor Lawrence (QB6) is a start with 26.8 last week and 19.3 a game, and the Giants allow the 6th-most QB points. Parker Washington (WR10) is a start with 28.2 last week on 9 targets. Malik Nabers (WR9) is a start on a 28% target share and 9.4 targets a game, and Jacksonville allows the 14th-most WR points. Isaiah Likely (TE3) is a start with 27.7 last week on 11 targets. Cam Skattebo (RB13) is a flex with 27.2 last week on 18 carries, and Jacksonville allows the 6th-fewest RB points. Bhayshul Tuten (RB16) is a flex only if active, limited Wednesday (ankle, foot) with 26 carries on 70% of the snaps for 20.3 last week. Chris Rodriguez Jr. is a sit, next up if Tuten sits. Jaxson Dart is out on IR.',
    fpa: 'JAX offense vs NYG D: QB 6, RB 28, WR 20, TE 15 · NYG offense vs JAX D: QB 28, RB 27, WR 14, TE 28',
    start: [
      ['Trevor Lawrence', 'QB', '26.8 last week, 19.3 a game; Jacksonville implied for 26.25, and the Giants allow the 6th-most QB points.', 'QB6', 'C6'],
      ['Malik Nabers', 'WR', '28% target share and 9.4 targets a game, though 9.3 and 7.4 the last two; Jacksonville allows the 14th-most WR points.', 'WR9', 'C73'],
      ['Parker Washington', 'WR', '28.2 last week on 9 targets, 15.4 a game; Jacksonville implied for 26.25.', 'WR10', 'C74'],
      ['Isaiah Likely', 'TE', '27.7 last week on 11 targets, 27% target share, though Jacksonville allows the 5th-fewest TE points.', 'TE3', 'C113'],
    ],
    flex: [
      ['Cam Skattebo', 'RB', '27.2 last week on 18 carries and 89% of the snaps, full practice Wednesday (hamstring); Jacksonville allows the 6th-fewest RB points.', 'RB13', 'C43'],
    ],
    watch: [
      ['Bhayshul Tuten', 'RB', 'FLEX if active. Limited Wednesday (ankle, foot); 26 carries on 70% of the snaps for 20.3 last week, though the Giants allow the 5th-fewest RB points.', 'RB16', 'C46'],
    ],
    sit: [
      ['J.J. McCarthy', 'QB', '17.1 last week on 6 carries, but 10.2 a game, and Jacksonville allows the 5th-fewest QB points.', null, 'C22'],
      ['Jaxson Dart', 'QB', 'OUT. On IR; the engine still projects 13.5.', null, 'C30'],
      ['Chris Rodriguez Jr.', 'RB', 'Limited Wednesday (hand); 4 carries on 14% of the snaps last week, next up if Tuten sits.', null, 'C46'],
      ['Jakobi Meyers', 'WR', 'Limited Wednesday (ankle); 6.4 last week on 6 targets.', null, 'C74'],
      ['Brenton Strange', 'TE', '3 targets last week, 8.9 a game.', null, 'C127'],
    ],
    also: 'Arvell Reese (NYG LB) and Foyesade Oluokun (JAX LB) are on the IDP board.',
  },
  {
    id: 'lv-den',
    slot: 'late',
    title: 'Raiders at Broncos',
    kick: 'Sun 4:25p',
    when: 'Sun 4:25p ET',
    away: 'LV',
    home: 'DEN',
    awayPts: 15.25,
    homePts: 25.25,
    line: 'DEN -10',
    total: 40.5,
    weather: '48F, wind 5, sunny',
    rain: false,
    read: 'Denver is a 10-point favorite over Las Vegas in a 40.5 total, with Las Vegas implied for 15.25 and Denver for 25.25. Bo Nix (QB10) is a start with 19.3 and 15.7 his last two and 14.5 a game, and Las Vegas allows the 4th-most QB points. Brock Bowers (TE2) is a start only if active, with a 26% target share and 18.7 a game. Ashton Jeanty (RB19) is a flex with 5.9 targets a game and 71% of the snaps last week. Jonah Coleman (RB14) is a flex on 17 carries on 77% of the snaps for 18.8 before the bye, and Las Vegas allows the 5th-most RB points. Courtland Sutton (WR25) is a flex on 9 targets for 15.5 before the bye. The Denver Broncos (DST4) defense is a start at 7.7 a game. Fernando Mendoza is a sit with 13.9 on 100% of the snaps last week. RJ Harvey is out on IR (knee).',
    fpa: 'LV offense vs DEN D: QB 18, RB 11, WR 27, TE 3 · DEN offense vs LV D: QB 4, RB 5, WR 9, TE 5',
    start: [
      ['Bo Nix', 'QB', 'Las Vegas allows the 4th-most QB points and Denver is implied for 25.25 off the bye; 19.3 and 15.7 his last two, 14.5 a game.', 'QB10', 'C10'],
      ['Denver Broncos', 'DEF', 'Las Vegas implied for 15.25 with Fernando Mendoza at quarterback; 7.7 a game.', 'DST4', 'C135'],
    ],
    flex: [
      ['Jonah Coleman', 'RB', '17 carries on 77% of the snaps for 18.8 before the bye with RJ Harvey on IR; Las Vegas allows the 5th-most RB points.', 'RB14', 'C44'],
      ['Ashton Jeanty', 'RB', '5.9 targets a game and 71% of the snaps last week, but 9 carries, and Las Vegas is implied for 15.25.', 'RB19', 'C49'],
      ['Courtland Sutton', 'WR', '9 targets for 15.5 before the bye; limited Wednesday for rest, and Las Vegas allows the 9th-most WR points.', 'WR25', 'C89'],
    ],
    watch: [
      ['Brock Bowers', 'TE', 'START if active. Did not practice Wednesday (ankle) after 19% of the snaps last week, and his coach said he does not need to practice to play Sunday; 26% target share, 18.7 a game.', 'TE2', 'C112'],
    ],
    sit: [
      ['Fernando Mendoza', 'QB', '13.9 on 100% of the snaps last week; Las Vegas is implied for 15.25.', null, 'C23'],
      ['J.K. Dobbins', 'RB', '4 carries on 15% of the snaps before the bye.', null, 'C44'],
      ['RJ Harvey', 'RB', 'OUT. On IR (knee); the engine still projects 12.3.', null, 'C63'],
      ['Jaylen Waddle', 'WR', 'Full practice Wednesday (concussion); 1 target on 19% of the snaps before the bye.', null, 'C89'],
      ['Tre Tucker', 'WR', '2 targets for 1.9 last week; Las Vegas is implied for 15.25.', null, 'C98'],
      ['Michael Mayer', 'TE', '3 targets on 83% of the snaps last week; a start only if Bowers sits.', null, 'C112'],
    ],
    also: 'Nakobe Dean (LV LB) and Alex Singleton (DEN LB) are on the IDP board.',
  },
  {
    id: 'min-sf',
    slot: 'prime',
    title: 'Vikings at 49ers',
    kick: 'Sun 8:20p',
    when: 'Sunday Night · 8:20p ET',
    away: 'MIN',
    home: 'SF',
    awayPts: 21.75,
    homePts: 24.75,
    line: 'SF -3',
    total: 46.5,
    weather: 'Mexico City, no forecast in our data',
    rain: false,
    read: 'San Francisco is a 3-point favorite over Minnesota in a 46.5 total, with San Francisco implied for 24.75 and Minnesota for 21.75. The game is played at Estadio Banorte in Mexico City with San Francisco as the home team, and our data has no forecast. Kirk Cousins (QB12) is a start at 18.8 a game on the season. Brock Purdy (QB8) is a start at 22.6 a game. Justin Jefferson (WR7) is a start on a 31% target share, and San Francisco allows the 10th-most WR points. Christian McCaffrey (RB2) is a start at 23.7 a game on a 19% target share. Deebo Samuel Sr. (WR20) is a flex on 3 targets and 68% of the snaps. George Kittle (TE4) is a start at 14.3 a game. T.J. Hockenson (TE10) is a start only if active, with a 20% target share. The Minnesota Vikings (DST7) defense is a start at 14.2 a game. Jordan Addison is out with thumb surgery.',
    fpa: 'MIN offense vs SF D: QB 16, RB 25, WR 10, TE 14 · SF offense vs MIN D: QB 32, RB 29, WR 28, TE 32',
    start: [
      ['Brock Purdy', 'QB', '25.3 and 31.7 the last two, 22.6 a game; San Francisco implied for 24.75, though Minnesota allows the fewest QB points.', 'QB8', 'C8'],
      ['Kirk Cousins', 'QB', '15.4 on 100% of the snaps in his one Minnesota game last week; 18.8 a game on the season, most of it with Las Vegas; San Francisco allows the 16th-most QB points; QB12.', 'QB12', 'C12'],
      ['Christian McCaffrey', 'RB', 'Rest day Wednesday; 46.3 last week, 23.7 a game on a 19% target share.', 'RB2', 'C32'],
      ['Justin Jefferson', 'WR', '13 targets last week and a 31% target share; San Francisco allows the 10th-most WR points, and Jordan Addison is out.', 'WR7', 'C71'],
      ['George Kittle', 'TE', '9 targets on 94% of the snaps last week, 14.3 a game, though Minnesota allows the fewest TE points.', 'TE4', 'C114'],
      ['Minnesota Vikings', 'DEF', '14.2 a game, the best on the slate, and 24 last week, though San Francisco is implied for 24.75.', 'DST7', 'C138'],
    ],
    flex: [
      ['Deebo Samuel Sr.', 'WR', '25.9 last week in his first game since Week 5, on 3 targets and 68% of the snaps.', 'WR20', 'C84'],
    ],
    watch: [
      ['T.J. Hockenson', 'TE', 'START if active. Limited Wednesday (wrist) and has no Week 10 game in our data; 20% target share, and Jordan Addison is out.', 'TE10', 'C120'],
    ],
    sit: [
      ['Kyler Murray', 'QB', 'Did not practice Wednesday (hamstring) and is listed as out in our data.', null, 'C12'],
      ['Kaelon Black', 'RB', '11 carries on 40% of the snaps for 14.6 last week; the No. 2 behind McCaffrey.', null, 'C32'],
      ['Aaron Jones Sr.', 'RB', '11 carries on 43% of the snaps last week; splits with Jordan Mason.', 'RB26', 'C56'],
      ['Jordan Mason', 'RB', '16 carries on 54% of the snaps for 5.9 last week.', 'RB27', 'C56'],
      ['Mike Evans', 'WR', 'Did not practice Wednesday (Achilles) and has not played since Week 6; his coach hopes he returns to practice Thursday.', null, 'C84'],
      ['Keenan Allen', 'WR', '7, 8 and 7 targets the last three, 11.1 last week on 48% of the snaps.', 'WR32', 'C84'],
      ['Jordan Addison', 'WR', 'OUT. Thumb surgery this week and did not practice Wednesday; the engine still projects 8.3.', null, 'C105'],
    ],
    also: null,
  },
  {
    id: 'cin-was',
    slot: 'prime',
    title: 'Bengals at Commanders',
    kick: 'Mon 8:15p',
    when: 'Monday Night · 8:15p ET',
    away: 'CIN',
    home: 'WAS',
    awayPts: 30,
    homePts: 23.5,
    line: 'CIN -6.5',
    total: 53.5,
    weather: '52F, wind 12, mostly clear',
    rain: false,
    read: 'Cincinnati is a 6.5-point favorite over Washington in a 53.5 total, with Cincinnati implied for 30 and Washington for 23.5. Joe Burrow (QB1) is a start with 33.2 last week and 25.8 a game. Chase Brown (RB12) is a start with 28.3 last week on 9 targets. Ja\'Marr Chase (WR1) is a start with 34.1 last week on 14 targets. Tee Higgins (WR5) is a start at 19.0 a game on a 22% target share. Chig Okonkwo (TE12) is a start on 7 and 8 targets the last two, and Cincinnati allows the 8th-most TE points. Jayden Daniels (QB7) is a start with 20.8 last week on 11 carries. Rachaad White (RB24) is a flex on 11 carries on 52% of the snaps last week. Stefon Diggs (WR15) is a flex with 20.3 last week on 10 targets. Jacory Croskey-Merritt is a sit, on IR and designated to return Tuesday (groin). Terry McLaurin is out on IR after knee surgery.',
    fpa: 'CIN offense vs WAS D: QB 8, RB 20, WR 13, TE 2 · WAS offense vs CIN D: QB 17, RB 18, WR 21, TE 8',
    start: [
      ['Joe Burrow', 'QB', '33.2 last week and 25.8 a game; Cincinnati implied for 30.0 Monday, and Washington allows the 8th-most QB points.', 'QB1', 'C1'],
      ['Jayden Daniels', 'QB', '20.8 last week on 11 carries, 19.4 a game; a 53.5 total Monday.', 'QB7', 'C7'],
      ['Chase Brown', 'RB', '28.3 last week on 9 targets, 6.0 targets a game; Cincinnati implied for 30.0 Monday.', 'RB12', 'C42'],
      ['Ja\'Marr Chase', 'WR', '34.1 last week on 14 targets after 31.1 and 31.5; Cincinnati implied for 30.0 Monday.', 'WR1', 'C65'],
      ['Tee Higgins', 'WR', '19.0 a game on a 22% target share; Cincinnati implied for 30.0, and Washington allows the 13th-most WR points.', 'WR5', 'C69'],
      ['Chig Okonkwo', 'TE', '7 and 8 targets the last two; Cincinnati allows the 8th-most TE points in a 53.5 total; TE12.', 'TE12', 'C122'],
    ],
    flex: [
      ['Rachaad White', 'RB', '11 carries on 52% of the snaps last week in a 53.5 total; Jacory Croskey-Merritt was designated to return from IR, so the role is not secure.', 'RB24', 'C54'],
      ['Stefon Diggs', 'WR', '20.3 last week on 10 targets, 13.8 a game; a 53.5 total Monday.', 'WR15', 'C79'],
    ],
    watch: [],
    sit: [
      ['Jacory Croskey-Merritt', 'RB', 'On IR and designated to return Tuesday (groin); not activated at writing.', null, 'C54'],
      ['Antonio Williams', 'WR', '2 targets last week.', null, 'C104'],
      ['Terry McLaurin', 'WR', 'OUT. On IR after knee surgery; the engine still projects 9.4.', null, 'C109'],
      ['Mike Gesicki', 'TE', 'Washington allows the 2nd-most TE points, but 2 targets in each of the last two games on under half the snaps.', null, 'C126'],
    ],
    also: null,
  },
];

const QB_ROWS = [
  [1, 'Joe Burrow', 'CIN', '33.2 last week and 25.8 a game; Cincinnati implied for 30.0 Monday, and Washington allows the 8th-most QB points', 'start'],
  [2, 'Josh Allen', 'BUF', '24.8 a game on 7.3 carries; Buffalo implied for 31.0 as a 16.5-point favorite', 'start'],
  [3, 'Dak Prescott', 'DAL', '34.4 last week, 20.2 a game; Dallas implied for 31.5, the highest on the slate, and Tennessee allows the 5th-most QB points', 'start'],
  [4, 'Patrick Mahomes', 'KC', '35.4 last week, full practice Wednesday (elbow); Kansas City implied for 28.0, and Arizona allows the most QB points', 'start'],
  [5, 'C.J. Stroud', 'HOU', '35.4 and 20.4 the last two, 20.5 a game; Houston implied for 28.0 Thursday', 'start'],
  [6, 'Trevor Lawrence', 'JAX', '26.8 last week, 19.3 a game; Jacksonville implied for 26.25, and the Giants allow the 6th-most QB points', 'start'],
  [7, 'Jayden Daniels', 'WAS', '20.8 last week on 11 carries, 19.4 a game; a 53.5 total Monday', 'start'],
  [8, 'Brock Purdy', 'SF', '25.3 and 31.7 the last two, 22.6 a game; San Francisco implied for 24.75, though Minnesota allows the fewest QB points', 'start'],
  [9, 'Caleb Williams', 'CHI', '18.4 a game with 5.2 carries; Chicago implied for 30.0 off the bye', 'start'],
  [10, 'Bo Nix', 'DEN', 'Las Vegas allows the 4th-most QB points and Denver is implied for 25.25 off the bye; 19.3 and 15.7 his last two, 14.5 a game', 'start'],
  [11, 'Jared Goff', 'DET', '20.4 last week, 18.6 a game; Detroit implied for 25.25 in a dome, though Tampa Bay allows the 3rd-fewest QB points', 'start'],
  [12, 'Kirk Cousins', 'MIN', '15.4 on 100% of the snaps in his one Minnesota game last week; 18.8 a game on the season, most of it with Las Vegas; San Francisco allows the 16th-most QB points; QB12', 'start'],
  [13, 'Cam Ward', 'TEN', '26.3 and 19.1 the last two and Dallas allows the 3rd-most QB points in a 54.5 total, but 13.3 a game; QB13', 'sit'],
  [14, 'Tyler Shough', 'NO', '17.4 a game but 10.0 last week; New Orleans is implied for 18.5 with 15 mph wind in Chicago; QB14', 'sit'],
];

const RB_ROWS = [
  [1, 'Jahmyr Gibbs', 'DET', '44.2 last week, 28.2 a game on 22.1 carries; Detroit implied for 25.25, though Tampa Bay allows the fewest RB points', 'start'],
  [2, 'Christian McCaffrey', 'SF', 'Rest day Wednesday; 46.3 last week, 23.7 a game on a 19% target share', 'start'],
  [3, 'James Cook III', 'BUF', '20.8 carries a game, 18.9 points a game; Buffalo implied for 31.0, and Miami allows the 9th-most RB points', 'start'],
  [4, 'Tony Pollard', 'TEN', '23.9 last week on 9 targets after 36.5 and 28.7; Dallas allows the most RB points in a 54.5 total', 'start'],
  [5, 'D\'Andre Swift', 'CHI', '17.2 carries a game; Chicago implied for 30.0, and New Orleans allows the 2nd-most RB points', 'start'],
  [6, 'Chuba Hubbard', 'CAR', 'Rest day Wednesday; 34.2 last week on 27 carries and 84% of the snaps, 20.1 a game', 'start'],
  [7, 'Kenneth Walker III', 'KC', 'If active. Did not practice Wednesday (groin) and has no Week 10 game in our data; 24.5 a game on 19.9 carries, and Kansas City is implied for 28.0', 'start'],
  [8, 'Derrick Henry', 'BAL', '18.5 carries a game and Carolina allows the 3rd-most RB points, though he played 55% of the snaps last week', 'start'],
  [9, 'Bucky Irving', 'TB', '28.5 before the bye, 17.7 a game on 18.6 carries, though Detroit allows the 3rd-fewest RB points', 'start'],
  [10, 'Jonathan Taylor', 'IND', '16.6 a game on 17.7 carries and a 13% target share; Indianapolis is implied for 15.5 Thursday, so the volume is the case', 'start'],
  [11, 'Javonte Williams', 'DAL', '17.0 carries a game; Dallas implied for 31.5, the highest on the slate', 'start'],
  [12, 'Chase Brown', 'CIN', '28.3 last week on 9 targets, 6.0 targets a game; Cincinnati implied for 30.0 Monday', 'start'],
  [13, 'Cam Skattebo', 'NYG', '27.2 last week on 18 carries and 89% of the snaps, full practice Wednesday (hamstring); Jacksonville allows the 6th-fewest RB points', 'flex'],
  [14, 'Jonah Coleman', 'DEN', '17 carries on 77% of the snaps for 18.8 before the bye with RJ Harvey on IR; Las Vegas allows the 5th-most RB points', 'flex'],
  [15, 'Emmett Johnson', 'KC', '22 carries and 7 targets on 88% of the snaps for 35.1 last week with Kenneth Walker III out; a start if Walker sits again, a risk if he plays', 'flex'],
  [16, 'Bhayshul Tuten', 'JAX', 'If active. Limited Wednesday (ankle, foot); 26 carries on 70% of the snaps for 20.3 last week, though the Giants allow the 5th-fewest RB points', 'flex'],
  [17, 'Omarion Hampton', 'LAC', '22 carries on 63% of the snaps for 17.5 last week; the Jets allow the 8th-most RB points', 'flex'],
  [18, 'Jaylen Warren', 'PIT', '16.7 a game, but 7 carries on 38% of the snaps last week; Philadelphia allows the 12th-fewest RB points', 'flex'],
  [19, 'Ashton Jeanty', 'LV', '5.9 targets a game and 71% of the snaps last week, but 9 carries, and Las Vegas is implied for 15.25', 'flex'],
  [20, 'Breece Hall', 'NYJ', '15 and 11 carries the last two weeks for 11.7 and 14.8; the Chargers allow the 12th-most RB points', 'flex'],
  [21, 'Ollie Gordon II', 'MIA', '20 carries and 5 targets on 71% of the snaps last week; Buffalo allows the 10th-most RB points, though Miami is implied for 14.5', 'flex'],
  [22, 'David Montgomery', 'HOU', 'If active. Full practice (groin) with Woody Marks ruled out Thursday and Jawhar Jordan listed as out in our data; he last played in Week 5, but Houston is implied for 28.0 and Indianapolis allows the 6th-most RB points', 'flex'],
  [23, 'Saquon Barkley', 'PHI', 'Full practice Wednesday (hamstring); 13 carries in each of his last two games, on 59% of the snaps before the bye, though Philadelphia is implied for 16.5', 'flex'],
  [24, 'Rachaad White', 'WAS', '11 carries on 52% of the snaps last week in a 53.5 total; Jacory Croskey-Merritt was designated to return from IR, so the role is not secure', 'flex'],
  [25, 'Travis Etienne Jr.', 'NO', '8 carries and 5 targets on 33% of the snaps last week; New Orleans splits the work three ways', 'sit'],
  [26, 'Aaron Jones Sr.', 'MIN', '11 carries on 43% of the snaps last week; splits with Jordan Mason', 'sit'],
  [27, 'Jordan Mason', 'MIN', '16 carries on 54% of the snaps for 5.9 last week', 'sit'],
];

const WR_ROWS = [
  [1, 'Ja\'Marr Chase', 'CIN', '34.1 last week on 14 targets after 31.1 and 31.5; Cincinnati implied for 30.0 Monday', 'start'],
  [2, 'CeeDee Lamb', 'DAL', '33% target share and 12.1 targets a game; Tennessee allows the most WR points, and Dallas is implied for 31.5', 'start'],
  [3, 'Amon-Ra St. Brown', 'DET', '25.8 last week, 20.4 a game on a 31% target share; Detroit implied for 25.25 in a dome', 'start'],
  [4, 'George Pickens', 'DAL', '43.5 last week on 18 targets; Tennessee allows the most WR points in a 54.5 total', 'start'],
  [5, 'Tee Higgins', 'CIN', '19.0 a game on a 22% target share; Cincinnati implied for 30.0, and Washington allows the 13th-most WR points', 'start'],
  [6, 'Nico Collins', 'HOU', '16 targets for 24.4 last week; Houston implied for 28.0 Thursday with Marvin Harrison Jr. out and Jaylin Noel on IR', 'start'],
  [7, 'Justin Jefferson', 'MIN', '13 targets last week and a 31% target share; San Francisco allows the 10th-most WR points, and Jordan Addison is out', 'start'],
  [8, 'Garrett Wilson', 'NYJ', '14 targets for 15.6 last week on a 28% target share; the Chargers allow the 6th-most WR points', 'start'],
  [9, 'Malik Nabers', 'NYG', '28% target share and 9.4 targets a game, though 9.3 and 7.4 the last two; Jacksonville allows the 14th-most WR points', 'start'],
  [10, 'Parker Washington', 'JAX', '28.2 last week on 9 targets, 15.4 a game; Jacksonville implied for 26.25', 'start'],
  [11, 'Luther Burden III', 'CHI', 'If active. Full practice Wednesday (concussion); 17.5, 23.7, 18.6 and 20.7 his last four, and Chicago is implied for 30.0', 'start'],
  [12, 'Zay Flowers', 'BAL', '29% target share, 7.9 targets a game and 88% of the snaps last week', 'start'],
  [13, 'Chris Olave', 'NO', '27% target share and 9.7 targets a game, though 6.0 last week and Chicago allows the 8th-fewest WR points', 'start'],
  [14, 'Tetairoa McMillan', 'CAR', '25% target share, 8.7 targets a game; Carolina implied for 23.0', 'start'],
  [15, 'Stefon Diggs', 'WAS', '20.3 last week on 10 targets, 13.8 a game; a 53.5 total Monday', 'flex'],
  [16, 'Rashee Rice', 'KC', 'Full practice Wednesday (knee); 21% target share, and Kansas City is implied for 28.0, though he played 46% of the snaps last week', 'flex'],
  [17, 'DK Metcalf', 'PIT', '15.4 last week on a 23% target share; Philadelphia allows the 3rd-most WR points', 'flex'],
  [18, 'DeVonta Smith', 'PHI', 'If active. Limited Wednesday (hamstring) and has not played since Week 6; 32% target share, 17.5 a game', 'flex'],
  [19, 'Jameson Williams', 'DET', '12.7 a game; 7 targets last week on 79% of the snaps, and Detroit is implied for 25.25', 'flex'],
  [20, 'Deebo Samuel Sr.', 'SF', '25.9 last week in his first game since Week 5, on 3 targets and 68% of the snaps', 'flex'],
  [21, 'Emeka Egbuka', 'TB', '24% target share, 7.7 targets a game, and Detroit allows the 12th-most WR points, though Baker Mayfield did not practice Wednesday', 'flex'],
  [22, 'Ryan Flournoy', 'DAL', '19.1 last week on 7 targets and 81% of the snaps; Dallas implied for 31.5 against the defense that allows the most WR points', 'flex'],
  [23, 'Carnell Tate', 'TEN', 'If active. Limited Wednesday (shoulder) and has not played since Week 7; 27% target share, Wan\'Dale Robinson is on IR, and Dallas allows the 7th-most WR points', 'flex'],
  [24, 'Jordyn Tyson', 'NO', 'If active. Limited Wednesday (chest); 13 targets for 19.0 last week on 71% of the snaps', 'flex'],
  [25, 'Courtland Sutton', 'DEN', '9 targets for 15.5 before the bye; limited Wednesday for rest, and Las Vegas allows the 9th-most WR points', 'flex'],
  [26, 'Rome Odunze', 'CHI', '16.0 on 7 targets and 84% of the snaps before the bye; Chicago implied for 30.0', 'flex'],
  [27, 'DJ Moore', 'BUF', '19.4 last week and Buffalo is implied for 31.0, though Miami allows the 3rd-fewest WR points and he played 58% of the snaps', 'flex'],
  [28, 'Xavier Hutchinson', 'HOU', '9 targets for 15.8 last week on 76% of the snaps; Marvin Harrison Jr. is out Thursday and Jaylin Noel is on IR', 'flex'],
  [29, 'Omar Cooper Jr.', 'NYJ', 'If active. Did not practice Wednesday (ankle) and has no Week 10 game in our data; 22.3, 22.5 and 13.8 his last three, and the Chargers allow the 6th-most WR points', 'flex'],
  [30, 'Caleb Douglas', 'MIA', 'If active. Limited Wednesday (shoulder); 8 targets in each of the last two games on a 23% target share, though Miami is implied for 14.5', 'flex'],
  [31, 'Makai Lemon', 'PHI', '9 targets in each of the last two games on 94% and 93% of the snaps, but 8.4 a game with Philadelphia implied for 16.5', 'sit'],
  [32, 'Keenan Allen', 'SF', '7, 8 and 7 targets the last three, 11.1 last week on 48% of the snaps', 'sit'],
  [33, 'Elic Ayomanor', 'TEN', '10 targets on 95% of the snaps for 12.9 last week; a flex only if Tate sits', 'sit'],
];

const TE_ROWS = [
  [1, 'Trey McBride', 'ARI', '28% target share, 9.9 targets a game; Arizona\'s top target with Michael Wilson on IR, though Arizona is implied for 12.5', 'start'],
  [2, 'Brock Bowers', 'LV', 'If active. Did not practice Wednesday (ankle) after 19% of the snaps last week, and his coach said he does not need to practice to play Sunday; 26% target share, 18.7 a game', 'start'],
  [3, 'Isaiah Likely', 'NYG', '27.7 last week on 11 targets, 27% target share, though Jacksonville allows the 5th-fewest TE points', 'start'],
  [4, 'George Kittle', 'SF', '9 targets on 94% of the snaps last week, 14.3 a game, though Minnesota allows the fewest TE points', 'start'],
  [5, 'Colston Loveland', 'CHI', '18.5, 19.9, 11.5 and 9.4 his last four; Chicago implied for 30.0, and New Orleans allows the 9th-most TE points', 'start'],
  [6, 'Travis Kelce', 'KC', 'Full practice Wednesday (calf) after 31% of the snaps last week; Kansas City implied for 28.0, and Arizona allows the 7th-most TE points', 'start'],
  [7, 'Dalton Kincaid', 'BUF', 'If active. Did not practice Wednesday (thumb, ankle); 10.3 a game, Buffalo is implied for 31.0 and Miami allows the 4th-most TE points', 'start'],
  [8, 'Dallas Goedert', 'PHI', '5.9 targets a game and 81% of the snaps before the bye; 10.6 a game', 'start'],
  [9, 'Tyler Warren', 'IND', '22% target share, 7.0 targets a game, though 2.4 last week and Houston allows the 10th-fewest TE points', 'start'],
  [10, 'T.J. Hockenson', 'MIN', 'If active. Limited Wednesday (wrist) and has no Week 10 game in our data; 20% target share, and Jordan Addison is out', 'start'],
  [11, 'Sam LaPorta', 'DET', '5.9 targets a game and 79% of the snaps last week, though 2.6 points for it; Tampa Bay allows the 10th-most TE points', 'start'],
  [12, 'Chig Okonkwo', 'WAS', '7 and 8 targets the last two; Cincinnati allows the 8th-most TE points in a 53.5 total; TE12', 'start'],
  [13, 'Cade Otton', 'TB', '8 targets on 100% of the snaps before the bye and Detroit allows the most TE points, but 5.5 a game; TE13', 'sit'],
  [14, 'Dalton Schultz', 'HOU', '8.8 a game, 2 targets last week; TE14', 'sit'],
];

const DST_ROWS = [
  [1, 'Kansas City Chiefs', 'KC', 'Arizona implied for 12.5, the lowest on the slate, with Carson Beck at quarterback; 15 and 11 the last two', 'start'],
  [2, 'Buffalo Bills', 'BUF', 'Miami implied for 14.5 with Kyle McCord at quarterback; 21, 22 and 12 the last three', 'start'],
  [3, 'Houston Texans', 'HOU', 'Indianapolis implied for 15.5 Thursday; 13 and 6 the last two', 'start'],
  [4, 'Denver Broncos', 'DEN', 'Las Vegas implied for 15.25 with Fernando Mendoza at quarterback; 7.7 a game', 'start'],
  [5, 'Detroit Lions', 'DET', 'Tampa Bay implied for 18.25 and Baker Mayfield did not practice Wednesday; 13 and 18 the last two', 'start'],
  [6, 'Chicago Bears', 'CHI', 'New Orleans implied for 18.5 with 15 mph wind; 12 and 14 the last two', 'start'],
  [7, 'Minnesota Vikings', 'MIN', '14.2 a game, the best on the slate, and 24 last week, though San Francisco is implied for 24.75', 'start'],
  [8, 'Pittsburgh Steelers', 'PIT', 'Philadelphia implied for 16.5 with Jalen Hurts on IR; 9.3 a game despite -6 last week', 'start'],
];

const RULINGS = [
  [
    'C1',
    [
      ['Joe Burrow', 'QB', 'CIN', 'START', '33.2 last week and 25.8 a game; Cincinnati implied for 30.0 Monday, and Washington allows the 8th-most QB points.'],
    ],
  ],
  [
    'C2',
    [
      ['Josh Allen', 'QB', 'BUF', 'START', '24.8 a game on 7.3 carries; Buffalo implied for 31.0 as a 16.5-point favorite.'],
    ],
  ],
  [
    'C3',
    [
      ['Dak Prescott', 'QB', 'DAL', 'START', '34.4 last week, 20.2 a game; Dallas implied for 31.5, the highest on the slate, and Tennessee allows the 5th-most QB points.'],
    ],
  ],
  [
    'C4',
    [
      ['Patrick Mahomes', 'QB', 'KC', 'START', '35.4 last week, full practice Wednesday (elbow); Kansas City implied for 28.0, and Arizona allows the most QB points.'],
    ],
  ],
  [
    'C5',
    [
      ['C.J. Stroud', 'QB', 'HOU', 'START', '35.4 and 20.4 the last two, 20.5 a game; Houston implied for 28.0 Thursday.'],
    ],
  ],
  [
    'C6',
    [
      ['Trevor Lawrence', 'QB', 'JAX', 'START', '26.8 last week, 19.3 a game; Jacksonville implied for 26.25, and the Giants allow the 6th-most QB points.'],
    ],
  ],
  [
    'C7',
    [
      ['Jayden Daniels', 'QB', 'WAS', 'START', '20.8 last week on 11 carries, 19.4 a game; a 53.5 total Monday.'],
    ],
  ],
  [
    'C8',
    [
      ['Brock Purdy', 'QB', 'SF', 'START', '25.3 and 31.7 the last two, 22.6 a game; San Francisco implied for 24.75, though Minnesota allows the fewest QB points.'],
    ],
  ],
  [
    'C9',
    [
      ['Caleb Williams', 'QB', 'CHI', 'START', '18.4 a game with 5.2 carries; Chicago implied for 30.0 off the bye.'],
    ],
  ],
  [
    'C10',
    [
      ['Bo Nix', 'QB', 'DEN', 'START', 'Las Vegas allows the 4th-most QB points and Denver is implied for 25.25 off the bye; 19.3 and 15.7 his last two, 14.5 a game.'],
    ],
  ],
  [
    'C11',
    [
      ['Jared Goff', 'QB', 'DET', 'START', '20.4 last week, 18.6 a game; Detroit implied for 25.25 in a dome, though Tampa Bay allows the 3rd-fewest QB points.'],
    ],
  ],
  [
    'C12',
    [
      ['Kirk Cousins', 'QB', 'MIN', 'START', '15.4 on 100% of the snaps in his one Minnesota game last week; 18.8 a game on the season, most of it with Las Vegas; San Francisco allows the 16th-most QB points; QB12.'],
      ['Kyler Murray', 'QB', 'MIN', 'SIT', 'Did not practice Wednesday (hamstring) and is listed as out in our data.'],
    ],
  ],
  [
    'C13',
    [
      ['Cam Ward', 'QB', 'TEN', 'SIT', '26.3 and 19.1 the last two and Dallas allows the 3rd-most QB points in a 54.5 total, but 13.3 a game; QB13.'],
    ],
  ],
  [
    'C14',
    [
      ['Tyler Shough', 'QB', 'NO', 'SIT', '17.4 a game but 10.0 last week; New Orleans is implied for 18.5 with 15 mph wind in Chicago; QB14.'],
    ],
  ],
  [
    'C15',
    [
      ['Bryce Young', 'QB', 'CAR', 'SIT', '8.1 last week, 17.2 a game; full practice Wednesday (foot).'],
    ],
  ],
  [
    'C16',
    [
      ['Aaron Rodgers', 'QB', 'PIT', 'SIT', '14.9 a game; Pittsburgh implied for 21.0 in a 37.5 total, the lowest on the slate.'],
    ],
  ],
  [
    'C17',
    [
      ['Jacoby Brissett', 'QB', 'BAL', 'SIT', '13.7 a game, 11.8 last week; Baltimore implied for 20.5.'],
    ],
  ],
  [
    'C18',
    [
      ['Justin Herbert', 'QB', 'LAC', 'SIT', '16.3 last week on 7 carries but 10.9 a game; the Chargers are implied for 22.25.'],
    ],
  ],
  [
    'C19',
    [
      ['Geno Smith', 'QB', 'NYJ', 'SIT', 'Played 48% of the snaps last week for 5.9 and was limited Wednesday (ankle); he said he intends to play Sunday.'],
    ],
  ],
  [
    'C20',
    [
      ['Baker Mayfield', 'QB', 'TB', 'SIT', 'Did not practice Wednesday (foot); 8.5 a game, even though Detroit allows the 2nd-most QB points.'],
    ],
  ],
  [
    'C21',
    [
      ['Daniel Jones', 'QB', 'IND', 'SIT', '8.7 a game, 5.2 last week; Indianapolis implied for 15.5 as a 12.5-point underdog Thursday.'],
    ],
  ],
  [
    'C22',
    [
      ['J.J. McCarthy', 'QB', 'NYG', 'SIT', '17.1 last week on 6 carries, but 10.2 a game, and Jacksonville allows the 5th-fewest QB points.'],
    ],
  ],
  [
    'C23',
    [
      ['Fernando Mendoza', 'QB', 'LV', 'SIT', '13.9 on 100% of the snaps last week; Las Vegas is implied for 15.25.'],
    ],
  ],
  [
    'C24',
    [
      ['Kyle McCord', 'QB', 'MIA', 'SIT', '12.8 on 100% of the snaps last week with Malik Willis on IR; Miami is implied for 14.5.'],
    ],
  ],
  [
    'C25',
    [
      ['Carson Beck', 'QB', 'ARI', 'SIT', '0.4 on 100% of the snaps last week with Gardner Minshew II on IR; Arizona is implied for 12.5, the lowest on the slate.'],
    ],
  ],
  [
    'C26',
    [
      ['Joe Milton', 'QB', 'PHI', 'SIT', 'First on Philadelphia\'s depth chart with Jalen Hurts on IR; 13.2 on 9 carries before the bye, and Philadelphia is implied for 16.5.'],
    ],
  ],
  [
    'C27',
    [
      ['Jalen Hurts', 'QB', 'PHI', 'OUT', 'On IR and expected to miss the rest of the season; the engine still projects 14.8.'],
    ],
  ],
  [
    'C28',
    [
      ['Lamar Jackson', 'QB', 'BAL', 'OUT', 'On IR after right thumb surgery; the engine still projects 14.6.'],
    ],
  ],
  [
    'C29',
    [
      ['Malik Willis', 'QB', 'MIA', 'OUT', 'On IR (groin); the engine still projects 12.6.'],
    ],
  ],
  [
    'C30',
    [
      ['Jaxson Dart', 'QB', 'NYG', 'OUT', 'On IR; the engine still projects 13.5.'],
    ],
  ],
  [
    'C31',
    [
      ['Jahmyr Gibbs', 'RB', 'DET', 'START', '44.2 last week, 28.2 a game on 22.1 carries; Detroit implied for 25.25, though Tampa Bay allows the fewest RB points.'],
    ],
  ],
  [
    'C32',
    [
      ['Christian McCaffrey', 'RB', 'SF', 'START', 'Rest day Wednesday; 46.3 last week, 23.7 a game on a 19% target share.'],
      ['Kaelon Black', 'RB', 'SF', 'SIT', '11 carries on 40% of the snaps for 14.6 last week; the No. 2 behind McCaffrey.'],
    ],
  ],
  [
    'C33',
    [
      ['James Cook III', 'RB', 'BUF', 'START', '20.8 carries a game, 18.9 points a game; Buffalo implied for 31.0, and Miami allows the 9th-most RB points.'],
    ],
  ],
  [
    'C34',
    [
      ['Tony Pollard', 'RB', 'TEN', 'START', '23.9 last week on 9 targets after 36.5 and 28.7; Dallas allows the most RB points in a 54.5 total.'],
    ],
  ],
  [
    'C35',
    [
      ['D\'Andre Swift', 'RB', 'CHI', 'START', '17.2 carries a game; Chicago implied for 30.0, and New Orleans allows the 2nd-most RB points.'],
      ['Kyle Monangai', 'RB', 'CHI', 'SIT', 'Full practice Wednesday (toe) after last playing in Week 4; no role to trust in his first game back.'],
    ],
  ],
  [
    'C36',
    [
      ['Chuba Hubbard', 'RB', 'CAR', 'START', 'Rest day Wednesday; 34.2 last week on 27 carries and 84% of the snaps, 20.1 a game.'],
    ],
  ],
  [
    'C37',
    [
      ['Kenneth Walker III', 'RB', 'KC', 'START if active', 'Did not practice Wednesday (groin) and has no Week 10 game in our data; 24.5 a game on 19.9 carries, and Kansas City is implied for 28.0.'],
    ],
  ],
  [
    'C38',
    [
      ['Derrick Henry', 'RB', 'BAL', 'START', '18.5 carries a game and Carolina allows the 3rd-most RB points, though he played 55% of the snaps last week.'],
    ],
  ],
  [
    'C39',
    [
      ['Bucky Irving', 'RB', 'TB', 'START', '28.5 before the bye, 17.7 a game on 18.6 carries, though Detroit allows the 3rd-fewest RB points.'],
    ],
  ],
  [
    'C40',
    [
      ['Jonathan Taylor', 'RB', 'IND', 'START', '16.6 a game on 17.7 carries and a 13% target share; Indianapolis is implied for 15.5 Thursday, so the volume is the case.'],
    ],
  ],
  [
    'C41',
    [
      ['Javonte Williams', 'RB', 'DAL', 'START', '17.0 carries a game; Dallas implied for 31.5, the highest on the slate.'],
    ],
  ],
  [
    'C42',
    [
      ['Chase Brown', 'RB', 'CIN', 'START', '28.3 last week on 9 targets, 6.0 targets a game; Cincinnati implied for 30.0 Monday.'],
    ],
  ],
  [
    'C43',
    [
      ['Cam Skattebo', 'RB', 'NYG', 'FLEX', '27.2 last week on 18 carries and 89% of the snaps, full practice Wednesday (hamstring); Jacksonville allows the 6th-fewest RB points.'],
    ],
  ],
  [
    'C44',
    [
      ['Jonah Coleman', 'RB', 'DEN', 'FLEX', '17 carries on 77% of the snaps for 18.8 before the bye with RJ Harvey on IR; Las Vegas allows the 5th-most RB points.'],
      ['J.K. Dobbins', 'RB', 'DEN', 'SIT', '4 carries on 15% of the snaps before the bye.'],
    ],
  ],
  [
    'C45',
    [
      ['Emmett Johnson', 'RB', 'KC', 'FLEX', '22 carries and 7 targets on 88% of the snaps for 35.1 last week with Kenneth Walker III out; a start if Walker sits again, a risk if he plays.'],
    ],
  ],
  [
    'C46',
    [
      ['Bhayshul Tuten', 'RB', 'JAX', 'FLEX if active', 'Limited Wednesday (ankle, foot); 26 carries on 70% of the snaps for 20.3 last week, though the Giants allow the 5th-fewest RB points.'],
      ['Chris Rodriguez Jr.', 'RB', 'JAX', 'SIT', 'Limited Wednesday (hand); 4 carries on 14% of the snaps last week, next up if Tuten sits.'],
    ],
  ],
  [
    'C47',
    [
      ['Omarion Hampton', 'RB', 'LAC', 'FLEX', '22 carries on 63% of the snaps for 17.5 last week; the Jets allow the 8th-most RB points.'],
    ],
  ],
  [
    'C48',
    [
      ['Jaylen Warren', 'RB', 'PIT', 'FLEX', '16.7 a game, but 7 carries on 38% of the snaps last week; Philadelphia allows the 12th-fewest RB points.'],
      ['Rico Dowdle', 'RB', 'PIT', 'SIT', '5 carries on 49% of the snaps last week, more snaps than Warren.'],
    ],
  ],
  [
    'C49',
    [
      ['Ashton Jeanty', 'RB', 'LV', 'FLEX', '5.9 targets a game and 71% of the snaps last week, but 9 carries, and Las Vegas is implied for 15.25.'],
    ],
  ],
  [
    'C50',
    [
      ['Breece Hall', 'RB', 'NYJ', 'FLEX', '15 and 11 carries the last two weeks for 11.7 and 14.8; the Chargers allow the 12th-most RB points.'],
      ['Braelon Allen', 'RB', 'NYJ', 'SIT', '8 carries in each of the last two weeks for 5.4 and 5.6.'],
    ],
  ],
  [
    'C51',
    [
      ['Ollie Gordon II', 'RB', 'MIA', 'FLEX', '20 carries and 5 targets on 71% of the snaps last week; Buffalo allows the 10th-most RB points, though Miami is implied for 14.5.'],
    ],
  ],
  [
    'C52',
    [
      ['David Montgomery', 'RB', 'HOU', 'FLEX if active', 'Full practice (groin) with Woody Marks ruled out Thursday and Jawhar Jordan listed as out in our data; he last played in Week 5, but Houston is implied for 28.0 and Indianapolis allows the 6th-most RB points.'],
      ['Emari Demercado', 'RB', 'HOU', 'SIT', '7 carries on 33% of the snaps last week; next up behind Montgomery.'],
      ['Woody Marks', 'RB', 'HOU', 'OUT', 'Ruled out Thursday (concussion); the engine still projects 9.7.'],
    ],
  ],
  [
    'C53',
    [
      ['Saquon Barkley', 'RB', 'PHI', 'FLEX', 'Full practice Wednesday (hamstring); 13 carries in each of his last two games, on 59% of the snaps before the bye, though Philadelphia is implied for 16.5.'],
    ],
  ],
  [
    'C54',
    [
      ['Rachaad White', 'RB', 'WAS', 'FLEX', '11 carries on 52% of the snaps last week in a 53.5 total; Jacory Croskey-Merritt was designated to return from IR, so the role is not secure.'],
      ['Jacory Croskey-Merritt', 'RB', 'WAS', 'SIT', 'On IR and designated to return Tuesday (groin); not activated at writing.'],
    ],
  ],
  [
    'C55',
    [
      ['Travis Etienne Jr.', 'RB', 'NO', 'SIT', '8 carries and 5 targets on 33% of the snaps last week; New Orleans splits the work three ways.'],
      ['Alvin Kamara', 'RB', 'NO', 'SIT', 'Rest day Wednesday; 2 carries on 25% of the snaps last week.'],
      ['Audric Estime', 'RB', 'NO', 'SIT', '7 carries on 43% of the snaps for 2.1 last week.'],
    ],
  ],
  [
    'C56',
    [
      ['Aaron Jones Sr.', 'RB', 'MIN', 'SIT', '11 carries on 43% of the snaps last week; splits with Jordan Mason.'],
      ['Jordan Mason', 'RB', 'MIN', 'SIT', '16 carries on 54% of the snaps for 5.9 last week.'],
    ],
  ],
  [
    'C57',
    [
      ['Tyler Allgeier', 'RB', 'ARI', 'SIT', '5 carries on 46% of the snaps for 1.4 last week; Arizona is implied for 12.5, the lowest on the slate.'],
    ],
  ],
  [
    'C58',
    [
      ['Justice Hill', 'RB', 'BAL', 'SIT', '7 targets last week but 3 carries; the change-of-pace back behind Henry.'],
    ],
  ],
  [
    'C59',
    [
      ['Kenny Gainwell', 'RB', 'TB', 'SIT', '5 carries on 38% of the snaps before the bye; behind Irving.'],
    ],
  ],
  [
    'C60',
    [
      ['Seth McGowan', 'RB', 'IND', 'SIT', '12 carries on 29% of the snaps for 13.7 last week; behind Taylor.'],
    ],
  ],
  [
    'C61',
    [
      ['Tyjae Spears', 'RB', 'TEN', 'SIT', 'Did not practice Wednesday (knee); 4 carries last week behind Pollard.'],
    ],
  ],
  [
    'C62',
    [
      ['De\'Von Achane', 'RB', 'MIA', 'OUT', 'On IR (knee); the engine still projects 14.3.'],
    ],
  ],
  [
    'C63',
    [
      ['RJ Harvey', 'RB', 'DEN', 'OUT', 'On IR (knee); the engine still projects 12.3.'],
    ],
  ],
  [
    'C64',
    [
      ['James Conner', 'RB', 'ARI', 'OUT', 'On IR (foot); the engine still projects 10.2.'],
    ],
  ],
  [
    'C65',
    [
      ['Ja\'Marr Chase', 'WR', 'CIN', 'START', '34.1 last week on 14 targets after 31.1 and 31.5; Cincinnati implied for 30.0 Monday.'],
    ],
  ],
  [
    'C66',
    [
      ['CeeDee Lamb', 'WR', 'DAL', 'START', '33% target share and 12.1 targets a game; Tennessee allows the most WR points, and Dallas is implied for 31.5.'],
    ],
  ],
  [
    'C67',
    [
      ['Amon-Ra St. Brown', 'WR', 'DET', 'START', '25.8 last week, 20.4 a game on a 31% target share; Detroit implied for 25.25 in a dome.'],
    ],
  ],
  [
    'C68',
    [
      ['George Pickens', 'WR', 'DAL', 'START', '43.5 last week on 18 targets; Tennessee allows the most WR points in a 54.5 total.'],
    ],
  ],
  [
    'C69',
    [
      ['Tee Higgins', 'WR', 'CIN', 'START', '19.0 a game on a 22% target share; Cincinnati implied for 30.0, and Washington allows the 13th-most WR points.'],
    ],
  ],
  [
    'C70',
    [
      ['Nico Collins', 'WR', 'HOU', 'START', '16 targets for 24.4 last week; Houston implied for 28.0 Thursday with Marvin Harrison Jr. out and Jaylin Noel on IR.'],
    ],
  ],
  [
    'C71',
    [
      ['Justin Jefferson', 'WR', 'MIN', 'START', '13 targets last week and a 31% target share; San Francisco allows the 10th-most WR points, and Jordan Addison is out.'],
    ],
  ],
  [
    'C72',
    [
      ['Garrett Wilson', 'WR', 'NYJ', 'START', '14 targets for 15.6 last week on a 28% target share; the Chargers allow the 6th-most WR points.'],
    ],
  ],
  [
    'C73',
    [
      ['Malik Nabers', 'WR', 'NYG', 'START', '28% target share and 9.4 targets a game, though 9.3 and 7.4 the last two; Jacksonville allows the 14th-most WR points.'],
    ],
  ],
  [
    'C74',
    [
      ['Parker Washington', 'WR', 'JAX', 'START', '28.2 last week on 9 targets, 15.4 a game; Jacksonville implied for 26.25.'],
      ['Jakobi Meyers', 'WR', 'JAX', 'SIT', 'Limited Wednesday (ankle); 6.4 last week on 6 targets.'],
    ],
  ],
  [
    'C75',
    [
      ['Luther Burden III', 'WR', 'CHI', 'START if active', 'Full practice Wednesday (concussion); 17.5, 23.7, 18.6 and 20.7 his last four, and Chicago is implied for 30.0.'],
    ],
  ],
  [
    'C76',
    [
      ['Zay Flowers', 'WR', 'BAL', 'START', '29% target share, 7.9 targets a game and 88% of the snaps last week.'],
    ],
  ],
  [
    'C77',
    [
      ['Chris Olave', 'WR', 'NO', 'START', '27% target share and 9.7 targets a game, though 6.0 last week and Chicago allows the 8th-fewest WR points.'],
    ],
  ],
  [
    'C78',
    [
      ['Tetairoa McMillan', 'WR', 'CAR', 'START', '25% target share, 8.7 targets a game; Carolina implied for 23.0.'],
    ],
  ],
  [
    'C79',
    [
      ['Stefon Diggs', 'WR', 'WAS', 'FLEX', '20.3 last week on 10 targets, 13.8 a game; a 53.5 total Monday.'],
    ],
  ],
  [
    'C80',
    [
      ['Rashee Rice', 'WR', 'KC', 'FLEX', 'Full practice Wednesday (knee); 21% target share, and Kansas City is implied for 28.0, though he played 46% of the snaps last week.'],
    ],
  ],
  [
    'C81',
    [
      ['DK Metcalf', 'WR', 'PIT', 'FLEX', '15.4 last week on a 23% target share; Philadelphia allows the 3rd-most WR points.'],
    ],
  ],
  [
    'C82',
    [
      ['DeVonta Smith', 'WR', 'PHI', 'FLEX if active', 'Limited Wednesday (hamstring) and has not played since Week 6; 32% target share, 17.5 a game.'],
      ['Makai Lemon', 'WR', 'PHI', 'SIT', '9 targets in each of the last two games on 94% and 93% of the snaps, but 8.4 a game with Philadelphia implied for 16.5.'],
    ],
  ],
  [
    'C83',
    [
      ['Jameson Williams', 'WR', 'DET', 'FLEX', '12.7 a game; 7 targets last week on 79% of the snaps, and Detroit is implied for 25.25.'],
    ],
  ],
  [
    'C84',
    [
      ['Deebo Samuel Sr.', 'WR', 'SF', 'FLEX', '25.9 last week in his first game since Week 5, on 3 targets and 68% of the snaps.'],
      ['Mike Evans', 'WR', 'SF', 'SIT', 'Did not practice Wednesday (Achilles) and has not played since Week 6; his coach hopes he returns to practice Thursday.'],
      ['Keenan Allen', 'WR', 'SF', 'SIT', '7, 8 and 7 targets the last three, 11.1 last week on 48% of the snaps.'],
    ],
  ],
  [
    'C85',
    [
      ['Emeka Egbuka', 'WR', 'TB', 'FLEX', '24% target share, 7.7 targets a game, and Detroit allows the 12th-most WR points, though Baker Mayfield did not practice Wednesday.'],
    ],
  ],
  [
    'C86',
    [
      ['Ryan Flournoy', 'WR', 'DAL', 'FLEX', '19.1 last week on 7 targets and 81% of the snaps; Dallas implied for 31.5 against the defense that allows the most WR points.'],
    ],
  ],
  [
    'C87',
    [
      ['Carnell Tate', 'WR', 'TEN', 'FLEX if active', 'Limited Wednesday (shoulder) and has not played since Week 7; 27% target share, Wan\'Dale Robinson is on IR, and Dallas allows the 7th-most WR points.'],
      ['Elic Ayomanor', 'WR', 'TEN', 'SIT', '10 targets on 95% of the snaps for 12.9 last week; a flex only if Tate sits.'],
    ],
  ],
  [
    'C88',
    [
      ['Jordyn Tyson', 'WR', 'NO', 'FLEX if active', 'Limited Wednesday (chest); 13 targets for 19.0 last week on 71% of the snaps.'],
    ],
  ],
  [
    'C89',
    [
      ['Courtland Sutton', 'WR', 'DEN', 'FLEX', '9 targets for 15.5 before the bye; limited Wednesday for rest, and Las Vegas allows the 9th-most WR points.'],
      ['Jaylen Waddle', 'WR', 'DEN', 'SIT', 'Full practice Wednesday (concussion); 1 target on 19% of the snaps before the bye.'],
    ],
  ],
  [
    'C90',
    [
      ['Rome Odunze', 'WR', 'CHI', 'FLEX', '16.0 on 7 targets and 84% of the snaps before the bye; Chicago implied for 30.0.'],
    ],
  ],
  [
    'C91',
    [
      ['DJ Moore', 'WR', 'BUF', 'FLEX', '19.4 last week and Buffalo is implied for 31.0, though Miami allows the 3rd-fewest WR points and he played 58% of the snaps.'],
    ],
  ],
  [
    'C92',
    [
      ['Xavier Hutchinson', 'WR', 'HOU', 'FLEX', '9 targets for 15.8 last week on 76% of the snaps; Marvin Harrison Jr. is out Thursday and Jaylin Noel is on IR.'],
      ['Tank Dell', 'WR', 'HOU', 'SIT', '4 targets on 49% of the snaps last week; full practice (hand).'],
    ],
  ],
  [
    'C93',
    [
      ['Omar Cooper Jr.', 'WR', 'NYJ', 'FLEX if active', 'Did not practice Wednesday (ankle) and has no Week 10 game in our data; 22.3, 22.5 and 13.8 his last three, and the Chargers allow the 6th-most WR points.'],
      ['Adonai Mitchell', 'WR', 'NYJ', 'SIT', '8 targets on 87% of the snaps for 8.9 last week; a flex only if Cooper sits.'],
    ],
  ],
  [
    'C94',
    [
      ['Caleb Douglas', 'WR', 'MIA', 'FLEX if active', 'Limited Wednesday (shoulder); 8 targets in each of the last two games on a 23% target share, though Miami is implied for 14.5.'],
    ],
  ],
  [
    'C95',
    [
      ['Josh Downs', 'WR', 'KC', 'SIT', '15.3 last week on 17% of the snaps.'],
    ],
  ],
  [
    'C96',
    [
      ['Khalil Shakir', 'WR', 'BUF', 'SIT', '3 targets last week, 5.0 targets a game.'],
    ],
  ],
  [
    'C97',
    [
      ['Malik Washington', 'WR', 'MIA', 'SIT', '3 targets in each of the last two games.'],
    ],
  ],
  [
    'C98',
    [
      ['Tre Tucker', 'WR', 'LV', 'SIT', '2 targets for 1.9 last week; Las Vegas is implied for 15.25.'],
    ],
  ],
  [
    'C99',
    [
      ['Jalen Coker', 'WR', 'CAR', 'SIT', '0.3 last week on 4 targets.'],
    ],
  ],
  [
    'C100',
    [
      ['Germie Bernard', 'WR', 'PIT', 'SIT', '1.0 last week on 3 targets.'],
    ],
  ],
  [
    'C101',
    [
      ['Ladd McConkey', 'WR', 'LAC', 'SIT', 'Limited Wednesday (back) and has not played since Week 8.'],
    ],
  ],
  [
    'C102',
    [
      ['Xavier Worthy', 'WR', 'KC', 'SIT', '0.0 last week on 3 targets.'],
    ],
  ],
  [
    'C103',
    [
      ['Devaughn Vele', 'WR', 'NO', 'SIT', '3.7 and 3.4 the last two.'],
    ],
  ],
  [
    'C104',
    [
      ['Antonio Williams', 'WR', 'WAS', 'SIT', '2 targets last week.'],
    ],
  ],
  [
    'C105',
    [
      ['Jordan Addison', 'WR', 'MIN', 'OUT', 'Thumb surgery this week and did not practice Wednesday; the engine still projects 8.3.'],
    ],
  ],
  [
    'C106',
    [
      ['Marvin Harrison Jr.', 'WR', 'HOU', 'OUT', 'Ruled out Thursday (hamstring); the engine still projects 6.9.'],
    ],
  ],
  [
    'C107',
    [
      ['Michael Wilson', 'WR', 'ARI', 'OUT', 'On IR (neck); the engine still projects 12.1.'],
    ],
  ],
  [
    'C108',
    [
      ['Wan\'Dale Robinson', 'WR', 'TEN', 'OUT', 'On IR and out for the season (ankle); the engine still projects 10.6.'],
    ],
  ],
  [
    'C109',
    [
      ['Terry McLaurin', 'WR', 'WAS', 'OUT', 'On IR after knee surgery; the engine still projects 9.4.'],
    ],
  ],
  [
    'C110',
    [
      ['Alec Pierce', 'WR', 'IND', 'OUT', 'On IR (heel); the engine still projects 9.7.'],
    ],
  ],
  [
    'C111',
    [
      ['Trey McBride', 'TE', 'ARI', 'START', '28% target share, 9.9 targets a game; Arizona\'s top target with Michael Wilson on IR, though Arizona is implied for 12.5.'],
    ],
  ],
  [
    'C112',
    [
      ['Brock Bowers', 'TE', 'LV', 'START if active', 'Did not practice Wednesday (ankle) after 19% of the snaps last week, and his coach said he does not need to practice to play Sunday; 26% target share, 18.7 a game.'],
      ['Michael Mayer', 'TE', 'LV', 'SIT', '3 targets on 83% of the snaps last week; a start only if Bowers sits.'],
    ],
  ],
  [
    'C113',
    [
      ['Isaiah Likely', 'TE', 'NYG', 'START', '27.7 last week on 11 targets, 27% target share, though Jacksonville allows the 5th-fewest TE points.'],
    ],
  ],
  [
    'C114',
    [
      ['George Kittle', 'TE', 'SF', 'START', '9 targets on 94% of the snaps last week, 14.3 a game, though Minnesota allows the fewest TE points.'],
    ],
  ],
  [
    'C115',
    [
      ['Colston Loveland', 'TE', 'CHI', 'START', '18.5, 19.9, 11.5 and 9.4 his last four; Chicago implied for 30.0, and New Orleans allows the 9th-most TE points.'],
    ],
  ],
  [
    'C116',
    [
      ['Travis Kelce', 'TE', 'KC', 'START', 'Full practice Wednesday (calf) after 31% of the snaps last week; Kansas City implied for 28.0, and Arizona allows the 7th-most TE points.'],
    ],
  ],
  [
    'C117',
    [
      ['Dalton Kincaid', 'TE', 'BUF', 'START if active', 'Did not practice Wednesday (thumb, ankle); 10.3 a game, Buffalo is implied for 31.0 and Miami allows the 4th-most TE points.'],
    ],
  ],
  [
    'C118',
    [
      ['Dallas Goedert', 'TE', 'PHI', 'START', '5.9 targets a game and 81% of the snaps before the bye; 10.6 a game.'],
    ],
  ],
  [
    'C119',
    [
      ['Tyler Warren', 'TE', 'IND', 'START', '22% target share, 7.0 targets a game, though 2.4 last week and Houston allows the 10th-fewest TE points.'],
    ],
  ],
  [
    'C120',
    [
      ['T.J. Hockenson', 'TE', 'MIN', 'START if active', 'Limited Wednesday (wrist) and has no Week 10 game in our data; 20% target share, and Jordan Addison is out.'],
    ],
  ],
  [
    'C121',
    [
      ['Sam LaPorta', 'TE', 'DET', 'START', '5.9 targets a game and 79% of the snaps last week, though 2.6 points for it; Tampa Bay allows the 10th-most TE points.'],
    ],
  ],
  [
    'C122',
    [
      ['Chig Okonkwo', 'TE', 'WAS', 'START', '7 and 8 targets the last two; Cincinnati allows the 8th-most TE points in a 53.5 total; TE12.'],
    ],
  ],
  [
    'C123',
    [
      ['Cade Otton', 'TE', 'TB', 'SIT', '8 targets on 100% of the snaps before the bye and Detroit allows the most TE points, but 5.5 a game; TE13.'],
    ],
  ],
  [
    'C124',
    [
      ['Dalton Schultz', 'TE', 'HOU', 'SIT', '8.8 a game, 2 targets last week; TE14.'],
    ],
  ],
  [
    'C125',
    [
      ['Mark Andrews', 'TE', 'BAL', 'SIT', '16.2 last week on 8 targets after 5.3, 4.4 and 3.9.'],
    ],
  ],
  [
    'C126',
    [
      ['Mike Gesicki', 'TE', 'CIN', 'SIT', 'Washington allows the 2nd-most TE points, but 2 targets in each of the last two games on under half the snaps.'],
    ],
  ],
  [
    'C127',
    [
      ['Brenton Strange', 'TE', 'JAX', 'SIT', '3 targets last week, 8.9 a game.'],
    ],
  ],
  [
    'C128',
    [
      ['Darren Waller', 'TE', 'CAR', 'SIT', 'Did not practice Wednesday (knee), and his coach called it a concern.'],
      ['Tommy Tremble', 'TE', 'CAR', 'SIT', 'Did not practice Wednesday (knee).'],
    ],
  ],
  [
    'C129',
    [
      ['Pat Freiermuth', 'TE', 'PIT', 'SIT', '3 targets last week on 54% of the snaps; Philadelphia allows the 3rd-fewest TE points.'],
    ],
  ],
  [
    'C130',
    [
      ['Juwan Johnson', 'TE', 'NO', 'SIT', '4.8 last week on 3 targets.'],
    ],
  ],
  [
    'C131',
    [
      ['Jake Ferguson', 'TE', 'DAL', 'OUT', 'Did not practice Wednesday (knee, ankle) and will not play Sunday; the engine still projects 7.1.'],
    ],
  ],
  [
    'C132',
    [
      ['Kansas City Chiefs', 'DEF', 'KC', 'START', 'Arizona implied for 12.5, the lowest on the slate, with Carson Beck at quarterback; 15 and 11 the last two.'],
    ],
  ],
  [
    'C133',
    [
      ['Buffalo Bills', 'DEF', 'BUF', 'START', 'Miami implied for 14.5 with Kyle McCord at quarterback; 21, 22 and 12 the last three.'],
    ],
  ],
  [
    'C134',
    [
      ['Houston Texans', 'DEF', 'HOU', 'START', 'Indianapolis implied for 15.5 Thursday; 13 and 6 the last two.'],
    ],
  ],
  [
    'C135',
    [
      ['Denver Broncos', 'DEF', 'DEN', 'START', 'Las Vegas implied for 15.25 with Fernando Mendoza at quarterback; 7.7 a game.'],
    ],
  ],
  [
    'C136',
    [
      ['Detroit Lions', 'DEF', 'DET', 'START', 'Tampa Bay implied for 18.25 and Baker Mayfield did not practice Wednesday; 13 and 18 the last two.'],
    ],
  ],
  [
    'C137',
    [
      ['Chicago Bears', 'DEF', 'CHI', 'START', 'New Orleans implied for 18.5 with 15 mph wind; 12 and 14 the last two.'],
    ],
  ],
  [
    'C138',
    [
      ['Minnesota Vikings', 'DEF', 'MIN', 'START', '14.2 a game, the best on the slate, and 24 last week, though San Francisco is implied for 24.75.'],
    ],
  ],
  [
    'C139',
    [
      ['Pittsburgh Steelers', 'DEF', 'PIT', 'START', 'Philadelphia implied for 16.5 with Jalen Hurts on IR; 9.3 a game despite -6 last week.'],
    ],
  ],
];

const DST_TABLE = [
  ['Kansas City Chiefs', 'vs ARI', '12.5', 'START (DST1)', 'Arizona implied for 12.5, the lowest on the slate, with Carson Beck at quarterback; 15 and 11 the last two.'],
  ['Buffalo Bills', 'vs MIA', '14.5', 'START (DST2)', 'Miami implied for 14.5 with Kyle McCord at quarterback; 21, 22 and 12 the last three.'],
  ['Houston Texans', 'vs IND', '15.5', 'START (DST3)', 'Indianapolis implied for 15.5 Thursday; 13 and 6 the last two.'],
  ['Denver Broncos', 'vs LV', '15.25', 'START (DST4)', 'Las Vegas implied for 15.25 with Fernando Mendoza at quarterback; 7.7 a game.'],
  ['Detroit Lions', 'vs TB', '18.25', 'START (DST5)', 'Tampa Bay implied for 18.25 and Baker Mayfield did not practice Wednesday; 13 and 18 the last two.'],
  ['Chicago Bears', 'vs NO', '18.5', 'START (DST6)', 'New Orleans implied for 18.5 with 15 mph wind; 12 and 14 the last two.'],
  ['Minnesota Vikings', 'at SF', '24.75', 'START (DST7)', '14.2 a game, the best on the slate, and 24 last week, though San Francisco is implied for 24.75.'],
  ['Pittsburgh Steelers', 'at PHI', '16.5', 'START (DST8)', 'Philadelphia implied for 16.5 with Jalen Hurts on IR; 9.3 a game despite -6 last week.'],
];

const INJ_OUT = [
  ['Jalen Hurts', 'QB', 'PHI', 'On IR and expected to miss the rest of the season; the engine still projects 14.8.', 'Joe Milton (SIT) is first on the depth chart.', 'out', 'C27'],
  ['Lamar Jackson', 'QB', 'BAL', 'On IR after right thumb surgery; the engine still projects 14.6.', 'Jacoby Brissett (SIT).', 'out', 'C28'],
  ['Malik Willis', 'QB', 'MIA', 'On IR (groin); the engine still projects 12.6.', 'Kyle McCord (SIT).', 'out', 'C29'],
  ['Jaxson Dart', 'QB', 'NYG', 'On IR; the engine still projects 13.5.', 'J.J. McCarthy (SIT).', 'out', 'C30'],
  ['Woody Marks', 'RB', 'HOU', 'Ruled out Thursday (concussion); the engine still projects 9.7.', 'David Montgomery (FLEX if active, RB22) and Emari Demercado (SIT).', 'out', 'C52'],
  ['De\'Von Achane', 'RB', 'MIA', 'On IR (knee); the engine still projects 14.3.', 'Ollie Gordon II (FLEX, RB21).', 'out', 'C62'],
  ['RJ Harvey', 'RB', 'DEN', 'On IR (knee); the engine still projects 12.3.', 'Jonah Coleman (FLEX, RB14).', 'out', 'C63'],
  ['James Conner', 'RB', 'ARI', 'On IR (foot); the engine still projects 10.2.', 'Tyler Allgeier (SIT).', 'out', 'C64'],
  ['Jordan Addison', 'WR', 'MIN', 'Thumb surgery this week and did not practice Wednesday; the engine still projects 8.3.', 'Justin Jefferson (START, WR7).', 'out', 'C105'],
  ['Marvin Harrison Jr.', 'WR', 'HOU', 'Ruled out Thursday (hamstring); the engine still projects 6.9.', 'Nico Collins (START, WR6) and Xavier Hutchinson (FLEX, WR28).', 'out', 'C106'],
  ['Michael Wilson', 'WR', 'ARI', 'On IR (neck); the engine still projects 12.1.', 'No other Arizona receiver has a call.', 'out', 'C107'],
  ['Wan\'Dale Robinson', 'WR', 'TEN', 'On IR and out for the season (ankle); the engine still projects 10.6.', 'Carnell Tate (FLEX if active, WR23).', 'out', 'C108'],
  ['Terry McLaurin', 'WR', 'WAS', 'On IR after knee surgery; the engine still projects 9.4.', 'Stefon Diggs (FLEX, WR15).', 'out', 'C109'],
  ['Alec Pierce', 'WR', 'IND', 'On IR (heel); the engine still projects 9.7.', 'No other Indianapolis receiver has a call.', 'out', 'C110'],
  ['Jake Ferguson', 'TE', 'DAL', 'Did not practice Wednesday (knee, ankle) and will not play Sunday; the engine still projects 7.1.', 'No other Dallas tight end has a call.', 'out', 'C131'],
];

const INJ_THU = [
  ['David Montgomery', 'RB', 'HOU', 'Full practice (groin) with Woody Marks ruled out Thursday and Jawhar Jordan listed as out in our data; he last played in Week 5, but Houston is implied for 28.0 and Indianapolis allows the 6th-most RB points.', 'Emari Demercado (SIT). Carry a back who kicks off at 1:00p or later.', 'gtd', 'C52'],
];

const INJ_INTL = [];

const INJ_ONE = [
  ['Kenneth Walker III', 'RB', 'KC', 'Did not practice Wednesday (groin) and has no Week 10 game in our data; 24.5 a game on 19.9 carries, and Kansas City is implied for 28.0.', 'Emmett Johnson (FLEX, RB15). Carry a back who kicks off at 4:05p or later.', 'gtd', 'C37'],
  ['Luther Burden III', 'WR', 'CHI', 'Full practice Wednesday (concussion); 17.5, 23.7, 18.6 and 20.7 his last four, and Chicago is implied for 30.0.', 'Rome Odunze (FLEX, WR26). Carry a receiver who kicks off at 4:05p or later.', 'gtd', 'C75'],
  ['DeVonta Smith', 'WR', 'PHI', 'Limited Wednesday (hamstring) and has not played since Week 6; 32% target share, 17.5 a game.', 'Makai Lemon (SIT, WR31). Carry a receiver who kicks off at 4:05p or later.', 'gtd', 'C82'],
  ['Carnell Tate', 'WR', 'TEN', 'Limited Wednesday (shoulder) and has not played since Week 7; 27% target share, Wan\'Dale Robinson is on IR, and Dallas allows the 7th-most WR points.', 'Elic Ayomanor (SIT, WR33), a flex only if Tate sits. Carry a receiver who kicks off at 4:05p or later.', 'gtd', 'C87'],
  ['Jordyn Tyson', 'WR', 'NO', 'Limited Wednesday (chest); 13 targets for 19.0 last week on 71% of the snaps.', 'Chris Olave (START, WR13). Carry a receiver who kicks off at 4:05p or later.', 'gtd', 'C88'],
  ['Caleb Douglas', 'WR', 'MIA', 'Limited Wednesday (shoulder); 8 targets in each of the last two games on a 23% target share, though Miami is implied for 14.5.', 'Malik Washington (SIT). Carry a receiver who kicks off at 4:05p or later.', 'gtd', 'C94'],
  ['Dalton Kincaid', 'TE', 'BUF', 'Did not practice Wednesday (thumb, ankle); 10.3 a game, Buffalo is implied for 31.0 and Miami allows the 4th-most TE points.', 'No other Buffalo tight end has a call. Carry a tight end who kicks off at 4:05p or later.', 'gtd', 'C117'],
  ['Baker Mayfield', 'QB', 'TB', 'Did not practice Wednesday (foot); 8.5 a game, even though Detroit allows the 2nd-most QB points.', 'No other Tampa Bay quarterback has a call.', 'sit', 'C20'],
  ['Kyle Monangai', 'RB', 'CHI', 'Full practice Wednesday (toe) after last playing in Week 4; no role to trust in his first game back.', 'D\'Andre Swift (START, RB5). Carry a back who kicks off at 4:05p or later.', 'sit', 'C35'],
  ['Tyjae Spears', 'RB', 'TEN', 'Did not practice Wednesday (knee); 4 carries last week behind Pollard.', 'Tony Pollard (START, RB4). Carry a back who kicks off at 4:05p or later.', 'sit', 'C61'],
  ['Darren Waller', 'TE', 'CAR', 'Did not practice Wednesday (knee), and his coach called it a concern.', 'Tommy Tremble (SIT). Carry a tight end who kicks off at 4:05p or later.', 'sit', 'C128'],
  ['Tommy Tremble', 'TE', 'CAR', 'Did not practice Wednesday (knee).', 'Darren Waller (SIT). Carry a tight end who kicks off at 4:05p or later.', 'sit', 'C128'],
];

const INJ_LATE = [
  ['Bhayshul Tuten', 'RB', 'JAX', 'Limited Wednesday (ankle, foot); 26 carries on 70% of the snaps for 20.3 last week, though the Giants allow the 5th-fewest RB points.', 'Chris Rodriguez Jr. (SIT). Carry a back who kicks off Sunday night or Monday.', 'gtd', 'C46'],
  ['Omar Cooper Jr.', 'WR', 'NYJ', 'Did not practice Wednesday (ankle) and has no Week 10 game in our data; 22.3, 22.5 and 13.8 his last three, and the Chargers allow the 6th-most WR points.', 'Adonai Mitchell (SIT), a flex only if Cooper sits. Carry a receiver who kicks off Sunday night or Monday.', 'gtd', 'C93'],
  ['Brock Bowers', 'TE', 'LV', 'Did not practice Wednesday (ankle) after 19% of the snaps last week, and his coach said he does not need to practice to play Sunday; 26% target share, 18.7 a game.', 'Michael Mayer (SIT), a start only if Bowers sits. Carry a tight end who kicks off Sunday night or Monday.', 'gtd', 'C112'],
  ['Geno Smith', 'QB', 'NYJ', 'Played 48% of the snaps last week for 5.9 and was limited Wednesday (ankle); he said he intends to play Sunday.', 'No other Jets quarterback has a call.', 'sit', 'C19'],
  ['Chris Rodriguez Jr.', 'RB', 'JAX', 'Limited Wednesday (hand); 4 carries on 14% of the snaps last week, next up if Tuten sits.', 'Bhayshul Tuten (FLEX if active, RB16). Carry a back who kicks off Sunday night or Monday.', 'sit', 'C46'],
  ['Jakobi Meyers', 'WR', 'JAX', 'Limited Wednesday (ankle); 6.4 last week on 6 targets.', 'Parker Washington (START, WR10). Carry a receiver who kicks off Sunday night or Monday.', 'sit', 'C74'],
  ['Jaylen Waddle', 'WR', 'DEN', 'Full practice Wednesday (concussion); 1 target on 19% of the snaps before the bye.', 'Courtland Sutton (FLEX, WR25). Carry a receiver who kicks off Sunday night or Monday.', 'sit', 'C89'],
  ['Ladd McConkey', 'WR', 'LAC', 'Limited Wednesday (back) and has not played since Week 8.', 'No other Chargers receiver has a call. Carry a receiver who kicks off Sunday night or Monday.', 'sit', 'C101'],
];

const INJ_NIGHT = [
  ['T.J. Hockenson', 'TE', 'MIN', 'Limited Wednesday (wrist) and has no Week 10 game in our data; 20% target share, and Jordan Addison is out.', 'No other Minnesota tight end has a call. Carry a tight end who kicks off Monday.', 'gtd', 'C120'],
  ['Kyler Murray', 'QB', 'MIN', 'Did not practice Wednesday (hamstring) and is listed as out in our data.', 'Kirk Cousins (START, QB12).', 'sit', 'C12'],
  ['Mike Evans', 'WR', 'SF', 'Did not practice Wednesday (Achilles) and has not played since Week 6; his coach hopes he returns to practice Thursday.', 'Deebo Samuel Sr. (FLEX, WR20). Carry a receiver who kicks off Monday.', 'sit', 'C84'],
];

const INJ_MNF = [
  ['Jacory Croskey-Merritt', 'RB', 'WAS', 'On IR and designated to return Tuesday (groin); not activated at writing.', 'Rachaad White (FLEX, RB24).', 'sit', 'C54'],
];

const SLOT = (slot) => GAMES.filter((g) => g.slot === slot).map((g) => <GameCard key={g.id} g={g} />);

const QB_NEXT = 'Sits and unranked: Kyler Murray, Bryce Young, Aaron Rodgers, Jacoby Brissett, Justin Herbert, Geno Smith, Baker Mayfield, Daniel Jones, J.J. McCarthy, Fernando Mendoza, Kyle McCord, Carson Beck and Joe Milton. Out: Jalen Hurts (14.8), Lamar Jackson (14.6), Malik Willis (12.6) and Jaxson Dart (13.5). Cam Ward (QB13) and Tyler Shough (QB14) are ranked with sit rulings.';
const RB_NEXT = 'Sits: Alvin Kamara, Audric Estime, Tyler Allgeier, Justice Hill, Kenny Gainwell, Seth McGowan, Tyjae Spears, Jacory Croskey-Merritt, and the handcuffs Kaelon Black, Kyle Monangai, J.K. Dobbins, Chris Rodriguez Jr., Rico Dowdle, Braelon Allen and Emari Demercado. Out: Woody Marks (9.7), De\'Von Achane (14.3), RJ Harvey (12.3) and James Conner (10.2). Travis Etienne Jr. (RB25), Aaron Jones Sr. (RB26) and Jordan Mason (RB27) are ranked with sit rulings.';
const WR_NEXT = 'Sits: Jakobi Meyers, Mike Evans, Jaylen Waddle, Tank Dell, Adonai Mitchell, Josh Downs, Khalil Shakir, Malik Washington, Tre Tucker, Jalen Coker, Germie Bernard, Ladd McConkey, Xavier Worthy, Devaughn Vele and Antonio Williams. Out: Jordan Addison (8.3), Marvin Harrison Jr. (6.9), Michael Wilson (12.1), Wan\'Dale Robinson (10.6), Terry McLaurin (9.4) and Alec Pierce (9.7). Makai Lemon (WR31), Keenan Allen (WR32) and Elic Ayomanor (WR33) are ranked with sit rulings.';
const TE_NEXT = 'Sits: Michael Mayer, Mark Andrews, Mike Gesicki, Brenton Strange, Darren Waller, Tommy Tremble, Pat Freiermuth and Juwan Johnson. Out: Jake Ferguson. Cade Otton (TE13) and Dalton Schultz (TE14) are ranked with sit rulings.';
const DST_TIER_NEXT = 'Every D/ST in the top eight has a ruling. Jacksonville faces the Giants at 20.25 and has 10.1 a game, so it is the next one up if yours is gone.';

const ALREADY_OUT = ['Jawhar Jordan (HOU RB, listed out)', 'Jaylin Noel (HOU WR, IR)', 'Brevin Jordan (HOU TE, out Thursday)', 'Will Mallory (IND TE, out Thursday)', 'Gardner Minshew II (ARI QB, IR)', 'Jeremiyah Love (ARI RB, IR)', 'Kendrick Bourne (ARI WR, IR)', 'Tyler Huntley (BAL QB, IR)', 'Tyquan Thornton (KC WR, IR)', 'Cole Kmet (CHI TE, IR)', 'Tank Bigsby (PHI RB, IR)', 'Erick All Jr. (CIN TE, IR)', 'Jeremy McNichols (WAS RB, out for the season)', 'Tyrone Tracy Jr. (NYG RB, IR)', 'Tyler Goodson (DAL RB, IR)', 'Ricky Pearsall (SF WR, IR)'];

// Handcuff rows are [team, starter and status, handcuff, verdict].

const HANDCUFFS = [
  ['HOU', 'Woody Marks: ruled out Thursday. Jawhar Jordan: listed as out in our data. David Montgomery: full practice (groin), last played in Week 5.', 'Emari Demercado', 'SIT. 7 carries on 33% of the snaps last week; next up behind Montgomery.'],
  ['KC', 'Kenneth Walker III: did not practice Wednesday (groin), no Week 10 game in our data.', 'Emmett Johnson', 'FLEX, RB15. 22 carries and 7 targets on 88% of the snaps for 35.1 last week with Kenneth Walker III out; a start if Walker sits again, a risk if he plays.'],
  ['SF', 'Christian McCaffrey: rest day Wednesday.', 'Kaelon Black', 'SIT. 11 carries on 40% of the snaps for 14.6 last week; the No. 2 behind McCaffrey.'],
  ['JAX', 'Bhayshul Tuten: limited Wednesday (ankle, foot).', 'Chris Rodriguez Jr.', 'SIT. Limited Wednesday (hand); 4 carries on 14% of the snaps last week, next up if Tuten sits.'],
  ['CHI', 'D\'Andre Swift: a start.', 'Kyle Monangai', 'SIT. Full practice Wednesday (toe) after last playing in Week 4; no role to trust in his first game back.'],
  ['DEN', 'RJ Harvey: on IR (knee).', 'Jonah Coleman', 'FLEX, RB14. 17 carries on 77% of the snaps for 18.8 before the bye with RJ Harvey on IR; Las Vegas allows the 5th-most RB points. J.K. Dobbins is a sit.'],
  ['PIT', 'Jaylen Warren: 38% of the snaps last week.', 'Rico Dowdle', 'SIT. 5 carries on 49% of the snaps last week, more snaps than Warren.'],
  ['NYJ', 'Breece Hall: a flex.', 'Braelon Allen', 'SIT. 8 carries in each of the last two weeks for 5.4 and 5.6.'],
  ['WAS', 'Jacory Croskey-Merritt: on IR, designated to return Tuesday.', 'Rachaad White', 'FLEX, RB24. 11 carries on 52% of the snaps last week in a 53.5 total; Jacory Croskey-Merritt was designated to return from IR, so the role is not secure.'],
  ['MIA', 'De\'Von Achane: on IR (knee).', 'Ollie Gordon II', 'FLEX, RB21. 20 carries and 5 targets on 71% of the snaps last week; Buffalo allows the 10th-most RB points, though Miami is implied for 14.5.'],
  ['NO', 'Travis Etienne Jr.: a sit. Alvin Kamara: rest day Wednesday.', 'Audric Estime', 'SIT. 7 carries on 43% of the snaps for 2.1 last week.'],
  ['MIN', 'Aaron Jones Sr.: a sit.', 'Jordan Mason', 'SIT, RB27. 16 carries on 54% of the snaps for 5.9 last week.'],
  ['TEN', 'Tony Pollard: a start.', 'Tyjae Spears', 'SIT. Did not practice Wednesday (knee); 4 carries last week behind Pollard.'],
  ['BAL', 'Derrick Henry: a start.', 'Justice Hill', 'SIT. 7 targets last week but 3 carries; the change-of-pace back behind Henry.'],
  ['IND', 'Jonathan Taylor: a start.', 'Seth McGowan', 'SIT. 12 carries on 29% of the snaps for 13.7 last week; behind Taylor.'],
  ['TB', 'Bucky Irving: a start.', 'Kenny Gainwell', 'SIT. 5 carries on 38% of the snaps before the bye; behind Irving.'],
];

// IDP rows are [player, team, position, opponent, note].

const IDP_TABLE = [
  ['Will Anderson Jr.', 'HOU', 'DE', 'vs IND (Thursday)', '9.9 a game, 10.0 and 10.0 the last two'],
  ['Devin Lloyd', 'CAR', 'LB', 'vs BAL', '11.5 a game, 14.0 last week'],
  ['Arvell Reese', 'NYG', 'LB', 'vs JAX', '11.4 a game, 25.0 and 8.5 the last two'],
  ['Nakobe Dean', 'LV', 'LB', 'at DEN', '10.8 a game, 13.5 and 9.5 the last two'],
  ['Kaden Elliss', 'NO', 'LB', 'at CHI', '10.8 a game, 17.5 and 16.5 the last two'],
  ['Alex Singleton', 'DEN', 'LB', 'vs LV', '10.6 a game, 15.0 and 20.5 two and three games back'],
  ['Payton Wilson', 'PIT', 'LB', 'at PHI', '9.9 a game, 14.0 last week'],
  ['Foyesade Oluokun', 'JAX', 'LB', 'at NYG', '9.7 a game, 12.0, 10.5 and 10.5 the last three'],
];

const IDP_AVOID = 'Blake Cashman practiced in full Wednesday but is still listed with a concussion, so check his status. Amani Hooker (knee) and Andrew Van Ginkel (quadriceps) were limited, Zack Baun (back) and Bobby Okereke (foot) did not practice, and Tremaine Edmunds is on IR.';

const SLEEPERS = [
  ['Jonah Coleman', 'FLEX, RB14. 17 carries on 77% of the snaps for 18.8 before the bye with RJ Harvey on IR; Las Vegas allows the 5th-most RB points.', 'RB'],
  ['Emmett Johnson', 'FLEX, RB15. 22 carries and 7 targets on 88% of the snaps for 35.1 last week with Kenneth Walker III out; a start if Walker sits again, a risk if he plays.', 'RB'],
  ['Xavier Hutchinson', 'FLEX, WR28. 9 targets for 15.8 last week on 76% of the snaps; Marvin Harrison Jr. is out Thursday and Jaylin Noel is on IR.', 'WR'],
  ['Jordyn Tyson', 'FLEX if active, WR24. Limited Wednesday (chest); 13 targets for 19.0 last week on 71% of the snaps.', 'WR'],
  ['Chig Okonkwo', 'START, TE12. 7 and 8 targets the last two; Cincinnati allows the 8th-most TE points in a 53.5 total; TE12.', 'TE'],
];

const FADES = [
  ['Cam Ward', 'SIT, QB13. 26.3 and 19.1 the last two and Dallas allows the 3rd-most QB points in a 54.5 total, but 13.3 a game; QB13.', 'QB'],
  ['Baker Mayfield', 'SIT. Did not practice Wednesday (foot); 8.5 a game, even though Detroit allows the 2nd-most QB points.', 'QB'],
  ['Tyler Allgeier', 'SIT. 5 carries on 46% of the snaps for 1.4 last week; Arizona is implied for 12.5, the lowest on the slate.', 'RB'],
  ['Josh Downs', 'SIT. 15.3 last week on 17% of the snaps.', 'WR'],
  ['Mark Andrews', 'SIT. 16.2 last week on 8 targets after 5.3, 4.4 and 3.9.', 'TE'],
];

const PIVOTS = [
  ['Kenneth Walker III out', 'Emmett Johnson (FLEX, RB15). Carry a back who kicks off at 4:05p or later.'],
  ['Luther Burden III out', 'Rome Odunze (FLEX, WR26). Carry a receiver who kicks off at 4:05p or later.'],
  ['DeVonta Smith out', 'Makai Lemon (SIT, WR31). Carry a receiver who kicks off at 4:05p or later.'],
  ['Carnell Tate out', 'Elic Ayomanor (SIT, WR33), a flex only if Tate sits. Carry a receiver who kicks off at 4:05p or later.'],
  ['Jordyn Tyson out', 'Chris Olave (START, WR13). Carry a receiver who kicks off at 4:05p or later.'],
  ['Caleb Douglas out', 'Malik Washington (SIT). Carry a receiver who kicks off at 4:05p or later.'],
  ['Dalton Kincaid out', 'No other Buffalo tight end has a call. Carry a tight end who kicks off at 4:05p or later.'],
  ['Bhayshul Tuten out', 'Chris Rodriguez Jr. (SIT). Carry a back who kicks off Sunday night or Monday.'],
  ['David Montgomery out', 'Emari Demercado (SIT). Carry a back who kicks off at 1:00p or later.'],
  ['Omar Cooper Jr. out', 'Adonai Mitchell (SIT), a flex only if Cooper sits. Carry a receiver who kicks off Sunday night or Monday.'],
  ['Brock Bowers out', 'Michael Mayer (SIT), a start only if Bowers sits. Carry a tight end who kicks off Sunday night or Monday.'],
  ['T.J. Hockenson out', 'No other Minnesota tight end has a call. Carry a tight end who kicks off Monday.'],
  ['Woody Marks out (already)', 'David Montgomery (FLEX if active, RB22) and Emari Demercado (SIT).'],
  ['Marvin Harrison Jr. out (already)', 'Nico Collins (START, WR6) and Xavier Hutchinson (FLEX, WR28).'],
  ['Jordan Addison out (already)', 'Justin Jefferson (START, WR7).'],
  ['Jalen Hurts out (already)', 'Joe Milton (SIT) is first on the depth chart.'],
  ['Michael Wilson out (already)', 'No other Arizona receiver has a call.'],
  ['Wan\'Dale Robinson out (already)', 'Carnell Tate (FLEX if active, WR23).'],
  ['RJ Harvey out (already)', 'Jonah Coleman (FLEX, RB14).'],
  ['De\'Von Achane out (already)', 'Ollie Gordon II (FLEX, RB21).'],
  ['Jake Ferguson out (already)', 'No other Dallas tight end has a call.'],
  ['Lamar Jackson out (already)', 'Jacoby Brissett (SIT).'],
];

const CHECK_THU = [
  ['David Montgomery (HOU RB).', 'Active: FLEX. Out: Emari Demercado (SIT). Carry a back who kicks off at 1:00p or later.'],
  ['Everyone else on the card.', 'Thursday locks first: make any swap between the 6:45p ET inactives and the 8:15p ET kickoff.'],
];

const CHECK_ONE = [
  ['Kenneth Walker III (KC RB).', 'Active: START. Out: Emmett Johnson (FLEX, RB15). Carry a back who kicks off at 4:05p or later.'],
  ['Luther Burden III (CHI WR).', 'Active: START. Out: Rome Odunze (FLEX, WR26). Carry a receiver who kicks off at 4:05p or later.'],
  ['DeVonta Smith (PHI WR).', 'Active: FLEX. Out: Makai Lemon (SIT, WR31). Carry a receiver who kicks off at 4:05p or later.'],
  ['Carnell Tate (TEN WR).', 'Active: FLEX. Out: Elic Ayomanor (SIT, WR33), a flex only if Tate sits. Carry a receiver who kicks off at 4:05p or later.'],
  ['Jordyn Tyson (NO WR).', 'Active: FLEX. Out: Chris Olave (START, WR13). Carry a receiver who kicks off at 4:05p or later.'],
  ['Caleb Douglas (MIA WR).', 'Active: FLEX. Out: Malik Washington (SIT). Carry a receiver who kicks off at 4:05p or later.'],
  ['Dalton Kincaid (BUF TE).', 'Active: START. Out: no other Buffalo tight end has a call. Carry a tight end who kicks off at 4:05p or later.'],
  ['Sits either way.', 'Baker Mayfield, Kyle Monangai, Tyjae Spears, Darren Waller and Tommy Tremble.'],
];

const CHECK_LATE = [
  ['Bhayshul Tuten (JAX RB).', 'Active: FLEX. Out: Chris Rodriguez Jr. (SIT). Carry a back who kicks off Sunday night or Monday.'],
  ['Omar Cooper Jr. (NYJ WR).', 'Active: FLEX. Out: Adonai Mitchell (SIT), a flex only if Cooper sits. Carry a receiver who kicks off Sunday night or Monday.'],
  ['Brock Bowers (LV TE).', 'Active: START. Out: Michael Mayer (SIT), a start only if Bowers sits. Carry a tight end who kicks off Sunday night or Monday.'],
  ['Sits either way.', 'Geno Smith, Chris Rodriguez Jr., Jakobi Meyers, Jaylen Waddle and Ladd McConkey.'],
];

const CHECK_SNF = [
  ['T.J. Hockenson (MIN TE).', 'Active: START. Out: no other Minnesota tight end has a call. Carry a tight end who kicks off Monday.'],
  ['Sits either way.', 'Kyler Murray and Mike Evans.'],
];

const CHECK_MNF = [
  ['Nobody on this card has an if-active call.', 'The Cincinnati at Washington starts are Joe Burrow, Ja\'Marr Chase, Tee Higgins, Chase Brown, Jayden Daniels and Chig Okonkwo.'],
  ['Sits either way.', 'Jacory Croskey-Merritt.'],
  ['Everyone else on the card.', 'Monday is the last window, so a scratch here has no later game to pivot to.'],
];

const Body = () => (
  <>
    <HeroBanner />

    <Lead>
      Thirteen games, Thursday through Monday. Atlanta, Cleveland, Green Bay, the Rams, New England and Seattle are on bye, so 26 teams play.
      Indianapolis at Houston kicks off first, Thursday at 8:15p ET. Minnesota plays San Francisco Sunday night at 8:20p ET at Estadio Banorte in Mexico City, with San Francisco as the home team, and Cincinnati at Washington closes the week Monday at 8:15p ET.
      Philadelphia&apos;s Jalen Hurts is on IR and expected to miss the rest of the season, and Joe Milton is first on the depth chart. Houston rules out Woody Marks and Marvin Harrison Jr. for Thursday, and Jawhar Jordan is listed as out in our data. Arizona placed Jeremiyah Love, Kendrick Bourne and Michael Wilson on IR. Every call is here.
    </Lead>

    <Note title="Read this first">
      <strong>Lines are from our database as of Nov 19, 9:32am ET. Weather as of 6:12am ET. Practice notes
      are the Wednesday reports (Indianapolis and Houston: the final Thursday-game report); no Thursday report
      was published at writing.</strong>{' '}
      News since last week&apos;s report:
      <Box component="ul" sx={{ pl: 2.5, m: '8px 0 0 !important' }}>
        <li>Houston, Thursday: Woody Marks (concussion) and Marvin Harrison Jr. (hamstring) are ruled out, Jawhar Jordan is listed as out in our data, and Jaylin Noel went on IR Wednesday (toe, out for the season). David Montgomery practiced in full (groin). He last played in Week 5.</li>
        <li>Philadelphia: Jalen Hurts is on IR and expected to miss the rest of the season. Joe Milton is first on the depth chart.</li>
        <li>Minnesota: Kirk Cousins started last week. Kyler Murray did not practice Wednesday (hamstring), and Jordan Addison had thumb surgery and is out.</li>
        <li>Kansas City: Kenneth Walker III did not practice Wednesday (groin) and has no Week 10 game in our data. Emmett Johnson had 22 carries last week.</li>
        <li>Arizona placed Jeremiyah Love (ankle), Kendrick Bourne (tibia) and Michael Wilson (neck) on IR. Gardner Minshew II had elbow surgery. Carson Beck is the quarterback.</li>
        <li>Las Vegas: Brock Bowers (ankle) did not practice Wednesday. His coach said he does not need to practice to play Sunday.</li>
        <li>Tennessee: Wan&apos;Dale Robinson is on IR and out for the season (ankle). Carnell Tate was limited Wednesday (shoulder).</li>
        <li>Dallas: Jake Ferguson (knee, ankle) will not play Sunday.</li>
        <li>Tampa Bay: Baker Mayfield did not practice Wednesday (foot).</li>
        <li>Washington designated Jacory Croskey-Merritt to return from IR on Tuesday.</li>
      </Box>
      Re-check the Thursday and Friday reports and the inactives before you lock anything. Every window below says
      when the inactives drop. Every time on this page is Eastern.
    </Note>

    <P>
      Scoring is PPR. Atlanta, Cleveland, Green Bay, the Rams, New England and Seattle are on bye, so nobody from those six plays this week.
      Where an engine projection is a placeholder (an injured or inactive player the model still scores),
      I say so and lean on usage.
    </P>
    <RailList
      items={[
        ['FPA rank', '1 means the defense allows the most points to that position (a good matchup), 32 the fewest (tough). Weeks 1 to 10.'],
        ['Verdicts', 'START, FLEX, SIT and OUT are the rulings. "If active" calls are void if the player does not appear, and they sit in the game-time group of each card.'],
        ['Tiers', 'QB 14, RB 27, WR 33, TE 14 and D/ST 8, in the order I rank them. A player ranked without a ruling says so.'],
        ['Ruling links', 'Every call on a card links to its Darkness Ruling (C1 to C139) with the reason.'],
      ]}
    />

    <JumpGrid games={GAMES} />

    <H2>The Slate Board</H2>
    <P>
      Every game, in kickoff order with Thursday first: line, total, weather and both implied totals on
      one scale. Filled bars are the favorites. Tennessee at Dallas has the highest total, 54.5, then
      Cincinnati at Washington at 53.5 and New Orleans at Chicago at 48.5. Pittsburgh at Philadelphia has the
      lowest, 37.5, then Arizona at Kansas City and Las Vegas at Denver at 40.5. Dallas (31.5) and Buffalo
      (31.0) have the highest implied totals, then Chicago and Cincinnati at 30.0. Arizona has the lowest
      implied total, 12.5, then Miami at 14.5, Las Vegas at 15.25 and Indianapolis at 15.5. Buffalo (-16.5),
      Kansas City (-15.5), Houston (-12.5), Chicago (-11.5) and Denver (-10) are the biggest favorites.
      Pittsburgh is a 4.5-point road favorite at Philadelphia.
    </P>
    <SlateBoard games={GAMES} />
    <P>
      Detroit and the Chargers play indoors, and Houston and Dallas have retractable roofs. Mexico City has
      no forecast in our data. Wind is 15 mph in Chicago, with a 34% chance of rain showers, and 15 mph
      outside in Dallas. Kansas City has 13 mph wind, and Washington has 12 mph on Monday. Philadelphia has a
      50% chance of light rain, and the Giants&apos; game has a 30% chance. Chicago&apos;s wind is the one
      worth a thought, and it is already in the New Orleans rulings.
    </P>

    <H2>The Injury Board</H2>
    <P>
      The practice notes here are the Wednesday reports. The decision rules are simple, and I apply them
      the same way to every name on this page.
    </P>
    <RailList
      color="var(--warning)"
      items={[
        ['"If active" calls', 'are void if the player does not appear. A call that turns on a practice report carries that injury on its card.'],
        ['Engine placeholders', 'Hurts, Lamar Jackson, Willis, Dart, Marks, Achane, Harvey, Conner, Addison, Harrison, Michael Wilson, Wan\'Dale Robinson, McLaurin, Pierce and Ferguson carry a projection. Each has an OUT ruling, so the projection is a placeholder.'],
        ['Byes', 'Atlanta, Cleveland, Green Bay, the Rams, New England and Seattle: nobody from those six plays this week.'],
      ]}
    />
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, my: 2 }}>
      <Chip tone="var(--accent)">Thursday: about 6:45p ET</Chip>
      <Chip tone="var(--accent)">1:00p games: about 11:30a ET</Chip>
      <Chip tone="var(--accent)">4:05p / 4:25p: about 2:35p / 2:55p ET</Chip>
      <Chip tone="var(--accent)">SNF: about 6:50p ET</Chip>
      <Chip tone="var(--accent)">MNF: about 6:45p ET Monday</Chip>
    </Box>

    <InjuryGroup title="Out, or treat as out" when="Engine projections for these players are placeholders." rows={INJ_OUT} />
    <InjuryGroup title="Thursday" when="Inactives about 6:45p ET" rows={INJ_THU} />
    {INJ_INTL.length ? <InjuryGroup title="International" when="Inactives about 90 minutes before kickoff" rows={INJ_INTL} /> : null}
    <InjuryGroup title="1:00p games" when="Inactives about 11:30a ET" rows={INJ_ONE} />
    <InjuryGroup title="Late window" when="Inactives about 2:35p / 2:55p ET" rows={INJ_LATE} />
    {INJ_NIGHT.length ? <InjuryGroup title="Sunday night" when="Inactives about 6:50p ET" rows={INJ_NIGHT} /> : null}
    <InjuryGroup title="Monday night" when="Inactives about 6:45p ET Monday; no later window" rows={INJ_MNF} />
    <Box component="h3" sx={{ m: '24px 0 8px !important', fontSize: '1.15rem !important' }}>Already out for the week or longer</Box>
    <Box component="p" sx={{ mt: '0 !important', fontSize: '0.92rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
      {ALREADY_OUT.join('; ')}.
    </Box>

    <H2>Thursday Night</H2>
    <P>
      One game, and it is the first kickoff of the week: Indianapolis at Houston at 8:15p ET. Houston has a
      retractable roof. Outside, it is 66F and partly cloudy. Inactives drop about 6:45p ET.
    </P>
    {SLOT('thu')}

    <H2>The 1:00p Window</H2>
    <P>
      Seven games at 1:00p ET: Arizona at Kansas City, Baltimore at Carolina, Miami at Buffalo, New Orleans at
      Chicago, Pittsburgh at Philadelphia, Tampa Bay at Detroit and Tennessee at Dallas. Nothing kicks between
      1:00p and 4:05p, so a 1:00p decision needs a 4:05p-or-later swap on your bench. Inactives drop about
      11:30a ET.
    </P>
    {SLOT('one')}

    <H2>Late Window</H2>
    <P>
      Three games, one at 4:05p and two at 4:25p. The Jets at the Chargers kick off at 4:05p, and Jacksonville
      at the Giants and Las Vegas at Denver kick off at 4:25p. Inactives drop about 2:35p ET for the 4:05p game
      and about 2:55p ET for the 4:25p games.
    </P>
    {SLOT('late')}

    <H2>Prime Time</H2>
    <P>
      Sunday night is Minnesota against San Francisco at 8:20p ET, played at Estadio Banorte in Mexico City,
      with San Francisco as the home team. Monday night is Cincinnati at Washington at 8:15p ET, the last
      window. Inactives drop about 6:50p ET Sunday and about 6:45p ET Monday. Practice notes here are from
      Wednesday, so hold the Monday read loosely.
    </P>
    {SLOT('prime')}

    <H2>Position Tiers</H2>
    <P>
      The rankings for the Thursday through Monday slate. The bands follow my written verdict on each
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
      for Week 11 and nothing else. A handcuff with no ruling gets no call.
    </P>
    <Table aria-label="Week 11 handcuff board">
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
      is expected to score. Among these matchups, the two lowest opposing implied totals are Arizona
      (12.5) and Miami (14.5), faced by Kansas City and Buffalo.
    </P>
    <Table aria-label="Week 11 D/ST streaming board">
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
    <Table aria-label="Week 11 IDP streamers">
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
      One hundred and thirty-nine rulings, C1 to C139, and 162 calls inside them. Each one is here with
      its reason.
    </P>
    {RULINGS.map((r) => <RulingCard key={r[0]} r={r} />)}

    <H2>Inactives Checklist</H2>
    <P>
      Inactives drop about 90 minutes before each kickoff. Windows are Eastern time. Thursday is the first
      window, so start there.
    </P>
    <WindowChecklist title="Thursday inactives" time="about 6:45p ET" rows={CHECK_THU} />
    <WindowChecklist title="1:00p inactives" time="about 11:30a ET" rows={CHECK_ONE} />
    <WindowChecklist title="4:05p and 4:25p inactives" time="about 2:35p and 2:55p ET" rows={CHECK_LATE} />
    <WindowChecklist title="Sunday night inactives" time="about 6:50p ET" rows={CHECK_SNF} />
    <WindowChecklist title="Monday night inactives" time="about 6:45p ET Monday" rows={CHECK_MNF} />

    <Quote>
      Start the names the rulings start, lean on usage, and have your pivots set before Thursday&apos;s
      8:15p kickoff. The reports still to come may change any of it.
    </Quote>
  </>
);

export default Body;
